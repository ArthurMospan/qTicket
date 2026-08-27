// Recomputes issues.spentMinutes from canonical raw task time logs.
//
// Safety:
//   - dry-run is the default;
//   - an explicit Firebase project is mandatory;
//   - apply requires the same id again via --confirm-project;
//   - every apply write re-reads the issue and its logs transactionally.
//
// Usage:
//   node --env-file=.env.local scripts/reconcile-issue-spent-minutes.mjs \
//     --project quickteam-prod --report C:\tmp\spent-minutes-dry-run.json
//   node --env-file=.env.local scripts/reconcile-issue-spent-minutes.mjs \
//     --project quickteam-prod --apply --confirm-project quickteam-prod
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
  reconcileIssueSpentMinutes,
} from '../src/lib/utils/timeLogReconciliation.mjs';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const firebaseProjectId = argumentValue('--project');
const confirmedProjectId = argumentValue('--confirm-project');
const organizationId = argumentValue('--organization');
const reportPath = argumentValue('--report');
const apply = process.argv.includes('--apply');
const writesFrozen = process.argv.includes('--confirm-writes-frozen');

if (!firebaseProjectId || firebaseProjectId.startsWith('--')) {
  console.error('Потрібен явний `--project <firebase-project-id>`.');
  process.exit(2);
}
if (apply && confirmedProjectId !== firebaseProjectId) {
  console.error('Apply зупинено: `--confirm-project` має точно збігатися з `--project`.');
  process.exit(2);
}
if (apply && !writesFrozen) {
  console.error(
    'Apply зупинено: спочатку закрийте legacy-записи часу й додайте '
    + '`--confirm-writes-frozen`.',
  );
  process.exit(2);
}

