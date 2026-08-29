// The record has one name, and this is the test that keeps it that way.
//
// qTicket was built by copying a task manager, and for three releases in a row
// the vocabulary came back: the queue said «інцидент», the settings said
// «Статуси інцидентів», a toast said «Завдання не знайдено», a legacy type
// called itself «Епік», and a customer's support space was a «проєкт» — which,
// to a customer, is somebody's portfolio. Each time the owner found it, not us,
// because a sweep is a one-time act and a vocabulary is a habit.
//
// So the rule is asserted rather than remembered. Every user-visible string in
// `src/` is read out of the source and checked against the stems in
// `incidentTerms.mjs`. The record is «звернення»; a support space belongs to a
// «клієнт».
//
// It reads *strings*, not source text: the check is on string literals, template
// chunks and JSX text, which is where copy lives. Comments are not scanned —
// `issues`, `CreateTaskModal` and `projectId` are the engine's names and stay,
// and a comment discussing the data model may say so. An identifier is not copy
// either, and neither is a `className`; none of them can hold a Cyrillic stem
// anyway, which is why this check can be this blunt and still be quiet.
//
// A failure names the file, the line and the string. That is deliberate: the
// next person to trip it should be able to fix it without reading this file.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { copyStrings, walkSources as walk } from './copy-strings.mjs';

import {
  CLIENT_SPACE_WRONG_NAMES,
  INCIDENT_TERMS_TABLE,
  RECORD_WRONG_NAMES,
  TASK_MANAGER_WORDS,
  incidentTerms,
} from '../src/lib/content/incidentTerms.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = join(ROOT, 'src');

// Three exemptions. Two are data rather than copy; the third is the one place
// where these words are the right ones.
//
// Keep this list short. An entry is a claim that a person never reads the
// string — or, for the third kind, that what they read is not qTicket's record
// at all — and the only way those claims stay true is if there are few enough
// of them to check by eye.
const ALLOWED = [
  {
    file: 'src/lib/content/incidentTerms.mjs',
    reason: 'The list of forbidden stems is written here, in this file.',
    strings: null, // the whole file
  },
  {
    file: 'src/lib/utils/workflowDefaults.mjs',
    reason:
      'Labels the inherited engine already wrote into Firestore, matched by '
      + 'value so they can be replaced with the product’s own words. These are '
      + 'read from the database, never rendered — what a person sees is the '
      + 'string on the other side of the colon.',
    strings: ['Беклог', 'Задача'],
  },
  {
    files: [
      'src/app/api/integrations/quickteam/projects/route.js',
      'src/app/api/issues/[issueId]/quickteam-task/route.js',
      'src/components/workspace/IssueDetail.jsx',
      'src/components/workspace/QuickTeamTransferDialog.jsx',
      'src/lib/utils/issueAuditEvents.mjs',
    ],
    reason:
      'The transfer to QuickTeam, and only it. In QuickTeam a «завдання» really '
      + 'is a завдання and a «проєкт» really is a проєкт — those are that '
      + 'product’s own words for its own records, and calling them «звернення» '
      + 'here would describe something QuickTeam does not have. The exemption is '
      + 'narrow by construction: the string must name QuickTeam, so it cannot '
      + 'quietly cover a sentence about a qTicket record.',
    mentions: 'QuickTeam',
  },
];

const posix = file => relative(ROOT, file).split(sep).join('/');

function allowance(file, value) {
  return ALLOWED.find(entry => {
    const named = entry.files ? entry.files.includes(file) : entry.file === file;
    if (!named) return false;
    if (entry.mentions) return String(value).includes(entry.mentions);
    return entry.strings === null || entry.strings.includes(value);
  });
}

function offences(words) {
  const problems = [];
  for (const file of walk(SRC)) {
    const relativeFile = posix(file);
    for (const { value, line } of copyStrings(file)) {
      const haystack = String(value).toLocaleLowerCase('uk-UA');
      const hit = words.find(word => haystack.includes(word));
      if (!hit) continue;
      if (allowance(relativeFile, value)) continue;
      problems.push(`${relativeFile}:${line} «${hit}» in ${JSON.stringify(value.trim().slice(0, 120))}`);
    }
  }
  return problems;
}

