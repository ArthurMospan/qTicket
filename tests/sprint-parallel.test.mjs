import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('nothing limits how many sprints run at once', async () => {
  const hook = await read('../src/lib/hooks/useSprints.js');
  // The guard that refused to start a second sprint is gone, and no new one
  // took its place: two teams may each run their own, or one project may have
  // its own while another has none.
  assert.doesNotMatch(hook, /Спочатку завершіть активний спринт/);
  assert.doesNotMatch(hook, /conflictingActiveSprint/);
  assert.match(hook, /const startSprint = useCallback\(async sprintId => \{\s*\n\s*const batch = writeBatch\(db\);/);
});

test('a sprint belongs to the organization and holds tasks from any project', async () => {
  const [hook, issuesRoute, bulkRoute, detail, board] = await Promise.all([
    read('../src/lib/hooks/useSprints.js'),
    read('../src/app/api/issues/route.js'),
    read('../src/app/api/issues/bulk/route.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
  ]);
  // No project field on the document, and no scope check anywhere: a sprint is
  // a named set of tasks, and which projects those come from is not the
  // product's business.
  assert.doesNotMatch(hook, /projectIds/);
  assert.match(hook, /organizationId: activeOrgId,/);
  for (const [name, source] of [
    ['issues route', issuesRoute],
    ['bulk route', bulkRoute],
    ['issue detail', detail],
    ['project board', board],
  ]) {
    assert.doesNotMatch(source, /sprintScope|sprintCoversProject|sprintsForProject/, `${name} still scopes sprints`);
  }
  // Every non-completed sprint stays offered, wherever the task lives.
  assert.match(board, /\.\.\.sprints\.map\(s => \(\{ value: s\.id, label: s\.name \}\)\)/);
});
