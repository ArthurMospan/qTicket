import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  extractMentionedUserIds,
  filterMentionCandidates,
} from '../src/lib/utils/mentions.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const members = [
  { id: 'anna', name: 'Анна Коваль' },
  { uid: 'oleh', name: 'Олег' },
  { id: 'self', name: 'Я' },
];

test('resolves picker mentions with full names and removes duplicates', () => {
  assert.deepEqual(
    extractMentionedUserIds('@Анна Коваль перевір, будь ласка. @Анна Коваль', members),
    ['anna'],
  );
});

test('excludes the author and ignores plain text without @', () => {
  assert.deepEqual(
    extractMentionedUserIds('@Я зроблю, а Олег перегляне', members, 'self'),
    [],
  );
});

test('resolves uid-backed members', () => {
  assert.deepEqual(extractMentionedUserIds('Пінг @Олег', members), ['oleh']);
});

test('mention picker excludes the current user and filters the remaining members', () => {
  assert.deepEqual(
    filterMentionCandidates(members, 'self', 'ол').map(member => member.id || member.uid),
    ['oleh'],
  );
  assert.deepEqual(
    filterMentionCandidates(members, 'self', '').map(member => member.id || member.uid),
    ['anna', 'oleh'],
  );
});

// «Вас згадали» is a count now, not a flag. `lastCommentMentionIds` describes
// one message, so being named three times looked exactly like being named once
// and the next message erased the mark entirely.
test('a mention is tallied per person and cleared when they read the chat', async () => {
  const comments = await read('../src/lib/hooks/useComments.js');

  assert.match(comments, /\[`unreadMentions\.\$\{userId\}`, increment\(1\)\]/);
  // The author is never told they named themselves.
  assert.match(comments, /\.filter\(userId => userId && userId !== authorId\)/);
  assert.match(comments, /\[`unreadMentions\.\$\{userId\}`\]: deleteField\(\)/);

  for (const path of [
    '../src/components/workspace/IssueCard.jsx',
    '../src/components/ui/TaskManagement/TaskRow.jsx',
  ]) {
    const source = await read(path);
    assert.match(source, /unreadMentions\?\.\[currentUserId\]/, path);
    // The old flag drew a pill from the last message alone.
    assert.doesNotMatch(source, /isMentioned/, path);
  }
});
