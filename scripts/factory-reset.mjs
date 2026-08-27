// scripts/factory-reset.mjs
//
// FULL FACTORY RESET of the Firestore data. Deletes EVERY document in EVERY
// top-level collection (and all their subcollections) via the Admin SDK.
// Firebase Authentication accounts are NOT touched — people can log back in and
// the app treats them as new (no org → onboarding).
//
// This is IRREVERSIBLE. There is no undo. Default mode is a dry run that only
// counts; pass --yes to actually delete.
//
// Auth: FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + NEXT_PUBLIC_FIREBASE_PROJECT_ID
// (already in .env.local). Run with:
//   node --env-file=.env.local scripts/factory-reset.mjs            # dry run (counts)
//   node --env-file=.env.local scripts/factory-reset.mjs --yes      # DELETE EVERYTHING
//
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EXECUTE = process.argv.includes('--yes');

function initAdmin() {
  if (getApps().length) return getApp();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
}

async function run() {
  const app = initAdmin();
  const db = getFirestore(app);
  console.log(`\n🧨 FACTORY RESET on "${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}"${EXECUTE ? '' : '  (DRY RUN — no deletes)'}\n`);

  const collections = await db.listCollections();
  if (collections.length === 0) {
    console.log('Database is already empty. Nothing to do.');
    process.exit(0);
  }

  let grandTotal = 0;
  for (const col of collections) {
    // Count top-level docs (subcollections are deleted with recursiveDelete but
    // not counted here — the top-level number is enough to see progress).
    const snap = await col.count().get();
    const n = snap.data().count;
    grandTotal += n;
    console.log(`  ${EXECUTE ? 'deleting' : 'would delete'}  ${col.id}  (${n} top-level docs${EXECUTE ? ' + subcollections' : ''})`);
    if (EXECUTE) {
      await db.recursiveDelete(col);
    }
  }

  console.log(`\n${EXECUTE ? '✅ Deleted' : '📋 Would delete'} ${collections.length} collection(s), ${grandTotal}+ top-level docs (plus all nested subcollections).`);
  if (!EXECUTE) console.log('   Re-run with  --yes  to actually wipe everything.');
  else console.log('   Firestore is now empty. Firebase Auth accounts were left intact — log in to re-onboard.');
  process.exit(0);
}

run().catch(e => { console.error('❌ Factory reset failed:', e); process.exit(1); });