function initAdmin() {
  if (getApps().length) {
    const currentProject = getApp().options.projectId;
    if (currentProject && currentProject !== firebaseProjectId) {
      throw new Error(
        `Admin SDK already targets "${currentProject}", expected "${firebaseProjectId}"`,
      );
    }
    return getApp();
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const options = { projectId: firebaseProjectId };
  if (clientEmail && privateKey) {
    options.credential = cert({
      projectId: firebaseProjectId,
      clientEmail,
      privateKey,
    });
  } else {
    options.credential = applicationDefault();
  }
  return initializeApp(options);
}

function numericMirror(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function mirrorIsCanonical(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function applyIssueReconciliation(db, issueId) {
  const issueRef = db.collection('issues').doc(issueId);
  return db.runTransaction(async transaction => {
    const issueSnapshot = await transaction.get(issueRef);
    if (!issueSnapshot.exists || issueSnapshot.data().deletionPending === true) {
      return { status: 'skipped', reason: 'issue-missing-or-deleting' };
    }
    const issue = { id: issueSnapshot.id, ...issueSnapshot.data() };
    const logsSnapshot = await transaction.get(
      db.collection('timeLogs').where('issueId', '==', issueId),
    );
    const logs = logsSnapshot.docs.map(document => ({
      id: document.id,
      ...document.data(),
    }));
    const reconciliation = reconcileIssueSpentMinutes(issue, logs);
    if (!reconciliation.scopeValid || reconciliation.rejectedLogIds.length > 0) {
      return {
        status: 'manual-review',
        reason: reconciliation.scopeValid
          ? 'rejected-scoped-time-logs'
          : 'invalid-issue-scope',
        ...reconciliation,
      };
    }
    const current = numericMirror(issue.spentMinutes);
    if (
      mirrorIsCanonical(issue.spentMinutes)
      && current === reconciliation.spentMinutes
      && issue.spentMinutesMirrorVersion === 1
    ) {
      return { status: 'unchanged', ...reconciliation };
    }
    transaction.update(issueRef, {
      spentMinutes: reconciliation.spentMinutes,
      spentMinutesMirrorVersion: 1,
      spentMinutesReconciledAt: FieldValue.serverTimestamp(),
    });
    return {
      status: 'updated',
      from: current,
      to: reconciliation.spentMinutes,
      ...reconciliation,
    };
  });
}

async function main() {
  const app = initAdmin();
  const db = getFirestore(app);
  let issuesQuery = db.collection('issues');
  if (organizationId) {
    issuesQuery = issuesQuery.where('organizationId', '==', organizationId);
  }
  const issuesSnapshot = await issuesQuery.get();
  const issues = issuesSnapshot.docs.map(document => ({
    id: document.id,
    ...document.data(),
  }));

  // An organization filter scopes which issues may be changed, not which logs
  // are inspected. A malformed log can point at an in-scope issue while
  // carrying a wrong/missing organizationId; filtering logs only by org would
  // hide that evidence and could incorrectly certify the mirror as version 1.
  const logDocumentsById = new Map();
  if (organizationId) {
    const organizationLogs = await db.collection('timeLogs')
      .where('organizationId', '==', organizationId)
      .get();
    organizationLogs.docs.forEach(document => {
      logDocumentsById.set(document.id, document);
    });
    for (const issueIdChunk of chunkArray(
      issues.map(issue => issue.id),
      30,
    )) {
      const issueLogs = await db.collection('timeLogs')
        .where('issueId', 'in', issueIdChunk)
        .get();
      issueLogs.docs.forEach(document => {
        logDocumentsById.set(document.id, document);
      });
    }
  } else {
    const allLogs = await db.collection('timeLogs').get();
    allLogs.docs.forEach(document => {
      logDocumentsById.set(document.id, document);
    });
  }
  const logDocuments = [...logDocumentsById.values()];

  const issueById = new Map(issues.map(issue => [issue.id, issue]));
  const logsByIssueId = new Map();
  const orphanLogIds = [];
  for (const document of logDocuments) {
    const log = { id: document.id, ...document.data() };
    if (!log.issueId) {
      if (log.sourceType !== 'calendar_event') orphanLogIds.push(log.id);
      continue;
    }
    if (!issueById.has(log.issueId)) {
      orphanLogIds.push(log.id);
      continue;
    }
    const logs = logsByIssueId.get(log.issueId) || [];
    logs.push(log);
    logsByIssueId.set(log.issueId, logs);
  }

  const changes = [];
  const rejectedLogIds = [];
  for (const issue of issues) {
    const reconciliation = reconcileIssueSpentMinutes(
      issue,
      logsByIssueId.get(issue.id) || [],
    );
    rejectedLogIds.push(...reconciliation.rejectedLogIds);
    const current = numericMirror(issue.spentMinutes);
    if (
      !reconciliation.scopeValid
      ||
      reconciliation.rejectedLogIds.length > 0
      ||
      !mirrorIsCanonical(issue.spentMinutes)
      || current !== reconciliation.spentMinutes
      || issue.spentMinutesMirrorVersion !== 1
    ) {
      changes.push({
        issueId: issue.id,
        organizationId: issue.organizationId,
        projectId: issue.projectId,
        from: current,
        to: reconciliation.spentMinutes,
        fromMirrorVersion: issue.spentMinutesMirrorVersion ?? null,
        toMirrorVersion: 1,
        validLogCount: reconciliation.validLogCount,
        rejectedLogIds: reconciliation.rejectedLogIds,
        requiresManualReview: (
          !reconciliation.scopeValid
          || reconciliation.rejectedLogIds.length > 0
        ),
      });
    }
  }

  const applyResults = [];
  if (apply) {
    // Revalidate every in-scope issue, including those that looked clean in
    // the planning snapshot. With legacy writers fenced, this closes the
    // snapshot-to-apply gap instead of certifying only precomputed mismatches.
    for (const issue of issues) {
      applyResults.push({
        issueId: issue.id,
        ...await applyIssueReconciliation(db, issue.id),
      });
    }
  }
  const allRejectedLogIds = [...new Set([
    ...rejectedLogIds,
    ...applyResults.flatMap(result => result.rejectedLogIds || []),
  ])];
  const manualReviewIssueIds = [...new Set([
    ...changes
      .filter(change => change.requiresManualReview)
      .map(change => change.issueId),
    ...applyResults
      .filter(result => result.status === 'manual-review')
      .map(result => result.issueId),
  ])];
  const report = {
    firebaseProjectId,
    organizationId: organizationId || null,
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    summary: {
      issuesScanned: issues.length,
      timeLogsScanned: logDocuments.length,
      mismatchedIssues: changes.length,
      rejectedScopedLogs: allRejectedLogIds.length,
      orphanTaskLogIds: orphanLogIds.length,
      issuesUpdated: applyResults.filter(result => result.status === 'updated').length,
      issuesSkipped: applyResults.filter(result => result.status === 'skipped').length,
      issuesRequiringManualReview: manualReviewIssueIds.length,
    },
    changes,
    rejectedLogIds: allRejectedLogIds,
    orphanLogIds,
    manualReviewIssueIds,
    applyResults,
  };

  if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report.summary, null, 2));
  if (!apply) {
    console.log('Dry run: Firestore не змінено.');
  }
  if (manualReviewIssueIds.length > 0 || orphanLogIds.length > 0) {
    console.error(
      'Звірка має неоднозначні задачі або orphan task-логи; дивіться JSON-звіт.',
    );
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
