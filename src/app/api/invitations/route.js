import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { deliverEmail, invitationEmailHtml } from '@/lib/server/email';
import { reactivateMembership } from '@/lib/server/orgMembership';
import { resolveInvitationScope } from '@/lib/server/invitationScope.mjs';
import { isClientRole, rolesFor } from '@/lib/utils/can';
import { organizationPortalName } from '@/lib/utils/organizationBranding.mjs';
import {
  isQuickTeamManagedOrganization,
  QUICKTEAM_MANAGED_MESSAGE,
} from '@/lib/utils/quickTeamManaged.mjs';

// The invitation must be created even when the email provider is down or not
// configured — the pending doc alone already works (it is auto-accepted on the
// invitee's first login with that address). Email is best-effort on top.
async function sendInvitationEmail(db, { email, organizationId, inviterUid, role }) {
  try {
    const [orgSnap, inviterSnap] = await Promise.all([
      db.collection('organizations').doc(organizationId).get(),
      db.collection('users').doc(inviterUid).get(),
    ]);
    // The name the client already knows, resolved through the one brand
    // resolver rather than read raw off the organization document: a
    // QuickTeam-managed tenant may present a portal name of its own.
    const orgName = orgSnap.exists ? organizationPortalName(orgSnap.data()) : '';
    const inviter = inviterSnap.exists ? inviterSnap.data() : {};
    const delivered = await deliverEmail({
      to: email,
      subject: `Запрошення до «${orgName || 'Підтримка'}»`,
      html: invitationEmailHtml({
        orgName,
        inviterName: inviter.name || inviter.email || '',
        role,
        ctaPath: '/login',
      }),
    });
    if (!delivered) console.error('[invitations] invitation email was not delivered', { email });
    return delivered;
  } catch (error) {
    console.error('[invitations] invitation email failed', error);
    return false;
  }
}

export async function POST(request) {
  try {
    const { organizationId, email, role, projectIds } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(
      request,
      organizationId,
      rolesFor('invite:client_member'),
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('invitation', authorization.user.uid, 20, 3600))) {
      return NextResponse.json({ error: 'Too many invitations' }, { status: 429 });
    }

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }
    const db = getAdminDb();
    const organizationSnapshot = await db.collection('organizations').doc(organizationId).get();
    if (!organizationSnapshot.exists) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    const invitationScope = await resolveInvitationScope(db, {
      requestedProjectIds: projectIds,
      organizationId,
      inviterUid: authorization.user.uid,
      inviterRole: authorization.membership.role,
      requestedRole: role,
    });
    const {
      role: safeRole,
      clientInvitee,
      projectIds: invitedProjectIds,
      scope,
      restoreArchivedProjects,
    } = invitationScope;
    if (isQuickTeamManagedOrganization(organizationSnapshot.data()) && !clientInvitee) {
      return NextResponse.json({
        error: QUICKTEAM_MANAGED_MESSAGE,
        code: 'QUICKTEAM_MANAGED',
      }, { status: 409 });
    }

    const userSnap = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!userSnap.empty) {
      const userId = userSnap.docs[0].id;
      const membershipId = `${organizationId}_${userId}`;
      const membershipRef = db.collection('orgMemberships').doc(membershipId);
      const existingMembership = await membershipRef.get();
      if (existingMembership.exists) {
        // Somebody already here, invited into a project they are not on yet.
        //
        // This used to be a flat 409, and it made «one person, one project» a
        // rule of the product rather than of the data — which it never was:
        // `project.team` is an array and always has been. What it actually cost
        // was a real case the owner hit: a supplier serving two of their
        // customers, one contact working with both, and no way to give that
        // contact the second project except a second email address.
        //
        // Their **role does not move**. An existing `client_member` invited by
        // an administrator as a `client_admin` stays a member: an invitation is
        // a grant of access to a project, and quietly promoting somebody
        // because a colleague picked the wrong door is not one. The internal
        // seat case never reaches here — a QuickTeam-managed membership is
        // refused several lines above, and that stays the boundary.
        const currentRole = existingMembership.data().role;
        const alreadyOnAll = invitedProjectIds.length > 0 && (await Promise.all(
          invitedProjectIds.map(async projectId => {
            const project = await db.collection('projects').doc(projectId).get();
            return project.exists && (project.data().team || []).includes(userId);
          }),
        )).every(Boolean);
        if (!isClientRole(currentRole) || !invitedProjectIds.length || alreadyOnAll) {
          return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
        }
        const batch = db.batch();
        invitedProjectIds.forEach(projectId => {
          batch.update(db.collection('projects').doc(projectId), {
            team: FieldValue.arrayUnion(userId),
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
        await batch.commit();
        return NextResponse.json({ type: 'project_added', role: currentRole }, { status: 200 });
      }
      // Someone who used to be here comes back to their own seat, not to a
      // blank one: the same position, the same projects, and every task still
      // assigned to them. Creating a fresh membership instead would leave the
      // archive behind and quietly strand all of it.
      const reactivated = await reactivateMembership({
        organizationId,
        userId,
        role: safeRole,
        extraProjectIds: invitedProjectIds,
        restoreArchivedProjects,
        actorId: authorization.user.uid,
      });
      if (reactivated.restored) {
        const emailSent = await sendInvitationEmail(db, {
          email: normalizedEmail,
          organizationId,
          inviterUid: authorization.user.uid,
          role: reactivated.role,
        });
        return NextResponse.json({ type: 'reactivated', emailSent }, { status: 200 });
      }
      const batch = db.batch();
      batch.set(membershipRef, {
        id: membershipId,
        orgId: organizationId,
        userId,
        role: safeRole,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: authorization.user.uid,
      });
      batch.update(db.collection('organizations').doc(organizationId), {
        memberDirectoryVersion: FieldValue.increment(1),
      });
      // An existing QuickTeam account never sees a pending invitation, so the
      // project scope has to be applied here or it would be dropped silently.
      invitedProjectIds.forEach(projectId => {
        batch.update(db.collection('projects').doc(projectId), {
          team: FieldValue.arrayUnion(userId),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      const emailSent = await sendInvitationEmail(db, {
        email: normalizedEmail,
        organizationId,
        inviterUid: authorization.user.uid,
        role: safeRole,
      });
      return NextResponse.json({ type: 'added_directly', emailSent }, { status: 201 });
    }

    const pendingSnap = await db.collection('invitations')
      .where('organizationId', '==', organizationId)
      .where('email', '==', normalizedEmail)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (!pendingSnap.empty) {
      return NextResponse.json({ error: 'Invitation is already pending' }, { status: 409 });
    }
    await db.collection('invitations').add({
      email: normalizedEmail,
      organizationId,
      invitedBy: authorization.user.uid,
      role: safeRole,
      projectIds: invitedProjectIds,
      scope,
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
    const emailSent = await sendInvitationEmail(db, {
      email: normalizedEmail,
      organizationId,
      inviterUid: authorization.user.uid,
      role: safeRole,
    });
    return NextResponse.json({ type: 'invitation_sent', emailSent }, { status: 201 });
  } catch (error) {
    if (error.message === 'INVALID_PROJECT_SCOPE') {
      return NextResponse.json({ error: 'Проєкт недоступний для цієї організації' }, { status: 400 });
    }
    if (error.message === 'CLIENT_PROJECT_REQUIRED') {
      return NextResponse.json({ error: 'Оберіть один доступний проєкт' }, { status: 400 });
    }
    return routeErrorResponse(error, { context: 'Invitation POST', fallbackMessage: 'Internal Server Error' });
  }
}
