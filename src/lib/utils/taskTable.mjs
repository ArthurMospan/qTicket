// src/lib/utils/taskTable.mjs — what a table of tasks is made of.
//
// The board already had two readings of one list: a kanban, and a list grouped
// by status. Both decide the arrangement for you. A table is the third reading,
// and the only one where the arrangement is the user's: which columns, sorted
// by what. That answer has to survive being pasted into a chat, which is why
// both choices are keys in `BOARD_VIEW_SCHEMA` and why everything here is a
// pure function over data the screen already holds.
//
// Nothing in this file reads Firestore. The table works on the tasks the board
// has already loaded — a project on the free plan cannot afford a query per row.

import { columnOf, compareIssues } from './optimistic.mjs';
import { NO_PRIORITY_ID } from './priorities.mjs';

// ── The columns ─────────────────────────────────────────────────────────────
//
// One list, in one order. The address carries which columns are on, never where
// they sit: a shared link has to open the same table for the reader, and column
// order is the one part of «which table» that nobody has ever needed to send.
//
// `pinned` columns stay put while the rest scroll sideways, and cannot be
// switched off — a row you cannot identify is not a row.
// `editor` names the control a cell opens; `null` is a value you can only read.
//
// There is no grouping. It was offered twice — as a select beside the filters
// and as a menu on the column — and rejected both times, because a table of
// tasks is the flat reading of a list: the board is the one that arranges them
// into columns, and the list is the one that arranges them into sections.

const COLUMNS = [
  { id: 'key', label: '#', width: 96, align: 'left', pinned: true, sortable: true, editor: null },
  { id: 'title', label: 'Назва', width: 320, align: 'left', pinned: true, sortable: true, editor: 'text' },
  { id: 'status', label: 'Статус', width: 150, align: 'left', pinned: false, sortable: true, editor: 'status' },
  { id: 'assignees', label: 'Виконавці', width: 156, align: 'left', pinned: false, sortable: true, editor: 'assignees' },
  { id: 'priority', label: 'Пріоритет', width: 148, align: 'left', pinned: false, sortable: true, editor: 'priority' },
  { id: 'due', label: 'Дедлайн', width: 132, align: 'left', pinned: false, sortable: true, editor: 'due' },
  { id: 'type', label: 'Тип', width: 136, align: 'left', pinned: false, sortable: true, editor: 'type' },
  { id: 'sprint', label: 'Спринт', width: 148, align: 'left', pinned: false, sortable: true, editor: 'sprint' },
  { id: 'labels', label: 'Мітки', width: 180, align: 'left', pinned: false, sortable: false, editor: 'labels' },
  { id: 'estimate', label: 'Оцінка', width: 104, align: 'right', pinned: false, sortable: true, editor: 'estimate' },
  { id: 'subtasks', label: 'Підзавдання', width: 124, align: 'right', pinned: false, sortable: true, editor: null },
  { id: 'comments', label: 'Коментарі', width: 112, align: 'right', pinned: false, sortable: true, editor: null },
  { id: 'blocked', label: 'Блокування', width: 128, align: 'left', pinned: false, sortable: true, editor: null },
  { id: 'created', label: 'Створено', width: 116, align: 'left', pinned: false, sortable: true, editor: null },
  { id: 'updated', label: 'Оновлено', width: 116, align: 'left', pinned: false, sortable: true, editor: null },
];

export const TASK_TABLE_COLUMNS = Object.freeze(COLUMNS.map(column => Object.freeze({ ...column })));

export const TASK_TABLE_COLUMN_IDS = Object.freeze(TASK_TABLE_COLUMNS.map(column => column.id));

/** Columns a row cannot do without, and which the picker therefore never offers. */
export const PINNED_TASK_TABLE_COLUMNS = Object.freeze(
  TASK_TABLE_COLUMNS.filter(column => column.pinned).map(column => column.id),
);

/** What an untouched table shows. Six columns: enough to triage, few enough to fit. */
export const DEFAULT_TASK_TABLE_COLUMNS = Object.freeze([
  'key', 'title', 'status', 'assignees', 'priority', 'due',
]);

