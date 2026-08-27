// src/lib/utils/issueCancel.mjs
// Cancelling a task — the third thing that can be done with one, and the only
// one that takes it out of the record as well as out of the way.
//
// The three are deliberately different answers to three different situations:
//
//   Архівувати — the work happened and is over. `archivedAt`, reversible, no
//     expiry. Out of the boards, lists, my tasks and sprints; still in the
//     timesheet, still on the invoice, still in the numbers for the period it
//     was worked in. Putting a finished task away must never change what a
//     month reports, or an archive becomes a thing nobody dares to use.
//
//   Скасувати — the work is not going to happen. `cancelledAt`, reversible, no
//     expiry. Out of everything: boards, lists, progress, workload, velocity,
//     billing, deadlines, search. It is not counted as delivered, it is not
//     counted as dropped either — it stops being one of the tasks the numbers
//     are about at all. That is the whole point: a plan that changed should not
//     leave a dent in the shape of the work that was never done.
//
//   Видалити — the task should not exist. The tombstone in `issueTrash.mjs`,
//     with a 24-hour clock and a purge at the end of it.
//
// Cancelling used to be a status category, and that is exactly what it could not
// do: a status puts a task in a column, and a task in a column is still one of
// the tasks. Every report then had to remember to subtract it, and "closed but
// not delivered" had to be threaded through every count that had ever been
// written. One field on the task removes the whole class of mistake — a
// cancelled task never reaches the reader that would have had to remember.
//
// Filtering happens where the streams are read, not in the queries, for the same
// reason the archive does: every issue stream is already scoped to a project and
// read in full, so a `where` clause would buy an index and a backfill and save
// nothing.

export function isCancelledIssue(issue) {
  return Boolean(issue?.cancelledAt);
}

/**
 * Everything that is still one of the tasks. Applied at every source that
 * publishes issues, so that no reader downstream — a board, a chart, an
 * invoice — has to know that cancelling exists.
 */
export function withoutCancelledIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter(issue => !isCancelledIssue(issue));
}

/** What «Архів» → «Скасовані» shows. */
export function cancelledIssuesOf(issues) {
  return (Array.isArray(issues) ? issues : []).filter(isCancelledIssue);
}

/**
 * Fields only the cancel route may write, refused to browser writes in
 * `firestore.rules` exactly like the archive's. A task that can take itself out
 * of every report by setting its own field is a hole in the accounting, not a
 * convenience.
 */
export const CANCEL_FIELDS = Object.freeze(['cancelledAt', 'cancelledBy']);
