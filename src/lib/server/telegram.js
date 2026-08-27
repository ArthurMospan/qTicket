import { FieldValue } from 'firebase-admin/firestore';
import 'server-only';

import { createHash, timingSafeEqual } from 'node:crypto';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { shouldDeliver } from '@/lib/utils/notificationChannels.mjs';
import { formatTelegramNotification } from '@/lib/utils/telegramMessage.mjs';
import { resolveNewIssueType } from '@/lib/utils/issueCreationModel.mjs';
import { isValidIssuePrefix } from '@/lib/utils/issueKeys.mjs';
import { resolveProjectIssuePrefixInTransaction } from '@/lib/server/issueKeys';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import {
  DEFAULT_TYPE_IDS,
  resolveClosedStatusIds,
  resolveEntryStatusId,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';
import { NO_PRIORITY_ID } from '@/lib/utils/priorities.mjs';

function config() {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN?.trim() || '',
    username: process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, '') || '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || '',
    appUrl: (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, ''),
  };
}

export function telegramStatus() {
  const value = config();
  return {
    configured: Boolean(
      value.token &&
      /^[A-Za-z0-9_]{5,}$/.test(value.username) &&
      /^[A-Za-z0-9_-]{16,256}$/.test(value.webhookSecret) &&
      /^https:\/\//.test(value.appUrl)
    ),
    username: value.username,
  };
}