/** `manual` is the board's own order — the arrangement the other two views show. */
export const TASK_TABLE_SORT_VALUES = Object.freeze([
  'manual',
  ...TASK_TABLE_COLUMNS.filter(column => column.sortable).map(column => column.id),
]);

export const TASK_TABLE_SORT_DIRECTIONS = Object.freeze(['asc', 'desc']);

const COLUMN_BY_ID = new Map(TASK_TABLE_COLUMNS.map(column => [column.id, column]));

export function taskTableColumn(columnId) {
  return COLUMN_BY_ID.get(columnId) || null;
}

/**
 * The columns to draw, in the canonical order.
 *
 * An empty list means «whatever the default is», which is what keeps an
 * untouched table out of the address entirely. Unknown ids are dropped rather
 * than rendered: a link outlives the column set it was written against.
 */
export function visibleTaskTableColumns(columnIds) {
  const requested = Array.isArray(columnIds) ? columnIds.filter(id => COLUMN_BY_ID.has(id)) : [];
  const chosen = new Set(requested.length > 0 ? requested : DEFAULT_TASK_TABLE_COLUMNS);
  for (const id of PINNED_TASK_TABLE_COLUMNS) chosen.add(id);
  return TASK_TABLE_COLUMNS.filter(column => chosen.has(column.id));
}

/** The `cols` value for a chosen set: canonical order, and empty when it is the default. */
export function serializeTaskTableColumns(columnIds) {
  const visible = visibleTaskTableColumns(columnIds).map(column => column.id);
  const isDefault = visible.length === DEFAULT_TASK_TABLE_COLUMNS.length
    && visible.every((id, index) => id === DEFAULT_TASK_TABLE_COLUMNS[index]);
  return isDefault ? [] : visible;
}

// ── The context a column needs to read a task ───────────────────────────────
//
// A task stores ids. A table shows names, colours and order, and all three live
// in the workflow configuration rather than on the document. Resolving that once
// per render — instead of once per cell — is the difference between a table and
// a table that scrolls badly.

function indexById(items, keyOf = item => item?.id) {
  const map = new Map();
  (items || []).forEach(item => {
    const key = keyOf(item);
    if (key) map.set(key, item);
  });
  return map;
}

function rankById(items, keyOf = item => item?.id) {
  const map = new Map();
  (items || []).forEach((item, index) => {
    const key = keyOf(item);
    if (key && !map.has(key)) map.set(key, index);
  });
  return map;
}

export function memberId(member) {
  return member?.id || member?.uid || '';
}

export function memberName(member) {
  return member?.name || member?.email || 'Учасник';
}

/**
 * Everything the columns need in order to read a task, resolved once.
 *
 * @param {object} source
 * @param {object[]} source.statuses Workflow statuses, in board order.
 * @param {object[]} source.priorities Configured priorities, most urgent first.
 * @param {object[]} source.types Task types.
 * @param {object[]} source.sprints Sprints of the project.
 * @param {object[]} source.members People who can be assigned.
 * @param {object[]} source.labels Label definitions.
 * @param {Set<string>|string[]} source.blockedIssueIds Tasks with an open blocker.
 * @param {Map<string, {done: number, total: number}>} source.childProgressById How many child tasks each task has, and how many are closed.
 */
export function taskTableContext({
  statuses = [],
  priorities = [],
  types = [],
  sprints = [],
  members = [],
  labels = [],
  blockedIssueIds = [],
  childProgressById = new Map(),
} = {}) {
  return {
    statuses,
    priorities,
    types,
    sprints,
    members,
    labels,
    blockedIssueIds: blockedIssueIds instanceof Set ? blockedIssueIds : new Set(blockedIssueIds),
    childProgressById,
    statusById: indexById(statuses),
    priorityById: indexById(priorities),
    typeById: indexById(types),
    sprintById: indexById(sprints),
    labelById: indexById(labels),
    memberById: indexById(members, memberId),
    statusRank: rankById(statuses),
    priorityRank: rankById(priorities),
    typeRank: rankById(types),
    sprintRank: rankById(sprints),
    memberRank: rankById(members, memberId),
  };
}

