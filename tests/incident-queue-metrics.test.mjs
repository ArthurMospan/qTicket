import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categorizeIssues,
  incidentQueueMetrics,
  isWaitingOnUs,
  waitingOnUsIssues,
} from '../src/lib/utils/incidentQueueMetrics.mjs';

// Two of ours and one customer, which is all the roster this question needs.
const SUPPORT = ['agent-1', 'agent-2'];

const statuses = [
  { id: 'new', category: 'todo' },
  { id: 'doing', category: 'in-progress' },
  { id: 'closed', category: 'done' },
];

const request = (id, fields = {}) => ({ id, columnId: 'doing', ...fields });

test('a request whose last word is the customer’s is waiting on us', () => {
  assert.equal(
    isWaitingOnUs(request('r1', { lastCommentAuthorId: 'customer-9' }), SUPPORT),
    true,
  );
});

test('a request support answered after the customer is not', () => {
  assert.equal(
    isWaitingOnUs(request('r2', { lastCommentAuthorId: 'agent-2' }), SUPPORT),
    false,
  );
});

test('a request nobody has written in is not waiting on an answer', () => {
  assert.equal(isWaitingOnUs(request('r3'), SUPPORT), false);
  assert.equal(isWaitingOnUs(request('r4', { lastCommentAuthorId: '' }), SUPPORT), false);
});

// An imported reporter — `external:youtrack:…` — is external by construction and
// has no membership to look up, so the roster never gets a chance to clear it.
test('an author imported with the request counts as the customer', () => {
  assert.equal(
    isWaitingOnUs(request('r5', { lastCommentAuthorId: 'external:youtrack:acme:88' }), SUPPORT),
    true,
  );
});

// While the roster is still loading, «everyone is a stranger» would report the
// whole queue as unanswered. Saying nothing is the honest answer.
test('an unknown roster reports nobody rather than everybody', () => {
  assert.equal(isWaitingOnUs(request('r6', { lastCommentAuthorId: 'customer-9' }), []), false);
  assert.equal(isWaitingOnUs(request('r7', { lastCommentAuthorId: 'customer-9' })), false);
});

test('a closed request is not waiting on us, whoever wrote in it last', () => {
  const categorized = categorizeIssues([
    request('open', { lastCommentAuthorId: 'customer-9' }),
    request('shut', { columnId: 'closed', lastCommentAuthorId: 'customer-9' }),
  ], statuses);

  assert.deepEqual(waitingOnUsIssues(categorized, SUPPORT).map(issue => issue.id), ['open']);
});

// The tile and the list read the same call, so the number above a queue is the
// length of the list behind it.
test('the counter is the length of the set the list filters to', () => {
  const categorized = categorizeIssues([
    request('a', { lastCommentAuthorId: 'customer-9' }),
    request('b', { lastCommentAuthorId: 'agent-1' }),
    request('c', {}),
    request('d', { columnId: 'closed', lastCommentAuthorId: 'customer-9' }),
    request('e', { lastCommentAuthorId: 'external:youtrack:acme:88' }),
  ], statuses);

  const metrics = incidentQueueMetrics(categorized, { supportUserIds: SUPPORT });
  assert.equal(metrics.waitingOnUs, 2);
  assert.equal(metrics.waitingOnUs, waitingOnUsIssues(categorized, SUPPORT).length);
  assert.deepEqual(waitingOnUsIssues(categorized, SUPPORT).map(issue => issue.id), ['a', 'e']);
  // A screen that never named its roster gets only what needs no roster to
  // decide — never the whole queue read as unanswered.
  assert.equal(incidentQueueMetrics(categorized).waitingOnUs, 1);
});
