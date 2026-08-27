'use client';

// src/components/WorkspaceCommandPalette.jsx
// The palette's one host: the global keystroke, the data it needs, and what
// running a command actually does. The catalogue and its ranking are pure
// (lib/utils/commandPalette.mjs) and the surface is a kit component; this is the
// only piece that knows about the router, the store and the search API.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { useSearch } from '@/lib/hooks/useSearch';
import { CommandPalette } from '@/components/ui';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import { buildCommands } from '@/lib/utils/commandPalette.mjs';
import { can } from '@/lib/utils/can';
import { timerTargetHref } from '@/lib/utils/timerNavigation.mjs';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';

const PERMISSIONS = ['create:project', 'manage:sprints'];

// QUI-103. ⌘K/Ctrl+K is the only global keystroke this file claims.
//
// "?" used to open the shortcuts sheet, guarded by a check that the event was
// not aimed at an input. That guard cannot hold: a question mark is ordinary
// punctuation, and every place it is typed which is not an `<input>`, a
// `<textarea>` or a contenteditable — a chat composer's own key handling, a
// dialog that has focus on itself, the page between two clicks — swallowed the
// character and put a help panel on screen instead. A printable character is
// nobody's shortcut. The sheet is not here either any more: a cheat sheet is
// something you look up, so it lives behind «?» in the sidebar with the help
// centre, and the palette is left holding only things that do something.

export default function WorkspaceCommandPalette() {
  const router = useRouter();
  const { projects, activeOrgId, orgRole, allOrgs } = useAppContext();
  const [open, setOpen] = useState(false);
  const [orgSwitcherOpen, setOrgSwitcherOpen] = useState(false);
  const { results, matches, loading, error, search, clear } = useSearch();

  const activeTimer = useWorkspaceStore(state => state.activeTimer);
  const stopTimer = useWorkspaceStore(state => state.stopTimer);
  const showToast = useWorkspaceStore(state => state.showToast);
  const paletteRequest = useWorkspaceStore(state => state.commandPaletteRequest);
  const openCommandPalette = useWorkspaceStore(state => state.openCommandPalette);

  const commands = useMemo(() => buildCommands({
    projects,
    allowedPermissions: PERMISSIONS.filter(permission => can(orgRole, permission)),
    hasActiveTimer: Boolean(activeTimer),
    organizationCount: allOrgs?.length || 1,
  }), [activeTimer, allOrgs?.length, orgRole, projects]);

  const closePalette = useCallback(() => {
    setOpen(false);
    clear();
  }, [clear]);

  // A request that predates this mount is not a request to open. The whole
  // authenticated tree is keyed by the active organization, so switching one
  // unmounts this component and mounts a new one — while the store, which is
  // not keyed, still holds the id of whatever opened the palette earlier in the
  // session. Reading "id > 0" as "open" therefore threw the palette on screen
  // every time somebody changed organization after having used ⌘K once.
  const handledRequestId = useRef(paletteRequest.id);
  useEffect(() => {
    if (paletteRequest.id === handledRequestId.current) return;
    handledRequestId.current = paletteRequest.id;
    queueMicrotask(() => setOpen(true));
  }, [paletteRequest.id]);

  useEffect(() => {
    const onKeyDown = event => {
      // A text field that has already answered this keystroke has answered it:
      // ⌘K inside the markdown editor inserts a link, and used to insert a link
      // *and* throw the palette over the top of what you were writing.
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (open) closePalette();
        else openCommandPalette();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closePalette, open, openCommandPalette]);

  const onQueryChange = useCallback((query, scope) => {
    if (query.trim().length < 2) clear();
    else search(query, activeOrgId, scope);
  }, [activeOrgId, clear, search]);

  // Choosing a command closes the palette and goes somewhere, and those are two
  // navigations: the palette hands its history entry back with `history.back()`,
  // which lands *after* a `router.push` issued in the same tick and undoes it.
  // That is why every row in «Перейти» — and every search result reached with
  // ↑↓ and Enter — appeared to do nothing at all. `navigateAfterOverlayClose`
  // holds the push until the entry is genuinely back.
  const onSelect = useCallback(async command => {
    if (command.href) {
      navigateAfterOverlayClose(() => router.push(command.href));
      return;
    }
    if (command.action === 'stop-timer') {
      // The minutes ride in the store, not in the URL — see `stopTimer`.
      try {
        const result = await stopTimer();
        if (result?.queued) showToast('Зупинку таймера збережено до відновлення мережі', 'warning');
        const href = timerTargetHref(result);
        if (href) navigateAfterOverlayClose(() => router.push(href));
      } catch (error) {
        showToast(error.message || 'Не вдалося зупинити таймер', 'error');
      }
      return;
    }
    if (command.action === 'switch-organization') setOrgSwitcherOpen(true);
  }, [router, showToast, stopTimer]);

  return (
    <>
      <CommandPalette
        isOpen={open}
        onClose={closePalette}
        commands={commands}
        issues={results}
        matches={matches}
        searching={loading}
        searchError={error?.message || ''}
        projects={projects}
        onQueryChange={onQueryChange}
        onSelect={onSelect}
        initialQuery={paletteRequest.query}
        initialScope={paletteRequest.scope}
        requestKey={paletteRequest.id}
      />
      {orgSwitcherOpen && <OrgSwitcherScreen onClose={() => setOrgSwitcherOpen(false)} />}
    </>
  );
}
