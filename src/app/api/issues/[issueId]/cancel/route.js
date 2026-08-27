import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  analyticsRollupDeltasFor,
  writeAnalyticsRollupDeltas,
} from '@/lib/server/analyticsRollups';
import {
  projectIssueCountDeltasFor,
  writeProjectIssueCountDeltas,
} from '@/lib/server/projectIssueCounts';
import { projectWriteError } from '@/lib/utils/projectAccess.mjs';
import { rolesFor } from '@/lib/utils/can';
import {
  billedTimeLogDetails,
  isBilledTimeLog,
} from '@/lib/utils/issueDeletion.mjs';
import { invoiceSourcelessReservationId } from '@/lib/server/invoicePayload.mjs';

// Cancelling and un-cancelling a task. Reversible, with no clock on it, and
// distinct from both of its neighbours: see `src/lib/utils/issueCancel.mjs` for
// what each of the three actually means.
//
// A server route rather than a client field write, for the same two reasons the
// archive is one: the history entry is written with it, and `cancelledAt` can
// then be refused to browsers outright. This field decides whether a task is in
// the numbers at all, so it is the last one that should be writable from a
// console.

function cancelError(code, status, message, details = {}) {
  const error = new Error(code);
  error.cancelApi = { code, status, message, ...details };
  return error;
}

