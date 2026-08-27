const WORKSPACE_ORIGIN = 'https://quickteam.local';
const BLOCKED_NOTIFICATION_DESTINATIONS = ['/api', '/login', '/oauth2'];

export function normalizeNotificationLink(link) {
  if (typeof link !== 'string') return '';
  const value = link.trim();
  if (!value || value.includes('\\') || !value.startsWith('/') || value.startsWith('//')) return '';

  try {
    const url = new URL(value, WORKSPACE_ORIGIN);
    if (url.origin !== WORKSPACE_ORIGIN) return '';
    const pathname = url.pathname === '/workspace'
      ? '/'
      : url.pathname.startsWith('/workspace/')
        ? url.pathname.slice('/workspace'.length)
        : url.pathname;
    const isBlocked = BLOCKED_NOTIFICATION_DESTINATIONS.some(prefix =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
    if (isBlocked) return '';
    return `${pathname}${url.search}${url.hash}`;
  } catch {
    return '';
  }
}

export function withNotificationOrganization(link, organizationId) {
  const safeLink = normalizeNotificationLink(link);
  if (!safeLink) return '';
  if (typeof organizationId !== 'string' || !organizationId.trim()) return safeLink;

  const url = new URL(safeLink, WORKSPACE_ORIGIN);
  url.searchParams.set('org', organizationId.trim());
  return `${url.pathname}${url.search}${url.hash}`;
}

export function notificationDestination(notification) {
  if (!notification || typeof notification !== 'object') return '';
  const projectId = typeof notification.projectId === 'string' ? notification.projectId.trim() : '';
  const issueId = typeof notification.issueId === 'string' ? notification.issueId.trim() : '';
  // New notifications carry the human issue key in their safe internal link.
  // Prefer it over the structured legacy document id, while retaining the
  // latter as a fallback for notifications created before human URLs existed.
  const explicitLink = normalizeNotificationLink(notification.link);
  if (explicitLink) return explicitLink;
  if (projectId && issueId) {
    return `/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issueId)}`;
  }
  if (projectId) return `/${encodeURIComponent(projectId)}`;
  return '';
}

/**
 * Which conversation in the workspace chat a notification is about, named the
 * way the chat pane names it: a channel by its id, a direct conversation by the
 * person on the other side of it.
 *
 * Read from the record's own `channelId` where there is one, and from the link
 * it carries where there is not — every record written before that field
 * existed has only the link, and those records are still in people's bells.
 *
 * @param {object} notification The notification record.
 * @returns {string} The channel id, the partner's uid, or '' for anything that is not a chat conversation.
 */
export function notificationConversationId(notification) {
  const explicit = typeof notification?.channelId === 'string' ? notification.channelId.trim() : '';
  if (explicit) return explicit;
  const link = normalizeNotificationLink(notification?.link);
  if (!link) return '';
  try {
    const { searchParams } = new URL(link, WORKSPACE_ORIGIN);
    return (searchParams.get('channel') || searchParams.get('dm') || '').trim();
  } catch {
    return '';
  }
}

// What the card's button says. «Перейти» was the only word it ever said, for
// five different destinations — a task's chat, the task itself, a conversation,
// a calendar event, a colleague's profile — so the one thing a button is for,
// naming where it takes you, was the one thing it did not do.
//
// This is also where the notification's type now lives on the card. It used to
// be a capitalised label above the title, repeating in worse words what the
// title already said in plain ones; said by the button instead, it earns its
// place.
const OPEN_LABELS = {
  commented: 'Відкрити чат завдання',
  mentioned: 'Відкрити чат завдання',
  assigned: 'Відкрити завдання',
  status_changed: 'Відкрити завдання',
  deadline: 'Відкрити завдання',
  chat_message: 'Відкрити розмову',
  calendar_invite: 'Відкрити подію',
  calendar_changed: 'Відкрити подію',
  calendar_reminder: 'Відкрити подію',
  emergency: 'Відкрити профіль',
  alert: 'Відкрити профіль',
};

/**
 * @param {object} notification The notification being named.
 * @returns {string} Where the card goes, in words — its accessible name, and the
 *   label of the row action where one is still drawn. «Перейти» for anything
 *   without a place of its own.
 */
export function notificationOpenLabel(notification) {
  const type = typeof notification?.type === 'string' ? notification.type : '';
  // A mention in the workspace chat is a conversation, not a task — the same
  // type reaches two different places, and the link is what knows which.
  if (type === 'mentioned' && !notification?.issueId) return 'Відкрити розмову';
  return OPEN_LABELS[type] || 'Перейти';
}

export function notificationDestinationWithOrganization(notification) {
  return withNotificationOrganization(
    notificationDestination(notification),
    notification?.organizationId,
  );
}
