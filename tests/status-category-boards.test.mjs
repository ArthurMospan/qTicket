// Scenario coverage for the surfaces the categories actually changed: the
// workflow editor, a drop on a category column, and what a project's hidden
// columns can and cannot do to either. The model itself is covered by
// tests/status-categories.test.mjs; this file walks the paths that join it to
// the boards, because that seam is where the original bug lived.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  closedStatusIds,
  entryStatusId,
  flattenStatusGroups,
  groupStatusesByCategory,
  isClosingCategory,
  resolveCategoryStatusId,
  statusCategoryColumns,
  statusCategoryMap,
} from '../src/lib/utils/statusCategories.mjs';
import { columnOf } from '../src/lib/utils/optimistic.mjs';
import {
  compareMyTaskIssues,
  planMyTaskDrop,
} from '../src/lib/utils/myTaskOrder.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// An organization that has actually used the editor: two statuses under «У
// роботі», two more waiting on somebody else, and one end.
const workflow = [
  { id: 'backlog', label: 'Беклог', category: 'backlog' },
  { id: 'todo', label: 'До виконання', category: 'todo' },
  { id: 'in-progress', label: 'У роботі', category: 'in-progress' },
  { id: 'pairing', label: 'У парі', category: 'in-progress' },
  { id: 'qa', label: 'QA', category: 'review' },
  { id: 'client-approval', label: 'Погодження клієнтом', category: 'review' },
  { id: 'done', label: 'Готово', category: 'done' },
];

// ── The editor ────────────────────────────────────────────────────────────────

test('grouping and flattening a workflow is lossless and puts it in flow order', () => {
  // Deliberately stored out of order, the way an older workflow can be.
  const stored = [
    { id: 'done', label: 'Готово', category: 'done' },
    { id: 'backlog', label: 'Беклог', category: 'backlog' },
    { id: 'qa', label: 'QA', category: 'in-progress' },
  ];
  const flattened = flattenStatusGroups(groupStatusesByCategory(stored));
  assert.deepEqual(flattened.map(s => s.id), ['backlog', 'qa', 'done']);
  // Nothing is lost and every status comes back with both fields written out.
  assert.deepEqual(flattened.map(s => [s.category, s.isDone]), [
    ['backlog', false], ['in-progress', false], ['done', true],
  ]);
  // Every category is a section, including the empty ones — that is how the
  // first «Скасовано» ever gets created.
  assert.deepEqual(
    [...groupStatusesByCategory(stored).keys()],
    ['backlog', 'todo', 'in-progress', 'review', 'done'],
  );
});

test('dragging a status into another section is the only way its category changes', () => {
  const groups = groupStatusesByCategory(workflow);
  // «QA» moves from «На перевірці» to «Готово».
  const [moved] = groups.get('review').splice(0, 1);
  groups.get('done').unshift(moved);
  const next = flattenStatusGroups(groups);

  assert.equal(next.find(s => s.id === 'qa').category, 'done');
  assert.equal(next.find(s => s.id === 'qa').isDone, true);
  // Which is exactly what makes every QA task closed from that moment on — the
  // workflow API sees the closed set change and migrates completedAt with it.
  assert.deepEqual(closedStatusIds(next), ['qa', 'done']);
  // And the order it saves in still runs backlog → todo → in-progress → review
  // → done, whatever order the sections were edited in.
  assert.deepEqual(next.map(s => s.id), [
    'backlog', 'todo', 'in-progress', 'pairing', 'client-approval', 'qa', 'done',
  ]);
});

test('the editor cannot produce a workflow with nothing open or nothing closing', () => {
  const closingOf = list => list.filter(s => isClosingCategory(s.category)).length;

  // Dragging the last closing status out.
  const a = groupStatusesByCategory(workflow);
  a.get('todo').push(...a.get('done').splice(0));
  assert.equal(closingOf(flattenStatusGroups(a)), 0, 'the guard has something to catch');

  // Dragging everything into a closing category.
  const b = groupStatusesByCategory(workflow);
  const open = [
    ...b.get('backlog').splice(0),
    ...b.get('todo').splice(0),
    ...b.get('in-progress').splice(0),
    ...b.get('review').splice(0),
  ];
  b.get('done').push(...open);
  const flat = flattenStatusGroups(b);
  assert.equal(closingOf(flat), flat.length, 'the second guard has something to catch');
});

