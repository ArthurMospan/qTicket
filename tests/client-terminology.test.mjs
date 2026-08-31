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
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyStrings, walkSources } from './copy-strings.mjs';
import {
  CLIENT_FORBIDDEN_WORDS,
  CLIENT_ONLY_FORBIDDEN_WORDS,
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
  const sentencesOf = article => {
    const out = [];
    const walk = value => {
      if (typeof value === 'string') out.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(article);
    return out;
  };
  for (const article of HELP_ARTICLES) {
    for (const sentence of sentencesOf(article)) {
      // A sentence that names QuickTeam is describing QuickTeam's records,
      // where a «завдання» really is a завдання — the staff article about
      // transferring a request has to name the button people click. The
      // exemption is sentence-wide and word-narrow, and it stops at the client
      // catalogue below: a customer's manual naming their supplier's internal
      // tracker is a leak whatever word it uses.
      if (sentence.includes('QuickTeam')) continue;
      assertClean(sentence, `help article ${article.id}`);
    }
  }
  for (const article of helpArticlesForRole('client_member')) {
    assertClean(JSON.stringify(article), `client-readable help article ${article.id}`);
  }
});

// ── The screens themselves, read whole ──────────────────────────────────────
//
// Everything above drives a function and reads what it gives back. That is how
// a catalogue filtered by role, a palette built for `client_admin` and a tab
// title that falls back are held to the rule — and every one of them passed
// while `aria-label="Виконавці звернення"` sat in the incident screen the
// client opens. No function returned it. It was markup, on a control behind
// `!clientViewer`, in a file the client's browser renders.
//
// So the last check is asked file by file, and bluntly: nothing the client
// renders may contain «виконавець» or «трекер» in a string at all — not in the
// branch they read, not in the branch they do not. A word kept one condition
// away from the person it is hidden from is a word this product has already
// leaked twice by moving the condition.
//
// `src/app/(app)` and `src/components` are taken whole, because that is the
// shape of the product: one authenticated workspace, drawing one set of screens
// for two audiences. A file there is the client's file until it proves
// otherwise, and the proof is turning them away — see STAFF_ONLY, whose claim
// this test verifies rather than believes.
//
// Two things it deliberately does not reach. `src/lib` is not scanned: a string
// there is a value some screen may or may not render, and the tests above are
// how those get asked. `src/app/ui-kit` is not scanned either — the catalogue
// is a component reference for the people who build the product, and no client
// has a route to it.

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CLIENT_TREES = ['src/app/(app)', 'src/components'];
const posix = file => relative(ROOT, file).split(sep).join('/');

// A screen support keeps to itself. «Виконавець» is support's own word for a
// seat a client cannot hold, and it is legal here — but only because a client
// who pastes the address is sent home before the screen paints, which is the
// line asserted below. An entry without that line is a claim, not an exemption.
//
// `/overview` was on this list and has come off it. It is one screen that knows
// who is looking now — a client lands there from `/` and reads their own three
// tiles — so it is the client's file, and the word for support's seat had to go
// with the exemption. It says «Без відповідального», which is what the picker,
// the composer and the bulk bar already say.
const STAFF_ONLY = [
  {
    file: 'src/app/(app)/my/page.js',
    reason: 'The cross-client support queue. A client has one space and no queue across them.',
  },
];

test('no screen a client renders carries support’s word for a seat', () => {
  const staffOnly = new Set(STAFF_ONLY.map(entry => entry.file));
  const problems = [];

  for (const tree of CLIENT_TREES) {
    for (const file of walkSources(join(ROOT, tree))) {
      const relativeFile = posix(file);
      if (staffOnly.has(relativeFile)) continue;
      for (const { value, line } of copyStrings(file)) {
        const haystack = String(value).toLocaleLowerCase('uk-UA');
        const hit = CLIENT_ONLY_FORBIDDEN_WORDS.find(word => haystack.includes(word));
        if (!hit) continue;
        problems.push(`${relativeFile}:${line} «${hit}» in ${JSON.stringify(value.trim().slice(0, 120))}`);
      }
    }
  }

  assert.deepEqual(
    problems,
    [],
    'A client opened an account to send their supplier a problem. Who answers it '
    + 'is our routing, not a fact about their request — so the control is absent '
    + 'for them, and the word goes with it. On a screen support shares with the '
    + 'client the seat is «Відповідальні», which is what the picker, the composer '
    + 'and the bulk bar already say.\n\n'
    + problems.join('\n'),
  );
});

test('a screen claiming to be support-only sends a client away before it paints', () => {
  // The exemption list is the part of the check that can rot, so it is not
  // taken on trust: a staff screen earns its entry by redirecting, and by
  // rendering nothing at all while the redirect is in flight. Both lines are
  // the ones `/my` actually carries.
  assert.equal(STAFF_ONLY.length, 1);
  for (const entry of STAFF_ONLY) {
    const source = readFileSync(join(ROOT, entry.file), 'utf8');
    assert.ok(entry.reason.length >= 40, `${entry.file} needs a reason, not a note`);
    assert.match(
      source,
      /if \(orgRole && clientViewer\) router\.replace\('\/'\);/,
      `${entry.file} is exempt from the client vocabulary but does not send a client home`,
    );
    assert.match(
      source,
      /if \(clientViewer\) return null;/,
      `${entry.file} redirects a client but still paints while the redirect is in flight`,
    );
  }
});
