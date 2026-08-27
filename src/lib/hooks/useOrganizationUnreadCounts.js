'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import useWorkspaceStore from '@/store/useWorkspaceStore';

const inFlightRequests = new Map();

// Скільки чекати, перш ніж перерахувати непрочитане після зміни в потоці.
//
// Кожен новий запис у стрічці сповіщень оголошував «перерахуй». Поки в чаті
// пишуть, це один запит на секунду — за серію на десять повідомлень десять
// однакових перерахунків, з яких дев'ять уже застаріли, поки летіли. Серія
// коштує один. Фокус вікна, повернення в мережу і повернення на вкладку
// рахують одразу: там подія одна й людина її чекає.
const INVALIDATION_COALESCE_MS = 800;

function loadUnreadCounts(userId) {
  if (!inFlightRequests.has(userId)) {
    const request = authenticatedRequest(
      '/api/notifications/unread-counts',
      { cache: 'no-store' },
      'Не вдалося порахувати непрочитані сповіщення',
    ).finally(() => {
      if (inFlightRequests.get(userId) === request) inFlightRequests.delete(userId);
    });
    inFlightRequests.set(userId, request);
  }
  return inFlightRequests.get(userId);
}

export function invalidateOrganizationUnreadCounts() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('qt:notification-counts-invalidated'));
  }
}

export function useOrganizationUnreadCounts({ enabled = true } = {}) {
  const { currentUser } = useAppContext();
  const userId = currentUser?.id || currentUser?.uid || null;
  const requestGeneration = useRef(0);
  const counts = useWorkspaceStore(state => state.notificationUnreadByOrg);
  const loading = useWorkspaceStore(state => state.notificationUnreadByOrgLoading);
  const error = useWorkspaceStore(state => state.notificationUnreadByOrgError);
  const setCounts = useWorkspaceStore(state => state.setNotificationUnreadByOrg);
  const clearCounts = useWorkspaceStore(state => state.clearNotificationUnreadByOrg);

  const refresh = useCallback(async () => {
    if (!enabled || !userId) return null;
    const generation = ++requestGeneration.current;
    try {
      const result = await loadUnreadCounts(userId);
      if (generation !== requestGeneration.current) return null;
      const nextCounts = result?.counts && typeof result.counts === 'object' ? result.counts : {};
      setCounts(nextCounts, null);
      return nextCounts;
    } catch (requestError) {
      if (generation === requestGeneration.current) setCounts(null, requestError);
      return null;
    }
  }, [enabled, setCounts, userId]);

  useEffect(() => {
    requestGeneration.current += 1;
    if (!enabled || !userId) {
      clearCounts();
      return undefined;
    }

    refresh();
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    let coalesceTimer = null;
    const refreshAfterBurst = () => {
      if (coalesceTimer) return;
      coalesceTimer = window.setTimeout(() => {
        coalesceTimer = null;
        refresh();
      }, INVALIDATION_COALESCE_MS);
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('qt:notification-counts-invalidated', refreshAfterBurst);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      requestGeneration.current += 1;
      if (coalesceTimer) window.clearTimeout(coalesceTimer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('qt:notification-counts-invalidated', refreshAfterBurst);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [clearCounts, enabled, refresh, userId]);

  return { counts, loading, error, refresh };
}
