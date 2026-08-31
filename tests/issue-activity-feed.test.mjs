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

test('both sides of the desk read the person', () => {
  const forSupport = issueActivityEntry(issue(), { supportUserIds, memberById });
  assert.equal(forSupport.actorName, 'Оксана');
  assert.equal(forSupport.text, 'відповів у зверненні');
  assert.equal(forSupport.detail, 'Перевірили логи');

  // The customer reads the same sentence, because they read the same name
  // everywhere else on their own request: the attribute strip shows a read-only
  // «Підтримка» cell with the agent in it, and every reply in the shared
  // conversation is signed and has a face. Anonymising it here said «Підтримка
  // відповіла» directly above a message signed «Оксана». The owner retired that
  // rule on 2026-09-01 — see docs/ROADMAP.md.
  const forClient = issueActivityEntry(issue(), { supportUserIds, memberById, clientViewer: true });
  assert.equal(forClient.actorName, 'Оксана');
  assert.equal(forClient.actor?.id, AGENT);
  assert.equal(forClient.fromSupport, false);
  assert.equal(forClient.text, 'відповів у зверненні');
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

// «Підтримка» survives as a fallback rather than as a policy: an event with no
// actor recorded at all — a server-side status write — still needs a subject,
// because «something happened» with a dash where the subject goes is not a
// sentence.
test('an event with nobody recorded is still attributed to the desk', () => {
  const entry = issueActivityEntry(
    { id: 'i9', issueKey: 'ACME-9', lastActivityAt: 5, lastActivityType: 'status' },
    { supportUserIds, memberById, clientViewer: true },
  );
  assert.equal(entry.fromSupport, true);
  assert.equal(entry.actorName, 'Підтримка');
  assert.equal(entry.actor, null, 'the desk is not a person and gets no face');
  assert.equal(entry.text, 'змінила статус звернення');
});

// The defect this file could not have caught, and the one that got shipped
// twice: the ids were right and the roster they are resolved against was not.
//
// `IssueCard` and `TaskRow` both look every participant id up in the `members`
// prop and drop what they cannot resolve. So adding support's assignee to the
// customer's participant list changed nothing at all while the board was still
// handed `clientMembers` — the id arrived and was silently thrown away when it
// came to drawing a face. Two components, one question, and the answer depended
// on a prop nobody was comparing against the list.
test('a customer’s participants include the desk, and the roster can resolve them', async () => {
  const { issueDisplayParticipants } = await import('../src/lib/utils/issueParticipants.mjs');
  const { readFile } = await import('node:fs/promises');

  const request = {
    assigneeIds: ['agent-1'],
    clientAssigneeIds: ['customer-2'],
    reporterId: 'customer-1',
    watcherIds: ['agent-9'],
  };
  const ids = issueDisplayParticipants(request, { source: 'client' }).map(entry => entry.id);
  assert.ok(ids.includes('agent-1'), 'the agent answering is one of the people on it');
  assert.ok(ids.includes('customer-2'), 'so is the customer’s own responsible');
  assert.ok(ids.includes('customer-1'), 'and the author');
  assert.ok(!ids.includes('agent-9'), 'watching is a subscription, not «хто цим займається»');

  // And the roster handed to the card has to contain all of them. `clientMembers`
  // is the customer's colleagues alone, so it cannot; `projectMembers` is
  // everyone on the project, which is exactly who can be on one of its requests.
  const board = await readFile(new URL('../src/app/(app)/[projectId]/ProjectBoardClient.jsx', import.meta.url), 'utf8');
  assert.match(board, /members=\{clientViewer \? projectMembers : members\}/);
  assert.doesNotMatch(board, /members=\{clientViewer \? clientMembers : members\}/);

  // The list row asks the same question and must give the same answer.
  const row = await readFile(new URL('../src/components/ui/TaskManagement/TaskRow.jsx', import.meta.url), 'utf8');
  assert.match(row, /\.\.\.\(task\.assigneeIds \|\| \[\]\),\s*\.\.\.\(task\.clientAssigneeIds \|\| \[\]\),/);
});
