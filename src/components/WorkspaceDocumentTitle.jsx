'use client';

// src/components/WorkspaceDocumentTitle.jsx
// The single owner of document.title inside the authenticated workspace.
//
// It reads the route, the breadcrumb trail and the unread chat count — all
// already in the store — and writes one string. Nothing else in the app touches
// document.title, which is what lets the unread badge and the page name coexist
// instead of overwriting each other.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { decorateTitle, workspaceDocumentTitle } from '@/lib/utils/documentTitle.mjs';

// How long each half of the blink lasts while the tab is in the background.
const BLINK_MS = 1400;

export default function WorkspaceDocumentTitle() {
  const pathname = usePathname();
  const { projects, activeOrg } = useAppContext();
  const breadcrumbs = useWorkspaceStore(state => state.breadcrumbs);
  const unread = useWorkspaceStore(state => state.unreadChatCount);

  const baseTitle = workspaceDocumentTitle({
    pathname,
    breadcrumbs,
    projects,
    organizationName: activeOrg?.name,
  });

  useEffect(() => {
    let alternate = false;
    let desiredTitle = baseTitle;
    const render = () => {
      // The alternation only runs while the tab is hidden. Blinking a title the
      // reader is currently looking at is noise, not information.
      alternate = unread && document.hidden ? !alternate : false;
      desiredTitle = decorateTitle(baseTitle, { unread, alternate });
      if (document.title !== desiredTitle) document.title = desiredTitle;
    };
    render();

    // A search-param-only App Router navigation can commit the root metadata
    // after this effect has already written the organization-aware title. That
    // used to flash the correct organization and then leave the tab named only
    // «QuickTeam». The workspace is the declared single owner, so restore its
    // current value whenever Next updates <head> during a transition.
    const headObserver = new MutationObserver(() => {
      if (document.title !== desiredTitle) document.title = desiredTitle;
    });
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const timer = unread ? window.setInterval(render, BLINK_MS) : null;
    if (unread) document.addEventListener('visibilitychange', render);
    return () => {
      if (timer) window.clearInterval(timer);
      if (unread) document.removeEventListener('visibilitychange', render);
      headObserver.disconnect();
    };
  }, [baseTitle, unread]);

  return null;
}
