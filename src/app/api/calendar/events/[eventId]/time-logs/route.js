import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  analyticsRollupDeltasFor,
  writeAnalyticsRollupDeltas,
} from '@/lib/server/analyticsRollups';
import {
  canAccessCalendarEventProject,
  canViewCalendarEvent,
} from '@/lib/server/calendarEvents';
import {
  isCalendarEventOccurrence,
  isCanonicalCalendarOccurrence,
} from '@/lib/utils/calendarTimeLog.mjs';
import { calendarEventSupportsTracking } from '@/lib/utils/calendarEventTypes.mjs';
import {
  cleanTimerSessionId,
  requireMatchingPendingTimer,
  timerLogDocumentId,
  timerStateErrorResponse,
  timerStateRef,
} from '@/lib/server/userTimerState';

const MAX_MINUTES = 525_600;

function calendarTimeError(code, status, message, details = {}) {
  const error = new Error(code);
  error.calendarTimeLog = { code, status, message, ...details };
  return error;
}

function expectedErrorResponse(error) {
  const { message, status, ...payload } = error.calendarTimeLog;
  return NextResponse.json({ error: message, ...payload }, { status });
}

function cleanId(value, maxLength = 256) {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.trim().length <= maxLength
    && !value.includes('/')
    && !value.includes('\0')
    ? value.trim()
    : '';
}

function cleanDescription(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2_000) : '';
}

function exactMinutes(value) {
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes > 0 && minutes <= MAX_MINUTES
    ? minutes
    : null;
}

function timestampIso(value) {
  if (!value) return null;
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function serializeTimeLog(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    loggedAt: timestampIso(data.loggedAt),
    createdAt: timestampIso(data.createdAt),
    updatedAt: timestampIso(data.updatedAt),
    billedAt: timestampIso(data.billedAt),
  };
}

async function authorizeCalendarTimeRequest(request, organizationId) {
  if (!organizationId) {
    return {
      response: NextResponse.json({
        error: 'Не вказано організацію',
        code: 'CALENDAR_TIME_ORGANIZATION_REQUIRED',
      }, { status: 400 }),
    };
  }
  const authorization = await authorizeOrgRequest(
    request,
    organizationId,
    ['owner', 'admin', 'member'],
  );
  if (authorization.error) {
    return {
      response: NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      ),
    };
  }
  return { authorization };
}

function validateOccurrence(occurrenceStartAt) {
  if (!isCanonicalCalendarOccurrence(occurrenceStartAt)) {
    throw calendarTimeError(
      'CALENDAR_TIME_OCCURRENCE_INVALID',
      400,
      'Повтор події має бути в канонічному ISO-форматі',
    );
  }
}

async function readLiveEventContext({
  transaction,
  db,
  eventRef,
  organizationId,
  occurrenceStartAt,
  authorization,
  expectedProjectId,
}) {
  const eventSnapshot = await transaction.get(eventRef);
  if (
    !eventSnapshot.exists
    || eventSnapshot.data().organizationId !== organizationId
  ) {
    throw calendarTimeError(
      'CALENDAR_EVENT_NOT_FOUND',
      404,
      'Подію не знайдено',
    );
  }

  const event = eventSnapshot.data();
  if (
    typeof expectedProjectId === 'string'
    && expectedProjectId !== (event.projectId || '')
  ) {
    throw calendarTimeError(
      'CALENDAR_EVENT_PROJECT_CHANGED',
      409,
      'Проєкт події змінився. Оновіть подію перед фіксацією часу',
    );
  }
  if (!canViewCalendarEvent(event, authorization)) {
    throw calendarTimeError(
      'CALENDAR_EVENT_FORBIDDEN',
      403,
      'У вас немає доступу до цієї події',
    );
  }
  // Two independent gates. Visibility keeps a restricted event's hours out of
  // team analytics; the type table decides whether hours are a meaningful thing
  // to record against this kind of entry at all — you do not spend time "in" a
  // release, an absence or a note.
  const typeAllowsTracking = calendarEventSupportsTracking(event.type);
  const canTrackTime = event.visibility === 'team' && typeAllowsTracking;
  const trackingDisabledReason = canTrackTime
    ? null
    : typeAllowsTracking ? 'visibility' : 'type';
  if (!isCalendarEventOccurrence(event, occurrenceStartAt)) {
    throw calendarTimeError(
      'CALENDAR_TIME_OCCURRENCE_MISMATCH',
      409,
      'Ця дата не є повтором поточної події',
    );
  }

  let projectRef = null;
  let project = null;
  if (event.projectId) {
    projectRef = db.collection('projects').doc(event.projectId);
    const projectSnapshot = await transaction.get(projectRef);
    project = projectSnapshot.exists ? projectSnapshot.data() : null;
    if (
      !project
      || project.organizationId !== organizationId
      || project.deletionPending === true
      || project.status === 'archived'
    ) {
      throw calendarTimeError(
        'CALENDAR_EVENT_PROJECT_UNAVAILABLE',
        409,
        'Проєкт події видалено, архівовано або він більше недоступний',
      );
    }
    if (!canAccessCalendarEventProject(event, project, authorization)) {
      throw calendarTimeError(
        'CALENDAR_EVENT_PROJECT_FORBIDDEN',
        403,
        'Списувати час можуть лише учасники команди цього проєкту',
      );
    }
  }

  return {
    event,
    eventSnapshot,
    project,
    projectRef,
    canTrackTime,
    trackingDisabledReason,
  };
}

