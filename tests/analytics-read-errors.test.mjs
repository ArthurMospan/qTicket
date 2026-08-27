import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('analytics hooks publish read failures instead of converting them to zero', async () => {
  const [rollups, workspace, projectTime, projectAllTime] = await Promise.all([
    read('src/lib/hooks/useAnalyticsRollups.js'),
    read('src/lib/hooks/useWorkspaceAnalytics.js'),
    read('src/lib/hooks/useProjectTimeLogs.js'),
    read('src/lib/hooks/useProjectAllTimeLogs.js'),
  ]);

  assert.match(rollups, /Promise\.allSettled/);
  assert.match(rollups, /return \{ rollups, loading, refreshing, error, readAt, refresh \}/);
  assert.doesNotMatch(rollups, /return \{ docs: \[\] \}/);

  assert.match(workspace, /onError\?\.\(error\)/);
  assert.match(
    workspace,
    /error: issuesError \|\| issueLinksError \|\| \(windowedTimeLogs \? timeLogsError : null\)/,
  );

  for (const hook of [projectTime, projectAllTime]) {
    assert.match(hook, /setError\(error\)/);
    assert.match(hook, /error, refresh/);
  }
});

test('analytics screens explain a failed read and offer a retry', async () => {
  const [workspacePage, memberPage, projectAnalytics, billing] = await Promise.all([
    read('src/app/(app)/analytics/page.js'),
    read('src/app/(app)/analytics/team/[memberId]/page.js'),
    read('src/components/workspace/AnalyticsTab.jsx'),
    read('src/components/workspace/BillingTab.jsx'),
  ]);

  assert.match(workspacePage, /Не вдалося завантажити аналітику/);
  assert.match(memberPage, /Не вдалося завантажити аналітику учасника/);
  assert.match(projectAnalytics, /Не вдалося завантажити час проєкту/);
  assert.match(billing, /Рахунок не формуємо з неповних даних/);
});
