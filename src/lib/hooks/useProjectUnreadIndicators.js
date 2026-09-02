'use client';

import { useMemo } from 'react';
import useWorkspaceStore from '@/store/useWorkspaceStore';

// Which projects have unread records in the bell — the dot beside a project in
// the rail.
//
// The dot goes out when the records behind it are read, and nothing else puts
// it out. Walking into the project used to: the rail marked every unread record
// of the project read the moment its URL opened, which took the records of every
// other incident in that project with it — you opened one and the bell forgot
// the three you had not looked at — and it did so by reading the account's
// whole notification collection on every navigation. A record is read where its
// conversation is on screen (`useNotifications`), or by hand in the bell.
export function useProjectUnreadIndicators(userId, organizationId) {
  const notifications = useWorkspaceStore(state => state.notifications);

  const unreadProjectIds = useMemo(() => new Set(
    userId
      ? notifications
        .filter(item => !item.read && item.organizationId === organizationId)
        .map(item => item.projectId)
        .filter(Boolean)
      : [],
  ), [notifications, organizationId, userId]);

  return { unreadProjectIds };
}
