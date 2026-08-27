// Rebuilds `analyticsRollups` from the raw `timeLogs` they are derived from.
//
// The daily totals exist so that a report about a period costs what the period
// costs. They are written incrementally, inside the same transactions that
// write the logs — which means they are only ever as correct as the last
// deployment, the last retry and the last thing nobody thought of. An aggregate
// with no way back is data a bug corrupts permanently, so this is the way back:
// every figure here is recomputed from scratch and written as an absolute
// total, never as an increment.
//
// It is therefore three tools in one:
//
//   * the migration that fills the collection in the first place;
//   * the repair when a total and its logs disagree;
//   * the audit that says whether they do — a dry run reports every day whose
//     stored figures differ from the recomputed ones, and reports nothing when
//     the incremental path has been doing its job.
//
// Re-running it after an apply is how the migration is declared finished: the
// second pass must find zero differences.
//
// Safety (docs/MIGRATIONS.md):
//   - dry run is the default;
//   - an explicit Firebase project is always required;
//   - apply additionally requires an exact --confirm-project value.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-analytics-rollups.mjs \
//     --project quickteam-prod
//   node --env-file=.env.local scripts/backfill-analytics-rollups.mjs \
//     --project quickteam-prod --organization ORG_ID
//   node --env-file=.env.local scripts/backfill-analytics-rollups.mjs \
//     --project quickteam-prod --apply --confirm-project quickteam-prod \
//     --report ./analytics-rollups.json
//
// Auth (Admin SDK — bypasses Firestore rules, per AGENTS.md migration policy):
//   GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_CLIENT_EMAIL +
//   FIREBASE_PRIVATE_KEY.
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';

import {
  ANALYTICS_ROLLUPS_COLLECTION,
  ANALYTICS_ROLLUP_VERSION,
  analyticsRollupDay,
  analyticsRollupId,
  rebuildRollupTotals,
  rollupTotalsMatch,
} from '../src/lib/utils/analyticsRollups.mjs';
import { normalizeTimeZone } from '../src/lib/utils/timeZone.mjs';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const FIREBASE_PROJECT_ID = argumentValue('--project');
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const ORGANIZATION_ID = argumentValue('--organization');
const REPORT_PATH = argumentValue('--report');
const APPLY = process.argv.includes('--apply');
const BATCH_LIMIT = 400;

if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.startsWith('--')) {
  console.error('Потрібен явний `--project <firebase-project-id>`.');
  process.exit(2);
}
if (APPLY && CONFIRMED_PROJECT_ID !== FIREBASE_PROJECT_ID) {
  console.error('Apply зупинено: `--confirm-project` має точно збігатися з `--project`.');
  process.exit(2);
}

