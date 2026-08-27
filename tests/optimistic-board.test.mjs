// tests/optimistic-board.test.mjs — pure logic behind optimistic drag & drop.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPatches,
  columnMembers,
  compareIssues,
  patchLanded,
  planDrop,
  planMove,
  prunePatches,
  pickPatchableFields,
  resolveDropIndex,
} from '../src/lib/utils/optimistic.mjs';

const board = () => ([
  { id: 'a', columnId: 'todo', order: 0, title: 'A' },
  { id: 'b', columnId: 'todo', order: 1, title: 'B' },
  { id: 'c', columnId: 'todo', order: 2, title: 'C' },
  { id: 'x', columnId: 'doing', order: 0, title: 'X' },
  { id: 'y', columnId: 'doing', order: 1, title: 'Y' },
]);

// ── planMove ──────────────────────────────────────────────────────────────

test('planMove moves a card across columns at the requested index', () => {
  const plan = planMove(board(), 'a', 'doing', 1);

  assert.equal(plan.from, 'todo');
  assert.equal(plan.insertAt, 1);
  assert.deepEqual(plan.ordered.map(i => i.id), ['x', 'a', 'y']);
  assert.deepEqual(plan.patches.a, { columnId: 'doing', status: 'doing', order: 1 });
  // 'x' already sits at 0 — no write needed for it.
  assert.equal(plan.patches.x, undefined);
  assert.deepEqual(plan.patches.y, { order: 2 });
});

test('planMove reorders within the same column without touching other columns', () => {
  const plan = planMove(board(), 'c', 'todo', 0);

  assert.deepEqual(plan.ordered.map(i => i.id), ['c', 'a', 'b']);
  assert.deepEqual(plan.patches.c, { columnId: 'todo', status: 'todo', order: 0 });
  assert.deepEqual(plan.patches.a, { order: 1 });
  assert.deepEqual(plan.patches.b, { order: 2 });
  assert.equal(plan.patches.x, undefined);
  assert.equal(plan.patches.y, undefined);
});

test('planMove clamps an out-of-range index to the end of the column', () => {
  const plan = planMove(board(), 'a', 'doing', 99);

  assert.equal(plan.insertAt, 2);
  // The order written for the moved card must equal its real slot, otherwise
  // the optimistic overlay never matches the snapshot and the card jumps.
  assert.equal(plan.patches.a.order, 2);
  assert.deepEqual(plan.ordered.map(i => i.id), ['x', 'y', 'a']);
});

test('planMove treats a legacy card with only `status` as living in that column', () => {
  const issues = [
    { id: 'a', status: 'todo', order: 0 },
    { id: 'b', columnId: 'todo', order: 1 },
  ];
  const plan = planMove(issues, 'b', 'todo', 0);

  assert.deepEqual(plan.ordered.map(i => i.id), ['b', 'a']);
  assert.deepEqual(plan.patches.a, { order: 1 });
});

test('planMove returns null for an unknown card', () => {
  assert.equal(planMove(board(), 'nope', 'todo', 0), null);
});

test('planMove into an empty column produces index 0', () => {
  const plan = planMove(board(), 'a', 'done', 0);
  assert.equal(plan.insertAt, 0);
  assert.deepEqual(plan.patches.a, { columnId: 'done', status: 'done', order: 0 });
});

// ── resolveDropIndex / planDrop ───────────────────────────────────────────
//
// What the user sees is never the whole column: filters hide cards, and on
// «Мої завдання» a column holds cards from several projects, each numbering its
// own column from zero. The index the drag library reports counts visible rows;
// the index written has to count the rows `order` actually numbers.

const filteredColumn = () => ([
  { id: 'a', columnId: 'todo', order: 0, projectId: 'p1' },
  { id: 'hidden', columnId: 'todo', order: 1, projectId: 'p1' },
  { id: 'b', columnId: 'todo', order: 2, projectId: 'p1' },
  { id: 'c', columnId: 'todo', order: 3, projectId: 'p1' },
]);

test('resolveDropIndex takes the slot of the visible card the drop landed on', () => {
  const column = columnMembers(filteredColumn(), 'todo');
  // The board is filtered down to a, b, c — 'hidden' is not on screen.
  assert.equal(resolveDropIndex(column, ['a', 'b', 'c'], 1), 2, 'lands above b, not above hidden');
  assert.equal(resolveDropIndex(column, ['a', 'b', 'c'], 0), 0);
});

test('resolveDropIndex drops after the last visible card, not past hidden ones', () => {
  const column = columnMembers(filteredColumn(), 'todo');
  // Dropping at the bottom of a filtered column means "after c", and c is not
  // the last row of the real column when a filter is on.
  assert.equal(resolveDropIndex(column, ['a', 'b'], 2), 3, 'after b, before c');
});

