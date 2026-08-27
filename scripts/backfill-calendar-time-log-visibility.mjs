// Classifies legacy calendar time logs for privacy-safe analytics queries.
//
// Safety:
//   - dry-run is the default;
//   - Firebase project and organization are always explicit;
//   - apply requires exact confirmations for both scopes;
//   - missing/mismatched events and invalid occurrences are reported, not guessed;
//   - the script is standalone and is never invoked by application login.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-calendar-time-log-visibility.mjs \
//     --project quickteam-prod --organization org-id --report ./calendar-time-report.json
//   node --env-file=.env.local scripts/backfill-calendar-time-log-visibility.mjs \
//     --project quickteam-prod --organization org-id --apply \
//     --confirm-project quickteam-prod --confirm-organization org-id
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldPath, FieldValue, getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';

import {
  isCalendarEventOccurrence,
  isCanonicalCalendarOccurrence,
} from '../src/lib/utils/calendarTimeLog.mjs';

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
const REPORT_PATH = argumentValue('--report');
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
  console.error(
    'Apply зупинено: `--confirm-project` і `--confirm-organization` '
    + 'мають точно збігатися з обраною областю.',
  );
  process.exit(2);
}
if (APPLY && !WRITES_FROZEN) {
  console.error(
    'Apply зупинено: закрийте legacy-записи calendar timeLogs і додайте '
    + '`--confirm-writes-frozen`.',
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
  if (clientEmail && privateKey) {
    options.credential = cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail,
      privateKey,
    });
  } else {
    options.credential = applicationDefault();
  }
  return initializeApp(options);
}

function cleanEventDocumentId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return (
    normalized
    && normalized === value
    && normalized.length <= 256
    && !normalized.includes('/')
    && !normalized.includes('\0')
  )
    ? normalized
    : '';
}

function classifyCalendarLog(logSnapshot, eventSnapshot) {
  const log = logSnapshot.data();
  if (
    log.organizationId !== ORGANIZATION_ID
    || log.sourceType !== 'calendar_event'
    || !cleanEventDocumentId(log.eventId)
    || (typeof log.issueId === 'string' && log.issueId.trim())
    || (log.issueId !== undefined && log.issueId !== null && log.issueId !== '')
  ) {
    return { status: 'manual', reason: 'invalid-log-identity' };
  }
  if (!eventSnapshot?.exists) {
    return { status: 'manual', reason: 'event-missing' };
  }
  const event = eventSnapshot.data();
  if (event.organizationId !== ORGANIZATION_ID) {
    return { status: 'manual', reason: 'event-organization-mismatch' };
  }
  if ((event.projectId || '') !== (log.projectId || '')) {
    return { status: 'manual', reason: 'event-project-mismatch' };
  }
  if (
    !isCanonicalCalendarOccurrence(log.occurrenceStartAt)
    || !isCalendarEventOccurrence(event, log.occurrenceStartAt)
  ) {
    return { status: 'manual', reason: 'invalid-occurrence' };
  }
  if (!['team', 'participants', 'private'].includes(event.visibility)) {
    return { status: 'manual', reason: 'invalid-event-visibility' };
  }
  if (typeof event.organizerId !== 'string' || !event.organizerId) {
    return { status: 'manual', reason: 'event-organizer-missing' };
  }
  if (
    typeof log.eventVisibility === 'string'
    && log.eventVisibility
    && log.eventVisibility !== event.visibility
  ) {
    return { status: 'manual', reason: 'visibility-conflict' };
  }
  if (
    typeof log.calendarOrganizerId === 'string'
    && log.calendarOrganizerId
    && log.calendarOrganizerId !== event.organizerId
  ) {
    return { status: 'manual', reason: 'organizer-conflict' };
  }

  const desired = {
    eventVisibility: event.visibility,
    calendarOrganizerId: event.organizerId,
  };
  if (
    log.eventVisibility === desired.eventVisibility
    && log.calendarOrganizerId === desired.calendarOrganizerId
  ) {
    return { status: 'clean', desired };
  }
  return {
    status: event.visibility === 'team' ? 'team-backfill' : 'restricted-backfill',
    desired,
  };
}

const app = initAdmin();
const db = getFirestore(app);
const report = {
  firebaseProjectId: FIREBASE_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  mode: APPLY ? 'apply' : 'dry-run',
  scanned: 0,
  clean: 0,
  teamBackfill: 0,
  restrictedBackfill: 0,
  applied: 0,
  manualReview: [],
};

let cursor = null;
for (;;) {
  let query = db.collection('timeLogs')
    .where('organizationId', '==', ORGANIZATION_ID)
    .where('sourceType', '==', 'calendar_event')
    .orderBy(FieldPath.documentId())
    .limit(250);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;

  const eventIds = [...new Set(
    page.docs
      .map(document => document.data().eventId)
      .map(cleanEventDocumentId)
      .filter(Boolean),
  )];
  const eventSnapshots = eventIds.length
    ? await db.getAll(
      ...eventIds.map(eventId => db.collection('calendarEvents').doc(eventId)),
    )
    : [];
  const eventsById = new Map(
    eventSnapshots.map(snapshot => [snapshot.id, snapshot]),
  );

  for (const logSnapshot of page.docs) {
    report.scanned += 1;
    const classification = classifyCalendarLog(
      logSnapshot,
      eventsById.get(logSnapshot.data().eventId),
    );
    if (classification.status === 'manual') {
      report.manualReview.push({
        timeLogId: logSnapshot.id,
        eventId: logSnapshot.data().eventId || '',
        reason: classification.reason,
      });
      continue;
    }
    if (classification.status === 'clean') {
      report.clean += 1;
      continue;
    }
    if (classification.status === 'team-backfill') report.teamBackfill += 1;
    if (classification.status === 'restricted-backfill') {
      report.restrictedBackfill += 1;
    }
    if (!APPLY) continue;

    await db.runTransaction(async transaction => {
      const currentLogSnapshot = await transaction.get(logSnapshot.ref);
      if (!currentLogSnapshot.exists) {
        throw new Error(`Time log ${logSnapshot.id} disappeared during apply`);
      }
      const currentEventId = currentLogSnapshot.data().eventId;
      const eventRef = db.collection('calendarEvents').doc(currentEventId);
      const currentEventSnapshot = await transaction.get(eventRef);
      const currentClassification = classifyCalendarLog(
        currentLogSnapshot,
        currentEventSnapshot,
      );
      if (
        currentClassification.status !== classification.status
        || currentClassification.desired?.eventVisibility
          !== classification.desired.eventVisibility
        || currentClassification.desired?.calendarOrganizerId
          !== classification.desired.calendarOrganizerId
      ) {
        throw new Error(
          `Time log ${logSnapshot.id} changed after dry-run classification`,
        );
      }
      transaction.update(currentLogSnapshot.ref, {
        ...classification.desired,
        visibilityBackfilledAt: FieldValue.serverTimestamp(),
      });
    });
    report.applied += 1;
  }

  cursor = page.docs.at(-1);
  if (page.size < 250) break;
}

if (REPORT_PATH) {
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (report.manualReview.length > 0) {
  console.error(
    `${report.manualReview.length} записів потребують ручної перевірки; їх не змінено.`,
  );
  process.exitCode = 1;
}
