// Moves the raw YouTrack import record off the task document.
//
// Measured on production, 27.08.2026: 720 tasks, 2 729 KiB of task documents.
// `importMetadata` was 840 KiB of that — the heaviest field in the collection,
// heavier than every description put together — and the product reads three
// sub-fields of it, 40 KiB. The other 800 KiB was delivered to every browser on
// every board load and read by nothing.
//
// The workspace subscribes to every task of every project a person can open, so
// a field on a task is a field every screen pays for whether or not anything
// draws it. This moves the bulk to `issues/{issueId}/import/source`, a
// subcollection no Firestore rule describes and therefore one no browser can
// read at all. The task keeps what the product reads and what identifies the
// import; `src/lib/utils/issueImportRecord.mjs` decides which is which and says
// why.
//
// It saves no Firestore reads. Reads are billed per document and every board
// still reads the same documents — this is payload, parse time and browser
// memory. Worth saying plainly, because the daily read cap is what the outages
// were about and this is not that.
//
// Idempotent: a task whose record has already moved carries none of the bulk
// sub-fields, so a second pass finds nothing to do. That is also the audit — a
// re-run reporting zero is how the migration is declared finished.
//
// Safety (docs/MIGRATIONS.md):
//   - dry run is the default;
//   - an explicit Firebase project is always required;
//   - apply additionally requires an exact --confirm-project value;
//   - nothing is deleted before its copy is written: the subcollection document
//     is created in the same batch that clears the fields, and a batch either
//     lands whole or not at all.
//
// Usage:
//   node --env-file=.env.local scripts/trim-issue-import-metadata.mjs \
//     --project quickteam-me
//   node --env-file=.env.local scripts/trim-issue-import-metadata.mjs \
//     --project quickteam-me --apply --confirm-project quickteam-me \
//     --report ./import-metadata.json
//
// Auth (Admin SDK — bypasses Firestore rules, per AGENTS.md migration policy):
//   GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_CLIENT_EMAIL +
//   FIREBASE_PRIVATE_KEY.
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';

import {
  ARCHIVED_IMPORT_FIELDS,
  ISSUE_IMPORT_COLLECTION,
  ISSUE_IMPORT_DOCUMENT,
  splitIssueImportRecord,
} from '../src/lib/utils/issueImportRecord.mjs';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const FIREBASE_PROJECT_ID = argumentValue('--project');
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const ORGANIZATION_ID = argumentValue('--organization');
const REPORT_PATH = argumentValue('--report');
const APPLY = process.argv.includes('--apply');
// A first apply worth looking at by hand. The pass is idempotent, so running it
// against one task, reading that task back, and then running it against the
// rest is the same operation done twice — not a special mode that behaves
// differently from the real one.
const LIMIT = Number(argumentValue('--limit')) || Infinity;
// Two writes per task — the archive document and the cleared fields — so the
// batch limit is halved rather than assumed.
const ISSUES_PER_BATCH = 200;

if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.startsWith('--')) {
  console.error('Потрібен явний `--project <firebase-project-id>`.');
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

/** Roughly what a value costs on the wire. Only ever compared against itself. */
function weigh(value) {
  if (value === null || value === undefined) return 1;
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') + 1;
  if (typeof value === 'number') return 8;
  if (typeof value === 'boolean') return 1;
  if (typeof value?.toDate === 'function') return 8;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + weigh(item), 0);
  if (typeof value === 'object') {
    return Object.entries(value).reduce(
      (sum, [key, item]) => sum + Buffer.byteLength(key, 'utf8') + 1 + weigh(item),
      0,
    );
  }
  return 8;
}

