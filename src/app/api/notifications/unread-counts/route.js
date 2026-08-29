import { NextResponse } from 'next/server';
import { authenticateRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { unreadInAppCount } from '@/lib/server/notificationCounts';

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

/**
 * Authoritative unread in-app counts for every organization the token owner
 * belongs to. The client supplies neither uid nor organization ids.
 *
 * What «unread» means lives in `unreadInAppCount` — the same definition the
 * signed QuickTeam badge is answered from, so a rail in one product and a bell
 * in the other cannot disagree about the same person.
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

    const totals = await mapWithConcurrency(organizationIds, async organizationId => (
      [organizationId, await unreadInAppCount(db, uid, organizationId)]
    ));

    return NextResponse.json({ counts: Object.fromEntries(totals) }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'notification-unread-counts',
      fallbackMessage: 'Не вдалося порахувати непрочитані сповіщення',
    });
  }
}
