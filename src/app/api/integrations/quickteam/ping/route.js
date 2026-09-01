import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  normalizeQuickTeamPing,
  quickTeamPortalBranding,
  QUICKTEAM_CONTRACT_VERSION,
  quickTeamOrganizationId,
} from '@/lib/integrations/quickteamContract.mjs';
import { readSignedQuickTeamRequest } from '@/lib/server/quickteamIntegration';

/**
 * What qTicket currently holds for a QuickTeam organization.
 *
 * QuickTeam's integration card used to answer «а воно взагалі працює?» with a
 * revision number out of its own database — a record of what QuickTeam believes
 * it sent, not of what arrived. A failed provisioning leaves that number
 * looking exactly like a successful one, so the screen was confident in
 * proportion to nothing.
 *
 * This is the same question asked of the other product. A reply at all proves
 * the origin, the shared secret and the two clocks agree; the revision in it is
 * the one qTicket really stored, and QuickTeam compares the two to tell «я
 * синхронізував» from «я думаю, що синхронізував».
 *
 * Unlike `/unread` it does not refuse an inactive organization: whether the
 * add-on is off is part of the answer, and a probe that goes quiet when the
 * news is bad is worse than no probe. It names no person, no client and no
 * incident — a state, a revision, and the address a customer would use.
 *
 * It deliberately counts no seats. That query is `orgId ==` together with
 * `role in`, which needs a composite index this project does not carry, and a
 * probe that fails on a missing index lies about the one thing it exists to
 * report.
 *
 * `recordNonce: false` for the reason `/unread` skips it: this changes nothing
 * and is asked by a screen, while a nonce costs a transaction with a write in
 * it. The signature and the five-minute window still apply.
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
    const normalized = normalizeQuickTeamPing(signed.body);
    if (normalized.error) {
      return NextResponse.json({ error: 'Invalid ping payload', code: normalized.error }, { status: 400 });
    }

    const organizationId = quickTeamOrganizationId(normalized.data.sourceOrganizationId);
    const db = getAdminDb();
    const organizationSnap = await db.collection('organizations').doc(organizationId).get();
    const organization = organizationSnap.data() || {};
    const portalOrigin = String(process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');

    return NextResponse.json({
      version: QUICKTEAM_CONTRACT_VERSION,
      organizationId,
      known: organizationSnap.exists,
      revision: Number(organization.quickTeam?.revision || 0),
      entitlement: organization.quickTeam?.entitlement === 'active' ? 'active' : 'inactive',
      // Where a customer of this tenant signs in. QuickTeam cannot work this
      // out — the origin is qTicket's own deployment setting — and «куди я
      // відправляю клієнтів?» was until now answered by asking somebody.
      portalUrl: `${portalOrigin}/login`,
      portalBrand: quickTeamPortalBranding(organization.portalBranding),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'quickteam-ping',
      fallbackMessage: 'Не вдалося перевірити стан qTicket',
    });
  }
}
