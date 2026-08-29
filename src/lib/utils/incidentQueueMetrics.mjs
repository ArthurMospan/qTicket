// src/lib/utils/incidentQueueMetrics.mjs
// The counters over a queue of incidents, computed once for every screen that
// shows them.
//
// There used to be two of these, written out by hand on two screens that count
// the same records: «У роботі» on the support overview meant `in-progress`,
// and «У роботі» on a customer's space meant `in-progress` *or* `review`. Both
// were defensible and neither was wrong on its own — what was wrong is that the
// same word, on two screens of one product, was two different numbers, and the
// only way to notice was to add them up by hand.
//
// One formula: a record being checked is still a record being worked on, so
// `active` includes `review`, and the screen that wants to say how many of them
// are waiting on an answer says so from `review` beside it.

import { statusCategoryOf } from '@/lib/utils/statusCategories.mjs';

/**
 * Who an incident is assigned to, across the three shapes the data has had.
 */
export function assigneeIdsOf(issue) {
  if (Array.isArray(issue?.assigneeIds)) return issue.assigneeIds.filter(Boolean);
  if (Array.isArray(issue?.assignees)) return issue.assignees.filter(Boolean);
  return issue?.assigneeId ? [issue.assigneeId] : [];
}

/**
 * Pairs every incident with the status category it belongs to.
 *
 * Kept separate from the counters because a screen usually needs both: the
 * counts above the list, and the category of each row inside it.
 *
 * @param {object[]} issues
 * @param {object[]} statuses The workflow statuses, for resolving a category.
 * @returns {{issue: object, category: string}[]}
 */
export function categorizeIssues(issues, statuses) {
  return (issues || []).map(issue => ({
    issue,
    category: statusCategoryOf(issue.columnId || issue.status, statuses),
  }));
}

/**
 * The counters every incident queue reports, from one set of rules.
 *
 * @param {{issue: object, category: string}[]} categorized From `categorizeIssues`.
 * @returns {{open: number, new: number, active: number, review: number, resolved: number, unassigned: number}}
 */
export function incidentQueueMetrics(categorized) {
  const entries = categorized || [];
  const open = entries.filter(entry => entry.category !== 'done');
  return {
    open: open.length,
    // Nobody has taken it yet.
    new: open.filter(entry => entry.category === 'backlog' || entry.category === 'todo').length,
    // Somebody has. Being checked is still being worked on.
    active: open.filter(entry => entry.category === 'in-progress' || entry.category === 'review').length,
    // The part of `active` that is waiting on somebody else to look.
    review: open.filter(entry => entry.category === 'review').length,
    resolved: entries.filter(entry => entry.category === 'done').length,
    unassigned: open.filter(entry => assigneeIdsOf(entry.issue).length === 0).length,
  };
}
