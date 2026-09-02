import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUDITED_ISSUE_FIELDS,
  auditValue,
  describeAuditEvent,
  isCustomerVisibleAuditEntry,
} from '../src/lib/utils/issueAuditEvents.mjs';
import { recordIssueHistory } from '../src/lib/server/issueHistory.mjs';

const CONTEXT = {
  statuses: [
    { id: 'backlog', label: 'Беклог', category: 'backlog' },
    { id: 'qa', label: 'Тестування', category: 'in-progress' },
  ],
  priorities: [{ id: 'high', label: 'Високий' }, { id: 'low', label: 'Низький' }],
  types: [{ id: 'bug', label: 'Баг' }],
  labels: [{ id: 'label-a', name: 'Дизайн' }],
  members: [{ id: 'member-a', name: 'Оля' }, { id: 'member-b', name: 'Дмитро' }],
  timeZone: 'UTC',
};

test('a status is read out in the words its own project uses', () => {
  // A hard-coded map of seven ids is what made a project that renamed «QA» to
  // «Тестування» read «QA» in its own history, and a project that added a status
  // read a raw id.
  assert.equal(
    describeAuditEvent({ action: 'changed_status', from: 'backlog', to: 'qa' }, CONTEXT),
    'Статус змінено: «Беклог» → «Тестування»',
  );
  // An id the workflow no longer has still names itself rather than vanishing.
  assert.equal(
    describeAuditEvent({ action: 'changed_status', from: 'qa', to: 'retired-status' }, CONTEXT),
    'Статус змінено: «Тестування» → «retired-status»',
  );
});

test('every audited field has a phrase, not just the first three', () => {
  const said = field => describeAuditEvent({ action: `changed_${field}`, from: null, to: null }, CONTEXT);
  for (const field of AUDITED_ISSUE_FIELDS) {
    assert.notEqual(said(field), 'Оновлено звернення', field);
  }
});

test('values are resolved through the live configuration', () => {
  assert.equal(
    describeAuditEvent({ action: 'changed_priority', from: 'low', to: 'high' }, CONTEXT),
    'Пріоритет змінено: «Низький» → «Високий»',
  );
  assert.equal(
    describeAuditEvent({ action: 'changed_type', from: null, to: 'bug' }, CONTEXT),
    'Тип змінено на «Баг»',
  );
  assert.equal(
    describeAuditEvent({ action: 'changed_priority', from: 'high', to: 'none' }, CONTEXT),
    'Пріоритет змінено: «Високий» → «без пріоритету»',
  );
});

test('a deadline reads as a date, whichever shape it was logged in', () => {
  const millis = Date.UTC(2026, 7, 19);
  assert.equal(
    describeAuditEvent({ action: 'changed_dueDate', from: null, to: String(millis) }, CONTEXT),
    'Дедлайн змінено на «19 серп. 2026 р.»',
  );
  // A deadline that is cleared reads as the transition it is; only a field that
  // had no value collapses to «змінено на …».
  assert.equal(
    describeAuditEvent({ action: 'changed_dueDate', from: String(millis), to: '' }, CONTEXT),
    'Дедлайн змінено: «19 серп. 2026 р.» → «не вказано»',
  );
  assert.equal(
    describeAuditEvent({ action: 'changed_dueDate', from: '', to: String(millis) }, CONTEXT),
    'Дедлайн змінено на «19 серп. 2026 р.»',
  );
});

test('people and labels are named, and an empty list says so', () => {
  assert.equal(
    describeAuditEvent({
      action: 'changed_assigneeIds',
      from: JSON.stringify(['member-a']),
      to: JSON.stringify(['member-a', 'member-b']),
    }, CONTEXT),
    'Виконавців змінено: «Оля» → «Оля, Дмитро»',
  );
  assert.equal(
    describeAuditEvent({
      action: 'changed_assigneeIds',
      from: JSON.stringify(['member-a']),
      to: JSON.stringify([]),
    }, CONTEXT),
    'Виконавців змінено: «Оля» → «ніхто»',
  );
  // Entries written before this module existed carry a bare id, not JSON.
  assert.equal(
    describeAuditEvent({ action: 'changed_assigneeIds', from: '', to: 'member-b' }, CONTEXT),
    'Виконавців змінено на «Дмитро»',
  );
  assert.equal(
    describeAuditEvent({ action: 'changed_labelIds', from: '[]', to: JSON.stringify(['label-a']) }, CONTEXT),
    'Мітки змінено на «Дизайн»',
  );
});

test('a description is a fact in the feed, never a diff', () => {
  assert.equal(
    describeAuditEvent({ action: 'changed_description', from: null, to: null }, CONTEXT),
    'Опис змінено',
  );
});