function initAdmin() {
  if (getApps().length) {
    const currentProject = getApp().options.projectId;
    if (currentProject && currentProject !== FIREBASE_PROJECT_ID) {
      throw new Error(`Admin SDK already targets "${currentProject}", expected "${FIREBASE_PROJECT_ID}"`);
    }
    return getApp();
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const options = { projectId: FIREBASE_PROJECT_ID };
  options.credential = clientEmail && privateKey
    ? cert({ projectId: FIREBASE_PROJECT_ID, clientEmail, privateKey })
    : applicationDefault();
  return initializeApp(options);
}

/**
 * Which organizations to rebuild, and what timezone each of them files a day
 * under. The day is a fact about the workspace, so the workspace's own setting
 * decides it — and re-running this after that setting changes is how historical
 * days are re-bucketed.
 */
async function organizationTimeZones(db) {
  const zones = new Map();
  if (ORGANIZATION_ID) {
    const snapshot = await db.collection('organizations').doc(ORGANIZATION_ID).get();
    if (!snapshot.exists) {
      throw new Error(`Організації ${ORGANIZATION_ID} не існує в ${FIREBASE_PROJECT_ID}`);
    }
    zones.set(snapshot.id, normalizeTimeZone(snapshot.data().timezone));
    return zones;
  }
  const snapshot = await db.collection('organizations').get();
  for (const document of snapshot.docs) {
    zones.set(document.id, normalizeTimeZone(document.data().timezone));
  }
  return zones;
}

/**
 * The tasks somebody has called off, so that a rebuilt day can separate «what
 * was logged» from «what still counts» exactly the way the live path does.
 *
 * Read once per organization rather than once per log: a cancelled task is rare
 * and a `cancelledAt` query returns only those.
 */
async function cancelledIssueIds(db, organizationId) {
  const snapshot = await db.collection('issues')
    .where('organizationId', '==', organizationId)
    .where('cancelledAt', '!=', null)
    .select()
    .get();
  return new Set(snapshot.docs.map(document => document.id));
}

async function rebuildOrganization(db, organizationId, timeZone) {
  const cancelled = await cancelledIssueIds(db, organizationId);
  const logs = await db.collection('timeLogs')
    .where('organizationId', '==', organizationId)
    .get();

  // (project, day) → the logs of that day. Grouped in memory on purpose: this
  // is a migration script with the whole collection in hand, and grouping is
  // what lets each day be written once as a total rather than accumulated.
  const buckets = new Map();
  let undated = 0;
  for (const document of logs.docs) {
    const log = document.data();
    const day = analyticsRollupDay(log, timeZone);
    if (!day) {
      undated += 1;
      continue;
    }
    const projectId = log.projectId || '';
    const key = `${projectId}\u0000${day}`;
    if (!buckets.has(key)) buckets.set(key, { projectId, day, logs: [] });
    buckets.get(key).logs.push({ id: document.id, ...log });
  }

  const expected = new Map();
  for (const { projectId, day, logs: dayLogs } of buckets.values()) {
    const totals = rebuildRollupTotals({
      organizationId,
      projectId,
      day,
      logs: dayLogs,
      cancelledIssueIds: cancelled,
    });
    expected.set(analyticsRollupId(organizationId, projectId, day), totals);
  }

  const stored = await db.collection(ANALYTICS_ROLLUPS_COLLECTION)
    .where('organizationId', '==', organizationId)
    .get();
  const storedById = new Map(stored.docs.map(document => [document.id, document.data()]));

  const writes = [];
  const drift = [];
  for (const [id, totals] of expected) {
    const current = storedById.get(id);
    if (current
      && current.version === ANALYTICS_ROLLUP_VERSION
      && rollupTotalsMatch(current, totals)) continue;
    writes.push({ id, totals, existed: Boolean(current) });
    drift.push({
      id,
      reason: !current ? 'missing' : 'differs',
      day: totals.day,
      projectId: totals.projectId,
      stored: current
        ? {
          taskMinutes: current.taskMinutes || 0,
          eventMinutes: current.eventMinutes || 0,
          cancelledTaskMinutes: current.cancelledTaskMinutes || 0,
        }
        : null,
      rebuilt: {
        taskMinutes: totals.taskMinutes,
        eventMinutes: totals.eventMinutes,
        cancelledTaskMinutes: totals.cancelledTaskMinutes,
      },
    });
  }

  // A day whose logs have all gone — purged with a task, or deleted with the
  // project — leaves a document describing nothing. It is removed rather than
  // zeroed, so that «no document» and «a day with no hours» stay the same
  // statement.
  const orphans = [...storedById.keys()].filter(id => !expected.has(id));

  return {
    organizationId,
    timeZone,
    logs: logs.size,
    undated,
    days: expected.size,
    writes,
    orphans,
    drift,
  };
}

async function applyOrganization(db, plan) {
  for (let offset = 0; offset < plan.writes.length; offset += BATCH_LIMIT) {
    const batch = db.batch();
    for (const write of plan.writes.slice(offset, offset + BATCH_LIMIT)) {
      // `set` without merge, and absolute figures rather than increments: this
      // is a rebuild, and a rebuild that merged would inherit exactly the drift
      // it exists to remove.
      batch.set(db.collection(ANALYTICS_ROLLUPS_COLLECTION).doc(write.id), {
        organizationId: write.totals.organizationId,
        projectId: write.totals.projectId,
        day: write.totals.day,
        version: ANALYTICS_ROLLUP_VERSION,
        taskMinutes: write.totals.taskMinutes,
        eventMinutes: write.totals.eventMinutes,
        cancelledTaskMinutes: write.totals.cancelledTaskMinutes,
        minutesByUser: write.totals.minutesByUser,
        cancelledMinutesByUser: write.totals.cancelledMinutesByUser,
        rebuiltAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  }
  for (let offset = 0; offset < plan.orphans.length; offset += BATCH_LIMIT) {
    const batch = db.batch();
    for (const id of plan.orphans.slice(offset, offset + BATCH_LIMIT)) {
      batch.delete(db.collection(ANALYTICS_ROLLUPS_COLLECTION).doc(id));
    }
    await batch.commit();
  }
}

async function run() {
  initAdmin();
  const db = getFirestore();
  const zones = await organizationTimeZones(db);
  console.log(
    `${APPLY ? 'Apply' : 'Dry run'} · ${FIREBASE_PROJECT_ID} · організацій: ${zones.size}`,
  );

  const plans = [];
  for (const [organizationId, timeZone] of zones) {
    const plan = await rebuildOrganization(db, organizationId, timeZone);
    plans.push(plan);
    console.log(
      `  ${organizationId} (${timeZone}): логів ${plan.logs}, днів ${plan.days}`
      + `, до запису ${plan.writes.length}, зайвих ${plan.orphans.length}`
      + (plan.undated ? `, без дати ${plan.undated}` : ''),
    );
    for (const entry of plan.drift.slice(0, 10)) {
      console.log(
        `    ${entry.reason === 'missing' ? '+' : '≠'} ${entry.day}`
        + ` ${entry.projectId || '(без проєкту)'}`
        + ` задачі ${entry.stored?.taskMinutes ?? '—'}→${entry.rebuilt.taskMinutes}`
        + ` події ${entry.stored?.eventMinutes ?? '—'}→${entry.rebuilt.eventMinutes}`
        + ` скасовані ${entry.stored?.cancelledTaskMinutes ?? '—'}→${entry.rebuilt.cancelledTaskMinutes}`,
      );
    }
    if (plan.drift.length > 10) {
      console.log(`    … і ще ${plan.drift.length - 10} — див. --report`);
    }
    if (APPLY) await applyOrganization(db, plan);
  }

  const totals = plans.reduce((sum, plan) => ({
    logs: sum.logs + plan.logs,
    days: sum.days + plan.days,
    writes: sum.writes + plan.writes.length,
    orphans: sum.orphans + plan.orphans.length,
  }), { logs: 0, days: 0, writes: 0, orphans: 0 });

  if (REPORT_PATH) {
    await writeFile(REPORT_PATH, `${JSON.stringify({
      firebaseProject: FIREBASE_PROJECT_ID,
      organization: ORGANIZATION_ID || null,
      applied: APPLY,
      rollupVersion: ANALYTICS_ROLLUP_VERSION,
      generatedAt: new Date().toISOString(),
      totals,
      organizations: plans.map(plan => ({
        organizationId: plan.organizationId,
        timeZone: plan.timeZone,
        logs: plan.logs,
        undated: plan.undated,
        days: plan.days,
        orphans: plan.orphans,
        drift: plan.drift,
      })),
    }, null, 2)}\n`, 'utf8');
    console.log(`Звіт: ${REPORT_PATH}`);
  }

  console.log(
    `\n${APPLY ? 'Записано' : 'Розбіжностей'}: ${totals.writes} день/днів`
    + `, зайвих документів: ${totals.orphans}`
    + ` (логів ${totals.logs}, днів ${totals.days})`,
  );
  if (!APPLY && totals.writes === 0 && totals.orphans === 0) {
    console.log('Підсумки збігаються з сирими логами. Міграція завершена.');
  }
  if (!APPLY) {
    console.log('Це dry run — нічого не записано.');
  }
}

run().catch(error => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
