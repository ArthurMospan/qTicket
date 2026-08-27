import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  planOrphanStatusMigrations,
  planStatusMigrations,
  statusMigrationTarget,
} from '../src/lib/utils/statusMigrationPlan.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// An organization that has actually used the status editor: two extra statuses
// under «У роботі», one of its own under «Готово».
const current = [
  { id: 'backlog', label: 'Беклог', category: 'backlog' },
  { id: 'todo', label: 'До виконання', category: 'todo' },
  { id: 'in-progress', label: 'У роботі', category: 'in-progress' },
  { id: 'qa', label: 'QA', category: 'in-progress' },
  { id: 'review', label: 'Код-ревʼю', category: 'in-progress' },
  { id: 'shipped', label: 'Відвантажено', category: 'done' },
  { id: 'dropped', label: 'Скасовано', category: 'cancelled' },
];

const defaults = [
  { id: 'backlog', label: 'Беклог', category: 'backlog' },
  { id: 'todo', label: 'До виконання', category: 'todo' },
  { id: 'in-progress', label: 'У роботі', category: 'in-progress' },
  { id: 'done', label: 'Готово', category: 'done' },
  { id: 'cancelled', label: 'Скасовано', category: 'cancelled' },
];

test('work moves inside its own category, never into a closing one by accident', () => {
  assert.equal(
    statusMigrationTarget({ id: 'qa', category: 'in-progress' }, defaults).id,
    'in-progress',
  );
  // A category with no survivor falls back to something that is not "finished":
  // silently completing work is the one outcome nobody wants.
  const withoutDone = defaults.filter(status => status.category !== 'done');
  assert.equal(
    statusMigrationTarget({ id: 'shipped', category: 'done' }, withoutDone).id,
    'backlog',
  );
  // …and losing the tasks is worse than closing them, so the last resort is
  // whatever survives at all.
  const onlyClosed = [{ id: 'done', label: 'Готово', category: 'done' }];
  assert.equal(
    statusMigrationTarget({ id: 'qa', category: 'in-progress' }, onlyClosed).id,
    'done',
  );
  assert.equal(statusMigrationTarget({ id: 'qa', category: 'in-progress' }, []), null);
});

test('resetting to defaults plans a migration for every status that disappears', () => {
  const plan = planStatusMigrations(current, defaults);
  assert.deepEqual(plan, [
    { fromStatusId: 'qa', toStatusId: 'in-progress' },
    { fromStatusId: 'review', toStatusId: 'in-progress' },
    { fromStatusId: 'shipped', toStatusId: 'done' },
    // A renamed default counts as a disappearing status: the id is what the
    // tasks hold, and `dropped` is not `cancelled`.
    { fromStatusId: 'dropped', toStatusId: 'cancelled' },
  ]);
  // A status that survives the reset is not a migration; the server only wants
  // to hear about the ones going away.
  assert.ok(!plan.some(migration => ['backlog', 'todo', 'in-progress'].includes(migration.fromStatusId)));
  // Nothing to move is a valid plan, not an error.
  assert.deepEqual(planStatusMigrations(defaults, defaults), []);
});

test('a status the workflow has already forgotten still gets somewhere to go', () => {
  const planned = planStatusMigrations(current, defaults);
  // What the server reports back in STATUS_MIGRATION_REQUIRED: ids no longer
  // in the workflow document at all, so there is no category to match on.
  const orphans = planOrphanStatusMigrations(
    ['legacy-imported', 'qa', '(empty)', ''],
    defaults,
    planned,
  );
  assert.deepEqual(orphans, [{ fromStatusId: 'legacy-imported', toStatusId: 'backlog' }]);
  assert.deepEqual(planOrphanStatusMigrations(['anything'], []), []);
});

test('both ways of removing a status ask the same question', async () => {
  const settings = await read('src/app/(app)/settings/page.js');
  // The single delete and the reset share one rule; when they did not, reset
  // sent no migrations at all and the server refused every attempt.
  assert.match(settings, /statusMigrationTarget\(targetStatus, remaining\)/);
  assert.match(settings, /planStatusMigrations\(persistedStatuses, DEFAULT_STATUSES\)/);
  // The reset must not fall back to the debounced autosave, which cannot carry
  // migrations.
  assert.doesNotMatch(settings, /apply: \(\) => setStatuses\(DEFAULT_STATUSES\)/);
  assert.match(settings, /planOrphanStatusMigrations\(/);
});
