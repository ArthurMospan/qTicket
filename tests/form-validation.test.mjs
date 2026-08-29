import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../src', import.meta.url));
import { INCIDENT_TERMS_TABLE } from '../src/lib/content/incidentTerms.mjs';

const read = file => readFile(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(jsx?|mjs)$/.test(entry.name) ? [full] : [];
  }));
  return files.flat();
}

// One convention for a missing required field, everywhere.
//
// It used to be three. Create Task disabled its submit button, which says "you
// cannot do this" and never says why. The calendar dialog put `required` on the
// input and let the browser answer with "Please fill out this field" — English,
// unstyled, and positioned nowhere near the rest of the product's messages. Only
// the project dialog printed a real message under the field. That one won.
test('no form asks the browser to report a missing field', async () => {
  const files = (await sourceFiles(root)).filter(file => !file.includes(`${path.sep}api${path.sep}`));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    // `required` as a bare JSX attribute on a control. `Label`/`FormGroup` take
    // a `required` prop too, and those are the ones that print the hint.
    for (const match of source.matchAll(/<(Input|Textarea|input|textarea|select)\b[^>]*?\brequired\b/gs)) {
      offenders.push(`${path.relative(root, file)}: ${match[0].slice(0, 60).replace(/\s+/g, ' ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('a create dialog reports the missing field instead of disabling its submit', async () => {
  const modal = await read('../src/components/CreateTaskModal.jsx');

  // The button is only unavailable for a reason the reader cannot fix by
  // typing — here, an organization with no creatable issue types at all.
  assert.match(modal, /disabled=\{!clientMode && creatableTypes\.length === 0\}/);
  assert.doesNotMatch(modal, /disabled=\{!form\.title\.trim\(\)/);
  // The subject's label and its missing-field message come from the one table
  // that spells the record. There is no second branch to fall into: the
  // composer had a role-picked wording and that is exactly how a second name
  // for the record survived three sweeps.
  assert.match(modal, /nextErrors\.title = terms\.composerSubjectRequired;/);
  assert.match(modal, /<FormGroup label=\{terms\.composerSubjectLabel\} required error=\{fieldErrors\.title\}/);
  assert.doesNotMatch(modal, /incidentComposer/);
  assert.match(INCIDENT_TERMS_TABLE.composerSubjectRequired, /^Вкажіть тему /);
  assert.match(INCIDENT_TERMS_TABLE.composerSubjectLabel, /^Тема /);
});

test('every dialog that requires a name says so in the same place', async () => {
  const cases = [
  ];
  for (const [file, message, formId] of cases) {
    const source = await read(file);
    assert.match(source, message, file);
    // `noValidate` is what stops the native bubble from pre-empting it.
    assert.match(source, new RegExp(`id="${formId}" noValidate`), file);
    assert.match(source, /<FormGroup[^>]*required[^>]*error=\{/s, file);
  }
});

test('the invite dialog lets you press the button and tells you what is missing', async () => {
  const dialog = await read('../src/components/InviteMemberDialog.jsx');
  assert.match(dialog, /setEmailError\('Вкажіть email учасника'\)/);
  assert.doesNotMatch(dialog, /disabled=\{!email\.trim\(\)/);
  assert.match(dialog, /clientInvite \? 'Email співробітника' : 'Email адміністратора клієнта'/);
});
