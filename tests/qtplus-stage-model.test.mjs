import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stageProgress, stageStatusMeta, canAccessStage, defaultStageId,
} from '../src/lib/portal/qtplusStageModel.mjs';

const S = (id, status) => ({ id, status, label: id, order: 0 });

test('stageProgress', () => {
  assert.deepEqual(stageProgress([S('a', 'done'), S('b', 'in-progress'), S('c', 'todo')]), { done: 1, total: 3, percent: 33 });
  assert.deepEqual(stageProgress([]), { done: 0, total: 0, percent: 0 });
  assert.deepEqual(stageProgress(null), { done: 0, total: 0, percent: 0 });
});

test('stageStatusMeta', () => {
  assert.deepEqual(stageStatusMeta('todo'), { label: 'Заплановано', tone: 'muted' });
  assert.deepEqual(stageStatusMeta('in-progress'), { label: 'В роботі', tone: 'active' });
  assert.deepEqual(stageStatusMeta('done'), { label: 'Завершено', tone: 'done' });
  assert.deepEqual(stageStatusMeta('дичина'), { label: '—', tone: 'muted' });
});

test('canAccessStage: паритет із порталом — todo заблоковано', () => {
  // qt/src/components/StageNav.jsx: canAccess = status === 'done' || 'in-progress'
  assert.equal(canAccessStage(S('a', 'done')), true);
  assert.equal(canAccessStage(S('a', 'in-progress')), true);
  assert.equal(canAccessStage(S('a', 'todo')), false);
  assert.equal(canAccessStage(null), false);
});

test('defaultStageId: перший in-progress виграє', () => {
  assert.equal(defaultStageId([S('a', 'done'), S('b', 'in-progress'), S('c', 'in-progress')]), 'b');
});

test('defaultStageId: лише done -> ОСТАННІЙ done', () => {
  assert.equal(defaultStageId([S('a', 'done'), S('b', 'done')]), 'b');
});

test('defaultStageId: усі todo -> null (роботу не розпочато)', () => {
  assert.equal(defaultStageId([S('a', 'todo'), S('b', 'todo')]), null);
});

test('defaultStageId: порожньо або сміття -> null', () => {
  assert.equal(defaultStageId([]), null);
  assert.equal(defaultStageId(null), null);
});
