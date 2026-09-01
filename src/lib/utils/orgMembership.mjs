// src/lib/utils/orgMembership.mjs
// Where a membership lives, and what it means that it lives there.
//
// `orgMemberships/{orgId}_{uid}` is the access record: every Firestore rule
// proves membership by the mere existence of that document, which is why
// taking access away means deleting it rather than flagging it. A flag would
// have to be read on every single rule evaluation.
//
// `orgMembershipArchive/{orgId}_{uid}` is where that record goes when someone
// is deactivated or leaves. It holds the seat — role, position, the projects
// they were on — so the seat can be restored exactly; it grants nothing. The
// person's *work* (authored comments, logged time, assigned and watched tasks)
// is never moved or stripped: that is a record of what happened, not a
// permission, and rewriting it is how a workspace loses its own history.

import { INTERNAL_ROLES, isClientRole } from './can.js';

export const MEMBERSHIP_COLLECTION = 'orgMemberships';
export const MEMBERSHIP_ARCHIVE = 'orgMembershipArchive';

export function membershipId(organizationId, userId) {
  return `${organizationId}_${userId}`;
}

/**
 * The seats a QuickTeam snapshot must not take, because a customer is sitting
 * in them.
 *
 * A membership is one document per person per organization and it holds one
 * role, so «staff» and «client» are not two hats somebody can wear at once —
 * writing one over the other does not add a relationship, it replaces one.
 * Provisioning resolves QuickTeam staff by verified email, which is exactly how
 * it reached a client seat: the same address is one qTicket account, and the
 * snapshot wrote `admin` over `client_admin` without asking.
 *
 * That is not a cosmetic collision. An admin reaches every project of the
 * organization, so it hands an external person every other customer's queue.
 * It also rewrites the past: who counts as the desk is read from the *current*
 * role, so every request that person ever wrote in flips from «чекають на вас»
 * to «чекають на нас» the moment the seat changes hands. And the undo is
 * destructive — pulling them out of the next snapshot marks the seat departing,
 * which archives it and clears them from every `project.team` they were on,
 * client access included.
 *
 * So the collision is refused rather than resolved. The invitation route has
 * always refused the mirror of it — you cannot invite an existing staff member
 * as a customer — and this is the direction that was left open.
 *
 * @param {object} options
 * @param {Array<{sourceUserId: string, email: string, role: string, userId: string}>}
 *   options.candidates Incoming staff, each with the qTicket uid this snapshot would land on.
 * @param {Array<{userId: string, role: string}>} options.memberships The memberships this organization holds now.
 * @returns {Array<{sourceUserId: string, email: string, requestedRole: string, userId: string, currentRole: string}>}
 */
export function clientSeatCollisions({ candidates = [], memberships = [] }) {
  const roleByUser = new Map(memberships.map(membership => [membership.userId, membership.role]));
  return candidates
    .filter(candidate => candidate.userId && isClientRole(roleByUser.get(candidate.userId)))
    .map(candidate => ({
      sourceUserId: candidate.sourceUserId,
      email: candidate.email,
      requestedRole: candidate.role,
      userId: candidate.userId,
      currentRole: roleByUser.get(candidate.userId),
    }));
}

/**
 * What a QuickTeam staff snapshot does to the seats that are already here.
 *
 * QuickTeam owns the support side of the workspace: a person it stops sending
 * loses their seat, and the same person in a later snapshot gets it back. The
 * two halves are one rule and are decided together, because getting them apart
 * is exactly how they came to disagree — the seat was archived without the
 * client spaces the person worked on, `project.team` was cleared, and the
 * return path deleted the archive instead of consuming it. Nothing anywhere
 * remembered the projects, so a colleague who came back came back to nothing.
 *
 * @param {object} options
 * @param {string[]} options.incomingUserIds qTicket uids named by this snapshot.
 * @param {Array<{userId: string, role: string, positionId?: string, joinedAt?: *,
 *   invitedBy?: *}>} options.memberships The memberships this organization holds now.
 * @param {Array<{id: string, team?: string[]}>} options.projects Every client space.
 * @param {Array<{userId: string, projectIds?: string[]}>} [options.archives]
 *   The archived seats of people this snapshot names — their way back in.
 * @returns {{departing: Array<{userId: string, role: string, positionId: string,
 *   joinedAt: *, invitedBy: *, projectIds: string[]}>, projectIds: string[],
 *   returning: Array<{userId: string, seat: object, projectIds: string[]}>}}
 */
export function quickTeamSeatChanges({
  incomingUserIds = [],
  memberships = [],
  projects = [],
  archives = [],
}) {
  const incoming = new Set(incomingUserIds);
  const leaving = memberships.filter(membership => (
    INTERNAL_ROLES.includes(membership.role) && !incoming.has(membership.userId)
  ));
  // The client spaces each departing person is on. `project.team` is about to be
  // cleared of them, so this is the last moment the answer exists.
  const projectIdsByUser = new Map(leaving.map(membership => [membership.userId, []]));
  const touchedProjectIds = [];
  for (const project of projects) {
    const affected = (project.team || []).filter(uid => projectIdsByUser.has(uid));
    if (affected.length === 0) continue;
    for (const uid of affected) projectIdsByUser.get(uid).push(project.id);
    touchedProjectIds.push(project.id);
  }
  return {
    departing: leaving.map(membership => ({
      userId: membership.userId,
      role: membership.role,
      positionId: membership.positionId || '',
      joinedAt: membership.joinedAt || null,
      invitedBy: membership.invitedBy || null,
      projectIds: projectIdsByUser.get(membership.userId) || [],
    })),
    projectIds: touchedProjectIds,
    returning: archives
      .filter(archived => incoming.has(archived.userId))
      .map(archived => ({
        userId: archived.userId,
        seat: archived,
        projectIds: Array.isArray(archived.projectIds) ? archived.projectIds : [],
      })),
  };
}

/**
 * What a role is called on screen.
 *
 * `owner`, `admin` and `member` are stored ids — business semantics that rules,
 * routes and `can.js` all key off, and that must never be translated in the
 * database. What a person reads is a different thing, and it was written out by
 * hand in four places with three different words: «Адміністратор» in the
 * settings, «Адмін» on a project's team tab, and nothing at all in the
 * organization switcher, which showed the raw `owner` and `member` capitalised
 * into English. One map, so a workspace does not call the same role three
 * things depending on which screen you are looking at.
 */
export const ORGANIZATION_ROLE_LABELS = Object.freeze({
  owner: 'Власник',
  admin: 'Адміністратор',
  member: 'Менеджер підтримки',
  // Named by the place, not by the party. «Адміністратор клієнта» and
  // «Співробітник клієнта» read the roster from the desk's chair, and the
  // person wearing the label is the one who opens the screen: qTicket tells a
  // customer's administrator that they are somebody's client, in their own
  // profile, on their own project. The project is what these two roles are
  // scoped to — one project, named on the invitation — so the project is what
  // names them.
  client_admin: 'Адміністратор проєкту',
  client_member: 'Співробітник',
});

export function organizationRoleLabel(role) {
  return ORGANIZATION_ROLE_LABELS[role] || ORGANIZATION_ROLE_LABELS.member;
}

export const MEMBER_STATUS = {
  active: 'active',
  deactivated: 'deactivated',
};

export function isActiveMember(member) {
  return (member?.status || MEMBER_STATUS.active) === MEMBER_STATUS.active;
}

/** The people who can still be given work: pickers and selects use this. */
export function activeMembers(members) {
  return (Array.isArray(members) ? members : []).filter(isActiveMember);
}
