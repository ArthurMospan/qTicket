import test from 'node:test';
import assert from 'node:assert/strict';
import {
  issueKeyNumber,
  scoreIssue,
  scoreIssueMention,
  searchMinimumLength,
} from '../src/lib/utils/searchRanking.mjs';

const issue = (issueKey, fields = {}) => ({ issueKey, ...fields });

// The workspace search is a question, and prose is a legitimate answer to one.
test('the general search still reads titles and descriptions', () => {
  assert.ok(scoreIssue(issue('QT-3', { description: 'треба виставити рахунок' }), 'рахунок') > 0);
  assert.ok(scoreIssue(issue('QT-3', { title: 'Дизайн головної' }), 'дизайн') > 0);
});

// Picking a task to mention is not a question — it is naming one row. This is
// the bug: typing 12 in the `#` menu returned every task whose description
// happened to contain those two characters.
test('a number in a mention is a task number, never text in a description', () => {
  const withPrice = issue('QT-77', { title: 'Оплата', description: 'бюджет 12 000 грн' });
  assert.equal(scoreIssueMention(withPrice, '12'), 0);
  assert.ok(scoreIssue(withPrice, '12') > 0, 'the general search is left alone');
});

test('a number matches the task number exactly, then by prefix', () => {
  assert.ok(scoreIssueMention(issue('QT-12'), '12') > scoreIssueMention(issue('QT-120'), '12'));
  assert.ok(scoreIssueMention(issue('QT-120'), '12') > 0);
  // The characters appearing somewhere inside the number is not a match: `1`
  // offering QT-1, QT-10 and QT-19 is a list; `1` also offering QT-31 is noise.
  assert.equal(scoreIssueMention(issue('QT-31'), '1'), 0);
  assert.ok(scoreIssueMention(issue('QT-1'), '1') > 0);
});

test('a single digit is enough to mention a task, two are needed to ask a question', () => {
  assert.equal(searchMinimumLength(true), 1);
  assert.equal(searchMinimumLength(false), 2);
});

// You do not always remember the number, and the title is how you find it.
test('words in a mention still match a key or a title, but never a description', () => {
  const task = issue('QT-9', { title: 'Рефакторинг календаря', description: 'подивитись календар' });
  assert.ok(scoreIssueMention(task, 'рефактор') > 0);
  assert.ok(scoreIssueMention(task, 'qt-9') > scoreIssueMention(task, 'рефактор'));
  assert.equal(scoreIssueMention(issue('QT-9', { description: 'подивитись календар' }), 'подивитись'), 0);
});

test('a legacy stored key is matched as well as the displayed one', () => {
  const migrated = issue('QT-42', { storedIssueKey: 'WS-42' });
  assert.ok(scoreIssueMention(migrated, 'ws-42') > 0);
});

test('a task with no key cannot be found by number', () => {
  assert.equal(scoreIssueMention(issue(''), '3'), 0);
  assert.equal(issueKeyNumber('QT-142'), '142');
  assert.equal(issueKeyNumber('QT-142 '), '142');
  assert.equal(issueKeyNumber('нічого'), '');
});