test('nothing a person reads calls the record anything but «звернення»', () => {
  const problems = offences(RECORD_WRONG_NAMES);
  assert.deepEqual(
    problems,
    [],
    `The record is «звернення». Rewrite the sentence — Ukrainian declines, so this `
    + `is not a replace: «інциденту» → «звернення», «інциденті» → «зверненні», `
    + `«інцидентів» → «звернень», and «звернення» is neuter, so «дочірній» becomes `
    + `«дочірнє».\n\n${problems.join('\n')}`,
  );
});

test('a support space is named by whose it is, never «проєкт»', () => {
  const problems = offences(CLIENT_SPACE_WRONG_NAMES);
  assert.deepEqual(
    problems,
    [],
    `To a customer «проєкт» is somebody's portfolio; this is their support space. `
    + `On a staff screen the thing being named is the «клієнт», over one of them `
    + `it is «клієнтський простір». The collection stays \`projects\` and the field `
    + `stays \`projectId\` — only the sentence changes.\n\n${problems.join('\n')}`,
  );
});

test('the whitelist is three entries long and all of them say why', () => {
  // The exemptions are the part of this test that can rot. A list nobody looks
  // at grows one honest-looking line at a time until the rule it protects is
  // gone, so the size of it is asserted as well as its contents.
  assert.equal(ALLOWED.length, 3);
  const files = walk(SRC).map(posix);
  for (const entry of ALLOWED) {
    const named = entry.files || [entry.file];
    assert.ok(entry.reason.length >= 40, `${named.join(', ')} needs a reason, not a note`);
    for (const file of named) {
      assert.ok(files.includes(file), `${file} is whitelisted but does not exist`);
    }
  }
  // The QuickTeam exemption is only ever as wide as the word it requires. An
  // entry that stopped naming the other product would exempt whole files.
  const quickTeam = ALLOWED.find(entry => entry.mentions);
  assert.equal(quickTeam.mentions, 'QuickTeam');
  assert.equal(quickTeam.strings, undefined);
});

test('the one table spells the record, and spells it one way', () => {
  // Item four of the rule: whatever this file exports is «звернення». It held
  // two vocabularies picked by role once, and a table with a `staff` half and a
  // `client` half is a product with two names whether or not they differ today.
  for (const [key, value] of Object.entries(INCIDENT_TERMS_TABLE)) {
    assert.match(value, /[Зз]верненн/, `INCIDENT_TERMS_TABLE.${key} does not name the record`);
    const haystack = value.toLocaleLowerCase('uk-UA');
    const hit = TASK_MANAGER_WORDS.find(word => haystack.includes(word));
    assert.equal(hit, undefined, `INCIDENT_TERMS_TABLE.${key} says «${hit}»`);
  }
  // And there is nothing to ask it. A reader of `incidentTerms(role)` is one
  // `if` away from a second vocabulary, so the accessor takes no argument.
  assert.equal(incidentTerms(), INCIDENT_TERMS_TABLE);
  assert.equal(incidentTerms.length, 0);
});

test('the stems are stems, so a declined form cannot slip past', () => {
  // Every one of these is a real form that shipped in this product.
  const declined = [
    'Не вдалося завантажити інциденти',
    'Статуси інцидентів',
    'Нове у зверненні, а не в інциденті',
    'переміщено завдань: 4',
    'Забагато задач',
    'Епік (legacy)',
    'Додати існуюче завдання у спринт',
    'Беклог',
    'у проєкті ACME',
    'клієнтські проекти',
  ];
  for (const phrase of declined) {
    const haystack = phrase.toLocaleLowerCase('uk-UA');
    assert.ok(
      TASK_MANAGER_WORDS.some(word => haystack.includes(word)),
      `${phrase} should be caught by a stem`,
    );
  }
});
