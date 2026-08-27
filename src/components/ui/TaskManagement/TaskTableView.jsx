'use client';

// ─── UI Kit: Task Table View ─────────────────────────────────────────────────
// The third reading of a board's tasks: a grid you can edit in place.
//
// This is deliberately not `DataTable`. That one is the analytics table — a
// presentational grid of figures whose rows are links and which folds into a
// stack of cards below the breakpoint, because six columns of numbers cannot be
// read on a phone. A table of tasks wants the opposite of almost all of that: a
// header that stays put, an identity column that stays put, horizontal scroll
// rather than folding, a control inside every cell, row selection and sort per
// column. The two share the `<table>` tag and nothing else. See
// docs/UI_KIT_CONTRACT.md.
//
// A cell never changes shape when you use it. The first version swapped the
// value for a mounted `Select`, which is taller than a row and carries its own
// padding, so clicking anything shoved the grid around under the cursor. Now
// the value *is* the trigger: the list opens over the table and the cell stays
// exactly as it was. That only became affordable once `ContextMenu` stopped
// listening to the document while closed.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Columns3, Lock } from 'lucide-react';
import { CalendarIcon, TaskIcon } from '@/lib/design/icons';
import Button from '@/components/ui/Button';
import Checkbox from '@/components/ui/Forms/Checkbox';
import ContextMenu from '@/components/ui/ContextMenu';
import Counter from '@/components/ui/DataDisplay/Counter';
import EmptyState from '@/components/ui/Feedback/EmptyState';
import { Input } from '@/components/ui/Input';
import Pill from '@/components/ui/DataDisplay/Pill';
import PriorityIcon from '@/components/ui/DataDisplay/PriorityIcon';
import Surface from '@/components/ui/Surface';
import Tag from '@/components/ui/DataDisplay/Tag';
import TypeBadge from '@/components/ui/DataDisplay/TypeBadge';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { DatePicker } from '@/components/ui/Forms/DatePicker';
import BulkActionBar from './BulkActionBar';
import { useAppContext } from '@/lib/context/AppContext';
import { useIssueSelection } from '@/lib/hooks/useIssueSelection';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import { isDueDateOverdue, parseDueDate } from '@/lib/utils/date';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { openBlockerIssues } from '@/lib/utils/issueExecution.mjs';
import { existingParentIssueId } from '@/lib/utils/issueHierarchyModel.mjs';
import { isIssueUnread, unreadActivityLabel } from '@/lib/utils/issueReadState.mjs';
import { columnOf, compareIssues } from '@/lib/utils/optimistic.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import {
  ensureSystemPriorities,
  NO_PRIORITY_ID,
  priorityPresentation,
  selectablePriorities,
} from '@/lib/utils/priorities.mjs';
import {
  commentCountOf,
  memberId,
  memberName,
  nextTaskTableSort,
  PINNED_TASK_TABLE_COLUMNS,
  TASK_TABLE_COLUMNS,
  taskTableComparator,
  taskTableContext,
  visibleTaskTableColumns,
} from '@/lib/utils/taskTable.mjs';

// The checkbox gutter on the left and the column-picker gutter on the right.
// Pinned columns are laid out from the first, so the number lives here rather
// than in three class strings.
const SELECT_COLUMN_WIDTH = 40;
const TOOLS_COLUMN_WIDTH = 40;
const ALIGNMENT = { left: 'text-left', right: 'text-right', center: 'text-center' };

// How many rows are drawn before the table asks. Every task the board loaded is
// already in memory — this is about the DOM, not about reads: a thousand rows
// times six columns is six thousand cells and a page that stutters when you
// scroll it. Fifty fills any screen twice over.
const ROWS_PER_PAGE = 50;

// The header's rule is a shadow, not a border. `border-collapse` hands a
// cell's border to the table, and a table does not scroll with a sticky cell —
// so the line under a pinned header vanished the moment anybody scrolled. The
// grey is the other half of it: a white header over white rows had nothing but
// that missing line to separate them.
const HEADER_CELL = 'h-9 bg-canvas p-0 shadow-[inset_0_-1px_0_var(--color-line)]';
const HEADER_BOX = 'flex h-9 min-w-0 items-center px-[10px]';

// The one mark a status or a label has, in a menu row and nowhere else drawn
// by hand.
function ColourDot({ color }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: color || 'var(--color-muted)' }}
    />
  );
}

function formatDay(value, timeZone) {
  const date = parseDueDate(value, { timeZone });
  if (!date) return '';
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', timeZone });
}

function formatStamp(value, timeZone) {
  if (!value) return '';
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', timeZone });
}

