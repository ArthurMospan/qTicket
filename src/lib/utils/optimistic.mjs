// src/lib/utils/optimistic.mjs — pure logic behind optimistic drag & drop.
//
// Every board in the app renders a Firestore snapshot directly. A drop
// therefore had no visible effect until the write echoed back, and
// @hello-pangea/dnd — which can only animate into the list it can see — played
// its drop animation back to the *source* slot, after which the echo re-rendered
// the card somewhere else. That two-step is the flicker users complained about.
//
// The fix is to overlay the pending result on top of the snapshot synchronously
// inside onDragEnd, then drop the overlay once the snapshot agrees with it.
// These helpers hold the parts worth testing without React or Firestore.

// Fields that come back from Firestore in exactly the shape we send them, so an
// overlay on them can be compared against the snapshot and retired reliably.
// Anything else (timestamps, rich text, sentinels) is left to the round-trip.
const PATCHABLE_FIELDS = [
  'columnId',
  'status',
  'order',
  'sprintId',
  'parentIssueId',
  // Kept temporarily so legacy Epic swimlane data still settles correctly
  // while the explicit migration is reviewed and run.
  'parentEpicId',
  'assigneeIds',
  'priority',
];

// Firestore sentinels (serverTimestamp, deleteField, arrayUnion…) and Timestamps
// are objects that never equal the value the snapshot returns for them.
function isMirrorable(value) {
  if (Array.isArray(value)) return value.every(v => typeof v !== 'object' || v === null);
  return value === null || typeof value !== 'object';
}

/** Column a card currently lives in, tolerating docs that predate `columnId`. */
export function columnOf(issue) {
  return issue?.columnId ?? issue?.status ?? null;
}

function createdMillis(issue) {
  return issue?.createdAt?.toMillis?.() ?? 0;
}

/**
 * Total ordering for issues: explicitly ordered cards first (ascending), then
 * everything else by creation time. Totality matters — the list is sorted once
 * from the snapshot and again after the overlay is merged, and an ambiguous
 * comparator would let cards swap places between those passes.
 */
export function compareIssues(a, b) {
  const ao = a?.order;
  const bo = b?.order;
  if (ao !== undefined && bo !== undefined) return ao - bo;
  if (ao !== undefined) return -1;
  if (bo !== undefined) return 1;
  return createdMillis(a) - createdMillis(b);
}

/** True when `actual` already holds `expected` (arrays compared by value). */
export function sameValue(actual, expected) {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((value, i) => actual[i] === value);
  }
  if (expected === null) return actual === null || actual === undefined;
  return actual === expected;
}

/** True when the snapshot doc has caught up with every field of the overlay. */
export function patchLanded(doc, patch) {
  return Object.entries(patch).every(([key, value]) => sameValue(doc[key], value));
}

