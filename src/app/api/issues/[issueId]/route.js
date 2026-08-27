import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import { projectWriteError } from '@/lib/utils/projectAccess.mjs';
import {
  billedTimeLogDetails,
  isBilledTimeLog,
} from '@/lib/utils/issueDeletion.mjs';
import { invoiceSourcelessReservationId } from '@/lib/server/invoicePayload.mjs';
import {
  issueTombstoneId,
  issueUndoExpiresAt,
} from '@/lib/utils/issueTrash.mjs';

const MAX_TRANSACTIONAL_CHILD_PROMOTION = 400;

function apiTransactionError(code, status, message, details = {}) {
  const error = new Error(code);
  error.api = { code, status, message, ...details };
  return error;
}

export async function DELETE(request, context) {
  try {
    const { issueId } = await context.params;
    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      return NextResponse.json({
        error: 'Завдання не знайдено',
        code: 'ISSUE_NOT_FOUND',
      }, { status: 404 });
    }

    const issue = issueSnap.data();
    // Deleting is a project right, not an organization right: a member reaches
    // the tasks of the projects they belong to and no others. The role check
    // below only says the role may delete at all — `projectWriteError` inside
    // the transaction decides whether it may delete *this* one, against the
    // project document the transaction itself read.
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      ['owner', 'admin', 'member'],
    );
    if (authorization.error) {
      return NextResponse.json({
        error: localizedIssueAuthorizationMessage(authorization.error),
      }, { status: authorization.status });
    }

    const childPolicy = new URL(request.url).searchParams.get('childPolicy') || 'block';
    if (!['block', 'promote'].includes(childPolicy)) {
      return NextResponse.json({
        error: 'Некоректна політика для підзавдань',
        code: 'INVALID_CHILD_POLICY',
      }, { status: 400 });
    }

    const projectRef = db.collection('projects').doc(issue.projectId);
    const deletedAtMs = Date.now();
    const undoExpiresAtMs = issueUndoExpiresAt(deletedAtMs);
    const tombstoneRef = db.collection('deletedIssues').doc(
      issueTombstoneId(issue.organizationId, issueId),
    );
    const estimateReservationRef = db.collection('invoiceEstimateReservations').doc(
      invoiceSourcelessReservationId(
        issue.organizationId,
        issue.projectId,
        issueId,
      ),
    );
    const countDeltas = await projectIssueCountDeltasFor(db, issue.organizationId);
    const deletion = await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; the counter accumulator
      // lives outside it and would otherwise remove the same task once per
      // attempt.
      countDeltas.reset();
      const currentSnap = await transaction.get(issueRef);
      const projectSnap = await transaction.get(projectRef);
      const estimateReservationSnap = await transaction.get(estimateReservationRef);
      const tombstoneSnap = await transaction.get(tombstoneRef);
      if (!currentSnap.exists) {
        throw apiTransactionError(
          'ISSUE_NOT_FOUND',
          404,
          'Завдання не знайдено',
        );
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== issue.organizationId
        || current.projectId !== issue.projectId
      ) {
        throw apiTransactionError(
          'ISSUE_SCOPE_CHANGED',
          409,
          'Область завдання змінилася. Оновіть сторінку',
        );
      }
      if (
        !projectSnap.exists
        || projectSnap.data().organizationId !== current.organizationId
      ) {
        throw apiTransactionError(
          'PROJECT_NOT_FOUND',
          404,
          'Проєкт завдання не знайдено',
        );
      }
      const projectAccessError = projectWriteError(
        { ...projectSnap.data(), id: projectSnap.id },
        current.organizationId,
        authorization.membership?.role,
        authorization.user.uid,
      );
      if (projectAccessError) {
        throw apiTransactionError(
          'PROJECT_FORBIDDEN',
          projectAccessError === 'Ви не входите до команди цього проєкту' ? 403 : 409,
          projectAccessError,
        );
      }
      if (estimateReservationSnap.exists) {
        const reservation = estimateReservationSnap.data();
        throw apiTransactionError(
          'ISSUE_HAS_INVOICE_ESTIMATE',
          409,
          'Завдання вже входить у рахунок як оцінка і не може бути видалене',
          {
            invoiceIds: reservation.invoiceId ? [reservation.invoiceId] : [],
            estimateReservationId: estimateReservationSnap.id,
          },
        );
      }
      if (tombstoneSnap.exists) {
        throw apiTransactionError(
          'ISSUE_ALREADY_DELETED',
          409,
          'Задачу вже видалено',
        );
      }

      const timeLogs = await transaction.get(
        db.collection('timeLogs').where('issueId', '==', issueId),
      );
      const billedLogs = timeLogs.docs
        .filter(document => {
          const data = document.data();
          return data.organizationId === current.organizationId
            && data.projectId === current.projectId
            && isBilledTimeLog(data);
        })
        .map(document => ({ ...document.data(), id: document.id }));
      if (billedLogs.length > 0) {
        const details = billedTimeLogDetails(billedLogs);
        throw apiTransactionError(
          'ISSUE_HAS_BILLED_TIME',
          409,
          'Завдання має зафіксований у рахунок час і не може бути видалене',
          {
            billedTimeLogCount: billedLogs.length,
            ...details,
          },
        );
      }

      const canonicalChildren = await transaction.get(
        db.collection('issues').where('parentIssueId', '==', issueId),
      );
      const legacyChildren = await transaction.get(
        db.collection('issues').where('parentEpicId', '==', issueId),
      );
      const children = [...new Map(
        [...canonicalChildren.docs, ...legacyChildren.docs]
          .filter(child => {
            const data = child.data();
            return data.organizationId === current.organizationId
              && data.projectId === current.projectId;
          })
          .map(child => [child.id, child]),
      ).values()];

      if (children.length > 0 && childPolicy === 'block') {
        throw apiTransactionError(
          'ISSUE_HAS_CHILDREN',
          409,
          'Завдання має підзавдання. Підтвердьте їх перенесення на верхній рівень',
          { childCount: children.length, allowedChildPolicy: 'promote' },
        );
      }
      if (children.length > MAX_TRANSACTIONAL_CHILD_PROMOTION) {
        throw apiTransactionError(
          'TOO_MANY_CHILDREN_TO_PROMOTE',
          409,
          'Забагато підзавдань для безпечного автоматичного перенесення',
          {
            childCount: children.length,
            maxTransactionalPromotion: MAX_TRANSACTIONAL_CHILD_PROMOTION,
          },
        );
      }

      const now = FieldValue.serverTimestamp();
      transaction.create(tombstoneRef, {
        schemaVersion: 1,
        issueId,
        organizationId: current.organizationId,
        projectId: current.projectId,
        issue: { ...current, id: issueId },
        childPolicy,
        childCount: children.length,
        deletedBy: authorization.user.uid,
        deletedAt: now,
        purgeAfter: Timestamp.fromMillis(undoExpiresAtMs),
      });
      // The task is gone from the project, so it is gone from its counters. The
      // promoted children stay in the same project with the same statuses, so
      // they contribute exactly what they contributed before — only their
      // parent moved.
      countDeltas
        .observeProject(current.projectId, projectSnap.data())
        .change({ ...current, id: issueId }, null);
      transaction.delete(issueRef);
      transaction.update(projectRef, {
        issueHierarchyVersion: FieldValue.increment(1),
        ...projectIssueCountIncrements(countDeltas, current.projectId),
        updatedAt: now,
      });
      return { childCount: children.length };
    });

    // The task is gone, so nothing wants its reminders. `issue: null` says so
    // without a read: the row is cancelled rather than left to fire about a
    // deadline on a task nobody can open.
    await syncIssueReminderRows({ issueId, issue: null })
      .catch(error => console.warn('[issues DELETE] reminder rows failed:', error.message));

    return NextResponse.json({
      success: true,
      softDeleted: true,
      issueId,
      organizationId: issue.organizationId,
      projectId: issue.projectId,
      childCount: deletion.childCount,
      undoExpiresAtMs,
    });
  } catch (error) {
    if (error?.api) {
      return NextResponse.json({
        error: error.api.message,
        code: error.api.code,
        ...Object.fromEntries(
          Object.entries(error.api)
            .filter(([key]) => !['message', 'code', 'status'].includes(key)),
        ),
      }, { status: error.api.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue DELETE',
      fallbackMessage: 'Не вдалося видалити завдання',
    });
  }
}
