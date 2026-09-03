import { NextResponse } from 'next/server';
import {
  authenticateRequest,
  authorizeOrgRequest,
  FieldValue,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { rolesFor } from '@/lib/utils/can';
import {
  MEMBERSHIP_ARCHIVE,
  MEMBERSHIP_COLLECTION,
  membershipId,
} from '@/lib/utils/orgMembership.mjs';
import { resolveProjectTeamRemoval } from '@/lib/server/projectTeamRemoval.mjs';

// One person off one client project — «Вилучити з проєкту» on the project's
// «Учасники» tab, and the only way a client seat is taken away.
//
// It is not the organization-level `DELETE …/members/[memberId]`, on purpose.
// That door archives a whole seat and strips every project at once, which is
// the right shape for a support seat leaving the tenant and the wrong one for
// a customer's colleague leaving one space: a client may hold several projects
// now, and taking away the one they were removed from must leave the others
// alone. When it *was* their last project the seat is archived here too, the
// same way and in the same place, so a new invitation restores it.
//
// Every limit — who may remove whom, from where — is `resolveProjectTeamRemoval`,
// decided before the transaction and covered by behaviour tests. What this
// file adds is the write, and what the write never touches: assignee lists,
// watcher lists and comments are the record of what happened.
export async function DELETE(request, context) {
  try {
    const { projectId, memberId } = await context.params;
    // The token before the record: the read below is how the route learns
    // which organization to authorize against.
    const identity = await authenticateRequest(request);
    if (identity.error) {
      return NextResponse.json({ error: identity.error }, { status: identity.status });
    }
    const db = getAdminDb();
    const projectRef = db.collection('projects').doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) {
      return NextResponse.json({ error: 'Проєкт не знайдено' }, { status: 404 });
    }
    const project = { ...projectSnap.data(), id: projectSnap.id };

    const authorization = await authorizeOrgRequest(
      request,
      project.organizationId,
      rolesFor('remove:client_member'),
      { identity },
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const decision = await resolveProjectTeamRemoval(db, {
      project,
      organizationId: project.organizationId,
      actorUid: authorization.user.uid,
      actorRole: authorization.membership?.role,
      memberId,
    });

    const seatId = membershipId(project.organizationId, memberId);
    const membershipRef = db.collection(MEMBERSHIP_COLLECTION).doc(seatId);
    const archiveRef = db.collection(MEMBERSHIP_ARCHIVE).doc(seatId);
    const orgRef = db.collection('organizations').doc(project.organizationId);

    await db.runTransaction(async transaction => {
      // Reads first — a Firestore transaction refuses a read after a write.
      const current = decision.archiveSeat ? await transaction.get(membershipRef) : null;
      transaction.update(projectRef, {
        team: FieldValue.arrayRemove(memberId),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (!current?.exists) return;
      const membership = current.data();
      // The same archive record the organization-level removal writes, so
      // reactivation and a fresh invitation read one shape.
      transaction.set(archiveRef, {
        id: seatId,
        orgId: project.organizationId,
        userId: memberId,
        role: membership.role,
        positionId: membership.positionId || '',
        joinedAt: membership.joinedAt || null,
        invitedBy: membership.invitedBy || null,
        projectIds: [project.id],
        reason: 'removed',
        deactivatedBy: authorization.user.uid,
        deactivatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(membershipRef);
      transaction.update(orgRef, {
        memberDirectoryVersion: FieldValue.increment(1),
      });
    });

    return NextResponse.json({
      success: true,
      removed: true,
      role: decision.role,
      seatArchived: decision.archiveSeat,
      remainingProjectCount: decision.remainingProjectIds.length,
    });
  } catch (error) {
    if (error?.projectTeamRemoval) {
      return NextResponse.json(
        { error: error.projectTeamRemoval.message },
        { status: error.projectTeamRemoval.status },
      );
    }
    return routeErrorResponse(error, {
      context: 'project-team-remove',
      fallbackMessage: 'Не вдалося вилучити з проєкту',
    });
  }
}
