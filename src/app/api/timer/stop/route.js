import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { authenticateRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  cleanTimerSessionId,
  serializeTimerState,
  stoppedTimer,
  timerStateError,
  timerStateErrorResponse,
  timerStateRef,
} from '@/lib/server/userTimerState';
import { timerStopDecision } from '@/lib/utils/timerState.mjs';

export async function POST(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      throw timerStateError('TIMER_UNAUTHORIZED', authorization.status, authorization.error);
    }
    const body = await readJsonBody(request);
    const timerId = cleanTimerSessionId(body?.timerId);
    if (!timerId) throw timerStateError('TIMER_ID_REQUIRED', 400, 'Не вказано таймер');

    const uid = authorization.user.uid;
    const db = getAdminDb();
    const stateRef = timerStateRef(db, uid);
    const state = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(stateRef);
      const current = snapshot.exists ? snapshot.data() : null;
      if (!current || current.userId !== uid) {
        throw timerStateError('TIMER_NOT_FOUND', 404, 'Активний таймер не знайдено');
      }
      const decision = timerStopDecision(current, timerId);
      if (decision === 'idempotent') return current;
      if (decision !== 'stop') {
        throw timerStateError('TIMER_CHANGED', 409, 'Таймер уже змінено в іншій вкладці або на іншому пристрої');
      }
      const pending = stoppedTimer(current.active, body?.requestedAt, Timestamp.now());
      const next = {
        ...current,
        active: null,
        pending,
        revision: (Number(current.revision) || 0) + 1,
      };
      transaction.update(stateRef, {
        active: null,
        pending,
        revision: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return next;
    });
    return NextResponse.json({ state: serializeTimerState(state), serverNow: Date.now() });
  } catch (error) {
    if (error?.userTimer) return timerStateErrorResponse(error);
    return routeErrorResponse(error, {
      context: 'timer stop',
      fallbackMessage: 'Не вдалося зупинити таймер',
    });
  }
}
