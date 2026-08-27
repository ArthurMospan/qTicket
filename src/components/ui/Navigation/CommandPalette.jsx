'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell, Building2, ChevronRight, Folder,
  PieChart, Plus, Search, Settings, Square, Sun, User, Users, X, Zap,
} from 'lucide-react';
import { CalendarIcon, ChatIcon, TaskIcon } from '@/lib/design/icons';
import Dialog from '../Dialog';
import {
  flattenGroups,
  groupCommands,
  issueCommands,
  rankCommands,
  searchCommands,
} from '@/lib/utils/commandPalette.mjs';
import { normalizeSearchScope, shouldRemoveSearchScope } from '@/lib/utils/searchScope.mjs';

// ─── UI Kit: CommandPalette ──────────────────────────────────────────────────
// One keystroke to anywhere. The workspace already had a route table, a project
// list and a search API; what it did not have was a way to reach any of them
// without three clicks through a sidebar.
//
// The catalogue and its ranking live in lib/utils/commandPalette.mjs so they can
// be asserted without a browser; this file is the surface.

const ICONS = {
  folder: Folder,
  check: TaskIcon,
  sun: Sun,
  message: ChatIcon,
  calendar: CalendarIcon,
  zap: Zap,
  users: Users,
  chart: PieChart,
  settings: Settings,
  plus: Plus,
  stop: Square,
  bell: Bell,
  building: Building2,
  issue: TaskIcon,
  user: User,
};

/**
 * The workspace command palette.
 *
 * @param {boolean} props.isOpen Whether it is on screen.
 * @param {() => void} props.onClose Closes it.
 * @param {object[]} props.commands Catalogue from `buildCommands`.
 * @param {object[]} props.issues Search results to append as their own group.
 * @param {{people: object[], projects: object[], events: object[]}} props.matches The other kinds search found — people, projects, calendar events.
 * @param {boolean} props.searching Whether results are still loading.
 * @param {string} props.searchError An actionable search failure, if the request failed.
 * @param {(query: string) => void} props.onQueryChange Called as the query changes.
 * @param {(command: object) => void} props.onSelect Runs the chosen command.
 * @param {object[]} props.projects Projects, used to name the project a found task belongs to.
 * @param {string} props.initialQuery Query supplied by the page that opened the palette.
 * @param {{type: 'project', projectId: string, label: string}|null} props.initialScope Removable page scope.
 * @param {number} props.requestKey Distinguishes repeated launches with the same query.
 */
export default function CommandPalette({
  isOpen,
  onClose,
  commands = [],
  issues = [],
  matches,
  searching = false,
  searchError = '',
  onQueryChange,
  onSelect,
  projects = [],
  initialQuery = '',
  initialScope = null,
  requestKey = 0,
}) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      // No headline. «Команди» sat above a field that already says what it is
      // and a list whose every group is captioned — a word spent on naming the
      // window to somebody who just opened it on purpose. The name stays for a
      // screen reader, which does need it announced.
      ariaLabel="Команди й пошук"
      size="md"
      presentation="dialog"
      showCloseButton={false}
      bodyPadding="flush"
    >
      {/* The body only exists while the palette is open, which is what makes
          "reopening starts clean" a property of mounting rather than an effect
          that resets state after the fact. */}
      {isOpen && (
        <PaletteBody
          key={requestKey}
          onClose={onClose}
          commands={commands}
          issues={issues}
          matches={matches}
          searching={searching}
          searchError={searchError}
          projects={projects}
          onQueryChange={onQueryChange}
          onSelect={onSelect}
          initialQuery={initialQuery}
          initialScope={initialScope}
        />
      )}
    </Dialog>
  );
}