test('what the server did reads as what changed, not as its own action id', () => {
  // The board writes `moved`, the workflow editor `workflow-status-migrated`;
  // both are a status change to whoever reads the history, and both used to
  // print their raw id under a person's name.
  assert.equal(
    describeAuditEvent({ action: 'moved', from: 'backlog', to: 'qa' }, CONTEXT),
    'Статус змінено: «Беклог» → «Тестування»',
  );
  assert.equal(
    describeAuditEvent({ action: 'workflow-status-migrated', from: 'backlog', to: 'qa' }, CONTEXT),
    'Статус змінено: «Беклог» → «Тестування»',
  );
  // Dragging a card up its own column writes the same entry as crossing into
  // another one. Reading that out as a status change claims a move that never
  // happened.
  assert.equal(
    describeAuditEvent({ action: 'moved', from: 'qa', to: 'qa' }, CONTEXT),
    'Позицію на дошці змінено',
  );
});

test('a bulk change reads in the same words a single edit produces', () => {
  assert.equal(
    describeAuditEvent({
      action: 'bulk_priority',
      from: JSON.stringify({ priority: 'low' }),
      to: JSON.stringify({ priority: 'high' }),
    }, CONTEXT),
    'Пріоритет змінено: «Низький» → «Високий»',
  );
  assert.equal(
    describeAuditEvent({
      action: 'bulk_assignees-add',
      from: JSON.stringify({ assigneeIds: ['member-a'] }),
      to: JSON.stringify({ assigneeIds: ['member-a', 'member-b'] }),
    }, CONTEXT),
    'Виконавців змінено: «Оля» → «Оля, Дмитро»',
  );
  // A deadline is the one value that reaches the log as a serialised Firestore
  // Timestamp rather than a number.
  assert.equal(
    describeAuditEvent({
      action: 'bulk_deadline',
      from: JSON.stringify({ dueDate: null }),
      to: JSON.stringify({ dueDate: { _seconds: Date.UTC(2026, 7, 19) / 1000, _nanoseconds: 0 } }),
    }, CONTEXT),
    'Дедлайн змінено на «19 серп. 2026 р.»',
  );
  // A patch this build cannot read still names the operation that wrote it.
  assert.equal(
    describeAuditEvent({ action: 'bulk_duplicate', from: '', to: '' }, CONTEXT),
    'Масова дія: дублювати',
  );
});

test('an action with no phrase names itself instead of claiming an update', () => {
  assert.equal(describeAuditEvent({ action: 'created' }, CONTEXT), 'Створено звернення');
  assert.equal(
    describeAuditEvent({ action: 'експортував баг з Buggy Bag' }, CONTEXT),
    'експортував баг з Buggy Bag',
  );
  assert.equal(describeAuditEvent({}, CONTEXT), 'Оновлено звернення');
});

test('arrays are compared by content, so a save is not a change', () => {
  assert.equal(auditValue(['b', 'a']), auditValue(['a', 'b']));
  assert.equal(auditValue({ toMillis: () => 500 }), '500');
  assert.equal(auditValue(new Date(500)), '500');
  assert.equal(auditValue(null), '');
});

test('the timeline holds no vocabulary of its own', async () => {
  const source = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');
  // Two copies of "what a status is called" is one copy too many, and the copy
  // that lived here could not see a project's own workflow at all.
  assert.doesNotMatch(source, /STATUS_LABELS|FIELD_LABELS/);
  assert.match(source, /describeAuditEvent\(item, auditContext\)/);
  // The boundary counts changes as well as messages.
  assert.match(source, /unreadChangeIds/);
  assert.match(source, /const unreadTotal = unreadCommentIds\.length \+ unreadChangeIds\.length;/);
});

test('the fields worth logging live next to the phrases that read them', async () => {
  const hook = await readFile(new URL('../src/lib/hooks/useIssues.js', import.meta.url), 'utf8');
  // Three fields were logged here while the timeline knew how to say more: a
  // moved deadline left no trace anywhere in the product.
  assert.doesNotMatch(hook, /const auditFields = /);
  assert.match(hook, /for \(const field of AUDITED_ISSUE_FIELDS\)/);
  for (const field of ['dueDate', 'labelIds', 'type', 'description']) {
    assert.ok(AUDITED_ISSUE_FIELDS.includes(field), field);
  }
});

// ── The customer's half of the record ───────────────────────────────────────
//
// Their thread used to hold two kinds of line — «Створено звернення» and
// «Статус змінено» — with nobody's name on either, while the support copy of
// the same thread held every change and signed all of them.