export async function PATCH(request, context) {
  try {
    const { issueId } = await context.params;
    const body = await readJsonBody(request);
    if (typeof body?.cancelled !== 'boolean') {
      return NextResponse.json({
        error: 'Потрібно вказати, скасувати завдання чи повернути',
        code: 'INVALID_CANCEL_STATE',
      }, { status: 400 });
    }
    const cancelled = body.cancelled;

    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      return NextResponse.json({ error: 'Завдання не знайдено', code: 'ISSUE_NOT_FOUND' }, { status: 404 });
    }
    const issue = issueSnap.data();

    // Cancelling is an edit, like archiving: whoever may work in the project may
    // decide a task is not going to happen, and may change their mind.
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      rolesFor('edit:issue'),
    );
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const projectRef = db.collection('projects').doc(issue.projectId);
    const estimateReservationRef = db.collection('invoiceEstimateReservations').doc(
      invoiceSourcelessReservationId(issue.organizationId, issue.projectId, issueId),
    );
    const rollupDeltas = await analyticsRollupDeltasFor(db, issue.organizationId);
    const countDeltas = await projectIssueCountDeltasFor(db, issue.organizationId);
    const result = await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; both accumulators live
      // outside it and would otherwise move their totals once per attempt.
      countDeltas.reset();
      rollupDeltas.reset();
      const [currentSnap, projectSnap, estimateReservationSnap] = await Promise.all([
        transaction.get(issueRef),
        transaction.get(projectRef),
        transaction.get(estimateReservationRef),
      ]);
      if (!currentSnap.exists) {
        throw cancelError('ISSUE_NOT_FOUND', 404, 'Завдання не знайдено');
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== issue.organizationId
        || current.projectId !== issue.projectId
      ) {
        throw cancelError('ISSUE_SCOPE_CHANGED', 409, 'Область завдання змінилася. Оновіть сторінку');
      }
      if (current.deletionPending === true) {
        throw cancelError('ISSUE_DELETING', 409, 'Завдання вже видаляється');
      }
      const accessError = projectWriteError(
        projectSnap.exists ? { ...projectSnap.data(), id: projectSnap.id } : null,
        current.organizationId,
        authorization.membership?.role,
        authorization.user.uid,
      );
      if (accessError) {
        throw cancelError(
          'PROJECT_FORBIDDEN',
          accessError === 'Ви не входите до команди цього проєкту' ? 403 : 409,
          accessError,
        );
      }
      // Asking for the state a task is already in is not an error; it is what a
      // double click and a retried request both look like.
      if (Boolean(current.cancelledAt) === cancelled) {
        return { changed: false, issueKey: current.issueKey || issueId };
      }

      // Cancelling and un-cancelling both move this task's hours across the
      // line between «logged» and «still counts», so both need the hours. The
      // read used to happen only on the way in, because only the billing guard
      // needed it.
      const timeLogs = await transaction.get(
        db.collection('timeLogs').where('issueId', '==', issueId),
      );
      const ownLogs = timeLogs.docs
        .map(document => ({ ...document.data(), id: document.id }))
        .filter(log => (
          log.organizationId === current.organizationId
          && log.projectId === current.projectId
        ));

      // The same two guards deletion has, and for a stronger reason. Deleting a
      // task with billed hours would remove the evidence behind an invoice;
      // cancelling one would leave the evidence in place and quietly stop
      // counting it, so a bill and the work behind it would stop agreeing
      // without anything on screen having changed. Whatever has already been
      // fixed into an invoice is settled: archive that task instead.
      if (cancelled) {
        if (estimateReservationSnap.exists) {
          const reservation = estimateReservationSnap.data();
          throw cancelError(
            'ISSUE_HAS_INVOICE_ESTIMATE',
            409,
            'Завдання вже входить у рахунок як оцінка. Його можна архівувати, але не скасувати',
            { invoiceIds: reservation.invoiceId ? [reservation.invoiceId] : [] },
          );
        }
        const billedLogs = ownLogs.filter(isBilledTimeLog);
        if (billedLogs.length > 0) {
          throw cancelError(
            'ISSUE_HAS_BILLED_TIME',
            409,
            'Завдання має зафіксований у рахунок час. Його можна архівувати, але не скасувати',
            {
              billedTimeLogCount: billedLogs.length,
              ...billedTimeLogDetails(billedLogs),
            },
          );
        }
      }

      // The daily totals keep «what was logged» and «what somebody has since
      // called off» as two figures, so this moves hours from one to the other
      // and back without ever rewriting what the day recorded. One write per
      // distinct day this task has hours on — which is a property of one task,
      // not of the workspace, and rides inside the same transaction as the flag
      // itself so the two can never disagree.
      for (const log of ownLogs) {
        rollupDeltas.addCancellation(log, cancelled ? 1 : -1);
      }

      // Work that is not going to happen is not one of the tasks the numbers
      // are about, so it leaves the project's counters as well. Un-cancelling
      // is the same call with the two shapes the other way round.
      countDeltas
        .observeProject(current.projectId, projectSnap.data())
        .change(
          { ...current, id: issueId },
          { ...current, id: issueId, cancelledAt: cancelled ? new Date() : null },
        );

      const now = FieldValue.serverTimestamp();
      transaction.update(issueRef, {
        cancelledAt: cancelled ? now : FieldValue.delete(),
        cancelledBy: cancelled ? authorization.user.uid : FieldValue.delete(),
        updatedAt: now,
        lastActivityType: cancelled ? 'cancelled' : 'uncancelled',
        lastActivityAt: now,
        lastActivityActorId: authorization.user.uid,
        lastActivityActorName: authorization.user.name || authorization.user.email || '',
        lastActivityActorAvatar: authorization.user.picture || null,
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: cancelled ? 'cancelled' : 'uncancelled',
        createdAt: now,
      });
      writeAnalyticsRollupDeltas({ writer: transaction, db, deltas: rollupDeltas });
      writeProjectIssueCountDeltas({ writer: transaction, db, deltas: countDeltas });
      return { changed: true, issueKey: current.issueKey || issueId };
    });


    // A deadline is knowable the moment it is written, so that is when its
    // reminders are written down. Fire and forget: the task change has already been
    // committed, and a queue row that failed to appear is restocked by the nightly
    // safety net rather than being allowed to fail the request that made it.
    await syncIssueReminderRows({ issueId })
      .catch(error => console.warn('[issues] reminder rows failed:', error.message));
    return NextResponse.json({ success: true, cancelled, ...result });
  } catch (error) {
    if (error?.cancelApi) {
      const { code, status, message, ...details } = error.cancelApi;
      return NextResponse.json({ error: message, code, ...details }, { status });
    }
    return routeErrorResponse(error, {
      context: 'Issue cancel',
      fallbackMessage: 'Не вдалося змінити стан скасування завдання',
    });
  }
}
