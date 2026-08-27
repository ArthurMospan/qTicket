'use client';
import React, { forwardRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { searchEscalationState } from '@/lib/utils/searchScope.mjs';
import { paletteShortcutLabel } from '@/lib/utils/platformKeys.mjs';
import { useApplePlatform } from '@/lib/hooks/useApplePlatform';

/**
 * The search field inside the workspace header. Reached through `TopHeader`,
 * which is the only thing that renders it — it is not a general search input.
 *
 * @param {string} props.value Current query.
 * @param {(value: string) => void} props.onChange Fires with the new query.
 * @param {() => void} props.onClear Clears the field; renders the × while there is text.
 * @param {string} props.placeholder Placeholder text.
 * @param {number|null} props.localResultCount Final count produced by the current page.
 * @param {number} props.outsideResultCount Count returned by the broader search when local is empty.
 * @param {boolean} props.outsideLoading Whether that broader count is loading.
 * @param {(query: string) => void} props.onEscalate Opens the command palette with this query.
 * @param {(event: React.KeyboardEvent<HTMLInputElement>) => void} props.onKeyDown Optional caller keyboard handler after built-in escalation keys.
 * @param {string} props.className Placement in the parent only.
 */
export const HeaderSearch = forwardRef(({
  value = '',
  onChange,
  onClear,
  onEscalate,
  localResultCount = null,
  outsideResultCount = 0,
  outsideLoading = false,
  placeholder = 'Пошук...',
  className = '',
  onKeyDown,
  ...props
}, ref) => {
  const [escalationActive, setEscalationActive] = useState(false);
  // The hint used to read ⌘K on every machine, naming a key most of the team
  // does not have. The palette already answers to both.
  const apple = useApplePlatform();
  const paletteKeys = paletteShortcutLabel(apple);
  const escalation = searchEscalationState({
    query: value,
    localResultCount,
    outsideResultCount,
    outsideLoading,
  });

  const openWorkspaceSearch = () => onEscalate?.(escalation.term);

  const handleKeyDown = event => {
    if (event.key === 'ArrowDown' && escalation.active) {
      event.preventDefault();
      setEscalationActive(true);
      return;
    }
    if (event.key === 'Enter' && escalationActive && escalation.active) {
      event.preventDefault();
      openWorkspaceSearch();
      return;
    }
    if (event.key === 'Escape') setEscalationActive(false);
    onKeyDown?.(event);
  };

  return (
    <div className={`group/search relative flex h-[36px] min-w-0 w-full max-w-[320px] items-center border-b border-transparent transition-colors focus-within:border-line ${className}`}>
      <Search size={14} className="text-muted absolute left-0 pointer-events-none" />
      <input
        ref={ref}
        type="text"
        name="workspace-search"
        aria-label="Пошук у робочому просторі"
        value={value}
        onChange={(e) => {
          setEscalationActive(false);
          onChange?.(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="h-full min-w-0 w-full bg-transparent pl-[24px] pr-[76px] text-[13px] text-ink outline-none placeholder:text-muted max-md:pr-[28px]"
        {...props}
      />
      {value && (
        <button
          onClick={() => {
            onChange?.('');
            onClear?.();
          }}
          aria-label="Очистити пошук"
          className="absolute right-[42px] p-1 text-faint transition-colors hover:text-muted max-md:right-0"
        >
          <X size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={openWorkspaceSearch}
        aria-label="Відкрити розширений пошук у робочому просторі"
        aria-haspopup="dialog"
        // A hint, not a control, and a hint nobody needs while they are looking
        // at something else: it appears when the cursor reaches the field or
        // the field takes focus, and is invisible the rest of the time. It
        // keeps its box in the layout either way, so the placeholder does not
        // shift when it fades in.
        //
        // And it is not drawn at all on a phone. A keyboard shortcut printed
        // beside a field nobody can press it on is a piece of chrome that only
        // takes width away from what is being typed.
        className="pointer-events-none absolute right-0 rounded-[6px] px-[4px] py-[2px] text-[10px] font-semibold leading-none text-muted opacity-0 transition-opacity group-hover/search:pointer-events-auto group-hover/search:opacity-100 group-focus-within/search:pointer-events-auto group-focus-within/search:opacity-100 max-md:hidden"
      >
        {paletteKeys}
      </button>

      {escalation.active && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 w-full overflow-hidden rounded-[10px] border border-line bg-white shadow-lg">
          {escalation.localEmpty && (
            <button
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={openWorkspaceSearch}
              className="w-full px-[12px] py-[9px] text-left text-[12px] text-muted transition-colors hover:bg-canvas"
            >
              {escalation.outsideLoading
                ? 'Шукаємо поза цією сторінкою…'
                : `Знайдено поза цією сторінкою: ${escalation.outsideCount}`}
            </button>
          )}
          <button
            type="button"
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setEscalationActive(true)}
            onClick={openWorkspaceSearch}
            className={`flex w-full items-center justify-between border-t border-line px-[12px] py-[9px] text-left text-[12px] font-medium transition-colors ${
              escalationActive ? 'bg-canvas text-ink' : 'bg-white text-muted hover:bg-canvas hover:text-ink'
            }`}
          >
            {/* The extended search is the command palette, and it answers with
                tasks, projects, people and events — plus actions and places to
                go. «у задачах і проєктах» named two of six, so the row promised
                less than it does. */}
            <span className="min-w-0 truncate">Шукати «{escalation.term}» у всьому робочому просторі</span>
            <span className="ml-2 shrink-0 text-[10px] text-faint max-md:hidden">{paletteKeys}</span>
          </button>
        </div>
      )}
    </div>
  );
});

HeaderSearch.displayName = 'HeaderSearch';
export default HeaderSearch;
