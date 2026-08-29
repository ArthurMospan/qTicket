import { FieldValue } from 'firebase-admin/firestore';
import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { deliverEmail } from '@/lib/server/email';
import { generateEmailTemplate } from '@/lib/utils/sendEmail';
import { shouldDeliver } from '@/lib/utils/notificationChannels.mjs';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';

// ─── Telling people about a hundred changes at once ──────────────────────────
//
// A bulk operation used to call POST /api/notifications once per task. Each of
// those calls verified the token again, re-read the project and the task,
// re-read every recipient's membership, settings and profile, and then — the
// part that actually cost the minutes — awaited an email round-trip. Moving
// fifty tasks with three participants each meant a hundred and fifty emails
// sent one after another while the toolbar sat frozen, and enough calls to trip
// the notification route's own rate limit, so the tail of the operation
// silently told nobody anything.
//
// The reads happen once here for the whole operation, and email is a digest:
// one message per person, however many tasks they were involved in. The bell
// keeps a row per task, because that is where a per-task link is worth having
// and a batched write costs nothing.

// Firestore refuses a batch over 500 writes.
const BATCH_LIMIT = 400;

// How many task titles a digest lists before it stops naming them. Past this,
// the count is the information and the list is noise.
const DIGEST_SAMPLE = 8;

function chunked(values, size) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

/**
 * Sends one notification per (event, recipient) to the bell, and one digest per
 * recipient to email.
 *
 * @param {string} organizationId Scope every recipient and record is checked against.
 * @param {{uid: string, name?: string, avatar?: string}} actor Who performed the operation; never notified about it.
 * @param {{userIds: string[], type: string, title: string, body: string, link?: string, issueId?: string, projectId?: string}[]} events One entry per task that has something to say.
 * @param {string} digestTitle Subject of the digest when a recipient has more than one event.
 * @returns {Promise<{recipients: number, records: number}>}
 */
export async function deliverBulkNotifications({
  organizationId,
  actor,
  events = [],
  // The digest is delivered to whoever the events name, and that includes the
  // external client who opened the record. Nothing here names it.
  digestTitle = 'Кілька оновлень',
}) {
  const actorId = actor?.uid || '';
  // Nobody is told about their own action — the same guarantee the notifications
  // route makes, made here too rather than trusted to the caller.
  const scoped = events
    .map(event => ({
      ...event,
      userIds: [...new Set((event.userIds || []).filter(uid => uid && uid !== actorId))],
      link: event.link ? withNotificationOrganization(event.link, organizationId) : '',
    }))
    .filter(event => event.userIds.length && event.type && event.title);
  if (!organizationId || !actorId || !scoped.length) return { recipients: 0, records: 0 };

  const audience = [...new Set(scoped.flatMap(event => event.userIds))];
  const db = getAdminDb();
  const membershipSnaps = await db.getAll(
    ...audience.map(uid => db.collection('orgMemberships').doc(`${organizationId}_${uid}`)),
  );
  // A recipient who has since left is dropped, not fatal — one stale id must not
  // silence the notification for everyone else.
  const members = audience.filter((uid, index) => membershipSnaps[index].exists
    && membershipSnaps[index].data().orgId === organizationId
    && membershipSnaps[index].data().userId === uid);
  if (!members.length) return { recipients: 0, records: 0 };

  const [settingsSnaps, profileSnaps, senderSnap] = await Promise.all([
    db.getAll(...members.map(uid => db.collection('users').doc(uid).collection('settings').doc('notifications'))),
    db.getAll(...members.map(uid => db.collection('users').doc(uid))),
    db.collection('users').doc(actorId).get(),
  ]);
  const prefs = new Map(members.map((uid, index) => [uid, settingsSnaps[index].exists ? settingsSnaps[index].data() : {}]));
  const profiles = new Map(members.map((uid, index) => [uid, profileSnaps[index].exists ? profileSnaps[index].data() : {}]));
  const sender = senderSnap.exists ? senderSnap.data() : {};
  const isMember = new Set(members);

  const actorName = sender.name || actor?.name || '';
  const actorAvatar = sender.avatar || sender.photoURL || actor?.avatar || '';

  const records = [];
  const perRecipient = new Map();
  for (const event of scoped) {
    for (const uid of event.userIds) {
      if (!isMember.has(uid)) continue;
      const preferences = prefs.get(uid) || {};
      const inapp = shouldDeliver(preferences, 'inapp', event.type);
      const email = shouldDeliver(preferences, 'email', event.type);
      if (!inapp && !email) continue;
      records.push({
        uid,
        // False when this recipient asked for the event on another channel only:
        // the record still exists, the bell just filters it out. Same rule as
        // the single-notification route.
        data: {
          userId: uid,
          type: event.type,
          title: event.title,
          body: event.body || '',
          link: event.link || '',
          issueId: event.issueId || '',
          projectId: event.projectId || '',
          organizationId,
          actorId,
          actorName,
          actorAvatar,
          read: false,
          inapp,
          createdAt: FieldValue.serverTimestamp(),
        },
      });
      const bucket = perRecipient.get(uid) || { email: [] };
      if (email) bucket.email.push(event);
      perRecipient.set(uid, bucket);
    }
  }
  if (!records.length) return { recipients: 0, records: 0 };

  for (const group of chunked(records, BATCH_LIMIT)) {
    const batch = db.batch();
    for (const record of group) batch.set(db.collection('notifications').doc(), record.data);
    await batch.commit();
  }

  const digestBody = items => {
    const listed = items.slice(0, DIGEST_SAMPLE).map(item => `• ${item.title}`);
    const rest = items.length - listed.length;
    return [...listed, rest > 0 ? `…та ще ${rest}` : ''].filter(Boolean).join('\n');
  };

  // Email: one message per person. A single event keeps its own subject and its
  // own link — a digest of one is just a worse version of the notification.
  const emailJobs = [...perRecipient.entries()]
    .filter(([uid, bucket]) => bucket.email.length && profiles.get(uid)?.email)
    .map(([uid, bucket]) => {
      const items = bucket.email;
      const single = items.length === 1 ? items[0] : null;
      return deliverEmail({
        to: profiles.get(uid).email,
        subject: single ? single.title : `${digestTitle}: ${items.length}`,
        html: generateEmailTemplate({
          type: single ? single.type : 'alert',
          title: single ? single.title : `${digestTitle}: ${items.length}`,
          body: single ? single.body : digestBody(items),
          link: single ? single.link : '',
          userName: actorName,
        }),
      });
    });

  await Promise.allSettled(emailJobs);

  return { recipients: perRecipient.size, records: records.length };
}

export default deliverBulkNotifications;
