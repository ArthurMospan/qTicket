// Removes the legacy "Епік" issue type and the one issue still carrying it.
//
// The epic type was dropped from the product long ago; what remained was a
// leftover entry in the organization workflow plus the issues created while it
// existed. Idempotent: re-running finds nothing left to change.
//
// Usage: node scripts/remove-legacy-epic-type.mjs [--apply]
// Without --apply it only reports what it would do.

import { readFileSync } from 'node:fs';
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter(line => line && !line.startsWith('#') && line.includes('='))
    .map(line => {
      const index = line.indexOf('=');
      let value = line.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      return [line.slice(0, index).trim(), value];
    }),
);

const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured');

const app = initializeApp({
  projectId,
  credential: cert({
    projectId,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

const db = getFirestore(app);
console.log(`Firebase project: ${projectId} — ${apply ? 'APPLY' : 'dry run'}`);

const organizations = await db.collection('organizations').get();

for (const organization of organizations.docs) {
  const workflowRef = organization.ref.collection('settings').doc('workflow');
  const workflowSnap = await workflowRef.get();
  const types = workflowSnap.exists && Array.isArray(workflowSnap.data().types)
    ? workflowSnap.data().types
    : [];
  const withoutEpic = types.filter(type => type?.id !== 'epic');
  if (withoutEpic.length !== types.length) {
    console.log(`  ${organization.id}: dropping the epic type from the workflow`);
    if (apply) await workflowRef.update({ types: withoutEpic });
  }

  const epicIssues = await db.collection('issues')
    .where('organizationId', '==', organization.id)
    .where('type', '==', 'epic')
    .get();

  for (const issue of epicIssues.docs) {
    const data = issue.data();
    console.log(`  ${organization.id}: deleting ${data.issueKey || issue.id} — "${data.title}"`);
    if (!apply) continue;

    // Links first: a dangling link would keep blocking other issues.
    for (const field of ['sourceIssueId', 'targetIssueId']) {
      const links = await db.collection('issueLinks').where(field, '==', issue.id).get();
      for (const link of links.docs) await link.ref.delete();
    }
    // Children are re-parented rather than deleted — they are real work.
    for (const field of ['parentIssueId', 'parentEpicId']) {
      const children = await db.collection('issues').where(field, '==', issue.id).get();
      for (const child of children.docs) await child.ref.update({ [field]: null });
    }
    for (const nested of ['audit', 'comments']) {
      const documents = await issue.ref.collection(nested).get();
      for (const document of documents.docs) await document.ref.delete();
    }
    await issue.ref.delete();
  }
}

console.log(apply ? 'Done.' : 'Dry run complete — re-run with --apply to write.');
process.exit(0);
