import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  FieldValue,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { can } from '@/lib/utils/can';
import { reactivateMembership } from '@/lib/server/orgMembership';
import {
  MEMBERSHIP_ARCHIVE,
  MEMBERSHIP_COLLECTION,
  membershipId,
} from '@/lib/utils/orgMembership.mjs';

function memberMutationError(code, status, message) {
  const error = new Error(code);
  error.memberMutation = { status, message };
  return error;
}

function validMemberId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && !value.includes('/')
    && !value.includes('\0');
}

async function authorizeManager(request, organizationId) {
  return authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
}

function errorResponse(error) {
  if (!error?.memberMutation) return null;
  return NextResponse.json(
    { error: error.memberMutation.message },
    { status: error.memberMutation.status },
  );
}

// What stays behind this person. The confirmation quotes these numbers, and
// after deactivation they are unchanged on purpose — that is the point of it.
async function issueImpact(db, organizationId, memberId) {
  const [assignedIssues, watchedIssues] = await Promise.all([
    db.collection('issues')
      .where('organizationId', '==', organizationId)
      .where('assigneeIds', 'array-contains', memberId)
      .get(),
    db.collection('issues')
      .where('organizationId', '==', organizationId)
      .where('watcherIds', 'array-contains', memberId)
      .get(),
  ]);
  return { assignedIssues, watchedIssues };
}

async function memberProjects(db, organizationId, memberId) {
  return db.collection('projects')
    .where('organizationId', '==', organizationId)
    .where('team', 'array-contains', memberId)
    .get();
}

