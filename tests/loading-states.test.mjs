import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// "Nothing was asked" is not "nothing was found".
//
// Every data hook here had the same shape: when the organization, the uid or
// the project list had not arrived yet it cleared its state and reported
// `loading: false`. On a page refresh those arrive a beat after the first
// render, so for that beat the screens read the empty result as an answer —
// «Задачу не знайдено» on the task page, «Подію не знайдено» on the calendar,
// «Немає доступу до організації» on a notification link. Frightening, and
// false. While the context is still resolving, the honest answer is a spinner.
test('a hook that has not subscribed yet reports loading, not emptiness', async () => {
  const cases = [
    ['../src/lib/hooks/useIssues.js', /issuesLoading \|\| authLoading \|\| orgLoading \|\| projectsLoading \|\| !currentUserId/],
    ['../src/lib/hooks/useCalendarEvents.js', /setLoading\(Boolean\(authLoading \|\| orgLoading\)\);/],
    // Two subscriptions, two flags: the shared task set and the windowed time
    // logs move on different clocks, and `loading` is their union.
    ['../src/lib/hooks/useWorkspaceAnalytics.js', /setTimeLogsLoading\(!activeOrgId && Boolean\(authLoading \|\| orgLoading\)\);/],
    ['../src/lib/hooks/useAllMyTasks.js', /const loading = issuesLoading \|\| Boolean\(authLoading \|\| orgLoading \|\| projectsLoading\);/],
  ];
  for (const [file, pattern] of cases) {
    const source = await read(file);
    assert.match(source, pattern, file);
    // And the flags are read from the context rather than assumed.
    assert.match(source, /authLoading/, file);
    assert.match(source, /orgLoading/, file);
  }
});

test('useIssues only finishes empty when there is genuinely no project', async () => {
  const source = await read('../src/lib/hooks/useIssues.js');
  assert.match(source, /const loading = Boolean\(projectId\) && \(/);
});

// And the subscription every one of them now reads through says the same
// thing: a listener that has not answered yet is loading, and an empty answer
// out of the local cache is not an answer at all.
test('the shared task subscription reports loading until something answers', async () => {
  const source = await read('../src/lib/hooks/useOrganizationIssues.js');
  assert.match(source, /loading: delivered\.size < chunks\.length,/);
  assert.match(
    source,
    /documentSnapshot\.empty\s*\n\s*&& documentSnapshot\.metadata\.fromCache\) return;/,
  );
  // A screen with no scope at all — no organization, no projects — has
  // genuinely finished with nothing, and must not spin forever.
  assert.match(source, /const RESOLVED_EMPTY_SNAPSHOT = Object\.freeze\(\{/);
});

test('an unloaded membership list is not treated as a denied organization', async () => {
  const guard = await read('../src/components/WorkspaceOrganizationRouteGuard.jsx');
  assert.match(guard, /if \(orgLoading \|\| !orgDirectoryVerified\) return <LoadingScreen \/>;/);
  // The denial still exists — it just cannot be reached before the answer is in.
  const denial = '<h1 className="ui-type-section-title text-ink mb-2">Немає доступу до організації</h1>';
  assert.ok(guard.includes(denial));
  assert.ok(
    guard.indexOf('if (orgLoading || !orgDirectoryVerified)') < guard.indexOf(denial),
    'the loading guard must come before the denial',
  );
});

test('the member page waits for the member list before saying "not found"', async () => {
  const page = await read('../src/app/(app)/analytics/team/[memberId]/page.js');
  assert.match(page, /loading: membersLoading/);
  assert.match(page, /if \(!urlReady \|\| loading \|\| calendarLoading \|\| membersLoading\)/);
});

test('projects from the previous organization are cleared before a new scope subscribes', async () => {
  const source = await read('../src/lib/hooks/useProjects.js');
  assert.match(
    source,
    /queueMicrotask\(\(\) => \{\s*setProjects\(\[\]\);\s*setError\(null\);\s*setLoadedOrganizationId\(null\);\s*setLoading\(true\);\s*\}\);/,
  );
  assert.match(source, /loadedOrganizationId === activeOrgId/);
  assert.match(source, /projects: scopeMatches \? projects : \[\]/);
});

test('an already restored account never paints the login form while redirecting', async () => {
  const source = await read('../src/app/login/page.js');
  assert.match(source, /if \(authLoading \|\| currentUser\) \{/);
  assert.ok(
    source.indexOf('if (authLoading || currentUser)') < source.indexOf('<AuthLayout hideCreateOrg={true}>'),
  );
});
