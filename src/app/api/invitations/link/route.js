import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { resolveInvitationScope } from '@/lib/server/invitationScope.mjs';
import {
  INVITE_LINK_SCOPE,
  INVITE_LINK_TYPE,
  createInviteToken,
  hashInviteToken,
  inviteLinkExpiryDays,
  inviteLinkMaxUses,
  inviteLinkRole,
} from '@/lib/server/inviteLinks.mjs';
import { rolesFor } from '@/lib/utils/can';

// Creating and revoking a client invite link.
//
// The link is fixed at creation to one client role and one client project of
// one organization, and the raw token leaves the server exactly once — in the
// response below. Firestore keeps only its SHA-256, and `firestore.rules`
// refuses every browser read and write of a link document, so the copy the
// author pastes into a messenger is the only copy that exists.
//
// Two guards stand between a request and a role. `inviteLinkRole` refuses
// anything that is not `client_admin`/`client_member`, and `resolveInvitationScope`
// — the same policy the email invitation uses, rather than a second one —
// re-derives the role from the author's own membership and proves the project
// belongs to this organization and, for a client administrator, to them.
// They must agree; a disagreement is a bug in one of them and refuses.

const ROLE_REFUSED = {
  LINK_AUTHOR_REFUSED: 'Ця роль не може створювати посилання-запрошення',
  INTERNAL_ROLE_REFUSED: 'Посилання видає доступ лише клієнтові',
};

function inviteLinkUrl(token) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${baseUrl}/invite/${token}`;
}

export async function POST(request) {
  try {
    const { organizationId, projectId, role, expiresInDays, maxUses } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(
      request,
      organizationId,
      rolesFor('invite:client_member'),
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('invitation-link', authorization.user.uid, 10, 3600))) {
      return NextResponse.json({ error: 'Too many invite links' }, { status: 429 });
    }

    const inviterRole = authorization.membership.role;
    const safeRole = inviteLinkRole(role, inviterRole);

    const db = getAdminDb();
    const scope = await resolveInvitationScope(db, {
      requestedProjectIds: [projectId],
      organizationId,
      inviterUid: authorization.user.uid,
      inviterRole,
      requestedRole: safeRole,
    });
    // Both policies answer the same question from the same membership; if they
    // ever stop agreeing, nobody is seated until somebody looks at why.
    if (scope.role !== safeRole || scope.projectIds.length !== 1) {
      throw new Error('INTERNAL_ROLE_REFUSED');
    }

    const days = inviteLinkExpiryDays(expiresInDays);
    const uses = inviteLinkMaxUses(maxUses);
    const token = createInviteToken();
    const expiresAt = Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);

    const reference = await db.collection('invitations').add({
      type: INVITE_LINK_TYPE,
      tokenHash: hashInviteToken(token),
      organizationId,
      // `projectId` is the boundary this link is fixed to; `projectIds` is the
      // shape every other invitation reader already speaks.
      projectId: scope.projectIds[0],
      projectIds: scope.projectIds,
      scope: INVITE_LINK_SCOPE,
      role: safeRole,
      status: 'pending',
      invitedBy: authorization.user.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      maxUses: uses,
      usedCount: 0,
    });

    return NextResponse.json({
      id: reference.id,
      url: inviteLinkUrl(token),
      role: safeRole,
      projectId: scope.projectIds[0],
      expiresAt: expiresAt.toMillis(),
      maxUses: uses,
      usedCount: 0,
    }, { status: 201 });
  } catch (error) {
    if (ROLE_REFUSED[error.message]) {
      return NextResponse.json({ error: ROLE_REFUSED[error.message] }, { status: 403 });
    }
    if (error.message === 'INVALID_PROJECT_SCOPE') {
      return NextResponse.json({ error: 'Проєкт недоступний для цієї організації' }, { status: 400 });
    }
    if (error.message === 'CLIENT_PROJECT_REQUIRED') {
      return NextResponse.json({ error: 'Оберіть один доступний клієнтський проєкт' }, { status: 400 });
    }
    return routeErrorResponse(error, { context: 'Invitation link POST', fallbackMessage: 'Internal Server Error' });
  }
}

// Revoking. A revoked link fails exactly like an expired or exhausted one, so
// the person who received it learns only that it no longer works.
export async function DELETE(request) {
  try {
    const { organizationId, linkId } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(
      request,
      organizationId,
      rolesFor('invite:client_member'),
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (typeof linkId !== 'string' || !linkId.trim()) {
      return NextResponse.json({ error: 'Link is required' }, { status: 400 });
    }

    const db = getAdminDb();
    const reference = db.collection('invitations').doc(linkId.trim());
    const snapshot = await reference.get();
    const invitation = snapshot.exists ? snapshot.data() : null;
    // A client administrator revokes their own links and no others: they never
    // see a link the tenant issued, so being able to cancel one would only ever
    // be a way to close the door somebody else opened.
    const ownsLink = authorization.membership.role !== 'client_admin'
      || invitation?.invitedBy === authorization.user.uid;
    if (
      !invitation
      || invitation.type !== INVITE_LINK_TYPE
      || invitation.organizationId !== organizationId
      || !ownsLink
    ) {
      return NextResponse.json({ error: 'Посилання не знайдено' }, { status: 404 });
    }

    await reference.update({
      status: 'revoked',
      revokedAt: FieldValue.serverTimestamp(),
      revokedBy: authorization.user.uid,
    });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return routeErrorResponse(error, { context: 'Invitation link DELETE', fallbackMessage: 'Internal Server Error' });
  }
}
