// src/lib/utils/statusCategories.mjs — the two layers of a status.
//
// A status has a *name*, which belongs to the organization's workflow and can be
// anything ("Код-ревʼю", "Погодження клієнтом", "QA"), and a *category*, which is
// one of five fixed values every product surface can rely on. Names are local,
// categories are shared — the same split Linear, ClickUp, Notion and Shortcut
// make, and for the same reason: anything that spans projects has to group work
// by something that exists everywhere.
//
// Before this file the app had one global list of names and no categories, so
// «Мої завдання» built its columns from raw names, project boards could hide any
// of those names, and dropping a card into a column the card's own project had
// switched off was rejected by the server with a message the user could do
// nothing about. Categories remove the collision instead of guarding it: a task
// of any project has exactly one category, so a category column can never be
// missing from a project.
//
// Two guesses also die here. "Which status means finished" used to be read from
// a position in the list, and "which means in progress" was `statuses.slice(1)`.
// Both are now a direct question to the data.
//
// Cancelling is deliberately not one of these categories. A cancelled task is
// not a task in a particular column — it is a task that should stop counting
// anywhere at all, including in the record of what was done, and that is a
// property of the task, not of its place in the workflow. It lives on the issue
// as `cancelledAt`; see `src/lib/utils/issueCancel.mjs`.

// Canonical order. Category columns are the same for every member of every
// organization, so their order is fixed here rather than taken from the
// workflow — the workflow only orders *names* inside a category.
export const STATUS_CATEGORY_IDS = Object.freeze([
  'backlog',
  'todo',
  'in-progress',
  'review',
  'done',
]);

// Two flags, because "finished" is two different questions. Today one category
// answers both — «Готово» is the only end a status has — and the split is kept
// because the callers are not asking the same thing:
//
// `closes` — there is no work left here. Overdue, blockers, a parent waiting on
// its children, reminders and `completedAt` all read this.
// `delivers` — something was actually produced. Completion percentage, velocity,
// "closed in this period" and the invoice preset read this.
//
// «На перевірці» carries neither. Work handed over for review is not finished
// and has produced nothing yet: a task sitting there is still open, still
// blocks whatever it blocked, and can still run past its deadline. That is the
// reason it is its own category rather than a shade of «У роботі» — the two are
// the same question to a board and different ones to a person's workload.
export const STATUS_CATEGORIES = Object.freeze({
  backlog: Object.freeze({
    id: 'backlog',
    label: 'Беклог',
    color: '#9a9a9a',
    closes: false,
    delivers: false,
  }),
  todo: Object.freeze({
    id: 'todo',
    label: 'До виконання',
    color: '#6366f1',
    closes: false,
    delivers: false,
  }),
  'in-progress': Object.freeze({
    id: 'in-progress',
    label: 'У роботі',
    color: '#f59e0b',
    closes: false,
    delivers: false,
  }),
  review: Object.freeze({
    id: 'review',
    label: 'На перевірці',
    color: '#8b5cf6',
    closes: false,
    delivers: false,
  }),
  done: Object.freeze({
    id: 'done',
    label: 'Готово',
    color: '#10b981',
    closes: true,
    delivers: true,
  }),
});

// Categories the built-in and historical status ids belong to. Only ids the
// product itself has shipped are listed: a custom id is never guessed at by
// name, it falls through to the positional rules below.
const BUILT_IN_STATUS_CATEGORIES = Object.freeze({
  backlog: 'backlog',
  todo: 'todo',
  'in-progress': 'in-progress',
  // The statuses the product has always shipped for "handed over, not
  // finished". They were read as work in progress only because no category
  // said what they are.
  review: 'review',
  'code-review': 'review',
  qa: 'review',
  'client-approval': 'review',
  done: 'done',
  // Ids the removed «Скасовано» category shipped with. Listed so that a
  // trailing one is never mistaken for the last column and read as finished.
  cancelled: 'in-progress',
  canceled: 'in-progress',
  duplicate: 'in-progress',
});

// Categories the product has removed, and what a status still carrying one is
// read as now.
//
// This has to be answered before the `isDone` flag below, not after. «Скасовано»
// closed a task, so `withStatusCategories` wrote `isDone: true` next to it in
// every saved workflow document — leave that flag to decide and every status a
// workflow once used for dropped work files itself under «Готово», and every
// delivery number counts work nobody did as output.
//
// They come back as ordinary open work instead. That is visible and it is
// honest: the tasks are still there, they are not finished, and dropping one
// now means «Скасувати» on the task itself.
const REMOVED_STATUS_CATEGORIES = Object.freeze({
  cancelled: 'in-progress',
});

export function isStatusCategoryId(value) {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(STATUS_CATEGORIES, value);
}

/** The task is closed: nothing is left to do in this category. */
export function isClosingCategory(value) {
  return isStatusCategoryId(value) && STATUS_CATEGORIES[value].closes === true;
}

