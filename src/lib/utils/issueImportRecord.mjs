// What an imported task carries about where it came from, and where each half
// of it lives.
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// Measured on production, 27.08.2026: 720 tasks, 2 729 KiB of task documents,
// 672 of them imported from YouTrack. `importMetadata` was 840 KiB of that —
// the single heaviest field in the collection, heavier than every description
// put together — and the product read 40 KiB of it. Three sub-fields. The other
// 800 KiB, 29% of the whole corpus, was delivered to every browser on every
// board load and read by nothing at all:
//
//   customFields      490 KiB   17.6% of the corpus
//   externalReporter  115 KiB    4.1%
//   externalAssignees  17 KiB    0.6%
//   tags               11 KiB    0.4%
//   externalWatchers    0 KiB
//
// The workspace subscribes to every task of every project a person can open, so
// a field on a task document is a field every board, every list and «Мої
// завдання» pays for — whether or not anything draws it. The raw record of an
// import is the opposite of that: it is looked at when somebody is debugging a
// mapping, which is approximately never and never from a card.
//
// ── What this does not fix ───────────────────────────────────────────────
//
// Not a single Firestore read. Reads are billed per document and the board
// still reads the same 720 documents; this is payload, parse time and browser
// memory, not the daily cap. Say so out loud, because the cap is what the two
// outages were about and it would be easy to file this under the same heading.
//
// ── Why moved rather than deleted ────────────────────────────────────────
//
// It is data from another system. Regenerating it means re-importing, which
// needs a YouTrack that still exists and credentials that still work — so it
// goes to `issues/{issueId}/import/source`, a subcollection no Firestore rule
// describes and therefore one no browser can read at all (the same way
// `errorReports` is closed: Firestore denies everything not explicitly
// allowed). Nothing subscribes to it, so it costs nothing to keep, and deleting
// it later is one line if it turns out to be worth nothing.
//
// `description` was the field this investigation started from, and it stays
// exactly where it is: see docs/ARCHITECTURE.md → «Вартість читання».

/** The subcollection and document one task's raw import record lives at. */
export const ISSUE_IMPORT_COLLECTION = 'import';
export const ISSUE_IMPORT_DOCUMENT = 'source';

/**
 * The sub-fields that stay on the task document.
 *
 * `provider` and `sourceUrl` are read by the product — the first decides how a
 * completion date is trusted (`completionDates.mjs`), the second is the «open in
 * YouTrack» link on the task screen. `importedAt` is the first import's stamp
 * and the re-import path reads it to keep it. The rest are identity: together
 * they are under two per cent of the collection and they are what makes a task
 * document able to say where it came from without a second read.
 */
export const CARRIED_IMPORT_FIELDS = Object.freeze([
  'provider',
  'sourceUrl',
  'importedAt',
  'connectionId',
  'externalId',
  'externalReadableId',
  'sourceProjectId',
  'sourceProjectKey',
  'adapterVersion',
  'mappingVersion',
]);

/**
 * The sub-fields that move to the subcollection.
 *
 * Listed rather than derived as «everything else», deliberately: a field added
 * to the import in future is carried on the task until somebody decides it is
 * bulk, which is the safe direction to be wrong in. A new heavy field would
 * show up in the next measurement rather than silently disappearing from a
 * screen that had started reading it.
 */
export const ARCHIVED_IMPORT_FIELDS = Object.freeze([
  'customFields',
  'externalReporter',
  'externalAssignees',
  'externalWatchers',
  'tags',
]);

function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source && source[key] !== undefined) result[key] = source[key];
  }
  return result;
}

/**
 * One import record, split into the half the task carries and the half that
 * goes to the subcollection.
 *
 * @param {object|null} importMetadata the whole record as the importer built it
 * @returns {{carried: object, archived: object, hasArchive: boolean}}
 */
export function splitIssueImportRecord(importMetadata) {
  const whole = importMetadata && typeof importMetadata === 'object' ? importMetadata : {};
  const archived = pick(whole, ARCHIVED_IMPORT_FIELDS);
  // An empty array of external watchers is not a record worth a document.
  const hasArchive = Object.values(archived).some(value => (
    Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined
  ));
  return { carried: pick(whole, CARRIED_IMPORT_FIELDS), archived, hasArchive };
}

/** Whether a stored task still carries bulk the subcollection should hold. */
export function hasUnmovedImportBulk(issue) {
  return splitIssueImportRecord(issue?.importMetadata).hasArchive;
}
