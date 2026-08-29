import { NextResponse } from 'next/server';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { quickTeamLaunchId } from '@/lib/integrations/quickteamContract.mjs';
import { INTERNAL_ROLES } from '@/lib/utils/can';

export async function POST(request) {
  try {
    const body = await readJsonBody(request);
    const code = String(body?.code || '').trim();
    if (!/^[A-Za-z0-9_-]{40,180}$/.test(code)) {
      return NextResponse.json({ error: 'Некоректне посилання для входу' }, { status: 400 });
    }

    const db = getAdminDb();
    const launchRef = db.collection('quickTeamLaunches').doc(quickTeamLaunchId(code));
    const launch = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(launchRef);
      if (!snapshot.exists) return null;
      const data = snapshot.data();
      transaction.delete(launchRef);
      return data;
    });
    if (!launch || (launch.expiresAt?.toMillis?.() || 0) <= Date.now()) {
      return NextResponse.json({ error: 'Посилання вже використане або його строк минув' }, { status: 410 });
    }

    const [organization, membership] = await Promise.all([
      db.collection('organizations').doc(launch.organizationId).get(),
      db.collection('orgMemberships')
        .doc(`${launch.organizationId}_${launch.qTicketUserId}`)
        .get(),
    ]);
    if (!organization.exists || organization.data()?.quickTeam?.entitlement !== 'active') {
      return NextResponse.json({ error: 'qTicket вимкнено для цієї організації' }, { status: 403 });
    }
    if (!membership.exists || !INTERNAL_ROLES.includes(membership.data()?.role)) {
      return NextResponse.json({ error: 'Доступ до qTicket вимкнено' }, { status: 403 });
    }
    const customToken = await getAdminAuth().createCustomToken(launch.qTicketUserId, {
      identitySource: 'quickteam',
    });
    return NextResponse.json({
      customToken,
      organizationId: launch.organizationId,
      returnTo: launch.returnTo || '/overview',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'quickteam-consume',
      fallbackMessage: 'Не вдалося завершити вхід через QuickTeam',
    });
  }
}
