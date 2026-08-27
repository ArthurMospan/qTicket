// Denormalized task counts on the project document.
//
// ── Why this exists ──────────────────────────────────────────────────────
//
// The home screen draws a progress bar per project, and it computes it by
// reading every task of every project the account can open. That is the widest
// read in the product (docs/ARCHITECTURE.md → «Вартість читання»), and it is
// paid on the screen people come back to most, to draw one percentage per card.
//
// Three numbers on one small document is what a card actually needs, and one
// document per project costs one read whatever the project's history is. The
// tasks themselves stay where they are — a board still reads them, because a
// board draws them — but the front door stops paying a whole workspace's worth
// of reads for a bar.
//
// ── What it is not ───────────────────────────────────────────────────────
//
// It is not a source of truth. Every figure is derived from `issues`, and
// `scripts/backfill-project-issue-counts.mjs` rebuilds any of it from scratch
// and reports every project whose stored figures disagree with the recomputed
// ones. An aggregate with no way back is a number a bug corrupts permanently.
//
// It is not a filter. «Скільки» is not «які»: a screen that lists tasks reads
// tasks. Nothing here can answer which ones.
//
// ── The shape ────────────────────────────────────────────────────────────
//
//   projects/{projectId}.issueCounts = {
//     version, total, delivered, overdue, countedAt, countedDay
//   }
//
// `total` is the working set — what a board would show: not archived, not
// cancelled, not being deleted. That is deliberately the same set
// `useOrganizationIssues` publishes as `issues`, because it is the set the
// progress bar was already computed from.
//
// `delivered` is the narrower of the two closing readings — `deliveredStatusIds`
// («Готово»), the same one `progressByProject` used. `overdue` is «open and past
// its deadline», which is `closedStatusIds` («Готово» and anything else whose
// category closes a task), matching the report on the analytics screen. The two
// questions are genuinely different and `statusCategories.mjs` already keeps
// them apart; neither is re-derived here.
//
// ── The clock, which is the whole difficulty ─────────────────────────────
//
// `total` and `delivered` are facts about stored fields, so a delta keeps them
// exactly right forever. `overdue` is not: a task nobody touches becomes overdue
// at midnight, and no write happens at midnight.
//
// So the document says which day it answered. `countedDay` is a day key in the
// organization's timezone, written by a full recount and never by a delta, and
// the invariant is:
//
//     the stored counts are exactly true as of `countedDay`.
//
// Every delta is therefore evaluated against `countedDay` rather than against
// the current moment. Deliver a task at noon that slipped its deadline last
// night and the recount has not run yet: at `countedDay` it was not overdue, so
// the delta moves `overdue` by nothing — which is right, because the stored
// figure never counted it. Evaluating at «now» instead would subtract a task
// the total never contained and leave the counter one below zero.
//
// What advances `countedDay` is the twice-daily materialise pass
// (`recountProjectIssueCounts`), which is timed to land in the early morning of
// the workspace's own timezone — the same reason there are two of them rather
// than one. See `src/lib/server/projectIssueCounts.js`.
//
// A reader that holds the tasks anyway should keep computing from the tasks. A
// reader that does not gets `overdue` as of this morning, and `countedAt` says
// so out loud rather than pretending otherwise.

import { isDueDateOverdue } from './date.js';
import { isArchivedIssue } from './issueArchive.mjs';
import { isCancelledIssue } from './issueCancel.mjs';
import {
  DEFAULT_ORGANIZATION_TIME_ZONE,
  dayKeyInTimeZone,
  zonedDateTimeToUtcMs,
} from './timeZone.mjs';

/**
 * Bumped when the meaning of a stored field changes, so counts written by an
 * older deployment can be told apart from these — and so the backfill can be
 * asked to rewrite everything below the current version.
 */
export const PROJECT_ISSUE_COUNTS_VERSION = 1;

/** The one field on the project document these live under. */
export const PROJECT_ISSUE_COUNTS_FIELD = 'issueCounts';

/** The three figures, in the order a reader thinks about them. */
export const PROJECT_ISSUE_COUNT_KEYS = Object.freeze(['total', 'delivered', 'overdue']);

const EMPTY_COUNTS = Object.freeze({ total: 0, delivered: 0, overdue: 0 });

function statusSet(value) {
  if (value instanceof Set) return value;
  return new Set(Array.isArray(value) ? value : []);
}

function statusIdOf(issue) {
  return issue?.columnId || issue?.status || '';
}

