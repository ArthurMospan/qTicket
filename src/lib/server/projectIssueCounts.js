import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  PROJECT_ISSUE_COUNTS_FIELD,
  PROJECT_ISSUE_COUNTS_VERSION,
  PROJECT_ISSUE_COUNT_KEYS,
  ProjectIssueCountDeltas,
  countingDay,
  projectIssueCountsMatch,
  rebuildProjectIssueCounts,
} from '@/lib/utils/projectIssueCounts.mjs';
import {
  resolveClosedStatusIds,
  resolveDeliveredStatusIds,
} from '@/lib/utils/workflowDefaults.mjs';
import { DEFAULT_ORGANIZATION_TIME_ZONE, normalizeTimeZone } from '@/lib/utils/timeZone.mjs';

// Writing the project task counters. The model, and every word about why they
// exist and what `countedDay` is for, is in
// `src/lib/utils/projectIssueCounts.mjs`; this is the half that needs the Admin
// SDK.
//
// ── Contention ───────────────────────────────────────────────────────────
//
// These are increments on `projects/{id}`, and Firestore sustains roughly one
// write per second on a single document — worth checking against before it
// ships rather than after.
//
// The project document is already the serialization point for almost every task
// mutation in a project: creating a task bumps `issueCounter` on it, a status
// change bumps `issueStatusVersion`, deleting one bumps `issueHierarchyVersion`,
// and a time log writes it twice over. Adding three counters to writes that
// were already touching this exact document cannot make its throughput worse.
//
// The one place that deliberately does *not* write it per task is the bulk
// route, which found out the hard way that fifty concurrent transactions on one
// project document serialise the whole operation behind a hot row. So bulk
// accumulates its deltas across the loop and commits them once, in the same
// batch that touches `updatedAt` — one write per project, not one per task.

const CONTEXT_TTL_MS = 5 * 60 * 1000;
const contextCache = new Map();

/**
 * What an organization has to say before a task means anything to a counter:
 * which statuses deliver, which close, and what a calendar day is where the
 * workspace is.
 *
 * Cached in process for a few minutes, exactly like the reminder sweep's
 * equivalent. Both documents change about once a year, a write path pays for
 * them on an action somebody just performed, and Vercel reuses a function
 * instance across requests, so this is usually free.
 */
export async function organizationCountContext(db, organizationId) {
  if (!organizationId) {
    return {
      deliveredStatusIds: new Set(resolveDeliveredStatusIds()),
      closedStatusIds: new Set(resolveClosedStatusIds()),
      timeZone: DEFAULT_ORGANIZATION_TIME_ZONE,
    };
  }
  const cached = contextCache.get(organizationId);
  if (cached && Date.now() - cached.readAtMs < CONTEXT_TTL_MS) return cached.value;
  let value;
  try {
    const [organizationSnapshot, workflowSnapshot] = await db.getAll(
      db.collection('organizations').doc(organizationId),
      db.collection('organizations').doc(organizationId).collection('settings').doc('workflow'),
    );
    const statuses = workflowSnapshot?.data()?.statuses;
    value = {
      deliveredStatusIds: new Set(resolveDeliveredStatusIds(statuses)),
      closedStatusIds: new Set(resolveClosedStatusIds(statuses)),
      timeZone: normalizeTimeZone(organizationSnapshot?.data()?.timezone || ''),
    };
  } catch {
    // A counter that files a task under the wrong figure is a smaller failure
    // than a task that refuses to save because a lookup blinked. The recount
    // corrects it; a failed write cannot be corrected by anything.
    value = {
      deliveredStatusIds: new Set(resolveDeliveredStatusIds()),
      closedStatusIds: new Set(resolveClosedStatusIds()),
      timeZone: DEFAULT_ORGANIZATION_TIME_ZONE,
    };
  }
  contextCache.set(organizationId, { readAtMs: Date.now(), value });
  return value;
}

/** Only for tests and for the workflow or the timezone actually changing. */
export function forgetCountContext(organizationId) {
  if (organizationId) contextCache.delete(organizationId);
  else contextCache.clear();
}

/** A fresh accumulator, preloaded with what this organization counts by. */
export async function projectIssueCountDeltasFor(db, organizationId) {
  return new ProjectIssueCountDeltas(await organizationCountContext(db, organizationId));
}

