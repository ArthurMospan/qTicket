// src/lib/utils/statusMigrationPlan.mjs — where the work goes when a status
// stops existing.
//
// The server will not delete a status out from under the tasks standing on it:
// a workflow change that drops a status has to say, for each one, where those
// tasks move (`statusMigrations`). Deleting a single status asked that question
// and answered it. «Скинути до стандартних» did not — it replaced the status
// list locally and let the debounced autosave post it with no migrations at
// all, so the server refused with "Для видалених або застарілих статусів
// потрібно вибрати ціль міграції" and the reset silently rolled back. Any
// organization with real work on a custom status could never reset again.
//
// Both paths now ask the same question here, so they cannot drift apart.

import { entryStatusId, isClosingCategory } from './statusCategories.mjs';

/**
 * The status a disappearing one hands its tasks to.
 *
 * Same category first — deleting «QA» must not push its work into «Готово»
 * just because that happens to be next in the list. Then anything that does
 * not close a task, because silently completing work is the one outcome nobody
 * wants. Then whatever is left, because losing the tasks is worse still.
 *
 * @param {object} status The status going away; only its `category` is read.
 * @param {object[]} nextStatuses The statuses that will exist afterwards.
 * @returns {object|null} The destination, or null when nothing survives.
 */
export function statusMigrationTarget(status, nextStatuses) {
  const survivors = (nextStatuses || []).filter(candidate => candidate?.id);
  if (survivors.length === 0) return null;
  return survivors.find(candidate => candidate.category === status?.category)
    || survivors.find(candidate => !isClosingCategory(candidate.category))
    || survivors[0];
}

/**
 * Every migration a workflow change needs, in the order the statuses are
 * listed. A status that survives is absent: the server only wants to hear
 * about the ones going away.
 *
 * @param {object[]} currentStatuses The workflow as it stands.
 * @param {object[]} nextStatuses The workflow being saved.
 * @returns {{fromStatusId: string, toStatusId: string}[]}
 */
export function planStatusMigrations(currentStatuses, nextStatuses) {
  const survivingIds = new Set((nextStatuses || []).map(status => status?.id).filter(Boolean));
  const planned = [];
  const seen = new Set();
  for (const status of currentStatuses || []) {
    const fromStatusId = status?.id;
    if (!fromStatusId || survivingIds.has(fromStatusId) || seen.has(fromStatusId)) continue;
    const target = statusMigrationTarget(status, nextStatuses);
    if (!target) continue;
    seen.add(fromStatusId);
    planned.push({ fromStatusId, toStatusId: target.id });
  }
  return planned;
}

/**
 * Migrations for status ids the workflow no longer describes at all.
 *
 * A task can stand on a status the workflow document has already forgotten —
 * an import, a status removed before this rule existed, an older schema. There
 * is no category to match on, so those tasks go to the entry status: the one
 * place in a workflow that always accepts work and never means "finished".
 * This is what the server reports back in `STATUS_MIGRATION_REQUIRED`, and it
 * is the difference between a reset that can complete and one that cannot.
 *
 * @param {string[]} orphanStatusIds Status ids the server is still asking about.
 * @param {object[]} nextStatuses The statuses that will exist afterwards.
 * @param {{fromStatusId: string}[]} alreadyPlanned Migrations already being sent.
 */
export function planOrphanStatusMigrations(orphanStatusIds, nextStatuses, alreadyPlanned = []) {
  const covered = new Set(alreadyPlanned.map(migration => migration.fromStatusId));
  const fallbackId = entryStatusId(nextStatuses)
    || statusMigrationTarget({}, nextStatuses)?.id
    || '';
  if (!fallbackId) return [];
  return [...new Set(orphanStatusIds || [])]
    .filter(statusId => statusId && statusId !== '(empty)' && !covered.has(statusId))
    .map(statusId => ({ fromStatusId: statusId, toStatusId: fallbackId }));
}
