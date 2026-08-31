import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { userFacingErrorMessage } from '../src/lib/utils/errors.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('task composer resets discarded drafts and owns its one inline failure', async () => {
  const modal = await read('src/components/CreateTaskModal.jsx');
  assert.match(modal, /const closeAndReset = \(\) => \{[\s\S]*?resetDraft\(\);[\s\S]*?onClose\(\);/);
  assert.match(modal, /onClose=\{closeAndReset\}/);
  assert.match(modal, /<form[\s\S]{0,180}noValidate/);

  const board = await read('src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  const handler = board.slice(
    board.indexOf('const handleCreateIssue'),
    board.indexOf('const handleMoveIssue'),
  );
  assert.doesNotMatch(handler, /showToast\([^\n]*Помилка/);
});

test('stable API codes map to human task-form messages', () => {
  assert.equal(
    userFacingErrorMessage({ code: 'INVALID_PROJECT_SCOPE', message: 'internal' }, 'fallback'),
    'Обраний проєкт недоступний у цій організації',
  );
  assert.equal(userFacingErrorMessage({ message: '  Детальна помилка  ' }, 'fallback'), 'Детальна помилка');
});

test('the comment composer locks synchronously against a same-tick double submit', async () => {
  const timeline = await read('src/components/workspace/UnifiedTimeline.jsx');
  assert.match(timeline, /sendingRef\.current/);
  assert.match(timeline, /sendingRef\.current = true/);
  assert.match(timeline, /sendingRef\.current = false/);
});

test('invalid issue bodies do not consume the 60-per-minute creation limit', async () => {
  const route = await read('src/app/api/issues/route.js');
  const titleValidation = route.indexOf("typeof data.title !== 'string'");
  const dueDateValidation = route.indexOf("'Некоректний дедлайн'");
  const limiter = route.indexOf("enforceRateLimit('issue-create'");
  assert.ok(titleValidation >= 0 && dueDateValidation > titleValidation);
  assert.ok(limiter > dueDateValidation);
  assert.match(route, /enforceRateLimit\('issue-create', authorization\.user\.uid, 60, 60\)/);
});

test('authenticated workspace mounts one toast host', async () => {
  const layout = await read('src/app/(app)/layout.js');
  assert.equal(layout.match(/<WorkspaceToastHost\s*\/>/g)?.length, 1);
});
