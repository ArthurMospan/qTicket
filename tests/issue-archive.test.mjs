import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  archivedIssuesOf,
  isArchivedIssue,
  withoutArchivedIssues,
} from '../src/lib/utils/issueArchive.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('an archived task is the one carrying archivedAt', () => {
  assert.equal(isArchivedIssue({ archivedAt: new Date() }), true);
  assert.equal(isArchivedIssue({ archivedAt: null }), false);
  assert.equal(isArchivedIssue({}), false);
  assert.equal(isArchivedIssue(null), false);

  const issues = [{ id: 'a' }, { id: 'b', archivedAt: new Date() }];
  assert.deepEqual(withoutArchivedIssues(issues).map(i => i.id), ['a']);
  assert.deepEqual(archivedIssuesOf(issues).map(i => i.id), ['b']);
});

test('archiving and deleting are two actions, not one wearing two names', async () => {
  const [registry, bar, route] = await Promise.all([
    read('../src/lib/bulk/issueBulkActions.mjs'),
    read('../src/components/ui/TaskManagement/BulkActionBar.jsx'),
    read('../src/app/api/issues/bulk/route.js'),
  ]);
  // The archive action must not be routed into the deletion endpoint again.
  assert.match(route, /actionId === 'archive'[\s\S]{0,400}\/archive/);
  assert.match(route, /actionId === 'delete'[\s\S]{0,400}'DELETE'/);
  assert.match(registry, /id: 'archive'[^}]*permission: 'edit:issue'/);
  assert.match(registry, /id: 'delete'[^}]*permission: 'delete:issue'/);
  // The confirmations have to say which of the three is about to happen, and
  // the difference that matters is what happens to the numbers.
  assert.match(bar, /У звітах, таймшиті та рахунках вони лишаються/);
  assert.match(bar, /з усього обліку/);
  assert.match(bar, /«Нещодавно видалене»/);
});

