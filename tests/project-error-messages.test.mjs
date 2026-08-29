import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { userFacingErrorMessage } from '../src/lib/utils/errors.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('API failures prefer the server message and retain a non-empty fallback', () => {
  assert.equal(
    userFacingErrorMessage(new Error('Не вдалося створити клієнта'), 'Fallback'),
    'Не вдалося створити клієнта',
  );
  assert.equal(userFacingErrorMessage(new Error('   '), 'Не вдалося'), 'Не вдалося');
  assert.equal(userFacingErrorMessage(null, 'Не вдалося'), 'Не вдалося');
});

test('every project restore surface shows the actionable API error', async () => {
  const [workspace, settings, project, modal] = await Promise.all([
    read('../src/app/(app)/page.js'),
    read('../src/app/(app)/settings/page.js'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/BoardConfigModal.jsx'),
  ]);

  for (const source of [workspace, settings]) {
    assert.match(source, /userFacingErrorMessage\(.*'Не вдалося повернути клієнта з архіву'/);
    assert.doesNotMatch(source, /showToast\('Помилка розархівування'/);
  }
  assert.match(project, /userFacingErrorMessage\(.*'Не вдалося відновити клієнтський простір'/);
  assert.doesNotMatch(project, /showToast\('Помилка розархівування'/);
  assert.match(project, /const handleRestoreProject[\s\S]{0,500}catch \(error\)/);
  assert.match(modal, /await onUnarchive\(project\.id\) !== false/);
  assert.match(modal, /await onArchive\(project\.id\) !== false/);
});

test('creating or restoring a client has no qTicket-local plan boundary', async () => {
  const [restore, create] = await Promise.all([
    read('../src/app/api/projects/[projectId]/route.js'),
    read('../src/app/api/projects/route.js'),
  ]);

  for (const route of [restore, create]) {
    assert.doesNotMatch(route, /planLimit|overPlanLimit|price list|тариф|прайс/i);
  }
});

test('settings API actions no longer replace server errors with generic toasts', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  for (const fallback of [
    'Не вдалося вийти з організації',
  ]) {
    assert.match(settings, new RegExp(`userFacingErrorMessage\\([^)]*'${fallback}'`));
  }
  // Internal seats are synchronized from QuickTeam, so qTicket has no local
  // role, position, ownership-transfer or access-removal action to toast about.
  for (const removedFallback of [
    'Не вдалося змінити роль',
    'Не вдалося змінити посаду',
    'Не вдалося передати права власника',
    'Не вдалося забрати доступ',
    'Не вдалося повернути доступ',
  ]) {
    assert.doesNotMatch(settings, new RegExp(removedFallback));
  }
});
