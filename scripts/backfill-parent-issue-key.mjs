// scripts/backfill-parent-issue-key.mjs
//
// Writes `parentIssueKey` onto every subtask that has a parent but no copy of
// that parent's key.
//
// A subtask card names the task it hangs under. It used to find that task by
// searching the issues that happened to be loaded on the same screen, and the
// parent is usually not among them — another sprint, another column, past the
// loaded page. The identifier slot then fell through to the literal words
// «Батьківське завдання», which read as though that were the task's number.
//
// Tasks written since carry the key (the create and parent-change routes both
// already read the parent document, so keeping its key costs nothing). This
// backfills the ones written before that.
//
// Cost: one read per subtask plus one read per distinct parent, and one write
// per subtask repaired. Nothing is read for a subtask that already has the
// field, so re-running it after a full pass is nearly free.
//
// Idempotent: a subtask whose `parentIssueKey` already matches its parent's key
// is skipped. A subtask whose parent no longer exists is reported and left
// alone — that is a broken link to fix, not a key to invent.
//
// Auth (Admin SDK — bypasses Firestore rules, per CLAUDE.md migration policy):
//   Either set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path,
//   or provide FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + the project id in
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID (same vars the app server uses).
//
// Usage:
//   node scripts/backfill-parent-issue-key.mjs            # apply
//   node scripts/backfill-parent-issue-key.mjs --dry-run  # report only
//
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_LIMIT = 400;

function initAdmin() {
  if (getApps().length) return getApp();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (clientEmail && privateKey) {
    return initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
      projectId,
    });
  }
  return initializeApp({ projectId });
}

async function run() {
  initAdmin();
  const db = getFirestore();

  // Both pointers: `parentEpicId` is the legacy field the model still reads.
  const [canonical, legacy] = await Promise.all([
    db.collection('issues').where('parentIssueId', '!=', null)
      .select('parentIssueId', 'parentIssueKey').get(),
    db.collection('issues').where('parentEpicId', '!=', null)
      .select('parentEpicId', 'parentIssueKey').get(),
  ]);

  const children = new Map();
  for (const document of [...canonical.docs, ...legacy.docs]) {
    const data = document.data();
    const parentId = data.parentIssueId || data.parentEpicId;
    if (!parentId) continue;
    children.set(document.id, { parentId, parentIssueKey: data.parentIssueKey || '' });
  }

  const parentIds = [...new Set([...children.values()].map(entry => entry.parentId))];
  const parents = new Map();
  for (let index = 0; index < parentIds.length; index += 200) {
    const slice = parentIds.slice(index, index + 200);
    const snapshots = await db.getAll(
      ...slice.map(id => db.collection('issues').doc(id)),
      { fieldMask: ['issueKey'] },
    );
    for (const snapshot of snapshots) {
      if (snapshot.exists) parents.set(snapshot.id, snapshot.data().issueKey || '');
    }
  }

  const repairs = [];
  const orphans = [];
  for (const [childId, entry] of children) {
    if (!parents.has(entry.parentId)) {
      orphans.push({ childId, parentId: entry.parentId });
      continue;
    }
    const key = parents.get(entry.parentId);
    if (!key || key === entry.parentIssueKey) continue;
    repairs.push({ childId, key });
  }

  console.log(`subtasks: ${children.size}`);
  console.log(`already correct: ${children.size - repairs.length - orphans.length}`);
  console.log(`to repair: ${repairs.length}`);
  if (orphans.length) {
    console.log(`parent missing (left alone): ${orphans.length}`);
    for (const orphan of orphans.slice(0, 20)) {
      console.log(`  ${orphan.childId} → ${orphan.parentId}`);
    }
  }
  if (DRY_RUN || repairs.length === 0) return;

  for (let index = 0; index < repairs.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const repair of repairs.slice(index, index + BATCH_LIMIT)) {
      batch.update(db.collection('issues').doc(repair.childId), {
        parentIssueKey: repair.key,
      });
    }
    await batch.commit();
    console.log(`written: ${Math.min(index + BATCH_LIMIT, repairs.length)}/${repairs.length}`);
  }
}

run().then(() => process.exit(0)).catch(error => {
  console.error(error);
  process.exit(1);
});
