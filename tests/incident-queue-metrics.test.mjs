import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categorizeIssues,
  incidentQueueMetrics,
  isWaitingOnClient,
  isWaitingOnUs,
  waitingOnClientIssues,
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

// ── The same fact from the other chair ──────────────────────────────────────
//
// «Чекають на вас» on a customer's «Огляд» is «Чекають на нас» read from their
// side of the same conversation. It lives here beside it rather than on that
// screen, for the reason this whole module exists: one word, on two screens of
// one product, must not be two numbers.

test('a request support answered last is standing on the customer', () => {
  assert.equal(
    isWaitingOnClient(request('c1', { lastCommentAuthorId: 'agent-2' }), SUPPORT),
    true,
  );
  assert.equal(
    isWaitingOnClient(request('c2', { lastCommentAuthorId: 'customer-9' }), SUPPORT),
    false,
  );
});

// The reason the mirror is a predicate of its own and not `!isWaitingOnUs`.
// Three states, two of which have a tile: a request nobody has written in yet
// has no word to answer and no answer outstanding.
test('a request nobody has written in waits on neither side', () => {
  const fresh = request('c3');
  assert.equal(isWaitingOnUs(fresh, SUPPORT), false);
  assert.equal(isWaitingOnClient(fresh, SUPPORT), false);

  // Same for an author imported with the request: external by construction, so
  // the answer is still owed by us and never by them.
  const imported = request('c4', { lastCommentAuthorId: 'external:youtrack:acme:88' });
  assert.equal(isWaitingOnUs(imported, SUPPORT), true);
  assert.equal(isWaitingOnClient(imported, SUPPORT), false);
});

test('an unknown roster reports nobody rather than everybody, on this side too', () => {
  assert.equal(isWaitingOnClient(request('c5', { lastCommentAuthorId: 'agent-1' }), []), false);
  assert.equal(isWaitingOnClient(request('c6', { lastCommentAuthorId: 'agent-1' })), false);
});

test('a closed request stands on nobody, whoever wrote in it last', () => {
  const categorized = categorizeIssues([
    request('open', { lastCommentAuthorId: 'agent-1' }),
    request('shut', { columnId: 'closed', lastCommentAuthorId: 'agent-1' }),
  ], statuses);

  assert.deepEqual(waitingOnClientIssues(categorized, SUPPORT).map(issue => issue.id), ['open']);
});

test('the customer’s tile is the length of its own set, and the two tiles never overlap', () => {
  const categorized = categorizeIssues([
    request('a', { lastCommentAuthorId: 'customer-9' }),
    request('b', { lastCommentAuthorId: 'agent-1' }),
    request('c', {}),
    request('d', { columnId: 'closed', lastCommentAuthorId: 'customer-9' }),
    request('e', { lastCommentAuthorId: 'external:youtrack:acme:88' }),
  ], statuses);

  const metrics = incidentQueueMetrics(categorized, { supportUserIds: SUPPORT });
  assert.equal(metrics.waitingOnClient, 1);
  assert.equal(metrics.waitingOnClient, waitingOnClientIssues(categorized, SUPPORT).length);
  assert.deepEqual(waitingOnClientIssues(categorized, SUPPORT).map(issue => issue.id), ['b']);

  // No request is on both tiles, and the two of them deliberately do not add up
  // to the open queue: `c` has no word in it yet and belongs to neither.
  const onUs = new Set(waitingOnUsIssues(categorized, SUPPORT).map(issue => issue.id));
  const onThem = waitingOnClientIssues(categorized, SUPPORT).map(issue => issue.id);
  assert.equal(onThem.some(id => onUs.has(id)), false);
  assert.ok(metrics.waitingOnUs + metrics.waitingOnClient < metrics.open);

  // A screen that never named its roster reports nothing here rather than
  // reading every open request as answered.
  assert.equal(incidentQueueMetrics(categorized).waitingOnClient, 0);
});
