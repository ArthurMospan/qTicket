// Moves legacy avatar/logo Cloudinary assets into an organization-owned path
// and stores the public id beside each Firestore URL.
//
// Safety:
//   - dry-run is the default and never calls Cloudinary;
//   - Firebase project and organization are explicit;
//   - apply requires exact confirmations plus a write freeze;
//   - deterministic destinations and destination lookup make retries safe;
//   - live Firestore values are rechecked before every apply.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-image-assets.mjs \
//     --project quickteam-prod --organization org-id
//   node --env-file=.env.local scripts/migrate-image-assets.mjs \
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
import { v2 as cloudinary } from 'cloudinary';
import {
  cloudinaryAssetFromUrl,
  organizationImageFolder,
} from '../src/lib/utils/cloudinaryAssets.mjs';
import { organizationIdFromPath } from '../src/lib/utils/uploadPaths.mjs';

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
  console.error('Apply зупинено: підтвердження project та organization мають точно збігатися.');
  process.exit(2);
}
if (APPLY && !WRITES_FROZEN) {
  console.error('Apply зупинено: зупиніть зміну аватарів/логотипа й додайте `--confirm-writes-frozen`.');
  process.exit(2);
}
if (
  APPLY
  && (!process.env.CLOUDINARY_CLOUD_NAME
    || !process.env.CLOUDINARY_API_KEY
    || !process.env.CLOUDINARY_API_SECRET)
) {
  console.error('Apply потребує CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY і CLOUDINARY_API_SECRET.');
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

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function optimizedImageUrl(url, resourceType) {
  return resourceType === 'image' ? url.replace('/upload/', '/upload/f_auto,q_auto/') : url;
}

function safeOwnerSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'asset';
}

function destinationPath(sourcePath, ownerId, kind) {
  const leaf = sourcePath.split('/').at(-1);
  const prefix = `${organizationImageFolder(ORGANIZATION_ID, kind)}/${safeOwnerSegment(ownerId)}_`;
  return `${prefix}${leaf.slice(0, Math.max(1, 220 - prefix.length))}`;
}

async function existingCloudinaryAsset(storagePath, resourceType) {
  try {
    return await cloudinary.api.resource(storagePath, { resource_type: resourceType });
  } catch (error) {
    if (error?.http_code === 404 || error?.error?.http_code === 404) return null;
    throw error;
  }
}

const app = initAdmin();
const db = getFirestore(app);
const organizationRef = db.collection('organizations').doc(ORGANIZATION_ID);
const [organizationSnapshot, membershipsSnapshot] = await Promise.all([
  organizationRef.get(),
  db.collection('orgMemberships').where('orgId', '==', ORGANIZATION_ID).get(),
]);

if (!organizationSnapshot.exists) {
  console.error(`Організацію ${ORGANIZATION_ID} не знайдено.`);
  process.exit(1);
}

const userIds = [...new Set(membershipsSnapshot.docs
  .map(document => document.data().userId)
  .filter(Boolean))];
const userSnapshots = userIds.length
  ? await db.getAll(...userIds.map(uid => db.collection('users').doc(uid)))
  : [];

const candidates = [
  {
    ownerId: ORGANIZATION_ID,
    kind: 'logos',
    ref: organizationRef,
    snapshot: organizationSnapshot,
    urlField: 'logo',
    pathField: 'logoStoragePath',
    typeField: 'logoResourceType',
  },
  ...userSnapshots.filter(snapshot => snapshot.exists).map(snapshot => ({
    ownerId: snapshot.id,
    kind: 'avatars',
    ref: snapshot.ref,
    snapshot,
    urlField: 'customAvatar',
    pathField: 'customAvatarStoragePath',
    typeField: 'customAvatarResourceType',
  })),
];

const operations = [];
const report = {
  firebaseProjectId: FIREBASE_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  mode: APPLY ? 'apply' : 'dry-run',
  recordsScanned: candidates.length,
  legacyMovesPlanned: 0,
  metadataBackfillsPlanned: 0,
  externalOrEmptySkipped: 0,
  otherOrganizationSkipped: 0,
  unsupportedLegacyPathSkipped: 0,
  cloudinaryMovesApplied: 0,
  firestoreUpdatesApplied: 0,
  changedDuringApplySkipped: 0,
};

for (const candidate of candidates) {
  const data = candidate.snapshot.data() || {};
  const url = data[candidate.urlField];
  const parsed = cloudinaryAssetFromUrl(url);
  const storedPath = data[candidate.pathField];
  const asset = storedPath
    ? { storagePath: storedPath, resourceType: data[candidate.typeField] || parsed?.resourceType || 'image' }
    : parsed;

  if (!url || !asset) {
    report.externalOrEmptySkipped += 1;
    continue;
  }

  const assetOrganizationId = organizationIdFromPath(asset.storagePath);
  if (assetOrganizationId === ORGANIZATION_ID) {
    if (storedPath === asset.storagePath && data[candidate.typeField] === asset.resourceType) continue;
    operations.push({
      ...candidate,
      sourceUrl: url,
      sourcePath: asset.storagePath,
      destinationPath: asset.storagePath,
      resourceType: asset.resourceType,
      move: false,
    });
    report.metadataBackfillsPlanned += 1;
    continue;
  }
  if (assetOrganizationId) {
    report.otherOrganizationSkipped += 1;
    continue;
  }
  if (!asset.storagePath.startsWith('quickteam/avatars/')) {
    report.unsupportedLegacyPathSkipped += 1;
    continue;
  }

  operations.push({
    ...candidate,
    sourceUrl: url,
    sourcePath: asset.storagePath,
    destinationPath: destinationPath(asset.storagePath, candidate.ownerId, candidate.kind),
    resourceType: asset.resourceType,
    move: true,
  });
  report.legacyMovesPlanned += 1;
}

if (APPLY) {
  for (const operation of operations) {
    const liveSnapshot = await operation.ref.get();
    const liveData = liveSnapshot.data() || {};
    if (liveData[operation.urlField] !== operation.sourceUrl) {
      report.changedDuringApplySkipped += 1;
      continue;
    }

    let nextUrl = operation.sourceUrl;
    if (operation.move) {
      let cloudinaryAsset = await existingCloudinaryAsset(
        operation.destinationPath,
        operation.resourceType,
      );
      if (!cloudinaryAsset) {
        cloudinaryAsset = await cloudinary.uploader.rename(
          operation.sourcePath,
          operation.destinationPath,
          {
            resource_type: operation.resourceType,
            invalidate: true,
            overwrite: false,
          },
        );
        report.cloudinaryMovesApplied += 1;
      }
      nextUrl = optimizedImageUrl(cloudinaryAsset.secure_url, operation.resourceType);
    }

    await operation.ref.update({
      [operation.urlField]: nextUrl,
      [operation.pathField]: operation.destinationPath,
      [operation.typeField]: operation.resourceType,
      imageAssetsMigratedAt: FieldValue.serverTimestamp(),
    });
    report.firestoreUpdatesApplied += 1;
  }
}

console.log(JSON.stringify({
  ...report,
  operations: operations.map(operation => ({
    document: operation.ref.path,
    field: operation.urlField,
    sourcePath: operation.sourcePath,
    destinationPath: operation.destinationPath,
    action: operation.move ? 'move' : 'backfill-metadata',
  })),
}, null, 2));
