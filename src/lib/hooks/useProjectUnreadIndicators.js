'use client';

import { useCallback, useMemo } from 'react';
import useWorkspaceStore from '@/store/useWorkspaceStore';

export function useProjectUnreadIndicators(userId, organizationId) {
  const notifications = useWorkspaceStore(state => state.notifications);
  const notificationActions = useWorkspaceStore(state => state.notificationActions);

  const unreadProjectIds = useMemo(() => new Set(
    userId
      ? notifications
        .filter(item => !item.read && item.organizationId === organizationId)
        .map(item => item.projectId)
        .filter(Boolean)
      : [],
  ), [notifications, organizationId, userId]);

  const markProjectRead = useCallback(async projectId => {
    if (!userId || !notificationActions?.markProjectRead) return;
    await notificationActions.markProjectRead(projectId, organizationId);
  }, [notificationActions, organizationId, userId]);

  return { unreadProjectIds, markProjectRead };
}
