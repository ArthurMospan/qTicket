import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  normalizeQuickTeamUnread,
  quickTeamIdentityId,
  quickTeamOrganizationId,
} from '@/lib/integrations/quickteamContract.mjs';
import { readSignedQuickTeamRequest } from '@/lib/server/quickteamIntegration';
import { unreadInAppCount } from '@/lib/server/notificationCounts';
import { INTERNAL_ROLES } from '@/lib/utils/can';

/**
 * How many unread in-app notifications a QuickTeam staff member has waiting in
 * qTicket. QuickTeam draws it as a number beside its own rail row, so somebody
 * working in the other product can see that a client wrote without opening this
 * one.
 *
 * It answers with a number and nothing else — no title, no client, no incident
 * key. A badge is a reason to come here, not a copy of the bell that lives
 * here, and the second one would be a second inbox to keep truthful.
 *
 * The nonce store is deliberately not used (`recordNonce: false`): this request
 * is asked on every QuickTeam rail mount and changes nothing, while a nonce
 * costs a transaction with a write in it. The signature and the five-minute
 * window still apply. See `readSignedQuickTeamRequest`.
 *
 * Every refusal answers the same way a launch does — `inactive` when the
 * add-on is off, `not_enabled` when the person holds no internal seat — so an
 * organization that turned qTicket off stops publishing counts about itself.
 */
export async function POST(request) {
  try {
    const signed = await readSignedQuickTeamRequest(request, { recordNonce: false });
    if (signed.error) {
      return NextResponse.json(
        { error: signed.error, code: signed.code },
        { status: signed.status },
      );
    }
    const normalized = normalizeQuickTeamUnread(signed.body);
    if (normalized.error) {
      return NextResponse.json({ error: 'Invalid unread payload', code: normalized.error }, { status: 400 });
    }

    const payload = normalized.data;
    const organizationId = quickTeamOrganizationId(payload.sourceOrganizationId);
    const db = getAdminDb();
    const [organizationSnap, identitySnap] = await Promise.all([
      db.collection('organizations').doc(organizationId).get(),
      db.collection('quickTeamIdentities').doc(quickTeamIdentityId(payload.sourceUserId)).get(),
    ]);
    if (!organizationSnap.exists || organizationSnap.data()?.quickTeam?.entitlement !== 'active') {
      return NextResponse.json({ error: 'qTicket is not active for this organization', code: 'inactive' }, { status: 403 });
    }

    const qTicketUserId = identitySnap.data()?.qTicketUserId || '';
    const membershipSnap = qTicketUserId
      ? await db.collection('orgMemberships').doc(`${organizationId}_${qTicketUserId}`).get()
      : null;
    if (!membershipSnap?.exists || !INTERNAL_ROLES.includes(membershipSnap.data()?.role)) {
      return NextResponse.json({ error: 'User is not enabled for qTicket', code: 'not_enabled' }, { status: 403 });
    }

    return NextResponse.json({
      version: 1,
      unread: await unreadInAppCount(db, qTicketUserId, organizationId),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'quickteam-unread',
      fallbackMessage: 'Не вдалося порахувати непрочитані сповіщення',
    });
  }
}
