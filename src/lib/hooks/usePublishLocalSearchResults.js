'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import useWorkspaceStore from '@/store/useWorkspaceStore';

// Pages own their local filters, so they publish only the final count. The
// header can then decide whether a workspace search is needed without copying
// every page's filtering rules or issuing a broad Firestore search on every
// keystroke.
export function usePublishLocalSearchResults(query, count) {
  const pathname = usePathname();

  useEffect(() => {
    const feedback = {
      pathname,
      query: String(query || ''),
      count: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0,
    };
    useWorkspaceStore.getState().setLocalSearchFeedback(feedback);

    return () => {
      const current = useWorkspaceStore.getState().localSearchFeedback;
      if (current?.pathname === pathname) {
        useWorkspaceStore.getState().setLocalSearchFeedback(null);
      }
    };
  }, [count, pathname, query]);
}
