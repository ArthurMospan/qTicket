'use client';
import React, { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  CircleDot,
  Flag,
  Folder,
  Search,
  Shapes,
  Users,
  Zap,
} from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import { getFilterControlWidth } from './FilterBar';
import UserAvatar from './DataDisplay/UserAvatar';
import PriorityIcon from './DataDisplay/PriorityIcon';

// UI Kit Select Component
// Named form-control sizes match Input and Button.
const CONTROL_SIZES = {
  sm: 'text-[12px]',
  md: 'text-[13px]',
  lg: 'text-[13px]',
};

// The trigger width is a floor for the dropdown, never a cap. Matching it
// exactly turned every compact inline control into an unreadable column — the
// issue attribute selects are ~110px wide, so a member list rendered there had
// nowhere to put a full name. The panel now sizes to its content between these
// two bounds, which only ever makes a dropdown wider than it was.
const DROPDOWN_MIN_WIDTH = 200;
const DROPDOWN_MAX_WIDTH = 360;
const FILTER_ROLE_ICONS = {
  type: Shapes,
  priority: Flag,
  sprint: Zap,
  status: CircleDot,
  date: CalendarIcon,
  member: Users,
  project: Folder,
  sort: ArrowUpDown,
};

function OptionIdentity({ option, size = 14 }) {
  if (!option?.user && !option?.avatar) return null;
  return (
    <span aria-hidden="true" className="shrink-0">
      <UserAvatar
        user={option.user || { name: option.label, avatar: option.avatar }}
        size={size}
      />
    </span>
  );
}

// One slot for whatever mark leads an option, 14px wide — the width of the
// lucide icon a type or a category option already draws.
//
// Without it each kind of mark set the text behind it: a 14px icon put the
// label at 34px from the edge of the control, a 16px priority halo at 36px, and
// an 8px status dot at 28px. Three stacked fields — Тип, Пріоритет, Статус —
// therefore started their values at three different places, which is what makes
// «Беклог» look pushed out of line with the two fields above it. The marks keep
// their own sizes; they are just centred in a slot of one width.
const MARK_SLOT = 'flex h-[14px] w-[14px] shrink-0 items-center justify-center';

function OptionMark({ color }) {
  if (!color) return null;
  return (
    <span aria-hidden="true" className={MARK_SLOT}>
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function OptionPriority({ option }) {
  if (!option?.priorityMark) return null;
  return (
    <span className={MARK_SLOT}>
      <PriorityIcon priority={option.priorityMark} />
    </span>
  );
}

function useDropdownPosition(isOpen, triggerRef, dropdownRef, gap = 4) {
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    minWidth: 0,
    maxWidth: DROPDOWN_MAX_WIDTH,
    visible: false,
  });

  useEffect(() => {
    if (!isOpen) return undefined;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const roomForPanel = window.innerWidth - viewportPadding * 2;
      const maxWidth = Math.min(DROPDOWN_MAX_WIDTH, roomForPanel);
      const minWidth = Math.min(Math.max(rect.width, DROPDOWN_MIN_WIDTH), roomForPanel);
      // Clamping `left` needs the width the panel actually took, which only the
      // laid-out element knows once `max-content` has resolved.
      const renderedWidth = Math.min(
        Math.max(dropdownRef.current?.offsetWidth || 0, minWidth),
        roomForPanel,
      );
      const dropdownHeight = dropdownRef.current?.offsetHeight || 280;
      const roomBelow = window.innerHeight - rect.bottom - viewportPadding;
      const roomAbove = rect.top - viewportPadding;
      const showAbove = roomBelow < dropdownHeight && roomAbove > roomBelow;
      const top = showAbove
        ? Math.max(viewportPadding, rect.top - dropdownHeight - gap)
        : Math.max(
          viewportPadding,
          Math.min(rect.bottom + gap, window.innerHeight - dropdownHeight - viewportPadding),
        );
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        Math.max(viewportPadding, window.innerWidth - renderedWidth - viewportPadding),
      );

      setPosition({ top, left, minWidth, maxWidth, visible: true });
    };

    // Twice: the first pass measures a panel that has not been given its
    // min-width yet, so its width — and with it the `left` clamp near the right
    // edge of the viewport — is only final on the second.
    updatePosition();
    const settle = requestAnimationFrame(updatePosition);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      cancelAnimationFrame(settle);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [dropdownRef, gap, isOpen, triggerRef]);

  return position;
}