test('resolveDropIndex ignores neighbours outside the ordering scope', () => {
  // A «Мої завдання» column: only p1 cards can be positioned relative to a p1
  // card, so the p2 rows between them are not anchors.
  const column = columnMembers(filteredColumn(), 'todo', { projectId: 'p1' });
  assert.equal(resolveDropIndex(column, ['x2', 'b', 'y2'], 0), 2, 'first p1 card at or below');
  assert.equal(resolveDropIndex(column, ['a', 'x2', 'y2'], 1), 1, 'just after the p1 card above');
  assert.equal(resolveDropIndex(column, ['x2', 'y2'], 2), 0, 'nothing to be relative to → top');
});

test('planDrop positions a card among its own project only', () => {
  const issues = [
    { id: 'p1-a', columnId: 'todo', order: 0, projectId: 'p1' },
    { id: 'p1-b', columnId: 'todo', order: 1, projectId: 'p1' },
    { id: 'p2-a', columnId: 'todo', order: 0, projectId: 'p2' },
    { id: 'moved', columnId: 'doing', order: 7, projectId: 'p1' },
  ];
  const plan = planDrop(
    issues,
    'moved',
    'todo',
    // On screen: p1-a, p2-a, p1-b — dropped onto the last row.
    { visibleColumnIds: ['p1-a', 'p2-a', 'p1-b'], visibleIndex: 2 },
    { scopeToProject: true },
  );

  assert.deepEqual(plan.patches.moved, { columnId: 'todo', status: 'todo', order: 1 });
  assert.deepEqual(plan.patches['p1-b'], { order: 2 });
  assert.equal(plan.patches['p2-a'], undefined, 'another project is never renumbered');
});

test('planDrop takes an explicit index for a status change made off the board', () => {
  const plan = planDrop(board(), 'a', 'doing', { index: 0 });

  assert.deepEqual(plan.patches.a, { columnId: 'doing', status: 'doing', order: 0 });
  assert.deepEqual(plan.patches.x, { order: 1 });
  assert.deepEqual(plan.patches.y, { order: 2 });
});

test('planDrop returns null for an unknown card', () => {
  assert.equal(planDrop(board(), 'nope', 'todo', { index: 0 }), null);
});

// ── applyPatches ──────────────────────────────────────────────────────────

test('applyPatches overlays pending values without mutating the source', () => {
  const items = board();
  const merged = applyPatches(items, planMove(items, 'a', 'doing', 1).patches);

  assert.equal(merged.find(i => i.id === 'a').columnId, 'doing');
  assert.equal(merged.find(i => i.id === 'a').title, 'A', 'unpatched fields survive');
  assert.equal(items.find(i => i.id === 'a').columnId, 'todo', 'source untouched');
});

test('applyPatches returns the original array when nothing matches', () => {
  const items = board();
  assert.equal(applyPatches(items, null), items);
  assert.equal(applyPatches(items, {}), items);
  assert.equal(applyPatches(items, { ghost: { order: 3 } }), items);
});

// ── patchLanded / prunePatches ────────────────────────────────────────────

test('patchLanded compares arrays by value, not identity', () => {
  const doc = { id: 'a', assigneeIds: ['u1', 'u2'] };
  assert.equal(patchLanded(doc, { assigneeIds: ['u1', 'u2'] }), true);
  assert.equal(patchLanded(doc, { assigneeIds: ['u2', 'u1'] }), false);
  assert.equal(patchLanded(doc, { assigneeIds: ['u1'] }), false);
});

test('patchLanded treats a null patch as satisfied by a missing field', () => {
  assert.equal(patchLanded({ id: 'a' }, { sprintId: null }), true);
  assert.equal(patchLanded({ id: 'a', sprintId: 's1' }, { sprintId: null }), false);
});

test('prunePatches drops overlays the snapshot has caught up with', () => {
  const patches = { a: { columnId: 'doing', order: 1 }, b: { order: 2 } };
  const items = [
    { id: 'a', columnId: 'doing', order: 1 },
    { id: 'b', columnId: 'todo', order: 0 },
  ];

  assert.deepEqual(prunePatches(items, patches), { b: { order: 2 } });
});

test('prunePatches returns null once every overlay has landed', () => {
  const items = [{ id: 'a', columnId: 'doing', order: 1 }];
  assert.equal(prunePatches(items, { a: { columnId: 'doing', order: 1 } }), null);
});

test('prunePatches keeps the same reference while nothing has landed', () => {
  const patches = { a: { order: 5 } };
  const items = [{ id: 'a', order: 0 }];
  assert.equal(prunePatches(items, patches), patches, 'stable identity avoids a re-render');
});

test('prunePatches drops overlays for cards that disappeared', () => {
  assert.equal(prunePatches([], { a: { order: 1 } }), null);
});

// ── the full drop → echo lifecycle ────────────────────────────────────────
//
// This is the regression the whole module exists for: at no point between the
// drop and the server echo may the card be rendered back in its old column.

function columnIdsOf(list, columnId) {
  return list.filter(i => i.columnId === columnId).sort(compareIssues).map(i => i.id);
}

