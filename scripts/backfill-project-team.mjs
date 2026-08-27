// scripts/backfill-project-team.mjs
//
// Backfills `team` on every `projects/{id}` document so the team-gated project
// visibility rule (owners/admins see all; members see only projects whose
// `team` contains their uid) has a field to work against on legacy projects.
//
// A project written before `team` existed would otherwise be invisible to every
// plain member (the rule requires `team is list && uid in team`). This seeds a
// missing/empty team with the project creator (`createdBy`) so at minimum the
// creator keeps access; owners/admins see everything regardless. Members are
// added to projects afterwards via the "Команда проєкту" tab.
//
// Idempotent: projects that already have a non-empty `team` array are skipped.
//
// Auth (Admin SDK — bypasses Firestore rules, per CLAUDE.md migration policy):
//   Either set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON path,
//   or provide FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + the project id in
//   NEXT_PUBLIC_FIREBASE_PROJECT_ID (same vars the app server uses).
//
// Usage:
//   node scripts/backfill-project-team.mjs            # apply
//   node scripts/backfill-project-team.mjs --dry-run  # report only, no writes
//
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DRY_RUN = process.argv.includes('--dry-run');

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
  // Falls back to GOOGLE_APPLICATION_CREDENTIALS / ADC.
  return initializeApp({ projectId });
}

async function run() {
  const app = initAdmin();
  const db = getFirestore(app);
  console.log(`🚀 Backfilling project.team${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…`);

  const snap = await db.collection('projects').get();
  console.log(`📋 ${snap.size} project(s) total.`);

  let updated = 0;
  let skipped = 0;
  let orphaned = 0;
  let batch = db.batch();
  let pending = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const team = data.team;
    if (Array.isArray(team) && team.length > 0) {
      skipped += 1;
      continue;
    }

    const creator = data.createdBy || data.ownerId || null;
    const nextTeam = creator ? [creator] : [];
    if (!creator) {
      orphaned += 1;
      console.warn(`   ⚠ ${docSnap.id} ("${data.name || 'unnamed'}") has no createdBy — setting team=[] (only owners/admins will see it until members are added).`);
    }

    if (!DRY_RUN) {
      batch.update(docSnap.ref, { team: nextTeam });
      pending += 1;
      if (pending >= 400) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }
    updated += 1;
  }

  if (!DRY_RUN && pending > 0) await batch.commit();

  console.log(`\n✅ Done. updated=${updated} skipped=${skipped} orphaned(no creator)=${orphaned}`);
  if (DRY_RUN) console.log('   (dry run — re-run without --dry-run to apply)');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
