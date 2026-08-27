import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  filterTeamIssues,
  filterTeamTimeLogs,
  memberAnalyticsHref,
} from '../src/lib/utils/teamAnalytics.mjs';

const issues = [
  { id: 'a', projectId: 'p1', assigneeIds: ['u1'], priority: 'high' },
  { id: 'b', projectId: 'p1', assigneeIds: ['u2'], priority: 'low' },
  { id: 'c', projectId: 'p2', assigneeIds: ['u1'], priority: 'low' },
];

const logs = [
  { id: 'l1', projectId: 'p1', userId: 'u1' },
  { id: 'l2', projectId: 'p1', userId: 'u2' },
  { id: 'l3', projectId: '', userId: 'u1', sourceType: 'calendar_event' },
];

test('team member selection filters tasks and time independently of task-only filters', () => {
  assert.deepEqual(
    filterTeamIssues(issues, [], 'u1').map(issue => issue.id),
    ['a', 'c'],
  );
  assert.deepEqual(
    filterTeamTimeLogs(logs, [], 'u1').map(log => log.id),
    ['l1', 'l3'],
  );
});

test('project filtering is consistent for team tasks and time', () => {
  assert.deepEqual(
    filterTeamIssues(issues, ['p1'], 'all').map(issue => issue.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    filterTeamTimeLogs(logs, ['p1'], 'all').map(log => log.id),
    ['l1', 'l2'],
  );
});

test('projectless event time remains visible when no project filter is active', () => {
  assert.equal(filterTeamTimeLogs(logs, [], 'all').some(log => log.id === 'l3'), true);
});

test('a task with several assignees contributes to every assignee analytics view', () => {
  const sharedIssue = { id: 'shared', projectId: 'p1', assigneeIds: ['u1', 'u2'] };
  const sharedIssues = [...issues, sharedIssue];

  assert.equal(filterTeamIssues(sharedIssues, [], 'u1').includes(sharedIssue), true);
  assert.equal(filterTeamIssues(sharedIssues, [], 'u2').includes(sharedIssue), true);
  assert.equal(filterTeamIssues(sharedIssues, [], 'all').filter(issue => issue.id === 'shared').length, 1);
});

test('team analytics counts every task in scope, a parent with subtasks included', () => {
  const hierarchicalIssues = [
    { id: 'parent', projectId: 'p1', assigneeIds: ['u1'] },
    { id: 'child-u1', projectId: 'p1', parentIssueId: 'parent', assigneeIds: ['u1'] },
    { id: 'child-u2', projectId: 'p1', parentIssueId: 'parent', assigneeIds: ['u2'] },
    { id: 'standalone', projectId: 'p1', assigneeIds: ['u1'] },
  ];

  assert.deepEqual(
    filterTeamIssues(hierarchicalIssues, ['p1'], 'all').map(issue => issue.id),
    ['parent', 'child-u1', 'child-u2', 'standalone'],
  );
  assert.deepEqual(
    filterTeamIssues(hierarchicalIssues, ['p1'], 'u1').map(issue => issue.id),
    ['parent', 'child-u1', 'standalone'],
  );
});

test('employee analytics opens as a dedicated encoded route', () => {
  assert.equal(memberAnalyticsHref('user/42'), '/analytics/team/user%2F42');
  assert.equal(
    memberAnalyticsHref('user/42', { projectIds: ['p1', 'p2', 'p1'], period: 14 }),
    '/analytics/team/user%2F42?projects=p1%2Cp2&period=14',
  );
  assert.equal(memberAnalyticsHref(''), '/analytics?tab=workload');
});

// One shape for a list of tasks, everywhere it is listed.
//
// Analytics drew three. Overview used TaskRow; the team pages drew a priority
// dot with a subtitle line; "Нещодавно закриті" drew a title, a project and a
// cycle time — and was the one list of tasks in the product you could not click
// through to the task. They are all `TaskListCard` now.
test('every analytics list of tasks is the shared TaskListCard', async () => {
  const files = [
    '../src/app/(app)/analytics/page.js',
    '../src/components/workspace/AnalyticsTab.jsx',
    '../src/components/workspace/VelocityTab.jsx',
    '../src/components/workspace/WorkloadTab.jsx',
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /<TaskListCard/, file);
    // No screen keeps a second way of drawing a task row beside it.
    assert.doesNotMatch(source, /<TaskRow/, file);
  }

  const card = await readFile(
    new URL('../src/components/ui/TaskManagement/TaskListCard.jsx', import.meta.url),
    'utf8',
  );
  // Rows are TaskRow, which is what makes them clickable and identical to the
  // board's list view.
  assert.match(card, /<TaskRow/);
  assert.match(card, /showProjectName = true/);

  // And it is a kit component: exported from the barrel and previewed.
  const index = await readFile(new URL('../src/components/ui/index.js', import.meta.url), 'utf8');
  assert.match(index, /export \{ default as TaskListCard \}/);
  const preview = await readFile(
    new URL('../src/app/ui-kit/sections/task-crm.jsx', import.meta.url),
    'utf8',
  );
  assert.match(preview, /<TaskListCard/);
});

// A timesheet names the task an hour was logged against.
//
// A member's own page used to be handed only the tasks *assigned* to them, so
// an hour logged on somebody else's task had nothing to resolve and the row
// read «???». The workspace timesheet, handed the whole record, named that very
// same task perfectly — and adding yourself as assignee made the «???» go away,
// which teaches exactly the wrong lesson about what an assignee is.
//
// Logging time on a task you do not own is ordinary. What a timesheet needs is
// the record, not the assignment.
test('a member timesheet resolves every task its hours point at', async () => {
  const workload = await readFile(
    new URL('../src/components/workspace/WorkloadTab.jsx', import.meta.url),
    'utf8',
  );

  // `referenceIssues` is `logIssues` — every task in scope, archived included,
  // which is what this same component already hands «Останні записи часу».
  assert.match(workload, /issues=\{stat\.referenceIssues\}/);
  assert.doesNotMatch(workload, /issues=\{stat\.timesheetIssues\}/);
  assert.match(workload, /referenceIssues: logIssues/);

  // And a month cell says «Відкрити тиждень», so it has to open one. Without a
  // handler it was a pointer over a dead square.
  assert.match(workload, /onSelectDay=\{day => \{ setAnchor\(day\); setMode\('week'\); \}\}/);
});

// The card lights up under the pointer, which is a promise that it is
// clickable. That promise used to be kept by six characters of the issue key
// alone, while the title right below it — the part a person reads and aims at
// — did nothing at all.
test('a timesheet card is the link, not the identifier inside it', async () => {
  const timesheet = await readFile(
    new URL('../src/components/workspace/TimesheetTab.jsx', import.meta.url),
    'utf8',
  );
  assert.match(timesheet, /const href = issue \? issuePath\(issue\) : event \? calendarEventHref\(event\) : null;/);
  assert.match(timesheet, /<Link key=\{targetKey\} href=\{href\}/);
  // The hover affordance appears only where there is somewhere to go.
  assert.match(timesheet, /href \? 'hover:border-faint' : ''/);
  // «???» told nobody anything. What is left says one thing only: the task
  // behind this hour no longer exists.
  assert.doesNotMatch(timesheet, /\?\?\?/);
  assert.match(timesheet, /title="Джерело запису більше не існує"/);
});
