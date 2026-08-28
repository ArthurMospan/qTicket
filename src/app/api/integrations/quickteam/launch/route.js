import { NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  QUICKTEAM_LAUNCH_TTL_SECONDS,
  normalizeQuickTeamLaunch,
  quickTeamIdentityId,
  quickTeamLaunchCode,
  quickTeamLaunchId,
  quickTeamOrganizationId,
} from '@/lib/integrations/quickteamContract.mjs';
import { readSignedQuickTeamRequest } from '@/lib/server/quickteamIntegration';

export async function POST(request) {
  try {
    const signed = await readSignedQuickTeamRequest(request);
    if (signed.error) {
      return NextResponse.json(
        { error: signed.error, code: signed.code },
        { status: signed.status },
      );
    }
    const normalized = normalizeQuickTeamLaunch(signed.body);
    if (normalized.error) {
      return NextResponse.json({ error: 'Invalid launch payload', code: normalized.error }, { status: 400 });
    }

    const payload = normalized.data;
    const organizationId = quickTeamOrganizationId(payload.sourceOrganizationId);
    const db = getAdminDb();
    const [organizationSnap, identitySnap] = await Promise.all([
      db.collection('organizations').doc(organizationId).get(),
      db.collection('quickTeamIdentities').doc(quickTeamIdentityId(payload.sourceUserId)).get(),
    ]);
    const qTicketUserId = identitySnap.data()?.qTicketUserId || '';
    const membershipSnap = qTicketUserId
      ? await db.collection('orgMemberships').doc(`${organizationId}_${qTicketUserId}`).get()
      : null;
    if (!organizationSnap.exists || organizationSnap.data()?.quickTeam?.entitlement !== 'active') {
      return NextResponse.json({ error: 'qTicket is not active for this organization', code: 'inactive' }, { status: 403 });
    }
    if (!membershipSnap?.exists || !['owner', 'admin', 'member'].includes(membershipSnap.data()?.role)) {
      return NextResponse.json({ error: 'User is not enabled for qTicket', code: 'not_enabled' }, { status: 403 });
    }

    const code = quickTeamLaunchCode();
    const expiresAt = Date.now() + QUICKTEAM_LAUNCH_TTL_SECONDS * 1000;
    await db.collection('quickTeamLaunches').doc(quickTeamLaunchId(code)).create({
      provider: 'quickteam',
      qTicketUserId,
      organizationId,
      returnTo: payload.returnTo,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAt),
    });
    const appOrigin = String(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');
    return NextResponse.json({
      launchUrl: `${appOrigin}/login/quickteam?code=${encodeURIComponent(code)}`,
      expiresAt: new Date(expiresAt).toISOString(),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'quickteam-launch',
      fallbackMessage: 'Не вдалося відкрити qTicket',
    });
  }
}
