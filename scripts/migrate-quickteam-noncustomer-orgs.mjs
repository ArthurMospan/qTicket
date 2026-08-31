// Removes the organizations provisioning created for QuickTeam tenants that
// never bought qTicket, together with the seats that put them in the workspace
// switcher.
//
// Why the organization document goes too, and not just the seats: the
// provisioning route now refuses a first snapshot whose entitlement is already
// inactive, and it decides "first" by whether the organization document exists.
// A document left behind would answer yes, the next snapshot would be treated
// as a suspension rather than a stranger, and the seats would come straight
// back. Removing the seats alone repairs the switcher until the next sync.
//
// What is never removed: an organization holding anything at all. While an
// entitlement is inactive the rules refuse every browser write, so a tenant
// that was genuinely suspended after real use still has its projects, requests,
// invitations and read state, and the contract promises those survive until a
// newer active snapshot restores the same support space. Only a provably empty
// non-customer is deleted; anything else is reported for a human to look at and
// left exactly as it is.
//
// Safety:
//   - dry-run is the default;
//   - the Firebase project is always explicit, and apply confirms it twice;
//   - emptiness is verified in the same pass that deletes, per organization;
//   - deletes are keyed by document id, so a retry is idempotent;
//   - this script is never invoked by application login.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-quickteam-noncustomer-orgs.mjs \
//     --project quickteam-prod --report C:\tmp\noncustomer-dry-run.json
//   node --env-file=.env.local scripts/migrate-quickteam-noncustomer-orgs.mjs \
//     --project quickteam-prod --apply --confirm-project quickteam-prod \
//     --confirm-writes-frozen --report C:\tmp\noncustomer-applied.json
import { writeFile } from 'node:fs/promises';
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const FIREBASE_PROJECT_ID = argumentValue('--project');
const ORGANIZATION_ID = argumentValue('--organization');
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const REPORT_PATH = argumentValue('--report');
const APPLY = process.argv.includes('--apply');
const WRITES_FROZEN = process.argv.includes('--confirm-writes-frozen');

