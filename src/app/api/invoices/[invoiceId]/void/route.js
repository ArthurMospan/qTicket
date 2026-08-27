import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  invoiceSourcelessReservationId,
  invoiceIsCancelled,
  invoiceReservationId,
  invoiceSourceIds,
  invoiceSourceLessItemIds,
} from '@/lib/server/invoicePayload.mjs';

function voidError(code, status, message, details = {}) {
  const error = new Error(code);
  error.voidInvoice = { code, status, message, ...details };
  return error;
}

export async function POST(request, context) {
  try {
    const { invoiceId } = await context.params;
    const db = getAdminDb();
    const invoiceRef = db.collection('invoices').doc(invoiceId);
    const initialSnapshot = await invoiceRef.get();
    if (!initialSnapshot.exists) {
      return NextResponse.json({
        error: 'Рахунок не знайдено',
        code: 'INVOICE_NOT_FOUND',
      }, { status: 404 });
    }

    const initialInvoice = initialSnapshot.data();
    const authorization = await authorizeOrgRequest(
      request,
      initialInvoice.organizationId,
      ['owner', 'admin'],
    );
    if (authorization.error) {
      return NextResponse.json(
        { error: authorization.error },
        { status: authorization.status },
      );
    }
    if (!(await enforceRateLimit(
      'invoice-void',
      authorization.user.uid,
      30,
      60,
    ))) {
      return NextResponse.json({
        error: 'Забагато запитів на анулювання рахунків',
        code: 'INVOICE_RATE_LIMIT',
      }, { status: 429 });
    }

    if (invoiceIsCancelled(initialInvoice)) {
      return NextResponse.json({ success: true, changed: false, id: invoiceId });
    }
    const organizationId = initialInvoice.organizationId;
    const projectId = initialInvoice.projectId;
    const sourceTimeLogIds = invoiceSourceIds(initialInvoice);
    const sourceItemIds = invoiceSourceLessItemIds(initialInvoice);
    const projectRef = db.collection('projects').doc(projectId);
    const timeLogRefs = sourceTimeLogIds.map(
      timeLogId => db.collection('timeLogs').doc(timeLogId),
    );
    const timeReservationRefs = sourceTimeLogIds.map(
      timeLogId => db.collection('invoiceTimeLogReservations').doc(
        invoiceReservationId(organizationId, projectId, timeLogId),
      ),
    );
    const estimateReservationRefs = sourceItemIds.map(
      itemId => db.collection('invoiceEstimateReservations').doc(
        invoiceSourcelessReservationId(organizationId, projectId, itemId),
      ),
    );

    const result = await db.runTransaction(async transaction => {
      const currentInvoiceSnapshot = await transaction.get(invoiceRef);
      const projectSnapshot = await transaction.get(projectRef);
      if (!currentInvoiceSnapshot.exists) {
        throw voidError(
          'INVOICE_NOT_FOUND',
          404,
          'Рахунок не знайдено',
        );
      }
      const currentInvoice = currentInvoiceSnapshot.data();
      if (
        currentInvoice.organizationId !== organizationId
        || currentInvoice.projectId !== projectId
      ) {
        throw voidError(
          'INVOICE_SCOPE_CHANGED',
          409,
          'Область рахунку змінилася. Оновіть сторінку',
        );
      }
      if (invoiceIsCancelled(currentInvoice)) {
        return { changed: false };
      }
      if (currentInvoice.status !== 'draft') {
        throw voidError(
          'INVOICE_NOT_VOIDABLE',
          409,
          'Анулювати можна лише чернетку рахунку',
        );
      }
      if (
        !projectSnapshot.exists
        || projectSnapshot.data().organizationId !== organizationId
      ) {
        throw voidError(
          'PROJECT_SCOPE_MISMATCH',
          409,
          'Проєкт рахунку не знайдено',
        );
      }
      if (projectSnapshot.data().deletionPending === true) {
        throw voidError(
          'PROJECT_DELETION_IN_PROGRESS',
          409,
          'Проєкт уже видаляють',
        );
      }

      const timeLogSnapshots = timeLogRefs.length > 0
        ? await transaction.getAll(...timeLogRefs)
        : [];
      const timeReservationSnapshots = timeReservationRefs.length > 0
        ? await transaction.getAll(...timeReservationRefs)
        : [];
      const estimateReservationSnapshots = estimateReservationRefs.length > 0
        ? await transaction.getAll(...estimateReservationRefs)
        : [];

      timeLogSnapshots.forEach((snapshot, index) => {
        const timeLog = snapshot.exists ? snapshot.data() : null;
        if (
          !timeLog
          || timeLog.organizationId !== organizationId
          || timeLog.projectId !== projectId
          || timeLog.invoiceId !== invoiceId
        ) {
          throw voidError(
            'INVOICE_VOID_SOURCE_CONFLICT',
            409,
            'Джерело часу рахунку відсутнє або належить іншому рахунку',
            { sourceTimeLogIds: [sourceTimeLogIds[index]] },
          );
        }
      });
      timeReservationSnapshots.forEach((snapshot, index) => {
        const reservation = snapshot.exists ? snapshot.data() : null;
        if (
          reservation
          && (
            reservation.organizationId !== organizationId
            || reservation.projectId !== projectId
            || reservation.timeLogId !== sourceTimeLogIds[index]
            || reservation.invoiceId !== invoiceId
          )
        ) {
          throw voidError(
            'INVOICE_VOID_SOURCE_CONFLICT',
            409,
            'Резерв часу належить іншому рахунку',
            { sourceTimeLogIds: [sourceTimeLogIds[index]] },
          );
        }
      });
      estimateReservationSnapshots.forEach((snapshot, index) => {
        const reservation = snapshot.exists ? snapshot.data() : null;
        if (
          reservation
          && (
            reservation.organizationId !== organizationId
            || reservation.projectId !== projectId
            || reservation.itemId !== sourceItemIds[index]
            || reservation.invoiceId !== invoiceId
          )
        ) {
          throw voidError(
            'INVOICE_VOID_SOURCE_CONFLICT',
            409,
            'Резерв позиції належить іншому рахунку',
            { sourceItemIds: [sourceItemIds[index]] },
          );
        }
      });

      const now = FieldValue.serverTimestamp();
      transaction.update(invoiceRef, {
        status: 'void',
        voidedAt: now,
        voidedBy: authorization.user.uid,
      });
      timeLogRefs.forEach(ref => {
        transaction.update(ref, {
          invoiceId: FieldValue.delete(),
          billedAt: FieldValue.delete(),
        });
      });
      timeReservationSnapshots.forEach(snapshot => {
        if (snapshot.exists) transaction.delete(snapshot.ref);
      });
      estimateReservationSnapshots.forEach(snapshot => {
        if (snapshot.exists) transaction.delete(snapshot.ref);
      });
      transaction.update(projectRef, {
        invoiceMutationVersion: FieldValue.increment(1),
        updatedAt: now,
      });
      return { changed: true };
    });

    return NextResponse.json({
      success: true,
      changed: result.changed,
      id: invoiceId,
      status: 'void',
    });
  } catch (error) {
    if (error?.voidInvoice) {
      const { message, status, ...payload } = error.voidInvoice;
      return NextResponse.json({
        error: message,
        ...payload,
      }, { status });
    }
    return routeErrorResponse(error, {
      context: 'Invoice void POST',
      fallbackMessage: 'Не вдалося анулювати рахунок',
    });
  }
}