async function main() {
  initAdmin();
  const db = getFirestore();

  let query = db.collection('issues');
  if (ORGANIZATION_ID) query = query.where('organizationId', '==', ORGANIZATION_ID);
  const snapshot = await query.get();

  const movable = [];
  const perField = new Map();
  let corpusBytes = 0;
  let movedBytes = 0;

  for (const document of snapshot.docs) {
    const data = document.data();
    corpusBytes += weigh(data);
    const record = splitIssueImportRecord(data.importMetadata);
    if (!record.hasArchive) continue;
    const bytes = weigh(record.archived);
    movedBytes += bytes;
    for (const [key, value] of Object.entries(record.archived)) {
      perField.set(key, (perField.get(key) || 0) + weigh(value));
    }
    movable.push({
      ref: document.ref,
      id: document.id,
      issueKey: data.issueKey || '',
      organizationId: data.organizationId || '',
      archived: record.archived,
      importedAt: data.importedAt || data.importMetadata?.importedAt || null,
      bytes,
    });
  }

  const applying = Number.isFinite(LIMIT) ? movable.slice(0, LIMIT) : movable;
  if (APPLY) {
    for (let offset = 0; offset < applying.length; offset += ISSUES_PER_BATCH) {
      const batch = db.batch();
      for (const entry of applying.slice(offset, offset + ISSUES_PER_BATCH)) {
        // The copy first, the removal second, both in one batch: a batch lands
        // whole or not at all, so there is no instant at which the record
        // exists nowhere.
        batch.set(
          entry.ref.collection(ISSUE_IMPORT_COLLECTION).doc(ISSUE_IMPORT_DOCUMENT),
          { ...entry.archived, ...(entry.importedAt ? { importedAt: entry.importedAt } : {}) },
        );
        batch.update(entry.ref, Object.fromEntries(
          ARCHIVED_IMPORT_FIELDS.map(field => [`importMetadata.${field}`, FieldValue.delete()]),
        ));
      }
      await batch.commit();
    }
  }

  const kib = bytes => `${(bytes / 1024).toFixed(0)} KiB`;
  console.log(`Проєкт Firebase : ${FIREBASE_PROJECT_ID}`);
  console.log(`Режим           : ${APPLY ? 'APPLY (записує)' : 'DRY RUN (нічого не пише)'}`);
  console.log(`Задач прочитано : ${snapshot.size}`);
  console.log(`Задач до руху   : ${movable.length}${
    Number.isFinite(LIMIT) ? ` (цього разу — ${Math.min(LIMIT, movable.length)})` : ''
  }`);
  console.log(`Вага корпусу    : ${kib(corpusBytes)}`);
  console.log(`Переїжджає      : ${kib(movedBytes)} (${corpusBytes ? ((movedBytes / corpusBytes) * 100).toFixed(1) : '0'}% корпусу)`);
  console.log('');
  if (perField.size) {
    console.log('За полями:');
    [...perField.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, bytes]) => {
        const share = corpusBytes ? ((bytes / corpusBytes) * 100).toFixed(1) : '0.0';
        console.log(`  ${key.padEnd(20)} ${kib(bytes).padStart(9)}  ${share}%`);
      });
    console.log('');
  }
  if (!movable.length) {
    console.log('Нічого рухати. Міграція завершена.');
  }

  if (REPORT_PATH) {
    await writeFile(REPORT_PATH, `${JSON.stringify({
      firebaseProject: FIREBASE_PROJECT_ID,
      apply: APPLY,
      generatedAt: new Date().toISOString(),
      issuesRead: snapshot.size,
      corpusBytes,
      movedBytes,
      perField: Object.fromEntries(perField),
      issues: movable.map(({ ref: _ref, archived: _archived, ...rest }) => rest),
    }, null, 2)}\n`, 'utf8');
    console.log(`Звіт            : ${REPORT_PATH}`);
  }

  if (!APPLY && movable.length) {
    console.log('');
    console.log('Щоб застосувати:');
    console.log(`  node --env-file=.env.local scripts/trim-issue-import-metadata.mjs --project ${FIREBASE_PROJECT_ID} --apply --confirm-project ${FIREBASE_PROJECT_ID}`);
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
