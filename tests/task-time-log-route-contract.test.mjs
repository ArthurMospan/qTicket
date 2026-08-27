import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('task time-log POST is authenticated, bounded, scoped, and transactional', async () => {
  const [route, server] = await Promise.all([
    readSource('src/app/api/issues/[issueId]/time-logs/route.js'),
    readSource('src/lib/server/taskTimeLogs.js'),
  ]);
  assert.match(route, /const \{ issueId: rawIssueId \} = await context\.params/);
  assert.match(route, /readTaskTimeLogJson\(request\)/);
  assert.match(route, /exactTaskTimeLogMinutes\(body\.spentMinutes\)/);
  assert.match(route, /parseTaskTimeLogDescription\(body\.description\)/);
  assert.match(route, /parseTaskTimeLogTimestamp\(body\.loggedAt\)/);
  assert.match(route, /authorizeTaskTimeLogRequest\(request, organizationId\)/);
  assert.match(route, /enforceRateLimit\([\s\S]*?'task-time-log-create'[\s\S]*?60,[\s\S]*?60/);
  assert.match(route, /await db\.runTransaction\(async transaction =>/);
  assert.match(
    route,
    /invoiceSourcelessReservationId\(organizationId, projectId, issueId\)/,
  );
  assert.match(route, /collection\('invoiceEstimateReservations'\)/);
  assert.match(
    route,
    /transaction\.get\(\s*estimateReservationRef,\s*\)/,
  );
  assert.match(route, /isTaskEstimateReservationIdentity\(reservation,/);
  assert.match(route, /TASK_TIME_ESTIMATE_ALREADY_INVOICED/);
  assert.match(route, /Оцінку цього завдання вже включено до рахунку/);
  assert.match(route, /TASK_TIME_ESTIMATE_RESERVATION_SCOPE_CONFLICT/);
  assert.match(route, /transaction\.create\(logRef,/);
  assert.match(route, /userId: authorization\.user\.uid/);
  assert.match(route, /applyTaskTimeLogMutation\(/);

  const reservationRead = route.search(/transaction\.get\(\s*estimateReservationRef,/);
  const logWrite = route.indexOf('transaction.create(logRef,');
  assert.ok(reservationRead > 0 && reservationRead < logWrite);

  assert.match(
    server,
    /authorizeOrgRequest\([\s\S]*?\['owner', 'admin', 'member'\]/,
  );
  assert.match(server, /collection\('orgMemberships'\)/);
  assert.match(server, /membership\.orgId !== organizationId/);
  assert.match(server, /project\.organizationId !== organizationId/);
  assert.match(server, /project\.deletionPending === true/);
  assert.match(server, /project\.status === 'archived'/);
  assert.match(server, /project\.team\.includes\(authorization\.user\.uid\)/);
  assert.match(server, /issue\.organizationId !== organizationId/);
  assert.match(server, /issue\.projectId !== projectId/);
  assert.match(server, /issue\.deletionPending === true/);
});

test('task time-log PATCH and DELETE use live log state and mutation locks', async () => {
  const [route, server] = await Promise.all([
    readSource('src/app/api/issues/[issueId]/time-logs/[logId]/route.js'),
    readSource('src/lib/server/taskTimeLogs.js'),
  ]);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /const params = await context\.params/g);
  assert.match(route, /transaction\.get\(logRef\)/g);
  assert.match(route, /readMutableTaskTimeLog\(/g);
  assert.match(route, /nextMinutes - log\.spentMinutes/);
  assert.match(route, /spentMinutesDelta: -log\.spentMinutes/);
  assert.match(route, /transaction\.delete\(logRef\)/);
  assert.match(
    route,
    /enforceRateLimit\([\s\S]*?'task-time-log-update'[\s\S]*?120,[\s\S]*?60/,
  );
  assert.match(
    route,
    /enforceRateLimit\([\s\S]*?'task-time-log-delete'[\s\S]*?120,[\s\S]*?60/,
  );

  assert.match(server, /isBilledTimeLog\(log\)/);
  assert.match(server, /log\.userId !== authorization\.user\.uid/);
  assert.match(server, /spentMinutesMirrorVersion !== TASK_TIME_LOG_MIRROR_VERSION/);
  assert.match(server, /\.where\('issueId', '==', issueId\)[\s\S]*?\.limit\(1\)/);
  assert.match(server, /TASK_TIME_MIRROR_RECONCILIATION_REQUIRED/);
  assert.match(
    server,
    /issueUpdates\.spentMinutes = FieldValue\.increment\(spentMinutesDelta\)/,
  );
  assert.match(server, /timeLogMutationVersion: FieldValue\.increment\(1\)/);
  assert.match(server, /invoiceMutationVersion: FieldValue\.increment\(1\)/);
});

test('YouTrack work-log writes share the estimate-reservation lock', async () => {
  const importer = await readSource('src/lib/server/youtrackImporter.js');
  const functionStart = importer.indexOf('async function importWorkItems(');
  const functionEnd = importer.indexOf(
    '\nasync function enqueueLinks(',
    functionStart,
  );
  const source = importer.slice(functionStart, functionEnd);
  const reservationRead = source.indexOf(
    'transaction.get(estimateReservationRef)',
  );
  const unchangedNoop = source.indexOf(
    'if (changedLogs === 0) return skippedIds',
    reservationRead,
  );
  const reservationGuard = source.indexOf(
    'if (estimateReservationSnapshot.exists)',
    unchangedNoop,
  );
  const rawLogWrite = source.indexOf(
    'transaction.set(row.ref, row.fields',
    reservationGuard,
  );

  assert.match(
    source,
    /invoiceSourcelessReservationId\(job\.organizationId, projectId, issueId\)/,
  );
  assert.match(source, /collection\('invoiceEstimateReservations'\)/);
  assert.match(source, /youTrackImportedWorkLogMatches\(current, row\.fields\)/);
  assert.ok(reservationRead > 0);
  assert.ok(unchangedNoop > reservationRead);
  assert.ok(reservationGuard > unchangedNoop && reservationGuard < rawLogWrite);
  assert.match(source, /YOUTRACK_TIME_ESTIMATE_ALREADY_INVOICED/);
});

test('task time-log clients use APIs and contain no direct mutation primitives', async () => {
  const [service, hook, timesheet] = await Promise.all([
    readSource('src/lib/services/timeLogs.js'),
    readSource('src/lib/hooks/useTimeLogs.js'),
    readSource('src/components/workspace/TimesheetTab.jsx'),
  ]);
  assert.match(service, /createTaskTimeLogViaApi/);
  assert.match(service, /updateTaskTimeLogViaApi/);
  assert.match(service, /deleteTaskTimeLogViaApi/);
  assert.match(service, /Authorization: `Bearer \$\{token\}`/);
  assert.match(hook, /createTaskTimeLogViaApi\(/);
  assert.match(hook, /updateTaskTimeLogViaApi\(/);
  assert.match(hook, /deleteTaskTimeLogViaApi\(/);
  assert.match(timesheet, /createTaskTimeLogViaApi\(/);
  assert.doesNotMatch(hook, /writeBatch|increment\(|serverTimestamp\(/);
  assert.doesNotMatch(timesheet, /writeBatch|increment\(|serverTimestamp\(|Timestamp\.fromDate/);
});

test('all trusted issue creators initialize the accounting mirror', async () => {
  const [issues, apiV1, telegram, youtrack] = await Promise.all([
    readSource('src/app/api/issues/route.js'),
    readSource('src/app/api/v1/tasks/route.js'),
    readSource('src/lib/server/telegram.js'),
    readSource('src/lib/server/youtrackImporter.js'),
  ]);
  for (const source of [issues, telegram, youtrack]) {
    assert.match(source, /spentMinutes:\s*0/);
    assert.match(source, /spentMinutesMirrorVersion:\s*1/);
    assert.match(source, /timeLogMutationVersion:\s*0/);
  }
  assert.equal((apiV1.match(/spentMinutesMirrorVersion:\s*1/g) || []).length, 2);

  assert.match(youtrack, /spentMinutesMirrorVersion !== 1/);
  assert.match(youtrack, /\.where\('issueId', '==', issueId\)[\s\S]*?\.limit\(1\)/);
  assert.match(youtrack, /spentMinutesMirrorVersion:\s*1/);
  assert.match(
    youtrack,
    /invoiceMutationVersion: FieldValue\.increment\(1\)/,
  );
});

test('reconciliation stamps legacy mirrors even when their numeric sum matches', async () => {
  const [script, docs] = await Promise.all([
    readSource('scripts/reconcile-issue-spent-minutes.mjs'),
    readSource('docs/MIGRATIONS.md'),
  ]);
  assert.match(
    script,
    /current === reconciliation\.spentMinutes[\s\S]*?issue\.spentMinutesMirrorVersion === 1/,
  );
  assert.match(script, /spentMinutesMirrorVersion:\s*1/);
  assert.match(script, /issue\.spentMinutesMirrorVersion !== 1/);
  assert.match(docs, /spentMinutesMirrorVersion: 1/);
  assert.match(docs, /production/);
});

test('Firestore owns time-log writes and accounting metadata', async () => {
  const rules = await readSource('firestore.rules');
  assert.match(
    rules,
    /match \/timeLogs\/\{id\} \{[\s\S]*?allow read:[\s\S]*?allow create, update, delete: if false;/,
  );
  for (const field of [
    'spentMinutes',
    'spentMinutesMirrorVersion',
    'spentMinutesReconciledAt',
    'timeLogMutationVersion',
  ]) {
    assert.match(rules, new RegExp(`'${field}'`));
  }
});
