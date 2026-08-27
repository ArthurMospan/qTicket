// src/lib/utils/notificationOutbox.mjs
// The scheduled-notification outbox: rules, no I/O.
//
// The old shape asked the database "is anything due?" on every pass, so the cost
// of a pass scaled with the total number of events and issues rather than with
// how many reminders were actually due — ninety-nine passes in a hundred paid
// full price to find nothing. That is what made a one-minute cadence
// unaffordable, and an unaffordable cadence is what made reminders hours late.
//
// A row is written when a reminder becomes knowable and carries its own
// delivery time. The pass that matters — the one whose cadence sets the
// latency — then runs a single indexed query bounded by `limit`, and costs
// nothing when nothing is due. See docs/ARCHITECTURE.md.

export const OUTBOX_COLLECTION = 'scheduledNotifications';

// How far ahead reminders are materialised. Must comfortably exceed the
// interval between materialisation passes, or a reminder becomes knowable and
// its delivery time passes before anyone writes it down.
//
// Three hours was right while the scan ran every twenty minutes. The scan is a
// nightly safety net now — the rows themselves are written when somebody sets
// the deadline — so the lead has to cover the gap between two nights plus the
// day the deadline reminder itself looks ahead. Forty-eight hours does, with
// room to spare for a night the scheduler misses entirely.
export const MATERIALISE_LEAD_MS = 48 * 60 * 60 * 1000;

// One dispatch pass never sends more than this. A backlog drains over several
// passes instead of one pass timing out and delivering nothing.
export const DISPATCH_BATCH = 50;

export const MAX_ATTEMPTS = 5;

// The hour, in the organization's timezone, at which day-scale reminders are
// delivered. Deadline reminders used to arrive whenever the sweep happened to
// notice them, which on a healthy schedule means shortly after midnight.
export const DAILY_REMINDER_HOUR = 9;

export const OUTBOX_STATUSES = ['pending', 'sent', 'failed', 'cancelled'];

// Exponential with a ceiling. A blocked bot or a stale chat id fails every
// time; the point of backing off is to stop spending the retry budget on it
// within one pass, not to eventually succeed.
export function nextAttemptDelayMs(attempts) {
  const step = Math.max(0, Math.floor(attempts));
  return Math.min(2 ** step, 32) * 60_000;
}

export function deliveryAttemptUpdate(row, {
  nowMs,
  emailRequested = false,
  emailSucceeded = false,
  telegramRequested = false,
  telegramSucceeded = false,
  emailError = '',
  telegramError = '',
} = {}) {
  const attempts = Number(row?.attempts || 0) + 1;
  const errors = [
    emailRequested && !emailSucceeded ? emailError || 'email delivery failed' : '',
    telegramRequested && !telegramSucceeded ? telegramError || 'telegram delivery failed' : '',
  ].filter(Boolean);
  const channelUpdates = {
    ...(emailRequested && emailSucceeded ? { emailSentAtMs: nowMs } : {}),
    ...(telegramRequested && telegramSucceeded ? { telegramSentAtMs: nowMs } : {}),
  };

  if (errors.length && attempts < MAX_ATTEMPTS) {
    return {
      failed: true,
      update: {
        ...channelUpdates,
        attempts,
        status: 'pending',
        lastError: errors.join('; ').slice(0, 300),
        nextAttemptAtMs: nowMs + nextAttemptDelayMs(attempts),
      },
    };
  }

  return {
    failed: errors.length > 0,
    update: {
      ...channelUpdates,
      attempts,
      status: errors.length ? 'failed' : 'sent',
      ...(errors.length ? { failedAtMs: nowMs } : { sentAtMs: nowMs }),
      lastError: errors.join('; ').slice(0, 300),
    },
  };
}

export function isTerminal(row) {
  return row?.status === 'sent' || row?.status === 'cancelled'
    || (row?.status === 'failed' && (row?.attempts || 0) >= MAX_ATTEMPTS);
}

// How long a record stays in the bell after it has been read. Nothing removed
// them but the manual «очистити прочитані», so a bell nobody tidied grew for as
// long as the workspace existed — and the panel only ever shows the newest
// fifty, which means everything past that was cost without an audience.
export const READ_NOTIFICATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The types this outbox produces. A record of any other type was written by an
// event that happened once and cannot happen again, so nothing can resend it.
export const OUTBOX_BACKED_TYPES = new Set(['deadline', 'calendar_reminder']);

/**
 * Which read records may actually be deleted.
 *
 * A notification document is not only a notification: with a dedupe key it is
 * also the claim that says «this person has already been told», and deleting a
 * claim is how a reminder gets sent twice. For anything the outbox produces the
 * row is the guard instead — but only once the row is terminal, because a row
 * still pending is a retry in flight, and a retry recreates the document it
 * cannot find.
 *
 * @param {Array<{id: string, type: string}>} records Read records past their date.
 * @param {Map<string, object|null>} rows The outbox row of the same id, where there is one.
 */
