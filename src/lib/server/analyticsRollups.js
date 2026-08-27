import { FieldValue } from 'firebase-admin/firestore';
import 'server-only';

import {
  ANALYTICS_ROLLUPS_COLLECTION,
  ANALYTICS_ROLLUP_VERSION,
  AnalyticsRollupDeltas,
  analyticsRollupId,
} from '@/lib/utils/analyticsRollups.mjs';
import { DEFAULT_ORGANIZATION_TIME_ZONE, normalizeTimeZone } from '@/lib/utils/timeZone.mjs';

// Writing the daily totals. The model, and every word about why it exists, is
// in `src/lib/utils/analyticsRollups.mjs`; this is the half that needs the
// Admin SDK.
//
// ── Contention ───────────────────────────────────────────────────────────
//
// Firestore sustains roughly one write per second on a single document, so a
// counter keyed by (organization, project, day) is worth checking against
// before it ships rather than after.
//
// It is fine, and the reason is not the arithmetic — it is that this document
// is never the busiest one in its own transaction. Every task time log already
// updates `issues/{id}` and `projects/{id}` in the same transaction
// (`applyTaskTimeLogMutation`), and every calendar time log already updates
// `calendarEvents/{id}` and `projects/{id}`. The project document is therefore
// already the serialization point for time entry in a project, and it is *more*
// contended than the rollup would be: it takes every project's time logs of
// every day, while a rollup takes one project's logs of one day. Adding a write
// that is strictly less contended than one already in the transaction cannot
// make the transaction's throughput worse, so sharding this counter would buy
// nothing that sharding `projects/{id}` would not have to buy first.
//
// The arithmetic agrees, for what it is worth: a time log is written when a
// person stops a timer, which is a handful of times a person per day. Fifty
// people at ten entries each is five hundred writes spread over a working day,
// split further across projects — three orders of magnitude below the limit.
// Even the pathological burst (everybody stopping at six o'clock) is a few
// writes a second for a few seconds, which Firestore answers with latency and a
// transaction retry, not with an error.
//
// Should that ever stop being true, the shard goes on the *day* key
// (`…_{day}#{shard}`) and the reader sums the shards — but it would have to go
// on `projects/{id}` first.

const timeZoneCache = new Map();

/**
 * The organization's timezone, read once per process rather than once per write.
 *
 * Deliberately read outside the transaction: it decides which day a log is
 * filed under, and it changes approximately never. A stale value for one write
 * files one log under yesterday, which the backfill corrects; making every time
 * entry contend on the organization document to avoid that would be the more
 * expensive mistake.
 */
export async function organizationRollupTimeZone(db, organizationId) {
  if (!organizationId) return DEFAULT_ORGANIZATION_TIME_ZONE;
  if (timeZoneCache.has(organizationId)) return timeZoneCache.get(organizationId);
  let timeZone = DEFAULT_ORGANIZATION_TIME_ZONE;
  try {
    const snapshot = await db.collection('organizations').doc(organizationId).get();
    timeZone = normalizeTimeZone(snapshot.exists ? snapshot.data().timezone : '');
  } catch {
    // A report that buckets an hour into the wrong day is a smaller failure
    // than a time entry that refuses to save because a lookup blinked.
    timeZone = DEFAULT_ORGANIZATION_TIME_ZONE;
  }
  timeZoneCache.set(organizationId, timeZone);
  return timeZone;
}

/** Only for tests and for the timezone actually changing. */
export function forgetRollupTimeZone(organizationId) {
  if (organizationId) timeZoneCache.delete(organizationId);
  else timeZoneCache.clear();
}

export async function analyticsRollupDeltasFor(db, organizationId) {
  return new AnalyticsRollupDeltas(await organizationRollupTimeZone(db, organizationId));
}

function incrementMap(values) {
  const result = {};
  for (const [key, amount] of Object.entries(values || {})) {
    if (amount !== 0) result[key] = FieldValue.increment(amount);
  }
  return result;
}

/**
 * Apply a set of per-day deltas.
 *
 * `writer` is a transaction or a batch — `set` has the same signature on both,
 * and both are used: a single time entry rides inside the transaction that
 * writes the log, while a purge that removes hundreds of logs rides in the
 * batches that delete them.
 *
 * Every field is an increment, never an assignment, because two people logging
 * time on the same day must not overwrite each other's contribution. The
 * identity fields are written alongside so a document created by a delta is
 * still queryable by organization, project and day.
 *
 * Returns how many documents were written, so a caller can keep itself inside
 * Firestore's per-transaction write limit.
 */
export function writeAnalyticsRollupDeltas({ writer, db, deltas }) {
  const changed = Array.isArray(deltas) ? deltas : deltas.changed();
  for (const entry of changed) {
    const ref = db.collection(ANALYTICS_ROLLUPS_COLLECTION)
      .doc(analyticsRollupId(entry.organizationId, entry.projectId, entry.day));
    const payload = {
      organizationId: entry.organizationId,
      projectId: entry.projectId,
      day: entry.day,
      version: ANALYTICS_ROLLUP_VERSION,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (entry.taskMinutes !== 0) payload.taskMinutes = FieldValue.increment(entry.taskMinutes);
    if (entry.eventMinutes !== 0) payload.eventMinutes = FieldValue.increment(entry.eventMinutes);
    if (entry.cancelledTaskMinutes !== 0) {
      payload.cancelledTaskMinutes = FieldValue.increment(entry.cancelledTaskMinutes);
    }
    const byUser = incrementMap(entry.minutesByUser);
    if (Object.keys(byUser).length) payload.minutesByUser = byUser;
    const cancelledByUser = incrementMap(entry.cancelledMinutesByUser);
    if (Object.keys(cancelledByUser).length) {
      payload.cancelledMinutesByUser = cancelledByUser;
    }
    writer.set(ref, payload, { merge: true });
  }
  return changed.length;
}

/**
 * The same deltas, when there are more of them than one transaction may write.
 *
 * Every field is an increment, so a run that fails half way leaves the totals
 * short by the half that did not land — and running it again repairs exactly
 * that, instead of doubling what already did.
 */
export async function commitAnalyticsRollupDeltas(db, deltas) {
  const changed = Array.isArray(deltas) ? deltas : deltas.changed();
  for (let offset = 0; offset < changed.length; offset += 400) {
    const batch = db.batch();
    writeAnalyticsRollupDeltas({
      writer: batch,
      db,
      deltas: changed.slice(offset, offset + 400),
    });
    await batch.commit();
  }
  return changed.length;
}

/**
 * Every rollup a project owns, for the one case where correcting the totals is
 * the wrong answer: the project itself is being deleted, and its days no longer
 * describe anything.
 */
export async function deleteProjectAnalyticsRollups(db, organizationId, projectId) {
  const snapshot = await db.collection(ANALYTICS_ROLLUPS_COLLECTION)
    .where('organizationId', '==', organizationId)
    .where('projectId', '==', projectId)
    .get();
  for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
    const batch = db.batch();
    snapshot.docs.slice(offset, offset + 400).forEach(document => batch.delete(document.ref));
    await batch.commit();
  }
  return snapshot.size;
}
