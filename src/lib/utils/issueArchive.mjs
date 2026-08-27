// src/lib/utils/issueArchive.mjs
// Archiving a task, which is not the same thing as deleting it.
//
// The product used to have one action wearing two names: «Архівувати» moved the
// task into a hidden tombstone with an expiry, and the only way back was a
// banner inside the task while it was still open. That is a delete, and calling
// it an archive cost people work they thought they had put aside.
//
// Now there are two, and they mean what they say:
//
//   Архівувати — reversible, with no clock on it. The task stays a real
//     document with `archivedAt` set: out of the boards, lists, my tasks,
//     sprints and analytics, still openable by its own link, and listed under
//     «Архів» until somebody brings it back.
//
//   Видалити — the tombstone flow in `issueTrash.mjs`. It lands under
//     «Нещодавно видалене» with the time it has left, and is purged when that
//     runs out.
//
// Archived tasks are filtered on the client rather than excluded by the query.
// Every issue stream is already scoped to a project and read in full — adding
// `where('archived','==',false)` would mean an index per query and a backfill
// across every existing task, to save reads the app has already paid for.

export function isArchivedIssue(issue) {
  return Boolean(issue?.archivedAt);
}

/** The working set: what belongs on a board, a list, a report. */
export function withoutArchivedIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter(issue => !isArchivedIssue(issue));
}

/** What «Архів» shows. */
export function archivedIssuesOf(issues) {
  return (Array.isArray(issues) ? issues : []).filter(isArchivedIssue);
}

/**
 * Fields only the archive route may write. They are refused to browser writes
 * in `firestore.rules` for the same reason `status` is: the audit entry and the
 * one place that decides what archiving means must not be bypassable by a
 * client that simply sets the field itself.
 */
export const ARCHIVE_FIELDS = Object.freeze(['archivedAt', 'archivedBy']);
