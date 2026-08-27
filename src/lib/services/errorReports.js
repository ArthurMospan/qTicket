'use client';

import { auth } from '@/lib/firebase';

/**
 * Send one failure to the people who can fix it.
 *
 * Written through the server rather than straight into Firestore: the browser
 * cannot be trusted with who it says it is, the rate limit belongs on the
 * server, and the collection stays unreadable from any client — an error report
 * carries somebody's screen and path, and that is not workspace content.
 *
 * @param {string} options.organizationId Which workspace it happened in.
 * @param {string} options.message What the person was shown.
 * @param {string} options.detail What actually happened underneath, if known.
 * @param {string} options.context Which operation asked for it.
 * @param {string} options.path Where they were.
 * @param {string} options.note Anything they chose to add.
 */
export async function reportError({
  organizationId,
  message,
  detail = '',
  context = '',
  path = '',
  note = '',
}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch('/api/error-reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ organizationId, message, detail, context, path, note }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Failed to send the report');
  return result;
}

/**
 * The newest hundred reports, from every workspace.
 *
 * Behind a named account rather than a role or a shared password. The session
 * the reader already has is the credential, so nothing secret travels here and
 * nothing has to be remembered — see the inbox route for why an account id is
 * the safer thing to write down in a public repository.
 */
export async function fetchErrorReports() {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Спершу увійдіть у QuickTeam');
  const response = await fetch('/api/error-reports/inbox', {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Не вдалося прочитати звіти');
  return result.reports || [];
}
