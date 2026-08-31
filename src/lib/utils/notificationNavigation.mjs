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

// What the card's button says. «Перейти» was the only word it ever said, for
// three different destinations — a request's conversation, the request itself,
// a colleague's profile — so the one thing a button is for, naming where it
// takes you, was the one thing it did not do.
//
// This is also where the notification's type now lives on the card. It used to
// be a capitalised label above the title, repeating in worse words what the
// title already said in plain ones; said by the button instead, it earns its
// place.
//
// Two of these named the destination «завдання», and the bell is not a staff
// screen: an external client is a participant of their own request, so a
// support reply or a status change puts the same card in front of them. The
// conversation labels say what the destination is rather than what the record
// is called, and the three that genuinely name the record take the name from
// the caller, which reads it out of `incidentTerms`.
const OPEN_LABELS = {
  commented: 'Відкрити обговорення',
  mentioned: 'Відкрити обговорення',
  emergency: 'Відкрити профіль',
  alert: 'Відкрити профіль',
};

// The three whose destination is the record itself rather than a conversation
// on it. They are the ones that need the reader's word for it.
const RECORD_DESTINATIONS = new Set(['assigned', 'status_changed', 'deadline', 'incident_created']);

/**
 * @param {object} notification The notification being named.
 * @param {string} options.record The product's word for the record, accusative
 *   — which for «звернення» is the nominative. Callers pass `terms.record`
 *   lowercased; the default is that same word, so a caller that forgets cannot
 *   put a different one on the card.
 * @returns {string} Where the card goes, in words — its accessible name, and the
 *   label of the row action where one is still drawn. «Перейти» for anything
 *   without a place of its own.
 */
export function notificationOpenLabel(notification, { record = 'звернення' } = {}) {
  const type = typeof notification?.type === 'string' ? notification.type : '';
  if (RECORD_DESTINATIONS.has(type)) return `Відкрити ${record}`;
  return OPEN_LABELS[type] || 'Перейти';
}

export function notificationDestinationWithOrganization(notification) {
  return withNotificationOrganization(
    notificationDestination(notification),
    notification?.organizationId,
  );
}
