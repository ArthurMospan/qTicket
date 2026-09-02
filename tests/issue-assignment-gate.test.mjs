import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  issuesNeedingAssigneeForMove,
  needsAssigneeForMove,
} from '../src/lib/utils/issueAssignmentGate.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const STATUSES = [
  { id: 'new', label: 'Новий', category: 'backlog' },
  { id: 'triage', label: 'Сортування', category: 'backlog' },
  { id: 'accepted', label: 'Прийнято', category: 'todo' },
  { id: 'working', label: 'У роботі', category: 'in-progress' },
  { id: 'done', label: 'Вирішено', category: 'done' },
];

const unowned = (statusId = 'new') => ({ id: 'i1', status: statusId, columnId: statusId, assigneeIds: [] });

// «Без відповідального» is a number on «Огляд» and a filter on the board, and
// nothing in the product had ever asked for the name.
test('leaving «Новий» with nobody on it is the one move that asks', () => {
  const base = { statuses: STATUSES, internalViewer: true };
  assert.equal(needsAssigneeForMove({ ...base, issue: unowned(), toStatusId: 'accepted' }), true);
  assert.equal(needsAssigneeForMove({ ...base, issue: unowned(), toStatusId: 'working' }), true);
  assert.equal(needsAssigneeForMove({ ...base, issue: unowned(), toStatusId: 'done' }), true);
});

test('it does not ask twice, and does not ask about a move inside the entry category', () => {
  const base = { statuses: STATUSES, internalViewer: true };
  // Somebody is already on it: the question is answered.
  assert.equal(
    needsAssigneeForMove({
      ...base,
      issue: { ...unowned(), assigneeIds: ['member-a'] },
      toStatusId: 'accepted',
    }),
    false,
  );
  // Still being sorted — the desk has not taken it on yet.
  assert.equal(needsAssigneeForMove({ ...base, issue: unowned(), toStatusId: 'triage' }), false);
  // Already out of the entry category: every later move is already someone's,
  // and asking again at each one would be a dialog on every drag.
  assert.equal(
    needsAssigneeForMove({ ...base, issue: unowned('accepted'), toStatusId: 'working' }),
    false,
  );
});

test('it is asked of the desk and of nobody else', () => {
  // A client role cannot write `assigneeIds` at all, so gating their board on
  // it would be a dialog with no legal answer.
  assert.equal(
    needsAssigneeForMove({
      issue: unowned(),
      toStatusId: 'accepted',
      statuses: STATUSES,
      internalViewer: false,
    }),
    false,
  );
  assert.equal(needsAssigneeForMove({}), false);
  assert.equal(needsAssigneeForMove({ issue: unowned(), internalViewer: true }), false);
});

test('a board of categories asks the same question', () => {
  // «Звернення» spans every project a person is on, so no two of them are
  // guaranteed to share a status: its columns are categories, and the exact
  // status is chosen afterwards or not at all. The rule is about the category
  // either way.
  const base = { statuses: STATUSES, internalViewer: true };
  assert.equal(needsAssigneeForMove({ ...base, issue: unowned(), toCategoryId: 'todo' }), true);
  assert.equal(needsAssigneeForMove({ ...base, issue: unowned(), toCategoryId: 'backlog' }), false);
  assert.equal(
    needsAssigneeForMove({ ...base, issue: unowned('accepted'), toCategoryId: 'in-progress' }),
    false,
  );
});

