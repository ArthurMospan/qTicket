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

export const MEMBERSHIP_COLLECTION = 'orgMemberships';
export const MEMBERSHIP_ARCHIVE = 'orgMembershipArchive';

export function membershipId(organizationId, userId) {
  return `${organizationId}_${userId}`;
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
