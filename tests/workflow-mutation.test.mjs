import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWorkflowMutationInput,
  sameStringSet,
} from '../src/lib/utils/workflowMutation.mjs';

const systemPriorities = () => [
  { id: 'blocker', label: 'Критичний' },
  { id: 'high', label: 'Високий' },
  { id: 'medium', label: 'Середній' },
  { id: 'low', label: 'Низький' },
];

// Statuses carry their category explicitly, because that is what the normalizer
// writes back: the category decides whether a status closes a task, and `isDone`
// is derived from it so the two can never disagree in a saved document.
// tests/status-categories.test.mjs covers the derivation itself.
function workflow() {
  return {
    statuses: [
      { id: 'todo', label: 'До виконання', color: '#fff', category: 'todo', isDone: false },
      { id: 'done', label: 'Готово', color: '#000', category: 'done', isDone: true },
    ],
    types: [{ id: 'task', label: 'Задача', icon: 'task' }],
    priorities: systemPriorities(),
    labels: [],
    positions: [{ id: 'dev', label: 'Розробник', hourlyRate: 30 }],
  };
}

test('workflow mutation normalizes all sections and explicit status migrations', () => {
  assert.deepEqual(normalizeWorkflowMutationInput({
    workflow: workflow(),
    statusMigrations: [{
      fromStatusId: ' old ',
      toStatusId: 'todo',
    }],
  }), {
    value: {
      workflow: workflow(),
      statusMigrations: [{
        fromStatusId: 'old',
        toStatusId: 'todo',
      }],
    },
  });
});

test('workflow mutation rejects duplicate ids and malformed migration mappings', () => {
  const duplicate = workflow();
  duplicate.statuses.push({ id: 'todo', label: 'Ще один' });
  assert.equal(
    normalizeWorkflowMutationInput({ workflow: duplicate }).error.code,
    'DUPLICATE_WORKFLOW_ID',
  );
  assert.equal(normalizeWorkflowMutationInput({
    workflow: workflow(),
    statusMigrations: [
      { fromStatusId: 'old', toStatusId: 'todo' },
      { fromStatusId: 'old', toStatusId: 'done' },
    ],
  }).error.code, 'DUPLICATE_STATUS_MIGRATION');
});

test('workflow mutation keeps the four semantic priority anchors locked', () => {
  const missing = workflow();
  missing.priorities = missing.priorities.filter(priority => priority.id !== 'high');
  assert.equal(
    normalizeWorkflowMutationInput({ workflow: missing }).error.code,
    'MISSING_SYSTEM_PRIORITIES',
  );

  const movedOutside = workflow();
  movedOutside.priorities.push({ id: 'later', label: 'Пізніше' });
  assert.equal(
    normalizeWorkflowMutationInput({ workflow: movedOutside }).error.code,
    'MISSING_SYSTEM_PRIORITIES',
  );

  const custom = workflow();
  custom.priorities.splice(2, 0, { id: 'important', label: 'Важливий' });
  assert.equal(normalizeWorkflowMutationInput({ workflow: custom }).error, undefined);
});

test('workflow mutation keeps Task and derives every type icon from its stable id', () => {
  const missingTask = workflow();
  missingTask.types = [{ id: 'feature', label: 'Фіча' }];
  assert.equal(
    normalizeWorkflowMutationInput({ workflow: missingTask }).error.code,
    'MISSING_SYSTEM_TASK_TYPE',
  );

  const fixedIcons = workflow();
  fixedIcons.types = [
    { id: 'task', label: 'Задача', icon: 'rocket' },
    { id: 'feature', label: 'Фіча', icon: 'palette' },
    { id: 'customer-request', label: 'Запит клієнта', icon: 'bug' },
  ];
  const normalized = normalizeWorkflowMutationInput({ workflow: fixedIcons });
  assert.deepEqual(
    normalized.value.workflow.types.map(type => type.icon),
    ['task', 'sparkles', 'star'],
  );
});

test('string-set comparison ignores ordering but not membership', () => {
  assert.equal(sameStringSet(['todo', 'done'], ['done', 'todo']), true);
  assert.equal(sameStringSet(['todo'], ['todo', 'done']), false);
});