/**
 * One project's increments, as fields to spread into an update the caller is
 * already making.
 *
 * Most routes that change a task already write the project document in the same
 * transaction — `issueCounter` on create, `issueStatusVersion` on a status
 * change, `issueHierarchyVersion` on a delete. Firestore does allow a second
 * write to the same document in one commit (checked against the emulator, not
 * assumed), so this is not a restriction; it is one mutation instead of two,
 * and it keeps the counter change attached to the write it belongs to rather
 * than sitting somewhere else in the same transaction.
 *
 * Increments are written as dotted paths, so a delta never has to read, rewrite
 * or even know about the rest of the block — `countedAt` and `countedDay` in
 * particular, which only a full recount is allowed to touch.
 */
export function projectIssueCountIncrements(deltas, projectId) {
  const changed = Array.isArray(deltas) ? deltas : deltas.changed();
  const entry = changed.find(candidate => candidate.projectId === projectId);
  const payload = {};
  if (!entry) return payload;
  for (const key of PROJECT_ISSUE_COUNT_KEYS) {
    if (entry[key] !== 0) {
      payload[`${PROJECT_ISSUE_COUNTS_FIELD}.${key}`] = FieldValue.increment(entry[key]);
    }
  }
  return payload;
}

/**
 * Apply a set of per-project deltas.
 *
 * `writer` is a transaction or a batch — `update` has the same signature on
 * both, and both are used: a single task mutation rides inside the transaction
 * that writes the task, while a bulk operation over fifty of them rides in one
 * batch after the loop. Use `projectIssueCountIncrements` instead wherever the
 * caller already writes the project document itself.
 *
 * Every field is an increment written through a dotted path, never an
 * assignment, because two people acting on the same project must not overwrite
 * each other's contribution. `countedAt`, `countedDay` and `version` are
 * deliberately *not* written here: they are the statement that a full recount
 * once established these totals, and an increment establishes nothing.
 *
 * Returns how many documents were written, so a caller can keep itself inside
 * Firestore's per-transaction write limit.
 */
export function writeProjectIssueCountDeltas({ writer, db, deltas }) {
  const changed = Array.isArray(deltas) ? deltas : deltas.changed();
  for (const entry of changed) {
    const payload = {};
    for (const key of PROJECT_ISSUE_COUNT_KEYS) {
      if (entry[key] !== 0) {
        payload[`${PROJECT_ISSUE_COUNTS_FIELD}.${key}`] = FieldValue.increment(entry[key]);
      }
    }
    if (!Object.keys(payload).length) continue;
    writer.update(db.collection('projects').doc(entry.projectId), payload);
  }
  return changed.length;
}

/**
 * The same deltas, when they must not ride inside the caller's transaction.
 *
 * Every field is an increment, so a run that fails half way leaves the counters
 * short by the half that did not land — and the next recount repairs exactly
 * that, instead of doubling what already did.
 */
export async function commitProjectIssueCountDeltas(db, deltas) {
  const changed = Array.isArray(deltas) ? deltas : deltas.changed();
  for (let offset = 0; offset < changed.length; offset += 400) {
    const batch = db.batch();
    writeProjectIssueCountDeltas({
      writer: batch,
      db,
      deltas: changed.slice(offset, offset + 400),
    });
    await batch.commit();
  }
  return changed.length;
}

/**
 * The counters a project starts life with.
 *
 * A project created between two recounts has no established totals, so nothing
 * would read its counters until the next pass — and a brand-new project's
 * counters are three zeroes, which is a total that can be established without
 * reading anything at all. Written by `/api/projects` inside the same
 * transaction that creates the project.
 */
export function initialProjectIssueCounts(timeZone, nowMs = Date.now()) {
  return {
    version: PROJECT_ISSUE_COUNTS_VERSION,
    total: 0,
    delivered: 0,
    overdue: 0,
    countedDay: countingDay(nowMs, timeZone),
    countedAt: Timestamp.fromMillis(nowMs),
  };
}

const RECOUNT_PROJECTION = [
  'organizationId',
  'projectId',
  'columnId',
  'status',
  'dueDate',
  'archivedAt',
  'cancelledAt',
  'deletionPending',
];