test('every place a person moves one request asks, and all assign before moving', async () => {
  const [board, detail, queue] = await Promise.all([
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/(app)/my/page.js'),
  ]);

  // Three surfaces move one request at a time: a project's board, the
  // request's own page, and the queue. The queue was the one left out, so a
  // card dragged out of «Новий» there went through unowned while the same drag
  // on a project board stopped and asked.
  for (const source of [board, detail, queue]) {
    assert.match(source, /needsAssigneeForMove\(\{/);
    assert.match(source, /<AssigneePicker/);
  }
  // The people first, then the move. The other order puts the request in
  // «Прийнято» with nobody on it for a render, which is the state being
  // prevented.
  assert.match(
    board,
    /await updateIssue\(pendingMove\.issue\.id, \{ assigneeIds \}, actor\);\s*await finishMove\(/,
  );
  assert.match(
    detail,
    /await setAssignees\(assigneeIds\);\s*await moveIssue\(issueId, pendingStatus/,
  );
  assert.match(
    queue,
    /await updateTask\(pendingAssignment\.issue\.id, \{ assigneeIds \}\);\s*await commitMove\(/,
  );
  // Cancelling cancels the move, not the assignment: the request stays where
  // it was rather than advancing unowned.
  assert.match(board, /setPendingMove\(null\); setPendingBulk\(null\);/);
  assert.match(detail, /onClose=\{\(\) => setPendingStatus\(''\)\}/);
  assert.match(queue, /setPendingAssignment\(null\); setPendingBulk\(null\);/);
  // And on the queue it is the second question, asked after «which status» —
  // both can apply to one drag.
  assert.match(queue, /const saved = await gateOrCommit\(move, statusId\)/);
});

test('the dialog cannot be confirmed empty and says the same thing twice', async () => {
  const picker = await read('../src/components/ui/TaskManagement/AssigneePicker.jsx');
  const css = await read('../src/app/globals.css');

  assert.match(picker, /disabled=\{selected\.length === 0\}/);
  assert.match(picker, /selected\.length > 0 && onConfirm\?\.\(selected\)/);
  // The ring is the brand colour picker's, and the tick repeats it — a thin
  // outline against a ground is one signal, and a choice needs two.
  assert.match(css, /\[data-ui-control='assignee-choice'\][\s\S]{0,400}outline-offset: 2px;/);
  assert.match(
    css,
    /\[data-ui-control='assignee-choice'\]\[data-ui-state='selected'\] \{\s*outline-color: var\(--color-ink\);/,
  );
  assert.match(picker, /<Check size=\{13\} \/>/);
  // A face you can recognise, at a size that is not on the generic scale.
  assert.match(picker, /size="assignee-choice"/);
});

// Select a column, move thirty requests, and every one of them left «Новий»
// unowned — while the identical drag one card at a time stopped and asked.
test('a bulk status change asks once, about the requests that need it', async () => {
  const selection = [
    { id: 'a', status: 'new', columnId: 'new', assigneeIds: [] },
    { id: 'b', status: 'new', columnId: 'new', assigneeIds: ['member-a'] },
    { id: 'c', status: 'accepted', columnId: 'accepted', assigneeIds: [] },
    { id: 'd', status: 'new', columnId: 'new', assigneeIds: [] },
  ];
  const needing = issuesNeedingAssigneeForMove({
    issues: selection,
    toStatusId: 'working',
    statuses: STATUSES,
    internalViewer: true,
  });
  // Only the ones the move leaves unowned: `b` already has somebody, `c` is
  // already out of the entry category.
  assert.deepEqual(needing.map(issue => issue.id), ['a', 'd']);

  // Nothing to ask about is not a question.
  assert.deepEqual(
    issuesNeedingAssigneeForMove({
      issues: selection,
      toStatusId: 'triage',
      statuses: STATUSES,
      internalViewer: true,
    }),
    [],
  );

  const [board, queue] = await Promise.all([
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/app/(app)/my/page.js'),
  ]);
  for (const source of [board, queue]) {
    assert.match(source, /if \(action === 'status' && value\?\.id\) \{/);
    assert.match(source, /issuesNeedingAssigneeForMove\(\{/);
    // The category board and the status board send different halves of the
    // same value, and the gate takes whichever it is given.
    assert.match(source, /value\.mode === 'category' \? \{ toCategoryId: value\.id \} : \{ toStatusId: value\.id \}/);
    // Only the requests that needed a name get one; the rest of the selection
    // keeps whoever is already on it.
    assert.match(source, /applyBulkAction\('assignees-add', assigneeIds, pendingBulk\.needing\)/);
    // And the dialog says how many it is about rather than naming one key.
    assert.match(source, /count=\{pendingBulk \? pendingBulk\.needing\.length : 1\}/);
  }
});

test('the dialog offers people who can actually open the request', async () => {
  const [detail, queue] = await Promise.all([
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/app/(app)/my/page.js'),
  ]);
  // The request's own page handed over the organization's whole support side
  // and offered colleagues who are not on the project — an assignee is a person
  // who has to be able to find their own work. It uses the list this screen
  // already computes for its assignee picker.
  assert.match(detail, /members=\{assignableMembers\}/);
  assert.doesNotMatch(detail, /members=\{supportDirectory\}/);
  // The queue spans projects, so a selection can too: the same people are
  // written to all of them, which makes the intersection the honest set. One
  // rule, shared — see `assignableMembersFor`.
  assert.match(queue, /assignableMembersFor\(\{/);
});

// A bulk move into a category resolved the exact status silently, per request,
// while the identical drag of one card stopped and asked which.
test('a bulk move into a category asks which status, when there is one to ask about', async () => {
  const queue = await read('../src/app/(app)/my/page.js');

  // Only askable when there is a single answer to give: every request in one
  // project, and that project offering more than one status in the category.
  assert.match(queue, /if \(action === 'status' && value\?\.mode === 'category'\) \{/);
  assert.match(queue, /const projectIds = \[\.\.\.new Set\(selectedIssues\.map\(issue => issue\.projectId\)/);
  assert.match(queue, /projectIds\.length === 1/);
  assert.match(queue, /if \(candidates\.length > 1\) \{\s*setPendingBulkStatus\(/);

  // Answered, then re-asked as a status — so the assignee gate still applies,
  // and the two questions arrive in the order a single drag asks them.
  assert.match(
    queue,
    /await handleBulkUpdate\(\s*pending\.action,\s*\{ mode: 'status', id: statusId \},/,
  );
  // The dialog counts rather than naming one request's key.
  assert.match(queue, /count=\{pendingBulkStatus\.selectedIssues\.length\}/);

  const picker = await read('../src/components/ui/TaskManagement/StatusTransitionPicker.jsx');
  assert.match(picker, /count > 1/);
});
