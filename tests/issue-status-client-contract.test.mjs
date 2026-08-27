import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('all interactive status moves use the authenticated status API', async () => {
  const [service, projectIssues, myTasks] = await Promise.all([
    read('../src/lib/services/issues.js'),
    read('../src/lib/hooks/useIssues.js'),
    read('../src/lib/hooks/useAllMyTasks.js'),
  ]);

  assert.match(service, /export async function transitionIssueStatusViaApi/);
  assert.match(service, /\/api\/issues\/\$\{encodeURIComponent\(issueId\)\}\/status/);
  assert.match(projectIssues, /await transitionIssueStatusViaApi\(\{/);
  assert.match(myTasks, /await transitionIssueStatusViaApi\(\{/);
  assert.doesNotMatch(projectIssues, /\bwriteBatch\b|\bdeleteField\b/);
  assert.doesNotMatch(myTasks, /\bdeleteField\b/);
});

// A card's `order` is its position inside one project's column. Every writer
// has to mean the same thing by it, or a drop lands wherever the other writer's
// numbers happen to fall.
test('every board writes a position it planned, never a raw index', async () => {
  const [projectIssues, myTasks, detail, board] = await Promise.all([
    read('../src/lib/hooks/useIssues.js'),
    read('../src/lib/hooks/useAllMyTasks.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/workspace/AgileBoard.jsx'),
  ]);

  // Project boards persist canonical project-column order.
  assert.match(projectIssues, /planDrop\(/);
  assert.match(projectIssues, /orderUpdates/);
  // «Мої завдання» persists a private cross-project order; a real status
  // transition additionally plans a canonical position inside that project.
  assert.match(myTasks, /planMyTaskDrop\(\{/);
  assert.match(myTasks, /if \(statusChanged\) \{[\s\S]{0,500}planDrop\(/);
  assert.match(myTasks, /\{ scopeToProject: true \}/);
  assert.match(myTasks, /if \(statusPlan\) \{[\s\S]{0,500}orderUpdates/);
  // The board hands over the column the user saw, not an index into rows it
  // resolved with a sort rule of its own.
  assert.match(board, /\{ visibleColumnIds, visibleIndex: destination\.index \}/);
  // A status changed off the board states its slot; it used to pass the card's
  // own `order` value where an insert index was expected.
  assert.match(detail, /moveIssue\(issueId, s, \{ index: 0 \}, actor\)/);
  assert.doesNotMatch(detail, /moveIssue\([^)]*issue\.order/);
});

test('a task nobody has positioned yet sorts above the ones somebody has', async () => {
  // One sign, every writer. `+next` buried Telegram and imported tasks at the
  // bottom of the column and a fixed 0 collided with the first planned slot.
  for (const path of [
    '../src/app/api/issues/route.js',
    '../src/lib/server/telegram.js',
    '../src/lib/server/youtrackImporter.js',
  ]) {
    const source = await read(path);
    assert.match(source, /order: -next,/, path);
    assert.doesNotMatch(source, /order: next,/, path);
  }
  const external = await read('../src/app/api/v1/tasks/route.js');
  assert.match(external, /const next = Number\(project\.issueCounter \|\| 0\) \+ 1/);
  assert.match(external, /order: -next/);
});

test('browser Firestore writes cannot bypass execution fields', async () => {
  const rules = await read('../firestore.rules');
  const issueBlock = rules.slice(
    rules.indexOf('match /issues/{issueId}'),
    rules.indexOf('match /issueLinks/{id}'),
  );

  for (const field of ['status', 'columnId', 'completedAt', 'order']) {
    assert.match(issueBlock, new RegExp(`'${field}'`));
  }
});
