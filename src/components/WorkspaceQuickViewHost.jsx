'use client';

// One place in the workspace where a task or an event opens for reading.
//
// Mounted beside the toast host and the profile overlay, so any screen can call
// `openIssueQuickView(issue)` without owning a piece of modal state, and there
// is never more than one panel to close.

import IssueModal from '@/components/workspace/IssueModal';
import EventModal from '@/components/workspace/EventModal';
import useWorkspaceStore from '@/store/useWorkspaceStore';

export default function WorkspaceQuickViewHost() {
  const quickView = useWorkspaceStore(state => state.quickView);
  const closeQuickView = useWorkspaceStore(state => state.closeQuickView);

  if (!quickView) return null;
  if (quickView.kind === 'event') {
    return <EventModal event={quickView.record} onClose={closeQuickView} />;
  }
  return <IssueModal issue={quickView.record} onClose={closeQuickView} />;
}
