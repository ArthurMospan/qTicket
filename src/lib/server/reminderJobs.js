import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { deliverEmail, emailConfigured } from '@/lib/server/email';
import { deliverTelegramNotification } from '@/lib/server/telegram';
import { generateEmailTemplate } from '@/lib/utils/sendEmail';
import { BIRTHDAY_NOTIFICATION_TYPE, shouldDeliver } from '@/lib/utils/notificationChannels.mjs';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';
import {
  DEADLINE_FLOOR_MS,
  DEADLINE_HORIZON_MS,
  REMINDER_LOOKBACK_MS,
  calendarReminderCandidates,
  clampReminderLookback,
  dayKeyInTimeZone,
  deadlineReminderCandidates,
} from '@/lib/utils/reminderCandidates.mjs';
import { telegramAppLink } from '@/lib/server/telegram';
import {
  dispatchDueNotifications,
  materialiseCandidates,
  reconcileScopedRows,
} from '@/lib/server/notificationOutbox';
import {
  OUTBOX_COLLECTION,
  READ_NOTIFICATION_TTL_MS,
  expirableNotificationIds,
} from '@/lib/utils/notificationOutbox.mjs';
import { MATERIALISE_LEAD_MS } from '@/lib/utils/notificationOutbox.mjs';
import { resolveClosedStatusIds } from '@/lib/utils/workflowDefaults.mjs';
import { purgeExpiredDeletedIssues } from '@/lib/server/issueTrash';
import { recountProjectIssueCounts } from '@/lib/server/projectIssueCounts';
import { issuePath } from '@/lib/utils/issueKeys.mjs';

const DELIVERY_CONCURRENCY = 10;
// The sweep's own memory of when it last ran. Server-written only; Firestore
// rules have no `system` match, so the browser cannot read or forge it.
const SWEEP_STATE_PATH = ['system', 'notificationSweep'];
// How far ahead a calendar reminder can be configured. Bounds the query that
// used to read the entire calendarEvents collection on every pass — 288 passes a
// day against a Spark project with a 50k daily read cap.
const CALENDAR_LEAD_MS = 8 * 24 * 60 * 60 * 1000;
const RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'];
// How many recurring series one pass will consider. A series that has not
// started yet cannot produce an occurrence inside the window, so the query is
// bounded forward; backwards there is no edge — a standing weekly meeting from
// two years ago is still due on Thursday — and what bounds it instead is how
// many series the workspace has ever created, which is the same kind of bound
// as «projects of one organization». This is the ceiling on that assumption,
// and it is loud when it is reached rather than silently dropping events.
const RECURRING_SCAN_LIMIT = 500;