if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.startsWith('--')) {
  console.error('Потрібен явний `--project <firebase-project-id>`.');
  process.exit(2);
}
if (FIREBASE_PROJECT_ID.includes('/') || FIREBASE_PROJECT_ID.includes('\0')) {
  console.error('Некоректний Firebase project id.');
  process.exit(2);
}
if (ORGANIZATION_ID && (ORGANIZATION_ID.startsWith('--') || ORGANIZATION_ID.includes('/'))) {
  console.error('Некоректний organization id.');
  process.exit(2);
}
if (APPLY && CONFIRMED_PROJECT_ID !== FIREBASE_PROJECT_ID) {
  console.error('Apply зупинено: `--confirm-project` має точно збігатися з `--project`.');
  process.exit(2);
}
if (APPLY && !WRITES_FROZEN) {
  console.error(
    'Apply зупинено: зупиніть провіженінг з QuickTeam і додайте `--confirm-writes-frozen`. '
    + 'Знімок, що прилетить під час видалення, створить організацію заново.',
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

const app = initAdmin();
const db = getFirestore(app);

// Every collection that carries work belonging to an organization. `orgId` is
// the membership collections' field name and `organizationId` is everybody
// else's (AGENTS.md), so both spellings are asked for. A collection that does
// not exist in this database answers empty, which is the answer we want.
const CONTENT_COLLECTIONS = [
  { name: 'projects', field: 'organizationId' },
  { name: 'issues', field: 'organizationId' },
  { name: 'deletedIssues', field: 'organizationId' },
  { name: 'issueLinks', field: 'organizationId' },
  { name: 'invitations', field: 'organizationId' },
  { name: 'notifications', field: 'organizationId' },
  { name: 'timeLogs', field: 'organizationId' },
  { name: 'tasks', field: 'organizationId' },
];
const CONTENT_SUBCOLLECTIONS = ['issueReadState', 'settings', 'private'];

async function contentHeldBy(organizationId) {
  const held = {};
  for (const { name, field } of CONTENT_COLLECTIONS) {
    const snapshot = await db.collection(name)
      .where(field, '==', organizationId)
      .limit(1)
      .get();
    if (!snapshot.empty) held[name] = true;
  }
  for (const name of CONTENT_SUBCOLLECTIONS) {
    const snapshot = await db.collection('organizations')
      .doc(organizationId)
      .collection(name)
      .limit(1)
      .get();
    if (!snapshot.empty) held[name] = true;
  }
  return Object.keys(held);
}

async function deleteAll(references) {
  for (let index = 0; index < references.length; index += 400) {
    const batch = db.batch();
    for (const reference of references.slice(index, index + 400)) batch.delete(reference);
    await batch.commit();
  }
}

const organizationSnapshot = ORGANIZATION_ID
  ? await db.collection('organizations').doc(ORGANIZATION_ID).get()
    .then(document => (document.exists ? [document] : []))
  : await db.collection('organizations').get().then(snapshot => snapshot.docs);

const report = {
  firebaseProjectId: FIREBASE_PROJECT_ID,
  organizationScope: ORGANIZATION_ID || 'all',
  mode: APPLY ? 'apply' : 'dry-run',
  organizationsScanned: organizationSnapshot.length,
  removed: [],
  kept: [],
  manualReview: [],
};

for (const document of organizationSnapshot) {
  const organizationId = document.id;
  const data = document.data() || {};
  const quickTeam = data.quickTeam || {};
  const entitlement = quickTeam.entitlement || 'inactive';
  const summary = {
    organizationId,
    name: data.name || '',
    sourceOrganizationId: quickTeam.sourceOrganizationId || '',
    entitlement,
  };

  if (entitlement === 'active') {
    report.kept.push({ ...summary, reason: 'active-entitlement' });
    continue;
  }
  // A legacy standalone organization predates the QuickTeam seam and grants no
  // access either (AGENTS.md), but it is not what this migration diagnosed and
  // not what provisioning created. It is reported and left alone; deciding its
  // fate is a separate piece of work with its own evidence.
  if (!summary.sourceOrganizationId) {
    report.manualReview.push({ ...summary, reason: 'legacy-standalone' });
    continue;
  }

  const [seats, archivedSeats, content] = await Promise.all([
    db.collection('orgMemberships').where('orgId', '==', organizationId).get(),
    db.collection('orgMembershipArchive').where('orgId', '==', organizationId).get(),
    contentHeldBy(organizationId),
  ]);

  // Anything at all here means the tenant used qTicket before the entitlement
  // went away. That is a suspension, and a suspension is preserved whole.
  if (content.length > 0) {
    report.manualReview.push({
      ...summary,
      seats: seats.size,
      archivedSeats: archivedSeats.size,
      holds: content,
      reason: 'suspended-with-content',
    });
    continue;
  }

  const entry = {
    ...summary,
    seatsRemoved: seats.size,
    archivedSeatsRemoved: archivedSeats.size,
  };
  if (APPLY) {
    await deleteAll(seats.docs.map(seat => seat.ref));
    await deleteAll(archivedSeats.docs.map(seat => seat.ref));
    // Last, and only once the seats are gone: if the run stops between the two,
    // a re-run still finds the organization and finishes the job. Removing the
    // document first would leave orphan seats nothing points at.
    await document.ref.delete();
  }
  report.removed.push(entry);
}

report.seatsRemoved = report.removed.reduce((total, entry) => total + entry.seatsRemoved, 0);
report.archivedSeatsRemoved = report.removed
  .reduce((total, entry) => total + entry.archivedSeatsRemoved, 0);

if (REPORT_PATH) {
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
console.log(
  APPLY
    ? `Готово: видалено ${report.removed.length} організацій і ${report.seatsRemoved} місць.`
    : `Dry run: під видалення підпадає ${report.removed.length} організацій `
      + `і ${report.seatsRemoved} місць. Нічого не записано.`,
);
if (report.manualReview.length > 0) {
  console.log(
    `${report.manualReview.length} неактивних організацій мають вміст і залишені без змін — `
    + 'перевірте `manualReview` у звіті.',
  );
}