/**
 * Whether a task is one of the tasks at all.
 *
 * The same three exclusions `useOrganizationIssues` applies before it publishes
 * `issues`, and for the same reasons: an archived task left the present, a
 * cancelled one left both, and one being deleted is on its way out. Anything
 * counting open work excludes all three (AGENTS.md), so a counter that included
 * them would disagree with every screen that draws them.
 */
export function isCountedIssue(issue) {
  if (!issue || !issue.projectId) return false;
  if (issue.deletionPending === true) return false;
  return !isArchivedIssue(issue) && !isCancelledIssue(issue);
}

/**
 * What one task adds to its project's counters.
 *
 * `countedDay` is the day the stored figures answer for — never «today» — so
 * that the same task evaluated twice inside one window produces the same
 * answer. See the note about the clock above.
 *
 * @returns {{total: number, delivered: number, overdue: number}} zeroes when the
 *   task is not one of the counted ones.
 */
export function issueCountContribution(issue, {
  deliveredStatusIds,
  closedStatusIds,
  countedDay,
  timeZone = DEFAULT_ORGANIZATION_TIME_ZONE,
} = {}) {
  if (!isCountedIssue(issue)) return EMPTY_COUNTS;
  const statusId = statusIdOf(issue);
  const closed = statusSet(closedStatusIds).has(statusId);
  const delivered = statusSet(deliveredStatusIds).has(statusId);
  // The overdue rule is `isDueDateOverdue` and nothing else — the same call the
  // analytics screen makes, so a card and a report cannot come to different
  // conclusions about the same deadline. All that changes is *when* it is
  // asked: midday of the counted day in the organization's own calendar, rather
  // than the wall clock, so the answer is the one the stored figure gave.
  const askedAtMs = countedDay
    ? zonedDateTimeToUtcMs(countedDay, { hour: 12 }, timeZone)
    : Date.now();
  const overdue = !closed && isDueDateOverdue(issue.dueDate, {
    now: Number.isFinite(askedAtMs) ? askedAtMs : Date.now(),
    timeZone,
  });
  return {
    total: 1,
    delivered: delivered ? 1 : 0,
    overdue: overdue ? 1 : 0,
  };
}

