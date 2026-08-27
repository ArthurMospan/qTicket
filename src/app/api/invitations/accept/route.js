import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authenticateRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { restoreProjectAccess } from '@/lib/server/orgMembership';
import { seedChatReadState } from '@/lib/server/chatReadState';
import { MEMBERSHIP_ARCHIVE } from '@/lib/utils/orgMembership.mjs';
import { countActiveMembers, organizationPlan } from '@/lib/server/planLimits';
import { planLimit } from '@/lib/utils/plans.mjs';
import { INVITABLE_ROLES, isClientRole } from '@/lib/utils/can';

export async function POST(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const { uid, email, email_verified: emailVerified } = authorization.user;
    if (!email || !emailVerified) {
      return NextResponse.json({ error: 'A verified email is required' }, { status: 403 });
    }

    const db = getAdminDb();
    const invitationsSnap = await db.collection('invitations')
      .where('email', '==', email)
      .where('status', '==', 'pending')
      .get();

    if (invitationsSnap.empty) return NextResponse.json({ accepted: 0, refusedSeats: 0 });

    const batch = db.batch();
    let accepted = 0;
    // Invitations this account holds that its workspace no longer has room
    // for. They stay pending rather than being consumed: the moment a seat is
    // freed or the plan goes back up, the same invitation still works.
    let refusedSeats = 0;
    const acceptedOrganizationIds = new Set();
    // Projects to hand back to someone who used to be here; restored after the
    // batch, because each id has to be read before it can be written to.
    const projectsToRestore = new Map();

    for (const invitationDoc of invitationsSnap.docs) {
      const invitation = invitationDoc.data();
      const organizationId = invitation.organizationId;
      if (!organizationId) continue;

      const organizationSnap = await db.collection('organizations').doc(organizationId).get();
      if (!organizationSnap.exists) continue;

      // The ceiling is asked here as well as where the invitation was sent.
      // Between the two, a workspace can change plan — and an invitation
      // written on Lite used to seat its holder on Free without a word.
      const membershipExists = (
        await db.collection('orgMemberships').doc(`${organizationId}_${uid}`).get()
      ).exists;
      if (!membershipExists
        && await countActiveMembers(db, organizationId) >= planLimit(organizationPlan(organizationSnap), 'members')) {
        refusedSeats += 1;
        continue;
      }

      // Projects the inviter scoped this invitation to. They are re-checked
      // here rather than trusted: a project can be deleted or moved between the
      // invitation being written and the invitee signing in.
      const invitedProjectIds = Array.isArray(invitation.projectIds)
        ? [...new Set(invitation.projectIds.filter(id => typeof id === 'string' && id.trim()))].slice(0, 20)
        : [];
      if (invitedProjectIds.length) {
        const projectSnaps = await db.getAll(
          ...invitedProjectIds.map(id => db.collection('projects').doc(id)),
        );
        projectSnaps
          .filter(snapshot => snapshot.exists && snapshot.data().organizationId === organizationId)
          .forEach(snapshot => {
            batch.update(snapshot.ref, {
              team: FieldValue.arrayUnion(uid),
              updatedAt: FieldValue.serverTimestamp(),
            });
          });
      }

      const membershipId = `${organizationId}_${uid}`;
      const clientScopedInvitation = invitation.scope === 'client-project';
      // A client administrator invited by the tenant must stay an administrator.
      // Invitations created by a client administrator already carry
      // `client_member`; the fallback keeps older scoped invitations safe.
      const role = clientScopedInvitation
        ? (isClientRole(invitation.role) ? invitation.role : 'client_member')
        : (INVITABLE_ROLES.includes(invitation.role) ? invitation.role : 'member');
      // A returning colleague consumes their archived seat instead of sitting
      // down beside it: two records for one person would put them in the
      // directory twice, once active and once deactivated.
      const archiveRef = db.collection(MEMBERSHIP_ARCHIVE).doc(membershipId);
      const archiveSnap = await archiveRef.get();
      if (archiveSnap.exists) {
        batch.delete(archiveRef);
        const archivedProjectIds = archiveSnap.data().projectIds;
        if (!clientScopedInvitation && Array.isArray(archivedProjectIds) && archivedProjectIds.length) {
          projectsToRestore.set(organizationId, archivedProjectIds);
        }
      }
      batch.set(db.collection('orgMemberships').doc(membershipId), {
        id: membershipId,
        orgId: organizationId,
        userId: uid,
        role,
        joinedAt: FieldValue.serverTimestamp(),
      }, { merge: false });
      batch.set(db.collection('organizations').doc(organizationId)
        .collection('memberRates').doc(uid), {
        userId: uid,
        hourlyRate: 0,
        updatedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      batch.update(invitationDoc.ref, {
        status: 'accepted',
        acceptedBy: uid,
        acceptedAt: FieldValue.serverTimestamp(),
      });
      acceptedOrganizationIds.add(organizationId);
      accepted += 1;
    }

    acceptedOrganizationIds.forEach(organizationId => {
      batch.update(db.collection('organizations').doc(organizationId), {
        memberDirectoryVersion: FieldValue.increment(1),
      });
    });
    if (accepted > 0) await batch.commit();
    for (const [organizationId, projectIds] of projectsToRestore) {
      await restoreProjectAccess({ organizationId, userId: uid, projectIds });
    }
    // Місце в кімнаті видається разом із курсором прочитаного: без нього
    // новачок отримує бейдж на всю історію каналу, написану до його приходу.
    for (const organizationId of acceptedOrganizationIds) {
      await seedChatReadState(db, organizationId, uid);
    }
    return NextResponse.json({ accepted, refusedSeats });
  } catch (error) {
    return routeErrorResponse(error, { context: 'Invitation Accept', fallbackMessage: 'Internal Server Error' });
  }
}
