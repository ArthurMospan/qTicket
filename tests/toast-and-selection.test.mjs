import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../src', import.meta.url));
const read = path => readFileSync(join(root, path.split('/').join(sep)), 'utf8');

function sourceFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? sourceFiles(full)
      : (/\.(js|jsx|mjs)$/.test(full) ? [full] : []);
  });
}

// A toast already says what kind of thing it is — a green check, a red alert, a
// yellow triangle, drawn by the component. A «✓» typed into the message repeats
// that in a worse typeface, and only some of the time: the same product used to
// confirm «Канал створено ✓» and «Проєкт архівовано» in one session.
test('a toast says what happened and lets its icon say how it went', () => {
  const DECORATION = /[✓✅❌⛔⚠🎉👍🚀💾🗑📌✔✖]/u;
  const offenders = [];
  for (const file of sourceFiles(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (!/\b(showToast|onError\?\.)\s*\(/.test(line)) return;
      if (DECORATION.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

// A confirmation is read at a glance; a failure has to be read, and often
// decided about — «повідомити про це?» — which nobody manages in 3.5 seconds.
test('a failure stays on screen long enough to act on', () => {
  const store = read('store/useWorkspaceStore.js');
  assert.match(store, /type === 'error' \? 9000 : type === 'warning' \? 6000 : 3500/);
  assert.match(store, /detail: options\.detail \|\| null/);
});

// And it offers a way back to us, because a failure the user has to describe is
// a failure that never gets described.
test('a failure can be reported, and the report has somewhere to land', () => {
  const toast = read('components/ui/Feedback/Toast.jsx');
  const host = read('components/WorkspaceToastHost.jsx');
  const route = read('app/api/error-reports/route.js');
  const inbox = read('app/api/error-reports/inbox/route.js');
  const page = read('app/errors/page.js');

  assert.match(toast, /isError && onReport/);
  assert.match(toast, /Повідомити про помилку/);
  // Quiet on purpose: an offer, not an instruction.
  assert.match(toast, /border-white\/15 bg-white\/10/);
  // A failed report must not offer to report itself.
  assert.match(host, /context !== 'error-report'/);
  // Written through the server: the browser cannot be trusted with who it says
  // it is, and the collection stays unreadable from any client.
  assert.match(route, /authorizeOrgRequest/);
  assert.match(route, /enforceRateLimit\('errorReport'/);
  // One root collection with the workspace stamped on each report, not a
  // subcollection of the workspace: reading the newest hundred across every
  // organization then needs no index deployed before the page works.
  assert.match(route, /db\.collection\('errorReports'\)\.add\(report\)/);
  assert.match(route, /organizationName: organizationSnapshot/);

  // Reading is not a role. It used to be «власник організації», which is the
  // wrong person the moment a workspace belongs to a customer — so no role in
  // an organization may decide this again.
  assert.doesNotMatch(route, /membership\?\.role/);
  assert.doesNotMatch(inbox, /membership/);
  // And it is not a shared secret either. This repository is public, so the one
  // place a password could be written down is also the one place anybody could
  // read it — a value nobody has to guess is not protected by bounding guesses.
  // The reader is a named account instead: an id identifies without granting,
  // because reaching the inbox still means holding a session for it.
  assert.doesNotMatch(inbox, /const PASSWORD/);
  assert.doesNotMatch(inbox, /timingSafeEqual/);
  assert.match(inbox, /authenticateRequest/);
  assert.match(inbox, /BUILT_IN_READERS/);
  assert.match(inbox, /readers\(\)\.has\(authorization\.user\.uid\)/);
  // Held down rather than guessed at, so the limit is now per account.
  assert.match(inbox, /enforceRateLimit\('errorReportsInbox', authorization\.user\.uid/);

  assert.match(page, /Звіти про помилки/);
  // The session is the whole credential, so the page has nothing of its own to
  // keep — and never had.
  assert.doesNotMatch(page, /localStorage|sessionStorage|document\.cookie/);
  assert.doesNotMatch(page, /type="password"/);
});

// The table draws a page at a time, so a header box that claimed «всі» would
// select fifty of three hundred and say otherwise.
test('the table header selects what is on screen, and asks about the rest', () => {
  const table = read('components/ui/TaskManagement/TaskTableView.jsx');
  const checkbox = read('components/ui/Forms/Checkbox.jsx');

  assert.match(table, /const drawnAllSelected = drawnRows\.length > 0/);
  assert.match(table, /onChange=\{\(\) => toggleIssueScope\(drawnRows\.map\(issue => issue\.id\)\)\}/);
  assert.match(table, /indeterminate=\{drawnSomeSelected\}/);
  // The whole list is a second, explicit step — and only while something is
  // actually out of sight and unselected.
  assert.match(table, /drawnAllSelected && hiddenRowCount > 0/);
  assert.match(table, /Вибрати всі \{rows\.length\}/);
  assert.match(table, /toggleIssueScope\(rows\.map\(issue => issue\.id\)\)/);
  // `indeterminate` is a DOM property with no attribute, so it is written onto
  // the node; and it is not a third value a caller can be handed back.
  assert.match(checkbox, /inputRef\.current\.indeterminate = Boolean\(indeterminate\) && !checked/);
});

// A subtask names the task it hangs under. That slot is for an identifier, and
// a noun phrase in it does not read as «unknown» — it reads as the number. Nor
// does an empty slot: an arrow pointing at nothing is a relation that is
// somehow both stated and missing, so the relation is drawn only when it can
// be named. A cancelled parent is the common way to reach that state — it is
// filtered out of every stream that publishes issues.
test('a subtask never prints prose where its parent’s key goes', () => {
  const identity = read('components/ui/TaskManagement/TaskIdentity.jsx');
  const detail = read('components/workspace/IssueDetail.jsx');
  const createRoute = read('app/api/issues/route.js');
  const parentRoute = read('app/api/issues/[issueId]/parent/route.js');

  assert.doesNotMatch(identity, /parentIssue\.issueKey \|\| parentIssue\.title \|\| 'Батьківське завдання'/);
  assert.match(identity, /const showsParent = Boolean\(parentIssue\) && Boolean\(parentKey\)/);
  assert.match(identity, /\{showsParent && \(/);
  assert.match(identity, /<span className="min-w-0 truncate">\{parentKey\}<\/span>/);
  // The task's own screen states the relation in full, so it may not fall back
  // to the raw Firestore document id when the parent is not in what it loaded.
  assert.doesNotMatch(detail, /\{parentIssue\?\.issueKey \|\| parentIssueId\}/);
  assert.match(detail, /parentIssue\?\.issueKey \|\| issue\?\.parentIssueKey/);
  // Through `taskDisplayKey`, like the card's own key: a parent still stored
  // under the pre-prefix `WS-7` was printed raw beside a child called
  // `DESIGN-363`, as though they belonged to different projects.
  assert.match(identity, /const parentKey = parentIssue/);
  assert.match(identity, /issue\?\.parentIssueKey/);
  // Written down where the child can read it, by the transactions that already
  // read the parent to validate the move.
  assert.match(createRoute, /parentIssueKey = parent\?\.issueKey \|\| ''/);
  assert.match(parentRoute, /parentIssueKey: parent\?\.issueKey \|\| FieldValue\.delete\(\)/);
});

// «Списати час» is what an accountant does to a balance.
test('time is recorded, not written off', () => {
  const offenders = [];
  for (const file of sourceFiles(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (/[Сс]писан|[Сс]писат/.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
