/**
 * Чисті view-model хелпери чату проєкту QuickTeam+ (Фаза 4b).
 * Без Firebase / server-only — виконується під `node --test`.
 *
 * Схема повідомлення (джерело: qt/src/lib/hooks/useChat.js,
 * projects/{projectId}/messages/{id}):
 *   senderId   — uid автора (портальний)
 *   role       — 'user' | 'ai' | 'system'
 *   text       — тіло повідомлення
 *   senderName — імʼя для показу
 *   avatarUrl  — аватар автора (може бути null)
 *   createdAt  — Firestore Timestamp
 *   readBy[]   — uid-и, що прочитали
 */

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return null;
}

/** Сирий док повідомлення -> готова до рендеру модель. */
export function toChatMessageView(raw, currentUid) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const role = typeof m.role === 'string' ? m.role : 'user';
  const system = role === 'system' || role === 'ai';
  const senderId = m.senderId || null;
  // System activity can still have a real actor. QUICKTEAM+ aligns an action
  // performed by the current user to the right, just like a regular message.
  const mine = !!senderId && !!currentUid && senderId === currentUid;
  return {
    id: m.id || null,
    text: typeof m.text === 'string' ? m.text : '',
    senderId,
    senderName: m.senderName || (mine ? 'Я' : 'Учасник'),
    avatarUrl: m.avatarUrl || null,
    mine,
    system,
    readBy: Array.isArray(m.readBy) ? m.readBy : [],
    createdAtMs: toMillis(m.createdAt),
  };
}

/** Час повідомлення HH:MM з мілісекунд; '' якщо невідомо. */
export function formatMsgTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Мітка дня для роздільника у тому самому форматі, що й timeline завдання. */
export function dayLabel(ms, now = Date.now()) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const t = new Date(now);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const yesterday = new Date(t);
  yesterday.setDate(t.getDate() - 1);
  if (sameDay(d, t)) return 'Сьогодні';
  if (sameDay(d, yesterday)) return 'Вчора';
  return d.toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Кількість непрочитаних: повідомлення не від мене, яких немає в моєму readBy.
 * Системні/AI виключені. Порожній ввід -> 0.
 */
export function unreadCount(messages, currentUid) {
  if (!Array.isArray(messages) || !currentUid) return 0;
  return messages.reduce((n, m) => {
    const role = typeof m.role === 'string' ? m.role : 'user';
    if (role === 'system' || role === 'ai') return n;
    if (m.senderId === currentUid) return n;
    const readBy = Array.isArray(m.readBy) ? m.readBy : [];
    return readBy.includes(currentUid) ? n : n + 1;
  }, 0);
}

/**
 * Повідомлення, які поточний користувач ще не прочитав (для markAllRead).
 * Ті самі правила, що й unreadCount, але повертає самі доки.
 */
export function unreadMessages(messages, currentUid) {
  if (!Array.isArray(messages) || !currentUid) return [];
  return messages.filter((m) => {
    const role = typeof m.role === 'string' ? m.role : 'user';
    if (role === 'system' || role === 'ai') return false;
    if (m.senderId === currentUid) return false;
    const readBy = Array.isArray(m.readBy) ? m.readBy : [];
    return !readBy.includes(currentUid);
  });
}