// ── Sorting ─────────────────────────────────────────────────────────────────

/** Milliseconds out of a Firestore Timestamp, a Date or a date string. */
export function taskTableMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

// `QT-9` sorts before `QT-10`, which a plain string comparison gets backwards.
function keySortValue(issue) {
  const key = String(issue?.issueKey || '');
  if (!key) return null;
  const match = key.match(/^(.*?)(\d+)$/);
  if (!match) return key.toLowerCase();
  return `${match[1].toLowerCase()}${match[2].padStart(12, '0')}`;
}

function assigneeIdsOf(issue) {
  const ids = issue?.assigneeIds || issue?.assignees || [];
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

export function commentCountOf(issue) {
  return Number(issue?.commentCount ?? issue?.commentsCount ?? 0) || 0;
}

/**
 * What a column sorts on. `null` means «this task has no value here», and a task
 * with no value sorts last in both directions — flipping a column must not
 * bury the rows you were reading under a wall of blanks.
 */
export function taskSortValue(issue, columnId, context) {
  const rank = (map, id) => (map.has(id) ? map.get(id) : null);
  switch (columnId) {
    case 'key':
      return keySortValue(issue);
    case 'title':
      return String(issue?.title || '').trim().toLowerCase() || null;
    case 'status':
      return rank(context.statusRank, columnOf(issue));
    case 'assignees': {
      const first = assigneeIdsOf(issue)[0];
      const member = first ? context.memberById.get(first) : null;
      return member ? memberName(member).toLowerCase() : null;
    }
    // Ascending is most urgent first, which is the order every board already
    // reads in. A task with no priority has no place in that order and sorts
    // last, exactly like a task with no due date.
    case 'priority': {
      const id = issue?.priority;
      if (!id || id === NO_PRIORITY_ID) return null;
      return rank(context.priorityRank, id);
    }
    case 'due':
      return taskTableMillis(issue?.dueDate);
    case 'type':
      return rank(context.typeRank, issue?.type);
    case 'sprint': {
      const sprint = issue?.sprintId ? context.sprintById.get(issue.sprintId) : null;
      return sprint ? String(sprint.name || '').toLowerCase() : null;
    }
    case 'estimate':
      return Number(issue?.estimateMinutes) || null;
    // Real child tasks, not the checklist field that used to live on the
    // document — that one was removed from the product, and a column reading it
    // reported nothing for every task in the workspace.
    case 'subtasks':
      return context.childProgressById.get(issue?.id)?.total || null;
    case 'comments':
      return commentCountOf(issue) || null;
    // Blocked first while ascending: «what is stuck» is the only reason to sort
    // a column that holds one bit.
    case 'blocked':
      return context.blockedIssueIds.has(issue?.id) ? 0 : 1;
    case 'created':
      return taskTableMillis(issue?.createdAt);
    case 'updated':
      return taskTableMillis(issue?.updatedAt);
    default:
      return null;
  }
}

/**
 * A total ordering for one column. Ties fall back to the board's own order, so
 * the table never reshuffles rows it has no opinion about.
 */
export function taskTableComparator(sort, direction, context) {
  const column = COLUMN_BY_ID.get(sort);
  if (!column?.sortable) return compareIssues;
  const sign = direction === 'desc' ? -1 : 1;
  return (a, b) => {
    const left = taskSortValue(a, sort, context);
    const right = taskSortValue(b, sort, context);
    if (left === null && right === null) return compareIssues(a, b);
    if (left === null) return 1;
    if (right === null) return -1;
    const result = typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), 'uk');
    return result === 0 ? compareIssues(a, b) : result * sign;
  };
}

/** The next `{ sort, dir }` after a click on a column header: ▲ → ▼ → manual. */
export function nextTaskTableSort(columnId, current) {
  const column = COLUMN_BY_ID.get(columnId);
  if (!column?.sortable) return { sort: current?.sort || 'manual', dir: current?.dir || 'asc' };
  if (current?.sort !== columnId) return { sort: columnId, dir: 'asc' };
  if (current.dir === 'asc') return { sort: columnId, dir: 'desc' };
  return { sort: 'manual', dir: 'asc' };
}