/** Work was actually delivered — the narrower of the two. */
export function isDeliveringCategory(value) {
  return isStatusCategoryId(value) && STATUS_CATEGORIES[value].delivers === true;
}

export function statusCategoryLabel(value) {
  return isStatusCategoryId(value) ? STATUS_CATEGORIES[value].label : '';
}

function statusList(statuses) {
  return Array.isArray(statuses) ? statuses.filter(status => status?.id) : [];
}

// The pre-category rule for "which statuses close a task" had three steps: an
// explicit `isDone` flag, else an id of 'done', else the last column. The flag is
// a deliberate answer and is read first below; these two are what is left — a
// guess from a name and a guess from a position — so they are consulted only
// after the built-in ids and the entry column have had their say.
function guessedTerminalStatusIds(list) {
  const named = list.find(status => status.id === 'done');
  if (named) return [named.id];
  return [list[list.length - 1].id];
}

/**
 * Category of every status in a workflow, as a Map keyed by status id.
 *
 * Nothing has to be migrated for this to be correct: a status that carries no
 * category is read through the rules that used to be implicit, in the order of
 * how much each one actually knows. An explicit category is the answer; a
 * deliberate `isDone` flag closes a task; a built-in id keeps the meaning it
 * shipped with; the first column is where new work lands; and only then do the
 * two old guesses — a status named 'done', or simply the last column — decide.
 * Everything else is work in progress. A category the product has since removed
 * is answered before all of it, for the reason written above the table.
 */
export function statusCategoryMap(statuses) {
  const list = statusList(statuses);
  const categories = new Map();
  if (!list.length) return categories;
  const flagged = new Set(
    list.filter(status => status.isDone === true).map(status => status.id),
  );
  const guessed = flagged.size ? new Set() : new Set(guessedTerminalStatusIds(list));
  list.forEach((status, index) => {
    if (isStatusCategoryId(status.category)) {
      categories.set(status.id, status.category);
      return;
    }
    const removed = REMOVED_STATUS_CATEGORIES[status.category];
    if (removed) {
      categories.set(status.id, removed);
      return;
    }
    if (flagged.has(status.id)) {
      categories.set(status.id, 'done');
      return;
    }
    const builtIn = BUILT_IN_STATUS_CATEGORIES[status.id];
    if (builtIn) {
      categories.set(status.id, builtIn);
      return;
    }
    if (index === 0) {
      categories.set(status.id, 'backlog');
      return;
    }
    categories.set(status.id, guessed.has(status.id) ? 'done' : 'in-progress');
  });
  return categories;
}

/** Category of one status id, or '' when the workflow has no such status. */
export function statusCategoryOf(statusId, statuses) {
  return statusCategoryMap(statuses).get(statusId) || '';
}

/**
 * The same statuses with `category` and `isDone` written out explicitly, so a
 * saved workflow document never leaves the two disagreeing and no reader has to
 * re-derive anything. `isDone` is kept because it is what older documents and
 * the public task API were built on — it is now a consequence of the category,
 * never a second opinion about it.
 */
export function withStatusCategories(statuses) {
  const categories = statusCategoryMap(statuses);
  return statusList(statuses).map(status => {
    const category = categories.get(status.id);
    return {
      ...status,
      category,
      isDone: isClosingCategory(category),
    };
  });
}

/**
 * Statuses that close a task. Never empty for a non-empty workflow: a workflow
 * whose categories somehow leave nothing closing still has to give progress,
 * billing and overdue a definition of "finished", and the last column is the
 * same fallback the app used before categories existed.
 */
export function closedStatusIds(statuses) {
  const list = statusList(statuses);
  if (!list.length) return [];
  const categories = statusCategoryMap(list);
  const closed = list
    .filter(status => isClosingCategory(categories.get(status.id)))
    .map(status => status.id);
  return closed.length ? closed : [list[list.length - 1].id];
}

/**
 * Statuses that mean the work was delivered — «Готово» and nothing else.
 *
 * Everything that measures output asks this instead of `closedStatusIds`:
 * completion percentage, velocity, "closed in this period", the invoice preset.
 * The fallback to the closed set is unreachable while `done` is the only
 * category that ends a task, and remains the answer for a workflow whose
 * categories somehow leave nothing delivering.
 */
export function deliveredStatusIds(statuses) {
  const list = statusList(statuses);
  if (!list.length) return [];
  const categories = statusCategoryMap(list);
  const delivered = list
    .filter(status => isDeliveringCategory(categories.get(status.id)))
    .map(status => status.id);
  return delivered.length ? delivered : closedStatusIds(list);
}

/** Statuses of one category, in workflow order. */
export function statusesInCategory(categoryId, statuses) {
  const categories = statusCategoryMap(statuses);
  return statusList(statuses).filter(status => categories.get(status.id) === categoryId);
}