function validateLogIdentity({
  snapshot,
  eventId,
  event,
  organizationId,
  occurrenceStartAt,
}) {
  const log = snapshot.exists ? snapshot.data() : null;
  if (
    !log
    || log.organizationId !== organizationId
    || log.projectId !== (event.projectId || '')
    || log.issueId !== ''
    || log.sourceType !== 'calendar_event'
    || log.eventId !== eventId
    || log.occurrenceStartAt !== occurrenceStartAt
  ) {
    throw calendarTimeError(
      'CALENDAR_TIME_LOG_NOT_FOUND',
      404,
      'Запис часу не знайдено для цієї події',
    );
  }
  return log;
}

function ensureLogIsMutable(log) {
  if (
    (typeof log.invoiceId === 'string' && log.invoiceId.trim())
    || log.billedAt
  ) {
    throw calendarTimeError(
      'CALENDAR_TIME_LOG_BILLED',
      409,
      'Цей запис часу вже входить у рахунок і є незмінним',
    );
  }
}

function incrementMutationLocks(transaction, eventRef, projectRef) {
  transaction.update(eventRef, {
    timeLogMutationVersion: FieldValue.increment(1),
  });
  if (projectRef) {
    transaction.update(projectRef, {
      invoiceMutationVersion: FieldValue.increment(1),
    });
  }
}

// Event hours land in the same daily document as task hours and in a different
// figure, because «Куди пішов час» is one total split three ways and a meeting
// is not a task. The day comes from the occurrence, which is also what the raw
// log stores in `loggedAt`, so the aggregate and the timesheet bucket a
// recurring Monday stand-up identically.
function calendarRollupLog({ organizationId, event, eventId, occurrenceStartAt, userId, spentMinutes }) {
  return {
    organizationId,
    projectId: event.projectId || '',
    issueId: '',
    sourceType: 'calendar_event',
    eventId,
    occurrenceStartAt,
    userId,
    spentMinutes,
  };
}

export async function GET(request, context) {
  try {
    const { eventId: rawEventId } = await context.params;
    const eventId = cleanId(rawEventId);
    const url = new URL(request.url);
    const organizationId = cleanId(url.searchParams.get('organizationId'));
    const occurrenceStartAt = url.searchParams.get('occurrenceStartAt') || '';
    const expectedProjectId = url.searchParams.get('projectId');
    if (!eventId) {
      return NextResponse.json({ error: 'Некоректна подія' }, { status: 400 });
    }
    validateOccurrence(occurrenceStartAt);
    const authResult = await authorizeCalendarTimeRequest(request, organizationId);
    if (authResult.response) return authResult.response;
    const db = getAdminDb();
    const eventRef = db.collection('calendarEvents').doc(eventId);
    const logsQuery = db.collection('timeLogs')
      .where('organizationId', '==', organizationId)
      .where('sourceType', '==', 'calendar_event')
      .where('eventId', '==', eventId)
      .where('occurrenceStartAt', '==', occurrenceStartAt);
    const logs = await db.runTransaction(async transaction => {
      const { event, canTrackTime, trackingDisabledReason } = await readLiveEventContext({
        transaction,
        db,
        eventRef,
        organizationId,
        occurrenceStartAt,
        authorization: authResult.authorization,
        expectedProjectId,
      });
      const snapshot = await transaction.get(logsQuery);
      return {
        logs: snapshot.docs
        .filter(document => (
          document.data().projectId === (event.projectId || '')
          && document.data().issueId === ''
        ))
        .map(serializeTimeLog)
        .sort((left, right) => (
          new Date(right.loggedAt || 0).getTime()
          - new Date(left.loggedAt || 0).getTime()
        )),
        canTrackTime,
        trackingDisabledReason,
      };
    });

    return NextResponse.json(
      logs,
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error?.calendarTimeLog) return expectedErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'calendar event time logs GET',
      fallbackMessage: 'Не вдалося завантажити зафіксований час',
    });
  }
}

