import 'server-only';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  MEMBERSHIP_ARCHIVE,
  MEMBERSHIP_COLLECTION,
  membershipId,
} from '@/lib/utils/orgMembership.mjs';
import { INVITABLE_ROLES } from '@/lib/utils/can';

/**
 * Puts someone back on the projects they were on before being deactivated.
 *
 * A project archived away may since have been deleted, and `update` on a
 * missing document fails the whole write — so every id is read back first.
 *
 * @returns {Promise<number>} How many projects actually took them back.
 */
export async function restoreProjectAccess({ organizationId, userId, projectIds = [] }) {
  const ids = [...new Set(projectIds.filter(id => typeof id === 'string' && id.trim()))].slice(0, 200);
  if (ids.length === 0) return 0;

  const db = getAdminDb();
  const snapshots = await db.getAll(...ids.map(id => db.collection('projects').doc(id)));
  const writer = db.bulkWriter();
  let restored = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.exists || snapshot.data().organizationId !== organizationId) continue;
    restored += 1;
    writer.update(snapshot.ref, {
      team: FieldValue.arrayUnion(userId),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await writer.close();
  return restored;
}

/**
 * Gives a deactivated person their seat back.
 *
 * Two doors lead here — the team screen's «Повернути доступ» and an invitation
 * sent to someone who used to be in the organization — and both must land in
 * the same state, or a re-invited colleague would come back as a stranger with
 * none of their projects. The archive document is the only record of what the
 * seat was; it is consumed here and must not survive a successful restore.
 *
 * @param {object} options
 * @param {string} options.organizationId
 * @param {string} options.userId The person coming back.
 * @param {string} [options.role] Overrides the archived role (an invitation names one).
 * @param {string[]} [options.extraProjectIds] Projects to add on top of the archived list.
 * @param {boolean} [options.restoreArchivedProjects] Whether old project access may return.
 * @param {string} options.actorId Who is restoring the access.
 * @returns {Promise<{restored: boolean, role?: string, projectCount?: number}>}
 *   `restored: false` when there was nothing archived to restore.
 */
export async function reactivateMembership({
  organizationId,
  userId,
  role,
  extraProjectIds = [],
  restoreArchivedProjects = true,
  actorId,
}) {
  const db = getAdminDb();
  const id = membershipId(organizationId, userId);
  const orgRef = db.collection('organizations').doc(organizationId);
  const membershipRef = db.collection(MEMBERSHIP_COLLECTION).doc(id);
  const archiveRef = db.collection(MEMBERSHIP_ARCHIVE).doc(id);

  const outcome = await db.runTransaction(async transaction => {
    const [archiveSnap, membershipSnap] = await Promise.all([
      transaction.get(archiveRef),
      transaction.get(membershipRef),
    ]);
    if (membershipSnap.exists) return { restored: false, reason: 'ALREADY_ACTIVE' };
    if (!archiveSnap.exists) return { restored: false, reason: 'NOT_ARCHIVED' };

    const archived = archiveSnap.data();
    if (archived.orgId !== organizationId || archived.userId !== userId) {
      return { restored: false, reason: 'SCOPE_MISMATCH' };
    }
    // The seat of somebody who deleted their account is a record, not an offer.
    // There is no profile behind it and no person to invite back — a new
    // invitation to the same address creates a different account with a
    // different id, so restoring this one would put an empty chair on the team.
    if (archived.accountDeleted === true) {
      return { restored: false, reason: 'ACCOUNT_DELETED' };
    }
    // The owner seat is never archived. Every other qTicket role is valid, but
    // an invitation may deliberately override it when the person returns in a
    // different relationship to this organization.
    const archivedRole = INVITABLE_ROLES.includes(archived.role) ? archived.role : 'member';
    const nextRole = INVITABLE_ROLES.includes(role) ? role : archivedRole;

    transaction.set(membershipRef, {
      id,
      orgId: organizationId,
      userId,
      role: nextRole,
      positionId: archived.positionId || '',
      joinedAt: archived.joinedAt || FieldValue.serverTimestamp(),
      invitedBy: archived.invitedBy || null,
      reactivatedAt: FieldValue.serverTimestamp(),
      reactivatedBy: actorId,
    });
    transaction.delete(archiveRef);
    transaction.update(orgRef, {
      memberDirectoryVersion: FieldValue.increment(1),
    });
    return {
      restored: true,
      role: nextRole,
      projectIds: Array.isArray(archived.projectIds) ? archived.projectIds : [],
    };
  });

  if (!outcome.restored) return outcome;

  const projectCount = await restoreProjectAccess({
    organizationId,
    userId,
    projectIds: [
      ...(restoreArchivedProjects ? outcome.projectIds : []),
      ...extraProjectIds,
    ],
  });
  return { restored: true, role: outcome.role, projectCount };
}
