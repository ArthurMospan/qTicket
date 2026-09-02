import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { needsAssigneeForMove } from '../src/lib/utils/issueAssignmentGate.mjs';

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

test('both places a person moves one request ask, and both assign before moving', async () => {
  const [board, detail] = await Promise.all([
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
  ]);

  for (const source of [board, detail]) {
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
  // Cancelling cancels the move, not the assignment: the request stays where
  // it was rather than advancing unowned.
  assert.match(board, /onClose=\{\(\) => setPendingMove\(null\)\}/);
  assert.match(detail, /onClose=\{\(\) => setPendingStatus\(''\)\}/);
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
