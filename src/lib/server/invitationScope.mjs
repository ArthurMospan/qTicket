import { invitedRoleFor, isClientRole } from '../utils/can.js';

// Resolve the complete project boundary before an invitation is written. This
// is deliberately executable outside a Next route so the two supported client
// invitation flows are covered by behavior tests rather than source regexes.
export async function resolveInvitationScope(db, {
  requestedProjectIds,
  organizationId,
  inviterUid,
  inviterRole,
  requestedRole,
}) {
  const role = invitedRoleFor(requestedRole, inviterRole);
  const clientInvitee = isClientRole(role);
  const clientScopedInvitation = inviterRole === 'client_admin';
  const ids = [...new Set(
    (Array.isArray(requestedProjectIds) ? requestedProjectIds : [])
      .filter(id => typeof id === 'string' && id.trim())
      .map(id => id.trim()),
  )].slice(0, 20);

  if (clientInvitee && ids.length !== 1) throw new Error('CLIENT_PROJECT_REQUIRED');
  if (ids.length) {
    const snapshots = await db.getAll(...ids.map(id => db.collection('projects').doc(id)));
    if (snapshots.some(snapshot => (
      !snapshot.exists
      || snapshot.data().organizationId !== organizationId
      || (clientScopedInvitation && !snapshot.data().team?.includes(inviterUid))
    ))) {
      throw new Error('INVALID_PROJECT_SCOPE');
    }
  }

  return {
    role,
    clientInvitee,
    projectIds: ids,
    scope: clientInvitee ? 'client-project' : 'organization',
    restoreArchivedProjects: !clientInvitee,
  };
}

// Read the current invitation capacity without re-reading or shadowing the
// organization snapshot already verified by the route. Keeping this Promise
// fan-out executable in isolation prevents the TDZ regression that previously
// made every new invitation fail before a document could be written.
export async function readInvitationSeatState(
  db,
  organizationId,
  organizationSnapshot,
  countActiveMembers,
) {
  const [seatsTaken, pendingSeats] = await Promise.all([
    countActiveMembers(db, organizationId),
    db.collection('invitations')
      .where('organizationId', '==', organizationId)
      .where('status', '==', 'pending')
      .count()
      .get()
      .then(snapshot => snapshot.data().count),
  ]);
  return { organizationSnapshot, seatsTaken, pendingSeats };
}
