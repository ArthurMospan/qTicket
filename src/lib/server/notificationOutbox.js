import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { deliverEmail, emailConfigured } from '@/lib/server/email';
import { deliverTelegramNotification, telegramAppLink } from '@/lib/server/telegram';
import { generateEmailTemplate } from '@/lib/utils/sendEmail';
import { shouldDeliver } from '@/lib/utils/notificationChannels.mjs';
import { reminderLabel } from '@/lib/utils/reminderCandidates.mjs';
import {
  DISPATCH_BATCH,
  OUTBOX_COLLECTION,
  cancellableRowIds,
  dueRows,
  deliveryAttemptUpdate,
  groupByRecipient,
  outboxRow,
  outboxRowChanges,
} from '@/lib/utils/notificationOutbox.mjs';

// The two halves of scheduled delivery. Materialising is expensive and rare;
// dispatching is cheap and frequent, and only the second one's cadence decides
// how late a reminder is. See docs/ARCHITECTURE.md for why they were
// split.

function outboxRef() {
  return getAdminDb().collection(OUTBOX_COLLECTION);
}

// Firestore refuses a batch over 500 writes. Collecting them first and
// committing in chunks keeps the caller free to write as many as the data
// implies, which matters most on the first pass after a quiet period.
const BATCH_LIMIT = 400;

async function commitInChunks(db, writes) {
  for (let index = 0; index < writes.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + BATCH_LIMIT)) {
      if (write.kind === 'set') batch.set(write.ref, write.data);
      else batch.update(write.ref, write.data);
    }
    await batch.commit();
  }
}

// ── Materialise ───────────────────────────────────────────────────────────────

// The shared half of «write down what is wanted, cancel what is not».
//
// `pendingRows` is what the caller believes it owns: the whole window for the
// nightly sweep, one task's or one event's rows for a write that just happened.
// Everything else is identical, and it has to be — a row written by the sweep
// and a row written when somebody set the deadline are the same row, or the
// reminder goes out twice.
async function reconcile(candidates, { pendingRows, windowStartMs, windowEndMs, nowMs }) {
  const db = getAdminDb();
  const wanted = new Map();
  for (const candidate of candidates) {
    if (!candidate?.id || !Number.isFinite(Number(candidate.deliverAtMs))) continue;
    const at = Number(candidate.deliverAtMs);
    if (at < windowStartMs || at > windowEndMs) continue;
    wanted.set(candidate.id, candidate);
  }

  const existingSnapshots = wanted.size
    ? await db.getAll(...[...wanted.keys()].map(id => outboxRef().doc(id)))
    : [];
  const existing = new Map(existingSnapshots.map(snapshot => [
    snapshot.id,
    snapshot.exists ? { ...snapshot.data(), id: snapshot.id } : null,
  ]));

  let created = 0;
  let updated = 0;
  // Firestore refuses a batch over 500 writes, and the first materialisation
  // after a quiet period is exactly when there are most of them.
  const writes = [];
  const batch = { set: (ref, data) => writes.push({ ref, data, kind: 'set' }),
    update: (ref, data) => writes.push({ ref, data, kind: 'update' }) };
  for (const [id, candidate] of wanted) {
    const current = existing.get(id);
    if (!current) {
      batch.set(outboxRef().doc(id), {
        ...outboxRow(candidate, { nowMs }),
        occurrenceStartMs: Number(candidate.occurrenceStart) || null,
        createdAt: FieldValue.serverTimestamp(),
      });
      created += 1;
      continue;
    }
    // A row that already went out is history. Re-materialising must never
    // resurrect it, which is also what stops a moved event from re-notifying
    // everyone who was already told.
    if (current.status !== 'pending') continue;
    const changes = outboxRowChanges(current, candidate);
    if (Object.keys(changes).length) {
      batch.update(outboxRef().doc(id), changes);
      updated += 1;
    }
  }

  // Anything pending in this window that nothing wants any more — decided by
  // `cancellableRowIds` rather than here, so the rule and the test of the rule
  // are about the same code. It is the rule that says a retry row owed to a
  // person is nobody's to cancel.
  const cancellable = new Set(cancellableRowIds(
    pendingRows.map(document => ({
      id: document.id,
      status: document.get('status'),
      type: document.get('type'),
      deliverAtMs: document.get('deliverAtMs'),
    })),
    new Set(wanted.keys()),
    { windowStartMs, windowEndMs },
  ));
  let cancelled = 0;
  for (const document of pendingRows) {
    if (!cancellable.has(document.id)) continue;
    batch.update(document.ref, { status: 'cancelled', cancelledAtMs: nowMs });
    cancelled += 1;
  }

  await commitInChunks(db, writes);
  return { created, updated, cancelled, window: { windowStartMs, windowEndMs } };
}