// A fake of the two things `recordIssueHistory` touches: a transaction that
// remembers what it was asked to create, and a document reference that hands
// out subcollections by name.
function historyWriter() {
  const written = [];
  const issueRef = {
    collection: name => ({ doc: () => ({ collection: name }) }),
  };
  return {
    issueRef,
    written,
    writer: { create: (ref, data) => written.push({ collection: ref.collection, data }) },
    collectionsFor: action => written.filter(row => row.data.action === action).map(row => row.collection),
  };
}

test('every change to a request reaches the person who filed it, signed', () => {
  const { writer, issueRef, written, collectionsFor } = historyWriter();
  const actor = { userId: 'agent-1', userName: 'Оля' };

  recordIssueHistory(writer, issueRef, { ...actor, action: 'created', from: null, to: 'QT-1' });
  recordIssueHistory(writer, issueRef, { ...actor, action: 'moved', from: 'backlog', to: 'qa' });
  recordIssueHistory(writer, issueRef, { ...actor, action: 'changed_priority', from: 'low', to: 'high' });
  recordIssueHistory(writer, issueRef, { ...actor, action: 'changed_dueDate', from: null, to: '1730000000000' });
  recordIssueHistory(writer, issueRef, { ...actor, action: 'changed_assigneeIds', from: '[]', to: '["member-a"]' });
  recordIssueHistory(writer, issueRef, { ...actor, action: 'cancelled' });

  for (const action of ['created', 'moved', 'changed_priority', 'changed_dueDate', 'changed_assigneeIds', 'cancelled']) {
    assert.deepEqual(
      collectionsFor(action),
      ['audit', 'statusHistory'],
      `${action} belongs in both feeds`,
    );
  }
  // The copy is the entry, actor and all — the customer reads who did it.
  const mirrored = written.filter(row => row.collection === 'statusHistory');
  assert.ok(mirrored.every(row => row.data.userId === 'agent-1' && row.data.userName === 'Оля'));
});

test('the desk keeps its own machinery to itself', () => {
  const { writer, issueRef, collectionsFor } = historyWriter();
  const actor = { userId: 'agent-1', userName: 'Оля' };

  // Where the supplier tracks the work is the supplier's business.
  recordIssueHistory(writer, issueRef, { ...actor, action: 'quickteam-transferred' });
  // A change to the client roster is readable on the roster.
  recordIssueHistory(writer, issueRef, { ...actor, action: 'project-team-granted', to: ['member-a'] });
  // And a card tidied inside its own column is not something that happened to
  // the request — `describeAuditEvent` reads it out as «Позицію на дошці
  // змінено», which is a sentence about a board the customer never opens.
  recordIssueHistory(writer, issueRef, { ...actor, action: 'moved', from: 'qa', to: 'qa' });

  assert.deepEqual(collectionsFor('quickteam-transferred'), ['audit']);
  assert.deepEqual(collectionsFor('project-team-granted'), ['audit']);
  assert.deepEqual(collectionsFor('moved'), ['audit']);
});

test('an entry with no action belongs to neither feed', () => {
  assert.equal(isCustomerVisibleAuditEntry({}), false);
  assert.equal(isCustomerVisibleAuditEntry(null), false);
  assert.equal(isCustomerVisibleAuditEntry({ action: '' }), false);
});

// The mirror is only true if nothing writes history around it.
test('every route that writes a task history writes both halves of it', async () => {
  const routes = [
    '../src/app/api/issues/route.js',
    '../src/app/api/issues/[issueId]/status/route.js',
    '../src/app/api/issues/[issueId]/route.js',
    '../src/app/api/issues/[issueId]/archive/route.js',
    '../src/app/api/issues/[issueId]/cancel/route.js',
    '../src/app/api/issues/[issueId]/restore/route.js',
    '../src/app/api/issues/[issueId]/parent/route.js',
    '../src/app/api/issues/bulk/route.js',
    '../src/app/api/organizations/[organizationId]/workflow/route.js',
    '../src/app/api/projects/[projectId]/route.js',
  ];
  const sources = await Promise.all(routes.map(path =>
    readFile(new URL(path, import.meta.url), 'utf8').then(text => [path, text])));

  for (const [path, source] of sources) {
    assert.doesNotMatch(
      source,
      /transaction\.create\(issueRef\.collection\('audit'\)/,
      `${path} writes the audit directly instead of through recordIssueHistory`,
    );
    assert.doesNotMatch(
      source,
      /collection\('statusHistory'\)/,
      `${path} keeps a second opinion about what a customer may read`,
    );
    assert.match(source, /recordIssueHistory/, `${path} records no history at all`);
  }
});
