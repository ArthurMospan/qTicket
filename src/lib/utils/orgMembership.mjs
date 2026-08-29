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

import { INTERNAL_ROLES } from './can.js';

export const MEMBERSHIP_COLLECTION = 'orgMemberships';
export const MEMBERSHIP_ARCHIVE = 'orgMembershipArchive';

export function membershipId(organizationId, userId) {
  return `${organizationId}_${userId}`;
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
  client_admin: 'Адміністратор клієнта',
  client_member: 'Співробітник клієнта',
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
