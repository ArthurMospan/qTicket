import { NextResponse } from 'next/server';
import { authorizeOrgRequest } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { rolesFor, isClientRole } from '@/lib/utils/can';
import {
  listQuickTeamProjects,
  quickTeamSourceUserId,
  quickTeamTransferConfigured,
} from '@/lib/server/quickteamTransfer';

/**
 * The QuickTeam projects this staff member may put a transferred task into.
 *
 * qTicket does not keep a copy of QuickTeam's projects and does not want one —
 * it asks at the moment somebody is choosing, and QuickTeam answers with the
 * list that person would see there. An empty list is an answer too: it means
 * this person is on no QuickTeam project, and the dialog says so rather than
 * offering a picker with nothing in it.
 */
export async function GET(request) {
  try {
    const organizationId = new URL(request.url).searchParams.get('organizationId')?.trim() || '';
    const authorization = await authorizeOrgRequest(request, organizationId, rolesFor('edit:issue'));
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (isClientRole(authorization.membership?.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!quickTeamTransferConfigured()) {
      return NextResponse.json({ configured: false, projects: [] }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const sourceOrganizationId = authorization.organization?.quickTeam?.sourceOrganizationId || '';
    const sourceUserId = await quickTeamSourceUserId(authorization.user.uid);
    if (!sourceOrganizationId || !sourceUserId) {
      return NextResponse.json({ configured: true, linked: false, projects: [] }, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    }

    const answer = await listQuickTeamProjects({ sourceOrganizationId, sourceUserId });
    return NextResponse.json({
      configured: true,
      linked: true,
      projects: Array.isArray(answer.projects) ? answer.projects : [],
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (Number(error?.status) >= 400 && Number(error?.status) < 500) {
      return NextResponse.json({
        error: error.message,
        code: error.code || 'QUICKTEAM_REFUSED',
      }, { status: error.status });
    }
    return routeErrorResponse(error, {
      context: 'quickteam-projects',
      fallbackMessage: 'Не вдалося отримати проєкти QuickTeam',
    });
  }
}
