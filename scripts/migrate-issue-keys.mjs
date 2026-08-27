// Normalizes historical Unicode or numeric issue keys to URL-safe ASCII and
// keeps every replaced key as a route alias.
//
// Safety:
//   - dry-run is the default;
//   - Firebase project and organization are explicit;
//   - apply requires exact confirmations plus a write freeze;
//   - the shared canonicalizer makes retries deterministic;
//   - target collisions stop apply before any writes;
//   - every live document is rechecked in a transaction before update.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-issue-keys.mjs \
//     --project quickteam-prod --organization org-id
//   node --env-file=.env.local scripts/migrate-issue-keys.mjs \
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
import {
  canonicalHistoricalIssueKey,
  isValidIssuePrefix,
  normalizeIssuePrefix,
  suggestAvailableIssuePrefix,
} from '../src/lib/utils/issueKeys.mjs';

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
    'Apply зупинено: зупиніть створення проєктів і задач та додайте '
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

function normalizedAliases(values, nextAlias = '') {
  return [...new Set([
    nextAlias,
    ...(Array.isArray(values) ? values : []),
  ]
    .filter(value => typeof value === 'string')
    .map(value => value.trim())
    .filter(Boolean))]
    .slice(0, 20);
}

function routeIdentity(projectId, issueKey) {
  return `${projectId}\0${String(issueKey || '').trim().toLocaleUpperCase('uk-UA')}`;
}

const app = initAdmin();
const db = getFirestore(app);
const organizationRef = db.collection('organizations').doc(ORGANIZATION_ID);
const [organizationSnapshot, projectsSnapshot, issuesSnapshot] = await Promise.all([
  organizationRef.get(),
  db.collection('projects').where('organizationId', '==', ORGANIZATION_ID).get(),
  db.collection('issues').where('organizationId', '==', ORGANIZATION_ID).get(),
]);

if (!organizationSnapshot.exists) {
  console.error(`Організацію ${ORGANIZATION_ID} не знайдено.`);
  process.exit(1);
}

const plannedProjects = projectsSnapshot.docs
  .map(document => ({ id: document.id, ...document.data() }))
  .sort((left, right) => left.id.localeCompare(right.id));
const projectOperations = [];

for (const project of plannedProjects) {
  const sourcePrefix = typeof project.issuePrefix === 'string' ? project.issuePrefix.trim() : '';
  const targetPrefix = isValidIssuePrefix(sourcePrefix)
    ? normalizeIssuePrefix(sourcePrefix)
    : suggestAvailableIssuePrefix(project, plannedProjects, project.id);

  project.issuePrefix = targetPrefix;
  if (sourcePrefix !== targetPrefix) {
    projectOperations.push({
      ref: db.collection('projects').doc(project.id),
      projectId: project.id,
      sourcePrefix,
      targetPrefix,
    });
  }
}

const projectsById = new Map(plannedProjects.map(project => [project.id, project]));
const issueOperations = [];
const invalidIssueKeys = [];
const finalRouteOwners = new Map();
const collisions = [];

for (const document of issuesSnapshot.docs) {
  const issue = document.data();
  const sourceKey = typeof issue.issueKey === 'string' ? issue.issueKey.trim() : '';
  if (!sourceKey) continue;

  const project = projectsById.get(issue.projectId);
  const targetKey = canonicalHistoricalIssueKey(sourceKey, project);
  if (!targetKey) {
    invalidIssueKeys.push({ document: document.ref.path, issueKey: sourceKey });
    continue;
  }

  const identity = routeIdentity(issue.projectId, targetKey);
  const previousOwner = finalRouteOwners.get(identity);
  if (previousOwner && previousOwner !== document.id) {
    collisions.push({
      projectId: issue.projectId,
      issueKey: targetKey,
      issueIds: [previousOwner, document.id],
    });
  } else {
    finalRouteOwners.set(identity, document.id);
  }

  if (sourceKey === targetKey) continue;
  issueOperations.push({
    ref: document.ref,
    issueId: document.id,
    projectId: issue.projectId,
    sourceKey,
    targetKey,
    sourceAliases: normalizedAliases(issue.legacyIssueKeys),
    targetAliases: normalizedAliases(issue.legacyIssueKeys, sourceKey),
  });
}

const prefixOwners = new Map();
for (const project of plannedProjects) {
  const previousOwner = prefixOwners.get(project.issuePrefix);
  if (previousOwner && previousOwner !== project.id) {
    collisions.push({
      issuePrefix: project.issuePrefix,
      projectIds: [previousOwner, project.id],
    });
  } else {
    prefixOwners.set(project.issuePrefix, project.id);
  }
}

const report = {
  firebaseProjectId: FIREBASE_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  mode: APPLY ? 'apply' : 'dry-run',
  projectsScanned: projectsSnapshot.size,
  issuesScanned: issuesSnapshot.size,
  projectPrefixesPlanned: projectOperations.length,
  issueKeysPlanned: issueOperations.length,
  invalidIssueKeys,
  collisions,
  projectPrefixesApplied: 0,
  issueKeysApplied: 0,
  changedDuringApplySkipped: 0,
};

if (APPLY && collisions.length > 0) {
  console.error(JSON.stringify(report, null, 2));
  console.error('Apply зупинено: цільові ключі або префікси мають конфлікти.');
  process.exit(1);
}

if (APPLY) {
  for (const operation of projectOperations) {
    await db.runTransaction(async transaction => {
      const live = await transaction.get(operation.ref);
      const data = live.data() || {};
      const livePrefix = typeof data.issuePrefix === 'string' ? data.issuePrefix.trim() : '';
      if (
        !live.exists
        || data.organizationId !== ORGANIZATION_ID
        || livePrefix !== operation.sourcePrefix
      ) {
        report.changedDuringApplySkipped += 1;
        return;
      }
      transaction.update(operation.ref, {
        issuePrefix: operation.targetPrefix,
        issueKeyMigrationVersion: 1,
        issueKeyMigratedAt: FieldValue.serverTimestamp(),
      });
      report.projectPrefixesApplied += 1;
    });
  }

  for (const operation of issueOperations) {
    await db.runTransaction(async transaction => {
      const live = await transaction.get(operation.ref);
      const data = live.data() || {};
      const liveKey = typeof data.issueKey === 'string' ? data.issueKey.trim() : '';
      const liveAliases = normalizedAliases(data.legacyIssueKeys);
      if (
        !live.exists
        || data.organizationId !== ORGANIZATION_ID
        || data.projectId !== operation.projectId
        || liveKey !== operation.sourceKey
        || JSON.stringify(liveAliases) !== JSON.stringify(operation.sourceAliases)
      ) {
        report.changedDuringApplySkipped += 1;
        return;
      }
      transaction.update(operation.ref, {
        issueKey: operation.targetKey,
        legacyIssueKeys: operation.targetAliases,
        issueKeyMigrationVersion: 1,
        issueKeyMigratedAt: FieldValue.serverTimestamp(),
      });
      report.issueKeysApplied += 1;
    });
  }
}

console.log(JSON.stringify({
  ...report,
  operations: {
    projects: projectOperations.map(operation => ({
      document: operation.ref.path,
      sourcePrefix: operation.sourcePrefix,
      targetPrefix: operation.targetPrefix,
    })),
    issues: issueOperations.map(operation => ({
      document: operation.ref.path,
      sourceKey: operation.sourceKey,
      targetKey: operation.targetKey,
      legacyIssueKeys: operation.targetAliases,
    })),
  },
}, null, 2));
