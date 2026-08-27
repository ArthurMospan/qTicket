// Moves legacy payroll fields behind server-only paths and removes stale member
// references from project teams and issues.
//
// Safety:
//   - dry-run is the default;
//   - Firebase project and organization are always explicit;
//   - apply requires exact confirmations and a write freeze;
//   - updates use arrayRemove/delete sentinels, so retries are idempotent;
//   - this script is never invoked by application login.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-member-access.mjs \
//     --project quickteam-prod --organization org-id
//   node --env-file=.env.local scripts/migrate-member-access.mjs \
//     --project quickteam-prod --organization org-id --apply \
//     --confirm-project quickteam-prod --confirm-organization org-id \
//     --confirm-writes-frozen
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const FIREBASE_PROJECT_ID = argumentValue('--project');
const ORGANIZATION_ID = argumentValue('--organization');
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const CONFIRMED_ORGANIZATION_ID = argumentValue('--confirm-organization');
const APPLY = process.argv.includes('--apply');
const WRITES_FROZEN = process.argv.includes('--confirm-writes-frozen');

if (
  !FIREBASE_PROJECT_ID
  || FIREBASE_PROJECT_ID.startsWith('--')
  || !ORGANIZATION_ID
  || ORGANIZATION_ID.startsWith('--')
) {
  console.error('Потрібні явні `--project <firebase-project-id>` і `--organization <org-id>`.');
  process.exit(2);
}
if (
  FIREBASE_PROJECT_ID.includes('/')
  || ORGANIZATION_ID.includes('/')
  || FIREBASE_PROJECT_ID.includes('\0')
  || ORGANIZATION_ID.includes('\0')
) {
  console.error('Некоректний Firebase project або organization id.');
  process.exit(2);
}
if (
  APPLY
  && (
    CONFIRMED_PROJECT_ID !== FIREBASE_PROJECT_ID
    || CONFIRMED_ORGANIZATION_ID !== ORGANIZATION_ID
  )
) {
  console.error(
    'Apply зупинено: `--confirm-project` і `--confirm-organization` '
    + 'мають точно збігатися з обраною областю.',
  );
  process.exit(2);
}
if (APPLY && !WRITES_FROZEN) {
  console.error(
    'Apply зупинено: зупиніть зміни членств, workflow та призначень і додайте '
    + '`--confirm-writes-frozen`.',
  );
  process.exit(2);
}

function initAdmin() {
  if (getApps().length) {
    const currentProject = getApp().options.projectId;
    if (currentProject && currentProject !== FIREBASE_PROJECT_ID) {
      throw new Error(
        `Admin SDK already targets "${currentProject}", expected "${FIREBASE_PROJECT_ID}"`,
      );
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

function finiteRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate)
    ? Math.min(1_000_000, Math.max(0, rate))
    : 0;
}

function staleIds(values, validMemberIds) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter(value => typeof value === 'string' && value && !validMemberIds.has(value)))];
}

const app = initAdmin();
const db = getFirestore(app);
const orgRef = db.collection('organizations').doc(ORGANIZATION_ID);
const workflowRef = orgRef.collection('settings').doc('workflow');
const workflowRatesRef = orgRef.collection('private').doc('workflowRates');
const [organizationSnap, membershipsSnap, memberRatesSnap, workflowSnap, workflowRatesSnap, projectsSnap, issuesSnap] = await Promise.all([
  orgRef.get(),
  db.collection('orgMemberships').where('orgId', '==', ORGANIZATION_ID).get(),
  orgRef.collection('memberRates').get(),
  workflowRef.get(),
  workflowRatesRef.get(),
  db.collection('projects').where('organizationId', '==', ORGANIZATION_ID).get(),
  db.collection('issues').where('organizationId', '==', ORGANIZATION_ID).get(),
]);

if (!organizationSnap.exists) {
  console.error(`Організацію ${ORGANIZATION_ID} не знайдено.`);
  process.exit(1);
}

const validMemberIds = new Set(membershipsSnap.docs.map(document => document.data().userId));
const protectedRatesByUser = new Map(memberRatesSnap.docs.map(document => [
  document.id,
  document.data(),
]));
const operations = [];
const report = {
  firebaseProjectId: FIREBASE_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  mode: APPLY ? 'apply' : 'dry-run',
  membershipsScanned: membershipsSnap.size,
  memberRatesCreated: 0,
  legacyMemberRatesRemoved: 0,
  orphanMemberRatesRemoved: 0,
  workflowRatesMoved: 0,
  projectsCleaned: 0,
  projectReferencesRemoved: 0,
  issuesCleaned: 0,
  assigneeReferencesRemoved: 0,
  watcherReferencesRemoved: 0,
  writesApplied: 0,
};