export async function POST(request, context) {
  try {
    const { eventId: rawEventId } = await context.params;
    const eventId = cleanId(rawEventId);
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Некоректний JSON',
        code: 'CALENDAR_TIME_JSON_INVALID',
      }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({
        error: 'Тіло запиту має бути об’єктом',
        code: 'CALENDAR_TIME_JSON_INVALID',
      }, { status: 400 });
    }
    const organizationId = cleanId(body.organizationId);
    const projectId = cleanId(body.projectId) || '';
    const occurrenceStartAt = body.occurrenceStartAt || '';
    const minutes = exactMinutes(body.spentMinutes);
    if (!eventId || minutes === null) {
      return NextResponse.json({
        error: 'Вкажіть коректний час',
        code: 'CALENDAR_TIME_INVALID',
      }, { status: 400 });
    }
    validateOccurrence(occurrenceStartAt);
    const authResult = await authorizeCalendarTimeRequest(request, organizationId);
    if (authResult.response) return authResult.response;
    const timerSessionId = body.timerSessionId === undefined
      ? ''
      : cleanTimerSessionId(body.timerSessionId);
    if (body.timerSessionId !== undefined && !timerSessionId) {
      throw calendarTimeError('CALENDAR_TIME_TIMER_INVALID', 400, 'Некоректна сесія таймера');
    }
    if (body.userId && body.userId !== authResult.authorization.user.uid) {
      return NextResponse.json({
        error: 'Не можна списувати час від імені іншого користувача',
        code: 'CALENDAR_TIME_USER_MISMATCH',
      }, { status: 403 });
    }
    if (!(await enforceRateLimit(
      'calendar-time-log-create',
      authResult.authorization.user.uid,
      60,
      60,
    ))) {
      return NextResponse.json({
        error: 'Забагато записів часу за короткий проміжок',
        code: 'CALENDAR_TIME_RATE_LIMIT',
      }, { status: 429 });
    }

    const db = getAdminDb();
    const eventRef = db.collection('calendarEvents').doc(eventId);
    const timerRef = timerSessionId
      ? timerStateRef(db, authResult.authorization.user.uid)
      : null;
    const logRef = timerSessionId
      ? db.collection('timeLogs').doc(timerLogDocumentId(authResult.authorization.user.uid, timerSessionId))
      : db.collection('timeLogs').doc();
    let logCreated = true;
    const rollupDeltas = await analyticsRollupDeltasFor(db, organizationId);
    await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention, and the accumulator lives
      // outside it: without the reset a retry moves the day's total twice.
      rollupDeltas.reset();
      if (timerSessionId) {
        const [timerSnapshot, existingLogSnapshot] = await Promise.all([
          transaction.get(timerRef),
          transaction.get(logRef),
        ]);
        const timerState = timerSnapshot.exists ? timerSnapshot.data() : null;
        if (existingLogSnapshot.exists) {
          const existingLog = existingLogSnapshot.data();
          if (
            existingLog.timerSessionId !== timerSessionId
            || existingLog.userId !== authResult.authorization.user.uid
            || existingLog.organizationId !== organizationId
            || existingLog.projectId !== (projectId || '')
            || existingLog.sourceType !== 'calendar_event'
            || existingLog.eventId !== eventId
            || existingLog.occurrenceStartAt !== occurrenceStartAt
          ) {
            throw calendarTimeError('CALENDAR_TIME_TIMER_CONFLICT', 409, 'Сесія таймера вже використана іншим записом');
          }
          if (timerState?.pending?.id === timerSessionId) {
            transaction.update(timerRef, {
              pending: null,
              revision: FieldValue.increment(1),
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
          logCreated = false;
          return;
        }
        requireMatchingPendingTimer(timerState, {
          timerSessionId,
          userId: authResult.authorization.user.uid,
          organizationId,
          projectId: projectId || '',
          eventId,
          occurrenceStartAt,
        });
      }
      const { event, projectRef, canTrackTime, trackingDisabledReason } = await readLiveEventContext({
        transaction,
        db,
        eventRef,
        organizationId,
        occurrenceStartAt,
        authorization: authResult.authorization,
        expectedProjectId: typeof body.projectId === 'string' ? body.projectId.trim() : undefined,
      });
      if (!canTrackTime) {
        throw calendarTimeError(
          trackingDisabledReason === 'type'
            ? 'CALENDAR_TIME_TYPE_DISABLED'
            : 'CALENDAR_TIME_VISIBILITY_DISABLED',
          409,
          trackingDisabledReason === 'type'
            ? 'Цей тип події не передбачає фіксації часу'
            : 'Фіксація часу доступна лише для командних подій',
        );
      }
      const now = FieldValue.serverTimestamp();
      transaction.create(logRef, {
        organizationId,
        projectId: event.projectId || '',
        issueId: '',
        sourceType: 'calendar_event',
        eventId,
        sourceTitle: String(event.title || '').slice(0, 500),
        eventVisibility: 'team',
        calendarOrganizerId: event.organizerId,
        occurrenceStartAt,
        userId: authResult.authorization.user.uid,
        spentMinutes: minutes,
        description: cleanDescription(body.description),
        loggedAt: Timestamp.fromDate(new Date(occurrenceStartAt)),
        createdAt: now,
        updatedAt: now,
        ...(timerSessionId ? { timerSessionId } : {}),
      });
      rollupDeltas.add(calendarRollupLog({
        organizationId,
        event,
        eventId,
        occurrenceStartAt,
        userId: authResult.authorization.user.uid,
        spentMinutes: minutes,
      }), 1);
      writeAnalyticsRollupDeltas({ writer: transaction, db, deltas: rollupDeltas });
      incrementMutationLocks(transaction, eventRef, projectRef);
      if (timerSessionId) {
        transaction.update(timerRef, {
          pending: null,
          revision: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    const createdSnapshot = await logRef.get();
    return NextResponse.json(
      { log: serializeTimeLog(createdSnapshot) },
      { status: logCreated ? 201 : 200 },
    );
  } catch (error) {
    if (error?.calendarTimeLog) return expectedErrorResponse(error);
    if (error?.userTimer) return timerStateErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'calendar event time logs POST',
      fallbackMessage: 'Не вдалося зафіксувати час',
    });
  }
}

export async function PATCH(request, context) {
  try {
    const { eventId: rawEventId } = await context.params;
    const eventId = cleanId(rawEventId);
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Некоректний JSON',
        code: 'CALENDAR_TIME_JSON_INVALID',
      }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({
        error: 'Тіло запиту має бути об’єктом',
        code: 'CALENDAR_TIME_JSON_INVALID',
      }, { status: 400 });
    }
    const organizationId = cleanId(body.organizationId);
    const occurrenceStartAt = body.occurrenceStartAt || '';
    const logId = cleanId(body.logId);
    const minutes = exactMinutes(body.spentMinutes);
    if (!eventId || !logId || minutes === null) {
      return NextResponse.json({
        error: 'Вкажіть коректний запис і час',
        code: 'CALENDAR_TIME_INVALID',
      }, { status: 400 });
    }
    validateOccurrence(occurrenceStartAt);
    const authResult = await authorizeCalendarTimeRequest(request, organizationId);
    if (authResult.response) return authResult.response;

    const db = getAdminDb();
    const eventRef = db.collection('calendarEvents').doc(eventId);
    const logRef = db.collection('timeLogs').doc(logId);
    const rollupDeltas = await analyticsRollupDeltasFor(db, organizationId);
    await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention, and the accumulator lives
      // outside it: without the reset a retry moves the day's total twice.
      rollupDeltas.reset();
      const { event, projectRef, canTrackTime, trackingDisabledReason } = await readLiveEventContext({
        transaction,
        db,
        eventRef,
        organizationId,
        occurrenceStartAt,
        authorization: authResult.authorization,
        expectedProjectId: typeof body.projectId === 'string' ? body.projectId.trim() : undefined,
      });
      if (!canTrackTime) {
        throw calendarTimeError(
          trackingDisabledReason === 'type'
            ? 'CALENDAR_TIME_TYPE_DISABLED'
            : 'CALENDAR_TIME_VISIBILITY_DISABLED',
          409,
          trackingDisabledReason === 'type'
            ? 'Цей тип події не передбачає фіксації часу'
            : 'Змінювати час можна лише для командних подій',
        );
      }
      const logSnapshot = await transaction.get(logRef);
      const log = validateLogIdentity({
        snapshot: logSnapshot,
        eventId,
        event,
        organizationId,
        occurrenceStartAt,
      });
      if (
        log.userId !== authResult.authorization.user.uid
        && !['owner', 'admin'].includes(authResult.authorization.membership?.role)
      ) {
        throw calendarTimeError(
          'CALENDAR_TIME_LOG_FORBIDDEN',
          403,
          'Змінювати цей запис може лише його автор або адміністратор',
        );
      }
      ensureLogIsMutable(log);
      transaction.update(logRef, {
        spentMinutes: minutes,
        description: cleanDescription(body.description),
        eventVisibility: 'team',
        calendarOrganizerId: event.organizerId,
        updatedAt: FieldValue.serverTimestamp(),
      });
      // The stored record out, the corrected one in. An occurrence cannot move
      // — changing an event's dates is refused outright while it has hours —
      // so both land on the same day, and the day's figure moves by the
      // difference rather than by the new value.
      rollupDeltas.add(log, -1);
      rollupDeltas.add({ ...log, spentMinutes: minutes }, 1);
      writeAnalyticsRollupDeltas({ writer: transaction, db, deltas: rollupDeltas });
      incrementMutationLocks(transaction, eventRef, projectRef);
    });

    const updated = await logRef.get();
    return NextResponse.json({ log: serializeTimeLog(updated) });
  } catch (error) {
    if (error?.calendarTimeLog) return expectedErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'calendar event time logs PATCH',
      fallbackMessage: 'Не вдалося змінити зафіксований час',
    });
  }
}

