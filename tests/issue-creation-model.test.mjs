import test from 'node:test';
import assert from 'node:assert/strict';

import {
  creatableIssueTypeIds,
  resolveNewIssueType,
} from '../src/lib/utils/issueCreationModel.mjs';

test('legacy Epic remains readable in configuration but is never creatable', () => {
  assert.deepEqual(
    creatableIssueTypeIds(['epic', 'feature', 'task', 'bug']),
    ['feature', 'task', 'bug'],
  );
  assert.deepEqual(resolveNewIssueType(
    'epic',
    ['epic', 'feature', 'task', 'bug'],
  ), {
    type: null,
    error: {
      code: 'LEGACY_EPIC_TYPE',
      status: 400,
      message: 'Епік є лише legacy-типом і недоступний для нових завдань',
    },
  });
});

test('new issues use a configured request or a non-Epic fallback', () => {
  assert.deepEqual(resolveNewIssueType('bug', ['epic', 'feature', 'task', 'bug']), {
    type: 'bug',
    error: null,
  });
  assert.deepEqual(resolveNewIssueType(undefined, ['epic', 'feature', 'task']), {
    type: 'task',
    error: null,
  });
  assert.deepEqual(resolveNewIssueType('bug', ['epic', 'feature', 'task']), {
    type: 'task',
    error: null,
  });
  assert.equal(resolveNewIssueType(undefined, ['epic']).error.code, 'NO_CREATABLE_ISSUE_TYPE');
});
