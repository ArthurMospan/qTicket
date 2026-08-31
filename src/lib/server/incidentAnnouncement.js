import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { deliverBulkNotifications } from '@/lib/server/bulkNotifications';
import {
  incidentAnnouncementRecipients,
  incidentAnnouncementTitle,
} from '@/lib/utils/incidentAnnouncement.mjs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';

// ─── Telling support a request arrived ───────────────────────────────────────
//
// The one event a helpdesk exists to react to had no notification at all. The
// only thing creation ever sent was `assigned`, whose audience is the new task's
// assignees — and a customer's request has none by definition, because only a
// client opens one and support picks it up afterwards. So `notifyIssueAssigned`
// was handed an empty array, took its early return, and a request filed at
// midnight waited until somebody happened to open the queue and notice an unread
// dot on it.
//
// It has to be the server that says this. The recipients are the tenant's
// internal staff, and the customer's browser is precisely the place that may not
// enumerate them: it cannot read their memberships, and it must not learn who is
// behind the desk. The client sends a title and a description; the server knows
// who is on the other side of it.

const ORG_ADMIN_ROLES = new Set(['owner', 'admin']);

async function rosterRoles(db, organizationId, roster) {
  const roleByUid = new Map();
  if (!roster.length) return roleByUid;
  const snaps = await db.getAll(
    ...roster.map(uid => db.collection('orgMemberships').doc(`${organizationId}_${uid}`)),
  );
  snaps.forEach((snap, index) => {
    const membership = snap.exists ? snap.data() : null;
    if (membership?.orgId === organizationId && membership.userId === roster[index]) {
      roleByUid.set(roster[index], membership.role || null);
    }
  });
  return roleByUid;
}

/**
 * Best-effort: a request that was written must never look like it failed
 * because the bell did not ring. The caller does not await the outcome.
 *
 * @returns {Promise<{recipients: number, records: number}>}
 */
export async function announceIncidentCreated({
  organizationId,
  projectId,
  projectName = '',
  projectTeam = [],
  issueId,
  issueKey = '',
  title = '',
  actor,
}) {
  const actorId = actor?.uid || '';
  if (!organizationId || !projectId || !issueId || !actorId) {
    return { recipients: 0, records: 0 };
  }

  const db = getAdminDb();
  const roster = [...new Set(projectTeam)].filter(uid => typeof uid === 'string' && uid);
  const roleByUid = await rosterRoles(db, organizationId, roster);

  let recipients = incidentAnnouncementRecipients({ projectTeam: roster, roleByUid, actorId });

  // Only when the roster named nobody who could answer. One extra query on a
  // path that should be rare, against none at all on the common one.
  if (!recipients.length) {
    const memberships = await db.collection('orgMemberships')
      .where('orgId', '==', organizationId)
      .get();
    const fallbackAdminIds = memberships.docs
      .map(doc => doc.data())
      .filter(membership => ORG_ADMIN_ROLES.has(membership.role))
      .map(membership => membership.userId)
      .filter(Boolean);
    recipients = incidentAnnouncementRecipients({
      projectTeam: roster,
      roleByUid,
      actorId,
      fallbackAdminIds,
    });
  }

  if (!recipients.length) return { recipients: 0, records: 0 };

  return deliverBulkNotifications({
    organizationId,
    actor,
    events: [{
      userIds: recipients,
      type: 'incident_created',
      title: incidentAnnouncementTitle({ projectName, issueKey }),
      body: title || '',
      link: issuePath({ id: issueId, issueKey }, projectId),
      issueId,
      projectId,
    }],
  });
}
