// Rebuilds `projects/{id}.issueCounts` from the tasks they are derived from.
//
// The home screen draws a progress bar per project, and it computes it by
// reading every task of every project the account can open. Three numbers on
// the project document replace that with one read per card — but only if the
// numbers are the ones the tasks would have produced, and only once a full
// count has stood behind them at least once. Nothing reads a project's counters
// until it has: `projectIssueCounts()` returns `null` for a block with no
// `countedAt`, precisely so that an unestablished counter sends the reader back
// to the tasks instead of drawing a bar out of increments that started from an
// unknown number.
//
// So this is four tools in one:
//
//   * the migration that establishes the counters in the first place — until it
//     has run against a workspace, that workspace's cards keep computing from
//     the tasks and nothing changes;
//   * the repair when the stored figures and the tasks disagree;
//   * the audit that says whether they do — a dry run reports every project
//     whose stored counts differ from the recomputed ones, and reports nothing
//     when the incremental path has been doing its job;
//   * the way back, if a bug in a delta ever corrupts a figure.
//
// This is the «звірка» step: run it dry against production, read the report, and
// only then let a screen stop reading the tasks. Re-running it after an apply is
// how the migration is declared finished — the second pass must find zero
// differences.
//
// The live product does the same thing on its own twice a day
// (`recountProjectIssueCounts`, on the materialise pass). This script exists for
// the moments a schedule is not good enough: the first run, and any moment
// somebody needs to know *now* whether the numbers are true.
//
// Safety (docs/MIGRATIONS.md):
//   - dry run is the default;
//   - an explicit Firebase project is always required;
//   - apply additionally requires an exact --confirm-project value.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-project-issue-counts.mjs \
//     --project quickteam-me
//   node --env-file=.env.local scripts/backfill-project-issue-counts.mjs \
//     --project quickteam-me --organization ORG_ID
//   node --env-file=.env.local scripts/backfill-project-issue-counts.mjs \
//     --project quickteam-me --apply --confirm-project quickteam-me \
//     --report ./project-issue-counts.json
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
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';

import {
  PROJECT_ISSUE_COUNTS_FIELD,
  PROJECT_ISSUE_COUNTS_VERSION,
  PROJECT_ISSUE_COUNT_KEYS,
  countingDay,
  projectIssueCountsMatch,
  rebuildProjectIssueCounts,
} from '../src/lib/utils/projectIssueCounts.mjs';
import {
  resolveClosedStatusIds,
  resolveDeliveredStatusIds,
} from '../src/lib/utils/workflowDefaults.mjs';
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
 * What each organization counts by: which statuses deliver, which close, and
 * what a calendar day is where the workspace is. All three decide what a task
 * contributes, and all three belong to the workspace rather than to whoever is
 * running this.
 */
async function organizationContexts(db) {
  const contexts = new Map();
  const ids = [];
  if (ORGANIZATION_ID) {
    const snapshot = await db.collection('organizations').doc(ORGANIZATION_ID).get();
    if (!snapshot.exists) {
      throw new Error(`Організації ${ORGANIZATION_ID} не існує в ${FIREBASE_PROJECT_ID}`);
    }
    ids.push([snapshot.id, snapshot.data()]);
  } else {
    const snapshot = await db.collection('organizations').get();
    for (const document of snapshot.docs) ids.push([document.id, document.data()]);
  }
  for (const [id, organization] of ids) {
    const workflow = await db.collection('organizations').doc(id)
      .collection('settings').doc('workflow').get();
    const statuses = workflow.exists ? workflow.data().statuses : null;
    contexts.set(id, {
      deliveredStatusIds: new Set(resolveDeliveredStatusIds(statuses)),
      closedStatusIds: new Set(resolveClosedStatusIds(statuses)),
      timeZone: normalizeTimeZone(organization?.timezone || ''),
    });
  }
  return contexts;
}

// The fields a count depends on, and nothing else. `select()` does not reduce
// the number of documents read — nothing does — but it keeps a migration over a
// whole workspace from pulling every task's description across the wire.
const PROJECTION = [
  'organizationId',
  'projectId',
  'columnId',
  'status',
  'dueDate',
  'archivedAt',
  'cancelledAt',
  'deletionPending',
];