export async function GET(request, context) {
  try {
    const { organizationId, memberId } = await context.params;
    if (!validMemberId(memberId)) {
      return NextResponse.json({ error: 'Invalid organization member' }, { status: 400 });
    }
    const authorization = await authorizeManager(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const db = getAdminDb();
    const membershipSnap = await db.collection('orgMemberships')
      .doc(`${organizationId}_${memberId}`)
      .get();
    if (!membershipSnap.exists) {
      return NextResponse.json({ error: 'Organization member not found' }, { status: 404 });
    }
    const [projects, impact] = await Promise.all([
      memberProjects(db, organizationId, memberId),
      issueImpact(db, organizationId, memberId),
    ]);
    return NextResponse.json({
      projectCount: projects.size,
      assignedIssueCount: impact.assignedIssues.size,
      watchedIssueCount: impact.watchedIssues.size,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'organization-member-impact',
      fallbackMessage: 'Failed to inspect organization member',
    });
  }
}

// Giving the seat back. The restore itself lives in `reactivateMembership`,
// because an invitation sent to someone who used to be here must land in the
// very same state — see that module.
async function reactivateMember(organizationId, memberId, authorization) {
  if (!can(authorization.membership?.role, 'deactivate:member')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const outcome = await reactivateMembership({
    organizationId,
    userId: memberId,
    actorId: authorization.user.uid,
  });
  if (!outcome.restored) {
    return outcome.reason === 'ALREADY_ACTIVE'
      ? NextResponse.json({ error: 'Ця людина вже має доступ' }, { status: 409 })
      : NextResponse.json({ error: 'Organization member not found' }, { status: 404 });
  }
  return NextResponse.json({
    success: true,
    role: outcome.role,
    projectCount: outcome.projectCount,
  });
}

export async function PATCH(request, context) {
  try {
    const { organizationId, memberId } = await context.params;
    if (!validMemberId(memberId)) {
      return NextResponse.json({ error: 'Invalid organization member' }, { status: 400 });
    }
    const authorization = await authorizeManager(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Invalid JSON body',
        code: 'INVALID_JSON',
      }, { status: 400 });
    }
    const action = body?.action;
    if (action === 'reactivate') {
      return reactivateMember(organizationId, memberId, authorization);
    }
    if (!['role', 'position', 'rate'].includes(action)) {
      return NextResponse.json({ error: 'Invalid member update' }, { status: 400 });
    }
    // An administrator may promote and demote between member and admin, as in
    // Linear, Asana and ClickUp. Owner-only promotion was bypassable anyway —
    // an admin could invite the same person straight in as an admin — so it
    // documented a restriction the product did not have. What stays owner-only
    // is the owner seat itself: the role of the owner cannot be edited here at
    // all, and the seat moves only through the ownership-transfer route.
    if (
      action === 'role'
      && (!['admin', 'member'].includes(body.role) || memberId === authorization.user.uid)
    ) {
      return NextResponse.json({ error: 'Invalid member role' }, { status: 400 });
    }
    const positionId = typeof body?.positionId === 'string' ? body.positionId.trim() : '';
    if (action === 'position' && (positionId.length > 120 || positionId.includes('/'))) {
      return NextResponse.json({ error: 'Invalid member position' }, { status: 400 });
    }
    const hourlyRate = Number(body?.hourlyRate);
    if (action === 'rate' && (!Number.isFinite(hourlyRate) || hourlyRate < 0 || hourlyRate > 1_000_000)) {
      return NextResponse.json({ error: 'Invalid hourly rate' }, { status: 400 });
    }

    const db = getAdminDb();
    const orgRef = db.collection('organizations').doc(organizationId);
    const membershipRef = db.collection('orgMemberships').doc(`${organizationId}_${memberId}`);
    const rateRef = orgRef.collection('memberRates').doc(memberId);
    await db.runTransaction(async transaction => {
      const membershipSnap = await transaction.get(membershipRef);
      if (!membershipSnap.exists) {
        throw memberMutationError('NOT_FOUND', 404, 'Organization member not found');
      }
      const membership = membershipSnap.data();
      if (membership.orgId !== organizationId || membership.userId !== memberId) {
        throw memberMutationError('FORBIDDEN', 403, 'Invalid organization member');
      }
      if (membership.removalPending === true) {
        throw memberMutationError('REMOVAL_PENDING', 409, 'This member is already being removed');
      }
      if (action === 'role' && membership.role === 'owner') {
        throw memberMutationError('OWNER_ROLE', 409, 'Transfer ownership before changing this role');
      }

      const now = FieldValue.serverTimestamp();
      if (action === 'role') transaction.update(membershipRef, { role: body.role, updatedAt: now });
      if (action === 'position') transaction.update(membershipRef, { positionId, updatedAt: now });
      if (action === 'rate') {
        transaction.set(rateRef, {
          userId: memberId,
          hourlyRate,
          updatedBy: authorization.user.uid,
          updatedAt: now,
        });
      }
      transaction.update(orgRef, {
        memberDirectoryVersion: FieldValue.increment(1),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    return routeErrorResponse(error, {
      context: 'organization-member-update',
      fallbackMessage: 'Failed to update organization member',
    });
  }
}

export async function DELETE(request, context) {
  try {
    const { organizationId, memberId } = await context.params;
    if (!validMemberId(memberId)) {
      return NextResponse.json({ error: 'Invalid organization member' }, { status: 400 });
    }
    // Two callers, one door: an administrator taking someone's access away, and
    // a person leaving on their own. Leaving needs no privilege — it is the
    // counterpart of «Видалення облікового запису», and a workspace nobody can
    // walk out of is not a workspace.
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const leavingSelf = memberId === authorization.user.uid;
    if (!leavingSelf && !can(authorization.membership?.role, 'deactivate:member')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const db = getAdminDb();
    const orgRef = db.collection('organizations').doc(organizationId);
    const membershipRef = db.collection(MEMBERSHIP_COLLECTION).doc(membershipId(organizationId, memberId));
    const archiveRef = db.collection(MEMBERSHIP_ARCHIVE).doc(membershipId(organizationId, memberId));

    // Access lives in two places and both have to be closed: the membership
    // document, which every rule reads, and `project.team`, which grants a
    // plain member their projects. Everything else this person touched —
    // authored comments, logged time, tasks assigned to them, tasks they watch —
    // is a record of what happened and is deliberately left untouched. That is
    // the whole difference between deactivating and deleting: removing them
    // from an assignee list would silently rewrite the history of the work.
    const projects = await memberProjects(db, organizationId, memberId);
    const projectIds = projects.docs.map(document => document.id);

    const archived = await db.runTransaction(async transaction => {
      const currentMembership = await transaction.get(membershipRef);
      if (!currentMembership.exists) {
        throw memberMutationError('NOT_FOUND', 404, 'Organization member not found');
      }
      const membership = currentMembership.data();
      if (membership.orgId !== organizationId || membership.userId !== memberId) {
        throw memberMutationError('FORBIDDEN', 403, 'Invalid organization member');
      }
      if (membership.role === 'owner') {
        throw memberMutationError(
          'OWNER_ROLE',
          409,
          leavingSelf
            ? 'Спершу передайте права власника — власник не може залишити організацію'
            : 'Transfer ownership before removing the owner',
        );
      }

      // The archive remembers what the seat was, so reactivating restores the
      // same role, position and project list rather than a guess at them.
      transaction.set(archiveRef, {
        id: membershipId(organizationId, memberId),
        orgId: organizationId,
        userId: memberId,
        role: membership.role,
        positionId: membership.positionId || '',
        joinedAt: membership.joinedAt || null,
        invitedBy: membership.invitedBy || null,
        projectIds,
        reason: leavingSelf ? 'left' : 'removed',
        deactivatedBy: authorization.user.uid,
        deactivatedAt: FieldValue.serverTimestamp(),
      });
      transaction.delete(membershipRef);
      transaction.update(orgRef, {
        memberDirectoryVersion: FieldValue.increment(1),
      });
      return { role: membership.role };
    });

    // Outside the transaction: an organization may hold more projects than one
    // transaction is allowed to touch. The membership is already gone, so the
    // person has no access while this runs — a project left in the list would
    // grant nothing on its own.
    if (projects.size > 0) {
      const writer = db.bulkWriter();
      for (const project of projects.docs) {
        writer.update(project.ref, {
          team: FieldValue.arrayRemove(memberId),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      await writer.close();
    }

    const impact = await issueImpact(db, organizationId, memberId);
    return NextResponse.json({
      success: true,
      deactivated: true,
      role: archived.role,
      projectCount: projects.size,
      assignedIssueCount: impact.assignedIssues.size,
      watchedIssueCount: impact.watchedIssues.size,
    });
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    return routeErrorResponse(error, {
      context: 'organization-member-remove',
      fallbackMessage: 'Failed to remove organization member',
    });
  }
}