// ── A drop on a category column ───────────────────────────────────────────────

test('a card dropped on My tasks lands exactly among cross-project neighbours', () => {
  const issues = [
    { id: 'a1', projectId: 'alpha', category: 'done', order: 0 },
    { id: 'a2', projectId: 'alpha', category: 'done', order: 1 },
    { id: 'b1', projectId: 'beta', category: 'done', order: 0 },
    { id: 'm1', projectId: 'alpha', category: 'in-progress', order: 7 },
  ];
  const orders = { a1: 0, b1: 1, a2: 2, m1: 0 };
  const plan = planMyTaskDrop({
    issues,
    issueId: 'm1',
    targetCategoryId: 'done',
    position: {
      visibleColumnIds: ['a1', 'b1', 'a2'],
      visibleIndex: 1,
    },
    orders,
    categoryOf: issue => issue.category,
  });

  assert.deepEqual(plan.ordered.map(issue => issue.id), ['a1', 'm1', 'b1', 'a2']);
  assert.deepEqual(plan.ordered.toSorted(compareMyTaskIssues(plan.orders)).map(issue => issue.id), [
    'a1', 'm1', 'b1', 'a2',
  ]);
  assert.equal(plan.orders.m1, 1);
  assert.equal(plan.orders.b1, 2);
});

test('moving inside one category is a reorder, never a status change', () => {
  // «QA» and «Погодження клієнтом» are the same column on a category board.
  assert.equal(
    resolveCategoryStatusId('review', workflow, { currentStatusId: 'client-approval' }),
    'client-approval',
  );
  // …unless that status is switched off in this project, in which case staying
  // put is not an option the server would accept anyway.
  assert.equal(
    resolveCategoryStatusId('review', workflow, {
      currentStatusId: 'client-approval',
      hiddenStatusIds: ['client-approval'],
    }),
    'qa',
  );
});

