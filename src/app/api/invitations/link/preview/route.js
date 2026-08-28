import { NextResponse } from 'next/server';
import { enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  hashInviteToken,
  inviteLinkPreview,
  inviteLinkUsable,
  inviteTokenLooksWellFormed,
} from '@/lib/server/inviteLinks.mjs';
import { resolveOrganizationPortalBrand } from '@/lib/utils/organizationBranding.mjs';
import { hasActiveQuickTeamEntitlement } from '@/lib/utils/quickTeamManaged.mjs';

// The one unauthenticated read in the invitation flow, and the reason the link
// carries the organization identity at all: `/login` cannot know whose portal
// it is until somebody has signed in, so an invited client would otherwise
// meet a grey product screen on the way into a space that is supposed to be
// their supplier's. Holding a valid token is what buys the tenant's brand.
//
// It is a POST because the token belongs in a body, not in a query string that
// every proxy and access log along the way would keep a copy of.
//
// What comes back is what a stranger holding the link may see and no more:
// the portal brand, the client space it opens and the role it grants. Not the
// inviter, not who is already there, not the organization id, and not a word
// about how many uses are left. Expired, revoked, exhausted, inactive and
// unknown all return the same 404 with the same message, so a probe cannot
// tell a real token from a typo.

const INVALID = () => NextResponse.json(
  { error: 'Посилання недійсне або протерміноване' },
  { status: 404 },
);

export async function POST(request) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (!(await enforceRateLimit('invitation-link-preview', ip, 30, 3600))) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }

    const { token } = await readJsonBody(request);
    if (!inviteTokenLooksWellFormed(token)) return INVALID();

    const db = getAdminDb();
    const snapshot = await db.collection('invitations')
      .where('tokenHash', '==', hashInviteToken(token))
      .limit(1)
      .get();
    if (snapshot.empty) return INVALID();

    const invitation = snapshot.docs[0].data();
    if (!inviteLinkUsable(invitation)) return INVALID();

    const [organizationSnapshot, projectSnapshot] = await Promise.all([
      db.collection('organizations').doc(invitation.organizationId).get(),
      db.collection('projects').doc(invitation.projectId).get(),
    ]);
    if (!organizationSnapshot.exists || !hasActiveQuickTeamEntitlement(organizationSnapshot.data())) {
      return INVALID();
    }
    if (
      !projectSnapshot.exists
      || projectSnapshot.data().organizationId !== invitation.organizationId
    ) {
      return INVALID();
    }

    return NextResponse.json(inviteLinkPreview({
      brand: resolveOrganizationPortalBrand(organizationSnapshot.data()),
      projectName: projectSnapshot.data().name,
      role: invitation.role,
    }));
  } catch (error) {
    return routeErrorResponse(error, { context: 'Invitation link preview', fallbackMessage: 'Internal Server Error' });
  }
}