/** Narrow an arbitrary update to the fields that are safe to mirror locally. */
export function pickPatchableFields(data) {
  if (!data) return null;
  const patch = {};
  for (const field of PATCHABLE_FIELDS) {
    if (!(field in data)) continue;
    const value = data[field];
    if (value === undefined || !isMirrorable(value)) continue;
    patch[field] = value;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Merge pending overlays into a snapshot list. Returns the original array
 * untouched when no overlay applies, so consumers keep referential stability
 * and React can skip the re-render.
 */
export function applyPatches(items, patches) {
  if (!patches || !items?.length) return items;
  let touched = false;
  const merged = items.map(item => {
    const patch = patches[item.id];
    if (!patch) return item;
    touched = true;
    return { ...item, ...patch };
  });
  return touched ? merged : items;
}

/**
 * Drop overlays the snapshot has caught up with (and overlays for cards that no
 * longer exist). Returns the same reference when nothing changed, `null` when
 * everything has landed.
 */
export function prunePatches(items, patches) {
  if (!patches) return null;
  const byId = new Map((items || []).map(item => [item.id, item]));
  const remaining = {};
  let dropped = 0;

  for (const [id, patch] of Object.entries(patches)) {
    const doc = byId.get(id);
    if (!doc || patchLanded(doc, patch)) {
      dropped += 1;
      continue;
    }
    remaining[id] = patch;
  }

  if (!dropped) return patches;
  return Object.keys(remaining).length ? remaining : null;
}

/**
 * Cards that live in `columnId`, in the order a board renders them.
 * `projectId` narrows the list to one project: `order` numbers a single
 * project's column, so a board that mixes projects — "Мої завдання" — can only
 * position a card among its own project's cards.
 */
export function columnMembers(issues, columnId, { projectId = null, excludeIssueId = null } = {}) {
  return (issues || [])
    .filter(issue => (
      issue?.id !== excludeIssueId
      && columnOf(issue) === columnId
      && (!projectId || issue.projectId === projectId)
    ))
    .sort(compareIssues);
}

/**
 * Where a drop belongs in `column`, given the column the user was actually
 * looking at. A board shows a filtered, and on "Мої завдання" a cross-project,
 * subset of the cards `order` numbers, so the index the drag library reports is
 * not the index to write.
 *
 * The rule is "keep the neighbours the user aimed between": take the position
 * of the first card at or below the drop slot that shares the moved card's
 * scope, else just after the nearest one above it. With no shared neighbour at
 * all there is nothing to be relative to, and the top is the one place a card
 * cannot get lost.
 */
export function resolveDropIndex(column, visibleIds = [], visibleIndex = 0) {
  const positionOf = id => column.findIndex(issue => issue.id === id);
  for (let cursor = Math.max(0, visibleIndex); cursor < visibleIds.length; cursor += 1) {
    const at = positionOf(visibleIds[cursor]);
    if (at >= 0) return at;
  }
  for (let cursor = Math.min(visibleIndex, visibleIds.length) - 1; cursor >= 0; cursor -= 1) {
    const at = positionOf(visibleIds[cursor]);
    if (at >= 0) return at + 1;
  }
  return 0;
}

/**
 * Work out the full result of dropping `issueId` at `targetIndex` of
 * `targetColumnId`. The returned patch map is the single description of the
 * move: the board paints it immediately and the Firestore batch writes exactly
 * the same values, so the overlay retires the moment the echo arrives instead
 * of fighting it.
 *
 * Cards whose position is unchanged are left out of the patch map — they need
 * neither a repaint nor a write.
 */
export function planMove(issues, issueId, targetColumnId, targetIndex) {
  const moving = (issues || []).find(issue => issue.id === issueId);
  if (!moving) return null;

  const column = issues
    .filter(issue => issue.id !== issueId && columnOf(issue) === targetColumnId)
    .sort(compareIssues);

  const requested = Number.isFinite(Number(targetIndex)) ? Math.trunc(Number(targetIndex)) : 0;
  const insertAt = Math.min(Math.max(0, requested), column.length);
  const ordered = [...column.slice(0, insertAt), moving, ...column.slice(insertAt)];

  const patches = {};
  ordered.forEach((issue, index) => {
    if (issue.id === issueId) {
      patches[issue.id] = { columnId: targetColumnId, status: targetColumnId, order: index };
      return;
    }
    if (issue.order !== index) patches[issue.id] = { order: index };
  });

  return { from: columnOf(moving), insertAt, ordered, patches };
}

/**
 * Plan a drop described the way a board sees it, rather than as an index into
 * data the user never saw. `position` is either an explicit `{ index }` — a
 * status change made outside a board, which belongs at the top of its new
 * column so it cannot be lost — or the visible column that was dropped into.
 *
 * `scopeToProject` is what "Мої завдання" needs: its columns mix projects, and
 * an index counted across all of them is meaningless as an `order`, because
 * every project numbers its own column from zero.
 */
export function planDrop(issues, issueId, targetColumnId, position = {}, { scopeToProject = false } = {}) {
  const moving = (issues || []).find(issue => issue.id === issueId);
  if (!moving) return null;
  const scoped = scopeToProject
    ? issues.filter(issue => issue.projectId === moving.projectId)
    : issues;
  const index = Number.isFinite(position?.index)
    ? position.index
    : resolveDropIndex(
      columnMembers(scoped, targetColumnId, { excludeIssueId: issueId }),
      position?.visibleColumnIds || [],
      position?.visibleIndex ?? 0,
    );
  return planMove(scoped, issueId, targetColumnId, index);
}