test('a dropped card never renders back in its old column', () => {
  const snapshot = board();
  const plan = planMove(snapshot, 'a', 'doing', 1);

  // 1. Frame after the drop: overlay only, nothing has been written yet.
  let patches = plan.patches;
  let rendered = applyPatches(snapshot, patches).sort(compareIssues);
  assert.deepEqual(columnIdsOf(rendered, 'doing'), ['x', 'a', 'y']);
  assert.deepEqual(columnIdsOf(rendered, 'todo'), ['b', 'c']);

  // 2. A partial echo — a colleague's unrelated edit arrives before our batch.
  const partial = snapshot.map(i => (i.id === 'y' ? { ...i, title: 'Y edited' } : i));
  patches = prunePatches(partial, patches);
  rendered = applyPatches(partial, patches).sort(compareIssues);
  assert.deepEqual(columnIdsOf(rendered, 'doing'), ['x', 'a', 'y'], 'overlay survives an unrelated snapshot');

  // 3. Our batch echoes back.
  const echoed = snapshot.map(i => {
    const patch = plan.patches[i.id];
    return patch ? { ...i, ...patch } : i;
  });
  patches = prunePatches(echoed, patches);
  assert.equal(patches, null, 'overlay retires once the snapshot agrees');

  rendered = applyPatches(echoed, patches).sort(compareIssues);
  assert.deepEqual(columnIdsOf(rendered, 'doing'), ['x', 'a', 'y'], 'and the view is unchanged by its removal');
});

test('reverting a failed move puts the card back where it came from', () => {
  const snapshot = board();
  const plan = planMove(snapshot, 'a', 'doing', 1);

  let patches = plan.patches;
  assert.equal(applyPatches(snapshot, patches).find(i => i.id === 'a').columnId, 'doing');

  // The write was rejected: drop every overlay it created.
  for (const id of Object.keys(plan.patches)) delete patches[id];
  patches = Object.keys(patches).length ? patches : null;

  const rendered = applyPatches(snapshot, patches).sort(compareIssues);
  assert.deepEqual(columnIdsOf(rendered, 'todo'), ['a', 'b', 'c']);
  assert.deepEqual(columnIdsOf(rendered, 'doing'), ['x', 'y']);
});

test('two drops in a row build on each other rather than on stale data', () => {
  const snapshot = board();

  const first = planMove(snapshot, 'a', 'doing', 0);
  const afterFirst = applyPatches(snapshot, first.patches).sort(compareIssues);

  // The second drag starts from what the user can see, not from the snapshot.
  const second = planMove(afterFirst, 'b', 'doing', 0);
  const afterSecond = applyPatches(afterFirst, second.patches).sort(compareIssues);

  assert.deepEqual(columnIdsOf(afterSecond, 'doing'), ['b', 'a', 'x', 'y']);
  assert.deepEqual(columnIdsOf(afterSecond, 'todo'), ['c']);
});

// ── compareIssues ─────────────────────────────────────────────────────────

test('compareIssues sorts by order, then by createdAt', () => {
  const stamp = ms => ({ toMillis: () => ms });

  assert.deepEqual(
    [{ id: 'b', order: 1 }, { id: 'a', order: 0 }].sort(compareIssues).map(i => i.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    [{ id: 'b', createdAt: stamp(2) }, { id: 'a', createdAt: stamp(1) }]
      .sort(compareIssues).map(i => i.id),
    ['a', 'b'],
  );
});

test('compareIssues is total, so a mixed list sorts the same way every pass', () => {
  const stamp = ms => ({ toMillis: () => ms });
  const mixed = [
    { id: 'no-order-late', createdAt: stamp(200) },
    { id: 'ordered-1', order: 1 },
    { id: 'no-order-early', createdAt: stamp(100) },
    { id: 'ordered-0', order: 0 },
  ];

  // The list is sorted once from the snapshot and again after the optimistic
  // overlay is merged in; an ambiguous comparator would reshuffle cards
  // between those two passes, which reads as a flicker.
  const once = [...mixed].sort(compareIssues).map(i => i.id);
  const twice = [...mixed].reverse().sort(compareIssues).map(i => i.id);

  assert.deepEqual(once, ['ordered-0', 'ordered-1', 'no-order-early', 'no-order-late']);
  assert.deepEqual(twice, once);
});

// ── pickPatchableFields ───────────────────────────────────────────────────

test('pickPatchableFields keeps only fields that round-trip through Firestore', () => {
  const kept = pickPatchableFields({
    columnId: 'done',
    sprintId: null,
    assigneeIds: ['u1'],
    // Not patchable: never comes back from the snapshot in the shape we sent.
    dueDate: new Date(),
    description: 'ignored — not in the allowlist',
    updatedAt: { _methodName: 'serverTimestamp' },
  });

  assert.deepEqual(kept, { columnId: 'done', sprintId: null, assigneeIds: ['u1'] });
});

test('pickPatchableFields returns null when nothing is patchable', () => {
  assert.equal(pickPatchableFields({ description: 'x' }), null);
  assert.equal(pickPatchableFields(undefined), null);
});

test('pickPatchableFields skips Firestore sentinels on allowlisted fields', () => {
  // deleteField() on completedAt must not be mirrored as a literal object.
  assert.equal(pickPatchableFields({ order: { _methodName: 'deleteField' } }), null);
});
