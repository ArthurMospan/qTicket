import { NextResponse } from 'next/server';
import { authorizeOrgRequest } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { QUICKTEAM_MANAGED_MESSAGE } from '@/lib/utils/quickTeamManaged.mjs';

export async function PATCH(request, context) {
  try {
    const { organizationId } = await context.params;
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json(
        { error: authorization.error, code: authorization.code },
        { status: authorization.status },
      );
    }

    // Organization identity, ownership, internal staff and entitlement are one
    // QuickTeam-owned snapshot. qTicket never edits one field from that snapshot
    // independently, because the next provisioning revision would overwrite it.
    return NextResponse.json({
      error: QUICKTEAM_MANAGED_MESSAGE,
      code: 'QUICKTEAM_MANAGED',
    }, { status: 409 });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'organization-update',
      fallbackMessage: 'Failed to update organization',
    });
  }
}