function formatMinutes(minutes) {
  const total = Number(minutes) || 0;
  if (!total) return '';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}хв`;
  return rest ? `${hours}г ${rest}хв` : `${hours}г`;
}

// A field you type into is the one editor that cannot be a menu. It replaces
// the value in place, at exactly the row's height, with no border and no fill —
// so the only thing that changes when you click is that there is now a caret.
function TextCellEditor({ value, type = 'text', suffix, ariaLabel, onCommit, onCancel }) {
  const inputRef = useRef(null);
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select?.();
  }, []);

  // Enter and Escape both take the field off the screen, and losing focus is
  // itself a save. Without this latch, Escape saved the very draft it was asked
  // to discard, and Enter wrote twice.
  const settledRef = useRef(false);
  const settle = handler => (...args) => {
    if (settledRef.current) return;
    settledRef.current = true;
    handler(...args);
  };
  const commit = settle(() => onCommit(draft));
  const cancel = settle(() => onCancel());

  return (
    <Input
      ref={inputRef}
      size="sm"
      composition="table-cell"
      type={type}
      suffix={suffix}
      value={draft}
      aria-label={ariaLabel}
      min={type === 'number' ? 0 : undefined}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
    />
  );
}

/**
 * A board's tasks as an editable grid: chosen columns, sorted by any of them,
 * with every value changeable in its own cell. The arrangement is not held
 * here — it arrives as props and lives in the address, so a configured table is
 * a link somebody can send.
 *
 * @param {object[]} props.issues The tasks to show, already filtered.
 * @param {object[]} props.allIssues Every task in scope, for resolving blockers.
 * @param {object[]} props.issueLinks Relations between tasks, for the blocked column.
 * @param {object[]} props.members People who can be assigned.
 * @param {object[]} props.labels Label definitions, for the labels column.
 * @param {object[]} props.sprints Sprint definitions, for the sprint column.
 * @param {string} props.projectId The project these tasks belong to.
 * @param {string[]} props.columns Which columns are on; empty means the default set.
 * @param {string} props.sort Column the rows are ordered by, or `manual` for the board's own order.
 * @param {'asc'|'desc'} props.dir Direction of that sort.
 * @param {(next: {sort: string, dir: string}) => void} props.onSortChange Fires when a column header is clicked.
 * @param {(columnId: string) => void} props.onColumnsChange Toggles one column on or off. Omit to hide the columns control.
 * @param {(issue: object) => void} props.onOpenIssue Opens a task for reading — the quick modal. Falls back to a link to its page.
 * @param {string} props.activeTimerIssueId The task whose timer is running, if any.
 * @param {(issueId: string, patch: object) => Promise<unknown>} props.onUpdateIssue Saves one cell. Omit to make the table read-only.
 * @param {(action: string, value: unknown, issues: object[]) => Promise<unknown>} props.onBulkUpdate Applies one bulk action to the selected rows.
 * @param {{done: number, total: number}} props.bulkProgress How far the running bulk action has got.
 * @param {boolean} props.canArchive Whether the current role may archive selected tasks.
 * @param {string} props.selectionScopeKey Clears selection when a route or filter scope changes.
 * @param {string} props.emptyTitle Headline of the empty state.
 * @param {string} props.emptyDescription Sentence under it.
 */
export default function TaskTableView({
  issues = [],
  allIssues = issues,
  issueLinks = [],
  members = [],
  labels = [],
  sprints = [],
  projectId,
  columns = [],
  sort = 'manual',
  dir = 'asc',
  onSortChange,
  onColumnsChange,
  onOpenIssue,
  activeTimerIssueId,
  onUpdateIssue,
  onBulkUpdate,
  bulkProgress = null,
  canArchive = false,
  selectionScopeKey = '',
  emptyTitle = 'Інцидентів не знайдено',
  emptyDescription = 'Змініть фільтри або створіть новий інцидент.',
}) {
  const { currentUser, projects = [], activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const project = projects.find(candidate => candidate.id === projectId);
  const { statuses, priorities, types, closedStatusIds, statusCategoryById } = useWorkflowConfig();
  const currentUserId = currentUser?.uid || currentUser?.id || null;
  // Subscribed once for the whole table rather than per row: the map is one
  // object in the store, and six hundred selectors over the same object is six
  // hundred subscriptions for one fact.
  const issueReadState = useWorkspaceStore(state => state.issueReadState);
  const [editingCell, setEditingCell] = useState(null);
  const [visibleRows, setVisibleRows] = useState(ROWS_PER_PAGE);
  const editable = Boolean(onUpdateIssue);

  const visibleColumns = useMemo(() => visibleTaskTableColumns(columns), [columns]);
  const showsBlocked = visibleColumns.some(column => column.id === 'blocked') || sort === 'blocked';

  // Blockers cost a pass over every relation for every task, so they are only
  // resolved when a column or a sort actually asks about them.
  const blockedIssueIds = useMemo(() => {
    if (!showsBlocked) return new Set();
    const blocked = new Set();
    for (const issue of issues) {
      if (openBlockerIssues(issue.id, allIssues, issueLinks, closedStatusIds).length > 0) {
        blocked.add(issue.id);
      }
    }
    return blocked;
  }, [showsBlocked, issues, allIssues, issueLinks, closedStatusIds]);

  // Subtasks are child tasks, resolved with one pass over the project rather
  // than a scan per row — and only when a column or a sort asks for them.
  const showsSubtasks = visibleColumns.some(column => column.id === 'subtasks') || sort === 'subtasks';
  const childProgressById = useMemo(() => {
    const progress = new Map();
    if (!showsSubtasks) return progress;
    for (const candidate of allIssues) {
      const parentId = existingParentIssueId(candidate);
      if (!parentId) continue;
      const entry = progress.get(parentId) || { done: 0, total: 0 };
      entry.total += 1;
      if (closedStatusIds.includes(columnOf(candidate))) entry.done += 1;
      progress.set(parentId, entry);
    }
    return progress;
  }, [showsSubtasks, allIssues, closedStatusIds]);

  const orderedPriorities = useMemo(() => ensureSystemPriorities(priorities), [priorities]);
  const context = useMemo(() => taskTableContext({
    statuses,
    priorities: orderedPriorities,
    types,
    sprints,
    members,
    labels,
    blockedIssueIds,
    childProgressById,
  }), [statuses, orderedPriorities, types, sprints, members, labels, blockedIssueIds, childProgressById]);

  const rows = useMemo(() => {
    const comparator = sort === 'manual' ? compareIssues : taskTableComparator(sort, dir, context);
    return [...issues].sort(comparator);
  }, [issues, sort, dir, context]);

  // A different list starts from the top again: filtering down to ten tasks
  // must not leave «показано 600 з 10» on screen. Derived during render rather
  // than pushed from an effect, which would paint the stale page first.
  const pageKey = `${issues.length}:${sort}:${dir}`;
  const [pagedFor, setPagedFor] = useState(pageKey);
  if (pagedFor !== pageKey) {
    setPagedFor(pageKey);
    setVisibleRows(ROWS_PER_PAGE);
  }

  const drawnRows = rows.slice(0, pagedFor === pageKey ? visibleRows : ROWS_PER_PAGE);
  const hiddenRowCount = rows.length - drawnRows.length;

  const {
    active: selectionActive,
    activeSelectedIds,
    selectedIssues,
    toggle: toggleIssueSelection,
    toggleScope: toggleIssueScope,
    clear: clearSelection,
  } = useIssueSelection({
    issues,
    order: useMemo(() => drawnRows.map(issue => issue.id), [drawnRows]),
    scopeKey: selectionScopeKey || `${projectId || 'table'}:${sort}:${dir}`,
  });

  // What the header box stands for, and what it must not pretend to.
  const drawnAllSelected = drawnRows.length > 0
    && drawnRows.every(issue => activeSelectedIds.has(issue.id));
  const drawnSomeSelected = !drawnAllSelected
    && drawnRows.some(issue => activeSelectedIds.has(issue.id));
  // Offered only once the visible page is fully selected — «вибрати всі» before
  // that is a different action nobody asked for — and only while something is
  // actually out of sight.
  const offersWholeList = drawnAllSelected && hiddenRowCount > 0
    && rows.some(issue => !activeSelectedIds.has(issue.id));

  const commit = async (issue, patch) => {
    setEditingCell(null);
    if (!patch || Object.keys(patch).length === 0) return;
    // The hook owns the optimistic overlay, the rollback and the toast; a
    // rejected promise here would only reach the browser console.
    try {
      await onUpdateIssue?.(issue.id, patch);
    } catch {
      // Reported by the caller.
    }
  };

  // A checkbox reports a boolean, not the event that produced it, so the modifier
  // is caught on the way down. Without a selection running, `toggle` refuses a
  // plain click — that guard protects a list where clicking a row opens a task,
  // and a table's checkbox has no such ambiguity to protect against.
  // The header has no scrollbar of its own; it is dragged sideways by the body.
  const headerScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  const syncHeaderScroll = event => {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
  };

  const shiftHeldRef = useRef(false);
  const selectRow = issue => {
    const shiftKey = shiftHeldRef.current;
    if (!selectionActive && !shiftKey) {
      toggleIssueScope([issue.id]);
      return;
    }
    toggleIssueSelection(issue.id, { shiftKey });
  };

  // A menu row carries the same mark the cell does: a status is its colour, a
  // priority its own glyph, a type its icon, a person their face.
  const statusOptions = useMemo(() => statuses.map(status => ({
    value: status.id,
    label: status.label,
    leading: <ColourDot color={status.color} />,
  })), [statuses]);
  const priorityOptions = useMemo(
    () => selectablePriorities(priorities).map(item => {
      const presentation = priorityPresentation(item, priorities);
      return {
        value: item.id,
        label: item.label,
        priorityMark: presentation,
        leading: <PriorityIcon priority={presentation} size="md" />,
      };
    }),
    [priorities],
  );
  const typeOptions = useMemo(
    () => types.filter(type => type.id !== 'epic').map(type => ({
      value: type.id,
      label: type.label,
      icon: taskTypeIcon(type),
    })),
    [types],
  );
  const sprintOptions = useMemo(() => [
    { value: '', label: 'Без спринта' },
    ...sprints.filter(sprint => sprint.status !== 'completed').map(sprint => ({
      value: sprint.id,
      label: sprint.name,
    })),
  ], [sprints]);
  const memberOptions = useMemo(() => activeMembers(members).map(member => ({
    value: memberId(member),
    label: memberName(member),
    user: member,
    leading: <UserAvatar user={member} size="xs" />,
  })), [members]);
  const labelOptions = useMemo(() => labels.map(label => ({
    value: label.id,
    label: label.label,
    dotColor: label.color,
    leading: <ColourDot color={label.color} />,
  })), [labels]);

  // Where each pinned column starts. They are the leading run of the visible
  // set, so one sweep from the checkbox gutter places all of them.
  const pinnedOffsets = useMemo(() => {
    const offsets = {};
    let left = SELECT_COLUMN_WIDTH;
    for (const column of visibleColumns) {
      if (!column.pinned) break;
      offsets[column.id] = left;
      left += column.width;
    }
    return offsets;
  }, [visibleColumns]);
  const tableWidth = SELECT_COLUMN_WIDTH + TOOLS_COLUMN_WIDTH
    + visibleColumns.reduce((total, column) => total + column.width, 0);

  // The two tables must agree on every track, or the header stops standing over
  // its own column. One list, rendered twice.
  const columnTracks = (
    <>
      <col style={{ width: SELECT_COLUMN_WIDTH }} />
      {visibleColumns.map(column => (
        <col key={column.id} style={{ width: column.width }} />
      ))}
      <col style={{ width: TOOLS_COLUMN_WIDTH }} />
    </>
  );

  if (issues.length === 0) {
    return (
      <Surface preset="panel" padding="md" className="w-full">
        <EmptyState
          icon={TaskIcon}
          title={emptyTitle}
          description={emptyDescription}
          context="page"
          surface="card"
        />
      </Surface>
    );
  }

  // ── What a cell shows ─────────────────────────────────────────────────────
  function renderValue(column, issue) {
    switch (column.id) {
      case 'key': {
        const path = issuePath(issue, project || projectId);
        const identity = issue.issueKey || '—';
        // Struck when the task is finished, like the key on a card and in a
        // list row — the three draw the same thing and have to agree.
        // Darker, not underlined. The row itself already fills to `canvas`
        // under the pointer, so a line under the id was the second answer to a
        // question the row had already answered.
        const identityClass = `truncate font-mono text-[11px] font-bold text-muted hover:text-ink${
          statusCategoryById.get(issue.columnId || issue.status) === 'done'
            ? ' line-through decoration-[1.5px]'
            : ''
        }`;
        return (
          <span className="flex items-center gap-[5px]">
            {/* Reading a task and leaving the table are two different things. In
                a grid you are working down, the first one wins: the id opens the
                quick modal, which has its own «на повній сторінці». Without a
                handler it stays the plain link it was. */}
            {onOpenIssue ? (
              <button
                type="button"
                onClick={event => { event.stopPropagation(); onOpenIssue(issue); }}
                title={`Переглянути ${identity}`}
                className={identityClass}
              >
                {identity}
              </button>
            ) : path ? (
              <Link href={path} onClick={event => event.stopPropagation()} className={identityClass}>
                {identity}
              </Link>
            ) : (
              <span className="truncate font-mono text-[11px] font-bold text-muted">{identity}</span>
            )}
            {activeTimerIssueId === issue.id && (
              <span
                title="Таймер запущено"
                className="h-[5px] w-[5px] shrink-0 animate-pulse rounded-full bg-ink"
              />
            )}
            {/* `inline-flex`, not a bare span: the dot is an inline-block, and
                an inline box sits on the text baseline — which is what left it
                hanging below the middle of the row. */}
            {isIssueUnread(issue, issueReadState[issue.id] || 0, currentUserId) && (
              <span
                role="status"
                className="inline-flex shrink-0 items-center"
                aria-label={unreadActivityLabel(issue)}
                title={unreadActivityLabel(issue)}
              >
                <Counter variant="dot" size="sm" status="info" />
              </span>
            )}
          </span>
        );
      }
      case 'title':
        return (
          <span className="block truncate text-[13px] font-semibold text-ink" title={issue.title}>
            {issue.title || <span className="text-faint">Без назви</span>}
          </span>
        );
      case 'status': {
        const status = context.statusById.get(columnOf(issue));
        if (!status) return <span className="text-faint">—</span>;
        return (
          <Pill color={status.color || '#9a9a9a'} size="sm" shape="badge" weight="medium">
            {status.label}
          </Pill>
        );
      }
      case 'assignees': {
        const people = (issue.assigneeIds || issue.assignees || [])
          .map(id => context.memberById.get(id))
          .filter(Boolean);
        if (people.length === 0) return <span className="text-[11px] italic text-faint">Н/В</span>;
        return (
          <span className="flex items-center -space-x-[6px]">
            {people.slice(0, 3).map(person => (
              <span key={memberId(person)} title={memberName(person)} className="rounded-full ring-2 ring-white">
                <UserAvatar user={person} size="xs" />
              </span>
            ))}
            {people.length > 3 && (
              <Pill tone="neutral" size="md" preset="avatar-counter-xs">+{people.length - 3}</Pill>
            )}
          </span>
        );
      }
      case 'priority': {
        const presentation = priorityPresentation(issue.priority, priorities);
        if (presentation.isNoPriority) return <span className="text-faint">—</span>;
        return (
          <span className="flex items-center gap-[6px]">
            <PriorityIcon priority={presentation} size="md" />
            <span className="truncate text-[12px] font-medium text-ink">{presentation.label}</span>
          </span>
        );
      }
      case 'due': {
        const text = formatDay(issue.dueDate, timeZone);
        if (!text) return <span className="text-faint">—</span>;
        const overdue = isDueDateOverdue(issue.dueDate, { timeZone })
          && !closedStatusIds.includes(columnOf(issue));
        return (
          <span className={`flex items-center gap-[4px] text-[12px] font-semibold ${overdue ? 'text-danger' : 'text-ink'}`}>
            <CalendarIcon size={11} strokeWidth={2} className="shrink-0" />
            {text}
          </span>
        );
      }
      case 'type': {
        const type = context.typeById.get(issue.type);
        if (!type) return <span className="text-faint">—</span>;
        return <TypeBadge label={type.label} color={type.color || '#9a9a9a'} icon={taskTypeIcon(type)} />;
      }
      case 'sprint': {
        const sprint = context.sprintById.get(issue.sprintId);
        if (!sprint) return <span className="text-faint">—</span>;
        return <Pill tone="neutral" size="sm" shape="badge" weight="medium">{sprint.name}</Pill>;
      }
      case 'labels': {
        const chips = (issue.labelIds || []).map(id => context.labelById.get(id)).filter(Boolean);
        if (chips.length === 0) return <span className="text-faint">—</span>;
        return (
          <span className="flex items-center gap-[4px] overflow-hidden">
            {chips.map(label => (
              <Tag key={label.id} label={label.label} color={label.color} size="small" className="shrink-0" />
            ))}
          </span>
        );
      }
      case 'estimate': {
        const text = formatMinutes(issue.estimateMinutes);
        return text
          ? <span className="text-[12px] font-medium tabular-nums text-ink">{text}</span>
          : <span className="text-faint">—</span>;
      }
      case 'subtasks': {
        const progress = context.childProgressById.get(issue.id);
        return progress?.total
          ? <span className="text-[12px] font-medium tabular-nums text-ink">{progress.done}/{progress.total}</span>
          : <span className="text-faint">—</span>;
      }
      case 'comments': {
        const count = commentCountOf(issue);
        return count
          ? <span className="text-[12px] font-medium tabular-nums text-ink">{count}</span>
          : <span className="text-faint">—</span>;
      }
      case 'blocked':
        return blockedIssueIds.has(issue.id) ? (
          <span className="inline-flex items-center gap-[4px] rounded-[4px] bg-danger-soft px-[6px] py-[1.5px] text-[10px] font-medium text-danger">
            <Lock size={10} />
            Заблоковано
          </span>
        ) : <span className="text-faint">—</span>;
      case 'created':
        return <span className="text-[12px] text-muted">{formatStamp(issue.createdAt, timeZone) || '—'}</span>;
      case 'updated':
        return <span className="text-[12px] text-muted">{formatStamp(issue.updatedAt, timeZone) || '—'}</span>;
      default:
        return null;
    }
  }

  // ── What a cell offers when you click it ──────────────────────────────────
  //
  // One list per choice column, and the list is the only thing that appears:
  // the cell underneath keeps its own height, padding and content, so nothing
  // moves. `single` closes on pick; `multi` stays open, because choosing three
  // people is one errand.
  function cellChoices(column, issue) {
    const pick = patch => commit(issue, patch);
    switch (column.editor) {
      case 'status': {
        const current = columnOf(issue);
        return {
          mode: 'single',
          items: statusOptions.map(option => ({
            label: option.label,
            leading: option.leading,
            icon: option.icon,
            selected: option.value === current,
            onClick: () => pick(option.value === current ? null : { columnId: option.value }),
          })),
        };
      }
      case 'priority': {
        const current = issue.priority || NO_PRIORITY_ID;
        return {
          mode: 'single',
          items: priorityOptions.map(option => ({
            label: option.label,
            leading: option.leading,
            icon: option.icon,
            selected: option.value === current,
            // «Без пріоритету» is a stored value, not an absent one — the same
            // `none` the bulk bar writes when it clears a priority.
            onClick: () => pick(option.value === current ? null : { priority: option.value }),
          })),
        };
      }
      case 'type':
        return {
          mode: 'single',
          items: typeOptions.map(option => ({
            label: option.label,
            leading: option.leading,
            icon: option.icon,
            selected: option.value === issue.type,
            onClick: () => pick(option.value === issue.type ? null : { type: option.value }),
          })),
        };
      case 'sprint': {
        const current = issue.sprintId || '';
        return {
          mode: 'single',
          items: sprintOptions.map(option => ({
            label: option.label,
            leading: option.leading,
            icon: option.icon,
            selected: option.value === current,
            onClick: () => pick(option.value === current ? null : { sprintId: option.value || null }),
          })),
        };
      }
      case 'assignees': {
        const current = issue.assigneeIds || [];
        return {
          mode: 'multi',
          items: memberOptions.map(option => ({
            label: option.label,
            leading: option.leading,
            selected: current.includes(option.value),
            onClick: () => pick({
              assigneeIds: current.includes(option.value)
                ? current.filter(id => id !== option.value)
                : [...current, option.value],
            }),
          })),
        };
      }
      case 'labels': {
        const current = issue.labelIds || [];
        return {
          mode: 'multi',
          items: labelOptions.map(option => ({
            label: option.label,
            leading: option.leading,
            selected: current.includes(option.value),
            onClick: () => pick({
              labelIds: current.includes(option.value)
                ? current.filter(id => id !== option.value)
                : [...current, option.value],
            }),
          })),
        };
      }
      default:
        return null;
    }
  }

  const headerCell = column => {
    const active = sort === column.id;
    const Arrow = dir === 'desc' ? ArrowDown : ArrowUp;
    // `#` alone at 11px caps reads as a speck beside «ВИКОНАВЦІ». It is one
    // narrow glyph doing the work of a word, so it is set at the size a word
    // would occupy rather than the size a word's letters are.
    const isIdentity = column.id === 'key';
    const labelClass = isIdentity
      ? 'text-[14px] font-bold leading-none'
      : 'ui-type-eyebrow truncate uppercase tracking-wide';
    return (
      <th
        key={column.id}
        scope="col"
        aria-sort={active ? (dir === 'desc' ? 'descending' : 'ascending') : 'none'}
        style={column.pinned ? { left: pinnedOffsets[column.id] } : undefined}
        className={`${HEADER_CELL} ${
          column.pinned ? `z-[3] ${column.id === 'title' ? 'md:sticky' : 'sticky'}` : ''
        }`}
      >
        {column.sortable && onSortChange ? (
          // The whole cell is the control, not the word inside it. A button
          // sized to its label left most of a header column dead to the
          // pointer, and Tailwind v4 does not give a button a hand cursor of
          // its own — so a header that sorts looked like a header that does
          // not.
          <button
            type="button"
            onClick={() => onSortChange(nextTaskTableSort(column.id, { sort, dir }))}
            title={active ? 'Змінити напрям сортування' : `Сортувати за: ${column.label}`}
            aria-label={isIdentity ? 'Сортувати за номером' : undefined}
            className={`${HEADER_BOX} w-full gap-[4px] transition-colors hover:bg-black/[0.04] ${
              active ? 'text-ink' : 'text-muted hover:text-ink'
            } ${column.align === 'right' ? 'flex-row-reverse justify-start' : ''}`}
          >
            <span className={labelClass}>{column.label}</span>
            {active && <Arrow size={11} strokeWidth={3} className="shrink-0" />}
          </button>
        ) : (
          <span className={`${HEADER_BOX} text-muted ${column.align === 'right' ? 'justify-end' : ''}`}>
            <span className={labelClass}>{column.label}</span>
          </span>
        )}
      </th>
    );
  };

  return (
    <div className="flex h-full min-h-[320px] w-full min-w-0 flex-col">
      {/* The table owns its own scrolling in both directions. A sticky header
          and a pinned identity column stick to the nearest scroll container, so
          letting the page scroll instead would leave both of them behind. */}
      <Surface
        preset="compact-bordered-card"
        padding="none"
        className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden"
      >
        {/* Two tables, one set of column widths. The header is not inside the
            scrollport: a scroll container's bar runs its whole height, and the
            top of that bar landed beside the header as a grey band in the one
            row that has no room for one. The header scrolls sideways with the
            body because the body tells it to, and never vertically because
            there is nothing under it to scroll. */}
        <div ref={headerScrollRef} className="w-full shrink-0 overflow-hidden">
          <table className="w-full table-fixed border-collapse" style={{ minWidth: tableWidth }}>
            <colgroup>{columnTracks}</colgroup>
            <thead>
              <tr>
                <th scope="col" className={`${HEADER_CELL} sticky left-0 z-[4]`}>
                  <span className={HEADER_BOX}>
                    {/* Everything on screen, and nothing that is not.
                        The table draws a page at a time, so a box in the header
                        that claimed «всі» would select fifty of three hundred
                        and say otherwise. It stands for the rows actually drawn
                        — checked when they are all selected, a dash when some
                        are — and the rest of the list is offered separately,
                        below, as a sentence with a number in it. */}
                    <Checkbox
                      checked={drawnAllSelected}
                      indeterminate={drawnSomeSelected}
                      onChange={() => toggleIssueScope(drawnRows.map(issue => issue.id))}
                      size="sm"
                      ariaLabel={drawnAllSelected
                        ? `Зняти вибір з ${drawnRows.length}`
                        : `Вибрати ${drawnRows.length} на цій сторінці`}
                    />
                  </span>
                </th>
                {visibleColumns.map(headerCell)}
                {/* Which columns are on is a fact about this table, so it is
                    reached from the table — at the end of the header, pinned
                    right, where a spreadsheet keeps the same control. */}
                <th scope="col" className={`${HEADER_CELL} sticky right-0 z-[4]`}>
                  <span className={`${HEADER_BOX} !px-[8px] justify-center`}>
                  {onColumnsChange ? (
                    <ContextMenu
                      closeOnSelect={false}
                      align="end"
                      trigger={(
                        <Button
                          style="ghost"
                          size="icon-xs"
                          icon={Columns3}
                          aria-label="Які колонки показувати"
                          title="Які колонки показувати"
                        />
                      )}
                      items={TASK_TABLE_COLUMNS
                        .filter(column => !PINNED_TASK_TABLE_COLUMNS.includes(column.id))
                        .map(column => ({
                          label: column.label,
                          selected: visibleColumns.some(visible => visible.id === column.id),
                          onClick: () => onColumnsChange(column.id),
                        }))}
                    />
                  ) : <span className="sr-only">Колонки</span>}
                  </span>
                </th>
              </tr>
            </thead>
          </table>
        </div>

        <div
          ref={bodyScrollRef}
          onScroll={syncHeaderScroll}
          className="ui-table-scroll min-h-0 w-full flex-1 overflow-auto"
        >
          <table className="w-full table-fixed border-collapse" style={{ minWidth: tableWidth }}>
            <colgroup>{columnTracks}</colgroup>
            <tbody>
              {drawnRows.map(issue => {
                const selected = activeSelectedIds.has(issue.id);
                const rowTone = selected ? 'bg-selected' : 'bg-white group-hover:bg-canvas';
                return (
                  <tr
                    key={issue.id}
                    className={`group border-b border-canvas transition-colors ${
                      selected ? 'bg-selected' : 'hover:bg-canvas'
                    }`}
                  >
                    <td
                      className={`sticky left-0 z-[1] h-9 px-[10px] align-middle ${rowTone}`}
                      onMouseDown={event => { shiftHeldRef.current = event.shiftKey; }}
                    >
                      <Checkbox
                        checked={selected}
                        onChange={() => selectRow(issue)}
                        size="sm"
                        ariaLabel={`Вибрати інцидент ${issue.issueKey || issue.title}`}
                      />
                    </td>

                    {visibleColumns.map(column => {
                      const choices = editable ? cellChoices(column, issue) : null;
                      const typing = editable
                        && editingCell?.issueId === issue.id
                        && editingCell?.columnId === column.id;
                      const cellClass = `h-9 px-[10px] py-0 align-middle ${ALIGNMENT[column.align]} ${
                        column.pinned
                          ? `z-[1] ${column.id === 'title' ? 'md:sticky' : 'sticky'} ${rowTone}`
                          : ''
                      }`;
                      const style = column.pinned ? { left: pinnedOffsets[column.id] } : undefined;

                      if (typing) {
                        return (
                          <td key={column.id} style={style} className={cellClass}>
                            {column.editor === 'estimate' ? (
                              <TextCellEditor
                                type="number"
                                suffix="хв"
                                value={issue.estimateMinutes || ''}
                                ariaLabel={`Оцінка: ${issue.issueKey || issue.title}`}
                                onCancel={() => setEditingCell(null)}
                                onCommit={value => {
                                  const minutes = Math.max(0, Math.round(Number(value) || 0));
                                  commit(issue, minutes === (issue.estimateMinutes || 0)
                                    ? null
                                    : { estimateMinutes: minutes });
                                }}
                              />
                            ) : (
                              <TextCellEditor
                                value={issue.title || ''}
                                ariaLabel={`Назва: ${issue.issueKey || issue.title}`}
                                onCancel={() => setEditingCell(null)}
                                onCommit={value => {
                                  const title = String(value).trim();
                                  commit(issue, title && title !== issue.title ? { title } : null);
                                }}
                              />
                            )}
                          </td>
                        );
                      }

                      if (choices) {
                        return (
                          <td key={column.id} style={style} className={cellClass}>
                            <ContextMenu
                              align="start"
                              closeOnSelect={choices.mode === 'single'}
                              className="w-full"
                              items={choices.items}
                              trigger={(
                                <button
                                  type="button"
                                  title={`Змінити: ${column.label}`}
                                  className={`-mx-[6px] flex h-[26px] w-[calc(100%+12px)] min-w-0 items-center rounded-[6px] px-[6px] text-left transition-colors hover:bg-black/[0.05] ${
                                    column.align === 'right' ? 'justify-end' : ''
                                  }`}
                                >
                                  {renderValue(column, issue)}
                                </button>
                              )}
                            />
                          </td>
                        );
                      }

                      if (editable && column.editor === 'due') {
                        return (
                          <td key={column.id} style={style} className={cellClass}>
                            {/* The calendar is its own overlay and the trigger
                                is the field, so this one control both shows the
                                value and opens — at the row's height. */}
                            <DatePicker
                              size="sm"
                              composition="table-cell"
                              compact
                              hideIcon
                              value={issue.dueDate || ''}
                              aria-label={`Дедлайн: ${issue.issueKey || issue.title}`}
                              placeholder="—"
                              onChange={value => commit(issue, { dueDate: value || null })}
                            />
                          </td>
                        );
                      }

                      if (editable && column.editor === 'text') {
                        return (
                          <td key={column.id} style={style} className={cellClass}>
                            <button
                              type="button"
                              onClick={() => setEditingCell({ issueId: issue.id, columnId: column.id })}
                              title="Змінити назву"
                              className="-mx-[6px] flex h-[26px] w-[calc(100%+12px)] min-w-0 items-center rounded-[6px] px-[6px] text-left transition-colors hover:bg-black/[0.05]"
                            >
                              {renderValue(column, issue)}
                            </button>
                          </td>
                        );
                      }

                      if (editable && column.editor === 'estimate') {
                        return (
                          <td key={column.id} style={style} className={cellClass}>
                            <button
                              type="button"
                              onClick={() => setEditingCell({ issueId: issue.id, columnId: column.id })}
                              title="Змінити оцінку"
                              className="-mx-[6px] flex h-[26px] w-[calc(100%+12px)] min-w-0 items-center justify-end rounded-[6px] px-[6px] text-left transition-colors hover:bg-black/[0.05]"
                            >
                              {renderValue(column, issue)}
                            </button>
                          </td>
                        );
                      }

                      return (
                        <td key={column.id} style={style} className={cellClass}>
                          <span className={`flex min-w-0 items-center ${column.align === 'right' ? 'justify-end' : ''}`}>
                            {renderValue(column, issue)}
                          </span>
                        </td>
                      );
                    })}

                    <td className={`sticky right-0 z-[1] h-9 align-middle ${rowTone}`} />
                  </tr>
                );
              })}

              {/* The second step, and the reason the header box does not take
                  it by itself. Gmail asks the same question in the same place:
                  the page is selected, the list is longer, so say by how much
                  and let the person decide. Selecting three hundred tasks must
                  be something somebody meant. */}
              {offersWholeList && (
                <tr>
                  <td colSpan={visibleColumns.length + 2} className="p-0">
                    <div className="sticky left-0 flex w-[max-content] max-w-[100vw] items-center gap-2 border-y border-line bg-canvas px-[10px] py-[8px]">
                      <span className="text-[12px] text-muted">
                        Вибрано {activeSelectedIds.size} на цій сторінці.
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleIssueScope(rows.map(issue => issue.id))}
                        className="text-[12px] font-semibold text-ink underline underline-offset-2 transition-colors hover:text-muted"
                      >
                        Вибрати всі {rows.length}
                      </button>
                    </div>
                  </td>
                </tr>
              )}

              {hiddenRowCount > 0 && (
                <tr>
                  <td colSpan={visibleColumns.length + 2} className="p-0">
                    <div className="sticky left-0 flex w-[max-content] max-w-[100vw] items-center gap-3 px-[10px] py-[10px]">
                      <span className="text-[12px] text-muted">
                        Показано {drawnRows.length} з {rows.length}
                      </span>
                      <Button
                        style="secondary"
                        size="sm"
                        onClick={() => setVisibleRows(count => count + ROWS_PER_PAGE)}
                      >
                        Показати ще {Math.min(ROWS_PER_PAGE, hiddenRowCount)}
                      </Button>
                      <Button style="ghost" size="sm" onClick={() => setVisibleRows(rows.length)}>
                        Показати всі
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Surface>

      <BulkActionBar
        count={onBulkUpdate ? activeSelectedIds.size : 0}
        progress={bulkProgress}
        statusOptions={statuses.map(status => ({
          value: status.id,
          label: status.label,
          dotColor: status.color,
        }))}
        memberOptions={memberOptions}
        priorityOptions={priorityOptions}
        labelOptions={labelOptions}
        typeOptions={typeOptions}
        sprintOptions={sprints.filter(sprint => sprint.status !== 'completed').map(sprint => ({
          value: sprint.id,
          label: sprint.name,
        }))}
        canArchive={canArchive}
        onApply={(action, value) => onBulkUpdate?.(
          action,
          action === 'status' ? { mode: 'status', id: value } : value,
          selectedIssues,
        )}
        onClear={clearSelection}
      />
    </div>
  );
}
