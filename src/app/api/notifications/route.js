import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { generateEmailTemplate } from '@/lib/utils/sendEmail';
import { deliverEmail } from '@/lib/server/email';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';
import { deliverTelegramNotification } from '@/lib/server/telegram';
import { REQUESTABLE_NOTIFICATION_TYPES, shouldDeliver } from '@/lib/utils/notificationChannels.mjs';
import { OUTBOX_COLLECTION, nextAttemptDelayMs } from '@/lib/utils/notificationOutbox.mjs';
import { hasProjectAccess } from '@/lib/utils/projectAccess.mjs';

// What a caller holding a user's token may ask for. System-only types — the
// birthday greeting — are deliberately absent: they are written by the sweep
// through the Admin SDK, and nobody should be able to address the whole
// organization on a colleague's behalf from a browser.
const ALLOWED_TYPES = new Set(REQUESTABLE_NOTIFICATION_TYPES);
const cleanText = (value, maxLength) => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

// Delivery (provider choice, no-op without keys) lives in lib/server/email.
async function sendEmail({ email, type, title, body, link }) {
  if (!email) return false;
  return deliverEmail({
    to: email,
    subject: title,
    html: generateEmailTemplate({ type, title, body, link }),
  });
}

// A row per recipient who is still owed a message. `attempts: 1` is the point of
// it: the outbox reads a first attempt that finds the record already there as
// «somebody else already delivered this» and closes the row, which is right for a
// scheduled reminder and wrong here, because this request wrote that record a
// moment ago. Declaring the attempt spent puts the row straight onto the retry
// path, and the per-channel stamps stop a channel that succeeded from being sent
// a second time.
async function queueFailedChannels({
  db, recipients, recordIdByUser, emailFailed, telegramFailed,
  emailWanted, telegramWanted, payload, actor,
}) {
  const nowMs = Date.now();
  const owed = recipients.filter(item =>
    emailFailed.has(item.userId) || telegramFailed.has(item.userId));
  if (!owed.length) return;
  const batch = db.batch();
  for (const item of owed) {
    const id = recordIdByUser.get(item.userId)
      // Nothing was written for this person: they asked for the event on an
      // external channel only and the request carried no dedupe key. The row
      // still needs an id, and the record it eventually claims under that id is
      // what stops a third delivery.
      || db.collection('notifications').doc().id;
    batch.set(db.collection(OUTBOX_COLLECTION).doc(id), {
      ...payload,
      userId: item.userId,
      calendarEventId: '',
      actorId: actor.id || 'quickteam-system',
      actorName: actor.name || 'QuickTeam',
      allowEmail: emailWanted.has(item.userId),
      status: 'pending',
      attempts: 1,
      lastError: [
        emailFailed.has(item.userId) ? 'email delivery failed' : '',
        telegramFailed.has(item.userId) ? 'telegram delivery failed' : '',
      ].filter(Boolean).join('; '),
      deliverAtMs: nowMs,
      nextAttemptAtMs: nowMs + nextAttemptDelayMs(1),
      ...(emailWanted.has(item.userId) && !emailFailed.has(item.userId) ? { emailSentAtMs: nowMs } : {}),
      ...(telegramWanted.has(item.userId) && !telegramFailed.has(item.userId) ? { telegramSentAtMs: nowMs } : {}),
      materialisedAtMs: nowMs,
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

export async function POST(request) {
  try {
    const payload = await readJsonBody(request);
    const rawUserIds = Array.isArray(payload.userIds) ? payload.userIds : [];
    if (rawUserIds.length > 50) return NextResponse.json({ error: 'Too many recipients' }, { status: 400 });
    const userIds = [...new Set(rawUserIds)].filter(uid => typeof uid === 'string' && uid.length > 0);
    const projectId = cleanText(payload.projectId, 128);
    let organizationId = cleanText(payload.organizationId, 128);
    const db = getAdminDb();
    // Тримаємо документ проєкту, а не лише його організацію: нижче він вирішує,
    // кому це сповіщення взагалі можна надіслати.
    let project = null;
    if (projectId) {
      const projectSnap = await db.collection('projects').doc(projectId).get();
      if (!projectSnap.exists) return NextResponse.json({ error: 'Project not found' }, { status: 404 });
      project = { ...projectSnap.data(), id: projectSnap.id };
      const projectOrganizationId = project.organizationId || '';
      if (organizationId && organizationId !== projectOrganizationId) {
        return NextResponse.json({ error: 'Project does not belong to organization' }, { status: 400 });
      }
      organizationId = projectOrganizationId;
    }

    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    if (!(await enforceRateLimit('notifications', authorization.user.uid, 60, 60))) {
      return NextResponse.json({ error: 'Too many notification requests' }, { status: 429 });
    }

    const type = cleanText(payload.type, 64);
    const title = cleanText(payload.title, 200);
    const body = cleanText(payload.body, 2000);
    const link = cleanText(payload.link, 500);
    const issueId = cleanText(payload.issueId, 128);
    // Which conversation in the workspace chat this is about, when it is about
    // one. The record used to say so only inside its link, so the screen showing
    // that conversation could not ask the question without parsing a URL —
    // which is why a channel's records went on sitting unread in the bell of
    // somebody reading the channel.
    const channelId = cleanText(payload.channelId, 128);
    const dedupeKey = cleanText(payload.dedupeKey, 180);
    if (!userIds.length || !ALLOWED_TYPES.has(type) || !title || !body) return NextResponse.json({ error: 'Missing or invalid fields' }, { status: 400 });
    const scopedLink = link ? withNotificationOrganization(link, organizationId) : '';
    if (link && !scopedLink) {
      return NextResponse.json({ error: 'Invalid notification link' }, { status: 400 });
    }
    if (dedupeKey && !/^[A-Za-z0-9_-]+$/.test(dedupeKey)) return NextResponse.json({ error: 'Invalid dedupe key' }, { status: 400 });
    if (issueId) {
      const issueSnap = await db.collection('issues').doc(issueId).get();
      const issue = issueSnap.exists ? issueSnap.data() : null;
      if (!issue || issue.organizationId !== organizationId || (projectId && issue.projectId !== projectId)) {
        return NextResponse.json({ error: 'Issue does not belong to notification scope' }, { status: 400 });
      }
      // Сповіщення про задачу — це сповіщення про проєкт, у якому вона лежить,
      // навіть коли викликач назвав лише задачу.
      if (!project && issue.projectId) {
        const projectSnap = await db.collection('projects').doc(issue.projectId).get();
        if (projectSnap.exists) project = { ...projectSnap.data(), id: projectSnap.id };
      }
    }

    // Nobody is told about their own action. Every caller already filters the
    // actor out of its audience, which means the guarantee rested on nine call
    // sites all remembering to — so it is made here, once, where the actor is
    // known for certain from the verified token. `test` is the one type that is
    // addressed to yourself on purpose.
    const audienceIds = type === 'test'
      ? userIds
      : userIds.filter(uid => uid !== authorization.user.uid);
    if (!audienceIds.length) return NextResponse.json({ delivered: 0, recipients: 0 });

    // A recipient who is no longer a member is dropped, not fatal. This used to
    // reject the whole request, so a single stale id — the external reporter an
    // imported task carries, a person who has since left — silenced the
    // notification for everyone else on the task too.
    const membershipSnaps = await db.getAll(...audienceIds.map(uid => db.collection('orgMemberships').doc(`${organizationId}_${uid}`)));
    const organizationMemberIds = audienceIds.filter((uid, index) => membershipSnaps[index].exists &&
      membershipSnaps[index].data().orgId === organizationId && membershipSnaps[index].data().userId === uid);

    // Не можна покликати людину туди, куди вона не може зайти.
    //
    // Пікер згадок пропонує лише склад проєкту, але це підказка, а не двері:
    // достатньо дописати «@Імʼя» руками — і повідомлення йде будь-кому з
    // організації. Людина отримувала сповіщення про задачу, тиснула на нього й
    // упиралась у проєкт, до якого не має доступу. Просити доступ теж нема в
    // кого: запрошувати можуть і власник, і адміністратори, тож «надіслати
    // запит» довелося б комусь одному з кількох рівноправних.
    //
    // Тому двері закриваються тут — там само, де вже перевіряється членство в
    // організації, і там, куди браузер не дотягнеться. Доступ — це `project.team`
    // або роль власника/адміністратора, рівно як його розуміє решта продукту.
    const projectAccessDenied = [];
    const userIdsToNotify = !project ? organizationMemberIds : organizationMemberIds.filter(uid => {
      const membership = membershipSnaps[audienceIds.indexOf(uid)]?.data() || {};
      const allowed = hasProjectAccess(project, membership.role, uid);
      if (!allowed) projectAccessDenied.push(uid);
      return allowed;
    });
    if (!userIdsToNotify.length) {
      return NextResponse.json({
        error: organizationMemberIds.length
          ? 'No recipient can reach this project'
          : 'No recipient is an organization member',
      }, { status: 403 });
    }

    const [settingsSnaps, profileSnaps, senderSnap] = await Promise.all([
      db.getAll(...userIdsToNotify.map(uid => db.collection('users').doc(uid).collection('settings').doc('notifications'))),
      db.getAll(...userIdsToNotify.map(uid => db.collection('users').doc(uid))),
      db.collection('users').doc(authorization.user.uid).get(),
    ]);
    const sender = senderSnap.exists ? senderSnap.data() : {};
    // Each channel decides for itself. Previously one set of switches gated the
    // notification record and the other channels rode along on it, so muting an
    // event in the bell also silenced the email and the Telegram message — the
    // three are independent columns now.
    const recipients = userIdsToNotify.map((userId, index) => ({
      userId,
      prefs: settingsSnaps[index].exists ? settingsSnaps[index].data() : {},
      profile: profileSnaps[index].exists ? profileSnaps[index].data() : {},
    }));
    const audienceFor = channel => recipients.filter(item => shouldDeliver(item.prefs, channel, type));
    const inappAudience = audienceFor('inapp');
    const emailAudience = audienceFor('email');
    const telegramAudience = audienceFor('telegram');
    const reached = new Set([...inappAudience, ...emailAudience, ...telegramAudience].map(item => item.userId));

    const notificationData = (delivery, { inapp }) => ({
        userId: delivery.userId, type, title, body, link: scopedLink, issueId, projectId, organizationId, channelId,
        actorId: authorization.user.uid,
        actorName: sender.name || authorization.user.name || '',
        actorAvatar: sender.avatar || sender.photoURL || authorization.user.picture || '',
        read: false,
        // False when this recipient asked for the event on another channel only.
        // The document still has to exist as the dedupe claim below; the bell
        // filters it out.
        inapp,
        createdAt: FieldValue.serverTimestamp(),
      });

    // One claim per recipient, covering every channel. The notification document
    // doubles as the "already told them" marker, so a repeated poll — the daily
    // deadline sweep is the real case — must not resend the email or the
    // Telegram message either. Claiming only for the bell would have let both
    // external channels fire on every pass for anyone who muted the bell.
    let delivered = reached;
    // Which document carries each recipient's record. The id is also the id of
    // the retry row below, so a retry claims the record already written rather
    // than writing a second one.
    const recordIdByUser = new Map();
    if (dedupeKey) {
      const claimants = recipients.filter(item => reached.has(item.userId));
      const claimResults = await Promise.all(claimants.map(async item => {
        const id = `${dedupeKey}_${item.userId}`;
        recordIdByUser.set(item.userId, id);
        const ref = db.collection('notifications').doc(id);
        try {
          await ref.create(notificationData(item, { inapp: inappAudience.includes(item) }));
          return true;
        } catch (error) {
          if (error.code === 6 || error.code === 'already-exists') return false;
          throw error;
        }
      }));
      delivered = new Set(claimants.filter((_, index) => claimResults[index]).map(item => item.userId));
    } else if (inappAudience.length) {
      const batch = db.batch();
      for (const delivery of inappAudience) {
        const ref = db.collection('notifications').doc();
        recordIdByUser.set(delivery.userId, ref.id);
        batch.set(ref, notificationData(delivery, { inapp: true }));
      }
      await batch.commit();
    }

    const emailTargets = emailAudience.filter(item => delivered.has(item.userId));
    const emailResults = await Promise.allSettled(emailTargets.map(item =>
      sendEmail({ email: item.profile.email, type, title, body, link: scopedLink })));
    const emailFailed = new Set(emailTargets
      .filter((_, index) => {
        const result = emailResults[index];
        return result.status === 'rejected' || result.value !== true;
      })
      .map(item => item.userId));

    const telegramTargets = telegramAudience.filter(item => delivered.has(item.userId));
    const telegramResult = telegramTargets.length
      ? await deliverTelegramNotification({
        userIds: telegramTargets.map(item => item.userId),
        title,
        body,
        link: scopedLink,
        type,
      }).catch(error => {
        console.warn('[notifications] Telegram delivery failed:', error.message);
        // The call itself failed, so nobody in it was reached.
        return { delivered: 0, failedUserIds: telegramTargets.map(item => item.userId) };
      })
      : { delivered: 0, failedUserIds: [] };
    const telegramFailed = new Set(telegramResult.failedUserIds || []);

    // This path is the low-latency one and stays that way: the message is
    // attempted the moment the event happens. What it did not have was anywhere
    // to put a provider that was down — a failed email was a line in a log and
    // nothing more. A recipient whose channel failed now gets a row in the same
    // outbox the scheduled reminders use, carrying one spent attempt and the
    // channels that did succeed, so the dispatcher retries what is still owed
    // and never the rest.
    await queueFailedChannels({
      db,
      recipients: recipients.filter(item => delivered.has(item.userId)),
      recordIdByUser,
      emailFailed,
      telegramFailed,
      emailWanted: new Set(emailTargets.map(item => item.userId)),
      telegramWanted: new Set(telegramTargets.map(item => item.userId)),
      payload: { type, title, body, link: scopedLink, issueId, projectId, organizationId },
      actor: { id: authorization.user.uid, name: sender.name || authorization.user.name || '' },
    });

    // Скільки адресатів відпало, бо не мають доступу до проєкту. Викликач має
    // право це знати: інакше «згадка не дійшла» виглядає як збій, а не як
    // правило.
    return NextResponse.json({
      delivered: delivered.size,
      ...(projectAccessDenied.length ? { skippedNoProjectAccess: projectAccessDenied.length } : {}),
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'notifications', fallbackMessage: 'Failed to send notification' });
  }
}
