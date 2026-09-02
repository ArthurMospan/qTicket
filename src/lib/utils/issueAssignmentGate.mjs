import { statusCategoryOf } from './statusCategories.mjs';
import { assigneeIdsOf } from './incidentQueueMetrics.mjs';

// When a request stops being «Новий», somebody owns it.
//
// «Без відповідального» is a number on «Огляд», a filter on the board and the
// thing a customer feels as silence — and until now nothing in the product ever
// asked for the name. A request could be accepted, worked and resolved with the
// field empty, and the only sign was a counter nobody is obliged to read.
//
// The moment to ask is the one transition that means something: leaving the
// entry category. In it, a request is a thing that arrived; out of it, it is a
// thing the desk has taken on, and a thing taken on by nobody is the state this
// gate exists to prevent. Every later move is already someone's.
//
// Three deliberate limits:
//
//   • It asks the desk, never the customer. A client role cannot set
//     `assigneeIds` at all, so gating their screen on it would be a dialog with
//     no legal answer.
//   • It fires on one request at a time. A bulk move of thirty cannot stop to
//     ask about each, and a dialog that asks once for thirty would be assigning
//     by accident.
//   • Cancelling the dialog cancels the *move*, not the assignment. «I am not
//     ready to say who» is a real answer, and the honest response to it is to
//     leave the request where it was rather than to advance it unowned.

/** The category a request in this status belongs to. */
function categoryOf(statusId, statuses) {
  return statusCategoryOf(statusId, statuses) || 'backlog';
}

/**
 * Whether this move has to name somebody first.
 *
 * Two ways to say where it is going, because the product has two boards. A
 * project's board drops a card on a *status* — its columns are the project's
 * own statuses. «Звернення» spans every project a person is on, so no two of
 * them are guaranteed to share a status and its columns are *categories*; the
 * exact status is chosen afterwards, or not at all when the category holds one.
 * The rule is about the category either way, so it takes whichever the caller
 * has.
 *
 * @param {object} options.issue The request being moved.
 * @param {string} options.toStatusId Where it is going, on a board of statuses.
 * @param {string} options.toCategoryId Where it is going, on a board of categories.
 * @param {object[]} options.statuses The project's live workflow.
 * @param {boolean} options.internalViewer Whether the person moving it may assign at all.
 * @returns {boolean} True when the desk is taking the request on and nobody is on it.
 */
export function needsAssigneeForMove({
  issue,
  toStatusId,
  toCategoryId,
  statuses = [],
  internalViewer = false,
} = {}) {
  if (!internalViewer || !issue) return false;
  const destination = toCategoryId || (toStatusId ? categoryOf(toStatusId, statuses) : '');
  if (!destination) return false;
  if (assigneeIdsOf(issue).length > 0) return false;
  const from = categoryOf(issue.columnId || issue.status, statuses);
  if (from !== 'backlog') return false;
  return destination !== 'backlog';
}

/**
 * The same question asked of a selection.
 *
 * A bulk status change was the way around this rule: select a column, move
 * thirty requests, and every one of them left «Новий» with nobody on it while
 * the identical drag one card at a time stopped and asked. A rule with a legal
 * bypass is worse than no rule — it reads as a guarantee and is not one.
 *
 * It is still one question, not thirty: the dialog names how many requests the
 * answer will be written to, and the rest of the selection is untouched.
 *
 * @returns {object[]} The requests in this selection that the move leaves unowned.
 */
export function issuesNeedingAssigneeForMove({
  issues = [],
  toStatusId,
  toCategoryId,
  statuses = [],
  internalViewer = false,
} = {}) {
  return (issues || []).filter(issue => needsAssigneeForMove({
    issue,
    toStatusId,
    toCategoryId,
    statuses,
    internalViewer,
  }));
}
