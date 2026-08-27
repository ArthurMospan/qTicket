import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  ARCHIVED_IMPORT_FIELDS,
  CARRIED_IMPORT_FIELDS,
  ISSUE_IMPORT_COLLECTION,
  ISSUE_IMPORT_DOCUMENT,
  hasUnmovedImportBulk,
  splitIssueImportRecord,
} from '../src/lib/utils/issueImportRecord.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// What a task document costs to deliver.
//
// The workspace subscribes to every task of every project a person can open, so
// a field on a task is a field every board, every list and «Мої завдання» pays
// for — whether or not anything draws it. Measured on production 27.08.2026:
// `importMetadata` was the heaviest field in the collection, heavier than every
// description put together, and the product reads three sub-fields of it.
//
// These tests are the fence around that split. The failure they exist to catch
// is a screen quietly starting to read something that has moved out from under
// it — so the carried list is asserted against the code that reads it, not
// against itself.

const record = {
  provider: 'youtrack',
  connectionId: 'conn-1',
  externalId: '3-4567',
  externalReadableId: 'QT-42',
  sourceProjectId: '0-1',
  sourceProjectKey: 'QT',
  sourceUrl: 'https://example.youtrack.cloud/issue/QT-42',
  externalReporter: { id: 'yt:9', name: 'Somebody Outside', external: true },
  externalAssignees: [{ id: 'yt:10', name: 'Another', external: true }],
  externalWatchers: [],
  tags: ['regression', 'customer'],
  customFields: [{ name: 'Severity', value: 'Major' }, { name: 'Board', value: 'Sprint 12' }],
  adapterVersion: 2,
  mappingVersion: 4,
};

test('the task keeps what is read and what identifies the import', () => {
  const { carried } = splitIssueImportRecord(record);
  assert.deepEqual(Object.keys(carried).sort(), [
    'adapterVersion',
    'connectionId',
    'externalId',
    'externalReadableId',
    'mappingVersion',
    'provider',
    'sourceProjectId',
    'sourceProjectKey',
    'sourceUrl',
  ]);
  // Nothing heavy survives on the task.
  for (const field of ARCHIVED_IMPORT_FIELDS) {
    assert.equal(carried[field], undefined, `${field} must not stay on the task document`);
  }
});

test('the bulk moves whole, and only the bulk', () => {
  const { archived } = splitIssueImportRecord(record);
  assert.deepEqual(Object.keys(archived).sort(), [...ARCHIVED_IMPORT_FIELDS].sort());
  assert.deepEqual(archived.customFields, record.customFields);
  assert.deepEqual(archived.tags, record.tags);
  // And the two halves do not overlap: a field is on the task or in the
  // subcollection, never in both, or a reader would have two answers.
  const carried = new Set(CARRIED_IMPORT_FIELDS);
  assert.equal(ARCHIVED_IMPORT_FIELDS.some(field => carried.has(field)), false);
});

test('a task with nothing worth archiving gets no document', () => {
  assert.equal(splitIssueImportRecord(null).hasArchive, false);
  assert.equal(splitIssueImportRecord({}).hasArchive, false);
  assert.equal(splitIssueImportRecord({ provider: 'youtrack' }).hasArchive, false);
  // An empty list of external watchers is not a record.
  assert.equal(
    splitIssueImportRecord({ externalWatchers: [], externalAssignees: [] }).hasArchive,
    false,
  );
  assert.equal(splitIssueImportRecord({ tags: ['x'] }).hasArchive, true);
  assert.equal(splitIssueImportRecord(record).hasArchive, true);
});

test('an already-migrated task is not migrated again', () => {
  const { carried } = splitIssueImportRecord(record);
  assert.equal(hasUnmovedImportBulk({ importMetadata: record }), true);
  assert.equal(hasUnmovedImportBulk({ importMetadata: carried }), false);
  assert.equal(hasUnmovedImportBulk({}), false);
});

test('everything the product reads is a field the task still carries', async () => {
  const [issueDetail, completionDates] = await Promise.all([
    read('src/components/workspace/IssueDetail.jsx'),
    read('src/lib/utils/completionDates.mjs'),
  ]);
  const carried = new Set(CARRIED_IMPORT_FIELDS);
  for (const source of [issueDetail, completionDates]) {
    for (const [, field] of source.matchAll(/importMetadata\?\.(\w+)/g)) {
      assert.ok(
        carried.has(field),
        `importMetadata.${field} is read from a task document but no longer lives on one`,
      );
    }
  }
  // The two the product actually reads today, named so that removing either
  // from the carried list is a failing test rather than a blank link.
  assert.ok(carried.has('sourceUrl'));
  assert.ok(carried.has('provider'));
});

test('the importer writes the split, both on a fresh import and on a re-import', async () => {
  const importer = await read('src/lib/server/youtrackImporter.js');
  assert.match(importer, /const importRecord = splitIssueImportRecord\(importedFields\.importMetadata\)/);
  assert.match(importer, /importedFields\.importMetadata = importRecord\.carried/);
  // Two write sites — the task that already existed and the one being created.
  assert.equal(
    (importer.match(/importRecord\.hasArchive/g) || []).length,
    2,
    'a re-import and a fresh import both have to write the archive',
  );
  assert.equal(
    (importer.match(/\.collection\(ISSUE_IMPORT_COLLECTION\)\.doc\(ISSUE_IMPORT_DOCUMENT\)/g) || []).length,
    2,
  );
  // Written whole rather than merged: a custom field deleted in YouTrack must
  // not survive here because an older import mentioned it.
  assert.doesNotMatch(
    importer,
    /doc\(ISSUE_IMPORT_DOCUMENT\),[\s\S]{0,200}\{ merge: true \}/,
  );
});

test('no browser can read the archive, because no rule describes it', async () => {
  const rules = await read('firestore.rules');
  const issueBlock = rules.slice(rules.indexOf('match /issues/{issueId}'));
  const nested = [...issueBlock.slice(0, 4_000).matchAll(/match \/(\w+)\//g)].map(match => match[1]);
  assert.equal(
    nested.includes(ISSUE_IMPORT_COLLECTION),
    false,
    'the import archive is closed the way errorReports is: Firestore denies what no rule allows',
  );
  // And there is no recursive wildcard under a task that would let one in.
  assert.doesNotMatch(issueBlock.slice(0, 4_000), /match \/\{document=\*\*\}/);
});

test('the migration copies before it clears, and says so when there is nothing left', async () => {
  const script = await read('scripts/trim-issue-import-metadata.mjs');
  // The conventions of docs/MIGRATIONS.md: dry run by default, an explicit
  // project, and an exact confirmation before anything is written.
  assert.match(script, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(script, /Потрібен явний `--project/);
  assert.match(script, /CONFIRMED_PROJECT_ID !== FIREBASE_PROJECT_ID/);
  // One batch carries both halves, so there is no instant at which the record
  // exists nowhere. The copy is written first inside it.
  const applyBlock = script.slice(script.indexOf('if (APPLY) {'), script.indexOf('const kib ='));
  assert.ok(
    applyBlock.indexOf('batch.set(') < applyBlock.indexOf('batch.update('),
    'the copy must be written before the fields are cleared',
  );
  assert.match(applyBlock, /FieldValue\.delete\(\)/);
  // And a re-run reporting nothing is how the migration is declared finished.
  assert.match(script, /Нічого рухати\. Міграція завершена\./);
});
