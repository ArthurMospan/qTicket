import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPRINT_PICKER_RECENT_LIMIT,
  sprintCandidateIssues,
} from '../src/lib/utils/sprintPlanning.mjs';

const issue = (id, extra = {}) => ({
  id,
  issueKey: `QT-${id}`,
  title: `Задача ${id}`,
  status: 'todo',
  updatedAt: `2026-08-${String(id).padStart(2, '0')}T10:00:00Z`,
  ...extra,
});

test('the resting list is recent unplanned work, newest first', () => {
  const issues = [
    issue(1),
    issue(2),
    issue(3, { sprintId: 'sprint-b' }),
  ];

  const offered = sprintCandidateIssues(issues, { sprintId: 'sprint-a' });

  assert.deepEqual(offered.map(item => item.id), [2, 1]);
});

test('a task already in this sprint is never offered', () => {
  const issues = [issue(1, { sprintId: 'sprint-a' }), issue(2)];

  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a' }).map(item => item.id),
    [2],
  );
  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', query: 'Задача' }).map(item => item.id),
    [2],
  );
});

test('closed work stays out of the resting list but is still findable', () => {
  const issues = [issue(1, { status: 'done' }), issue(2)];
  const closedStatusIds = ['done'];

  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', closedStatusIds }).map(item => item.id),
    [2],
  );
  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', closedStatusIds, query: 'QT-1' })
      .map(item => item.id),
    [1],
  );
});

test('a query matches the number as well as the name', () => {
  const issues = [issue(11, { title: 'Полагодити експорт' }), issue(12, { title: 'Оновити довідку' })];

  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', query: '12' }).map(item => item.id),
    [12],
  );
  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', query: 'експорт' }).map(item => item.id),
    [11],
  );
  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', query: 'qt-11' }).map(item => item.id),
    [11],
  );
});

test('a query reaches work that already belongs to another sprint', () => {
  const issues = [issue(1, { sprintId: 'sprint-b' })];

  assert.deepEqual(sprintCandidateIssues(issues, { sprintId: 'sprint-a' }), []);
  assert.deepEqual(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a', query: 'QT-1' }).map(item => item.id),
    [1],
  );
});

test('what is already ticked stays on screen when the query changes', () => {
  const issues = [issue(1, { title: 'Експорт' }), issue(2, { title: 'Довідка' })];

  const offered = sprintCandidateIssues(issues, {
    sprintId: 'sprint-a',
    query: 'Довідка',
    pickedIds: [1],
  });

  assert.deepEqual(offered.map(item => item.id), [1, 2]);
});

test('the resting list stays short however long the backlog is', () => {
  const issues = Array.from({ length: 40 }, (_, index) => issue(index + 1));

  assert.equal(
    sprintCandidateIssues(issues, { sprintId: 'sprint-a' }).length,
    SPRINT_PICKER_RECENT_LIMIT,
  );
});