/** The day key a project's stored counts answer for, or `''` if never counted. */
export function projectCountedDay(project) {
  const counts = project?.[PROJECT_ISSUE_COUNTS_FIELD];
  const day = counts?.countedDay;
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

/**
 * The stored counts, or `null` when nothing may be read from them yet.
 *
 * `null` is returned for a project no full recount has established — a project
 * created since the last pass, or a workspace the backfill has not been run
 * against. A delta never writes `countedAt`, precisely so that this stays a
 * statement about a total that was once computed from the tasks themselves, and
 * a reader falls back to the tasks rather than drawing a bar out of increments
 * that started from an unknown number.
 */
export function projectIssueCounts(project) {
  const counts = project?.[PROJECT_ISSUE_COUNTS_FIELD];
  if (!counts || counts.version !== PROJECT_ISSUE_COUNTS_VERSION) return null;
  if (!counts.countedAt || !projectCountedDay(project)) return null;
  const read = key => (Number.isFinite(Number(counts[key])) ? Math.max(0, Number(counts[key])) : 0);
  return {
    total: read('total'),
    delivered: read('delivered'),
    overdue: read('overdue'),
    countedDay: projectCountedDay(project),
    countedAt: counts.countedAt,
  };
}

/** The percentage the project card draws, from either source of the numbers. */
export function deliveredPercent(counts) {
  const total = Number(counts?.total) || 0;
  const delivered = Number(counts?.delivered) || 0;
  return total > 0 ? Math.round((delivered / total) * 100) : 0;
}

function emptyDelta(projectId) {
  return { projectId, total: 0, delivered: 0, overdue: 0 };
}

/**
 * A running set of per-project changes, so that one mutation — or one bulk
 * operation over fifty tasks — becomes one write per project it touched.
 *
 * `sign` is +1 for a task arriving in the counted set and -1 for one leaving.
 * An edit is both: the old shape removed and the new one added, which is what
 * `change()` does. That is the difference between a delta and an increment, and
 * it is the whole reason a task moved between two projects leaves both counters
 * right instead of one of them double-counting.
 */
export class ProjectIssueCountDeltas {
  constructor({ deliveredStatusIds, closedStatusIds, timeZone } = {}) {
    this.deliveredStatusIds = statusSet(deliveredStatusIds);
    this.closedStatusIds = statusSet(closedStatusIds);
    this.timeZone = timeZone || DEFAULT_ORGANIZATION_TIME_ZONE;
    this.entries = new Map();
    this.countedDays = new Map();
  }

  /**
   * Which day this project's stored counts answer for.
   *
   * Called with the project document the caller has just read — inside its own
   * transaction, where every route that changes a task already reads it — so a
   * delta is measured against the figure it is being added to and not against
   * the wall clock. A project with no established counts has no day, and the
   * delta falls back to today; nothing reads such a project's counters anyway.
   */
  observeProject(projectId, project) {
    if (!projectId) return this;
    const day = projectCountedDay(project);
    if (day) this.countedDays.set(projectId, day);
    return this;
  }

  /**
   * Forget everything accumulated so far, keeping the workflow this counts by.
   *
   * Called at the top of a transaction body, because Firestore re-runs that
   * body on contention while this accumulator lives outside it. Without the
   * reset a retried transaction adds the same task twice and the counter is
   * permanently one too high — a class of bug that shows up as a progress bar
   * over a hundred per cent, days after the write that caused it.
   */
  reset() {
    this.entries.clear();
    return this;
  }

  entry(projectId) {
    if (!this.entries.has(projectId)) this.entries.set(projectId, emptyDelta(projectId));
    return this.entries.get(projectId);
  }

  contributionOf(issue) {
    return issueCountContribution(issue, {
      deliveredStatusIds: this.deliveredStatusIds,
      closedStatusIds: this.closedStatusIds,
      countedDay: this.countedDays.get(issue?.projectId || '') || '',
      timeZone: this.timeZone,
    });
  }

  /**
   * @param issue an `issues` document's data, including `projectId`
   * @param sign +1 when the task now counts, -1 when it no longer does
   */
  add(issue, sign) {
    const projectId = issue?.projectId || '';
    if (!projectId) return this;
    const contribution = this.contributionOf(issue);
    if (!contribution.total) return this;
    const entry = this.entry(projectId);
    for (const key of PROJECT_ISSUE_COUNT_KEYS) entry[key] += contribution[key] * sign;
    return this;
  }

  /**
   * One task before and after whatever was done to it. Either side may be
   * `null`: creation is `change(null, issue)` and deletion is
   * `change(issue, null)`.
   */
  change(before, after) {
    if (before) this.add(before, -1);
    if (after) this.add(after, 1);
    return this;
  }

  /** Only the projects that actually moved. A zero delta is not a write. */
  changed() {
    return [...this.entries.values()].filter(entry => (
      PROJECT_ISSUE_COUNT_KEYS.some(key => entry[key] !== 0)
    ));
  }

  get size() {
    return this.entries.size;
  }
}

/**
 * The absolute totals for a set of tasks, grouped by project. The recount and
 * the backfill write these; nothing on the mutation paths does, because a full
 * total is exactly what a concurrent write would clobber.
 *
 * `projectIds` seeds the result with projects that must be reported as zero —
 * a project whose last task was deleted still has counters, and leaving it out
 * would leave the old figures standing.
 *
 * @returns {Map<string, {total: number, delivered: number, overdue: number}>}
 */
export function rebuildProjectIssueCounts(issues, {
  deliveredStatusIds,
  closedStatusIds,
  countedDay,
  timeZone = DEFAULT_ORGANIZATION_TIME_ZONE,
  projectIds = [],
} = {}) {
  const totals = new Map();
  for (const projectId of projectIds) {
    if (projectId) totals.set(projectId, { total: 0, delivered: 0, overdue: 0 });
  }
  for (const issue of issues || []) {
    const projectId = issue?.projectId || '';
    if (!projectId) continue;
    // A project whose every task is archived still has counters, and they are
    // three zeroes rather than nothing at all.
    if (!totals.has(projectId)) totals.set(projectId, { total: 0, delivered: 0, overdue: 0 });
    const contribution = issueCountContribution(issue, {
      deliveredStatusIds,
      closedStatusIds,
      countedDay,
      timeZone,
    });
    const entry = totals.get(projectId);
    for (const key of PROJECT_ISSUE_COUNT_KEYS) entry[key] += contribution[key];
  }
  return totals;
}

/** Whether a stored block already says what a recount computed. */
export function projectIssueCountsMatch(stored, computed, countedDay) {
  if (!stored || stored.version !== PROJECT_ISSUE_COUNTS_VERSION) return false;
  if (projectCountedDay({ [PROJECT_ISSUE_COUNTS_FIELD]: stored }) !== countedDay) return false;
  return PROJECT_ISSUE_COUNT_KEYS.every(key => (Number(stored[key]) || 0) === (computed?.[key] || 0));
}

/** Today, in the organization's own calendar. The day every figure answers for. */
export function countingDay(nowMs, timeZone) {
  return dayKeyInTimeZone(nowMs ?? Date.now(), timeZone || DEFAULT_ORGANIZATION_TIME_ZONE);
}