test('My tasks persists same-category drops without calling the status API or showing a status toast', async () => {
  const [hook, page] = await Promise.all([
    read('../src/lib/hooks/useAllMyTasks.js'),
    read('../src/app/(app)/my/page.js'),
  ]);
  assert.match(hook, /const statusChanged = fromColumnId !== columnId/);
  assert.match(hook, /if \(statusPlan\) \{\s*await transitionIssueStatusViaApi/);
  assert.match(hook, /doc\(db, 'users', userId, 'settings', `my-tasks-\$\{activeOrgId\}`\)/);
  assert.match(page, /if \(result\?\.statusChanged\)/);
});

test('a project’s hidden columns can never make a category drop illegal', () => {
  // The whole point of the model. Whatever a project switches off, a drop on a
  // category column resolves to something that project uses — or says so.
  const hidden = ['qa', 'pairing'];
  for (const column of statusCategoryColumns(workflow)) {
    const resolved = resolveCategoryStatusId(column.id, workflow, { hiddenStatusIds: hidden });
    assert.ok(resolved, `${column.id} must resolve`);
    assert.ok(!hidden.includes(resolved), `${column.id} must not resolve to a hidden status`);
  }
  // And when a project has switched off every status of a category, the answer
  // is null so the caller can name the project and the category instead of
  // writing a status the board would then refuse to show.
  assert.equal(
    resolveCategoryStatusId('review', workflow, {
      hiddenStatusIds: ['qa', 'client-approval'],
    }),
    null,
  );
});

test('every card on a category board has exactly one column, and it is never hidden away', () => {
  const categories = statusCategoryMap(workflow);
  const columnIds = statusCategoryColumns(workflow).map(column => column.id);
  for (const status of workflow) {
    const column = categories.get(status.id);
    assert.ok(columnIds.includes(column), `${status.id} → ${column} must be a column`);
  }
  // Including a status the project hides: on a category board it still has a
  // column, which is why the card shows up there instead of vanishing.
  const issue = { columnId: 'qa' };
  assert.equal(categories.get(columnOf(issue)), 'review');
});

test('the incoming column survives a project switching the backlog off', () => {
  assert.equal(entryStatusId(workflow), 'backlog');
  // A project that hides its backlog still has somewhere for new work to land.
  const resolved = resolveCategoryStatusId('backlog', workflow, { hiddenStatusIds: ['backlog'] });
  assert.equal(resolved, null, 'no other backlog status exists in this workflow');
});

// ── The seams, read from the source ───────────────────────────────────────────

// Categories are what a board uses when there is no shared status vocabulary —
// across projects. A project board has one, so it keeps it: its columns are that
// project's statuses, and a drop names the status it means instead of letting a
// category pick one. Fewer columns on a project board is what hiding a column is
// for, and it costs no precision.
test('only the cross-project board groups by category', async () => {
  const [myTasks, projectPage, board] = await Promise.all([
    read('../src/lib/hooks/useAllMyTasks.js'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/AgileBoard.jsx'),
  ]);

  assert.match(myTasks, /resolveCategoryStatusId\(/);
  assert.match(myTasks, /hiddenStatusIds:/);
  // It keeps the status the card already has when it is already in the target
  // category, which is what makes a reorder a reorder.
  assert.match(myTasks, /currentStatusId/);

  // The project board has no grouping choice at all: two people looking at one
  // board must mean the same thing by dropping a card in the same place.
  assert.doesNotMatch(projectPage, /groupBy=/);
  assert.doesNotMatch(projectPage, /resolveCategoryStatusId/);
  assert.match(projectPage, /hiddenGroupIds=\{project\?\.hiddenColumns \|\| \[\]\}/);

  // The board still remembers folded columns per grouping — a category id and a
  // status id are different columns even when they share a name.
  assert.match(board, /const collapsedKey = `qt_board_collapsed_\$\{projectId \|\| 'default'\}\$\{byCategory \? '_category' : ''\}`/);
});

test('the personal board cannot be folded down to nothing', async () => {
  const myTasks = await read('../src/app/(app)/my/page.js');
  assert.match(myTasks, /next\.length >= categoryColumns\.length/);
  assert.match(myTasks, /Хоча б одна колонка має лишатися видимою/);
  assert.doesNotMatch(myTasks, /cardPageSize=/);
});

test('the personal board virtualizes large columns without progressive reveal controls', async () => {
  const board = await read('../src/components/workspace/AgileBoard.jsx');
  assert.match(board, /<VirtualDroppableColumn/);
  assert.doesNotMatch(board, /renderedColIssues|Показати ще|visibleCardLimits/);
  assert.match(board, /overflow-y-hidden pb-2 flex flex-col/);
  assert.match(board, /rounded-b-\[16px\] overflow-y-auto/);
});

test('the personal board asks for an exact status only when a category has several choices', async () => {
  const [myTasks, picker] = await Promise.all([
    read('../src/app/(app)/my/page.js'),
    read('../src/components/ui/TaskManagement/StatusTransitionPicker.jsx'),
  ]);

  assert.match(myTasks, /availableStatusesInCategory\(/);
  assert.match(myTasks, /movingAcrossCategories && candidates\.length > 1/);
  assert.match(myTasks, /<StatusTransitionPicker/);
  // The selected exact status still uses the same optimistic/API path as a
  // direct move on a project board.
  assert.match(myTasks, /moveTask\(issueId, statusId, categoryId, position, actor\)/);
  assert.match(picker, /layoutId="status-transition-task"/);
  assert.match(picker, /presentation="dialog"/);
  assert.match(picker, /<IssueCard/);
  assert.match(picker, /interactive=\{false\}/);
  assert.match(picker, /border-2 bg-canvas/);
  assert.match(picker, /type="radio"/);
  assert.match(picker, /scrollIntoView/);
  assert.match(picker, /ui-type-column-title/);
  assert.doesNotMatch(picker, /<Pill/);
});