export function telegramTokenId(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

export function validTelegramWebhookSecret(candidate) {
  const expected = config().webhookSecret;
  if (!expected || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function telegramRequest(method, payload) {
  const { token } = config();
  if (!token) throw new Error('Telegram bot is not configured');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || result.ok === false) {
    throw new Error(result.description || `Telegram ${method} failed`);
  }
  return result.result;
}

export async function ensureTelegramWebhook() {
  const value = config();
  if (!telegramStatus().configured) throw new Error('Telegram integration is not configured');
  return telegramRequest('setWebhook', {
    url: `${value.appUrl}/api/integrations/telegram/webhook`,
    secret_token: value.webhookSecret,
    allowed_updates: ['message'],
  });
}

export async function sendTelegramMessage(chatId, text) {
  return telegramRequest('sendMessage', {
    chat_id: chatId,
    text: String(text || '').slice(0, 4096),
    link_preview_options: { is_disabled: true },
  });
}

// A formatted message, with the plain-text form as the safety net. Telegram
// answers 400 for markup it cannot parse and delivers nothing, so a stray "<" in
// a task title must not be the difference between a notification and silence.
async function sendFormattedTelegramMessage(chatId, message) {
  try {
    return await telegramRequest('sendMessage', {
      chat_id: chatId,
      text: message.text,
      parse_mode: message.parseMode,
      link_preview_options: { is_disabled: true },
      ...(message.button
        ? { reply_markup: { inline_keyboard: [[message.button]] } }
        : {}),
    });
  } catch (error) {
    console.warn('[telegram] Formatted message rejected, retrying as text:', error.message);
    return sendTelegramMessage(chatId, message.fallbackText || message.text);
  }
}

export function telegramAppLink(link) {
  if (!link) return '';
  const base = config().appUrl;
  if (!base) return '';
  return `${base}${String(link).startsWith('/') ? link : `/${link}`}`;
}

// `type` is optional: callers that have a notification type (the notifications
// route) get the per-event switch applied, and the calendar senders, whose types
// have no switch in Settings, fall through to the channel master alone.
//
// `items` is the batched form: one recipient, several notifications, one
// message. `title`/`body`/`link` remain the single-notification shorthand.
export async function deliverTelegramNotification({
  userIds,
  title,
  body,
  link = '',
  type = '',
  itemsByUserId = null,
}) {
  const status = telegramStatus();
  const recipients = [...new Set((userIds || []).filter(Boolean))];
  if (!recipients.length) {
    return { delivered: 0, attempted: 0, failedUserIds: [], errorsByUserId: {} };
  }
  if (!status.configured) {
    return {
      delivered: 0,
      attempted: recipients.length,
      failedUserIds: recipients,
      errorsByUserId: Object.fromEntries(
        recipients.map(uid => [uid, 'Telegram integration is not configured']),
      ),
    };
  }

  const db = getAdminDb();
  const [preferenceSnapshots, connectionSnapshots] = await Promise.all([
    db.getAll(...recipients.map(uid => db.collection('users').doc(uid).collection('settings').doc('notifications'))),
    db.getAll(...recipients.map(uid => db.collection('users').doc(uid).collection('private').doc('telegram'))),
  ]);
  const shared = itemsByUserId
    ? null
    : formatTelegramNotification([{ type, title, body, url: telegramAppLink(link) }]);

  const skippedUserIds = [];
  const immediateFailures = new Map();
  const deliveries = recipients.flatMap((uid, index) => {
    const preferences = preferenceSnapshots[index].exists ? preferenceSnapshots[index].data() : {};
    const connection = connectionSnapshots[index].exists ? connectionSnapshots[index].data() : {};
    let message = shared;
    if (itemsByUserId) {
      // Each batched item carries its own type, so the per-event switch is
      // applied per item rather than once for the whole digest.
      const allowed = (itemsByUserId.get(uid) || [])
        .filter(item => shouldDeliver(preferences, 'telegram', item.type));
      message = formatTelegramNotification(allowed);
    }
    if (!itemsByUserId && !shouldDeliver(preferences, 'telegram', type)) message = null;
    if (!message) {
      skippedUserIds.push(uid);
      return [];
    }
    if (!connection.chatId) {
      immediateFailures.set(uid, 'Telegram connection has no chat id');
      return [];
    }
    return [{ uid, promise: sendFormattedTelegramMessage(connection.chatId, message) }];
  });
  const results = await Promise.allSettled(deliveries.map(delivery => delivery.promise));
  const failedUserIds = [...immediateFailures.keys()];
  const errorsByUserId = Object.fromEntries(immediateFailures);
  let delivered = 0;
  for (const [index, item] of results.entries()) {
    if (item.status === 'rejected') {
      console.warn('[telegram] Delivery failed:', item.reason?.message || item.reason);
      const uid = deliveries[index].uid;
      failedUserIds.push(uid);
      errorsByUserId[uid] = String(item.reason?.message || item.reason || 'Telegram delivery failed');
    } else {
      delivered += 1;
    }
  }
  return {
    delivered,
    attempted: deliveries.length + immediateFailures.size,
    failedUserIds,
    errorsByUserId,
    skippedUserIds,
  };
}

export async function createIssueFromTelegram({
  organizationId,
  projectId,
  title,
  description = '',
  telegramUser = {},
  telegramMessageId = null,
  telegramChatId = '',
}) {
  const cleanTitle = String(title || '').trim().slice(0, 240);
  if (!cleanTitle) throw new Error('Порожня назва задачі');

  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(projectId);
  const workflowRef = db.collection('organizations')
    .doc(organizationId)
    .collection('settings')
    .doc('workflow');
  const projectSnapshot = await projectRef.get();
  if (!projectSnapshot.exists || projectSnapshot.data().organizationId !== organizationId) {
    throw new Error('Проєкт для Telegram-групи більше недоступний');
  }
  if (projectSnapshot.data().status === 'archived') throw new Error('Проєкт архівовано');

  const issueRef = db.collection('issues').doc();
  let issueKey = '';
  const telegramUsername = String(telegramUser.username || '').replace(/^@/, '').trim();
  const authorName = [telegramUser.first_name, telegramUser.last_name].filter(Boolean).join(' ') ||
    telegramUsername || 'Telegram';
  const reporterName = telegramUsername
    ? `QuickTeam (@${telegramUsername})`
    : `QuickTeam (${authorName})`;

  const countDeltas = await projectIssueCountDeltasFor(db, organizationId);
  await db.runTransaction(async transaction => {
    // Firestore re-runs this body on contention; the counter accumulator lives
    // outside it and would otherwise count the same task once per attempt.
    countDeltas.reset();
    const [freshProject, workflowSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(workflowRef),
    ]);
    if (!freshProject.exists || freshProject.data().organizationId !== organizationId) {
      throw new Error('Проєкт не знайдено');
    }
    const project = freshProject.data();
    if (project.deletionPending === true) throw new Error('Проєкт уже видаляється');
    if (project.status === 'archived') throw new Error('Проєкт архівовано');
    const workflow = workflowSnapshot.data() || {};
    const hiddenStatusIds = new Set(
      Array.isArray(project.hiddenColumns) ? project.hiddenColumns : [],
    );
    const status = resolveEntryStatusId(workflow.statuses, [...hiddenStatusIds]);
    if (!status) throw new Error('У проєкті немає доступного статусу');
    // A task dictated into Telegram carries no priority, so it gets none —
    // the same answer every other way of creating a task now gives.
    const priority = NO_PRIORITY_ID;
    const typeSelection = resolveNewIssueType(
      'task',
      workflowIds(workflow.types, DEFAULT_TYPE_IDS),
    );
    if (typeSelection.error) throw new Error(typeSelection.error.message);
    const type = typeSelection.type;
    const completed = resolveClosedStatusIds(workflow.statuses).includes(status);
    const next = (project.issueCounter || 0) + 1;
    const issuePrefix = await resolveProjectIssuePrefixInTransaction({
      db,
      transaction,
      project,
      projectId,
      organizationId,
    });
    issueKey = `${issuePrefix}-${next}`;
    const now = FieldValue.serverTimestamp();
    transaction.create(issueRef, {
      issueKey,
      organizationId,
      projectId,
      title: cleanTitle,
      description: String(description || '').trim().slice(0, 50_000),
      columnId: status,
      status,
      priority,
      type,
      assigneeIds: [],
      labelIds: [],
      dueDate: null,
      sprintId: null,
      reporterId: `telegram:${telegramUser.id || 'unknown'}`,
      estimateMinutes: null,
      spentMinutes: 0,
      spentMinutesMirrorVersion: 1,
      timeLogMutationVersion: 0,
      parentIssueId: null,
      watcherIds: [],
      // Negative and falling, like every other task: a card nobody has
      // positioned yet sits above the ones somebody has, newest first. This
      // used to be `+next`, which buried a task arriving from Telegram at the
      // bottom of its column — the one place a new task is never looked for.
      order: -next,
      source: 'telegram',
      sourceMeta: {
        chatId: String(telegramChatId),
        messageId: telegramMessageId,
        telegramUserId: telegramUser.id || null,
        telegramUsername,
        telegramDisplayName: authorName,
      },
      reporterName,
      createdBy: 'telegram-bot',
      createdAt: now,
      updatedAt: now,
      // Without these the project card had no activity record for this task, so
      // one that had just arrived announced itself as "Оновлено завдання". The
      // actor is the same external id the reporter carries — a label, not a
      // QuickTeam account — so the card states the event without naming anyone.
      lastActivityType: 'created',
      lastActivityAt: now,
      lastActivityActorId: `telegram:${telegramUser.id || 'unknown'}`,
      ...(completed ? { completedAt: now } : {}),
    });
    // A task dictated into Telegram is one of the project's tasks like any
    // other. Nothing here can be overdue — it has no deadline yet — but it is
    // one more piece of open work, and the home screen's bar is drawn from
    // these three numbers.
    countDeltas
      .observeProject(projectId, project)
      .change(null, { projectId, id: issueRef.id, columnId: status, status, dueDate: null });
    transaction.update(projectRef, {
      issueCounter: next,
      ...projectIssueCountIncrements(countDeltas, projectId),
      ...(!isValidIssuePrefix(project.issuePrefix) ? { issuePrefix } : {}),
      updatedAt: now,
    });
    transaction.create(issueRef.collection('audit').doc(), {
      userId: 'telegram-bot',
      userName: reporterName,
      action: 'created',
      from: null,
      to: issueKey,
      createdAt: now,
    });
  });

  return { id: issueRef.id, issueKey };
}
