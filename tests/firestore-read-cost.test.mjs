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
  // Bounded by the size of the organization: one document per member and per
  // project. These grow with the team, not with use.
  ['lib/context/OrgContext.js', 'memberships and organizations of one user'],
  ['lib/hooks/useOrganization.js', 'one organization document and its members'],
  ['lib/hooks/useProjects.js', 'projects of one organization'],
  ['lib/hooks/useWorkflowConfig.js', 'one settings document'],
  ['components/IssueReadStateBridge.jsx', 'one read cursor per task this user opened'],

  // Bounded by the work itself, and reviewed as a deliberate cost: this is the
  // task dataset the boards and «Мої завдання» are all made of. It is the
  // product's core read, and the one thing left that grows without a ceiling as
  // the workspace ages. See docs/ARCHITECTURE.md → «Вартість читання».
  //
  // There is exactly one entry here now, and that is the point: four hooks used
  // to hold four listeners over these same documents, and Firestore bills a
  // delivery to each of them.
  ['lib/hooks/useOrganizationIssues.js', 'tasks and links of the projects this user can open — the whole product reads this one'],
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
    'components/workspace/MentionText.jsx',
  ];
  for (const file of renderers) {
    const source = readFileSync(join(root, file.split('/').join(sep)), 'utf8');
    assert.doesNotMatch(source, /api\/search/, `${file} must not ask search to draw itself`);
  }
});

// The unbounded collection this file used to spend most of its length on was
// `timeLogs`: one document every time a timer stopped, for every person, every
// day, never removed — read thirty days at a time by a report screen that then
// dropped most of it in the browser. qTicket does not track time, and there is
// no report screen left to open, so the window those tests held in place has no
// query behind it any more. What remains of the collection is maintained by the
// calendar routes through the Admin SDK, which no browser read ever reaches.

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
