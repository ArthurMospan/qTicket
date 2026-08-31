import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  incidentAnnouncementRecipients,
  incidentAnnouncementTitle,
} from '../src/lib/utils/incidentAnnouncement.mjs';
import { SYSTEM_NOTIFICATION_TYPES, REQUESTABLE_NOTIFICATION_TYPES, shouldDeliver } from '../src/lib/utils/notificationChannels.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const roles = entries => new Map(Object.entries(entries));

test('a new request reaches the support staff on that customer’s space', () => {
  const recipients = incidentAnnouncementRecipients({
    projectTeam: ['agent-1', 'agent-2', 'client-admin', 'client-member'],
    roleByUid: roles({
      'agent-1': 'member',
      'agent-2': 'admin',
      'client-admin': 'client_admin',
      'client-member': 'client_member',
    }),
    actorId: 'client-member',
  });
  assert.deepEqual(recipients, ['agent-1', 'agent-2']);
});

test('the customer’s own colleagues are not an audience for their request', () => {
  const recipients = incidentAnnouncementRecipients({
    projectTeam: ['client-admin', 'client-member'],
    roleByUid: roles({ 'client-admin': 'client_admin', 'client-member': 'client_member' }),
    actorId: 'client-member',
    fallbackAdminIds: [],
  });
  assert.deepEqual(recipients, [], 'a client space with no support staff has no client recipients');
});

test('nobody is told about their own action', () => {
  const recipients = incidentAnnouncementRecipients({
    projectTeam: ['agent-1', 'agent-2'],
    roleByUid: roles({ 'agent-1': 'member', 'agent-2': 'member' }),
    actorId: 'agent-1',
  });
  assert.deepEqual(recipients, ['agent-2']);
});

// `project.team` is never rewritten to tidy up after somebody who left, so a
// roster carries uids whose membership is gone. Trusting one would address the
// notification to an account that can no longer sign in.
test('a roster uid with no membership left is dropped, not trusted', () => {
  const recipients = incidentAnnouncementRecipients({
    projectTeam: ['agent-1', 'departed'],
    roleByUid: roles({ 'agent-1': 'member' }),
    actorId: 'client-member',
  });
  assert.deepEqual(recipients, ['agent-1']);
});

// The narrow audience is the owner's decision. Falling back is not a wider
// audience by default — it is the difference between a narrow one and none.
test('an unstaffed client space falls back to owners and admins rather than telling nobody', () => {
  const recipients = incidentAnnouncementRecipients({
    projectTeam: ['client-admin'],
    roleByUid: roles({ 'client-admin': 'client_admin' }),
    actorId: 'client-admin',
    fallbackAdminIds: ['owner-1', 'admin-1'],
  });
  assert.deepEqual(recipients, ['owner-1', 'admin-1']);
});

test('a staffed space never reaches for the fallback', () => {
  const recipients = incidentAnnouncementRecipients({
    projectTeam: ['agent-1'],
    roleByUid: roles({ 'agent-1': 'member' }),
    actorId: 'client-member',
    fallbackAdminIds: ['owner-1'],
  });
  assert.deepEqual(recipients, ['agent-1']);
});

test('the bell names the customer before the subject', () => {
  assert.equal(
    incidentAnnouncementTitle({ projectName: 'ACME', issueKey: 'ACME-12' }),
    'ACME-12: нове звернення від «ACME»',
  );
  assert.equal(incidentAnnouncementTitle({}), 'Нове звернення');
});

// A browser must not be able to say this happened. `/api/notifications` accepts
// only the requestable types, so keeping `incident_created` out of that list is
// what makes the create route the sole author of the event.
test('incident_created is a system type no browser may request', async () => {
  assert.ok(SYSTEM_NOTIFICATION_TYPES.includes('incident_created'));
  assert.ok(!REQUESTABLE_NOTIFICATION_TYPES.includes('incident_created'));
  const route = await read('../src/app/api/notifications/route.js');
  assert.match(route, /const ALLOWED_TYPES = new Set\(REQUESTABLE_NOTIFICATION_TYPES\)/);
});

// Internal staff have no notification preferences panel any more, so this type
// deliberately has no switch: it records in the bell for everyone and never
// emails, which is what a keyless type does.
test('the announcement always reaches the bell and never the mailbox', () => {
  assert.equal(shouldDeliver({}, 'inapp', 'incident_created'), true);
  assert.equal(shouldDeliver({ emailEnabled: true }, 'email', 'incident_created'), false);
});

// The card goes to the request itself, not to a conversation on it, so it is
// named for the record — and the bell draws it with its own mark. Missing from
// either map it fell back to `assigned`: the one event the desk waits for wore
// the icon and the wording of a different one.
test('the bell names and draws the arrival as its own event', async () => {
  const { notificationOpenLabel } = await import('../src/lib/utils/notificationNavigation.mjs');
  assert.equal(
    notificationOpenLabel({ type: 'incident_created' }, { record: 'звернення' }),
    'Відкрити звернення',
  );
  const header = await read('../src/components/WorkspaceHeader.jsx');
  assert.match(header, /incident_created: \{ icon: Inbox/);
});

// The recipients are the tenant's internal staff, and the customer's browser is
// exactly the place that may not enumerate them — so the event is emitted by the
// create route, not by the composer that posted to it.
test('the announcement is sent by the server that wrote the request', async () => {
  const route = await read('../src/app/api/issues/route.js');
  assert.match(route, /announceIncidentCreated\(\{/);
  assert.match(route, /projectTeam: Array\.isArray\(projectData\.team\) \? projectData\.team : \[\]/);
  // Best-effort, like the reminder rows beside it: a request that was written
  // must not report failure because a notification did not go out.
  assert.match(route, /announceIncidentCreated\([\s\S]{0,600}\}\)\.catch\(/);

  const composer = await read('../src/lib/hooks/useIssues.js');
  assert.doesNotMatch(composer, /incident_created/, 'the browser does not announce this');
});
