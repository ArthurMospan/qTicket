import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  commentReaders,
  isIssueChangeUnread,
  isIssueUnread,
  issueActivityCursor,
  receiptMarkIds,
  receiptMarks,
  timestampMillis,
  unreadActivityLabel,
} from '../src/lib/utils/issueReadState.mjs';

test('timestampMillis normalizes Firestore timestamps, dates and milliseconds', () => {
  assert.equal(timestampMillis({ toMillis: () => 42 }), 42);
  assert.equal(timestampMillis(new Date(84)), 84);
  assert.equal(timestampMillis(126), 126);
  assert.equal(timestampMillis(null), 0);
});

test('issueActivityCursor intentionally ignores legacy updatedAt-only issues', () => {
  assert.equal(issueActivityCursor({ updatedAt: new Date(100) }), 0);
  assert.equal(issueActivityCursor({ lastActivityAt: new Date(200) }), 200);
});

test('an activity newer than the per-issue cursor is unread', () => {
  const issue = {
    id: 'issue-a',
    lastActivityAt: new Date(200),
    lastActivityActorId: 'member-b',
  };
  assert.equal(isIssueUnread(issue, new Date(100), 'member-a'), true);
  assert.equal(isIssueUnread(issue, new Date(200), 'member-a'), false);
});

test('a user never gets an unread dot for their own activity', () => {
  const issue = {
    id: 'issue-a',
    lastActivityAt: new Date(200),
    lastActivityActorId: 'member-a',
  };
  assert.equal(isIssueUnread(issue, null, 'member-a'), false);
});

test('missing activity, identity or issue id stays read', () => {
  assert.equal(isIssueUnread({ id: 'issue-a' }, null, 'member-a'), false);
  assert.equal(isIssueUnread({ id: 'issue-a', lastActivityAt: new Date(200) }, null, null), false);
  assert.equal(isIssueUnread({ lastActivityAt: new Date(200) }, null, 'member-a'), false);
});

test('a change is unread by the same rule the dot follows', () => {
  const entry = { id: 'audit-a', userId: 'member-b', createdAt: { toMillis: () => 200 } };
  assert.equal(isIssueChangeUnread(entry, 100, 'member-a'), true);
  assert.equal(isIssueChangeUnread(entry, 200, 'member-a'), false);
  // Your own change is never new to you, in the feed as on the card.
  assert.equal(isIssueChangeUnread({ ...entry, userId: 'member-a' }, 100, 'member-a'), false);
  // A pending server timestamp has no time yet, so it is not yet a boundary.
  assert.equal(isIssueChangeUnread({ id: 'audit-b', userId: 'member-b' }, 0, 'member-a'), false);
  assert.equal(isIssueChangeUnread(entry, 100, null), false);
});

test('the dot says what kind of activity it is about', () => {
  assert.equal(unreadActivityLabel({ lastActivityType: 'comment' }), 'Нове: повідомлення');
  assert.equal(unreadActivityLabel({ lastActivityType: 'status' }), 'Нове: зміна статусу');
  // Bulk actions and plain edits share one phrase; a card is not the place to
  // enumerate which field of the task moved.
  assert.equal(unreadActivityLabel({ lastActivityType: 'bulk_priority' }), 'Нове: зміни в задачі');
  assert.equal(unreadActivityLabel({}), 'Нове: зміни в задачі');
});

