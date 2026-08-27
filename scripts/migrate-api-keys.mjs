// Moves API keys off the organization document and turns the plaintext ones
// into hashes.
//
// Why this exists at all. `isValidApiKey` carries a branch it describes as
// «Temporary compatibility for legacy keys until the private-key migration
// runs», and the migration it names was never written. Three things followed
// from that:
//
//   • A legacy key is stored as the token itself, on `organizations/{orgId}` —
//     a document every member of the organization may read. `/api/v1/tasks`
//     then grants that key whatever it grants, which is not what a `member`
//     holds.
//   • It is compared with `===`, not in constant time, unlike every other
//     secret in the product.
//   • The conversion does exist — `loadAndMigrateKeys` in
//     /api/integrations/api-keys — but it only runs when an owner or admin
//     happens to open the API keys screen. A security migration attached to a
//     visit has no way to know whether it has finished.
//
// This is that migration, run deliberately and once. Afterwards the plaintext
// branch in `isValidApiKey` can be deleted, and this script says so when the
// last organization is clean.
//
// Safety, the same shape as every other migration here:
//   - dry-run is the default;
//   - the Firebase project is always explicit and re-confirmed for a write;
//   - a key keeps its id, name, createdAt and createdBy, so nothing a person
//     sees about it changes and no integration has to be re-issued a token;
//   - `set` of the same computed value is idempotent, so a retry is safe.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-api-keys.mjs --project quickteam-me
//   node --env-file=.env.local scripts/migrate-api-keys.mjs --project quickteam-me \
//     --apply --confirm-project quickteam-me
import { createHash } from 'node:crypto';
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
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const APPLY = process.argv.includes('--apply');

if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.startsWith('--')) {
  console.error('Потрібен явний `--project <firebase-project-id>`.');
  process.exit(2);
}
if (FIREBASE_PROJECT_ID.includes('/') || FIREBASE_PROJECT_ID.includes('\0')) {
  console.error('Некоректний Firebase project id.');
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

// The same digest the route computes, so a key migrated here is accepted by
// `isValidApiKey` without the plaintext branch.
const hashApiKey = token => createHash('sha256').update(token).digest('hex');

function convert(key) {
  if (!key || typeof key !== 'object') return null;
  if (!key.token) return { key, changed: false };
  const { token, ...rest } = key;
  return {
    key: { ...rest, prefix: token.slice(0, 10), tokenHash: hashApiKey(token) },
    changed: true,
  };
}

const app = initAdmin();
const db = getFirestore(app);

const organizations = await db.collection('organizations').select().get();
console.log(`${organizations.size} організацій у проєкті ${FIREBASE_PROJECT_ID}.`);

let organizationsWithLegacy = 0;
let keysConverted = 0;
let documentsMoved = 0;
const plan = [];

for (const organization of organizations.docs) {
  const orgRef = organization.ref;
  const keysRef = orgRef.collection('private').doc('apiKeys');
  const [orgSnap, keysSnap] = await Promise.all([orgRef.get(), keysRef.get()]);

  const legacyKeys = Array.isArray(orgSnap.data()?.apiKeys) ? orgSnap.data().apiKeys : [];
  const privateKeys = Array.isArray(keysSnap.data()?.keys) ? keysSnap.data().keys : [];

  // Two things can be wrong and they are independent: keys may still live on
  // the readable organization document, and keys in either place may still hold
  // a plaintext token.
  const needsMove = legacyKeys.length > 0 || orgSnap.data()?.apiKeys !== undefined;
  const source = keysSnap.exists ? privateKeys : legacyKeys;
  const converted = source.map(convert).filter(Boolean);
  const plaintext = converted.filter(entry => entry.changed).length;

  if (!needsMove && plaintext === 0) continue;

  organizationsWithLegacy += 1;
  keysConverted += plaintext;
  if (needsMove) documentsMoved += 1;
  plan.push({
    organizationId: organization.id,
    keys: source.length,
    plaintext,
    movingOffOrganizationDocument: needsMove,
  });

  if (!APPLY) continue;

  const batch = db.batch();
  batch.set(keysRef, {
    keys: converted.map(entry => entry.key),
    updatedAt: FieldValue.serverTimestamp(),
  });
  // Only after the private document is written in the same batch: the field is
  // the sole copy until then.
  if (needsMove) batch.update(orgRef, { apiKeys: FieldValue.delete() });
  await batch.commit();
}

console.table(plan);
console.log(
  APPLY
    ? `Готово. Організацій змінено: ${organizationsWithLegacy}, ключів перехешовано: ${keysConverted}, документів перенесено: ${documentsMoved}.`
    : `Dry-run. Змінилося б організацій: ${organizationsWithLegacy}, ключів: ${keysConverted}, документів: ${documentsMoved}. Додайте --apply --confirm-project ${FIREBASE_PROJECT_ID}.`,
);
if (APPLY && keysConverted === 0 && documentsMoved === 0) {
  console.log(
    'Жодного legacy-ключа не лишилось — гілку `if (key.token)` у '
    + 'src/lib/server/firebaseAdmin.js можна видаляти.',
  );
}