/**
 * Recompute every project's counters from the tasks themselves, and advance the
 * day they answer for.
 *
 * This is the only thing that makes `overdue` true again. A task nobody touches
 * slips its deadline at the workspace's own midnight, and no write happens at
 * midnight — so somebody has to come and look. That somebody is the twice-daily
 * materialise pass, which already exists, already runs at two times twelve
 * hours apart precisely so that one of them lands in the early morning of any
 * given timezone, and already reads deadlines. Hanging the recount on it costs
 * one pass, not a new schedule — and a new schedule is not available anyway:
 * Vercel Hobby allows one cron a day, and a sub-daily entry in `vercel.json`
 * stops deployments being created at all.
 *
 * It is also the repair path. `total` and `delivered` are kept by increments,
 * and increments are only ever as correct as the last deployment, the last
 * retry and the last thing nobody thought of. Here every figure is recomputed
 * from scratch and written as an absolute total, which is what makes a bug in
 * the delta path a temporary wrong number rather than a permanent one.
 *
 * The cost is one read per task, twice a day, on the server — against a client
 * that was reading every task of every project on every visit to the front
 * door, in every tab. `select()` keeps the payload to the eight fields a count
 * depends on; it does not reduce the read count, because nothing does.
 *
 * A delta committed between this pass's read and its write is lost, exactly as
 * it is for `scripts/backfill-analytics-rollups.mjs`, and for the same reason:
 * a full total is what a concurrent write clobbers. The next pass finds it.
 *
 * @param {{nowMs?: number, organizationIds?: string[]}} options
 */
export async function recountProjectIssueCounts({ nowMs = Date.now(), organizationIds } = {}) {
  const db = getAdminDb();

  // Projects first: a project whose last task was deleted has to be reported as
  // zero, and a project with no tasks at all has to be established rather than
  // left unreadable. Projects are bounded by the size of the business, not by
  // use, so this is the cheap half.
  const wanted = Array.isArray(organizationIds) && organizationIds.length
    ? new Set(organizationIds)
    : null;
  const projectsCollection = db.collection('projects');
  const projectSnapshot = await (wanted?.size === 1
    ? projectsCollection.where('organizationId', '==', organizationIds[0])
    : projectsCollection
  ).select('organizationId', PROJECT_ISSUE_COUNTS_FIELD).get();
  const projects = projectSnapshot.docs
    .map(document => ({ ...document.data(), id: document.id }))
    .filter(project => project.organizationId && (!wanted || wanted.has(project.organizationId)));
  if (!projects.length) return { organizations: 0, projects: 0, written: 0, unchanged: 0 };

  const organizations = [...new Set(projects.map(project => project.organizationId))];
  const contexts = new Map(await Promise.all(
    organizations.map(async id => [id, await organizationCountContext(db, id)]),
  ));

  let written = 0;
  let unchanged = 0;
  const batches = [];
  let batch = db.batch();
  let batched = 0;

  for (const organizationId of organizations) {
    const context = contexts.get(organizationId);
    const countedDay = countingDay(nowMs, context.timeZone);
    const organizationProjects = projects.filter(project => project.organizationId === organizationId);
    const issueSnapshot = await db.collection('issues')
      .where('organizationId', '==', organizationId)
      .select(...RECOUNT_PROJECTION)
      .get();
    const totals = rebuildProjectIssueCounts(
      issueSnapshot.docs.map(document => ({ ...document.data(), id: document.id })),
      {
        deliveredStatusIds: context.deliveredStatusIds,
        closedStatusIds: context.closedStatusIds,
        countedDay,
        timeZone: context.timeZone,
        projectIds: organizationProjects.map(project => project.id),
      },
    );
    for (const project of organizationProjects) {
      const computed = totals.get(project.id) || { total: 0, delivered: 0, overdue: 0 };
      const stored = project[PROJECT_ISSUE_COUNTS_FIELD];
      // Same numbers, same day: nothing to say. The pass runs twice a day over
      // every project of every workspace, and most of them did not move.
      if (projectIssueCountsMatch(stored, computed, countedDay)) {
        unchanged += 1;
        continue;
      }
      batch.set(db.collection('projects').doc(project.id), {
        [PROJECT_ISSUE_COUNTS_FIELD]: {
          version: PROJECT_ISSUE_COUNTS_VERSION,
          ...computed,
          countedDay,
          countedAt: Timestamp.fromMillis(nowMs),
        },
      }, { merge: true });
      written += 1;
      batched += 1;
      if (batched >= 400) {
        batches.push(batch.commit());
        batch = db.batch();
        batched = 0;
      }
    }
  }
  if (batched > 0) batches.push(batch.commit());
  await Promise.all(batches);

  return {
    organizations: organizations.length,
    projects: projects.length,
    written,
    unchanged,
  };
}