/** Ids of the statuses of one category, in workflow order. */
export function categoryStatusIds(categoryId, statuses) {
  return statusesInCategory(categoryId, statuses).map(status => status.id);
}

/**
 * Statuses of one category that a particular project actually shows.
 *
 * Cross-project boards use category columns, while the final status still
 * belongs to the task's own project. Keeping this choice here means callers do
 * not re-derive category meaning or accidentally offer a hidden project
 * column. Workflow order is preserved so the first item remains the canonical
 * automatic choice when no picker is needed.
 */
export function availableStatusesInCategory(categoryId, statuses, {
  hiddenStatusIds = [],
} = {}) {
  if (!isStatusCategoryId(categoryId)) return [];
  const hidden = new Set(hiddenStatusIds || []);
  return statusesInCategory(categoryId, statuses)
    .filter(status => !hidden.has(status.id));
}

/** Statuses whose category is `in-progress` — what «в роботі» means, exactly. */
export function inProgressStatusIds(statuses) {
  return categoryStatusIds('in-progress', statuses);
}

// There is deliberately no `reviewStatusIds`. Nothing asks that question yet:
// «в роботі» on a workload table means "loaded with this right now", and a task
// waiting on a reviewer is not that, while everything counting open work reads
// the closed set and already includes it. `categoryStatusIds('review', …)` is
// there for the first caller that genuinely needs the list.

/** Statuses whose category is `backlog` — work that is collected, not planned. */
export function backlogStatusIds(statuses) {
  return categoryStatusIds('backlog', statuses);
}

/**
 * The categories this workflow actually uses, in canonical order. A category no
 * status maps to is not a column anybody could drop into, so it is not shown.
 */
export function activeStatusCategoryIds(statuses) {
  const used = new Set(statusCategoryMap(statuses).values());
  return STATUS_CATEGORY_IDS.filter(categoryId => used.has(categoryId));
}

/**
 * The columns of a cross-project board: one per category in use, carrying the
 * category's own label and colour rather than any single status's.
 */
export function statusCategoryColumns(statuses) {
  return activeStatusCategoryIds(statuses).map(categoryId => ({
    id: categoryId,
    label: STATUS_CATEGORIES[categoryId].label,
    color: STATUS_CATEGORIES[categoryId].color,
    isCategory: true,
  }));
}

/**
 * The workflow as the editor shows it: one list per category, in canonical
 * order, every category present even when it holds nothing — an empty section is
 * how you add the first «Скасовано». A status with no category is read as work in
 * progress rather than dropped, so nothing can fall out of the editor.
 */
export function groupStatusesByCategory(statuses) {
  const groups = new Map(STATUS_CATEGORY_IDS.map(categoryId => [categoryId, []]));
  const categories = statusCategoryMap(statuses);
  for (const status of statusList(statuses)) {
    const category = categories.get(status.id) || 'in-progress';
    groups.get(category).push(status);
  }
  return groups;
}

/**
 * The inverse: back to the flat array the workflow document stores, in canonical
 * category order with each status's category and `isDone` written out. Saving
 * through this is what keeps the stored order the order work flows in, so a
 * project board's columns never come out shuffled by when somebody added them.
 */
export function flattenStatusGroups(groups) {
  return STATUS_CATEGORY_IDS.flatMap(categoryId => (groups.get(categoryId) || []).map(status => ({
    ...status,
    category: categoryId,
    isDone: isClosingCategory(categoryId),
  })));
}

/**
 * Which status a task should get when it is dropped into a category column.
 *
 * A task keeps the status it already has whenever that status is in the target
 * category — moving between two columns of one category is not a status change.
 * Otherwise it takes the first status of that category the *task's own project*
 * actually uses, which is why a project's hidden columns can never make a
 * category drop illegal. Returns null when the project has switched off every
 * status of that category; the caller says so instead of writing a status the
 * board would then refuse to show.
 */
export function resolveCategoryStatusId(categoryId, statuses, {
  currentStatusId = null,
  hiddenStatusIds = [],
} = {}) {
  const candidates = availableStatusesInCategory(categoryId, statuses, {
    hiddenStatusIds,
  });
  if (currentStatusId && candidates.some(status => status.id === currentStatusId)) {
    return currentStatusId;
  }
  return candidates[0]?.id || null;
}

/**
 * Where new work lands: the first `backlog` status, else the first status that
 * does not close a task, else the first status there is. Every writer that used
 * to hardcode the id 'backlog' or take `statuses[0]` asks this instead.
 */
export function entryStatusId(statuses) {
  const list = statusList(statuses);
  if (!list.length) return null;
  const categories = statusCategoryMap(list);
  const backlog = list.find(status => categories.get(status.id) === 'backlog');
  if (backlog) return backlog.id;
  const open = list.find(status => !isClosingCategory(categories.get(status.id)));
  return (open || list[0]).id;
}