function sweepStateRef() {
  const db = getAdminDb();
  return db.collection(SWEEP_STATE_PATH[0]).doc(SWEEP_STATE_PATH[1]);
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadRecipientContext(candidates) {
  const db = getAdminDb();
  const userIds = [...new Set(candidates.map(candidate => candidate.userId).filter(Boolean))];
  const membershipKeys = [...new Set(candidates
    .filter(candidate => candidate.organizationId && candidate.userId)
    .map(candidate => `${candidate.organizationId}_${candidate.userId}`))];
  if (!userIds.length) {
    return { memberships: new Map(), preferences: new Map(), profiles: new Map() };
  }

  const [membershipSnapshots, preferenceSnapshots, profileSnapshots] = await Promise.all([
    membershipKeys.length
      ? db.getAll(...membershipKeys.map(key => db.collection('orgMemberships').doc(key)))
      : [],
    db.getAll(...userIds.map(uid =>
      db.collection('users').doc(uid).collection('settings').doc('notifications'))),
    db.getAll(...userIds.map(uid => db.collection('users').doc(uid))),
  ]);

  return {
    memberships: new Map(membershipKeys.map((key, index) => [
      key,
      membershipSnapshots[index]?.exists ? membershipSnapshots[index].data() : null,
    ])),
    preferences: new Map(userIds.map((uid, index) => [
      uid,
      preferenceSnapshots[index]?.exists ? preferenceSnapshots[index].data() : {},
    ])),
    profiles: new Map(userIds.map((uid, index) => [
      uid,
      profileSnapshots[index]?.exists ? profileSnapshots[index].data() : {},
    ])),
  };
}

async function claimAndDeliver(candidate, context, { allowEmail = true } = {}) {
  const membership = context.memberships.get(`${candidate.organizationId}_${candidate.userId}`);
  if (
    !membership ||
    membership.orgId !== candidate.organizationId ||
    membership.userId !== candidate.userId
  ) {
    return { claimed: 0, email: 0, telegram: null };
  }

  const preferences = context.preferences.get(candidate.userId) || {};
  const profile = context.profiles.get(candidate.userId) || {};
  const inapp = shouldDeliver(preferences, 'inapp', candidate.type);
  const email = allowEmail &&
    shouldDeliver(preferences, 'email', candidate.type) &&
    Boolean(profile.email);
  const telegram = shouldDeliver(preferences, 'telegram', candidate.type);
  if (!inapp && !email && !telegram) return { claimed: 0, email: 0, telegram: null };

  const db = getAdminDb();
  const ref = db.collection('notifications').doc(candidate.id);
  try {
    await ref.create({
      userId: candidate.userId,
      type: candidate.type,
      title: candidate.title,
      body: candidate.body,
      link: candidate.link,
      issueId: candidate.issueId || '',
      projectId: candidate.projectId || '',
      organizationId: candidate.organizationId,
      ...(candidate.calendarEventId ? { calendarEventId: candidate.calendarEventId } : {}),
      actorId: candidate.actorId || 'quickteam-system',
      actorName: candidate.actorName || 'QuickTeam',
      actorAvatar: '',
      read: false,
      inapp,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (error.code === 6 || error.code === 'already-exists') {
      return { claimed: 0, email: 0, telegram: null };
    }
    throw error;
  }

  const emailResult = email
    ? await deliverEmail({
      to: profile.email,
      subject: candidate.title,
      html: generateEmailTemplate({
        type: candidate.type,
        title: candidate.title,
        body: candidate.body,
        link: candidate.link,
      }),
    }).then(() => 1).catch(error => {
      console.warn('[reminder-job] Email delivery failed:', error.message);
      return 0;
    })
    : 0;

  // Telegram is not sent here. A sweep that has been waiting three hours for the
  // scheduler routinely claims several reminders for one person at once, and
  // sending each on its own turned "you have things to look at" into six
  // near-identical pings. The claimed items are handed back and delivered as one
  // digest per recipient below.
  return {
    claimed: 1,
    email: emailResult,
    telegram: telegram
      ? {
        userId: candidate.userId,
        type: candidate.type,
        title: candidate.title,
        body: candidate.body,
        url: telegramAppLink(candidate.link),
      }
      : null,
  };
}

async function deliverTelegramDigests(results) {
  const itemsByUserId = new Map();
  for (const result of results) {
    if (!result?.telegram) continue;
    const list = itemsByUserId.get(result.telegram.userId) || [];
    list.push(result.telegram);
    itemsByUserId.set(result.telegram.userId, list);
  }
  if (!itemsByUserId.size) return 0;
  const delivery = await deliverTelegramNotification({
    userIds: [...itemsByUserId.keys()],
    itemsByUserId,
  }).catch(error => {
    console.warn('[reminder-job] Telegram delivery failed:', error.message);
    return { delivered: 0 };
  });
  return delivery.delivered || 0;
}

function summarize(results, telegramDelivered = 0) {
  return results.reduce(
    (summary, result) => ({
      claimed: summary.claimed + (result?.claimed || 0),
      email: summary.email + (result?.email || 0),
      telegram: summary.telegram,
    }),
    { claimed: 0, email: 0, telegram: telegramDelivered },
  );
}

const CALENDAR_FIELDS = [
  'organizationId',
  'title',
  'startAt',
  'participantIds',
  'participantResponses',
  'reminderMinutes',
  'recurrence',
  'excludedOccurrenceStarts',
  'organizerId',
];

// Two bounded queries instead of one unbounded scan. A one-off event only
// matters while its start is inside the reminder window; a recurring one has a
// start in the past forever, so it is fetched by its recurrence instead. Every
// event the old full scan returned is still covered, at a fraction of the reads.
//
// Only the global sweep takes this path. The authenticated diagnostic route
// already narrows to one organization and one participant — both covered by an
// existing composite index — and adding a range on top would need two more.
async function loadReminderEvents({ nowMs, lookBackMs, organizationId, recipientId }) {
  const db = getAdminDb();
  if (organizationId || recipientId) {
    let query = db.collection('calendarEvents');
    if (organizationId) query = query.where('organizationId', '==', organizationId);
    if (recipientId) query = query.where('participantIds', 'array-contains', recipientId);
    const snapshot = await query.select(...CALENDAR_FIELDS).get();
    return snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  }

  const recurringQuery = db.collection('calendarEvents')
    .where('recurrence.frequency', 'in', RECURRING_FREQUENCIES)
    // Forward edge. A series whose first occurrence is past the lead cannot
    // reach into this window, and if it could the query above would have it.
    .where('startAt', '<=', Timestamp.fromMillis(nowMs + CALENDAR_LEAD_MS))
    .select(...CALENDAR_FIELDS)
    .limit(RECURRING_SCAN_LIMIT);
  const [upcoming, recurring] = await Promise.all([
    db.collection('calendarEvents')
      .where('startAt', '>=', Timestamp.fromMillis(nowMs - lookBackMs))
      .where('startAt', '<=', Timestamp.fromMillis(nowMs + CALENDAR_LEAD_MS))
      .select(...CALENDAR_FIELDS)
      .get(),
    recurringQuery.get().catch(error => {
      // Deployments are not atomic with Firestore index creation. The unbounded
      // shape still works while (recurrence.frequency, startAt) is building.
      if (error?.code !== 9 && error?.code !== 'failed-precondition') throw error;
      console.warn('[reminder-job] Recurring-window index is not ready; scanning unbounded');
      return db.collection('calendarEvents')
        .where('recurrence.frequency', 'in', RECURRING_FREQUENCIES)
        .select(...CALENDAR_FIELDS)
        .get();
    }),
  ]);
  if (recurring.size >= RECURRING_SCAN_LIMIT) {
    console.warn(
      `[reminder-job] ${RECURRING_SCAN_LIMIT} recurring events reached the scan ceiling; `
      + 'reminders for the rest of them are not being materialised',
    );
  }

  const events = new Map();
  for (const document of [...upcoming.docs, ...recurring.docs]) {
    events.set(document.id, { ...document.data(), id: document.id });
  }
  return [...events.values()];
}

// A calendar reminder is deliberately not emailed: it is a nudge minutes
// before a meeting, and an inbox is the wrong place for one.
function decorateCalendarCandidate(candidate) {
  const occurrence = new Date(candidate.occurrenceStart).toISOString();
  return {
    ...candidate,
    allowEmail: false,
    link: withNotificationOrganization(
      `/calendar/event/${encodeURIComponent(candidate.calendarEventId)}?occurrence=${encodeURIComponent(occurrence)}`,
      candidate.organizationId,
    ),
  };
}

export async function collectCalendarCandidates({
  nowMs = Date.now(),
  lookBackMs = REMINDER_LOOKBACK_MS,
  lookAheadMs = 0,
  organizationId = '',
  recipientId = '',
} = {}) {
  const events = await loadReminderEvents({ nowMs, lookBackMs, organizationId, recipientId });
  return calendarReminderCandidates(events, { nowMs, lookBackMs, lookAheadMs, recipientId })
    .map(decorateCalendarCandidate);
}

export async function runCalendarReminderSweep({
  nowMs = Date.now(),
  organizationId = '',
  recipientId = '',
  lookBackMs = REMINDER_LOOKBACK_MS,
} = {}) {
  const events = await loadReminderEvents({ nowMs, lookBackMs, organizationId, recipientId });
  const candidates = calendarReminderCandidates(events, { nowMs, lookBackMs, recipientId }).map(candidate => {
    const occurrence = new Date(candidate.occurrenceStart).toISOString();
    return {
      ...candidate,
      link: withNotificationOrganization(
        `/calendar/event/${encodeURIComponent(candidate.calendarEventId)}?occurrence=${encodeURIComponent(occurrence)}`,
        candidate.organizationId,
      ),
    };
  });
  if (!candidates.length) return { candidates: 0, claimed: 0, email: 0, telegram: 0 };

  const context = await loadRecipientContext(candidates);
  const results = await mapWithConcurrency(
    candidates,
    DELIVERY_CONCURRENCY,
    candidate => claimAndDeliver(candidate, context, { allowEmail: false }),
  );
  return { candidates: candidates.length, ...summarize(results, await deliverTelegramDigests(results)) };
}

// What the sweep and a single write both need to know about an organization
// before a deadline candidate means anything: which statuses close a task, and
// what «сьогодні» means where the workspace is.
//
// Cached in process for a few minutes because a write path pays for it on an
// action a person just performed, and both documents change about once a year.
// Vercel reuses a function instance across requests, so this is usually free.
const ORGANIZATION_CONTEXT_TTL_MS = 5 * 60 * 1000;
const organizationContextCache = new Map();

async function organizationReminderContext(organizationId, { nowMs = Date.now() } = {}) {
  const cached = organizationContextCache.get(organizationId);
  if (cached && nowMs - cached.readAtMs < ORGANIZATION_CONTEXT_TTL_MS) return cached.value;
  const db = getAdminDb();
  const [organizationSnapshot, workflowSnapshot] = await db.getAll(
    db.collection('organizations').doc(organizationId),
    db.collection('organizations').doc(organizationId).collection('settings').doc('workflow'),
  );
  const value = {
    closedStatusIds: new Set(resolveClosedStatusIds(workflowSnapshot?.data()?.statuses)),
    timeZone: organizationSnapshot?.data()?.timezone || 'Europe/Kyiv',
  };
  organizationContextCache.set(organizationId, { readAtMs: nowMs, value });
  return value;
}

// A candidate is a row waiting to be written; this is the only place that turns
// one into something a reader can act on, so the sweep and a write cannot
// disagree about the link or the sender.
function decorateDeadlineCandidate(candidate) {
  return {
    ...candidate,
    actorId: 'quickteam-system',
    actorName: 'QuickTeam',
    link: withNotificationOrganization(
      issuePath({ id: candidate.issueId, issueKey: candidate.issueKey }, candidate.projectId),
      candidate.organizationId,
    ),
  };
}

/**
 * The reminders one task owes right now, written down the moment its deadline
 * is set rather than found by a scan hours later.
 *
 * A deadline is knowable at exactly one instant — when somebody types it — and
 * that is the cheapest possible moment to record it: no query finds the task,
 * because the caller is holding it. Everything after that is the same
 * reconciliation the nightly sweep does, against the same row ids, so the two
 * are idempotent with respect to each other.
 *
 * Passing `issue: null` (or an issue with no deadline, a closed status, an
 * archive or a cancellation) is how a row gets removed: there is nothing to
 * want, so what is pending is cancelled.
 *
 * @param {{issueId: string, issue?: object|null, nowMs?: number}} options
 */
export async function syncIssueReminderRows({ issueId, issue = undefined, nowMs = Date.now() }) {
  if (!issueId) return { created: 0, updated: 0, cancelled: 0 };
  const db = getAdminDb();
  let source = issue;
  if (source === undefined) {
    const snapshot = await db.collection('issues').doc(issueId).get();
    source = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }

  let candidates = [];
  if (source?.organizationId) {
    const context = await organizationReminderContext(source.organizationId, { nowMs });
    candidates = deadlineReminderCandidates([{ ...source, id: issueId }], {
      nowMs,
      lookAheadMs: MATERIALISE_LEAD_MS,
      closedStatusIdsByOrganization: new Map([[source.organizationId, context.closedStatusIds]]),
      timeZonesByOrganization: new Map([[source.organizationId, context.timeZone]]),
    }).map(decorateDeadlineCandidate);
  }

  return reconcileScopedRows(candidates, {
    scope: { issueId },
    windowStartMs: nowMs - REMINDER_LOOKBACK_MS,
    windowEndMs: nowMs + MATERIALISE_LEAD_MS,
    nowMs,
  });
}

/**
 * The same, for one calendar event. Creating or moving an event writes its
 * reminders down; deleting it, or removing somebody from it, takes them away.
 *
 * @param {{eventId: string, event?: object|null, nowMs?: number}} options
 */
export async function syncCalendarEventReminderRows({
  eventId,
  event = undefined,
  nowMs = Date.now(),
}) {
  if (!eventId) return { created: 0, updated: 0, cancelled: 0 };
  const db = getAdminDb();
  let source = event;
  if (source === undefined) {
    const snapshot = await db.collection('calendarEvents').doc(eventId).get();
    source = snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null;
  }

  const candidates = source?.organizationId
    ? calendarReminderCandidates([{ ...source, id: eventId }], {
      nowMs,
      lookBackMs: REMINDER_LOOKBACK_MS,
      lookAheadMs: MATERIALISE_LEAD_MS,
    }).map(decorateCalendarCandidate)
    : [];

  return reconcileScopedRows(candidates, {
    scope: { calendarEventId: eventId },
    windowStartMs: nowMs - REMINDER_LOOKBACK_MS,
    windowEndMs: nowMs + MATERIALISE_LEAD_MS,
    nowMs,
  });
}

// The deadline half of materialisation: every candidate the window can see,
// with its delivery time, and no delivery.
export async function collectDeadlineCandidates({ nowMs = Date.now(), lookAheadMs = 0 } = {}) {
  const db = getAdminDb();
  const snapshot = await db.collection('issues')
    // Bounded on both sides. Without the floor this read every issue that had
    // ever slipped its deadline, on every pass, and those issues no longer
    // produce candidates anyway.
    .where('dueDate', '>=', Timestamp.fromMillis(nowMs - DEADLINE_FLOOR_MS))
    .where('dueDate', '<=', Timestamp.fromMillis(nowMs + DEADLINE_HORIZON_MS + lookAheadMs))
    .select(
      'organizationId',
      'projectId',
      'issueKey',
      'title',
      'dueDate',
      'assigneeIds',
      'columnId',
      'status',
      // Read so the candidate filter can drop tasks that were put aside. A
      // projection that omits either would silently make every archived or
      // cancelled task look active here, and go on chasing people about work
      // that is not going to happen.
      'archivedAt',
      'cancelledAt',
    )
    .get();
  const issues = snapshot.docs.map(document => ({ ...document.data(), id: document.id }));
  const organizationIds = [...new Set(issues.map(issue => issue.organizationId).filter(Boolean))];
  if (!organizationIds.length) return [];

  const [organizationSnapshots, workflowSnapshots] = await Promise.all([
    db.getAll(...organizationIds.map(id => db.collection('organizations').doc(id))),
    db.getAll(...organizationIds.map(id =>
      db.collection('organizations').doc(id).collection('settings').doc('workflow'))),
  ]);
  const closedStatusIdsByOrganization = new Map(organizationIds.map((id, index) => [
    id,
    new Set(resolveClosedStatusIds(workflowSnapshots[index]?.data()?.statuses)),
  ]));
  const timeZonesByOrganization = new Map(organizationIds.map((id, index) => [
    id,
    organizationSnapshots[index]?.data()?.timezone || 'Europe/Kyiv',
  ]));
  return deadlineReminderCandidates(issues, {
    nowMs,
    lookAheadMs,
    closedStatusIdsByOrganization,
    timeZonesByOrganization,
  }).map(decorateDeadlineCandidate);
}

export async function runDeadlineReminderSweep({ nowMs = Date.now() } = {}) {
  const candidates = (await collectDeadlineCandidates({ nowMs }))
    .filter(candidate => Number(candidate.deliverAtMs) <= nowMs);
  if (!candidates.length) return { candidates: 0, claimed: 0, email: 0, telegram: 0 };

  const context = await loadRecipientContext(candidates);
  const results = await mapWithConcurrency(
    candidates,
    DELIVERY_CONCURRENCY,
    candidate => claimAndDeliver(candidate, context),
  );
  return { candidates: candidates.length, ...summarize(results, await deliverTelegramDigests(results)) };
}

function birthdayParts(nowMs, timeZone) {
  const [year, month, day] = dayKeyInTimeZone(nowMs, timeZone).split('-');
  return { year, month, day };
}

// Everyone but the birthday person gets a bell entry pointing at the greeting.
// Deterministic ids, so a re-run — the scheduled sweep after an on-demand one —
// writes the same documents rather than a second set.
async function createBirthdayNotifications({
  organizationId,
  memberIds,
  birthdayUserId,
  dayKey,
  name,
}) {
  const db = getAdminDb();
  const recipients = memberIds.filter(userId => userId && userId !== birthdayUserId);
  if (!recipients.length) return;
  const link = withNotificationOrganization('/chat', organizationId);
  const batch = db.batch();
  for (const userId of recipients) {
    batch.create(
      db.collection('notifications').doc(`birthday_${dayKey}_${birthdayUserId}_${userId}`),
      {
        userId,
        type: BIRTHDAY_NOTIFICATION_TYPE,
        title: `Сьогодні день народження у ${name}`,
        body: 'Привітайте колегу в загальному чаті 🎉',
        link,
        issueId: '',
        projectId: '',
        organizationId,
        actorId: 'quickteam-system',
        actorName: 'QuickTeam',
        actorAvatar: '',
        read: false,
        inapp: true,
        createdAt: FieldValue.serverTimestamp(),
      },
    );
  }
  await batch.commit().catch(error => {
    // A batch of `create`s fails as a whole if any id already exists, which is
    // exactly what a repeat pass looks like. Nothing to repair.
    if (error.code === 6 || error.code === 'already-exists') return;
    console.warn('[reminder-job] Birthday notifications failed:', error.message);
  });
}

// `userId` narrows the scan to one person, and `force` skips the once-a-day
// claim. Both exist for the same reason: the claim is a cost control, not a
// correctness one — the greeting itself is idempotent through its document id —
// and a birthday saved *after* the day's scheduled pass had already claimed the
// day used to be silently skipped until the following year.
async function runOrganizationBirthdaySweep(
  organizationId,
  timeZone,
  nowMs,
  { userId = '', force = false } = {},
) {
  const db = getAdminDb();
  const today = birthdayParts(nowMs, timeZone);
  const dayKey = `${today.year}_${today.month}_${today.day}`;
  if (!force) {
    const claimRef = db.collection('organizations').doc(organizationId)
      .collection('settings').doc(`birthdaySweep_${dayKey}`);
    try {
      await claimRef.create({ claimedAt: FieldValue.serverTimestamp() });
    } catch (error) {
      if (error.code === 6 || error.code === 'already-exists') return 0;
      throw error;
    }
  }

  const membershipsSnapshot = await db.collection('orgMemberships')
    .where('orgId', '==', organizationId)
    .get();
  const allMemberships = membershipsSnapshot.docs.map(document => document.data());
  if (!allMemberships.length) return 0;
  const memberIds = allMemberships.map(membership => membership.userId).filter(Boolean);
  const memberships = userId
    ? allMemberships.filter(membership => membership.userId === userId)
    : allMemberships;
  if (!memberships.length) return 0;
  const profiles = await db.getAll(...memberships.map(membership =>
    db.collection('users').doc(membership.userId)));
  let created = 0;

  await mapWithConcurrency(memberships, DELIVERY_CONCURRENCY, async (membership, index) => {
    const profile = profiles[index]?.exists ? profiles[index].data() : {};
    const birthday = typeof profile.birthday === 'string'
      ? profile.birthday
      : typeof profile.profile?.birthday === 'string'
        ? profile.profile.birthday
        : '';
    if (birthday.slice(5) !== `${today.month}-${today.day}`) return;

    const name = profile.name || profile.email || 'нашого колеги';
    const greetingId = `birthday_${dayKey}_${membership.userId}`;
    const messageRef = db.collection('organizations').doc(organizationId)
      .collection('channels').doc('general').collection('messages').doc(greetingId);
    try {
      const text = `🎉 Сьогодні день народження у ${name}! Вітаємо, бажаємо натхнення, крутих результатів і чудового року попереду!`;
      await messageRef.create({
        text,
        attachments: [],
        senderId: 'quickteam-system',
        user: 'QuickTeam',
        avatar: null,
        system: true,
        type: 'birthday',
        birthdayUserId: membership.userId,
        createdAt: FieldValue.serverTimestamp(),
        readBy: [],
      });
      await db.collection('organizations').doc(organizationId).collection('channels').doc('general').set({
        name: 'general',
        type: 'public',
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessageText: text.slice(0, 80),
        lastMessageSender: 'QuickTeam',
        lastMessageSenderId: 'quickteam-system',
        messageCount: FieldValue.increment(1),
      }, { merge: true });
      created += 1;
    } catch (error) {
      if (error.code !== 6 && error.code !== 'already-exists') throw error;
      // The greeting was already posted today; the notifications below are
      // written anyway, because an earlier pass may have posted the message
      // before this half existed.
    }
    await createBirthdayNotifications({
      organizationId,
      memberIds,
      birthdayUserId: membership.userId,
      dayKey,
      name,
    });
  });

  return created;
}

// A greeting has to land on the right day, not the right minute. Scanning every
// organization on all 288 passes of a day bought nothing and cost a full
// collection read each time; every half hour still puts the greeting in the
// channel within thirty minutes of local midnight, in any timezone.
export const BIRTHDAY_SCAN_INTERVAL_MS = 30 * 60 * 1000;

export async function runBirthdaySweep({
  nowMs = Date.now(),
  organizationId = '',
  lastScanAtMs = null,
  userId = '',
  force = false,
} = {}) {
  const db = getAdminDb();
  if (!organizationId && Number.isFinite(lastScanAtMs) &&
      nowMs - lastScanAtMs < BIRTHDAY_SCAN_INTERVAL_MS) {
    return { created: 0, skipped: true };
  }
  const snapshots = organizationId
    ? [await db.collection('organizations').doc(organizationId).get()]
    : (await db.collection('organizations').select('timezone').get()).docs;
  const organizations = snapshots
    .filter(snapshot => snapshot.exists)
    .map(snapshot => ({
      id: snapshot.id,
      timeZone: snapshot.data()?.timezone || 'Europe/Kyiv',
    }));
  const counts = await mapWithConcurrency(
    organizations,
    DELIVERY_CONCURRENCY,
    organization => runOrganizationBirthdaySweep(
      organization.id,
      organization.timeZone,
      nowMs,
      { userId, force },
    ),
  );
  return {
    created: counts.reduce((total, count) => total + (count || 0), 0),
    skipped: false,
    scannedAtMs: nowMs,
  };
}

// Reads the sweep's watermark and reports how much time the next pass has to
// cover. A first run, or one whose state document was lost, gets the floor.
export async function readSweepState(nowMs) {
  const snapshot = await sweepStateRef().get().catch(() => null);
  const data = snapshot?.data() || {};
  const lastRunAt = Number(data.lastRunAtMs);
  const lastBirthdayScanAt = Number(data.lastBirthdayScanAtMs);
  const lastMaterialiseAt = Number(data.lastMaterialiseAtMs);
  const elapsedMs = Number.isFinite(lastRunAt) && lastRunAt <= nowMs
    ? nowMs - lastRunAt
    : REMINDER_LOOKBACK_MS;
  // Dispatch may run every minute while materialisation is driven separately.
  // Its watermark must not shorten the recovery window of the expensive half:
  // after a three-hour materialiser outage, using `lastRunAt` here silently
  // loses every reminder that became due during the outage.
  const materialiseElapsedMs = Number.isFinite(lastMaterialiseAt) && lastMaterialiseAt <= nowMs
    ? nowMs - lastMaterialiseAt
    : REMINDER_LOOKBACK_MS;
  return {
    lastRunAtMs: Number.isFinite(lastRunAt) ? lastRunAt : null,
    lastBirthdayScanAtMs: Number.isFinite(lastBirthdayScanAt) ? lastBirthdayScanAt : null,
    lastMaterialiseAtMs: Number.isFinite(lastMaterialiseAt) ? lastMaterialiseAt : null,
    elapsedMs,
    materialiseElapsedMs,
  };
}

// How often the expensive half may run.
//
// It used to run every twenty minutes, because it was the only thing that ever
// wrote a reminder down: a deadline set at 14:03 was invisible until the next
// scan noticed it. It is not that any more — the row is written by the route
// that accepted the deadline — so this scan is the safety net, and a safety net
// that runs seventy-two times a day is not a safety net, it is the cost it was
// supposed to replace. Once a night, with this as the guard against a second
// call in the same window.
//
// Eleven hours rather than twelve, and the missing hour is the whole point.
// The two schedules stand exactly twelve hours apart, so a guard of exactly
// twelve leaves no tolerance at all — and GitHub delivers a scheduled event
// late as a matter of course, by five minutes or by ten hours. The moment the
// first pass runs late, the second arrives «too early» and cancels itself,
// which is what happened on 27.08: a materialise pass started at 14:05 and did
// nothing, because the previous one had been at 09:56.
//
// That is not a missed sweep, it is a missed *day*: this pass is the only thing
// that makes `overdue` true again and moves `countedDay`, and the argument for
// running it twice is that one of the two has to land in the early morning of
// whatever timezone the workspace is in. One pass a day at a drifting hour
// cannot do that. The guard exists to stop a double call inside one window, so
// it is set below the window rather than equal to it.
export const MATERIALISE_INTERVAL_MS = 11 * 60 * 60 * 1000;

export async function materialiseScheduledNotifications({ nowMs = Date.now(), lookBackMs } = {}) {
  const windowStartMs = nowMs - (lookBackMs ?? REMINDER_LOOKBACK_MS);
  const windowEndMs = nowMs + MATERIALISE_LEAD_MS;
  const [calendar, deadlines] = await Promise.all([
    collectCalendarCandidates({ nowMs, lookBackMs, lookAheadMs: MATERIALISE_LEAD_MS }),
    collectDeadlineCandidates({ nowMs, lookAheadMs: MATERIALISE_LEAD_MS }),
  ]);
  const result = await materialiseCandidates([...calendar, ...deadlines], {
    windowStartMs,
    windowEndMs,
    nowMs,
  });
  return { ...result, candidates: calendar.length + deadlines.length };
}

// One pass. `mode` exists so the cheap half can be driven on a tight schedule
// without dragging the expensive half along with it: a one-minute external cron
// calls it with `dispatch`, and something slower keeps the outbox stocked.
// How many read records one pass may remove. Deletions are writes, and the free
// tier's daily write budget is the smaller of the two limits this product lives
// under — a backlog drains over days rather than spending the budget in an hour.
const PRUNE_BATCH = 100;

// How far past its delivery time a pending row has to be before this pass gives
// up on it, and how many it may close at once.
//
// There is a gap between the two halves of the outbox, and it only opens when
// delivery has been down for a while. Reconciliation works inside a window that
// reaches ten minutes back — `REMINDER_LOOKBACK_MS` — so a row whose moment
// passed longer ago than that is no longer something reconciliation can see,
// and dispatch will not touch it either once it has fallen out of the retry
// query. It is then pending forever: never sent, never cancelled.
//
// Production had four of them on 27.08, from 5, 6, 7 and 9 August, left behind
// by the days the scheduler was switched off. Nothing was wrong with them; there
// was simply nobody to tell that the meeting they were about had happened three
// weeks ago.
//
// Seven days rather than the reconciliation window, because those are different
// questions. Ten minutes late is a slow scheduler and the reminder is still
// wanted; a week late is a reminder about something that is over, and sending it
// is worse than dropping it. Cancelled rather than deleted: the row is the
// record that the reminder existed, and «cancelled» is already what this outbox
// says about a reminder nobody is owed.
const STALE_ROW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_ROW_BATCH = 100;

/**
 * Close pending rows whose moment passed so long ago that nothing will deliver
 * them. One bounded indexed query, on the same hourly pass as the other tidying.
 */
export async function cancelStaleOutboxRows({ nowMs = Date.now(), limit = STALE_ROW_BATCH } = {}) {
  const db = getAdminDb();
  let snapshot;
  try {
    snapshot = await db.collection(OUTBOX_COLLECTION)
      .where('status', '==', 'pending')
      .where('deliverAtMs', '<=', nowMs - STALE_ROW_MS)
      .orderBy('deliverAtMs')
      .limit(limit)
      .select('deliverAtMs')
      .get();
  } catch (error) {
    // Deployments are not atomic with Firestore index creation, and tidying is
    // never worth failing a pass that still has reminders to send.
    if (error?.code !== 9 && error?.code !== 'failed-precondition') throw error;
    console.warn('[reminder-job] Stale-row index is not ready; nothing cancelled this pass');
    return { scanned: 0, cancelled: 0, skipped: true };
  }
  if (snapshot.empty) return { scanned: 0, cancelled: 0 };

  const batch = db.batch();
  for (const document of snapshot.docs) {
    batch.update(document.ref, {
      status: 'cancelled',
      cancelledAtMs: nowMs,
      lastError: 'expired before delivery',
    });
  }
  await batch.commit();
  return { scanned: snapshot.size, cancelled: snapshot.size };
}

/**
 * Delete records that have been read and are past their date.
 *
 * The query is the whole cost when there is nothing to do: an indexed range that
 * matches nothing is one read, so a pass over a tidy bell is free. What it
 * matches, it was going to pay for once anyway.
 *
 * `createdAt` is written by every sender, so a record without one simply never
 * matches and stays — which is the safe direction for a delete.
 */
export async function pruneReadNotifications({ nowMs = Date.now(), limit = PRUNE_BATCH } = {}) {
  const db = getAdminDb();
  let snapshot;
  try {
    snapshot = await db.collection('notifications')
      .where('read', '==', true)
      .where('createdAt', '<=', Timestamp.fromMillis(nowMs - READ_NOTIFICATION_TTL_MS))
      .orderBy('createdAt')
      .limit(limit)
      .select('type')
      .get();
  } catch (error) {
    // Deployments are not atomic with Firestore index creation. Tidying the bell
    // is the least urgent thing this sweep does, and it must never be the reason
    // a pass fails and leaves its watermark unadvanced.
    if (error?.code !== 9 && error?.code !== 'failed-precondition') throw error;
    console.warn('[reminder-job] Expiry index is not ready yet; nothing pruned this pass');
    return { scanned: 0, deleted: 0, kept: 0, skipped: true };
  }
  if (snapshot.empty) return { scanned: 0, deleted: 0, kept: 0 };

  const records = snapshot.docs.map(document => ({ id: document.id, type: document.data().type }));
  // Only the types this outbox produces can be resent at all, so only those are
  // worth a read of their scheduled row. Everything else came from an event that
  // happened once.
  const guarded = records.filter(record => record.type === 'deadline' || record.type === 'calendar_reminder');
  const rows = new Map();
  if (guarded.length) {
    const rowSnaps = await db.getAll(
      ...guarded.map(record => db.collection(OUTBOX_COLLECTION).doc(record.id)),
      { fieldMask: ['status', 'attempts'] },
    );
    for (const [index, rowSnap] of rowSnaps.entries()) {
      rows.set(guarded[index].id, rowSnap.exists ? rowSnap.data() : null);
    }
  }

  const removable = expirableNotificationIds(records, rows);
  for (let index = 0; index < removable.length; index += 400) {
    const batch = db.batch();
    for (const id of removable.slice(index, index + 400)) {
      batch.delete(db.collection('notifications').doc(id));
    }
    await batch.commit();
  }
  return { scanned: records.length, deleted: removable.length, kept: records.length - removable.length };
}

/**
 * One pass.
 *
 * `mode` exists because the two halves have nothing in common but a name.
 *
 *   dispatch     — send what is due. One indexed query against the outbox, no
 *                  state read and no state write, so an idle minute costs a
 *                  single read. This is what runs every minute, and it is the
 *                  only thing that decides how late a reminder is.
 *   maintenance  — the two bounded indexed queries that tidy up: finalising
 *                  soft-deleted tasks past their undo window, and expiring read
 *                  records. Hourly, because «Нещодавно видалене» promises
 *                  twenty-four hours and a nightly pass would make it up to
 *                  forty-eight.
 *   materialise  — restock the outbox from the source data, and post birthday
 *                  greetings. Nightly. The rows themselves are written when
 *                  somebody sets a deadline or moves an event; this is the pass
 *                  that catches whatever a failed write or a direct database
 *                  edit left behind.
 *   full         — all three, with materialising self-throttled internally.
 *
 * See docs/ARCHITECTURE.md.
 */
export async function runScheduledNotificationSweep({ nowMs = Date.now(), mode = 'full' } = {}) {
  const wantsMaterialise = mode === 'full' || mode === 'materialise';
  const wantsDispatch = mode === 'full' || mode === 'dispatch';
  const wantsMaintenance = mode === 'full' || mode === 'maintenance';

  // A dispatch pass reads nothing but the outbox. Reading the watermark would
  // double the cost of the cheapest and most frequent pass in the product to
  // learn something only the expensive half uses.
  const state = wantsMaterialise
    ? await readSweepState(nowMs)
    : { lastRunAtMs: null, lastBirthdayScanAtMs: null, lastMaterialiseAtMs: null,
      elapsedMs: REMINDER_LOOKBACK_MS, materialiseElapsedMs: REMINDER_LOOKBACK_MS };
  const lookBackMs = clampReminderLookback(state.materialiseElapsedMs);
  const materialiseDue = !Number.isFinite(state.lastMaterialiseAtMs)
    || nowMs - state.lastMaterialiseAtMs >= MATERIALISE_INTERVAL_MS;

  const materialised = wantsMaterialise && materialiseDue
    ? await materialiseScheduledNotifications({ nowMs, lookBackMs })
    : { skipped: true, created: 0, updated: 0, cancelled: 0 };

  // Dispatch after materialising, so a reminder that became due inside this very
  // pass goes out in it rather than waiting for the next one.
  const dispatched = wantsDispatch
    ? await dispatchDueNotifications({ nowMs })
    : { skipped: true, due: 0, sent: 0, failed: 0, telegram: 0, email: 0 };

  const birthdays = wantsMaterialise
    ? await runBirthdaySweep({ nowMs, lastScanAtMs: state.lastBirthdayScanAtMs })
    : { created: 0, skipped: true };

  // Finalising a soft-deleted task and expiring a read record are each one
  // bounded indexed query, and neither may ride the every-minute pass.
  const issueTrash = wantsMaintenance
    ? await purgeExpiredDeletedIssues({ nowMs })
    : { scanned: 0, purged: 0, failed: 0, related: 0, skipped: true };

  const prunedNotifications = wantsMaintenance
    ? await pruneReadNotifications({ nowMs })
    : { scanned: 0, deleted: 0, kept: 0, skipped: true };

  const staleRows = wantsMaintenance
    ? await cancelStaleOutboxRows({ nowMs })
    : { scanned: 0, cancelled: 0, skipped: true };

  // The project task counters, rebuilt from the tasks themselves.
  //
  // It rides the materialise pass because it needs exactly what that pass
  // already is: something that runs twice a day, twelve hours apart, so that
  // one of the two lands in the early morning of any given workspace's own
  // timezone. That is not a convenience here — «прострочено» flips at the
  // workspace's midnight and at no other moment, and a counter refreshed at a
  // fixed UTC hour would be a day stale for half the world. See
  // `src/lib/utils/projectIssueCounts.mjs` for the whole argument, and
  // `.github/workflows/scheduled-notifications.yml` for why there is no
  // schedule of its own to hang it on.
  //
  // It is deliberately gated on `materialiseDue` rather than on
  // `wantsMaterialise`: a manual run of the pass should not make a second full
  // pass over every task in the database within the same twelve hours.
  const projectIssueCounts = wantsMaterialise && materialiseDue
    ? await recountProjectIssueCounts({ nowMs })
      .catch(error => {
        console.warn('[reminder-job] project counters not rebuilt:', error.message);
        return { organizations: 0, projects: 0, written: 0, unchanged: 0, failed: true };
      })
    : { skipped: true, organizations: 0, projects: 0, written: 0, unchanged: 0 };

  // Written last and unconditionally after a successful pass: a sweep that
  // throws must not advance the watermark, or the reminders it failed to record
  // would fall into the gap the watermark exists to close.
  //
  // A dispatch pass writes nothing. It has no watermark to advance — nothing it
  // does depends on when it last ran — and writing one every minute made a hot
  // document out of a status line.
  if (!wantsDispatch || wantsMaterialise || wantsMaintenance) {
    await sweepStateRef().set({
      lastRunAtMs: nowMs,
      lastRunAt: Timestamp.fromMillis(nowMs),
      lookBackMs,
      mode,
      previousRunAtMs: state.lastRunAtMs,
      ...(materialised.skipped ? {} : { lastMaterialiseAtMs: nowMs }),
      ...(birthdays.skipped ? {} : { lastBirthdayScanAtMs: nowMs }),
      counts: {
        materialised: materialised.created || 0,
        cancelled: materialised.cancelled || 0,
        sent: dispatched.sent || 0,
        failed: dispatched.failed || 0,
        telegram: dispatched.telegram || 0,
        birthdays: birthdays.created || 0,
        purgedIssues: issueTrash.purged || 0,
        prunedNotifications: prunedNotifications.deleted || 0,
        staleRows: staleRows.cancelled || 0,
        recountedProjects: projectIssueCounts.written || 0,
      },
    }, { merge: true }).catch(error => {
      console.warn('[reminder-job] Could not record sweep state:', error.message);
    });
  }

  return {
    mode,
    lookBackMs,
    sinceLastRunMs: state.lastRunAtMs === null ? null : nowMs - state.lastRunAtMs,
    materialised,
    dispatched,
    birthdays,
    issueTrash,
    prunedNotifications,
    staleRows,
    projectIssueCounts,
  };
}

// How long the sweep may be silent before that silence is itself the problem.
//
// Twelve hours, and the number is set by what actually writes the watermark
// rather than by how often reminders go out. A dispatch pass deliberately writes
// nothing — it is the every-minute pass and a write per minute would make a hot
// document out of a status line — so what this measures is the hourly
// maintenance pass and the twice-daily materialise pass.
//
// It has to sit well above GitHub's own unreliability or it reports the
// scheduler rather than the outage. An hourly `cron` on Actions is hourly on a
// quiet day and three-hourly on a loaded one; measured on this repository, a
// schedule asking for every five minutes delivered three runs in a day. Twelve
// hours is longer than any of that and far shorter than the twenty-four days
// nobody noticed, which is the failure this exists to catch.
export const SWEEP_SILENCE_LIMIT_MS = 12 * 60 * 60 * 1000;

/**
 * Whether anything has come to run the sweep recently, and how long ago.
 *
 * The one number this reads is already written on every pass that does real
 * work; nothing else has ever looked at it. Between 3 and 27 August 2026 not a
 * single reminder was delivered, and what made that a twenty-four-day outage
 * rather than an hour-long one is precisely that: the watermark was correct the
 * whole time and had no reader.
 *
 * Reported rather than acted upon. This function does not send anything — a
 * process that can tell you it is dead is not dead — so the caller is a check
 * outside the sweep's own schedule. See `.github/workflows/sweep-watchdog.yml`.
 */
export async function readSweepHealth({ nowMs = Date.now() } = {}) {
  const snapshot = await sweepStateRef().get().catch(() => null);
  const data = snapshot?.exists ? snapshot.data() : null;
  const lastRunAtMs = Number(data?.lastRunAtMs);
  const lastMaterialiseAtMs = Number(data?.lastMaterialiseAtMs);
  const silentForMs = Number.isFinite(lastRunAtMs) && lastRunAtMs <= nowMs
    ? nowMs - lastRunAtMs
    : null;
  return {
    healthy: silentForMs !== null && silentForMs < SWEEP_SILENCE_LIMIT_MS,
    silentForMs,
    silenceLimitMs: SWEEP_SILENCE_LIMIT_MS,
    lastRunAtMs: Number.isFinite(lastRunAtMs) ? lastRunAtMs : null,
    lastMaterialiseAtMs: Number.isFinite(lastMaterialiseAtMs) ? lastMaterialiseAtMs : null,
    emailConfigured: emailConfigured(),
  };
}