export async function DELETE(request, context) {
  try {
    const { eventId: rawEventId } = await context.params;
    const eventId = cleanId(rawEventId);
    const url = new URL(request.url);
    const organizationId = cleanId(url.searchParams.get('organizationId'));
    const occurrenceStartAt = url.searchParams.get('occurrenceStartAt') || '';
    const logId = cleanId(url.searchParams.get('logId'));
    const expectedProjectId = url.searchParams.get('projectId');
    if (!eventId || !logId) {
      return NextResponse.json({
        error: 'Некоректний запис часу',
        code: 'CALENDAR_TIME_INVALID',
      }, { status: 400 });
    }
    validateOccurrence(occurrenceStartAt);
    const authResult = await authorizeCalendarTimeRequest(request, organizationId);
    if (authResult.response) return authResult.response;

    const db = getAdminDb();
    const eventRef = db.collection('calendarEvents').doc(eventId);
    const logRef = db.collection('timeLogs').doc(logId);
    const rollupDeltas = await analyticsRollupDeltasFor(db, organizationId);
    await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention, and the accumulator lives
      // outside it: without the reset a retry moves the day's total twice.
      rollupDeltas.reset();
      const { event, projectRef } = await readLiveEventContext({
        transaction,
        db,
        eventRef,
        organizationId,
        occurrenceStartAt,
        authorization: authResult.authorization,
        expectedProjectId,
      });
      const logSnapshot = await transaction.get(logRef);
      const log = validateLogIdentity({
        snapshot: logSnapshot,
        eventId,
        event,
        organizationId,
        occurrenceStartAt,
      });
      if (
        log.userId !== authResult.authorization.user.uid
        && !['owner', 'admin'].includes(authResult.authorization.membership?.role)
      ) {
        throw calendarTimeError(
          'CALENDAR_TIME_LOG_FORBIDDEN',
          403,
          'Видаляти цей запис може лише його автор або адміністратор',
        );
      }
      ensureLogIsMutable(log);
      transaction.delete(logRef);
      rollupDeltas.add(log, -1);
      writeAnalyticsRollupDeltas({ writer: transaction, db, deltas: rollupDeltas });
      incrementMutationLocks(transaction, eventRef, projectRef);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.calendarTimeLog) return expectedErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'calendar event time logs DELETE',
      fallbackMessage: 'Не вдалося видалити зафіксований час',
    });
  }
}
