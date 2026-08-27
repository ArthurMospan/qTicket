import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TASK_TABLE_COLUMNS,
  PINNED_TASK_TABLE_COLUMNS,
  TASK_TABLE_COLUMNS,
  TASK_TABLE_SORT_VALUES,
  nextTaskTableSort,
  serializeTaskTableColumns,
  taskSortValue,
  taskTableComparator,
  taskTableContext,
  visibleTaskTableColumns,
} from '../src/lib/utils/taskTable.mjs';

const STATUSES = [
  { id: 'backlog', label: 'Беклог', color: '#9a9a9a' },
  { id: 'doing', label: 'У роботі', color: '#6366f1' },
  { id: 'done', label: 'Готово', color: '#10b981' },
];
const PRIORITIES = [
  { id: 'blocker', label: 'Критичний' },
  { id: 'high', label: 'Високий' },
  { id: 'medium', label: 'Середній' },
  { id: 'low', label: 'Низький' },
];
const TYPES = [{ id: 'task', label: 'Задача' }, { id: 'bug', label: 'Баг' }];
const SPRINTS = [{ id: 's1', name: 'Спринт 1' }];
const MEMBERS = [
  { id: 'u1', name: 'Богдан' },
  { id: 'u2', name: 'Артур' },
];

const context = (overrides = {}) => taskTableContext({
  statuses: STATUSES,
  priorities: PRIORITIES,
  types: TYPES,
  sprints: SPRINTS,
  members: MEMBERS,
  ...overrides,
});

const issue = (id, fields = {}) => ({ id, issueKey: `QT-${id}`, order: Number(id), ...fields });

// ── Columns ─────────────────────────────────────────────────────────────────

test('an unconfigured table shows the default six columns', () => {
  assert.deepEqual(
    visibleTaskTableColumns([]).map(column => column.id),
    [...DEFAULT_TASK_TABLE_COLUMNS],
  );
  assert.deepEqual(
    visibleTaskTableColumns(undefined).map(column => column.id),
    [...DEFAULT_TASK_TABLE_COLUMNS],
  );
});

// A row nobody can identify is not a row, so these two are not the picker's to
// switch off — however the address is edited.
test('the identity columns survive any column list', () => {
  const visible = visibleTaskTableColumns(['estimate']).map(column => column.id);
  for (const pinned of PINNED_TASK_TABLE_COLUMNS) assert.ok(visible.includes(pinned));
  assert.ok(visible.includes('estimate'));
});

// A link outlives the column set it was written against.
test('a column the build no longer has is dropped, not rendered', () => {
  assert.deepEqual(
    visibleTaskTableColumns(['title', 'moon-phase', 'status']).map(column => column.id),
    ['key', 'title', 'status'],
  );
});

test('columns are drawn in the canonical order, whatever order the address lists them', () => {
  assert.deepEqual(
    visibleTaskTableColumns(['due', 'status', 'title', 'key']).map(column => column.id),
    ['key', 'title', 'status', 'due'],
  );
});

// Rule one of the address: a value equal to its default is absent from it.
test('the default column set serialises to nothing', () => {
  assert.deepEqual(serializeTaskTableColumns([...DEFAULT_TASK_TABLE_COLUMNS]), []);
  assert.deepEqual(serializeTaskTableColumns([]), []);
  assert.deepEqual(
    serializeTaskTableColumns(['key', 'title', 'status']),
    ['key', 'title', 'status'],
  );
});

test('every sortable column is a value the address accepts', () => {
  const sortable = TASK_TABLE_COLUMNS.filter(column => column.sortable).map(column => column.id);
  assert.deepEqual(TASK_TABLE_SORT_VALUES, ['manual', ...sortable]);
  assert.ok(TASK_TABLE_SORT_VALUES.includes('manual'));
});

// ── Sorting ─────────────────────────────────────────────────────────────────

test('a key sorts by its number, not by its text', () => {
  const rows = [{ issueKey: 'QT-10' }, { issueKey: 'QT-9' }, { issueKey: 'QT-100' }];
  const sorted = [...rows].sort(taskTableComparator('key', 'asc', context()));
  assert.deepEqual(sorted.map(row => row.issueKey), ['QT-9', 'QT-10', 'QT-100']);
});

