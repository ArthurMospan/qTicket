'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  toggleIssueId,
  toggleIssueScope,
  visibleSelectedIds,
} from '@/lib/utils/issueSelection.mjs';

export function useIssueSelection({ issues = [], order = [], scopeKey = '' }) {
  const pathname = usePathname();
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [anchorId, setAnchorId] = useState('');
  const routeScope = `${pathname}|${scopeKey}`;
  const previousScopeRef = useRef(routeScope);
  const activeSelectedIds = visibleSelectedIds(selectedIds, issues);
  const active = activeSelectedIds.size > 0;

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId('');
  }, []);

  useEffect(() => {
    if (previousScopeRef.current === routeScope) return;
    previousScopeRef.current = routeScope;
    clear();
  }, [clear, routeScope]);

  useEffect(() => {
    if (!active) return undefined;
    const clearOnEscape = event => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('keydown', clearOnEscape);
    return () => window.removeEventListener('keydown', clearOnEscape);
  }, [active, clear]);

  const toggle = useCallback((issueId, { shiftKey = false } = {}) => {
    // A plain click never creates a selection — that is what keeps opening a
    // task from turning into selecting one by accident. Shift+click does, and
    // has to: it was the documented way to select several tasks and it did
    // nothing at all, because the only door into selection mode was the list
    // kebab and this guard closed the other one. Holding shift is not an
    // accident, so the first shift+click starts the selection with one task and
    // the next one extends the range from it.
    if (!active && !shiftKey) return;
    setSelectedIds(current => toggleIssueId(current, issueId, order, anchorId, shiftKey));
    if (!shiftKey || order.indexOf(anchorId) < 0) setAnchorId(issueId);
  }, [active, anchorId, order]);

  const toggleScope = useCallback(scopeIds => {
    setSelectedIds(current => toggleIssueScope(current, scopeIds));
    const first = scopeIds?.[0];
    if (first) setAnchorId(first);
  }, []);

  const selectedIssues = useMemo(
    () => issues.filter(issue => activeSelectedIds.has(issue.id)),
    [activeSelectedIds, issues],
  );

  return {
    active,
    activeSelectedIds,
    selectedIssues,
    toggle,
    toggleScope,
    clear,
  };
}

export default useIssueSelection;