// Single Select Component
/**
 * A dropdown. Not a native `<select>`: options carry avatars, colours and
 * glyphs, and the list is rendered in a portal so no pane can clip it.
 *
 * @param {string} props.value Selected option value.
 * @param {(value) => void} props.onChange Fires with the newly selected value.
 * @param {{value: string, label: string, icon?, color?, user?}[]} props.options The choices.
 * @param {'sm'|'md'|'lg'} props.size Control height token, shared with Button and Input.
 * @param {'default'|'ghost'|'inline'} props.variant How much chrome the trigger draws.
 * @param {boolean} props.disabled Unavailable: the trigger is dimmed and will not open.
 * @param {string} props.placeholder Trigger text while nothing is selected.
 * @param {boolean} props.compact Denser trigger, for attribute strips.
 * @param {boolean} props.searchable Puts a search box above the list, for a choice too long to scan.
 * @param {string} props.searchPlaceholder Placeholder inside that search box.
 * @param {React.ComponentType} props.triggerIcon Leading glyph on the trigger.
 * @param {string} props.filterRole Which filter this is; `FilterBar` decides the width from it.
 * @param {'default'|'detail'|'projects'|'stacked'} props.filterContext Which width scale that lookup uses.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.ariaLabel Accessible name when no visible label sits above.
 * @param {string} props.buttonClassName Placement of the trigger only.
 * @param {string} props.dropdownClassName Placement of the panel only.
 * @param {string} props.className Placement in the parent only.
 */
