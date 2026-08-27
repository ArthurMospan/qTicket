import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { userFacingErrorMessage } from '../src/lib/utils/errors.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('API failures prefer the server message and retain a non-empty fallback', () => {
  assert.equal(
    userFacingErrorMessage(new Error('Ліміт активних проєктів вичерпано'), 'Fallback'),
    'Ліміт активних проєктів вичерпано',
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

  for (const source of [workspace, settings, project]) {
    assert.match(source, /userFacingErrorMessage\(.*'Не вдалося розархівувати проєкт'/);
    assert.doesNotMatch(source, /showToast\('Помилка розархівування'/);
  }
  assert.match(project, /const handleRestoreProject[\s\S]{0,500}catch \(error\)/);
  assert.match(modal, /await onUnarchive\(project\.id\) !== false/);
  assert.match(modal, /await onArchive\(project\.id\) !== false/);
});

// «Перейдіть на Pro план» named the most expensive way out and the only one
// this file knew about, while the product has offered Lite since sign-up. Then
// both routes carried the replacement sentence in full, which is the same
// mistake one level up: two copies of one refusal, in two files, either of
// which could be edited without the other. Neither writes it any more — the
// registry does, and both routes ask it.
test('both routes that refuse a project ask the registry for the sentence', async () => {
  // Without comments: what was taken out of these files is described in prose
  // right beside where it used to be, and a description of deleted code is not
  // code.
  const withoutComments = source => source
    .split(/\r?\n/)
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');
  const unarchive = withoutComments(await read('../src/app/api/projects/[projectId]/route.js'));
  const create = withoutComments(await read('../src/app/api/projects/route.js'));

  for (const route of [unarchive, create]) {
    assert.match(route, /planLimitRefusal\([^)]*'projects'/);
    assert.match(route, /planLimit\([^)]*'projects'\)/);
    assert.doesNotMatch(route, /Перейдіть на Pro план/);
    // The sentence itself lives in exactly one place, and it is not here.
    assert.doesNotMatch(route, /Ліміт активних проєктів вичерпано/);
    // And the ceiling is the registry's too. Restoring an archived project was
    // still refusing at a hardcoded three for anything that was not Pro —
    // the same bug the create route had been fixed for, still alive in the
    // other half of the same pair.
    assert.doesNotMatch(route, /!== 'pro'/);
    assert.doesNotMatch(route, /size >= 3/);
    // The body names the ceiling, so the screen can open the price list on it
    // instead of looking for the word «Pro» in a Ukrainian sentence.
    assert.match(route, /planLimit: \{ id: 'projects'/);
  }
});

test('settings API actions no longer replace server errors with generic toasts', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  for (const fallback of [
    'Не вдалося згенерувати API ключ',
    'Не вдалося видалити API ключ',
    'Не вдалося змінити роль',
    'Не вдалося змінити посаду',
    'Не вдалося передати права власника',
    'Не вдалося забрати доступ',
    'Не вдалося повернути доступ',
    'Не вдалося вийти з організації',
  ]) {
    assert.match(settings, new RegExp(`userFacingErrorMessage\\([^)]*'${fallback}'`));
  }
});