function PaletteBody({
  onClose,
  commands,
  issues,
  matches,
  searching,
  searchError,
  projects,
  onQueryChange,
  onSelect,
  initialQuery,
  initialScope,
}) {
  const [query, setQuery] = useState(() => String(initialQuery || ''));
  const [scope, setScope] = useState(() => normalizeSearchScope(initialScope));
  const [cursor, setCursor] = useState(0);
  const listRef = useRef(null);

  const groups = useMemo(() => groupCommands([
    ...rankCommands(commands, query),
    ...issueCommands(issues, projects),
    ...searchCommands(matches),
  ]), [commands, issues, matches, projects, query]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  // The flat order is what the arrow keys walk, so each row asks the flat list
  // for its own position rather than a counter incremented while rendering.
  const indexById = useMemo(
    () => new Map(flat.map((command, index) => [command.id, index])),
    [flat],
  );

  useEffect(() => { onQueryChange?.(query, scope); }, [onQueryChange, query, scope]);

  // Keep the highlighted row in view when the keyboard moves past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-command-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor, groups]);

  const run = command => {
    if (!command) return;
    onSelect?.(command);
    onClose?.();
  };

  const handleKeyDown = event => {
    if (shouldRemoveSearchScope({ key: event.key, query, scope })) {
      event.preventDefault();
      setScope(null);
      setCursor(0);
    } else if (event.key === 'ArrowDown' || (event.key === 'n' && event.ctrlKey)) {
      event.preventDefault();
      setCursor(index => (flat.length ? (index + 1) % flat.length : 0));
    } else if (event.key === 'ArrowUp' || (event.key === 'p' && event.ctrlKey)) {
      event.preventDefault();
      setCursor(index => (flat.length ? (index - 1 + flat.length) % flat.length : 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(flat[cursor]);
    }
  };

  return (
    <>
      <div className="flex items-center gap-[10px] border-b border-line px-[16px]">
        <Search size={16} className="shrink-0 text-muted" />
        {scope && (
          <button
            type="button"
            onClick={() => { setScope(null); setCursor(0); }}
            aria-label={`Зняти область: ${scope.label}`}
            className="flex max-w-[190px] shrink-0 items-center gap-[4px] rounded-full bg-canvas px-[8px] py-[4px] text-[11px] font-medium text-muted transition-colors hover:text-ink"
          >
            <span className="truncate">{scope.label}</span>
            <X size={11} className="shrink-0" />
          </button>
        )}
        <input
          // Mounted only while open, so this is the focus without an effect.
          autoFocus
          value={query}
          onChange={event => { setQuery(event.target.value); setCursor(0); }}
          onKeyDown={handleKeyDown}
          // «Куди піти або що зробити…» explained the palette to somebody who
          // had already opened it. The field is a search field; the groups
          // under it say what can be found.
          placeholder="Пошук…"
          aria-label="Пошук команд"
          aria-controls="command-palette-list"
          className="h-[48px] w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-faint"
        />
        {searching && (
          <span className="h-[14px] w-[14px] shrink-0 animate-spin rounded-full border-2 border-line border-t-ink" />
        )}
      </div>

      <div
        ref={listRef}
        id="command-palette-list"
        role="listbox"
        aria-label="Команди"
        className="max-h-[min(56dvh,420px)] overflow-y-auto overscroll-contain py-[6px]"
      >
        {searchError && (
          <p role="alert" className="px-[16px] py-[10px] text-center text-[12px] text-danger">
            Не вдалося виконати пошук. Перевірте зʼєднання та повторіть.
          </p>
        )}
        {/* "Нічого не знайдено" while the request is still in flight is a
            wrong answer, not a slow one — and it is the answer the palette gave
            for the whole 250ms debounce plus the round trip. The spinner in the
            field says the same thing to somebody watching the caret; this says
            it to somebody watching the list. */}
        {!flat.length && !searchError && (
          <p className="px-[16px] py-[28px] text-center text-[13px] text-muted">
            {searching ? 'Шукаємо…' : `Нічого не знайдено за «${query}»`}
          </p>
        )}

        {groups.map(group => (
          <div key={group.group} className="pb-[4px]">
            <p className="ui-type-eyebrow px-[16px] pb-[4px] pt-[8px] uppercase tracking-wider text-faint">
              {group.label}
            </p>
            {group.items.map(command => {
              const index = indexById.get(command.id) ?? 0;
              const Icon = ICONS[command.icon] || ChevronRight;
              const active = index === cursor;
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  data-command-active={active}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => run(command)}
                  className={`flex w-full items-center gap-[12px] px-[16px] py-[9px] text-left transition-colors ${
                    active ? 'bg-canvas' : 'bg-transparent'
                  }`}
                >
                  <Icon size={16} className={active ? 'text-ink' : 'text-muted'} />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                    {command.label}
                  </span>
                  {command.hint && (
                    <span className="shrink-0 truncate text-[12px] text-muted">{command.hint}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-[14px] border-t border-line px-[16px] py-[8px] text-[11px] text-faint">
        <span>↑↓ вибір</span>
        <span>↵ відкрити</span>
        <span>Esc закрити</span>
      </div>
    </>
  );
}
