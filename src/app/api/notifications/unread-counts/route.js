import { NextResponse } from 'next/server';
import { authenticateRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};
const COUNT_CONCURRENCY = 8;

async function mapWithConcurrency(items, mapper) {
  const results = [];
  for (let index = 0; index < items.length; index += COUNT_CONCURRENCY) {
    const chunk = items.slice(index, index + COUNT_CONCURRENCY);
    results.push(...await Promise.all(chunk.map(mapper)));
  }
  return results;
}

async function aggregateCount(query) {
  const snapshot = await query.count().get();
  return Number(snapshot.data().count) || 0;
}

/**
 * Authoritative unread in-app counts for every organization the token owner
 * belongs to. The client supplies neither uid nor organization ids.
 *
 * Legacy notification documents have no `inapp` field and still belong in the
 * bell. A Firestore `inapp != false` query would omit those missing fields, so
 * the exact count is total unread minus the explicit external-only claims.
 */
export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const uid = authorization.user.uid;
    const db = getAdminDb();
    const memberships = await db.collection('orgMemberships')
      .where('userId', '==', uid)
      .get();
    const organizationIds = [...new Set(memberships.docs
      .map(document => document.data())
      .filter(membership => membership.userId === uid && membership.orgId)
      .map(membership => membership.orgId))];
    const notifications = db.collection('notifications');

    const totals = await mapWithConcurrency(organizationIds, async organizationId => {
      const query = notifications
        .where('userId', '==', uid)
        .where('organizationId', '==', organizationId)
        .where('read', '==', false);
      return [organizationId, await aggregateCount(query)];
    });
    const totalByOrganization = Object.fromEntries(totals);
    const organizationsWithUnread = organizationIds.filter(id => totalByOrganization[id] > 0);
    const externalOnly = await mapWithConcurrency(organizationsWithUnread, async organizationId => {
      const query = notifications
        .where('userId', '==', uid)
        .where('organizationId', '==', organizationId)
        .where('read', '==', false)
        .where('inapp', '==', false);
      return [organizationId, await aggregateCount(query)];
    });
    const externalOnlyByOrganization = Object.fromEntries(externalOnly);
    const counts = Object.fromEntries(organizationIds.map(organizationId => [
      organizationId,
      Math.max(0, totalByOrganization[organizationId] - (externalOnlyByOrganization[organizationId] || 0)),
    ]));

    return NextResponse.json({ counts }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'notification-unread-counts',
      fallbackMessage: 'Не вдалося порахувати непрочитані сповіщення',
    });
  }
}
