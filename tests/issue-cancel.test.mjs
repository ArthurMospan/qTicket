// Cancelling a task: the third action, and the only one that takes work out of
// the record as well as out of the way. What is covered here is the difference
// between it and the archive, because that difference is the only reason both
// exist — and it is a difference that lives in whether a number counts a task,
// which nothing on screen would show until a report is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CANCEL_FIELDS,
  cancelledIssuesOf,
  isCancelledIssue,
  withoutCancelledIssues,
} from '../src/lib/utils/issueCancel.mjs';
import { INCIDENT_TERMS } from '../src/lib/content/incidentTerms.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a cancelled task is the one carrying cancelledAt', () => {
  assert.equal(isCancelledIssue({ cancelledAt: new Date() }), true);
  assert.equal(isCancelledIssue({ cancelledAt: null }), false);
  assert.equal(isCancelledIssue({}), false);
  assert.equal(isCancelledIssue(null), false);

  const issues = [{ id: 'a' }, { id: 'b', cancelledAt: new Date() }];
  assert.deepEqual(withoutCancelledIssues(issues).map(i => i.id), ['a']);
  assert.deepEqual(cancelledIssuesOf(issues).map(i => i.id), ['b']);
  assert.deepEqual([...CANCEL_FIELDS], ['cancelledAt', 'cancelledBy']);
});

test('cancelling is its own action, beside archiving and deleting', async () => {
  const [registry, bar, detail, route] = await Promise.all([
    read('../src/lib/bulk/issueBulkActions.mjs'),
    read('../src/components/ui/TaskManagement/BulkActionBar.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/api/issues/bulk/route.js'),
  ]);
  assert.match(registry, /id: 'cancel'[^}]*permission: 'edit:issue'/);
  // Routed to its own endpoint — not into the archive's, which would leave the
  // task in every report it was supposed to leave.
  assert.match(route, /actionId === 'cancel'[\s\S]{0,400}\/cancel/);
  // Offered on the task itself next to the other two, and taken back from
  // there too.
  assert.match(detail, /label: 'Скасувати', icon: Ban/);
  assert.match(detail, /label: 'Повернути інцидент', icon: Undo2/);
  assert.match(bar, /label: `Скасувати \(\$\{count\}\)`/);
});

test('the difference between the two is stated where the choice is made', async () => {
  const [bar, detail, settings] = await Promise.all([
    read('../src/components/ui/TaskManagement/BulkActionBar.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/(app)/settings/page.js'),
  ]);
  // The incident page states both to whoever opened it, and it is opened by
  // support and by the external client, so the sentences live in the shared
  // vocabulary and the page picks the reader's.
  assert.match(detail, /title=\{terms\.archivedTitle\}/);
  assert.match(detail, /title=\{terms\.cancelledTitle\}/);
  // Archiving preserves the customer record and says exactly what survives.
  assert.match(INCIDENT_TERMS.staff.archivedText, /Історія звернення, чат і файли/);
  assert.match(INCIDENT_TERMS.client.archivedText, /Листування та файли/);
  assert.match(bar, /історія, чат і файли залишаться/);
  // Cancelling stays distinct from resolving and says where the record goes.
  assert.match(INCIDENT_TERMS.staff.cancelledText, /не рахується як вирішений/);
  assert.match(INCIDENT_TERMS.client.cancelledText, /не вважається вирішеним/);
  assert.match(bar, /не рахуватимуться як вирішені/);
  // The confirmation before cancelling is staff-only and still names the list.
  assert.match(detail, /«Архіві» → «Скасовані»/);
  // And the archive screen says which list means which.
  assert.match(settings, /Архівовані інциденти зникають з активної черги, але зберігають історію та показники/);
  assert.match(settings, /Скасовані не рахуються як робота/);
});