for (const membershipDocument of membershipsSnap.docs) {
  const membership = membershipDocument.data();
  const uid = membership.userId;
  if (!uid) continue;
  if (!protectedRatesByUser.has(uid)) {
    operations.push({
      type: 'set',
      ref: orgRef.collection('memberRates').doc(uid),
      data: {
        userId: uid,
        hourlyRate: finiteRate(membership.hourlyRate),
        migratedAt: FieldValue.serverTimestamp(),
      },
    });
    report.memberRatesCreated += 1;
  }
  if (Object.prototype.hasOwnProperty.call(membership, 'hourlyRate')) {
    operations.push({
      type: 'update',
      ref: membershipDocument.ref,
      data: { hourlyRate: FieldValue.delete() },
    });
    report.legacyMemberRatesRemoved += 1;
  }
}

for (const rateDocument of memberRatesSnap.docs) {
  if (validMemberIds.has(rateDocument.id)) continue;
  operations.push({ type: 'delete', ref: rateDocument.ref });
  report.orphanMemberRatesRemoved += 1;
}

const workflow = workflowSnap.data() || {};
if (Array.isArray(workflow.positions)) {
  const legacyPositionRates = Object.fromEntries(workflow.positions
    .filter(position => position?.id && Object.prototype.hasOwnProperty.call(position, 'hourlyRate'))
    .map(position => [position.id, finiteRate(position.hourlyRate)]));
  const protectedPositionRates = workflowRatesSnap.data()?.positionRates || {};
  const positionRates = { ...legacyPositionRates, ...protectedPositionRates };
  const publicPositions = workflow.positions.map(({ hourlyRate, ...position }) => position);
  if (Object.keys(legacyPositionRates).length > 0) {
    operations.push({
      type: 'set',
      ref: workflowRatesRef,
      data: {
        positionRates,
        migratedAt: FieldValue.serverTimestamp(),
      },
    });
    operations.push({
      type: 'update',
      ref: workflowRef,
      data: { positions: publicPositions },
    });
    report.workflowRatesMoved = Object.keys(legacyPositionRates).length;
  }
}

for (const projectDocument of projectsSnap.docs) {
  const removed = staleIds(projectDocument.data().team, validMemberIds);
  if (!removed.length) continue;
  operations.push({
    type: 'update',
    ref: projectDocument.ref,
    data: { team: FieldValue.arrayRemove(...removed) },
  });
  report.projectsCleaned += 1;
  report.projectReferencesRemoved += removed.length;
}

for (const issueDocument of issuesSnap.docs) {
  const issue = issueDocument.data();
  const removedAssignees = staleIds(issue.assigneeIds, validMemberIds);
  const removedWatchers = staleIds(issue.watcherIds, validMemberIds);
  if (!removedAssignees.length && !removedWatchers.length) continue;
  operations.push({
    type: 'update',
    ref: issueDocument.ref,
    data: {
      ...(removedAssignees.length
        ? { assigneeIds: FieldValue.arrayRemove(...removedAssignees) }
        : {}),
      ...(removedWatchers.length
        ? { watcherIds: FieldValue.arrayRemove(...removedWatchers) }
        : {}),
    },
  });
  report.issuesCleaned += 1;
  report.assigneeReferencesRemoved += removedAssignees.length;
  report.watcherReferencesRemoved += removedWatchers.length;
}

if (APPLY && operations.length > 0) {
  for (let offset = 0; offset < operations.length; offset += 400) {
    const batch = db.batch();
    const chunk = operations.slice(offset, offset + 400);
    for (const operation of chunk) {
      if (operation.type === 'set') batch.set(operation.ref, operation.data, { merge: true });
      if (operation.type === 'update') batch.update(operation.ref, operation.data);
      if (operation.type === 'delete') batch.delete(operation.ref);
    }
    await batch.commit();
    report.writesApplied += chunk.length;
  }
  await orgRef.update({
    memberDirectoryVersion: FieldValue.increment(1),
    workflowVersion: FieldValue.increment(1),
  });
  report.writesApplied += 1;
}

console.log(JSON.stringify(report, null, 2));