export function expirableNotificationIds(records = [], rows = new Map()) {
  return (records || [])
    .filter(record => {
      if (!record?.id) return false;
      if (!OUTBOX_BACKED_TYPES.has(record.type)) return true;
      const row = rows.get(record.id);
      return !row || isTerminal(row);
    })
    .map(record => record.id);
}

// Rows a dispatch pass should take: pending, due, and not inside a backoff.
export function dueRows(rows, nowMs, limit = DISPATCH_BATCH) {
  return (rows || [])
    .filter(row => row && !isTerminal(row))
    .filter(row => Number(row.deliverAtMs) <= nowMs)
    .filter(row => !Number.isFinite(Number(row.nextAttemptAtMs)) || Number(row.nextAttemptAtMs) <= nowMs)
    .sort((a, b) => Number(a.deliverAtMs) - Number(b.deliverAtMs))
    .slice(0, limit);
}

// What a candidate becomes on disk. The candidate id is already deterministic
// and already the dedupe key for the notification document, so it is the row id
// too: materialising the same reminder twice writes the same row.
export function outboxRow(candidate, { nowMs = Date.now() } = {}) {
  return {
    id: candidate.id,
    deliverAtMs: Number(candidate.deliverAtMs),
    userId: candidate.userId,
    organizationId: candidate.organizationId,
    type: candidate.type,
    title: candidate.title,
    body: candidate.body || '',
    link: candidate.link || '',
    issueId: candidate.issueId || '',
    projectId: candidate.projectId || '',
    calendarEventId: candidate.calendarEventId || '',
    actorId: candidate.actorId || 'quickteam-system',
    actorName: candidate.actorName || 'QuickTeam',
    allowEmail: candidate.allowEmail !== false,
    status: 'pending',
    attempts: 0,
    lastError: '',
    // The dispatch query orders by retry readiness, not the original delivery
    // time. Otherwise fifty rows in backoff can sit at the head of the query
    // and hide every later row that is ready to send.
    nextAttemptAtMs: Number(candidate.deliverAtMs),
    materialisedAtMs: nowMs,
  };
}

// Fields a re-materialisation is allowed to correct on a row that has not been
// delivered yet. An event whose start moved keeps its identity — same event,
// same person, same occurrence — and only its timing and wording change.
const MUTABLE_FIELDS = ['deliverAtMs', 'title', 'body', 'link'];

export function outboxRowChanges(existing, candidate) {
  const next = outboxRow(candidate);
  const changes = {};
  for (const field of MUTABLE_FIELDS) {
    if (existing?.[field] !== next[field]) changes[field] = next[field];
  }
  if (!Number.isFinite(Number(existing?.nextAttemptAtMs))) {
    changes.nextAttemptAtMs = next.deliverAtMs;
  } else if (Number(existing?.attempts || 0) === 0
    && existing?.deliverAtMs !== next.deliverAtMs) {
    changes.nextAttemptAtMs = next.deliverAtMs;
  }
  return changes;
}

// A pending row inside the materialised window whose source no longer produces
// it — the event was deleted or moved out, the task was completed — should not
// fire. Rows outside the window are left alone: this pass has no opinion about
// them, and cancelling on absence would delete everything the window cannot see.
//
// And only a row that has a source at all. The outbox holds two kinds, and they
// cancel by opposite rules. A reminder is *derived*: when the deadline or the
// occurrence it came from stops saying it, the row is wrong and must go. A retry
// row is not derived from anything — it is a debt. The event already happened,
// the person was already told in the app, and the row exists only because their
// Telegram or their email did not answer. Nothing that happens to the task
// afterwards can make that debt untrue.
//
// `/api/notifications` writes those retry rows carrying the `issueId` of the
// task the event was about, and `deliverAtMs: now` — dead centre of every window
// this ever runs over. Absence from the candidate list is not evidence about
// them, so `OUTBOX_BACKED_TYPES` is what this pass is allowed to have an opinion
// about, and everything else is somebody else's row.
export function cancellableRowIds(pendingRows, expectedIds, { windowStartMs, windowEndMs }) {
  const expected = expectedIds instanceof Set ? expectedIds : new Set(expectedIds || []);
  return (pendingRows || [])
    .filter(row => row && row.status === 'pending')
    .filter(row => OUTBOX_BACKED_TYPES.has(row.type))
    .filter(row => {
      const at = Number(row.deliverAtMs);
      return Number.isFinite(at) && at >= windowStartMs && at <= windowEndMs;
    })
    .filter(row => !expected.has(row.id))
    .map(row => row.id);
}

// Groups what one dispatch pass is sending into one Telegram message per person.
export function groupByRecipient(rows) {
  const byUser = new Map();
  for (const row of rows || []) {
    if (!row?.userId) continue;
    const list = byUser.get(row.userId) || [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  return byUser;
}
