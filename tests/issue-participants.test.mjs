import assert from 'node:assert/strict';
import test from 'node:test';

import {
  issueDisplayParticipants,
  issueParticipants,
} from '../src/lib/utils/issueParticipants.mjs';

const issue = {
  reporterId: 'author',
  assigneeIds: ['dev'],
  watcherIds: ['watcher'],
};

test('the person who created the task is a participant', () => {
  // The gap that started this: a status change reached assignees and watchers,
  // so whoever opened the task never heard that it had moved.
  assert.ok(issueParticipants(issue, { actorId: 'dev' }).includes('author'));
});

test('the actor never notifies themselves', () => {
  assert.deepEqual(issueParticipants(issue, { actorId: 'dev' }).sort(), ['author', 'watcher']);
  assert.deepEqual(issueParticipants(issue, { actorId: 'author' }).sort(), ['dev', 'watcher']);
});

test('commenting joins you to the conversation', () => {
  const result = issueParticipants(issue, { actorId: 'author', commentAuthorIds: ['outsider', 'dev'] });
  assert.ok(result.includes('outsider'));
  assert.equal(result.filter(uid => uid === 'dev').length, 1, 'no duplicate for someone already assigned');
});

test('people reached another way are excluded', () => {
  // A mentioned person gets the mention, not a second vaguer notification.
  const result = issueParticipants(issue, { actorId: 'author', exclude: ['watcher'] });
  assert.deepEqual(result, ['dev']);
});

test('everyone appears at most once', () => {
  const noisy = {
    reporterId: 'same',
    assigneeIds: ['same', 'same'],
    watcherIds: ['same'],
  };
  assert.deepEqual(issueParticipants(noisy, { actorId: 'other', commentAuthorIds: ['same'] }), ['same']);
});

test('a task with nobody on it notifies nobody', () => {
  assert.deepEqual(issueParticipants({}, { actorId: 'dev' }), []);
  assert.deepEqual(issueParticipants({ reporterId: 'dev' }, { actorId: 'dev' }), []);
});

test('malformed records do not throw and contribute nothing', () => {
  for (const broken of [undefined, null, {}, { assigneeIds: null }, { assigneeIds: 'dev' }, { watcherIds: 7 }]) {
    assert.doesNotThrow(() => issueParticipants(broken, { actorId: 'a' }));
    assert.deepEqual(issueParticipants(broken, { actorId: 'a' }), []);
  }
});

test('empty and non-string ids are dropped rather than sent to', () => {
  const messy = { assigneeIds: ['', null, undefined, 0, 'real'], reporterId: '' };
  assert.deepEqual(issueParticipants(messy, { actorId: 'x' }), ['real']);
});

test('task cards show assignees, author and subscribers once with all of their roles', () => {
  assert.deepEqual(issueDisplayParticipants({
    assigneeIds: ['dev', 'both'],
    reporterId: 'author',
    watcherIds: ['watcher', 'both'],
  }), [
    { id: 'dev', roles: ['assignee'] },
    { id: 'both', roles: ['assignee', 'subscriber'] },
    { id: 'author', roles: ['author'] },
    { id: 'watcher', roles: ['subscriber'] },
  ]);
});
