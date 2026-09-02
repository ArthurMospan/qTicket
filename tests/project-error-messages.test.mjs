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
    assert.match(source, /userFacingErrorMessage\(.*'Не вдалося повернути проєкт з архіву'/);
    assert.doesNotMatch(source, /showToast\('Помилка розархівування'/);
  }
  assert.match(project, /userFacingErrorMessage\(.*'Не вдалося відновити проєкт'/);
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

// «Додати до проєкту» from a profile sends a team and nothing else, and was
// answered with «Некоректна назва або опис клієнта» — a refusal about a field
// it never mentioned.
test('a project save touches only the fields it names', async () => {
  const [route, profile] = await Promise.all([
    read('../src/app/api/projects/[projectId]/route.js'),
    read('../src/components/profile/ProfileView.jsx'),
  ]);

  // Present-or-absent, like `team` already was. Without this the same save
  // would not merely have been refused — it would have written `name: ''`,
  // `description: ''` and `hiddenColumns: []` over a live project, which is the
  // worse of the two bugs the 400 was hiding.
  assert.match(route, /const editsName = Object\.prototype\.hasOwnProperty\.call\(body, 'name'\)/);
  assert.match(route, /const editsDescription = Object\.prototype\.hasOwnProperty\.call\(body, 'description'\)/);
  assert.match(route, /const editsHidden = Object\.prototype\.hasOwnProperty\.call\(body, 'hiddenColumns'\)/);
  assert.match(route, /if \(editsName && \(!name \|\| name\.length > 160\)\)/);
  assert.match(route, /if \(editsDescription && description\.length > 10_000\)/);
  assert.match(route, /\.\.\.\(editsName \? \{ name \} : \{\}\)/);
  assert.match(route, /\.\.\.\(editsDescription \? \{ description \} : \{\}\)/);
  assert.match(route, /\.\.\.\(editsHidden \? \{ hiddenColumns: hiddenToApply \} : \{\}\)/);
  // Two facts, reported as two: a description ten thousand characters long used
  // to be announced as a bad name.
  assert.doesNotMatch(route, /Некоректна назва або опис клієнта/);

  // And the caller that found this still sends only what it means.
  assert.match(profile, /await updateProjectSettings\(project\.id, \{\s*team: \[\.\.\.new Set\(\[\.\.\.team, uid\]\)\],\s*teamBaseline: team,/);
});
