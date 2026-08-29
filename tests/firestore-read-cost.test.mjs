import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// What a screen costs to open.
//
// Production runs on a hard daily read cap, and the two outages this product
// has had were not caused by traffic — they were caused by three lines of code
// each. A capsule that asked the server what a task was called, once per
// capsule. A badge that subscribed to a whole channel's history, once per card.
// An audit log that read four hundred documents and kept fifty. None of those
// looked expensive at the call site, and none of them was caught by review.
//
// So the rule is mechanical: a live listener over a collection is bounded, by
// `limit()`, or it is named here with the reason it cannot grow. Adding a
// listener is a cost decision, and this is where that decision is recorded.

const root = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? sourceFiles(full)
      : (/\.(js|jsx|mjs)$/.test(full) ? [full] : []);
  });
}

/**
 * Every `onSnapshot` in the product, with what the fifteen lines above it say
 * about the query. Fifteen is enough for every query in this codebase and is
 * checked below: a listener whose collection cannot be seen is reported too,
 * rather than quietly passing.
 */
function listeners() {
  const found = [];
  for (const file of sourceFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!line.includes('onSnapshot(')) return;
      const context = lines.slice(Math.max(0, index - 15), index + 6).join('\n');
      const collectionMatch = context.match(/collection\(\s*db,\s*'([^']+)'/);
      // The collection itself rather than a subcollection under it:
      // `collection(db, 'issues')` is the task stream, `collection(db,
      // 'issues', id, 'audit')` is one task's history and a different cost.
      const rootCollections = [...context.matchAll(/collection\(\s*db,\s*'([^']+)'\s*\)/g)]
        .map(match => match[1]);
      found.push({
        file: relative(root, file).split(sep).join('/'),
        line: index + 1,
        collection: collectionMatch?.[1] || null,
        rootCollections,
        bounded: /\blimit\(/.test(context),
        // A listener on one document reads one document, whatever else is true.
        singleDocument: !/collection\(/.test(context) && /\bdoc\(/.test(context),
      });
    });
  }
  return found;
}

// Listeners over a collection with no `limit()`. Each one is here because
// something other than a limit bounds it — and that something is written down,
// because «it is small today» is how the last two outages started.
const BOUNDED_WITHOUT_LIMIT = new Map([
  // Bounded by the size of the organization: one document per member, per
  // project, per channel, per sprint. These grow with the team, not with use.
  ['lib/context/OrgContext.js', 'memberships and organizations of one user'],
  ['lib/hooks/useOrganization.js', 'one organization document and its members'],
  ['lib/hooks/useOrganizationPresence.js', 'one presence document per member'],
  ['lib/hooks/useProjects.js', 'projects of one organization'],
  ['lib/hooks/useSprints.js', 'sprints of one project'],
  ['lib/hooks/useWorkflowConfig.js', 'one settings document'],
  ['lib/hooks/useUnreadChatCount.js', 'channels and read cursors of one organization'],
  ['components/IssueReadStateBridge.jsx', 'one read cursor per task this user opened'],
  ['app/(app)/chat/page.js', 'presence and channels of one organization'],
  ['lib/hooks/useWorkspaceChat.js', 'channels of one organization; messages ARE limited'],
  ['lib/hooks/useStagesForProject.js', 'stages of one project'],
  ['components/workspace/BillingTab.jsx', 'invoices of one project'],

  // Bounded by the work itself, and reviewed as a deliberate cost: this is the
  // task dataset the boards, the analytics and «Мої завдання» are all made of.
  // It is the product's core read, and the one thing left that grows without a
  // ceiling as the workspace ages. See docs/ARCHITECTURE.md → «Вартість читання».
  //
  // There is exactly one entry here now, and that is the point: four hooks used
  // to hold four listeners over these same documents, and Firestore bills a
  // delivery to each of them.
  ['lib/hooks/useOrganizationIssues.js', 'tasks and links of the projects this user can open — the whole product reads this one'],
  ['lib/hooks/useWorkspaceAnalytics.js', 'the time logs, and they ARE windowed by loggedAt'],
  ['lib/hooks/useTimeLogs.js', 'time logged against one task'],
  ['lib/hooks/useProjectTimeLogs.js', 'time logged against one project'],
  ['lib/hooks/useProjectAllTimeLogs.js', 'time logged against one project'],
  ['lib/hooks/useNotifications.js', 'the notification stream, itself limited by query'],
  ['lib/hooks/useAuth.js', 'one user document'],
]);

test('every live listener over a collection is bounded, or says why it cannot grow', () => {
  const unbounded = listeners()
    .filter(entry => !entry.singleDocument && !entry.bounded)
    .filter(entry => !BOUNDED_WITHOUT_LIMIT.has(entry.file))
    .map(entry => `${entry.file}:${entry.line}`);

  assert.deepEqual(
    unbounded,
    [],
    'A new listener reads its whole collection on every screen that mounts it. '
    + 'Give it a limit(), or add it to BOUNDED_WITHOUT_LIMIT with the reason it cannot grow.',
  );
});

test('the listeners that carry a limit keep carrying it', () => {
  const mustBeBounded = [
    'lib/hooks/useComments.js',
    'lib/hooks/useAuditLog.js',
  ];
  const bounded = new Set(listeners().filter(entry => entry.bounded).map(entry => entry.file));
  for (const file of mustBeBounded) {
    assert.ok(
      bounded.has(file),
      `${file} reads a history that grows forever; it must stay windowed by limit().`,
    );
  }
});

// One query, four readers.
//
// «Мої завдання», the board, the task screen and the reports all describe the
// same documents; what differs is which ones each of them hides. Reading them
// four times over four listeners is not four times the answer, it is four
// times the bill — and it was roughly two thirds of the day the free tier's
// fifty thousand reads ran out at nine in the evening.
//
// So the rule is that no screen opens its own `issues` or `issueLinks` stream.
// This test is what stops the next convenient exception, because a second
// listener over this collection does not look expensive at the call site: it
// looks like one more `onSnapshot`.
// A listener over `issues` that is not the shared subscription, with the reason
// it is allowed to exist. There is exactly one, and the bar for a second is the
// same as this one cleared: it must be bounded by `limit()`, it must answer a
// question the shared set cannot answer more cheaply, and it must be on a
// screen that would otherwise have to open the shared set for nothing.
const TASK_READERS_BESIDE_THE_SHARED_ONE = new Map([
  [
    'lib/hooks/useProjectActivity.js',
    'three documents of one project, ordered and limited by Firestore, so the '
    + 'home screen can draw three activity lines without subscribing to every '
    + 'task in the workspace to find them',
  ],
]);

test('only the shared subscription reads tasks and the links between them', () => {
  const readers = listeners().filter(entry => (
    entry.rootCollections.includes('issues') || entry.rootCollections.includes('issueLinks')
  ));
  const files = [...new Set(readers.map(entry => entry.file))];
  assert.deepEqual(
    files.filter(file => !TASK_READERS_BESIDE_THE_SHARED_ONE.has(file)),
    ['lib/hooks/useOrganizationIssues.js'],
    'Tasks are read once, by useOrganizationIssues, and filtered in memory by '
    + 'whoever needs a narrower view. A second listener over the same documents '
    + 'is a second delivery charge for the same write — unless it is bounded and '
    + 'named in TASK_READERS_BESIDE_THE_SHARED_ONE with the reason.',
  );

  // An exception that stopped being bounded is not an exception any more.
  for (const entry of readers) {
    if (!TASK_READERS_BESIDE_THE_SHARED_ONE.has(entry.file)) continue;
    assert.equal(
      entry.bounded,
      true,
      `${entry.file} reads tasks outside the shared subscription and must keep its limit()`,
    );
  }

  // …and the screens that used to own one take the shared set instead.
  for (const file of [
    'lib/hooks/useIssues.js',
    'lib/hooks/useAllMyTasks.js',
    'lib/hooks/useWorkspaceAnalytics.js',
  ]) {
    const sourceText = readFileSync(join(root, file.split('/').join(sep)), 'utf8');
    assert.match(
      sourceText,
      /useOrganizationIssues/,
      `${file} must read tasks through the shared subscription`,
    );
  }
});

test('the allowlist does not outlive the files it names', () => {
  const seen = new Set(listeners().map(entry => entry.file));
  const stale = [...BOUNDED_WITHOUT_LIMIT.keys()].filter(file => !seen.has(file));
  assert.deepEqual(stale, [], 'These files no longer listen to anything; drop them from the list.');
});

// A mention is an exact key, and an exact key is one query. Search reads the
// whole organization to rank it, so nothing that renders per element may call
// it — that is what spent a day's quota on drawing eight words.
test('nothing that renders per element resolves itself through search', () => {
  const renderers = [
    'components/workspace/IssueMentionChip.jsx',
    'components/workspace/HoverCard.jsx',
    'components/workspace/MessageContent.jsx',
    'components/workspace/MentionText.jsx',
  ];
  for (const file of renderers) {
    const source = readFileSync(join(root, file.split('/').join(sep)), 'utf8');
    assert.doesNotMatch(source, /api\/search/, `${file} must not ask search to draw itself`);
  }
});

// A report is a window, not a history.
//
// Tasks are bounded by the work: one document per thing somebody is doing, and
// a workspace has as many as it has work. Time logs are not bounded by
// anything. One is written every time a timer stops — by every person, every
// day — and none is ever removed. The analytics screen said «за 30 днів» and
// read every one of them, then dropped the rest in the browser, so the cost of
// opening it grew with the age of the workspace rather than with the period
// being shown. That is the same shape as both outages: a query with no edge.
//
// The period is therefore a bound in the query. These tests hold that edge in
// place: the hook cannot read logs without a window, the screens have to say
// which window they are drawing, and the composite indexes those queries need
// have to exist, because a missing index is a query that fails in production
// and nowhere else.
test('the analytics time-log queries are bounded by the period being drawn', async () => {
  const source = readFileSync(join(root, 'lib', 'hooks', 'useWorkspaceAnalytics.js'), 'utf8');

  // Every timeLogs query in the hook carries the window — counted rather than
  // parsed, because the thing that must never happen is one more query than
  // there are bounds.
  const timeLogQueries = source.match(/collection\(db, 'timeLogs'\)/g) || [];
  const boundedQueries = source.match(/\.\.\.windowBounds,/g) || [];
  assert.ok(timeLogQueries.length >= 3, 'expected the task, calendar and org-calendar queries');
  assert.equal(
    boundedQueries.length,
    timeLogQueries.length,
    'every timeLogs query in this hook must spread the window into itself',
  );
  assert.match(source, /where\('loggedAt', '>=', Timestamp\.fromMillis\(sinceMillis\)\)/);
  assert.match(source, /where\('loggedAt', '<', Timestamp\.fromMillis\(untilMillis\)\)/);

  // …and there is no path that reads them without one. A default window would
  // be the bug wearing a parameter name.
  assert.match(source, /const windowedTimeLogs = includeTimeLogs && isTimeLogWindow\(timeLogWindow\)/);
  assert.match(source, /timeLogWindow is required whenever includeTimeLogs is on/);
  assert.doesNotMatch(source, /timeLogWindow = \{/);
});

test('every screen that reads time logs says which window it is drawing', async () => {
  const callers = [
    'app/(app)/analytics/page.js',
    'app/(app)/analytics/team/[memberId]/page.js',
  ];
  for (const file of callers) {
    const source = readFileSync(join(root, file.split('/').join(sep)), 'utf8');
    assert.match(source, /timeLogWindow/, `${file} must bound its time-log read`);
    assert.match(
      source,
      /dayRangeTimeLogWindow|timesheetTimeLogWindow|memberAnalyticsTimeLogWindow/,
      `${file} must take its window from analyticsWindow.mjs, not invent one`,
    );
    // And the period itself is whole days in the organization's timezone, so
    // that the daily totals and the records behind them are about the same
    // stretch of time.
    assert.match(
      source,
      /periodDayRange\(|memberAnalyticsTimeLogWindow/,
      `${file} must measure its period in days`,
    );
  }

  // The screens that do not need hours do not pay for them.
  const settings = readFileSync(join(root, 'app', '(app)', 'settings', 'page.js'), 'utf8');
  assert.match(settings, /includeTimeLogs: false/);
});

// A live listener earns its cost where somebody is acting on the data as it
// changes — a board they are dragging cards on, a task two people are editing,
// a conversation. A report is not that. Nobody drags anything on «Огляд»; the
// numbers are read, and a figure that rewrites itself mid-sentence is a
// distraction that also holds a listener open over the largest collections in
// the product for as long as the tab is left up.
test('the report screens take a reading rather than holding a subscription', () => {
  const hook = readFileSync(join(root, 'lib', 'hooks', 'useWorkspaceAnalytics.js'), 'utf8');
  // What `live` governs is the time logs. The tasks are no longer this hook's
  // to subscribe to or to read once: they come from the shared subscription,
  // where one live listener serves every screen — which is cheaper than four
  // screens each buying their own one-off copy of the same documents.
  assert.match(hook, /useOrganizationIssues\(activeOrgId, projectIds\)/);
  // One hook, two modes — not two code paths that can drift apart.
  assert.match(hook, /live = true,/);
  assert.match(hook, /if \(live\) \{\s*\n\s*return onSnapshot\(/);
  assert.match(hook, /getDocs\(sourceQuery\)/);
  // «Оновлено о» is a claim about age, so it is refused while the data is live.
  assert.match(hook, /readAt: live \? null :/);

  for (const file of [
    'app/(app)/analytics/page.js',
    'app/(app)/analytics/team/[memberId]/page.js',
  ]) {
    const source = readFileSync(join(root, file.split('/').join(sep)), 'utf8');
    assert.match(source, /live: false/, `${file} must read rather than subscribe`);
    // And a screen that stopped updating itself has to say so, and offer a
    // newer reading. Either half alone is worse than the live listener was.
    assert.match(source, /<RefreshStamp/, `${file} must say when it was read`);
    assert.match(source, /onRefresh=\{refresh/, `${file} must offer a newer reading`);
  }

  // The screens where the data is the thing being worked on keep the default.
  for (const file of ['app/(app)/my/page.js', 'app/(app)/settings/page.js']) {
    const source = readFileSync(join(root, file.split('/').join(sep)), 'utf8');
    assert.doesNotMatch(source, /live: false/, `${file} is a working screen, not a report`);
  }
});

test('the windowed time-log queries have the composite indexes they need', () => {
  const indexes = JSON.parse(
    readFileSync(fileURLToPath(new URL('../firestore.indexes.json', import.meta.url)), 'utf8'),
  ).indexes;
  const paths = indexes
    .filter(entry => entry.collectionGroup === 'timeLogs')
    .map(entry => entry.fields.map(field => field.fieldPath).join(','));

  // A range on `loggedAt` next to `issueId != ''` is two inequality fields, so
  // the index has to carry both — and Firestore chooses the index by the order
  // the fields appear in the filter set, not by which range is the more
  // selective. `(…, loggedAt, issueId)` looked like the better plan and was
  // simply not an index this query can use: production answered
  // FAILED_PRECONDITION with the ordering below spelled out. Reasoning about
  // the planner is not the same as asking it.
  assert.ok(
    paths.includes('organizationId,projectId,issueId,loggedAt'),
    'task logs in a window need (organizationId, projectId, issueId, loggedAt)',
  );
  assert.ok(
    paths.includes('organizationId,projectId,sourceType,eventVisibility,loggedAt'),
    'team calendar logs in a window need their own index ending in loggedAt',
  );
});

// What the product says when the cap is actually reached.
//
// The cost rules above are about not reaching it. This is about the day they
// fail, which has now happened more than once. Three surfaces can be the first
// to know, and until now all three were wrong in a different way: the render
// boundary blamed the rendering, the organization card called a known refusal
// «тимчасово недоступний», and a read that never came back showed a spinner
// with no end — the worst of the three, because a spinner asks the reader to
// keep waiting and never tells them to stop.
test('a refused read is named, and never shown as a spinner that never ends', async () => {
  const [quota, errors, layout, boundary] = await Promise.all([
    readFile(new URL('../src/lib/utils/quotaState.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/utils/errors.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/(app)/layout.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/(app)/error.js', import.meta.url), 'utf8'),
  ]);

  // The refusal is recorded where every load failure already passes, because
  // the read that gets refused is rarely the one whose failure reaches a screen.
  assert.match(errors, /noteQuotaRefusal\(\)/);
  assert.match(quota, /export function isQuotaRefused/);
  // One sentence, in one place, so the three surfaces cannot describe the same
  // event three ways again.
  assert.match(quota, /QUOTA_FAILURE_COPY/);
  assert.match(quota, /50 000 читань на добу/);

  // The spinner has an end, and what is behind it is the card.
  assert.match(layout, /const LOAD_STALL_MS/);
  assert.match(layout, /if \(loadStalled\) \{/);
  assert.match(layout, /<WorkspaceLoadFailure error=\{orgError\}/);
  assert.match(layout, /QUOTA_FAILURE_COPY\.title/);

  // And the render boundary stops blaming the rendering for a database that
  // answered «no».
  assert.match(boundary, /isQuotaExceededError\(error\) \|\| isQuotaExceededError\(error\?\.cause\) \|\| isQuotaRefused\(\)/);
  assert.match(boundary, /quotaSpent \? QUOTA_FAILURE_COPY\.title : 'qTicket не завантажився'/);
});
