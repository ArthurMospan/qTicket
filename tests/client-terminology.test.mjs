// A client must never be shown a «завдання».
//
// qTicket keeps its inherited task engine — `issues`, `CreateTaskModal`,
// `TaskRow` — and that is deliberate. What is not allowed to leak is the
// vocabulary: an external `client_admin`/`client_member` opened an account to
// send their supplier a problem, and «завдання», «спринт», «виконавець» or
// «проєкт» on their screen describes a product they did not buy.
//
// A one-time sweep of the screens is worth one release. These assertions are
// worth every release after it: they read the client-facing copy the product
// actually ships and fail on the first task-manager word that comes back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  INCIDENT_TERMS,
  TASK_MANAGER_WORDS,
  incidentTerms,
} from '../src/lib/content/incidentTerms.mjs';
import { HELP_ARTICLES } from '../src/lib/content/helpArticles.mjs';
import { buildCommands, issueCommands } from '../src/lib/utils/commandPalette.mjs';
import { routeTitle, workspaceDocumentTitle } from '../src/lib/utils/documentTitle.mjs';
import { notificationOpenLabel } from '../src/lib/utils/notificationNavigation.mjs';
import { notificationCountTitle } from '../src/lib/utils/notificationGrouping.mjs';

const lower = value => String(value || '').toLocaleLowerCase('uk-UA');

function taskManagerWordsIn(text) {
  const haystack = lower(text);
  return TASK_MANAGER_WORDS.filter(word => haystack.includes(word));
}

function assertClean(text, what) {
  const found = taskManagerWordsIn(text);
  assert.deepEqual(found, [], `${what} still says ${found.join(', ')}`);
}

test('the client half of the vocabulary carries none of the task manager', () => {
  for (const [key, value] of Object.entries(INCIDENT_TERMS.client)) {
    assertClean(value, `INCIDENT_TERMS.client.${key}`);
  }
  // The staff half is deliberately not asserted clean — «інцидент» is support's
  // word and «Опис інциденту» is a correct staff string. What must hold is that
  // the two speak about the same things, because a shared screen picks one of
  // them by role and a key missing on one side is a silent fall-through.
  assert.deepEqual(
    Object.keys(INCIDENT_TERMS.client).toSorted(),
    Object.keys(INCIDENT_TERMS.staff).toSorted(),
  );
  assert.equal(incidentTerms(true), INCIDENT_TERMS.client);
  assert.equal(incidentTerms(false), INCIDENT_TERMS.staff);
  assert.equal(incidentTerms(), INCIDENT_TERMS.staff);
});

test('the client portal file speaks only the client vocabulary', async () => {
  // The whole file, comments included: nothing in it is read by support, so a
  // task-manager word here is either shipped copy or a note that will become
  // shipped copy the next time somebody edits the line under it.
  const portal = await readFile(
    new URL('../src/components/client/ClientIncidentPortal.jsx', import.meta.url),
    'utf8',
  );
  assertClean(portal, 'ClientIncidentPortal.jsx');
  // And it is the client's own word, not support's: the portal is «Мої
  // звернення», so what it offers to create is a «звернення».
  assert.match(portal, /Мої звернення/);
  assert.doesNotMatch(portal, /інцидент/i);
});

test('the Ctrl+K palette a client opens offers nothing from a task manager', () => {
  const commands = buildCommands({
    projects: [{ id: 'acme', name: 'ACME', issuePrefix: 'ACME' }],
    allowedPermissions: ['create:issue'],
    organizationCount: 2,
    role: 'client_admin',
  });
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assertClean(`${command.label} ${command.hint || ''}`, `palette command ${command.id}`);
  }
  // The record is named the same way it is named on the portal behind it.
  const create = commands.find(command => command.id === 'action-new-issue');
  assert.match(create.label, /звернення/i);
  // Search results carry a title from the database; only the fallback is ours.
  for (const command of issueCommands([{ id: 'i1', projectId: 'acme' }], [])) {
    assertClean(command.label, 'issue command fallback');
  }
});

test('a client tab never reads as somebody else’s project', () => {
  assert.equal(routeTitle('/', [], { clientPortal: true }), 'Мої звернення');
  // Their one deep route is their own incident. Before the spaces resolve there
  // is no name for it, and the fallback used to be «Проєкт».
  assertClean(routeTitle('/acme/issue/i1', [], { clientPortal: true }), 'client deep-route title');
  assertClean(
    workspaceDocumentTitle({ pathname: '/acme/issue/i1', clientPortal: true }),
    'client document title',
  );
});

test('the notification centre names the record in the reader’s own word', () => {
  const record = INCIDENT_TERMS.client.record.toLocaleLowerCase('uk-UA');
  for (const type of ['commented', 'mentioned', 'status_changed', 'assigned', 'deadline']) {
    assertClean(
      notificationOpenLabel({ type, issueId: 'i1' }, { record }),
      `open label for ${type}`,
    );
  }
  assert.equal(
    notificationOpenLabel({ type: 'status_changed', issueId: 'i1' }, { record }),
    'Відкрити звернення',
  );
  // A collapsed row falls back to naming the conversation, never the record:
  // the same row is drawn for support and for the client.
  assertClean(notificationCountTitle(3, {}, 'issue:i1'), 'collapsed notification row');
  assertClean(notificationCountTitle(3, {}, 'chat:design'), 'collapsed chat row');
});

test('every published help article is safe to hand a client', () => {
  // `HELP_ARTICLES` has no audience filter and the help button sits in the rail
  // for every role, so the published catalogue *is* client-facing copy.
  for (const article of HELP_ARTICLES) {
    assertClean(JSON.stringify(article), `help article ${article.id}`);
  }
});
