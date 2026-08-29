// A client must never be shown a «завдання».
//
// `tests/product-terminology.test.mjs` holds the whole of `src/` to the one
// name the record has. This file is the stricter half: an external
// `client_admin`/`client_member` opened an account to send their supplier a
// problem, so «виконавець» and «трекер» describe a product they did not buy
// even though support may still say them among themselves.
//
// The two tests overlap on purpose. The product-wide one reads every string in
// the source; this one drives the actual functions a client's screens call, so
// a word that appears only when a catalogue is filtered by role, a palette is
// built for `client_admin` or a tab title falls back still has to answer for
// itself.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  CLIENT_FORBIDDEN_WORDS,
  INCIDENT_TERMS_TABLE,
  incidentTerms,
} from '../src/lib/content/incidentTerms.mjs';
import { HELP_ARTICLES, helpArticlesForRole } from '../src/lib/content/helpArticles.mjs';
import { buildCommands, issueCommands } from '../src/lib/utils/commandPalette.mjs';
import { routeTitle, workspaceDocumentTitle } from '../src/lib/utils/documentTitle.mjs';
import { notificationOpenLabel } from '../src/lib/utils/notificationNavigation.mjs';
import { notificationCountTitle } from '../src/lib/utils/notificationGrouping.mjs';

const lower = value => String(value || '').toLocaleLowerCase('uk-UA');

function taskManagerWordsIn(text) {
  const haystack = lower(text);
  return CLIENT_FORBIDDEN_WORDS.filter(word => haystack.includes(word));
}

function assertClean(text, what) {
  const found = taskManagerWordsIn(text);
  assert.deepEqual(found, [], `${what} still says ${found.join(', ')}`);
}

test('the vocabulary the product speaks carries none of the task manager', () => {
  for (const [key, value] of Object.entries(INCIDENT_TERMS_TABLE)) {
    assertClean(value, `INCIDENT_TERMS_TABLE.${key}`);
  }
  // There is one table and no way to ask for another. The file used to export a
  // `staff` half and a `client` half, and asserting only the client half clean
  // is precisely how «Опис інциденту» stayed correct on a screen both of them
  // open.
  assert.equal(incidentTerms(), INCIDENT_TERMS_TABLE);
  assert.equal(incidentTerms.length, 0);
});

test('the screen a client lands on is the screen support opens', async () => {
  // There is no client-only file to scan any more, and that is the point: the
  // words a client reads come out of `INCIDENT_TERMS_TABLE` above, on the same
  // component support renders. What is asserted here is that the shared screen
  // names the record with the shared word and does not fall back to a second
  // one of its own.
  const board = await readFile(
    new URL('../src/app/(app)/[projectId]/ProjectBoardClient.jsx', import.meta.url),
    'utf8',
  );
  assert.match(board, /INCIDENT_TERMS_TABLE\.composerSubmit/);
  assert.match(board, /INCIDENT_TERMS_TABLE\.created/);
  // The composer is the client's action, and it is the client's form — but not
  // its own vocabulary: the `entity` prop that used to pick between a
  // «звернення» and a «завдання» is gone, and only one wording was ever
  // rendered anyway.
  assert.match(board, /canOpenIncident = clientViewer/);
  assert.match(board, /clientMode/);
  assert.doesNotMatch(board, /entity=/);
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
  const record = INCIDENT_TERMS_TABLE.record.toLocaleLowerCase('uk-UA');
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
  // The catalogue is filtered by role (`helpArticlesForRole`), and the articles
  // a client reaches are asserted below in their own right. This still reads the
  // whole catalogue: the support team's word for the record is the client's word
  // for it, so a task-manager word is wrong in a staff article too — and an
  // article moved down to `client_member` must not be able to carry one in.
  for (const article of HELP_ARTICLES) {
    assertClean(JSON.stringify(article), `help article ${article.id}`);
  }
  for (const article of helpArticlesForRole('client_member')) {
    assertClean(JSON.stringify(article), `client-readable help article ${article.id}`);
  }
});
