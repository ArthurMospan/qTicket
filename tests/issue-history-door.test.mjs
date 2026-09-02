import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ISSUE_CONTENT_FIELDS,
  ISSUE_DESK_FIELDS,
  isRoutableIssuePatch,
  pickIssueDeskFields,
} from '../src/lib/utils/issueContentFields.mjs';
import { AUDITED_ISSUE_FIELDS, describeAuditEvent } from '../src/lib/utils/issueAuditEvents.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// Support's edits went straight to Firestore, and the route is what writes a
// request's history — so a priority raised, a deadline moved and an agent put
// on a request left no line in the customer's feed and none in `audit/` either.
// The desk could not read its own work.

test('every field worth a line in the history has a door that writes one', () => {
  const routable = new Set([...ISSUE_CONTENT_FIELDS, ...ISSUE_DESK_FIELDS]);
  for (const field of AUDITED_ISSUE_FIELDS) {
    assert.ok(
      routable.has(field),
      `${field} is audited but no patch carrying it reaches the route that audits it`,
    );
  }
});

test('a patch of plain values goes through the route, a sentinel keeps the direct write', () => {
  // What a person edits: names, ids, dates, lists.
  assert.equal(isRoutableIssuePatch({ priority: 'high' }), true);
  assert.equal(isRoutableIssuePatch({ assigneeIds: ['member-a'] }), true);
  assert.equal(isRoutableIssuePatch({ dueDate: new Date(1730000000000) }), true);
  assert.equal(isRoutableIssuePatch({ dueDate: null }), true);
  assert.equal(isRoutableIssuePatch({ title: 'Нова назва', labelIds: [] }), true);
  assert.equal(isRoutableIssuePatch({ attachments: [{ id: 'a', name: 'f.png' }] }), true);

  // `arrayUnion`/`arrayRemove` are class instances, and `JSON.stringify`
  // flattens them to `{}` — routing one would erase the list it meant to append
  // to. A stand-in with the same shape as the real sentinel: not a plain object.
  class FieldValueSentinel { constructor(values) { this.values = values; } }
  assert.equal(
    isRoutableIssuePatch({ watcherIds: new FieldValueSentinel(['member-a']) }),
    false,
  );
  assert.equal(
    isRoutableIssuePatch({ attachments: new FieldValueSentinel([{ id: 'a' }]) }),
    false,
  );

  // A field the route does not take keeps the direct write whatever it holds.
  assert.equal(isRoutableIssuePatch({ watcherIds: ['member-a'] }), false);
  assert.equal(isRoutableIssuePatch({ order: 4 }), false);
  assert.equal(isRoutableIssuePatch({}), false);
});

test('the desk half of a patch is picked out on its own', () => {
  assert.deepEqual(
    pickIssueDeskFields({ priority: 'high', assigneeIds: ['a'], dueDate: null, order: 2 }),
    { assigneeIds: ['a'], dueDate: null },
  );
  assert.deepEqual(pickIssueDeskFields({ priority: 'high' }), {});
});

test('the browser sends anything the route can take through the route', async () => {
  const hook = await read('../src/lib/hooks/useIssues.js');
  // The question is about the patch, not about who is asking. It used to be the
  // reader: a client had to use the route because the rules refuse their direct
  // write, and support skipped it because it may.
  assert.match(hook, /const routeThisPatch = writesThroughContentApi \|\| isRoutableIssuePatch\(directData\)/);
  assert.match(hook, /if \(Object\.keys\(directData\)\.length > 0 && routeThisPatch\) \{\s*await patchIssueContentViaApi/);
});

test('the route takes the desk fields only from the desk', async () => {
  const route = await read('../src/app/api/issues/[issueId]/route.js');
  // Being routable does not mean being permitted: the moment a patch names one
  // of the desk's own fields, the route asks for the permission no client holds.
  assert.match(route, /const deskPatch = pickIssueDeskFields\(submitted\)/);
  assert.match(route, /if \(editsDesk && !can\(authorization\.membership\?\.role, 'edit:issue'\)\)/);
  assert.match(route, /code: 'DESK_FIELDS_FORBIDDEN'/);
  // A deadline arrives as an ISO string and has to become a Timestamp, or the
  // audit entry compares a string against the Timestamp already on the record
  // and reports a change on every save.
  assert.match(route, /deskPatch\.dueDate = Timestamp\.fromDate\(parsed\)/);
  // And the write is still the one that records what changed.
  assert.match(route, /recordIssueHistory\(transaction, issueRef, \{/);
});

test('the customer’s own routing finally reads as an event', () => {
  const context = { members: [{ id: 'member-a', name: 'Оля' }] };
  assert.ok(AUDITED_ISSUE_FIELDS.includes('clientAssigneeIds'));
  assert.equal(
    describeAuditEvent({ action: 'changed_clientAssigneeIds', from: '[]', to: '["member-a"]' }, context),
    'Відповідальних з боку клієнта змінено на «Оля»',
  );
  // And support's own seat is named in the product's word for it. «Виконавець»
  // is the task manager this was forked from; the customer reads this feed now.
  assert.equal(
    describeAuditEvent({ action: 'changed_assigneeIds', from: '[]', to: '["member-a"]' }, context),
    'Відповідальних змінено на «Оля»',
  );
});