test('the cancelled state is written by the server, never by the browser', async () => {
  const [rules, route] = await Promise.all([
    read('../firestore.rules'),
    read('../src/app/api/issues/[issueId]/cancel/route.js'),
  ]);
  assert.match(rules, /'cancelledAt',\s*\n\s*'cancelledBy'/);
  assert.match(route, /rolesFor\('edit:issue'\)/);
  assert.match(route, /projectWriteError\(/);
  assert.match(route, /action: cancelled \? 'cancelled' : 'uncancelled'/);
  // Asking for the state a task is already in is a retry, not an error.
  assert.match(route, /if \(Boolean\(current\.cancelledAt\) === cancelled\)/);
});

test('work already fixed into an invoice cannot be cancelled out of the record', async () => {
  const route = await read('../src/app/api/issues/[issueId]/cancel/route.js');
  // The same two guards deletion has. Cancelling billed work would leave the
  // invoice standing and quietly stop counting the hours behind it, so the two
  // would disagree with nothing on screen having changed.
  assert.match(route, /ISSUE_HAS_INVOICE_ESTIMATE/);
  assert.match(route, /ISSUE_HAS_BILLED_TIME/);
  assert.match(route, /ownLogs\.filter\(isBilledTimeLog\)/);
  // Both name the way out, which is the other action.
  assert.match(route, /Його можна архівувати, але не скасувати/);
  // Un-cancelling is never blocked by them: taking a task back into the record
  // cannot make an invoice wrong.
  assert.match(route, /if \(cancelled\) \{\s*\n\s*if \(estimateReservationSnap\.exists\)/);
});

test('a cancelled task leaves every set the numbers are built from', async () => {
  const [issues, analytics, myTasks, home, candidates, search] = await Promise.all([
    read('../src/lib/hooks/useIssues.js'),
    read('../src/lib/hooks/useWorkspaceAnalytics.js'),
    read('../src/lib/hooks/useAllMyTasks.js'),
    read('../src/lib/hooks/useOrganizationIssues.js'),
    read('../src/lib/utils/reminderCandidates.mjs'),
    read('../src/app/api/search/route.js'),
  ]);
  // Filtered at every source, so that no reader downstream — a board, a chart,
  // an invoice — has to know that cancelling exists.
  assert.match(issues, /withoutCancelledIssues\(withoutArchivedIssues\(own\)\)/);
  // «Мої завдання» filters the shared working set, which has already had them
  // removed — there is one place cancelling is subtracted, not four.
  assert.match(myTasks, /issues: workspaceIssues,/);
  assert.match(home, /withoutCancelledIssues\(/);
  assert.match(candidates, /isCancelledIssue\(issue\)/);
  assert.match(search, /!isCancelledIssue\(item\.data\(\)\)/);
  // Including the record: `allIssues` is what the timesheet and the invoice
  // read, and cancelled work is not part of what happened either.
  assert.match(home, /const allIssues = useMemo\(\(\) => withoutCancelledIssues\(documents\)/);
  assert.match(home, /const issues = useMemo\(\(\) => withoutArchivedIssues\(allIssues\)/);
  assert.match(analytics, /allIssues: record,/);
});

test('the hours follow the task out, and calendar time stays put', async () => {
  const analytics = await read('../src/lib/hooks/useWorkspaceAnalytics.js');
  // Time logs arrive on their own subscription and the timesheet reads them
  // straight, without joining back to the issue list. Filtering the issues
  // alone would leave a cancelled task's hours in every total while the task
  // itself had left every chart above them.
  assert.match(analytics, /timeLogs\.filter\(log => !log\?\.issueId \|\| !cancelledIssueIds\.has\(log\.issueId\)\)/);
  assert.match(analytics, /timeLogs: recordTimeLogs/);
  // A calendar entry has no `issueId` and belongs to nobody's task, so the
  // filter has to let it through rather than drop everything unmatched.
  assert.match(analytics, /!log\?\.issueId \|\|/);
});

test('«Скасувати» does not have to argue with the button that dismisses it', async () => {
  const [detail, bar] = await Promise.all([
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/ui/TaskManagement/BulkActionBar.jsx'),
  ]);
  // Every confirm dialog dismisses with «Скасувати». On this one that is also
  // the name of the action, so the two buttons read the same and one of them
  // has to give the word up.
  for (const source of [detail, bar]) {
    assert.match(source, /confirmText: 'Так, скасувати'/);
    assert.match(source, /cancelText: 'Ні, лишити'/);
  }
});

test('«Архів» lists the cancelled ones and hands them back', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  assert.match(settings, /\{ id: 'cancelled', label: 'Скасовані', count: cancelledIssueList\.length \}/);
  assert.match(settings, /setIssueCancelled\(issue\.id, false\)/);
  // The stream starts when the section is open and not before — the archive
  // shares the workspace's read budget with everything else. It is no longer
  // scoped to a tab: the strip carries a count per tab, and a list that waits
  // to be stood on cannot be counted.
  assert.match(settings, /archiveSectionOpen \? \(projects \|\| \[\]\)\.map\(project => project\.id\) : \[\]/);
  // Both task lists are the same row, so they cannot drift apart.
  assert.match(settings, /function ArchiveIssueRows\(/);
});
