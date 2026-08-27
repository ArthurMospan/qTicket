import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { analyticsRollupDeltasFor } from '@/lib/server/analyticsRollups';
import {
  applyTaskTimeLogMutation,
  authorizeTaskTimeLogRequest,
  readLiveTaskTimeLogContext,
  readMutableTaskTimeLog,
  readTaskTimeLogJson,
  taskTimeLogError,
  taskTimeLogErrorResponse,
} from '@/lib/server/taskTimeLogs';
import {
  cleanTaskTimeLogId,
  exactTaskTimeLogMinutes,
  parseTaskTimeLogDescription,
} from '@/lib/utils/taskTimeLog.mjs';

function requestScope(body) {
  const organizationId = cleanTaskTimeLogId(body.organizationId);
  const projectId = cleanTaskTimeLogId(body.projectId);
  if (!organizationId || !projectId) {
    throw taskTimeLogError(
      'TASK_TIME_INVALID_SCOPE',
      400,
      'Потрібні коректні організація та проєкт',
    );
  }
  return { organizationId, projectId };
}

function routeIds(params) {
  const issueId = cleanTaskTimeLogId(params.issueId);
  const logId = cleanTaskTimeLogId(params.logId);
  if (!issueId || !logId) {
    throw taskTimeLogError(
      'TASK_TIME_INVALID_ID',
      400,
      'Некоректне завдання або запис часу',
    );
  }
  return { issueId, logId };
}

export async function PATCH(request, context) {
  try {
    const params = await context.params;
    const { issueId, logId } = routeIds(params);
    const body = await readTaskTimeLogJson(request);
    const { organizationId, projectId } = requestScope(body);
    const changesMinutes = Object.hasOwn(body, 'spentMinutes');
    const changesDescription = Object.hasOwn(body, 'description');
    const spentMinutes = changesMinutes
      ? exactTaskTimeLogMinutes(body.spentMinutes)
      : null;
    const description = changesDescription
      ? parseTaskTimeLogDescription(body.description)
      : { ok: true, value: '' };
    if (
      (!changesMinutes && !changesDescription)
      || (changesMinutes && spentMinutes === null)
      || !description.ok
    ) {
      throw taskTimeLogError(
        'TASK_TIME_INVALID_UPDATE',
        400,
        'Вкажіть коректний час або опис для зміни',
      );
    }

    const authorization = await authorizeTaskTimeLogRequest(request, organizationId);
    if (!(await enforceRateLimit(
      'task-time-log-update',
      authorization.user.uid,
      120,
      60,
    ))) {
      throw taskTimeLogError(
        'TASK_TIME_UPDATE_RATE_LIMIT',
        429,
        'Забагато змін записів часу за короткий проміжок',
      );
    }
    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const logRef = db.collection('timeLogs').doc(logId);
    const rollupDeltas = await analyticsRollupDeltasFor(db, organizationId);
    await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention, and the accumulator lives
      // outside it: without the reset a retry moves the day's total twice.
      rollupDeltas.reset();
      const {
        initializeSpentMinutesMirror,
        issue,
        membership,
        projectRef,
      } = await readLiveTaskTimeLogContext({
        transaction,
        db,
        issueRef,
        issueId,
        organizationId,
        projectId,
        authorization,
      });
      const logSnapshot = await transaction.get(logRef);
      const log = readMutableTaskTimeLog({
        snapshot: logSnapshot,
        issueId,
        organizationId,
        projectId,
        authorization,
        membership,
      });
      const nextMinutes = changesMinutes ? spentMinutes : log.spentMinutes;
      transaction.update(logRef, {
        ...(changesMinutes ? { spentMinutes: nextMinutes } : {}),
        ...(changesDescription ? { description: description.value } : {}),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: authorization.user.uid,
      });
      // The old record out, the new record in — a difference, never an
      // increment of the new figure. Thirty minutes corrected to forty-five is
      // +15 to the day, and the day that used to say seventy-five after two
      // such edits is exactly the bug this shape prevents. The date is not
      // editable, so both sides land on the same day; writing it as two
      // opposite contributions rather than one arithmetic delta keeps that a
      // property of the data instead of an assumption in the caller.
      const cancelled = Boolean(issue.cancelledAt);
      rollupDeltas.add(log, -1, { cancelled });
      rollupDeltas.add({ ...log, spentMinutes: nextMinutes }, 1, { cancelled });
      applyTaskTimeLogMutation({
        transaction,
        db,
        issueRef,
        issue,
        projectRef,
        spentMinutesDelta: nextMinutes - log.spentMinutes,
        rollupDeltas,
        initializeSpentMinutesMirror,
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.taskTimeLog) return taskTimeLogErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'task time log PATCH',
      fallbackMessage: 'Не вдалося змінити зафіксований час',
    });
  }
}

export async function DELETE(request, context) {
  try {
    const params = await context.params;
    const { issueId, logId } = routeIds(params);
    const url = new URL(request.url);
    const { organizationId, projectId } = requestScope({
      organizationId: url.searchParams.get('organizationId'),
      projectId: url.searchParams.get('projectId'),
    });
    const authorization = await authorizeTaskTimeLogRequest(request, organizationId);
    if (!(await enforceRateLimit(
      'task-time-log-delete',
      authorization.user.uid,
      120,
      60,
    ))) {
      throw taskTimeLogError(
        'TASK_TIME_DELETE_RATE_LIMIT',
        429,
        'Забагато видалень записів часу за короткий проміжок',
      );
    }
    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const logRef = db.collection('timeLogs').doc(logId);
    const rollupDeltas = await analyticsRollupDeltasFor(db, organizationId);
    await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention, and the accumulator lives
      // outside it: without the reset a retry moves the day's total twice.
      rollupDeltas.reset();
      const {
        initializeSpentMinutesMirror,
        issue,
        membership,
        projectRef,
      } = await readLiveTaskTimeLogContext({
        transaction,
        db,
        issueRef,
        issueId,
        organizationId,
        projectId,
        authorization,
      });
      const logSnapshot = await transaction.get(logRef);
      const log = readMutableTaskTimeLog({
        snapshot: logSnapshot,
        issueId,
        organizationId,
        projectId,
        authorization,
        membership,
      });
      transaction.delete(logRef);
      rollupDeltas.add(log, -1, { cancelled: Boolean(issue.cancelledAt) });
      applyTaskTimeLogMutation({
        transaction,
        db,
        issueRef,
        issue,
        projectRef,
        spentMinutesDelta: -log.spentMinutes,
        rollupDeltas,
        initializeSpentMinutesMirror,
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.taskTimeLog) return taskTimeLogErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'task time log DELETE',
      fallbackMessage: 'Не вдалося видалити зафіксований час',
    });
  }
}