async function rebuildOrganization(db, organizationId, context, nowMs) {
  const countedDay = countingDay(nowMs, context.timeZone);
  const [projectSnapshot, issueSnapshot] = await Promise.all([
    db.collection('projects').where('organizationId', '==', organizationId).get(),
    db.collection('issues')
      .where('organizationId', '==', organizationId)
      .select(...PROJECTION)
      .get(),
  ]);
  const projects = projectSnapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  const totals = rebuildProjectIssueCounts(
    issueSnapshot.docs.map(document => ({ ...document.data(), id: document.id })),
    {
      deliveredStatusIds: context.deliveredStatusIds,
      closedStatusIds: context.closedStatusIds,
      countedDay,
      timeZone: context.timeZone,
      projectIds: projects.map(project => project.id),
    },
  );

  const drift = [];
  const writes = [];
  for (const project of projects) {
    const computed = totals.get(project.id) || { total: 0, delivered: 0, overdue: 0 };
    const stored = project[PROJECT_ISSUE_COUNTS_FIELD] || null;
    if (projectIssueCountsMatch(stored, computed, countedDay)) continue;
    writes.push({ id: project.id, computed });
    drift.push({
      organizationId,
      projectId: project.id,
      name: project.name || '',
      reason: !stored ? 'missing' : (stored.countedDay !== countedDay ? 'stale-day' : 'differs'),
      countedDay,
      stored: stored
        ? Object.fromEntries(PROJECT_ISSUE_COUNT_KEYS.map(key => [key, Number(stored[key]) || 0]))
        : null,
      rebuilt: computed,
    });
  }

  if (APPLY) {
    for (let offset = 0; offset < writes.length; offset += BATCH_LIMIT) {
      const batch = db.batch();
      for (const write of writes.slice(offset, offset + BATCH_LIMIT)) {
        batch.set(db.collection('projects').doc(write.id), {
          [PROJECT_ISSUE_COUNTS_FIELD]: {
            version: PROJECT_ISSUE_COUNTS_VERSION,
            ...write.computed,
            countedDay,
            countedAt: Timestamp.fromMillis(nowMs),
          },
        }, { merge: true });
      }
      await batch.commit();
    }
  }

  return {
    organizationId,
    countedDay,
    timeZone: context.timeZone,
    projects: projects.length,
    issues: issueSnapshot.size,
    drift,
  };
}

async function main() {
  initAdmin();
  const db = getFirestore();
  const nowMs = Date.now();
  const contexts = await organizationContexts(db);

  const results = [];
  for (const [organizationId, context] of contexts) {
    results.push(await rebuildOrganization(db, organizationId, context, nowMs));
  }

  const drift = results.flatMap(result => result.drift);
  const totalProjects = results.reduce((sum, result) => sum + result.projects, 0);
  const totalIssues = results.reduce((sum, result) => sum + result.issues, 0);

  console.log(`Проєкт Firebase : ${FIREBASE_PROJECT_ID}`);
  console.log(`Режим           : ${APPLY ? 'APPLY (записує)' : 'DRY RUN (нічого не пише)'}`);
  console.log(`Організацій     : ${results.length}`);
  console.log(`Проєктів        : ${totalProjects}`);
  console.log(`Завдань прочитано: ${totalIssues}`);
  console.log(`Розбіжностей    : ${drift.length}`);
  for (const entry of drift.slice(0, 50)) {
    const stored = entry.stored
      ? PROJECT_ISSUE_COUNT_KEYS.map(key => `${key}=${entry.stored[key]}`).join(' ')
      : '—';
    const rebuilt = PROJECT_ISSUE_COUNT_KEYS.map(key => `${key}=${entry.rebuilt[key]}`).join(' ');
    console.log(`  ${entry.projectId} «${entry.name}» [${entry.reason}]`);
    console.log(`    було : ${stored}`);
    console.log(`    стало: ${rebuilt}`);
  }
  if (drift.length > 50) console.log(`  … і ще ${drift.length - 50}`);

  if (REPORT_PATH) {
    await writeFile(REPORT_PATH, `${JSON.stringify({
      firebaseProject: FIREBASE_PROJECT_ID,
      apply: APPLY,
      generatedAt: new Date(nowMs).toISOString(),
      organizations: results.map(({ drift: _drift, ...rest }) => rest),
      drift,
    }, null, 2)}\n`, 'utf8');
    console.log(`Звіт            : ${REPORT_PATH}`);
  }

  if (!APPLY && drift.length) {
    console.log('');
    console.log('Щоб застосувати:');
    console.log(`  node --env-file=.env.local scripts/backfill-project-issue-counts.mjs --project ${FIREBASE_PROJECT_ID} --apply --confirm-project ${FIREBASE_PROJECT_ID}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
