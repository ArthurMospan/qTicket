// Converts existing public chat assets to Cloudinary's authenticated delivery
// type and replaces stored public URLs with delivery metadata.
//
// Safety: dry-run by default; explicit Firebase project and organization;
// apply requires exact confirmations and a chat write freeze; deterministic
// destinations plus live Firestore rechecks make retries safe.
import { createHash } from 'node:crypto';
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryAssetFromUrl } from '../src/lib/utils/cloudinaryAssets.mjs';
import {
  isOrganizationChatStoragePath,
  isSafeStoragePath,
  organizationIdFromPath,
} from '../src/lib/utils/uploadPaths.mjs';

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
  || FIREBASE_PROJECT_ID.includes('/')
  || ORGANIZATION_ID.includes('/')
  || FIREBASE_PROJECT_ID.includes('\0')
  || ORGANIZATION_ID.includes('\0')
) {
  console.error('Потрібні коректні явні `--project <firebase-project-id>` і `--organization <org-id>`.');
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
  console.error('Apply зупинено: заморозьте повідомлення в чаті й додайте `--confirm-writes-frozen`.');
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

function safeFormat(attachment) {
  const candidates = [
    attachment?.format,
    String(attachment?.url || '').match(/\.([A-Za-z0-9]{1,12})(?:[?#]|$)/)?.[1],
    String(attachment?.name || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1],
  ];
  const value = candidates.find(candidate => /^[A-Za-z0-9]{1,12}$/.test(candidate || ''));
  return value?.toLowerCase() || '';
}

function deterministicDestination(sourcePath) {
  if (isOrganizationChatStoragePath(sourcePath, ORGANIZATION_ID)) return sourcePath;
  const digest = createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
  const leaf = sourcePath.split('/').at(-1).replace(/[^A-Za-z0-9_-]/g, '_').slice(-80) || 'attachment';
  return `quickteam/organizations/${ORGANIZATION_ID}/chat/legacy_${digest}_${leaf}`;
}

async function authenticatedAsset(storagePath, resourceType) {
  try {
    return await cloudinary.api.resource(storagePath, {
      resource_type: resourceType,
      type: 'authenticated',
    });
  } catch (error) {
    if (error?.http_code === 404 || error?.error?.http_code === 404) return null;
    throw error;
  }
}

async function collectMessageDocuments(organizationRef) {
  const channels = await organizationRef.collection('channels').get();
  const documents = [];
  for (const channel of channels.docs) {
    const messages = await channel.ref.collection('messages').get();
    for (const message of messages.docs) {
      documents.push(message);
      const replies = await message.ref.collection('replies').get();
      documents.push(...replies.docs);
    }
  }
  return documents;
}

const app = initAdmin();
const db = getFirestore(app);
const organizationRef = db.collection('organizations').doc(ORGANIZATION_ID);
const organizationSnapshot = await organizationRef.get();
if (!organizationSnapshot.exists) {
  console.error(`Організацію ${ORGANIZATION_ID} не знайдено.`);
  process.exit(1);
}

const documents = await collectMessageDocuments(organizationRef);
const plans = [];
const report = {
  firebaseProjectId: FIREBASE_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  mode: APPLY ? 'apply' : 'dry-run',
  messageDocumentsScanned: documents.length,
  attachmentsPlanned: 0,
  alreadyPrivate: 0,
  emptyOrExternalSkipped: 0,
  otherOrganizationSkipped: 0,
  unsupportedPathSkipped: 0,
  missingFormatSkipped: 0,
  cloudinaryMovesApplied: 0,
  firestoreDocumentsUpdated: 0,
  changedDuringApplySkipped: 0,
};

for (const document of documents) {
  const attachments = document.data()?.attachments || [];
  const operations = [];
  attachments.forEach((attachment, index) => {
    if (
      attachment?.deliveryType === 'authenticated'
      && isOrganizationChatStoragePath(attachment.storagePath, ORGANIZATION_ID)
      && safeFormat(attachment)
      && !attachment.url
    ) {
      report.alreadyPrivate += 1;
      return;
    }
    const parsed = attachment?.storagePath && isSafeStoragePath(attachment.storagePath)
      ? { storagePath: attachment.storagePath, resourceType: attachment.resourceType || 'image' }
      : cloudinaryAssetFromUrl(attachment?.url);
    if (!parsed) {
      report.emptyOrExternalSkipped += 1;
      return;
    }
    const pathOrganizationId = organizationIdFromPath(parsed.storagePath);
    if (pathOrganizationId && pathOrganizationId !== ORGANIZATION_ID) {
      report.otherOrganizationSkipped += 1;
      return;
    }
    if (
      (pathOrganizationId && !isOrganizationChatStoragePath(parsed.storagePath, ORGANIZATION_ID))
      || (!pathOrganizationId && !parsed.storagePath.startsWith('quickteam/chat/attachments/'))
    ) {
      report.unsupportedPathSkipped += 1;
      return;
    }
    const format = safeFormat(attachment);
    if (!format) {
      report.missingFormatSkipped += 1;
      return;
    }
    operations.push({
      index,
      sourcePath: parsed.storagePath,
      destinationPath: deterministicDestination(parsed.storagePath),
      resourceType: ['image', 'video', 'raw'].includes(parsed.resourceType)
        ? parsed.resourceType
        : 'image',
      format,
    });
    report.attachmentsPlanned += 1;
  });
  if (operations.length) {
    plans.push({
      ref: document.ref,
      sourceAttachments: attachments,
      operations,
    });
  }
}

if (APPLY) {
  for (const plan of plans) {
    const liveSnapshot = await plan.ref.get();
    const liveAttachments = liveSnapshot.data()?.attachments || [];
    if (JSON.stringify(liveAttachments) !== JSON.stringify(plan.sourceAttachments)) {
      report.changedDuringApplySkipped += 1;
      continue;
    }

    const nextAttachments = liveAttachments.map(attachment => ({ ...attachment }));
    for (const operation of plan.operations) {
      let asset = await authenticatedAsset(operation.destinationPath, operation.resourceType);
      if (!asset) {
        asset = await cloudinary.uploader.rename(
          operation.sourcePath,
          operation.destinationPath,
          {
            resource_type: operation.resourceType,
            type: 'upload',
            to_type: 'authenticated',
            invalidate: true,
            overwrite: false,
          },
        );
        report.cloudinaryMovesApplied += 1;
      }
      nextAttachments[operation.index] = {
        ...nextAttachments[operation.index],
        url: '',
        storagePath: operation.destinationPath,
        resourceType: operation.resourceType,
        deliveryType: 'authenticated',
        format: asset.format || operation.format,
      };
    }
    await plan.ref.update({
      attachments: nextAttachments,
      chatAttachmentsMigratedAt: FieldValue.serverTimestamp(),
    });
    report.firestoreDocumentsUpdated += 1;
  }
}

console.log(JSON.stringify({
  ...report,
  operations: plans.flatMap(plan => plan.operations.map(operation => ({
    document: plan.ref.path,
    attachmentIndex: operation.index,
    sourcePath: operation.sourcePath,
    destinationPath: operation.destinationPath,
    action: 'move-to-authenticated',
  }))),
}, null, 2));
