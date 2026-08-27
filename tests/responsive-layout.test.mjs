import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('mobile keeps Kanban as a first-class horizontally swipeable board', () => {
  const board = read('src/components/workspace/AgileBoard.jsx');
  assert.match(board, /w-\[82vw\] max-w-\[320px\]/);
  assert.doesNotMatch(board, /max-(?:sm|md):hidden[^\n]*AgileBoard/);
});

test('task chat exposes an unread boundary and reads it only after visibility', () => {
  const timeline = read('src/components/workspace/UnifiedTimeline.jsx');
  const detail = read('src/components/workspace/IssueDetail.jsx');
  // The boundary counts everything the feed carries — messages and changes both.
  // Drawn from the messages alone, it left a task where somebody moved the
  // deadline and said nothing looking untouched.
  assert.match(timeline, /const unreadTotal = unreadCommentIds\.length \+ unreadChangeIds\.length;/);
  // The line carries no number: it stays where the visit found it while the
  // conversation moves, so any count on it goes stale the moment anybody writes.
  assert.match(timeline, /<UnreadDivider label=\{unreadLabel\}/);
  assert.match(timeline, /new IntersectionObserver/);
  assert.match(timeline, /scrollToUnread/);
  // The line stays where the visit found it. Derived live from `unreadTotal` it
  // disappeared the moment it was read, pulling its own height out of the list
  // under the reader.
  assert.match(timeline, /sessionBoundary/);
  // Reading the boundary consumes the changes too. They used to be consumed
  // only by leaving the task, so «11 нових» stood there for a whole visit no
  // matter how far you read.
  assert.match(timeline, /consumeChanges\(\);/);
  assert.match(timeline, /markIssueSeen\(\{/);
  // The jump button points where the line actually is.
  assert.match(timeline, /unreadDirection === 'up' \? ChevronUp : ChevronDown/);
  assert.match(detail, /label: 'Чат'.*count: unreadTaskChatCount/);
});

test('dense analytics, timesheet and invoice data have dedicated mobile cards', () => {
  const workspaceAnalytics = read('src/app/(app)/analytics/page.js');
  const projectAnalytics = read('src/components/workspace/AnalyticsTab.jsx');
  const timesheet = read('src/components/workspace/TimesheetTab.jsx');
  const billing = read('src/components/workspace/BillingTab.jsx');

  // The two analytics tables are `DataTable` now, and the stacked layout is
  // part of it rather than a second block each screen wrote for itself. Both
  // screens had written it, and only one of the three tables on them had it at
  // all — the team overview shipped a six-column grid with no phone layout.
  const dataTable = read('src/components/ui/DataDisplay/DataTable.jsx');
  assert.match(dataTable, /className="hidden min-w-0 overflow-hidden md:block"/);
  assert.match(dataTable, /flex flex-col gap-2 md:hidden/);
  for (const source of [workspaceAnalytics, projectAnalytics]) {
    assert.match(source, /<DataTable/);
  }
  assert.match(timesheet, /space-y-3 lg:hidden/);
  assert.match(timesheet, /hidden overflow-x-auto rounded-\[16px\] bg-white lg:block/);
  assert.match(billing, /mb-2 space-y-2 sm:hidden/);
  assert.match(billing, /hidden w-full sm:table/);
});

test('the task composer respects the device safe area', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /timeline-composer[^}]*calc\(20px \+ var\(--sab\)\)/s);
});
