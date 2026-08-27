import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  projectIssueCountDeltasFor,
  writeProjectIssueCountDeltas,
} from '@/lib/server/projectIssueCounts';
import { projectWriteError } from '@/lib/utils/projectAccess.mjs';
import { rolesFor } from '@/lib/utils/can';

// Archiving and un-archiving a task. Reversible, with no clock on it — the
// tombstone flow behind DELETE is the other thing, and the two are deliberately
// separate: see `src/lib/utils/issueArchive.mjs`.
//
// It is a server route rather than a client field write so that the history
// entry is written with it, and so `archivedAt` can be refused to browsers
// outright. An archive nobody can see the reason for is a task that vanished.

function archiveError(code, status, message) {
  const error = new Error(code);
  error.archiveApi = { code, status, message };
  return error;
}

export async function PATCH(request, context) {
  try {
    const { issueId } = await context.params;
    const body = await readJsonBody(request);
    if (typeof body?.archived !== 'boolean') {
      return NextResponse.json({
        error: 'Потрібно вказати, архівувати завдання чи повернути',
        code: 'INVALID_ARCHIVE_STATE',
      }, { status: 400 });
    }
    const archived = body.archived;

    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      return NextResponse.json({ error: 'Завдання не знайдено', code: 'ISSUE_NOT_FOUND' }, { status: 404 });
    }
    const issue = issueSnap.data();

    // Archiving is an edit, not a deletion: whoever may work in the project may
    // put a task aside and take it back out.
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      rolesFor('edit:issue'),
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const projectRef = db.collection('projects').doc(issue.projectId);
    const countDeltas = await projectIssueCountDeltasFor(db, issue.organizationId);
    const result = await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; the counter accumulator
      // lives outside it and would otherwise count the same task once per
      // attempt.
      countDeltas.reset();
      const [currentSnap, projectSnap] = await Promise.all([
        transaction.get(issueRef),
        transaction.get(projectRef),
      ]);
      if (!currentSnap.exists) {
        throw archiveError('ISSUE_NOT_FOUND', 404, 'Завдання не знайдено');
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== issue.organizationId
        || current.projectId !== issue.projectId
      ) {
        throw archiveError('ISSUE_SCOPE_CHANGED', 409, 'Область завдання змінилася. Оновіть сторінку');
      }
      if (current.deletionPending === true) {
        throw archiveError('ISSUE_DELETING', 409, 'Завдання вже видаляється');
      }
      const accessError = projectWriteError(
        projectSnap.exists ? { ...projectSnap.data(), id: projectSnap.id } : null,
        current.organizationId,
        authorization.membership?.role,
        authorization.user.uid,
      );
      if (accessError) {
        throw archiveError(
          'PROJECT_FORBIDDEN',
          accessError === 'Ви не входите до команди цього проєкту' ? 403 : 409,
          accessError,
        );
      }
      // Asking for the state a task is already in is not an error; it is what a
      // double click and a retried request both look like.
      if (Boolean(current.archivedAt) === archived) {
        return { changed: false, issueKey: current.issueKey || issueId };
      }

      // An archived task leaves the working set, so it leaves the project's
      // counters with it — the same three exclusions every board already makes.
      // Un-archiving puts it back, which is why this is a delta and not a
      // decrement: the same call with the two shapes the other way round.
      countDeltas
        .observeProject(current.projectId, projectSnap.data())
        .change(
          { ...current, id: issueId },
          { ...current, id: issueId, archivedAt: archived ? new Date() : null },
        );

      const now = FieldValue.serverTimestamp();
      transaction.update(issueRef, {
        archivedAt: archived ? now : FieldValue.delete(),
        archivedBy: archived ? authorization.user.uid : FieldValue.delete(),
        updatedAt: now,
        lastActivityType: archived ? 'archived' : 'unarchived',
        lastActivityAt: now,
        lastActivityActorId: authorization.user.uid,
        lastActivityActorName: authorization.user.name || authorization.user.email || '',
        lastActivityActorAvatar: authorization.user.picture || null,
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: archived ? 'archived' : 'unarchived',
        createdAt: now,
      });
      writeProjectIssueCountDeltas({ writer: transaction, db, deltas: countDeltas });
      return { changed: true, issueKey: current.issueKey || issueId };
    });


    // A deadline is knowable the moment it is written, so that is when its
    // reminders are written down. Fire and forget: the task change has already been
    // committed, and a queue row that failed to appear is restocked by the nightly
    // safety net rather than being allowed to fail the request that made it.
    await syncIssueReminderRows({ issueId })
      .catch(error => console.warn('[issues] reminder rows failed:', error.message));
    return NextResponse.json({ success: true, archived, ...result });
  } catch (error) {
    if (error?.archiveApi) {
      return NextResponse.json({
        error: error.archiveApi.message,
        code: error.archiveApi.code,
      }, { status: error.archiveApi.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue archive',
      fallbackMessage: 'Не вдалося змінити стан архіву завдання',
    });
  }
}
