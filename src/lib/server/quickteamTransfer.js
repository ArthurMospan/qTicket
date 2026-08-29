import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  QUICKTEAM_CONTRACT_VERSION,
  createQuickTeamSignedRequest,
  quickTeamAppConfig,
} from '@/lib/integrations/quickteamContract.mjs';

// Transferring a request into a QuickTeam task is qTicket asking QuickTeam for
// something, which is the opposite of every other call in this contract. What
// stays the same is who decides: QuickTeam authorizes the person, picks what
// they may write to and owns the task afterwards. qTicket sends the words and
// keeps the link.

async function callQuickTeam(path, payload) {
  const signed = createQuickTeamSignedRequest({ version: QUICKTEAM_CONTRACT_VERSION, ...payload });
  const response = await fetch(`${signed.origin}${path}`, {
    method: 'POST',
    headers: signed.headers,
    body: signed.body,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `QuickTeam returned ${response.status}`);
    error.code = data.code || 'QUICKTEAM_UPSTREAM';
    error.status = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  return data;
}

/**
 * The QuickTeam identity of a qTicket staff account, or an empty string.
 *
 * Provisioning writes `quickTeamIdentities` keyed by a hash of the QuickTeam
 * user id, which answers one direction only. This is the other one, and it is a
 * query rather than a lookup because the key cannot be reversed — that is what
 * makes the id opaque in the first place.
 */
export async function quickTeamSourceUserId(qTicketUserId) {
  if (!qTicketUserId) return '';
  const snapshot = await getAdminDb().collection('quickTeamIdentities')
    .where('qTicketUserId', '==', qTicketUserId)
    .limit(1)
    .get();
  return snapshot.docs[0]?.data()?.sourceUserId || '';
}

export function quickTeamTransferConfigured() {
  return quickTeamAppConfig().configured;
}

export function listQuickTeamProjects(payload) {
  return callQuickTeam('/api/integrations/qticket/projects', payload);
}

export function createQuickTeamTask(payload) {
  return callQuickTeam('/api/integrations/qticket/tasks', payload);
}
