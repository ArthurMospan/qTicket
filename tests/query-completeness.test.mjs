import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { COLUMN_VIRTUALIZATION_THRESHOLD } from '../src/lib/utils/boardRendering.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('workspace task listeners expose their complete authorized scope', async () => {
  const [issues, mine, sprints, analytics, shared] = await Promise.all([
    read('src/lib/hooks/useIssues.js'),
    read('src/lib/hooks/useAllMyTasks.js'),
    read('src/lib/hooks/useSprints.js'),
    read('src/lib/hooks/useWorkspaceAnalytics.js'),
    read('src/lib/hooks/useOrganizationIssues.js'),
  ]);

  for (const source of [issues, mine, sprints, analytics, shared]) {
    assert.doesNotMatch(source, /limit\(/);
    assert.doesNotMatch(source, /hasMore/);
    assert.doesNotMatch(source, /loadMore/);
  }
  // «Мої завдання» is a filter over the shared set rather than a query of its
  // own — the same complete scope, asked for once. The filter is still by
  // assignee and still says so.
  assert.match(mine, /issue\.assigneeIds\?\.includes\(userId\)/);
  assert.match(shared, /where\('projectId', 'in', chunk\)/);
  assert.match(sprints, /orderBy\('createdAt', 'desc'\)/);
  assert.match(analytics, /includeTimeLogs/);
});

test('large single-swimlane columns virtualize without hiding tasks behind a button', async () => {
  const [board, column, card, sprintPage, projectPage, myPage, profile] = await Promise.all([
    read('src/components/workspace/AgileBoard.jsx'),
    read('src/components/workspace/VirtualDroppableColumn.jsx'),
    read('src/components/workspace/IssueCard.jsx'),
    read('src/app/(app)/sprints/page.js'),
    read('src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('src/app/(app)/my/page.js'),
    read('src/components/profile/ProfileView.jsx'),
  ]);

  assert.equal(COLUMN_VIRTUALIZATION_THRESHOLD, 40);
  // The windowing itself is one module, so the board and the sprint backlog —
  // the other list long enough to need it — cannot drift into two answers.
  assert.match(column, /mode="virtual"/);
  assert.match(column, /renderClone=/);
  assert.match(column, /const VIRTUAL_OVERSCAN = [1-9]\d*/);
  assert.match(column, /new ResizeObserver\(report\)/);
  assert.match(column, /const index = visibleRange\.start \+ offset/);
  assert.match(board, /const shouldVirtualize = swimlanes\.length === 1/);
  assert.match(board, /<VirtualDroppableColumn[\s\S]*issues=\{colIssues\}/);
  assert.match(board, /visibleColumnIds = columnCards/);
  assert.match(
    sprintPage,
    /sorted\.length > COLUMN_VIRTUALIZATION_THRESHOLD[\s\S]{0,200}<VirtualDroppableColumn/,
  );
  assert.match(card, /dragProvided/);
  assert.match(card, /virtualStyle/);

  for (const source of [board, column, sprintPage, projectPage, myPage, profile]) {
    assert.doesNotMatch(source, /Завантажити ще|Показати ще|Довантажити дані/);
  }
  assert.doesNotMatch(board, /renderedColIssues|remainingIssueCount|visibleCardLimits/);
  assert.doesNotMatch(sprintPage, /renderedIssues|remainingIssueCount|visibleIssueLimits/);
});

test('sprint planning skips unused time-log subscriptions', async () => {
  const page = await read('src/app/(app)/sprints/page.js');
  assert.match(page, /useWorkspaceAnalytics\(projectIds, \{ includeTimeLogs: false \}\)/);
});

// A list of tasks is bounded by the card, and by nothing else.
//
// This used to assert the opposite: no slicing anywhere, on the reasoning that
// a number you cannot get to the rows behind is worse than a long list. The
// reasoning holds; the conclusion did not. A member's «Усі» is every task they
// have ever been assigned, and a thousand rows is not a report — it is a page
// with no bottom, and a thousand rows the browser lays out before it can draw
// anything below them.
//
// What the rule protects is the *reachability* of the rest, so that is what it
// checks now: one limit, owned by the card, with a control that lifts it. What
// stays forbidden is a call site inventing its own limit — that is how the same
// list ended up showing five rows here and fifty there — and any screen quietly
// dropping rows with no way to ask for them.
test('a long list of tasks is bounded by the card, with a way to the rest', async () => {
  const [taskList, overview, projectAnalytics, workload, velocity] = await Promise.all([
    read('src/components/ui/TaskManagement/TaskListCard.jsx'),
    read('src/app/(app)/analytics/page.js'),
    read('src/components/workspace/AnalyticsTab.jsx'),
    read('src/components/workspace/WorkloadTab.jsx'),
    read('src/components/workspace/VelocityTab.jsx'),
  ]);

  // The card owns the limit and the way past it.
  assert.match(taskList, /const INITIAL_ROWS = \d+/);
  assert.match(taskList, /Показати ще/);
  assert.match(taskList, /Згорнути/);
  // And the count beside the title is the whole set, never the visible part —
  // otherwise the number agrees with the card instead of with the truth.
  assert.match(taskList, /const total = typeof count === 'number' \? count : issues\.length/);
  assert.doesNotMatch(taskList, /count=\{visible\.length\}/);

  // No call site carries a limit of its own.
  assert.doesNotMatch(taskList, /props\.limit|\blimit\s*=/);
  for (const source of [overview, projectAnalytics, workload, velocity]) {
    assert.doesNotMatch(source, /<TaskListCard[\s\S]{0,500}\b(limit|initialCount|maxRows)=/);
  }
  // And no screen drops rows on its own account, which is the part that was
  // never negotiable: the card asks, a silent `.slice` does not.
  assert.doesNotMatch(workload, /rows\.slice\(0,|logs\.slice\(0,/);
  assert.doesNotMatch(velocity, /byProject\.slice\(0,/);
});
