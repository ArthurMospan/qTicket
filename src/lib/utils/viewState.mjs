/**
 * A screen's view state is its query string.
 *
 * Filters used to live in `useState` and were mirrored into `localStorage` per
 * device. That made three ordinary things impossible: a board could not be sent
 * to anyone, «my daily board» could not exist on two machines, and the browser's
 * own Back button did not undo a filter because nothing had navigated. Moving
 * the same values into the address makes all three fall out of the platform
 * rather than being built.
 *
 * A schema declares what a screen owns:
 *
 *   { key: { default, values?, type?: 'list' } }
 *
 * Two rules keep the address honest. A value equal to its default is absent, so
 * an untouched board stays `/PROJ` rather than `/PROJ?sprint=all&assignee=all…`.
 * A key the schema does not declare is never read and never written, so `org`,
 * `new` and `member` survive a filter change untouched.
 */

import { TASK_TABLE_SORT_DIRECTIONS, TASK_TABLE_SORT_VALUES } from './taskTable.mjs';

const LIST_SEPARATOR = ',';

function readParams(source) {
  if (!source) return new URLSearchParams();
  if (source instanceof URLSearchParams) return source;
  if (typeof source === 'string') return new URLSearchParams(source);
  // Next.js hands `searchParams` to a server component as a plain object whose
  // repeated keys arrive as arrays.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach(entry => params.append(key, String(entry)));
    else params.set(key, String(value));
  }
  return params;
}

function isListField(field) {
  return field?.type === 'list' || Array.isArray(field?.default);
}

function fieldDefault(field) {
  return isListField(field) ? [...(field.default || [])] : field.default;
}

export function defaultViewState(schema) {
  const state = {};
  for (const [key, field] of Object.entries(schema)) state[key] = fieldDefault(field);
  return state;
}

function sameValue(field, value) {
  const fallback = fieldDefault(field);
  if (isListField(field)) {
    const list = Array.isArray(value) ? value : [];
    return list.length === fallback.length && list.every((entry, index) => entry === fallback[index]);
  }
  return value === fallback;
}

/** What the address says this screen is showing. */
export function parseViewState(schema, source) {
  const params = readParams(source);
  const state = {};
  for (const [key, field] of Object.entries(schema)) {
    const raw = params.get(key);
    if (raw === null) {
      state[key] = fieldDefault(field);
      continue;
    }
    if (isListField(field)) {
      state[key] = raw.split(LIST_SEPARATOR).map(entry => entry.trim()).filter(Boolean);
      continue;
    }
    // An address outlives what it points at. A renamed view mode or a
    // hand-edited link must still open the screen instead of rendering a state
    // that no longer exists.
    state[key] = field.values && !field.values.includes(raw) ? field.default : raw;
  }
  return state;
}

/** The address that shows this state, with every foreign parameter kept. */
export function serializeViewState(schema, state, currentParams) {
  const params = new URLSearchParams(readParams(currentParams).toString());
  for (const [key, field] of Object.entries(schema)) {
    const value = state?.[key];
    if (value === undefined || sameValue(field, value)) {
      params.delete(key);
      continue;
    }
    params.set(key, isListField(field) ? value.join(LIST_SEPARATOR) : String(value));
  }
  return params;
}

/** The same thing as a query string, empty when there is nothing to say. */
export function viewStateQuery(schema, state, currentParams) {
  return serializeViewState(schema, state, currentParams).toString();
}

/**
 * Whether the address is making a claim about this screen.
 *
 * This is what decides a conflict: a link that carries filters always wins, and
 * only an address that says nothing lets the previous visit be restored.
 */
export function hasViewStateParams(schema, source) {
  const params = readParams(source);
  return Object.keys(schema).some(key => params.has(key));
}

export function isDefaultViewState(schema, state) {
  return Object.entries(schema).every(([key, field]) => sameValue(field, state?.[key]));
}

/**
 * The address a bare visit should be rewritten to, or `null` to leave it alone.
 *
 * This is the whole conflict rule in one place. An address that already says
 * something about this screen is never overruled — that is what makes a shared
 * link show the sender's board rather than the reader's habits. Only a bare
 * address restores the previous visit, and it restores it *into the address*,
 * so what you bookmark is always what you are looking at.
 */
export function restoredViewQuery(schema, storedQuery, currentQuery) {
  if (hasViewStateParams(schema, currentQuery)) return null;
  if (!storedQuery) return null;
  const restored = serializeViewState(
    schema,
    parseViewState(schema, storedQuery),
    currentQuery,
  ).toString();
  return restored === readParams(currentQuery).toString() ? null : restored;
}

// ── The shipped screens ──────────────────────────────────────────────────────

// `view` is the board's own key rather than a filter: it says which reading of
// the same tasks you are looking at, and a link to «the list» has to arrive as
// the list. The table view extended this set rather than adding a key.
//
// `cols`, `sort` and `dir` belong to the table the way `view` belongs to the
// board: they say what you are looking at, not which tasks are in it.
// They stay declared while the kanban is showing — a key the schema owns is a
// key the address may carry, and switching to the table and back must not throw
// away the columns you chose. Their values come from `taskTable.mjs`, so adding
// a column adds a sortable value to the address in the same breath.
export const BOARD_VIEW_SCHEMA = Object.freeze({
  view: { default: 'kanban', values: ['kanban', 'list', 'table'] },
  sprint: { default: 'all' },
  assignee: { default: 'all' },
  priority: { default: 'all' },
  type: { default: 'all' },
  sort: { default: 'manual', values: TASK_TABLE_SORT_VALUES },
  dir: { default: 'asc', values: TASK_TABLE_SORT_DIRECTIONS },
  // Empty means «the default six». An untouched table therefore stays `?view=table`
  // rather than spelling out a column set nobody chose.
  cols: { default: [], type: 'list' },
});

// `/my` deliberately has no `assignee` key: that address already carries
// `assignee` for the task composer, opened from a member's profile with that
// member pre-filled. Reading it as a filter here would make one parameter mean
// two things on one screen.
export const MY_TASKS_VIEW_SCHEMA = Object.freeze({
  view: { default: 'kanban', values: ['kanban', 'list'] },
  projects: { default: [], type: 'list' },
  sprint: { default: 'all' },
  priority: { default: 'all' },
  type: { default: 'all' },
});

export const SPRINTS_VIEW_SCHEMA = Object.freeze({
  projects: { default: [], type: 'list' },
  assignee: { default: 'all' },
  priority: { default: 'all' },
  type: { default: 'all' },
});
