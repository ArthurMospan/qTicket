import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isExternalActorId,
  issueParticipants,
} from '../src/lib/utils/issueParticipants.mjs';
import { issueActivity, isIssueUnread } from '../src/lib/utils/issueReadState.mjs';
import {
  isValidIssuePrefix,
  normalizeIssuePrefix,
  projectIssuePrefix,
  projectIssuePrefixTaken,
  taskDisplayKey,
} from '../src/lib/utils/issueKeys.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// An imported task remembers a reporter who never had a QuickTeam account. That
// person is a label on the record, not a participant, and not an actor.
test('an external reporter is never a notification recipient', () => {
  assert.equal(isExternalActorId('external:youtrack:conn1:42'), true);
  assert.equal(isExternalActorId('KJh2kd8sLKJd0912'), false);
  assert.equal(isExternalActorId(''), false);
  assert.equal(isExternalActorId(undefined), false);

  const imported = {
    assigneeIds: ['member-a'],
    reporterId: 'external:youtrack:conn1:42',
    watcherIds: ['member-b'],
  };
  assert.deepEqual(
    issueParticipants(imported, { actorId: 'member-a' }),
    ['member-b'],
  );
});

test('the actor is still excluded, and real reporters are still included', () => {
  const issue = {
    assigneeIds: ['a', 'b'],
    reporterId: 'c',
    watcherIds: ['d'],
  };
  assert.deepEqual(issueParticipants(issue, { actorId: 'a' }), ['b', 'c', 'd']);
  assert.deepEqual(
    issueParticipants(issue, { actorId: 'a', exclude: ['d'] }),
    ['b', 'c'],
  );
});

