import test from 'node:test';
import assert from 'node:assert/strict';

import { issueActivityEntry, issueActivityFeed } from '../src/lib/utils/issueActivityFeed.mjs';

const AGENT = 'agent-1';
const CUSTOMER = 'customer-1';
const supportUserIds = new Set([AGENT]);
const memberById = new Map([
  [AGENT, { id: AGENT, name: 'Оксана' }],
  [CUSTOMER, { id: CUSTOMER, name: 'Олег' }],
]);

const issue = (overrides = {}) => ({
  id: 'i1',
  issueKey: 'ACME-1',
  title: 'Не працює експорт',
  projectId: 'p1',
  createdBy: CUSTOMER,
  reporterId: CUSTOMER,
  lastActivityAt: 1_000,
  lastActivityType: 'comment',
  lastActivityActorId: AGENT,
  lastActivityActorName: 'Оксана',
  lastActivityText: 'Перевірили логи',
  ...overrides,
});

test('a request with nothing recorded is not an entry in a list of what happened', () => {
  assert.equal(issueActivityEntry({ id: 'i1' }), null);
  assert.equal(issueActivityEntry(null), null);
  // `createdAt` alone is still an event that certainly happened.
  const created = issueActivityEntry({ id: 'i1', createdAt: 5, createdBy: CUSTOMER }, { memberById });
  assert.equal(created.type, 'created');
});

test('support reads the person; the customer reads the event', () => {
  const forSupport = issueActivityEntry(issue(), { supportUserIds, memberById });
  assert.equal(forSupport.actorName, 'Оксана');
  assert.equal(forSupport.text, 'відповів у зверненні');
  assert.equal(forSupport.detail, 'Перевірили логи');

  // A customer is told the desk acted, never which agent — and «Підтримка» is
  // no agent. The first version of this withheld the subject altogether, and on
  // screen that made a customer's own actions bold with a face while the reply
  // they came to read was a grey line behind a 7px dot: the two most important
  // rows were the faintest. `fromSupport` is what lets the row draw a mark
  // instead of a person, so the line keeps its weight without borrowing a face.
  const forClient = issueActivityEntry(issue(), { supportUserIds, memberById, clientViewer: true });
  assert.equal(forClient.actorName, 'Підтримка');
  assert.equal(forClient.actor, null, 'the desk is not a person and gets no face');
  assert.equal(forClient.fromSupport, true);
  assert.equal(forClient.text, 'відповіла у зверненні');
});

test('a customer still reads their own colleagues by name', () => {
  const entry = issueActivityEntry(
    issue({ lastActivityActorId: CUSTOMER, lastActivityActorName: 'Олег', lastActivityType: 'created' }),
    { supportUserIds, memberById, clientViewer: true },
  );
  assert.equal(entry.actorName, 'Олег');
  assert.equal(entry.actor?.id, CUSTOMER, 'their own colleague keeps their face');
  assert.equal(entry.fromSupport, false);
  assert.equal(entry.text, 'відкрив звернення');
});

test('an unknown activity type still reads as something rather than as nothing', () => {
  const entry = issueActivityEntry(issue({ lastActivityType: 'whatever-next' }), { memberById });
  assert.equal(entry.type, 'updated');
  assert.equal(entry.text, 'оновив звернення');
});

test('the feed is newest first and drops what cannot speak', () => {
  const feed = issueActivityFeed([
    issue({ id: 'a', lastActivityAt: 10 }),
    { id: 'b' },
    issue({ id: 'c', lastActivityAt: 30 }),
    issue({ id: 'd', lastActivityAt: 20 }),
  ], { supportUserIds, memberById }, 2);
  assert.deepEqual(feed.map(entry => entry.id), ['c', 'd']);
});