// Writes the rows for every reminder that will come due inside the window, and
// cancels the pending rows in that window that the source data no longer
// justifies — an event that moved, a task someone finished.
export async function materialiseCandidates(candidates, { windowStartMs, windowEndMs, nowMs }) {
  const pendingSnapshot = await outboxRef()
    .where('status', '==', 'pending')
    .where('deliverAtMs', '>=', windowStartMs)
    .where('deliverAtMs', '<=', windowEndMs)
    .select('status', 'type', 'deliverAtMs')
    .get();
  return reconcile(candidates, {
    pendingRows: pendingSnapshot.docs,
    windowStartMs,
    windowEndMs,
    nowMs,
  });
}

// How many pending rows one source may own. A task produces one row per
// assignee per day-key it nags on; an event, one per participant per occurrence
// per configured reminder. Fifty is far past either, and a ceiling here is what
// keeps a per-write reconciliation from ever becoming a collection scan.
const SCOPED_ROW_LIMIT = 50;

/**
 * The same reconciliation, for the rows one task or one calendar event owns.
 *
 * This is what turns the outbox from something that is *found* into something
 * that is *written*. Setting a deadline is the moment the reminder becomes
 * knowable, so that is the moment its row is written — one indexed query and a
 * handful of writes, on an action a person just performed. Moving the deadline
 * rewrites the row; finishing, cancelling, archiving or deleting the task
 * leaves nothing wanted, so the row is cancelled.
 *
 * The nightly sweep still runs over everything, and has to keep agreeing with
 * this: the row id is derived from the candidate, so both write the same row.
 *
 * @param {object[]} candidates What this source produces now — empty when the
 *   source is gone, which is how a deletion cancels its rows.
 * @param {{issueId?: string, calendarEventId?: string}} scope The source.
 */
