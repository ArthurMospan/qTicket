import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { deliverEmail, invitationEmailHtml } from '@/lib/server/email';
import { reactivateMembership } from '@/lib/server/orgMembership';
import { seedChatReadState } from '@/lib/server/chatReadState';
import {
  countActiveMembers,
  organizationPlan,
  planLimitRefusalResponse,
  recordPlanUsage,
} from '@/lib/server/planLimits';
import { invitedRoleFor, isClientRole, rolesFor } from '@/lib/utils/can';
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
    const orgName = orgSnap.exists ? orgSnap.data().name : '';
    const inviter = inviterSnap.exists ? inviterSnap.data() : {};
    const delivered = await deliverEmail({
      to: email,
      subject: `Запрошення до «${orgName || 'qTicket'}»`,
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

// Projects an invitation may pre-assign. Every id has to belong to the same
// organization the caller was authorized for, otherwise a project id from
// another workspace would add the invitee to a project nobody vetted.
async function resolveInvitedProjectIds(
  db,
  requested,
  organizationId,
  { requiredTeamMemberId = '', exactlyOne = false } = {},
) {
  const ids = [...new Set(
    (Array.isArray(requested) ? requested : [])
      .filter(id => typeof id === 'string' && id.trim())
      .map(id => id.trim()),
  )].slice(0, 20);
  if (exactlyOne && ids.length !== 1) throw new Error('CLIENT_PROJECT_REQUIRED');
  if (!ids.length) return [];
  const snapshots = await db.getAll(...ids.map(id => db.collection('projects').doc(id)));
  if (snapshots.some(snapshot => (
    !snapshot.exists
    || snapshot.data().organizationId !== organizationId
    || (requiredTeamMemberId && !snapshot.data().team?.includes(requiredTeamMemberId))
  ))) {
    throw new Error('INVALID_PROJECT_SCOPE');
  }
  return snapshots.map(snapshot => snapshot.id);
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
    const clientScopedInvitation = authorization.membership.role === 'client_admin';
    const safeRole = invitedRoleFor(role, authorization.membership.role);
    const clientInvitee = isClientRole(safeRole);
    const db = getAdminDb();
    const organizationSnapshot = await db.collection('organizations').doc(organizationId).get();
    if (!organizationSnapshot.exists) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (isQuickTeamManagedOrganization(organizationSnapshot.data()) && !clientInvitee) {
      return NextResponse.json({
        error: QUICKTEAM_MANAGED_MESSAGE,
        code: 'QUICKTEAM_MANAGED',
      }, { status: 409 });
    }

    // The seat ceiling, counted here rather than promised on the price list.
    // «До 5 учасників» has been on the free plan since before this route
    // existed and nothing ever counted them, so the number was a sentence on a
    // page. A pending invitation counts as a seat: one that has been offered is
    // taken, or a workspace could invite its way past any ceiling and find out
    // only when everybody accepted at once.
    //
    // Asked for at the moment a seat is actually about to be taken, not at the
    // top of the route — somebody who is already on the team gets «вже в
    // команді», which is what happened, rather than a refusal about a ceiling
    // their invitation was never going to cross.
    const refuseWithoutSeat = async () => {
      const [organizationSnapshot, seatsTaken, pendingSeats] = await Promise.all([
        Promise.resolve(organizationSnapshot),
        countActiveMembers(db, organizationId),
        db.collection('invitations')
          .where('organizationId', '==', organizationId)
          .where('status', '==', 'pending')
          .count()
          .get()
          .then(snapshot => snapshot.data().count),
      ]);
      await recordPlanUsage(db, organizationId, { members: seatsTaken });
      return planLimitRefusalResponse(
        organizationPlan(organizationSnapshot),
        'members',
        seatsTaken + pendingSeats,
      );
    };

    const invitedProjectIds = await resolveInvitedProjectIds(db, projectIds, organizationId, {
      requiredTeamMemberId: clientScopedInvitation ? authorization.user.uid : '',
      // Every external account belongs to one client workspace, regardless of
      // whether the invitation was sent by the tenant or by that client's
      // administrator. Otherwise an internal admin could accidentally create
      // an organization-wide client seat through the same endpoint.
      exactlyOne: clientInvitee,
    });

    const userSnap = await db.collection('users').where('email', '==', normalizedEmail).limit(1).get();
    if (!userSnap.empty) {
      const userId = userSnap.docs[0].id;
      const membershipId = `${organizationId}_${userId}`;
      const membershipRef = db.collection('orgMemberships').doc(membershipId);
      if ((await membershipRef.get()).exists) {
        return NextResponse.json({ error: 'User is already a member' }, { status: 409 });
      }
      const seatRefusal = await refuseWithoutSeat();
      if (seatRefusal) return seatRefusal;

      // Someone who used to be here comes back to their own seat, not to a
      // blank one: the same position, the same projects, and every task still
      // assigned to them. Creating a fresh membership instead would leave the
      // archive behind and quietly strand all of it.
      const reactivated = await reactivateMembership({
        organizationId,
        userId,
        role: safeRole,
        extraProjectIds: invitedProjectIds,
        restoreArchivedProjects: !clientInvitee,
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
      batch.set(db.collection('organizations').doc(organizationId)
        .collection('memberRates').doc(userId), {
        userId,
        hourlyRate: 0,
        updatedBy: authorization.user.uid,
        updatedAt: FieldValue.serverTimestamp(),
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
      // Місце в кімнаті видається разом із курсором прочитаного: інакше людина
      // відкриває чат уперше й бачить бейдж на всю історію, написану до неї.
      await seedChatReadState(db, organizationId, userId);
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
    const seatRefusal = await refuseWithoutSeat();
    if (seatRefusal) return seatRefusal;

    await db.collection('invitations').add({
      email: normalizedEmail,
      organizationId,
      invitedBy: authorization.user.uid,
      role: safeRole,
      projectIds: invitedProjectIds,
      scope: clientInvitee ? 'client-project' : 'organization',
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
      return NextResponse.json({ error: 'Оберіть один доступний клієнтський проєкт' }, { status: 400 });
    }
    return routeErrorResponse(error, { context: 'Invitation POST', fallbackMessage: 'Internal Server Error' });
  }
}