export function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Оберіть...',
  className = '',
  buttonClassName,
  dropdownClassName = '',
  disabled = false,
  variant = 'default',
  triggerIcon: TriggerIcon,
  compact = false,
  searchable = false,
  searchPlaceholder = 'Пошук...',
  size = 'lg',
  composition,
  filterRole,
  filterContext = 'default',
  ariaLabel,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const listboxId = useId();
  const dropdownPosition = useDropdownPosition(isOpen, containerRef, dropdownRef);
  const filterWidth = getFilterControlWidth(filterRole, filterContext);
  const defaultButtonClass = `bg-canvas hover:bg-line px-[12px] ${CONTROL_SIZES[size] ?? CONTROL_SIZES.lg}`;

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target) &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find(o => o.value === value);
  // Everything below the trigger — the keyboard, the highlight, the commit —
  // reads this list, so a Select without a search box is the same control with
  // the filter switched off. String(...) guards an option whose record is
  // missing the name it was built from.
  const shownOptions = searchable && search.trim()
    ? options.filter(o => String(o.label ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    : options;
  const selectedIndex = shownOptions.findIndex(o => o.value === value);
  const ResolvedTriggerIcon = TriggerIcon
    || (selectedOption?.icon ? null : FILTER_ROLE_ICONS[filterRole]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    dropdownRef.current
      ?.querySelector(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const open = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    setActiveIndex(shownOptions.length ? Math.max(0, Math.min(index, shownOptions.length - 1)) : -1);
    setIsOpen(true);
  };
  const close = ({ focusTrigger = true } = {}) => {
    setIsOpen(false);
    setActiveIndex(-1);
    setSearch('');
    if (focusTrigger) triggerRef.current?.focus();
  };
  const commit = index => {
    const option = shownOptions[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  // Full keyboard support: the control is the primary form input across the
  // whole app and previously could not be operated without a mouse at all.
  const handleKeyDown = event => {
    if (disabled) return;
    const { key } = event;
    if (!isOpen) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        event.preventDefault();
        open();
      }
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(current => Math.min(current + 1, shownOptions.length - 1));
    } else if (key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(current => Math.max(current - 1, 0));
    // Home and End move the caret inside the search box; only a Select without
    // one can spend them — and a space — on the list instead.
    } else if (key === 'Home' && !searchable) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (key === 'End' && !searchable) {
      event.preventDefault();
      setActiveIndex(shownOptions.length - 1);
    } else if (key === 'Enter' || (key === ' ' && !searchable)) {
      event.preventDefault();
      commit(activeIndex);
    } else if (key === 'Tab') {
      close({ focusTrigger: false });
    }
  };

  return (
    <div className={`relative ${filterWidth} ${className}`} ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        data-ui-size={variant === 'ghost' ? 'sm' : size}
        data-ui-composition={composition}
        onKeyDown={handleKeyDown}
        onClick={() => (isOpen ? close({ focusTrigger: false }) : open())}
        className={`ui-control w-full flex items-center justify-between text-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 disabled:cursor-not-allowed ${variant === 'ghost' ? `bg-transparent hover:bg-line !rounded-[8px] px-[10px] ${filterWidth ? 'w-full' : 'w-auto'} inline-flex gap-1.5` : (buttonClassName || defaultButtonClass)}`}
      >
        <div className={`flex items-center overflow-hidden ${compact ? 'gap-1' : 'gap-[8px]'}`}>
          {ResolvedTriggerIcon && <ResolvedTriggerIcon size={14} className="text-muted shrink-0" />}
          <OptionMark color={selectedOption?.dotColor} />
          <OptionPriority option={selectedOption} />
          <OptionIdentity option={selectedOption} />
          {selectedOption?.icon && (
            <selectedOption.icon size={14} className="text-muted shrink-0" />
          )}
          <span
            className={`truncate font-medium ${selectedOption?.badgeColor ? 'rounded-[4px] px-[6px] py-[1.5px] text-[10px]' : 'text-[13px] text-ink'}`}
            style={selectedOption?.badgeColor ? {
              color: selectedOption.badgeColor,
              backgroundColor: `${selectedOption.badgeColor}14`,
            } : undefined}
          >
            {selectedOption ? selectedOption.label : placeholder}
          </span>
        </div>
        <ChevronDown size={compact ? 12 : 14} className={`text-muted shrink-0 transition-transform ${compact ? 'ml-1' : 'ml-[8px]'} ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          data-qt-floating-overlay
          className={`fixed z-[1100] max-w-[calc(100vw-16px)] bg-white border border-line rounded-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] ${searchable ? 'pb-[6px]' : 'py-[6px]'} overflow-hidden ${dropdownClassName}`}
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: 'max-content',
            minWidth: dropdownPosition.minWidth,
            maxWidth: dropdownPosition.maxWidth,
            visibility: dropdownPosition.visible ? 'visible' : 'hidden',
          }}
        >
          {searchable && (
            <div className="shrink-0 border-b border-line p-[8px]">
              <div className="relative">
                <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="text"
                  autoFocus
                  value={search}
                  onChange={event => { setSearch(event.target.value); setActiveIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="w-full bg-canvas text-[13px] font-medium text-ink rounded-[8px] pl-[32px] pr-[10px] py-[6px] outline-none border border-transparent focus:border-line"
                />
              </div>
            </div>
          )}
          <div className="max-h-[240px] overflow-y-auto custom-scrollbar" role="listbox" id={listboxId}>
            {shownOptions.length === 0 ? (
              <div className="px-[12px] py-[16px] text-center text-[12px] font-medium text-muted">
                Нічого не знайдено
              </div>
            ) : shownOptions.map((opt, index) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={value === opt.value}
                data-option-index={index}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(index)}
                className={`w-full flex items-center justify-between px-[12px] h-[36px] text-[13px] transition-colors text-left ${index === activeIndex ? 'bg-canvas' : ''} ${value === opt.value ? 'bg-canvas font-bold' : 'font-medium'}`}
              >
                <div className="flex items-center gap-[8px]">
                  <OptionMark color={opt.dotColor} />
                  <OptionPriority option={opt} />
                  <OptionIdentity option={opt} />
                  {opt.icon && (
                    <opt.icon size={14} className={value === opt.value ? 'text-ink' : 'text-muted'} />
                  )}
                  <span
                    className={`truncate ${opt.badgeColor ? 'rounded-[4px] px-[6px] py-[1.5px] text-[10px] font-medium' : ''}`}
                    style={opt.badgeColor ? {
                      color: opt.badgeColor,
                      backgroundColor: `${opt.badgeColor}14`,
                    } : undefined}
                  >
                    {opt.label}
                  </span>
                </div>
                {value === opt.value && <Check size={14} className="text-ink shrink-0 ml-2" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Multi Select Component with Search
/**
 * `Select` that keeps several values at once, with a search box and a
 * select-all row once the list is long enough to need them.
 *
 * @param {string[]} props.value Selected option values.
 * @param {(values: string[]) => void} props.onChange Fires with the new selection.
 * @param {{value: string, label: string, icon?, color?, user?, priorityMark?}[]} props.options The choices.
 * @param {'sm'|'md'|'lg'} props.size Control height token.
 * @param {'default'|'ghost'|'inline'} props.variant How much chrome the trigger draws.
 * @param {boolean} props.disabled Unavailable: the trigger is dimmed and will not open.
 * @param {string} props.placeholder Trigger text while nothing is selected.
 * @param {string} props.searchPlaceholder Placeholder inside the search box.
 * @param {string} props.selectAllLabel Label of the select-all row.
 * @param {number} props.maxSelected Maximum choices that may be selected at once.
 * @param {boolean} props.showSelectedAvatars Draws the chosen people as a stack of faces on the trigger.
 * @param {React.ReactNode} props.footer Content pinned under the list — a hint, or a create action.
 * @param {boolean} props.compact Denser trigger, for attribute strips.
 * @param {React.ComponentType} props.triggerIcon Leading glyph on the trigger.
 * @param {string} props.filterRole Which filter this is; `FilterBar` decides the width from it.
 * @param {'default'|'detail'|'projects'|'stacked'} props.filterContext Which width scale that lookup uses.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.ariaLabel Accessible name when no visible label sits above.
 * @param {string} props.buttonClassName Placement of the trigger only.
 * @param {string} props.dropdownClassName Placement of the panel only.
 * @param {string} props.className Placement in the parent only.
 */
export function MultiSelect({
  value = [], // array of selected values
  onChange,
  options = [], // { value, label, icon?, dotColor? }
  placeholder = 'Оберіть...',
  searchPlaceholder = 'Пошук...',
  className = '',
  buttonClassName,
  dropdownClassName = '',
  disabled = false,
  variant = 'default',
  triggerIcon: TriggerIcon,
  selectAllLabel = '',
  maxSelected,
  size = 'lg',
  composition,
  filterRole,
  filterContext = 'default',
  compact = false,
  ariaLabel,
  // Renders the selected people as an overlapping avatar stack in the trigger
  // instead of "Обрано (N)". Task attributes need to read the assignees at a
  // glance, which a bare count cannot do.
  showSelectedAvatars = false,
  // Block pinned below the option list, inside the dropdown. The project team
  // picker uses it to invite someone who is not in the organization yet: the
  // choice "pick an existing member" and "invite a new one" is one decision and
  // belongs in one surface.
  footer = null,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);
  const dropdownRef = useRef(null);
  const dropdownPosition = useDropdownPosition(isOpen, containerRef, dropdownRef);
  const filterWidth = getFilterControlWidth(filterRole, filterContext);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target) &&
        !dropdownRef.current?.contains(event.target)
      ) {
        setIsOpen(false);
        setSearch(''); // clear search on close
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // String(...) guard: an option built from a record with a missing name used
  // to throw here and take the whole page down.
  const filteredOptions = options.filter(o =>
    String(o.label ?? '').toLowerCase().includes(search.toLowerCase()));
  const allValues = options.map(option => option.value);
  const selectionLimit = Number.isInteger(maxSelected) && maxSelected >= 0
    ? maxSelected
    : null;
  const allSelectionValues = selectionLimit === null
    ? allValues
    : allValues.slice(0, selectionLimit);
  const allSelected = allSelectionValues.length > 0
    && allSelectionValues.every(optionValue => value.includes(optionValue));
  const atSelectionLimit = selectionLimit !== null && value.length >= selectionLimit;

  const handleSelect = (val) => {
    if (value.includes(val)) {
      onChange(value.filter(v => v !== val));
    } else if (!atSelectionLimit) {
      onChange([...value, val]);
    }
  };

  const selectedOptions = options.filter(o => value.includes(o.value));
  const selectedLabels = selectedOptions.map(o => o.label);
  const singleSelectedOption = value.length === 1 ? selectedOptions[0] : null;
  const avatarOptions = showSelectedAvatars
    ? selectedOptions.filter(option => option.user || option.avatar)
    : [];
  const ResolvedTriggerIcon = TriggerIcon || FILTER_ROLE_ICONS[filterRole];

  let triggerText = placeholder;
  if (value.length === 1) triggerText = selectedLabels[0];
  else if (value.length > 1) {
    triggerText = showSelectedAvatars
      ? `${selectedLabels[0]} +${value.length - 1}`
      : `Обрано (${value.length})`;
  }
  const defaultButtonClass = `bg-canvas hover:bg-line px-[12px] ${CONTROL_SIZES[size] ?? CONTROL_SIZES.lg}`;

  return (
    <div className={`relative ${filterWidth} ${className}`} ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        data-ui-size={variant === 'ghost' ? 'sm' : size}
        data-ui-composition={composition}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        onKeyDown={event => {
          if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
            setSearch('');
          }
        }}
        onClick={() => setIsOpen(!isOpen)}
        className={`ui-control w-full flex items-center justify-between text-ink transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-50 disabled:cursor-not-allowed ${variant === 'ghost' ? `bg-transparent hover:bg-line !rounded-[8px] px-[10px] ${filterWidth ? 'w-full' : 'w-auto'} inline-flex gap-1.5` : (buttonClassName || defaultButtonClass)}`}
      >
        <div className={`flex items-center overflow-hidden ${compact ? 'gap-1' : 'gap-[8px]'}`}>
          {ResolvedTriggerIcon && <ResolvedTriggerIcon size={14} className="text-muted shrink-0" />}
          {avatarOptions.length > 1 ? (
            <span aria-hidden="true" className="flex shrink-0 items-center -space-x-1.5">
              {avatarOptions.slice(0, 3).map(option => (
                <span key={option.value} className="rounded-full ring-2 ring-white">
                  <UserAvatar user={option.user || { name: option.label, avatar: option.avatar }} size="xs" />
                </span>
              ))}
            </span>
          ) : (
            <OptionIdentity option={showSelectedAvatars ? (avatarOptions[0] || singleSelectedOption) : singleSelectedOption} />
          )}
          <span className="text-[13px] truncate font-medium text-ink">
            {triggerText}
          </span>
        </div>
        <ChevronDown size={compact ? 12 : 14} className={`text-muted shrink-0 transition-transform ${compact ? 'ml-1' : 'ml-[8px]'} ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          data-qt-floating-overlay
          className={`fixed z-[1100] max-w-[calc(100vw-16px)] bg-white border border-line rounded-[12px] shadow-[0_8px_30px_rgba(0,0,0,0.12)] overflow-hidden flex flex-col ${dropdownClassName}`}
          style={{
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: 'max-content',
            minWidth: dropdownPosition.minWidth,
            maxWidth: dropdownPosition.maxWidth,
            visibility: dropdownPosition.visible ? 'visible' : 'hidden',
          }}
        >
          <div className="p-[8px] border-b border-line shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-[10px] top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  event.stopPropagation();
                  setIsOpen(false);
                  setSearch('');
                }}
                placeholder={searchPlaceholder}
                className="w-full bg-canvas text-[13px] font-medium text-ink rounded-[8px] pl-[32px] pr-[10px] py-[6px] outline-none border border-transparent focus:border-line"
              />
            </div>
          </div>
          <div className="max-h-[220px] overflow-y-auto custom-scrollbar p-[6px]">
            {selectAllLabel && options.length > 0 && (
              <button
                type="button"
                aria-pressed={allSelected}
                onClick={() => {
                  if (allSelected) {
                    onChange(value.filter(selectedValue => !allValues.includes(selectedValue)));
                    return;
                  }
                  const nextValues = [...new Set([...value, ...allValues])];
                  onChange(selectionLimit === null
                    ? nextValues
                    : nextValues.slice(0, selectionLimit));
                }}
                className="mb-1 flex h-[34px] w-full items-center gap-[10px] rounded-[8px] border-b border-line px-[8px] text-left transition-colors hover:bg-canvas"
              >
                <div className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${allSelected ? 'border-ink bg-ink' : 'border-line-strong bg-white'}`}>
                  {allSelected && <Check size={12} className="text-white" />}
                </div>
                <span className="truncate text-[13px] font-bold text-ink">{selectAllLabel}</span>
              </button>
            )}
            {filteredOptions.length === 0 ? (
              <div className="px-[12px] py-[16px] text-center text-[12px] font-medium text-muted">
                Нічого не знайдено
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = value.includes(opt.value);
                const optionDisabled = !isSelected && atSelectionLimit;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={optionDisabled}
                    onClick={() => handleSelect(opt.value)}
                    className="w-full flex items-center gap-[10px] px-[8px] h-[32px] rounded-[8px] hover:bg-canvas transition-colors text-left disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                  >
                    <div className={`w-[16px] h-[16px] rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${isSelected ? 'bg-ink border-ink' : 'border-line-strong bg-white'}`}>
                      {isSelected && <Check size={12} className="text-white" />}
                    </div>
                    <OptionMark color={opt.dotColor} />
                    <OptionPriority option={opt} />
                    <OptionIdentity option={opt} />
                    {opt.icon && (
                      <opt.icon size={14} className={isSelected ? 'text-ink' : 'text-muted'} />
                    )}
                    <span className={`text-[13px] truncate ${isSelected ? 'font-bold text-ink' : 'font-medium text-ink'}`}>
                      {opt.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-line p-[8px]">
              {footer}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