test('a task is consumed by being left, never by being rendered', async () => {
  const source = await readFile(new URL('../src/components/workspace/IssueDetail.jsx', import.meta.url), 'utf8');
  // The cursor advanced during render once, and the boundary in the timeline was
  // useless for the case it exists for: opened, called away, came back to a task
  // that already counted as read.
  assert.doesNotMatch(source, /\bmarkIssueSeen\b/);
  assert.match(source, /scheduleIssueSeen\(/);
  assert.match(source, /cancelScheduledIssueSeen\(issueId\)/);

  const service = await readFile(new URL('../src/lib/services/issueReadState.js', import.meta.url), 'utf8');
  // Marking unread must not reset a cursor that already sits further back, or
  // pressing it would consume the older changes it was meant to preserve.
  assert.match(service, /if \(currentSeenMillis && currentSeenMillis <= target\) return true;/);
});

const conversation = [
  { id: 'a1', authorId: 'member-a', createdAt: 100 },
  { id: 'a2', authorId: 'member-a', createdAt: 200 },
  { id: 'b1', authorId: 'member-b', createdAt: 300 },
  { id: 'a3', authorId: 'member-a', createdAt: 400 },
  { id: 'me1', authorId: 'me', createdAt: 500 },
];

test('reading a conversation marks one message per author, not one per message', () => {
  // The whole point of the wave: fifty unread messages used to cost fifty
  // writes. A receipt is monotonic, so the newest message of each other author
  // carries the receipt for everything they sent before it.
  const marked = receiptMarkIds(conversation, 'me');
  assert.deepEqual(marked.sort(), ['a3', 'b1']);
  // Your own messages are never marked by you.
  assert.equal(marked.includes('me1'), false);
  assert.deepEqual(receiptMarkIds([], 'me'), []);
});

test('a receipt on the newest message answers for the older ones', () => {
  const mine = [
    { id: 'm1', authorId: 'me', createdAt: 100, readBy: ['me'] },
    { id: 'm2', authorId: 'me', createdAt: 200, readBy: ['me'] },
    { id: 'm3', authorId: 'me', createdAt: 300, readBy: ['me', 'member-a'], readAt: { 'member-a': 900 } },
  ];
  const marks = receiptMarks(mine, 'me');
  // Every message at or below the mark is read, and says so at the hour the
  // reader was actually there.
  for (const id of ['m1', 'm2', 'm3']) {
    const readers = commentReaders(mine.find(item => item.id === id), marks);
    assert.deepEqual(readers, [{ readerId: 'member-a', stamp: 900 }], id);
  }
  // A message sent after the mark is not read yet.
  const later = { id: 'm4', authorId: 'me', createdAt: 400 };
  assert.deepEqual(commentReaders(later, marks), []);
});

test('an older message keeps the hour of the visit that first reached it', () => {
  // A second visit must not move the receipt of an older message forward, or
  // «Прочитано о 14:32» would drift every time the reader came back.
  const mine = [
    { id: 'm1', authorId: 'me', createdAt: 100, readBy: ['me', 'member-a'], readAt: { 'member-a': 150 } },
    { id: 'm2', authorId: 'me', createdAt: 200, readBy: ['me', 'member-a'], readAt: { 'member-a': 950 } },
  ];
  const marks = receiptMarks(mine, 'me');
  assert.deepEqual(commentReaders(mine[0], marks), [{ readerId: 'member-a', stamp: 150 }]);
  assert.deepEqual(commentReaders(mine[1], marks), [{ readerId: 'member-a', stamp: 950 }]);
});

test('a mark written before readAt existed still reads as read', () => {
  const mine = [{ id: 'm1', authorId: 'me', createdAt: 100, readBy: ['me', 'member-a'] }];
  const marks = receiptMarks(mine, 'me');
  assert.deepEqual(commentReaders(mine[0], marks), [{ readerId: 'member-a', stamp: null }]);
});

test('the task chat asks the cursor what is unread, not every message', async () => {
  const source = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');
  // Unread is the cursor comparison the card and the change feed already use.
  assert.match(source, /timestampMillis\(comment\.createdAt\) > timestampMillis\(lastSeenAt\)/);
  // And nothing decides unread from the per-message array any more.
  assert.doesNotMatch(source, /readBy \|\| \[\]\)\.includes\(myId\)/);
  // Only the receipt marks are written.
  assert.match(source, /markCommentsRead\(receipts, myId\)/);
});
