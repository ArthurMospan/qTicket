// src/lib/utils/sprintPlanning.mjs
// Which tasks a sprint can still take, and in what order the picker offers them.
//
// Dragging a card from «Без спринта» into a sprint is one way to plan, and on a
// phone it is not a way at all: the two lists are stacked, the backlog is four
// hundred rows long, and a long-press drag cannot cross a scroll. The picker is
// the same step made explicit, so this module answers the only question it has —
// which tasks to show — for both the empty field and a typed query.

const millis = (value) => {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

// A sprint is planned a handful of tasks at a time, so the resting list is short
// on purpose: it is a shortcut to what was touched last, not a second backlog.
export const SPRINT_PICKER_RECENT_LIMIT = 8;
export const SPRINT_PICKER_RESULT_LIMIT = 25;

// Number and name in one pass: `QT-142` is what a person reads off a chat
// message, and typing `142` alone has to find it too.
const matchesQuery = (issue, needle) => [issue.issueKey, issue.title]
  .some(value => String(value || '').toLowerCase().includes(needle));

/**
 * The tasks the «Додати існуюче» picker offers for one sprint.
 *
 * Already-picked tasks stay at the top whatever the query says — a selection
 * that disappears the moment you search for the next task is a selection you
 * cannot trust.
 *
 * With no query the list is the recently touched *unplanned* work, closed tasks
 * left out: that is the pile a sprint is actually drawn from. A query searches
 * every task outside this sprint instead, including the ones already in another
 * sprint — moving a task between sprints is planning too, and the row names the
 * sprint it comes from.
 *
 * @param {object[]} issues Every task in scope.
 * @param {string} options.sprintId The sprint being filled.
 * @param {string} options.query What was typed into the search field.
 * @param {string[]} options.closedStatusIds Statuses that close a task.
 * @param {string[]} options.pickedIds Tasks already ticked in this dialog.
 * @returns {object[]} Picked tasks first, then the offered ones.
 */
export function sprintCandidateIssues(issues, {
  sprintId,
  query = '',
  closedStatusIds = [],
  pickedIds = [],
} = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const picked = new Set(pickedIds);
  const closed = new Set(closedStatusIds);
  const candidates = (issues || []).filter(issue => issue.sprintId !== sprintId);
  const chosen = candidates.filter(issue => picked.has(issue.id));
  const rest = candidates.filter(issue => !picked.has(issue.id));

  const offered = needle
    ? rest.filter(issue => matchesQuery(issue, needle)).slice(0, SPRINT_PICKER_RESULT_LIMIT)
    : rest
      .filter(issue => !issue.sprintId && !closed.has(issue.columnId || issue.status))
      .sort((a, b) => millis(b.updatedAt) - millis(a.updatedAt))
      .slice(0, SPRINT_PICKER_RECENT_LIMIT);

  return [...chosen, ...offered];
}
