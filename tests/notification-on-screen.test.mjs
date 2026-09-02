// What happens to a bell record about the conversation the reader already has
// in front of them — and where that decision lives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isConversationOnScreen, settleRecordsOnScreen } from '../src/lib/utils/notificationPresence.mjs';
import {
  pushVisibleConversation,
  removeVisibleConversation,
  topVisibleConversation,
} from '../src/lib/utils/visibleConversations.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a record about the conversation on screen is read the moment it is seen', () => {
  const records = [
    { id: 'a', type: 'commented', issueId: 'issue-1', read: false },
    { id: 'b', type: 'status_changed', issueId: 'issue-1', read: false },
    { id: 'c', type: 'commented', issueId: 'issue-2', read: false },
    { id: 'd', type: 'commented', issueId: 'issue-1', read: true },
    { id: 'e', type: 'emergency', issueId: 'issue-1', read: false },
  ];
  const onScreen = { kind: 'issue', id: 'issue-1' };
  const { records: settled, settledIds } = settleRecordsOnScreen(
    records,
    record => isConversationOnScreen(record, onScreen),
  );
  // Every type the incident produces, not a hand-kept list of two: a status
  // change on the incident you are reading is on your screen too. It used to be
  // silenced and left unread at once, so the counter rose and nothing explained
  // why.
  assert.deepEqual(settledIds, ['a', 'b']);
  assert.equal(settled[0].read, true);
  assert.equal(settled[1].read, true);
  // Another incident's record is untouched, an already-read one is not
  // re-written, and an emergency is never quietly consumed.
  assert.equal(settled[2].read, false);
  assert.equal(settled[3], records[3]);
  assert.equal(settled[4].read, false);
  // The input is not mutated.
  assert.equal(records[0].read, false);
});

test('settling nothing returns the same list, so nothing re-renders for it', () => {
  const records = [{ id: 'a', type: 'commented', issueId: 'issue-2', read: false }];
  const result = settleRecordsOnScreen(
    records,
    record => isConversationOnScreen(record, { kind: 'issue', id: 'issue-1' }),
  );
  assert.equal(result.records, records);
  assert.deepEqual(result.settledIds, []);
  assert.equal(settleRecordsOnScreen(records, null).records, records);
});

test('conversations on screen are a stack: closing the top reveals the one below', () => {
  let stack = [];
  stack = pushVisibleConversation(stack, { kind: 'issue', id: 'issue-1' });
  stack = pushVisibleConversation(stack, { kind: 'issue', id: 'issue-2' });
  assert.deepEqual(topVisibleConversation(stack), { kind: 'issue', id: 'issue-2' });
  // The window closes; the conversation it covered is on screen again. With one
  // slot this came back as nothing at all, and its next message rang.
  stack = removeVisibleConversation(stack, { kind: 'issue', id: 'issue-2' });
  assert.deepEqual(topVisibleConversation(stack), { kind: 'issue', id: 'issue-1' });
  // A pane unmounting after the next one registered does not wipe the newer one.
  stack = removeVisibleConversation(stack, { kind: 'issue', id: 'issue-2' });
  assert.deepEqual(topVisibleConversation(stack), { kind: 'issue', id: 'issue-1' });
  stack = removeVisibleConversation(stack, { kind: 'issue', id: 'issue-1' });
  assert.equal(topVisibleConversation(stack), null);
});

test('re-publishing the conversation already on top changes nothing', () => {
  const stack = pushVisibleConversation([], { kind: 'issue', id: 'issue-1' });
  assert.equal(pushVisibleConversation(stack, { kind: 'issue', id: 'issue-1' }), stack);
  // The same conversation registered again from underneath moves to the top once.
  const two = pushVisibleConversation(stack, { kind: 'issue', id: 'issue-2' });
  const again = pushVisibleConversation(two, { kind: 'issue', id: 'issue-1' });
  assert.deepEqual(again.map(entry => entry.id), ['issue-2', 'issue-1']);
  // Nothing valid, nothing recorded; removing what was never there is a no-op.
  assert.equal(pushVisibleConversation(stack, { kind: 'issue', id: '' }), stack);
  assert.equal(removeVisibleConversation(stack, { kind: 'issue', id: 'issue-9' }), stack);
});

// Where the rule lives, and where it no longer does.
test('the bell records for what is on screen are settled in one place', async () => {
  const [hook, bridge, timeline, sidebar, indicators, store] = await Promise.all([
    read('../src/lib/hooks/useNotifications.js'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/components/WorkspaceSidebar.jsx'),
    read('../src/lib/hooks/useProjectUnreadIndicators.js'),
    read('../src/store/useWorkspaceStore.js'),
  ]);
  // The hook settles at snapshot time — before the list is published, so the
  // counter never shows the record it is about to consume — and again whenever
  // the bridge says the screen changed.
  assert.match(hook, /publish\(settleOnScreen\(docs\)/);
  assert.match(hook, /settleRecordsOnScreen\(/);
  assert.match(hook, /settleVisible,/);
  // One predicate feeds both the announcement gate and the settlement.
  assert.match(hook, /if \(typeof watching === 'function' && watching\(n\)\) return;/);
  assert.match(bridge, /readerIsWatching,\s*\}\);/);
  assert.match(bridge, /settleVisible\(\);/);
  // The screen publishes what it shows and nothing else: no pane keeps its own
  // list of which types to mark read.
  assert.doesNotMatch(timeline, /dismissIssueNotifications/);
  assert.doesNotMatch(timeline, /notificationActions\?\.markRead/);
  assert.match(timeline, /setVisibleConversation\(conversation\);/);
  // Opening a project reads nothing. The dot beside it in the rail goes out when
  // the records behind it are read — by opening those incidents — not by walking
  // past them; it used to consume every record of every incident in the project,
  // and read the whole notification collection to do it, on every navigation.
  assert.doesNotMatch(sidebar, /markProjectRead/);
  assert.doesNotMatch(indicators, /markProjectRead/);
  assert.doesNotMatch(hook, /markProjectRead/);
  // What is on screen is a stack, not a slot.
  assert.match(store, /pushVisibleConversation\(state\.visibleConversations, conversation\)/);
  assert.match(store, /removeVisibleConversation\(state\.visibleConversations, conversation\)/);
});

// «Позначити все прочитаним» and «Очистити прочитані» ask the database for the
// records they will touch, not for every record the account has ever received.
test('bulk bell actions query only the records they change', async () => {
  const hook = await read('../src/lib/hooks/useNotifications.js');
  assert.match(hook, /where\('read', '==', read\)/);
  assert.doesNotMatch(hook, /snapshot\.docs\.filter\(matches\)/);
});

// Fifty records is a window, not the world. The bell says so when it cannot see
// every unread record, and takes the number from the server's count instead.
test('the bell counts from the server once its window is full', async () => {
  const [header, hook, bridge, store] = await Promise.all([
    read('../src/components/WorkspaceHeader.jsx'),
    read('../src/lib/hooks/useNotifications.js'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/store/useWorkspaceStore.js'),
  ]);
  assert.match(hook, /publish\(settleOnScreen\(docs\), snap\.docs\.length >= PAGE_SIZE\)/);
  assert.match(bridge, /notificationCenter\.windowFull/);
  assert.match(store, /notificationWindowFull/);
  assert.match(header, /notificationWindowFull/);
  assert.match(header, /unreadByOrganization\[activeOrgId\]/);
});
