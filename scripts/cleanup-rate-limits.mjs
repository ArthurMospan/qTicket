// Removes rate-limit counters whose window has closed.
//
// `enforceRateLimit` writes one document per «scope + subject» into
// `serverRateLimits` and overwrites it when the window rolls over. Nothing ever
// deletes one. For scopes keyed by account that is bounded by how many people
// there are; for the two keyed by IP address — the error-report inbox and the
// email login start — it grows with the number of distinct addresses that have
// ever knocked, and never shrinks.
//
// Firestore has a TTL policy for exactly this, and that is the better answer:
// it deletes expired documents on its own, costs no write quota, and needs no
// script. It is also a console or gcloud setting rather than code. This exists
// so the collection can be kept in hand today without leaving the repository,
// and so that skipping the console step is a choice rather than a leak.
//
// Reads only what is already expired, so it never fights a live counter:
// a document whose `resetAt` is in the past has no effect on any decision —
// `enforceRateLimit` treats it exactly as it treats a missing one.
//
// Safety:
//   - dry-run is the default;
//   - the Firebase project is always explicit and re-confirmed for a write;
//   - deleting an expired counter is idempotent and cannot deny anybody.
//
// Usage:
//   node --env-file=.env.local scripts/cleanup-rate-limits.mjs --project quickteam-me
//   node --env-file=.env.local scripts/cleanup-rate-limits.mjs --project quickteam-me \
//     --apply --confirm-project quickteam-me
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const FIREBASE_PROJECT_ID = argumentValue('--project');
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const APPLY = process.argv.includes('--apply');
const BATCH = 400;

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

const db = getFirestore(initAdmin());
// A minute of slack, so a counter that expires between the query and the delete
// is still one nobody was relying on.
const cutoff = Timestamp.fromMillis(Date.now() - 60_000);

let scanned = 0;
let removed = 0;
let cursor = null;

for (;;) {
  let query = db.collection('serverRateLimits')
    .where('resetAt', '<=', cutoff)
    .orderBy('resetAt')
    .limit(BATCH);
  if (cursor) query = query.startAfter(cursor);

  const snapshot = await query.get();
  if (snapshot.empty) break;
  scanned += snapshot.size;
  cursor = snapshot.docs.at(-1);

  if (APPLY) {
    const batch = db.batch();
    for (const document of snapshot.docs) batch.delete(document.ref);
    await batch.commit();
    removed += snapshot.size;
    // Paging past documents that no longer exist would skip live ones, so a
    // run that deletes restarts from the beginning of what is left.
    cursor = null;
  }

  if (snapshot.size < BATCH && !APPLY) break;
}

console.log(
  APPLY
    ? `Готово. Прострочених лічильників видалено: ${removed}.`
    : `Dry-run. Прострочених лічильників: ${scanned}. Додайте --apply --confirm-project ${FIREBASE_PROJECT_ID}.`,
);
console.log(
  'Постійне рішення — TTL-політика Firestore на полі `resetAt` у колекції '
  + '`serverRateLimits`: вона видаляє прострочене сама і не витрачає квоту записів.',
);