test('the archive state is written by the server, never by the browser', async () => {
  const [rules, route] = await Promise.all([
    read('../firestore.rules'),
    read('../src/app/api/issues/[issueId]/archive/route.js'),
  ]);
  assert.match(rules, /'archivedAt',\s*\n\s*'archivedBy'/);
  // Whoever may edit in the project may archive there — read from the matrix,
  // not spelled out again — and the scope is re-checked against the project
  // document the transaction itself read.
  assert.match(route, /rolesFor\('edit:issue'\)/);
  assert.match(route, /projectWriteError\(/);
  assert.match(route, /action: archived \? 'archived' : 'unarchived'/);
});

test('archived tasks leave the working lists but keep their own link', async () => {
  const [issues, analytics, myTasks, detail, home] = await Promise.all([
    read('../src/lib/hooks/useIssues.js'),
    read('../src/lib/hooks/useWorkspaceAnalytics.js'),
    read('../src/lib/hooks/useAllMyTasks.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/lib/hooks/useOrganizationIssues.js'),
  ]);
  // The rule is applied once, where the tasks are read — every screen shares
  // one subscription now, so «архівне не в роботі» is one filter rather than
  // four copies of it that could drift.
  assert.match(home, /const allIssues = useMemo\(\(\) => withoutCancelledIssues\(documents\)/);
  assert.match(home, /const issues = useMemo\(\(\) => withoutArchivedIssues\(allIssues\)/);
  // The board takes the working set for its own project…
  assert.match(issues, /withoutCancelledIssues\(withoutArchivedIssues\(own\)\)/);
  // …and «Мої завдання» takes the same working set and filters it by assignee,
  // so a task somebody archived leaves that list too.
  assert.match(myTasks, /issues: workspaceIssues,/);
  assert.match(myTasks, /workspaceIssues\s*\n\s*\.filter\(issue => issue\.assigneeIds\?\.includes\(userId\)\)/);
  // The detail is the one reader that asks for them, so «Архів» can open a
  // task and put it back instead of showing "not found".
  assert.match(detail, /useIssues\(projectId, \{ includeLinks: false, includeSetAside: true \}\)/);
  // …but its own pickers must not offer one as a parent or a link target.
  assert.match(detail, /const openIssues = withoutCancelledIssues\(withoutArchivedIssues\(issues\)\)/);
  assert.match(detail, /const parentCandidates = openIssues\.filter/);
  assert.match(detail, /const availableLinkIssues = openIssues\.filter/);

  // One subscription, three readings: the working set for what is open, the
  // record for what was done, and the cancelled ones for the one screen that
  // lists them. The analytics hook names all three rather than deriving its own.
  assert.match(analytics, /allIssues: record,\s*\n\s*cancelledIssues,/);
  assert.match(analytics, /allIssues: record,\s*\n\s*cancelledIssues,\s*\n\s*timeLogs: recordTimeLogs,/);
});

test('an archived task keeps its hours in the timesheet and on the invoice', async () => {
  const [page, timesheet, workload] = await Promise.all([
    read('../src/app/(app)/analytics/page.js'),
    read('../src/components/workspace/TimesheetTab.jsx'),
    read('../src/components/workspace/WorkloadTab.jsx'),
  ]);
  // Money first: an hour recorded against a task somebody later archived is
  // still an hour that was worked, and dropping it would bill less than was done.
  assert.match(page, /const billingIssues = allIssues\.filter/);
  // The timesheet has to be able to name the task an old entry belongs to.
  assert.match(page, /const projectScopedIssueReferences = useMemo/);
  assert.match(page, /<TimesheetTab\s+issues=\{projectScopedIssueReferences\}/);
  assert.match(page, /logIssues=\{projectScopedIssueReferences\}/);
  // …while new time is still booked only against tasks that are in use.
  assert.match(timesheet, /const projectIssues = useMemo\(\s*[\s\S]{0,80}withoutArchivedIssues\(issues\)/);
  // «Остання активність» reads the project-wide list, so a person's last touch
  // on an archived task still counts as activity.
  assert.match(workload, /logIssues = scopedIssues,/);
  assert.match(workload, /referenceIssues: logIssues,/);
});

test('nothing chases people about a task that was put aside', async () => {
  const [candidates, jobs, search] = await Promise.all([
    read('../src/lib/utils/reminderCandidates.mjs'),
    read('../src/lib/server/reminderJobs.js'),
    read('../src/app/api/search/route.js'),
  ]);
  assert.match(candidates, /if \(isArchivedIssue\(issue\) \|\| isCancelledIssue\(issue\)\) continue;/);
  // The projection has to carry both fields, or a task that was put aside reads
  // as active here and people go on being chased about it.
  assert.match(jobs, /'archivedAt',\s*\n\s*'cancelledAt',/);
  assert.match(search, /!isArchivedIssue\(item\.data\(\)\) && !isCancelledIssue\(item\.data\(\)\)/);
  assert.match(search, /'dueDate', 'archivedAt', 'cancelledAt'/);
});

test('the trash list never hands a tombstone snapshot to the browser', async () => {
  const route = await read('../src/app/api/issues/trash/route.js');
  assert.match(route, /canRestoreIssueTombstone\(tombstone\)/);
  assert.match(route, /hasProjectAccess\(projectById\.get\(tombstone\.projectId\), role, uid\)/);
  // The response is built field by field; the stored `issue` record itself,
  // which holds the whole task, must not be spread into it.
  assert.doesNotMatch(route, /\.\.\.tombstone\.issue/);
  assert.doesNotMatch(route, /issue: tombstone\.issue/);
});

test('«Кошик» is gone from what a person reads', async () => {
  const [help, settings, restore] = await Promise.all([
    read('../src/lib/content/helpArticles.mjs'),
    read('../src/app/(app)/settings/page.js'),
    read('../src/app/api/issues/[issueId]/restore/route.js'),
  ]);
  for (const [name, source] of [['help', help], ['settings', settings], ['restore', restore]]) {
    assert.doesNotMatch(source, /кошик/i, `${name} still says "кошик"`);
  }
  assert.match(settings, /Нещодавно видалене/);
});
