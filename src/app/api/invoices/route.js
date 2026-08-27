import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { refuseWithoutCapability } from '@/lib/server/planLimits';
import {
  InvoicePayloadError,
  MAX_INVOICE_JSON_BYTES,
  invoiceSourcelessReservationId,
  invoiceNumberSequenceId,
  invoiceReservationId,
  isFirestoreAlreadyExists,
  legacyInvoiceAmbiguousItemOverlap,
  legacyInvoiceItemOverlap,
  legacyInvoiceOverlap,
  normalizeInvoiceRequest,
  validateInvoiceItemMinutes,
  validateSourceLessInvoiceIssue,
  validateInvoiceTimeLog,
} from '@/lib/server/invoicePayload.mjs';
import {
  isCalendarEventOccurrence,
  isCanonicalCalendarOccurrence,
} from '@/lib/utils/calendarTimeLog.mjs';

function errorResponse(error) {
  return NextResponse.json({
    error: error.message,
    code: error.code,
    ...(error.details?.sourceTimeLogIds
      ? { sourceTimeLogIds: error.details.sourceTimeLogIds }
      : {}),
    ...(error.details?.sourceItemIds
      ? { sourceItemIds: error.details.sourceItemIds }
      : {}),
  }, { status: error.status });
}

function invoiceError(code, message, status, details = {}) {
  return new InvoicePayloadError(code, message, status, details);
}

function basicOrganizationId(body) {
  const value = typeof body?.organizationId === 'string'
    ? body.organizationId.trim()
    : '';
  return value
    && value.length <= 256
    && !value.includes('/')
    && !value.includes('\0')
    ? value
    : null;
}