export async function reconcileScopedRows(candidates, {
  scope,
  windowStartMs,
  windowEndMs,
  nowMs = Date.now(),
}) {
  const field = scope?.issueId ? 'issueId' : 'calendarEventId';
  const value = scope?.issueId || scope?.calendarEventId || '';
  if (!value) throw new Error('reconcileScopedRows needs an issueId or a calendarEventId');

  const pendingSnapshot = await outboxRef()
    .where(field, '==', value)
    .where('status', '==', 'pending')
    .select('status', 'type', 'deliverAtMs')
    .limit(SCOPED_ROW_LIMIT)
    .get();
  return reconcile(candidates, {
    pendingRows: pendingSnapshot.docs,
    windowStartMs,
    windowEndMs,
    nowMs,
  });
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

async function loadRecipientContext(rows) {
  const db = getAdminDb();
  const userIds = [...new Set(rows.map(row => row.userId).filter(Boolean))];
  const membershipKeys = [...new Set(rows
    .filter(row => row.organizationId && row.userId)
    .map(row => `${row.organizationId}_${row.userId}`))];
  if (!userIds.length) return { memberships: new Map(), preferences: new Map(), profiles: new Map() };

  const [memberships, preferences, profiles] = await Promise.all([
    membershipKeys.length
      ? db.getAll(...membershipKeys.map(key => db.collection('orgMemberships').doc(key)))
      : [],
    db.getAll(...userIds.map(uid =>
      db.collection('users').doc(uid).collection('settings').doc('notifications'))),
    db.getAll(...userIds.map(uid => db.collection('users').doc(uid))),
  ]);

  return {
    memberships: new Map(membershipKeys.map((key, index) => [
      key, memberships[index]?.exists ? memberships[index].data() : null,
    ])),
    preferences: new Map(userIds.map((uid, index) => [
      uid, preferences[index]?.exists ? preferences[index].data() : {},
    ])),
    profiles: new Map(userIds.map((uid, index) => [
      uid, profiles[index]?.exists ? profiles[index].data() : {},
    ])),
  };
}

// A calendar reminder materialised two hours early would otherwise announce the
// distance it had when it was written down. The row keeps the occurrence, and
// the wording is produced here, at the moment it is actually sent.
function rowBody(row, nowMs) {
  if (row.type !== 'calendar_reminder' || !Number.isFinite(Number(row.occurrenceStartMs))) {
    return row.body || '';
  }
  return reminderLabel(Number(row.occurrenceStartMs) - nowMs);
}

async function claimNotification(row, { inapp, body, nowMs }) {
  const db = getAdminDb();
  try {
    await db.collection('notifications').doc(row.id).create({
      userId: row.userId,
      type: row.type,
      title: row.title,
      body,
      link: row.link || '',
      issueId: row.issueId || '',
      projectId: row.projectId || '',
      organizationId: row.organizationId,
      ...(row.calendarEventId ? { calendarEventId: row.calendarEventId } : {}),
      actorId: row.actorId || 'quickteam-system',
      actorName: row.actorName || 'QuickTeam',
      actorAvatar: '',
      read: false,
      inapp,
      createdAt: Timestamp.fromMillis(nowMs),
    });
    return true;
  } catch (error) {
    // Already claimed: a previous pass created the record and failed only on the
    // outbound channel. Sending again is the point of the retry, so this is not
    // a failure.
    if (error.code === 6 || error.code === 'already-exists') return false;
    throw error;
  }
}

export async function dispatchDueNotifications({ nowMs = Date.now(), limit = DISPATCH_BATCH } = {}) {
  const readyQuery = outboxRef()
    .where('status', '==', 'pending')
    .where('nextAttemptAtMs', '<=', nowMs)
    .orderBy('nextAttemptAtMs')
    .limit(limit);
  const legacyQuery = outboxRef()
    .where('status', '==', 'pending')
    .where('deliverAtMs', '<=', nowMs)
    .orderBy('deliverAtMs')
    .limit(limit);

  let readySnapshot;
  let legacySnapshot = null;
  try {
    readySnapshot = await readyQuery.get();
  } catch (error) {
    // Deployments are not atomic with Firestore index creation. Keep delivery
    // alive on the old index until `status + nextAttemptAtMs` is ready, then
    // the next pass automatically returns to the retry-aware query.
    if (error?.code !== 9 && error?.code !== 'failed-precondition') throw error;
    console.warn('[outbox] Retry-time index is not ready; using delivery-time fallback');
    readySnapshot = await legacyQuery.get();
    legacySnapshot = readySnapshot;
  }

  // The delivery-time query used to run on *every* pass alongside this one, to
  // pick up rows written before `nextAttemptAtMs` existed. A pass runs every
  // minute, and a Firestore query that matches nothing still costs a read, so
  // that compatibility shim was fourteen hundred reads a day, forever, for a
  // schema nobody has written since. It runs only as the index fallback now;
  // a pending legacy row still inside the materialised window is upgraded by
  // the nightly sweep, which rewrites `nextAttemptAtMs` when it is missing.
  const legacyDocuments = (legacySnapshot?.docs || [])
    .filter(document => !Number.isFinite(Number(document.data()?.nextAttemptAtMs))
      && Number.isFinite(Number(document.data()?.deliverAtMs)));
  if (legacyDocuments.length) {
    const batch = getAdminDb().batch();
    for (const document of legacyDocuments) {
      batch.update(document.ref, { nextAttemptAtMs: Number(document.data().deliverAtMs) });
    }
    await batch.commit();
  }

  const documents = new Map();
  for (const document of [...readySnapshot.docs, ...legacyDocuments]) {
    documents.set(document.id, document);
  }
  if (!documents.size) return { due: 0, sent: 0, failed: 0, telegram: 0, email: 0 };

  const rows = dueRows(
    [...documents.values()].map(document => ({ ...document.data(), id: document.id })),
    nowMs,
    limit,
  );
  if (!rows.length) return { due: 0, sent: 0, failed: 0, telegram: 0, email: 0 };

  const context = await loadRecipientContext(rows);
  const db = getAdminDb();
  const telegramItems = new Map();
  const emails = [];
  const claimed = [];
  // Asked once per pass rather than once per row: it is a fact about the
  // deployment's environment, not about the recipient.
  const emailsPossible = emailConfigured();

  for (const row of rows) {
    const membership = context.memberships.get(`${row.organizationId}_${row.userId}`);
    if (!membership || membership.orgId !== row.organizationId || membership.userId !== row.userId) {
      // Left the organization between materialising and delivery.
      await outboxRef().doc(row.id).update({ status: 'cancelled', cancelledAtMs: nowMs });
      continue;
    }

    const preferences = context.preferences.get(row.userId) || {};
    const profile = context.profiles.get(row.userId) || {};
    const body = rowBody(row, nowMs);
    const inapp = shouldDeliver(preferences, 'inapp', row.type);
    // `emailsPossible` first, because a channel that does not exist is not a
    // channel that failed.
    //
    // With no provider key, `deliverEmail` returns false by design — sending is
    // a soft no-op so that features degrade instead of falling over. Delivery
    // read that false as a failed attempt: the reminder reached the bell, and
    // the row still went back to «pending» with an error against it, waited out
    // a backoff, tried the same absent provider again, and after five rounds
    // filed itself as failed. Ten of those were sitting in production on 27.08,
    // every one of them already delivered in-app.
    //
    // So the question asked here is whether email is a channel this deployment
    // has at all. It is not a preference and not a per-row decision, which is
    // why it is not in `shouldDeliver`.
    const wantsEmail = emailsPossible
      && !row.emailSentAtMs
      && row.allowEmail !== false
      && shouldDeliver(preferences, 'email', row.type)
      && Boolean(profile.email);
    const wantsTelegram = !row.telegramSentAtMs
      && shouldDeliver(preferences, 'telegram', row.type);

    if (!inapp && !wantsEmail && !wantsTelegram) {
      await outboxRef().doc(row.id).update({ status: 'cancelled', cancelledAtMs: nowMs });
      continue;
    }

    const isFirstAttempt = Number(row.attempts || 0) === 0;
    const claimedNow = await claimNotification(row, { inapp, body, nowMs });
    // The notification document doubles as the "already told them" marker. On a
    // first attempt, finding it already there means something else: the old
    // polling sweep or a manual run delivered this exact reminder, and sending
    // it again is precisely the duplicate everyone complains about. On a retry
    // the document is expected to exist, because we are the ones who wrote it.
    if (!claimedNow && isFirstAttempt) {
      await outboxRef().doc(row.id).update({
        status: 'sent',
        sentAtMs: nowMs,
        attempts: 1,
        lastError: 'already delivered',
      });
      continue;
    }
    claimed.push({ row, body, wantsEmail, wantsTelegram });

    if (wantsEmail) emails.push({ row, body, to: profile.email });
    if (wantsTelegram) {
      const list = telegramItems.get(row.userId) || [];
      list.push({ type: row.type, title: row.title, body, url: telegramAppLink(row.link) });
      telegramItems.set(row.userId, list);
    }
  }

  if (!claimed.length) return { due: rows.length, sent: 0, failed: 0, telegram: 0, email: 0 };

  const [emailResults, telegramResult] = await Promise.all([
    Promise.allSettled(emails.map(item => deliverEmail({
      to: item.to,
      subject: item.row.title,
      html: generateEmailTemplate({
        type: item.row.type,
        title: item.row.title,
        body: item.body,
        link: item.row.link,
      }),
    }))),
    telegramItems.size
      ? deliverTelegramNotification({
        userIds: [...telegramItems.keys()],
        itemsByUserId: telegramItems,
      }).catch(error => {
        console.warn('[outbox] Telegram delivery failed:', error.message);
        return { delivered: 0, error: error.message };
      })
      : Promise.resolve({ delivered: 0 }),
  ]);

  const emailSucceeded = new Set();
  const emailErrors = new Map();
  for (const [index, result] of emailResults.entries()) {
    const rowId = emails[index].row.id;
    if (result.status === 'fulfilled' && result.value === true) {
      emailSucceeded.add(rowId);
    } else {
      emailErrors.set(
        rowId,
        result.status === 'rejected'
          ? String(result.reason?.message || result.reason || 'email delivery failed')
          : 'email provider is not configured or rejected the message',
      );
    }
  }
  // A digest is one request per person. The Telegram helper returns failures
  // per recipient so one successful chat cannot hide another blocked bot.
  const telegramFailed = new Set(telegramResult.failedUserIds || []);
  const telegramErrors = telegramResult.errorsByUserId || {};

  const batch = db.batch();
  let sent = 0;
  let failed = 0;
  for (const { row, wantsEmail, wantsTelegram } of claimed) {
    const emailWasSuccessful = wantsEmail && emailSucceeded.has(row.id);
    const telegramWasSuccessful = wantsTelegram && !telegramFailed.has(row.userId);
    const outcome = deliveryAttemptUpdate(row, {
      nowMs,
      emailRequested: wantsEmail,
      emailSucceeded: emailWasSuccessful,
      telegramRequested: wantsTelegram,
      telegramSucceeded: telegramWasSuccessful,
      emailError: emailErrors.get(row.id),
      telegramError: telegramErrors[row.userId],
    });
    batch.update(outboxRef().doc(row.id), outcome.update);
    if (outcome.failed) failed += 1;
    else sent += 1;
  }
  await batch.commit();

  return {
    due: rows.length,
    sent,
    failed,
    telegram: telegramResult.delivered || 0,
    email: emailSucceeded.size,
    recipients: groupByRecipient(claimed.map(item => item.row)).size,
  };
}
