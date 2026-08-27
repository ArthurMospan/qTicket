import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { hasProjectAccess } from '@/lib/utils/projectAccess.mjs';
import {
  canRestoreIssueTombstone,
  issueTombstoneId,
} from '@/lib/utils/issueTrash.mjs';

function restoreError(code, status, message) {
  const error = new Error(code);
  error.restoreApi = { code, status, message };
  return error;
}

export async function POST(request, context) {
  try {
    const { issueId } = await context.params;
    const body = await readJsonBody(request);
    const organizationId = typeof body.organizationId === 'string'
      ? body.organizationId.trim().slice(0, 200)
      : '';
    // Whoever may delete a task may undo it. Restricting the undo to admins
    // made the trash a one-way door for the person who opened it by mistake.
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin', 'member']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const db = getAdminDb();
    const tombstoneRef = db.collection('deletedIssues').doc(
      issueTombstoneId(organizationId, issueId),
    );
    const initialTombstone = await tombstoneRef.get();
    if (!initialTombstone.exists) {
      return NextResponse.json({ error: 'Задачу не знайдено серед нещодавно видалених', code: 'TOMBSTONE_NOT_FOUND' }, { status: 404 });
    }
    const initial = initialTombstone.data();
    if (
      initial.organizationId !== organizationId
      || initial.issueId !== issueId
      || initial.issue?.organizationId !== organizationId
      || initial.issue?.id !== issueId
    ) {
      return NextResponse.json({ error: 'Пошкоджений запис видаленої задачі', code: 'INVALID_TOMBSTONE_SCOPE' }, { status: 409 });
    }

    const countDeltas = await projectIssueCountDeltasFor(db, organizationId);
    const result = await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; the counter accumulator
      // lives outside it and would otherwise restore the same task once per
      // attempt.
      countDeltas.reset();
      const tombstoneSnap = await transaction.get(tombstoneRef);
      if (!tombstoneSnap.exists) {
        throw restoreError('TOMBSTONE_NOT_FOUND', 404, 'Задачу не знайдено серед нещодавно видалених');
      }
      const tombstone = tombstoneSnap.data();
      if (!canRestoreIssueTombstone(tombstone)) {
        throw restoreError('UNDO_EXPIRED', 409, 'Час для скасування видалення минув');
      }
      const issue = tombstone.issue;
      if (
        tombstone.organizationId !== organizationId
        || tombstone.issueId !== issueId
        || issue.organizationId !== organizationId
        || issue.id !== issueId
      ) {
        throw restoreError('INVALID_TOMBSTONE_SCOPE', 409, 'Пошкоджений запис видаленої задачі');
      }

      const issueRef = db.collection('issues').doc(issueId);
      const projectRef = db.collection('projects').doc(issue.projectId);
      const liveIssue = await transaction.get(issueRef);
      const project = await transaction.get(projectRef);
      if (liveIssue.exists) {
        throw restoreError('ISSUE_ALREADY_EXISTS', 409, 'Задачу вже відновлено');
      }
      if (
        !project.exists
        || project.data().organizationId !== organizationId
        || project.data().deletionPending === true
      ) {
        throw restoreError('PROJECT_NOT_AVAILABLE', 409, 'Проєкт задачі більше недоступний');
      }
      if (!hasProjectAccess(project.data(), authorization.membership?.role, authorization.user.uid)) {
        throw restoreError('PROJECT_FORBIDDEN', 403, 'Ви не входите до команди цього проєкту');
      }

      const now = FieldValue.serverTimestamp();
      const restoredIssue = { ...issue };
      delete restoredIssue.id;
      transaction.create(issueRef, {
        ...restoredIssue,
        deletionPending: false,
        updatedAt: now,
        lastActivityType: 'restored',
        lastActivityAt: now,
        lastActivityActorId: authorization.user.uid,
        lastActivityActorName: authorization.user.name || authorization.user.email || '',
        lastActivityActorAvatar: authorization.user.picture || null,
      });
      transaction.delete(tombstoneRef);
      // Back in the project exactly as it left, so it contributes exactly what
      // it contributed before — including a deadline that may have slipped
      // while it was in the trash. The restored shape is what is counted, not
      // the one that was deleted.
      countDeltas
        .observeProject(issue.projectId, project.data())
        .change(null, { ...issue, id: issueId, deletionPending: false });
      transaction.update(projectRef, {
        issueHierarchyVersion: FieldValue.increment(1),
        ...projectIssueCountIncrements(countDeltas, issue.projectId),
        updatedAt: now,
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: 'restored',
        from: 'deleted',
        to: issue.issueKey || issueId,
        createdAt: now,
      });
      return { projectId: issue.projectId };
    });

    // Closing a task takes its deadline reminder off the queue; reopening one
    // puts it back. Written now rather than found by a scan later — see
    // src/lib/server/notificationOutbox.js.
    await syncIssueReminderRows({ issueId })
      .catch(error => console.warn('[issues] reminder rows failed:', error.message));
    return NextResponse.json({ success: true, issueId, projectId: result.projectId });
  } catch (error) {
    if (error?.restoreApi) {
      return NextResponse.json({
        error: error.restoreApi.message,
        code: error.restoreApi.code,
      }, { status: error.restoreApi.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue restore',
      fallbackMessage: 'Не вдалося відновити задачу',
    });
  }
}