export async function POST(request) {
  let requestedSourceTimeLogIds = [];
  let requestedSourceItemIds = [];
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_INVOICE_JSON_BYTES) {
      return errorResponse(invoiceError(
        'INVOICE_TOO_LARGE',
        'Рахунок перевищує допустимий розмір',
        413,
      ));
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return errorResponse(invoiceError(
        'INVALID_INVOICE_PAYLOAD',
        'Некоректний JSON рахунку',
        400,
      ));
    }

    const requestedOrganizationId = basicOrganizationId(body);
    if (!requestedOrganizationId) {
      return errorResponse(invoiceError(
        'INVALID_INVOICE_PAYLOAD',
        'Некоректна організація',
        400,
      ));
    }
    const authorization = await authorizeOrgRequest(
      request,
      requestedOrganizationId,
      ['owner', 'admin'],
    );
    if (authorization.error) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    if (!(await enforceRateLimit('invoice-create', authorization.user.uid, 30, 60))) {
      return NextResponse.json({
        error: 'Забагато запитів на створення рахунків',
        code: 'INVOICE_RATE_LIMIT',
      }, { status: 429 });
    }
    // Issuing an invoice is a paid capability, and the analytics screen was the
    // only thing that knew it. Invoices already issued are not touched: they are
    // the record of work that was billed, and they open, print and void on any
    // plan. Only writing a new one waits for the plan to come back.
    const capabilityRefusal = await refuseWithoutCapability(
      getAdminDb(),
      requestedOrganizationId,
      'invoices',
    );
    if (capabilityRefusal) return capabilityRefusal;

    const normalized = normalizeInvoiceRequest(body);
    const {
      organizationId,
      projectId,
      invoice,
      itemIds,
      sourceItemByTimeLogId,
      sourceItemIds,
      sourceTimeLogIds,
    } = normalized;
    requestedSourceTimeLogIds = sourceTimeLogIds;
    requestedSourceItemIds = itemIds;

    const db = getAdminDb();
    const invoiceRef = db.collection('invoices').doc();
    const projectRef = db.collection('projects').doc(projectId);
    const timeLogRefs = sourceTimeLogIds.map(
      timeLogId => db.collection('timeLogs').doc(timeLogId),
    );
    const sourceIssueIds = [...new Set(
      invoice.items
        .filter(item => item.issueId)
        .map(item => item.issueId),
    )];
    const sourceLessIssueIds = [...new Set(
      invoice.items
        .filter(item => item.issueId && item.sourceTimeLogIds.length === 0)
        .map(item => item.issueId),
    )];
    const sourceIssueRefs = sourceIssueIds.map(
      issueId => db.collection('issues').doc(issueId),
    );
    const estimateReservationRefs = itemIds.map(
      itemId => db.collection('invoiceEstimateReservations').doc(
        invoiceSourcelessReservationId(organizationId, projectId, itemId),
      ),
    );
    const estimateReservationRefByItemId = new Map(
      itemIds.map((itemId, index) => [itemId, estimateReservationRefs[index]]),
    );
    const legacyInvoiceQuery = db.collection('invoices')
      .where('organizationId', '==', organizationId)
      .where('projectId', '==', projectId);
    const invoiceYear = new Date().getUTCFullYear();
    const invoiceNumberSequenceRef = db.collection('invoiceNumberSequences').doc(
      invoiceNumberSequenceId(organizationId, invoiceYear),
    );

    const committedInvoice = await db.runTransaction(async transaction => {
      // The project lock serializes legacy-source checks inside one project.
      // The organization/year sequence lock makes the visible invoice number
      // unique across every project in the organization.
      const [projectSnapshot, invoiceNumberSequenceSnapshot] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(invoiceNumberSequenceRef),
      ]);
      if (
        !projectSnapshot.exists
        || projectSnapshot.data().organizationId !== organizationId
      ) {
        throw invoiceError(
          'PROJECT_SCOPE_MISMATCH',
          'Проєкт не належить цій організації',
          400,
        );
      }
      if (projectSnapshot.data().deletionPending === true) {
        throw invoiceError(
          'PROJECT_DELETION_IN_PROGRESS',
          'Проєкт видаляється — нові рахунки для нього вже недоступні',
          409,
        );
      }
      const sequenceData = invoiceNumberSequenceSnapshot.data() || {};
      if (
        invoiceNumberSequenceSnapshot.exists
        && (
          sequenceData.organizationId !== organizationId
          || sequenceData.year !== invoiceYear
        )
      ) {
        throw invoiceError(
          'INVOICE_SEQUENCE_INVALID',
          'Не вдалося безпечно зарезервувати номер рахунку',
          409,
        );
      }
      const currentInvoiceCounter = (
        Number.isSafeInteger(sequenceData.counter)
        && sequenceData.counter >= 0
      )
        ? sequenceData.counter
        : 0;
      if (currentInvoiceCounter >= Number.MAX_SAFE_INTEGER) {
        throw invoiceError(
          'INVOICE_SEQUENCE_EXHAUSTED',
          'Нумерація рахунків за цей рік вичерпана',
          409,
        );
      }
      const nextInvoiceCounter = currentInvoiceCounter + 1;
      const serverInvoiceNumber = (
        `INV-${invoiceYear}-${String(nextInvoiceCounter).padStart(6, '0')}`
      );

      let legacyInvoices = [];
      if (sourceTimeLogIds.length > 0 || sourceItemIds.length > 0) {
        const existingInvoicesSnapshot = await transaction.get(legacyInvoiceQuery);
        legacyInvoices = existingInvoicesSnapshot.docs.map(document => document.data());
      }
      const legacyOverlap = legacyInvoiceOverlap(
        sourceTimeLogIds,
        legacyInvoices,
      );
      if (legacyOverlap.length > 0) {
        throw invoiceError(
          'INVOICE_TIME_LOG_CONFLICT',
          'Частина зафіксованого часу вже входить в інший рахунок',
          409,
          { sourceTimeLogIds: legacyOverlap },
        );
      }
      const legacyItemOverlap = legacyInvoiceItemOverlap(
        itemIds,
        legacyInvoices,
      );
      if (legacyItemOverlap.length > 0) {
        throw invoiceError(
          'INVOICE_ITEM_CONFLICT',
          'Частина позицій без фактичного часу вже входить в інший рахунок',
          409,
          { sourceItemIds: legacyItemOverlap },
        );
      }
      const legacyAmbiguousItems = legacyInvoiceAmbiguousItemOverlap(
        invoice.items,
        legacyInvoices,
      );
      if (legacyAmbiguousItems.length > 0) {
        throw invoiceError(
          'INVOICE_LEGACY_AMBIGUITY',
          'Історичний рахунок уже містить ці задачі без точних джерел часу. Потрібна ручна звірка',
          409,
          { sourceItemIds: legacyAmbiguousItems },
        );
      }

      const timeLogSnapshots = timeLogRefs.length > 0
        ? await transaction.getAll(...timeLogRefs)
        : [];
      const timeLogsById = Object.create(null);
      timeLogSnapshots.forEach((snapshot, index) => {
        const timeLogId = sourceTimeLogIds[index];
        const timeLog = snapshot.exists ? snapshot.data() : null;
        validateInvoiceTimeLog({
          timeLog,
          organizationId,
          projectId,
          item: sourceItemByTimeLogId[timeLogId],
        });
        timeLogsById[timeLogId] = timeLog;
      });
      validateInvoiceItemMinutes({
        items: invoice.items,
        timeLogsById,
      });
      const calendarTimeLogIds = sourceTimeLogIds.filter(
        timeLogId => timeLogsById[timeLogId]?.sourceType === 'calendar_event',
      );
      const calendarEventIds = [...new Set(
        calendarTimeLogIds.map(timeLogId => timeLogsById[timeLogId].eventId),
      )];
      const calendarEventRefs = calendarEventIds.map(
        eventId => db.collection('calendarEvents').doc(eventId),
      );
      const calendarEventSnapshots = calendarEventRefs.length
        ? await transaction.getAll(...calendarEventRefs)
        : [];
      const calendarEventsById = new Map(
        calendarEventSnapshots.map(snapshot => [
          snapshot.id,
          snapshot.exists ? snapshot.data() : null,
        ]),
      );
      calendarTimeLogIds.forEach(timeLogId => {
        const timeLog = timeLogsById[timeLogId];
        const event = calendarEventsById.get(timeLog.eventId);
        if (
          !event
          || event.organizationId !== organizationId
          || (event.projectId || '') !== projectId
          || event.visibility !== 'team'
          || timeLog.eventVisibility !== 'team'
          || timeLog.calendarOrganizerId !== event.organizerId
          || !isCanonicalCalendarOccurrence(timeLog.occurrenceStartAt)
          || !isCalendarEventOccurrence(event, timeLog.occurrenceStartAt)
        ) {
          throw invoiceError(
            'INVOICE_CALENDAR_EVENT_INVALID',
            'Подія календаря змінилася, стала недоступною або не має безпечної командної видимості',
            409,
            { sourceTimeLogIds: [timeLogId] },
          );
        }
      });
      const sourceIssueSnapshots = sourceIssueRefs.length > 0
        ? await transaction.getAll(...sourceIssueRefs)
        : [];
      const sourceIssuesById = new Map();
      sourceIssueSnapshots.forEach((snapshot, index) => {
        const issue = snapshot.exists
          ? { ...snapshot.data(), id: snapshot.id }
          : null;
        if (
          !issue
          || issue.organizationId !== organizationId
          || issue.projectId !== projectId
          || issue.deletionPending === true
        ) {
          throw invoiceError(
            'INVOICE_ISSUE_INVALID',
            'Задачу з рахунку вже видаляють або вона не належить вибраному проєкту',
            409,
            { sourceItemIds: [sourceIssueIds[index]] },
          );
        }
        sourceIssuesById.set(snapshot.id, issue);
      });
      const liveChildParentIds = new Set();
      const issueIdsWithAnyTimeLogs = new Set();
      for (let offset = 0; offset < sourceLessIssueIds.length; offset += 30) {
        const issueIdChunk = sourceLessIssueIds.slice(offset, offset + 30);
        const canonicalChildren = await transaction.get(
          db.collection('issues').where('parentIssueId', 'in', issueIdChunk),
        );
        const legacyChildren = await transaction.get(
          db.collection('issues').where('parentEpicId', 'in', issueIdChunk),
        );
        [...canonicalChildren.docs, ...legacyChildren.docs].forEach(document => {
          const child = document.data();
          if (
            child.organizationId === organizationId
            && child.projectId === projectId
            && child.deletionPending !== true
          ) {
            [child.parentIssueId, child.parentEpicId].forEach(parentId => {
              if (issueIdChunk.includes(parentId)) liveChildParentIds.add(parentId);
            });
          }
        });
        const existingTimeLogs = await transaction.get(
          db.collection('timeLogs').where('issueId', 'in', issueIdChunk),
        );
        existingTimeLogs.docs.forEach(document => {
          const timeLog = document.data();
          if (
            timeLog.organizationId === organizationId
            && timeLog.projectId === projectId
          ) {
            issueIdsWithAnyTimeLogs.add(timeLog.issueId);
          }
        });
      }
      invoice.items
        .filter(item => item.issueId && item.sourceTimeLogIds.length === 0)
        .forEach(item => {
          validateSourceLessInvoiceIssue({
            item,
            issue: sourceIssuesById.get(item.issueId),
            hasLiveChildren: liveChildParentIds.has(item.issueId),
            hasAnyTimeLogs: issueIdsWithAnyTimeLogs.has(item.issueId),
          });
        });
      const estimateReservationSnapshots = estimateReservationRefs.length > 0
        ? await transaction.getAll(...estimateReservationRefs)
        : [];
      const reservedItemIds = estimateReservationSnapshots
        .flatMap((snapshot, index) => snapshot.exists ? [itemIds[index]] : []);
      if (reservedItemIds.length > 0) {
        throw invoiceError(
          'INVOICE_ITEM_CONFLICT',
          'Частина позицій уже зарезервована іншим рахунком',
          409,
          { sourceItemIds: reservedItemIds },
        );
      }

      const now = FieldValue.serverTimestamp();
      transaction.create(invoiceRef, {
        ...invoice,
        number: serverInvoiceNumber,
        organizationId,
        projectId,
        sourceTimeLogIds,
        createdBy: authorization.user.uid,
        createdAt: now,
        status: 'draft',
      });
      sourceTimeLogIds.forEach(timeLogId => {
        const timeLogRef = db.collection('timeLogs').doc(timeLogId);
        const reservationRef = db.collection('invoiceTimeLogReservations').doc(
          invoiceReservationId(organizationId, projectId, timeLogId),
        );
        transaction.update(timeLogRef, {
          invoiceId: invoiceRef.id,
          billedAt: now,
        });
        transaction.create(reservationRef, {
          organizationId,
          projectId,
          timeLogId,
          invoiceId: invoiceRef.id,
          createdBy: authorization.user.uid,
          createdAt: now,
        });
      });
      sourceItemIds.forEach(itemId => {
        transaction.create(estimateReservationRefByItemId.get(itemId), {
          organizationId,
          projectId,
          itemId,
          invoiceId: invoiceRef.id,
          createdBy: authorization.user.uid,
          createdAt: now,
        });
      });
      transaction.update(projectRef, {
        invoiceMutationVersion: FieldValue.increment(1),
      });
      transaction.set(invoiceNumberSequenceRef, {
        organizationId,
        year: invoiceYear,
        counter: nextInvoiceCounter,
        updatedAt: now,
      });
      return { number: serverInvoiceNumber };
    });

    return NextResponse.json({
      id: invoiceRef.id,
      number: committedInvoice.number,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof InvoicePayloadError) return errorResponse(error);
    if (isFirestoreAlreadyExists(error)) {
      return errorResponse(invoiceError(
        'INVOICE_SOURCE_CONFLICT',
        'Частина позицій або зафіксованого часу вже зарезервована іншим рахунком',
        409,
        {
          sourceTimeLogIds: requestedSourceTimeLogIds,
          sourceItemIds: requestedSourceItemIds,
        },
      ));
    }
    return routeErrorResponse(error, {
      context: 'Invoice POST',
      fallbackMessage: 'Не вдалося створити рахунок',
    });
  }
}
