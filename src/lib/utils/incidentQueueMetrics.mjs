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

import { isExternalActorId } from './issueParticipants.mjs';
import { statusCategoryOf } from './statusCategories.mjs';

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
 * Whether the last word in a request was the customer's.
 *
 * A status says what the queue is doing; it never says what the queue owes. A
 * request can stand in «У роботі» for a week with the customer's last question
 * unanswered, and nothing on any screen says so — the only record of it is who
 * spoke last, which the issue document already carries as `lastCommentAuthorId`.
 *
 * Read as «not one of ours» rather than «is a client». An author who is not a
 * support member is either the customer or an actor imported with the request
 * from the system it came from — `isExternalActorId` is that second case, and it
 * has no membership to look up — and in both readings the answer is still owed
 * by us.
 *
 * @param {object} issue The issue document, as the queue already holds it.
 * @param {Set<string>|string[]} supportUserIds The organization's own people.
 */
export function isWaitingOnUs(issue, supportUserIds) {
  const authorId = issue?.lastCommentAuthorId;
  // Nothing has been said in it yet, so nothing is unanswered. A request nobody
  // has written in is «Нові», and that counter already has it.
  if (typeof authorId !== 'string' || authorId.length === 0) return false;
  if (isExternalActorId(authorId)) return true;
  const support = supportUserIds instanceof Set
    ? supportUserIds
    : new Set(supportUserIds || []);
  // Until we know who «ми» are, nobody can be said to be waiting on us.
  if (support.size === 0) return false;
  return !support.has(authorId);
}

/**
 * The exact set the «Чекають на нас» counter counts, so the tile above a queue
 * and the filtered list behind it cannot come apart. A closed request is not
 * waiting on anybody, whoever wrote in it last.
 *
 * @param {{issue: object, category: string}[]} categorized From `categorizeIssues`.
 * @param {Set<string>|string[]} supportUserIds The organization's own people.
 * @returns {object[]}
 */
export function waitingOnUsIssues(categorized, supportUserIds) {
  return (categorized || [])
    .filter(entry => entry.category !== 'done' && isWaitingOnUs(entry.issue, supportUserIds))
    .map(entry => entry.issue);
}

/**
 * The counters every incident queue reports, from one set of rules.
 *
 * @param {{issue: object, category: string}[]} categorized From `categorizeIssues`.
 * @param {{supportUserIds?: Set<string>|string[]}} options Who «ми» are, for «Чекають на нас».
 * @returns {{open: number, new: number, active: number, review: number, resolved: number, unassigned: number, waitingOnUs: number}}
 */
export function incidentQueueMetrics(categorized, { supportUserIds } = {}) {
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
    // The customer wrote last and we have not answered. The same call the
    // filtered list makes, so the number and the list cannot disagree.
    waitingOnUs: waitingOnUsIssues(entries, supportUserIds).length,
  };
}
