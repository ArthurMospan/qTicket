import { isClientRole } from '../utils/can.js';
import { isOnProjectTeam } from '../utils/projectAccess.mjs';
import { MEMBERSHIP_COLLECTION, membershipId } from '../utils/orgMembership.mjs';

export function projectTeamRemovalError(code, status, message) {
  const error = new Error(code);
  error.projectTeamRemoval = { status, message };
  return error;
}

/**
 * Whether `memberId` may be taken off `project` by the actor, and what that
 * leaves behind.
 *
 * The other half of «Запросити клієнта». Executable outside a Next route on
 * purpose, the way `resolveInvitationScope` is, so every limit below is held
 * by a behaviour test rather than a source regex:
 *
 *   • only a client seat leaves this way — a support seat is QuickTeam's, and
 *     the desk's own roster is administered there;
 *   • nobody removes themselves — that is «Вийти з організації»;
 *   • a client administrator removes only a `client_member`, and only from a
 *     project they are on themselves; the desk removes anyone on the client's
 *     team;
 *   • the seat is archived, not merely emptied, when this was the person's last
 *     project in the organization — a client role with no project is a login
 *     that opens onto nothing.
 *
 * The «other projects» question is asked with a single-field query and the
 * organization is filtered in code: no composite index exists in production,
 * and a two-field query passes every test and fails there.
 *
 * @param {object} db The Firestore handle — real or a test double with `collection().doc().get()` and `collection().where().get()`.
 * @param {object} args.project The project as loaded by the route, with `id`, `organizationId` and `team`.
 * @param {string} args.organizationId The organization the route authorized against.
 * @param {string} args.actorUid Who is asking.
 * @param {'owner'|'admin'|'client_admin'} args.actorRole Their role, already checked against `remove:client_member`.
 * @param {string} args.memberId Who is being taken off.
 * @returns {Promise<{ role: string, archiveSeat: boolean, remainingProjectIds: string[] }>}
 */
export async function resolveProjectTeamRemoval(db, {
  project,
  organizationId,
  actorUid,
  actorRole,
  memberId,
}) {
  if (typeof memberId !== 'string' || !memberId || memberId.includes('/')) {
    throw projectTeamRemovalError('INVALID_MEMBER', 400, 'Некоректний учасник');
  }
  if (memberId === actorUid) {
    throw projectTeamRemovalError('SELF', 409, 'Себе з проєкту не вилучають — вийти з організації можна в «Налаштуваннях»');
  }
  if (!isOnProjectTeam(project, memberId)) {
    throw projectTeamRemovalError('NOT_ON_PROJECT', 404, 'Цієї людини немає в проєкті');
  }

  const membershipSnap = await db
    .collection(MEMBERSHIP_COLLECTION)
    .doc(membershipId(organizationId, memberId))
    .get();
  const membership = membershipSnap.exists ? membershipSnap.data() : null;
  const role = membership?.role;
  if (
    !membership
    || membership.orgId !== organizationId
    || membership.userId !== memberId
    || !isClientRole(role)
  ) {
    throw projectTeamRemovalError('NOT_A_CLIENT_SEAT', 409, 'Місця підтримки керуються у QuickTeam');
  }

  if (actorRole === 'client_admin') {
    if (!isOnProjectTeam(project, actorUid)) {
      throw projectTeamRemovalError('FOREIGN_PROJECT', 403, 'Ви не входите до команди цього проєкту');
    }
    if (role !== 'client_member') {
      throw projectTeamRemovalError('ADMIN_SEAT', 403, 'Адміністратора клієнта вилучає лише підтримка');
    }
  }

  const held = await db.collection('projects').where('team', 'array-contains', memberId).get();
  const remainingProjectIds = held.docs
    .filter(snapshot => snapshot.id !== project.id && snapshot.data().organizationId === organizationId)
    .map(snapshot => snapshot.id);

  return {
    role,
    archiveSeat: remainingProjectIds.length === 0,
    remainingProjectIds,
  };
}