// One stale recipient used to fail the whole request with 403, so a status
// change on an imported task notified nobody at all.
test('a recipient who is not a member is dropped, not fatal to the batch', async () => {
  const route = await read('../src/app/api/notifications/route.js');
  assert.match(route, /const organizationMemberIds = audienceIds\.filter\(/);
  assert.doesNotMatch(route, /One or more recipients are not organization members/);
  assert.match(route, /if \(!userIdsToNotify\.length\) \{/);

  // Друге сито тієї самої форми: не можна покликати людину в проєкт, до якого
  // вона не дістає. Пікер згадок звужений, але це підказка — руками дописане
  // «@Імʼя» обходило її, і людина отримувала сповіщення про задачу, яку не може
  // відкрити. Двері тут, поруч із перевіркою членства, а не в браузері.
  assert.match(route, /hasProjectAccess\(project, membership\.role, uid\)/);
  assert.match(route, /No recipient can reach this project/);
  // Everything downstream reads the validated list, or a dropped recipient
  // would shift the settings/profile lookups out of alignment with it.
  assert.doesNotMatch(route, /db\.getAll\(\.\.\.userIds\.map/);
  assert.doesNotMatch(route, /const recipients = userIds\.map/);
});

test('nobody is notified about their own action, except a self-addressed test', async () => {
  const route = await read('../src/app/api/notifications/route.js');
  assert.match(
    route,
    /const audienceIds = type === 'test'\s*\r?\n\s*\? userIds\s*\r?\n\s*: userIds\.filter\(uid => uid !== authorization\.user\.uid\)/,
  );
});

// The card said "«External Person» оновив завдання" about somebody who does not
// exist, on a task nobody had touched.
test('project activity names only who the activity record says acted', async () => {
  const page = await read('../src/app/(app)/page.js');

  assert.match(page, /const actorId = issue\.lastActivityActorId \|\| issue\.updatedBy \|\| '';/);
  // The reporter is who filed it, not who last touched it.
  assert.doesNotMatch(page, /issue\.reporterId\b/);
  assert.doesNotMatch(page, /actorUser = members\.find\(m => m\.email && m\.email\.toLowerCase\(\) === issue\.reporterName/);
  assert.match(page, /const isExternalActor = isExternalActorId\(actorId\)/);

  // The card asks for the sentence in the voice it needs — a person did it, or
  // nobody is named — from the one table that has them. It used to keep a
  // second copy of that table, in slightly different words from the feed on
  // «Огляд», and the copy was the one that fell behind.
  assert.match(page, /issueActivityPhrase\(activity\.type, actorName \? 'actor' : 'event'\)/);
  assert.doesNotMatch(page, /ISSUE_ACTIVITY_VERBS|ISSUE_ACTIVITY_EVENTS/);
});

// Every type the product writes reads as itself. «Створено» used to render as
// «оновив», and so did cancelling, archiving, restoring and all twenty-two bulk
// actions — on both surfaces, from two different tables.
test('every recorded activity type has a sentence in all three voices', async () => {
  const { ISSUE_ACTIVITY_PHRASES, issueActivityPhrase } = await import(
    '../src/lib/utils/issueActivityFeed.mjs'
  );

  for (const [type, voices] of Object.entries(ISSUE_ACTIVITY_PHRASES)) {
    for (const voice of ['actor', 'desk', 'event']) {
      assert.ok(voices[voice] && voices[voice].trim(), `${type}.${voice}`);
    }
  }
  // The four that used to fall through to «оновив звернення».
  assert.equal(issueActivityPhrase('cancelled', 'actor'), 'скасував звернення');
  assert.equal(issueActivityPhrase('cancelled', 'desk'), 'скасувала звернення');
  assert.equal(issueActivityPhrase('cancelled', 'event'), 'Скасовано звернення');
  assert.equal(issueActivityPhrase('archived', 'event'), 'Заархівовано звернення');
  assert.equal(issueActivityPhrase('unarchived', 'event'), 'Розархівовано звернення');
  assert.equal(issueActivityPhrase('uncancelled', 'actor'), 'повернув звернення в роботу');

  // A bulk action is read out of the registry that already names it, in the
  // same words its menu row uses.
  const { ISSUE_BULK_ACTION_BY_ID } = await import('../src/lib/bulk/issueBulkActions.mjs');
  const [bulkId, bulkAction] = [...ISSUE_BULK_ACTION_BY_ID.entries()][0];
  assert.ok(
    issueActivityPhrase(`bulk_${bulkId}`, 'event').includes(bulkAction.label),
    'a bulk action names itself',
  );
  // And something nobody has a phrase for still says the honest generic rather
  // than an empty string.
  assert.equal(issueActivityPhrase('who-knows', 'actor'), 'оновив звернення');
});

// A drag renumbers every card in the column it lands in, so cards nobody
// touched are written in the same batch as the one that moved. Reading that as
// activity put a task nobody had opened at the top of the project's feed,
// saying it had been updated seconds ago.
test('a document written is not somebody doing something', () => {
  const reordered = {
    id: 'a',
    createdAt: { toMillis: () => 1_000 },
    updatedAt: { toMillis: () => 9_000 },
  };
  assert.equal(issueActivity(reordered).millis, 1_000, 'falls back to creation, never to updatedAt');
  assert.equal(issueActivity(reordered).type, 'created');

  const commented = {
    id: 'b',
    createdAt: { toMillis: () => 1_000 },
    updatedAt: { toMillis: () => 9_000 },
    lastActivityAt: { toMillis: () => 5_000 },
    lastActivityType: 'comment',
  };
  assert.equal(issueActivity(commented).millis, 5_000);
  assert.equal(issueActivity(commented).type, 'comment');

  assert.deepEqual(issueActivity({ id: 'c' }), { at: null, millis: 0, type: null });

  // The unread cursor keeps its own rule: creation is not unread activity, or
  // every task ever filed would be unread to everyone who never opened it.
  assert.equal(isIssueUnread(reordered, 0, 'someone'), false);
});

test('nothing on the dashboard ranks tasks by when their document was written', async () => {
  const home = await read('../src/app/(app)/page.js');

  assert.match(home, /issueActivity\(/);
  // A project's own `updatedAt` still sorts the project list — that one is a
  // project being worked in, which is what the sort says. No task is ranked by
  // it any more.
  assert.doesNotMatch(home, /issue\.updatedAt|issue\.createdAt/);
  // The one list of tasks the dashboard still ranks is the activity lines on
  // the featured project card, and the ranking is Firestore's now: the card
  // asks for three documents of one project in activity order rather than
  // sorting every task in the workspace in the browser. So the rule is enforced
  // where the order is actually decided.
  const activity = await read('../src/lib/hooks/useProjectActivity.js');
  assert.match(activity, /orderBy\('lastActivityAt', 'desc'\)/);
  // `createdAt` is allowed and `updatedAt` is not, which is exactly the
  // distinction `issueActivity` makes: a task with no activity stamp was still
  // certainly created, while «the document was written» is not an event.
  assert.doesNotMatch(activity, /orderBy\('updatedAt'/);
  assert.doesNotMatch(home, /newestIssue\.lastActivityType/);
});

test('a task key is never invented from a document id', async () => {
  // The client used to build `PRE-a3f2` out of the project name and four
  // characters of the Firestore id whenever a task had no key.
  assert.equal(taskDisplayKey({ issueKey: 'QT-142' }), 'QT-142');
  assert.equal(taskDisplayKey({ issueKey: '' }, { name: 'QuickTeam' }), '');
  assert.equal(taskDisplayKey({}, { name: 'QuickTeam' }), '');
  assert.equal(taskDisplayKey({ id: 'a3f2xyz' }, { name: 'QuickTeam' }), '');
  // A legacy `WS-` key keeps the number that is real and takes the project's
  // prefix in place of the generic one.
  assert.equal(taskDisplayKey({ issueKey: 'WS-17' }, { name: 'QuickTeam' }), 'QUI-17');
  assert.equal(taskDisplayKey({ issueKey: 'WS-17' }, { issuePrefix: 'qt' }), 'QT-17');
  assert.equal(projectIssuePrefix({ name: 'Мій Проєкт' }), 'MIY');
  assert.equal(projectIssuePrefix(null), 'WS');
  assert.equal(normalizeIssuePrefix(' eng-team '), 'ENGTEAM');
  assert.equal(isValidIssuePrefix('ENG'), true);
  assert.equal(isValidIssuePrefix('E'), false);
  assert.equal(isValidIssuePrefix('ENG-TEAM'), false);
  assert.equal(projectIssuePrefixTaken([
    { id: 'engineering', name: 'Engineering', issuePrefix: 'ENG' },
  ], 'eng'), true);
  assert.equal(projectIssuePrefixTaken([
    { id: 'engineering', name: 'Engineering', issuePrefix: 'ENG' },
  ], 'eng', 'engineering'), false);

  for (const file of [
    '../src/components/workspace/IssueCard.jsx',
    '../src/components/ui/TaskManagement/TaskRow.jsx',
  ]) {
    const source = await read(file);
    assert.doesNotMatch(source, /getDisplayKey/, file);
    assert.doesNotMatch(source, /id\?\.slice\(0, 4\)/, file);
  }
});

test('the prefix rule is written once, not once per writer', async () => {
  const file = '../src/app/api/issues/route.js';
  const source = await read(file);
  assert.match(source, /resolveProjectIssuePrefixInTransaction/, file);
  assert.doesNotMatch(source, /function projectPrefix\(/, file);
  const resolver = await read('../src/lib/server/issueKeys.js');
  assert.match(resolver, /suggestAvailableIssuePrefix/);
});
