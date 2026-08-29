// src/lib/utils/can.js
// Role-Based Access Control (RBAC) permissions matrix
//
// One rule about this file: an entry describes what the product actually
// enforces, never what someone once meant it to enforce. Firestore rules and
// the server routes are authoritative; when they disagree with an entry here,
// the entry is the bug. Three entries have already drifted that way, so every
// permission below names the route or rule that backs it.

export const ORGANIZATION_ROLES = ['owner', 'admin', 'member', 'client_admin', 'client_member'];
export const INVITABLE_ROLES = ['admin', 'member', 'client_admin', 'client_member'];
export const CLIENT_ROLES = ['client_admin', 'client_member'];

export function isClientRole(role) {
  return CLIENT_ROLES.includes(role);
}

export function invitedRoleFor(requestedRole, inviterRole) {
  if (inviterRole === 'client_admin') return 'client_member';
  return INVITABLE_ROLES.includes(requestedRole) ? requestedRole : 'member';
}

export const PERMISSIONS = {
  // Projects
  'create:project': ['owner', 'admin'],
  'delete:project': ['owner', 'admin'],
  'edit:project_settings': ['owner', 'admin'],

  // Board configuration is not a permission of its own: the columns live in
  // project settings, behind `edit:project_settings`, and the entry that used to
  // sit here was a second name for the same gate that nothing ever called.

  // Sprints are not in this matrix, and no longer anywhere else either: the
  // planning screen, the field and its collection rule are gone.

  // Team
  //
  // `manage:team` is the invitation and project-team permission — it is not
  // one undivided "team management" right, because the product splits it:
  // inviting and deactivating are owner+admin, while ownership stays in QuickTeam.
  'manage:team': ['owner', 'admin'],          // Запрошення, склад команди проєкту
  // A client administrator may invite a client member only into a project
  // they already belong to. The invitation route enforces that project scope;
  // this permission must never be used as a substitute for `manage:team`.
  'invite:client_member': ['owner', 'admin', 'client_admin'],
  'manage:member_roles': ['owner', 'admin'],  // member ↔ admin, /api/organizations/[id]/members/[memberId]
  'deactivate:member': ['owner', 'admin'],    // Забрати доступ, лишивши дані

  // Money is not in this matrix. qTicket answers incidents; invoices, rates and
  // timesheets are not part of «клієнт написав → підтримка відповіла → закрили»
  // and have been deleted rather than gated, so there is no permission left to
  // describe.

  // Inherited internal support modules
  //
  // qTicket does not publish the planning calendar as a product surface, but
  // its server routes remain for the retained notification/accounting engine.
  // They must never become a back door from the client portal into staff
  // events, birthdays or calendar time.
  'access:calendar': ['owner', 'admin', 'member'],

  // Issues
  //
  // A member may delete a task in a project they belong to. Access to the
  // project is what grants it, exactly as in Linear and Asana: the alternative
  // — a typo that only an administrator can clear — is not a safety property,
  // it is a queue. The task lands in the trash either way and can be restored.
  // Project scope is enforced server-side in /api/issues/[issueId] and
  // /api/issues/bulk; being a member of the organization is not enough.
  'create:issue': ['owner', 'admin', 'member', 'client_admin', 'client_member'],
  'edit:issue': ['owner', 'admin', 'member'],
  'delete:issue': ['owner', 'admin', 'member'],

  // The conversation
  //
  // The third entry that had drifted, and the most expensive one: this said a
  // client may reply while `firestore.rules` refused the write the product
  // actually sends. Sending a reply is a transaction — the comment plus the
  // incident's conversation metadata — and only the comment half was allowed,
  // so the whole thing was refused. `issues/{issueId}` now carries a narrow
  // conversation-participant clause beside `issues/{issueId}/comments`, and
  // this entry is true for the first time.
  'create:comment': ['owner', 'admin', 'member', 'client_admin', 'client_member'],
  // An incident has exactly one conversation and both sides of the desk read
  // all of it. There is no staff-only half of it left to gate: the
  // `internalNotes` collection and every note in it are gone.
  //
  // What stays support-side is the change history — who reassigned the
  // incident, who moved it, when. That is the work record, not the customer's
  // conversation, and `firestore.rules` refuses `issues/{issueId}/audit` to the
  // client roles, so a client never opens a query those rules would only refuse.
  'access:audit_log': ['owner', 'admin', 'member'],
  'edit:comment': ['owner', 'admin', 'member', 'client_admin', 'client_member'], // Only on own comments
  'moderate:content': ['owner', 'admin'],       // Прибрати чужий коментар
};

/**
 * The roles an action is open to, for server routes that take an allow-list.
 * A route spelling its own list out is the drift this file exists to prevent.
 */
export function rolesFor(action) {
  return PERMISSIONS[action] || [];
}

/**
 * Checks if the given role is authorized to perform the action.
 * @param {string} role - owner, admin, member (internal agent), client_admin or client_member
 * @param {string} action - The action to check permission for
 * @returns {boolean} True if allowed, false otherwise
 */
export function can(role, action) {
  if (role === 'owner') return true; // Owner has full access
  if (!role) return false;
  return PERMISSIONS[action]?.includes(role) || false;
}

/**
 * The same question, asked while the role is still on its way.
 *
 * `can(null, action)` is `false`, and a screen that hides a control on `false`
 * cannot tell "you may not" from "we do not know yet". For an owner-only action
 * that conflation is harmless — hiding it a moment longer is the safe way to be
 * wrong. For an action every role in the workspace holds it is never anything
 * but wrong: the comment composer simply was not on the task screen until the
 * membership arrived, and the person waiting for it had no way to know whether
 * they were early or forbidden.
 *
 * So while the role is unknown this answers for the floor — the least any
 * member of this organization holds. Nobody who is in the workspace at all is
 * denied `create:comment`, so nobody is shown a control they will lose; and
 * `create:project`, which a member does not hold, still stays hidden until the
 * role proves otherwise. The write itself is authorized by Firestore rules and
 * the server routes either way; this decides only what is on screen.
 *
 * @param {string|null} role - The role, or null/undefined while it loads.
 * @param {string} action - The action to check permission for.
 * @returns {boolean} True if allowed, or still possible for any member.
 */
export function canWhileRoleLoads(role, action) {
  if (role) return can(role, action);
  return PERMISSIONS[action]?.includes('member') || false;
}
