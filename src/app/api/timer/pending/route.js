import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { authenticateRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  cleanTimerSessionId,
  serializeTimerState,
  timerStateError,
  timerStateErrorResponse,
  timerStateRef,
} from '@/lib/server/userTimerState';

export async function DELETE(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      throw timerStateError('TIMER_UNAUTHORIZED', authorization.status, authorization.error);
    }
    const body = await readJsonBody(request);
    const timerId = cleanTimerSessionId(body?.timerId);
    if (!timerId) throw timerStateError('TIMER_ID_REQUIRED', 400, 'Не вказано відстежений час');

    const uid = authorization.user.uid;
    const db = getAdminDb();
    const stateRef = timerStateRef(db, uid);
    const state = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(stateRef);
      const current = snapshot.exists ? snapshot.data() : null;
      if (!current || current.userId !== uid || !current.pending) return current;
      if (current.pending.id !== timerId) {
        throw timerStateError('TIMER_CHANGED', 409, 'Відстежений час уже змінено в іншій вкладці або на іншому пристрої');
      }
      const next = { ...current, pending: null, revision: (Number(current.revision) || 0) + 1 };
      transaction.update(stateRef, {
        pending: null,
        revision: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return next;
    });
    return NextResponse.json({ state: serializeTimerState(state), serverNow: Date.now() });
  } catch (error) {
    if (error?.userTimer) return timerStateErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'timer pending discard',
      fallbackMessage: 'Не вдалося відхилити відстежений час',
    });
  }
}