test('a status sorts by its place on the board, not by its label', () => {
  const ctx = context();
  assert.equal(taskSortValue({ columnId: 'backlog' }, 'status', ctx), 0);
  assert.equal(taskSortValue({ columnId: 'done' }, 'status', ctx), 2);
  assert.equal(taskSortValue({ columnId: 'deleted-status' }, 'status', ctx), null);
});

// Ascending is most urgent first — the order every board already reads in.
test('priority sorts urgent first, and «none» is not a priority', () => {
  const ctx = context();
  assert.equal(taskSortValue({ priority: 'blocker' }, 'priority', ctx), 0);
  assert.equal(taskSortValue({ priority: 'low' }, 'priority', ctx), 3);
  assert.equal(taskSortValue({ priority: 'none' }, 'priority', ctx), null);
  assert.equal(taskSortValue({}, 'priority', ctx), null);
});

// Flipping a column must not bury the rows you were reading under a wall of
// blanks, so an absent value is last in both directions.
test('a task with no value in the sorted column is last either way', () => {
  const rows = [
    issue('1', { dueDate: null }),
    issue('2', { dueDate: '2026-03-01' }),
    issue('3', { dueDate: '2026-01-01' }),
  ];
  const ascending = [...rows].sort(taskTableComparator('due', 'asc', context()));
  assert.deepEqual(ascending.map(row => row.id), ['3', '2', '1']);
  const descending = [...rows].sort(taskTableComparator('due', 'desc', context()));
  assert.deepEqual(descending.map(row => row.id), ['2', '3', '1']);
});

// Without this the table would reshuffle rows it has no opinion about every
// time the snapshot came back.
test('rows the sort cannot separate keep the board’s own order', () => {
  const rows = [issue('3', { title: 'Одне' }), issue('1', { title: 'Одне' })];
  const sorted = [...rows].sort(taskTableComparator('title', 'asc', context()));
  assert.deepEqual(sorted.map(row => row.id), ['1', '3']);
});

test('an unsortable or unknown column leaves the board order alone', () => {
  const rows = [issue('2'), issue('1')];
  assert.deepEqual(
    [...rows].sort(taskTableComparator('labels', 'asc', context())).map(row => row.id),
    ['1', '2'],
  );
  assert.deepEqual(
    [...rows].sort(taskTableComparator('manual', 'asc', context())).map(row => row.id),
    ['1', '2'],
  );
});

test('a header click cycles ascending, descending, then back to the board order', () => {
  assert.deepEqual(nextTaskTableSort('due', { sort: 'manual', dir: 'asc' }), { sort: 'due', dir: 'asc' });
  assert.deepEqual(nextTaskTableSort('due', { sort: 'due', dir: 'asc' }), { sort: 'due', dir: 'desc' });
  assert.deepEqual(nextTaskTableSort('due', { sort: 'due', dir: 'desc' }), { sort: 'manual', dir: 'asc' });
  assert.deepEqual(nextTaskTableSort('title', { sort: 'due', dir: 'desc' }), { sort: 'title', dir: 'asc' });
});

test('a column that does not sort cannot be sorted by clicking it', () => {
  assert.deepEqual(nextTaskTableSort('labels', { sort: 'due', dir: 'asc' }), { sort: 'due', dir: 'asc' });
});

// The table has no banding, and that is a decision rather than an omission:
// arranging tasks into groups is what the board and the list already are.
test('the table exposes no grouping', async () => {
  const taskTable = await import('../src/lib/utils/taskTable.mjs');
  for (const name of ['taskTableSections', 'TASK_TABLE_GROUPS', 'TASK_TABLE_GROUP_VALUES']) {
    assert.equal(taskTable[name], undefined, name);
  }
  assert.ok(TASK_TABLE_COLUMNS.every(column => column.group === undefined));
});

// The permission matrix is documentation only if nothing reads it. `manage:finance`
// said `owner` while the rules, the invoice route and the analytics tab all
// agreed on owner *and* admin — and nothing called it, so the drift was
// invisible. Rules are authoritative; this keeps the matrix pointed at them.
test('the finance permission matches what the server and the rules enforce', async () => {
  const { PERMISSIONS, can } = await import('../src/lib/utils/can.js');
  assert.deepEqual(PERMISSIONS['manage:finance'], ['owner', 'admin']);
  assert.equal(can('admin', 'manage:finance'), true);
  assert.equal(can('member', 'manage:finance'), false);
});
