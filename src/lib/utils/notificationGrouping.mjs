// src/lib/utils/notificationGrouping.mjs
// One row per conversation in the bell, instead of one row per message.
//
// Five comments on the same task used to be five identical lines — same face,
// same wording, five times — and they pushed everything else out of the fifty
// the panel holds. A conversation is the thing a person came to the bell to
// find, so it gets one line that counts what happened in it.
//
// Pure and dependency-light: the panel and the sheet draw the same list, and
// the tests below check the counting, not the markup.

import { notificationDestination } from './notificationNavigation.mjs';

// Types that repeat inside one conversation and say the same thing each time.
// `assigned` and `status_changed` are deliberately absent: two status changes
// on one request are two different facts, and collapsing them would hide the
// newer one behind a number.
const GROUPABLE_TYPES = new Set(['commented', 'mentioned']);

/**
 * Which incident a record belongs to, or '' if it is not the kind of record
 * that repeats. Every conversation the product has is inside an incident, so a
 * record that names no incident has no conversation to be grouped into.
 */
export function notificationGroupKey(notification) {
  const type = typeof notification?.type === 'string' ? notification.type : '';
  if (!GROUPABLE_TYPES.has(type)) return '';
  const issueId = typeof notification?.issueId === 'string' ? notification.issueId.trim() : '';
  return issueId ? `issue:${issueId}` : '';
}

// The task's human key, out of the link the record already carries. Nothing is
// read to find it: «QT-12» is in the destination, and a record written before
// human URLs existed simply has no key to show.
const ISSUE_KEY_PATTERN = /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#]|$)/;

export function notificationIssueKey(notification) {
  const match = ISSUE_KEY_PATTERN.exec(notificationDestination(notification) || '');
  return match ? decodeURIComponent(match[1]).toUpperCase() : '';
}

function plural(count, [one, few, many]) {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = count % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * «N нових повідомлень в QT-12» — рахунок і місце, з одного зразкового запису.
 *
 * Тим самим реченням говорять два різні місця: рядок у дзвонику, що склеїв
 * кілька записів, і жива картка в кутку, що стоїть одна на розмову й лише
 * переписує на собі число, поки серія триває. Одне формулювання, бо це один і
 * той самий факт, сказаний користувачеві двічі.
 *
 * @param {number} count Скільки записів стоїть за цим рядком.
 * @param {object} sample Будь-який із них — потрібен лише для ключа задачі.
 */
export function notificationCountTitle(count, sample) {
  const what = `${count} ${plural(count, ['нове повідомлення', 'нові повідомлення', 'нових повідомлень'])}`;
  const issueKey = notificationIssueKey(sample);
  if (issueKey) return `${what} в ${issueKey}`;
  // The fallback names no record: the bell is shared with the external client,
  // whose word for it is «звернення» and never «завдання». The key above names
  // it exactly when it can, and «обговорення» is what the messages are in when
  // it cannot.
  return `${what} в обговоренні`;
}

/**
 * What a collapsed row says. A single record keeps its own title — the row is
 * unchanged for the case that was never broken.
 */
export function notificationGroupTitle(group) {
  const { items } = group;
  if (items.length < 2) return items[0]?.title || '';
  return notificationCountTitle(items.length, items[0]);
}

/**
 * Collapse a list of records — already sorted newest first — into rows.
 *
 * Read and unread never share a row: a group that mixed them could not say
 * whether the dot belongs to it, and marking it read would consume records the
 * reader had deliberately left. Everything else keeps the position of its
 * newest member, so the order the panel already sorts by is preserved.
 */
export function groupNotifications(notifications = []) {
  const rows = [];
  const byKey = new Map();
  for (const notification of notifications) {
    if (!notification?.id) continue;
    const key = notificationGroupKey(notification);
    const bucket = key ? `${key}#${notification.read ? 'read' : 'unread'}` : '';
    const existing = bucket ? byKey.get(bucket) : null;
    if (existing) {
      existing.items.push(notification);
      continue;
    }
    const row = { key, id: notification.id, items: [notification] };
    if (bucket) byKey.set(bucket, row);
    rows.push(row);
  }
  return rows.map(row => ({
    ...row,
    // The newest record is the one the row is drawn from: its face, its body,
    // its destination. The rest are what the count is made of.
    notification: row.items[0],
    count: row.items.length,
    title: notificationGroupTitle(row),
  }));
}
