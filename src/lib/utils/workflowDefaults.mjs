// Canonical default workflow, shared by the client hook, the board, the
// invoice builder and both task-creation APIs.
//
// These lists used to be copy-pasted in four places (useWorkflowConfig,
// useIssues, BillingTab, /api/issues and /api/v1/tasks), each free to drift
// from the others. Icons and colours stay in the client hook — only the ids and
// human labels live here, so this file is importable from server routes too.

// Relative, not aliased: this module is loaded straight by `node --test`, which
// knows nothing about the `@/` path alias.
import {
  closedStatusIds,
  deliveredStatusIds,
  statusCategoryMap,
} from './statusCategories.mjs';
import { DEFAULT_TASK_TYPES } from './taskTypes.mjs';

export const DEFAULT_STATUS_IDS = ['backlog', 'todo', 'in-progress', 'review', 'done'];
export const DEFAULT_TYPE_IDS = DEFAULT_TASK_TYPES.map(type => type.id);
export const DEFAULT_PRIORITY_IDS = ['blocker', 'high', 'medium', 'low'];
export const DEFAULT_LABEL_IDS = [];

// Human labels for the built-in workflow columns. Custom statuses carry their
// own label in the org's workflow document; this is the fallback for the
// defaults and for legacy ids that predate configurable workflows.
export const STATUS_LABELS = {
  backlog: 'Беклог',
  todo: 'До виконання',
  'in-progress': 'У роботі',
  review: 'На перевірці',
  'code-review': 'Код-ревʼю',
  qa: 'QA',
  'client-approval': 'Погодження клієнтом',
  done: 'Готово',
};

// Existing organizations can still have the original English defaults saved in
// Firestore. Localize only a known stable id + its exact old label: custom ids
// and renamed built-ins remain untouched.
const BUILT_IN_LABEL_TRANSLATIONS = {
  statuses: {
    backlog: { Backlog: 'Беклог' },
    todo: { 'To Do': 'До виконання' },
    'in-progress': { 'In Progress': 'У роботі' },
    review: { Review: 'На перевірці', 'In Review': 'На перевірці' },
    'code-review': { 'Code Review': 'Код-ревʼю' },
    'client-approval': { 'Client Approval': 'Погодження клієнтом' },
    done: { Done: 'Готово' },
  },
  types: {
    epic: { Epic: 'Епік (legacy)' },
    feature: { Feature: 'Фіча' },
    task: { Task: 'Задача' },
    bug: { Bug: 'Баг' },
  },
  priorities: {
    blocker: { Blocker: 'Критичний', 'Блокер': 'Критичний' },
    high: { High: 'Високий' },
    medium: { Medium: 'Середній' },
    low: { Low: 'Низький' },
  },
  labels: {
    bug: { Bug: 'Баг' },
    frontend: { Frontend: 'Фронтенд' },
    design: { Design: 'Дизайн' },
  },
  positions: {
    dev: { Developer: 'Розробник' },
    designer: { Designer: 'Дизайнер' },
    pm: { 'Project Manager': 'PM', PM: 'PM' },
    qa: { QA: 'QA' },
  },
};

export function localizeBuiltInWorkflowItems(section, items) {
  if (!Array.isArray(items)) return items;
  const sectionTranslations = BUILT_IN_LABEL_TRANSLATIONS[section];
  if (!sectionTranslations) return items;
  return items.map(item => {
    const localized = sectionTranslations[item?.id]?.[item?.label];
    return localized ? { ...item, label: localized } : item;
  });
}

export function statusLabel(statusId, statuses = []) {
  const configured = statuses.find(status => status?.id === statusId);
  return configured?.label || STATUS_LABELS[statusId] || statusId || '';
}

// Statuses that close a task — category `done`. Overdue, blockers, a parent
// waiting on its children, reminders and `completedAt` all read this. A task
// «На перевірці» is not among them: it is handed over, not finished. The rule
// lives in statusCategories.mjs, which also knows how to
// read a workflow saved before categories existed (an `isDone` flag, then an id
// of 'done', then the last column), so this stays the one answer the server
// routes and the UI both get.
export function resolveClosedStatusIds(statuses) {
  const resolved = closedStatusIds(statuses);
  return resolved.length ? resolved : ['done'];
}

// Statuses that mean work was delivered — category `done` alone. Everything
// that measures output rather than "is there work left" asks this one. Dropped
// work never reaches it: cancelling is `cancelledAt` on the issue, and a
// cancelled task is out of every set these numbers are built from.
export function resolveDeliveredStatusIds(statuses) {
  const resolved = deliveredStatusIds(statuses);
  return resolved.length ? resolved : ['done'];
}

// The built-in workflow as items, for the paths that only have ids: the category
// of every one of these ids is known, so a workflow document that was never
// saved still answers the entry-status question below.
const DEFAULT_STATUS_ITEMS = DEFAULT_STATUS_IDS.map(id => ({
  id,
  label: STATUS_LABELS[id] || id,
}));

// Where a new task lands in a project, for a raw workflow document.
//
// Every writer used to answer this itself, and all of them answered it by name:
// "'backlog' if the workflow has it, otherwise whatever is first". That is a
// guess twice over — an organization can rename or reorder its columns, and the
// first column of the list is not necessarily an incoming one. The category says
// it outright, and a project's hidden columns are honoured, so the fallback can
// never be a column that project has switched off.
export function resolveEntryStatusId(statuses, hiddenStatusIds = []) {
  const list = Array.isArray(statuses) && statuses.length
    ? statuses.filter(status => status?.id)
    : DEFAULT_STATUS_ITEMS;
  const hidden = new Set(Array.isArray(hiddenStatusIds) ? hiddenStatusIds : []);
  const categories = statusCategoryMap(list);
  for (const category of ['backlog', 'todo', 'in-progress', 'review']) {
    const found = list.find(status => (
      categories.get(status.id) === category && !hidden.has(status.id)
    ));
    if (found) return found.id;
  }
  return list.find(status => !hidden.has(status.id))?.id || null;
}

// Ids from a saved workflow section, falling back to the defaults above.
export function workflowIds(section, fallback) {
  return Array.isArray(section) && section.length ? section.map(item => item.id) : fallback;
}
