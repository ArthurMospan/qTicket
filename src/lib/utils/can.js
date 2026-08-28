// src/lib/utils/can.js
// Role-Based Access Control (RBAC) permissions matrix
//
// One rule about this file: an entry describes what the product actually
// enforces, never what someone once meant it to enforce. Firestore rules and
// the server routes are authoritative; when they disagree with an entry here,
// the entry is the bug. Two entries have already drifted that way, so every
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

  // Sprints are not in this matrix. The permission that guarded creating,
  // starting and completing one was read by the planning screen and by nothing
  // else, and that screen is gone — an entry no call site reads is a claim
  // nothing tests. Stored `sprintId` values and the `sprints` collection rule
  // are untouched: the data is still somebody's history.

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

  // Finance
  //
  // Owner *and* admin, because that is what the product actually enforces:
  // `firestore.rules` lets an org admin read an invoice, `/api/invoices`
  // authorises `['owner', 'admin']`, and the analytics tab has always shown the
  // «Рахунок» section to both. This entry said `owner` alone and was never
  // called by anything — the screen rolled its own check — so the matrix
  // documented a restriction the product did not have. Rules are authoritative;
  // the matrix follows them.
  'manage:finance': ['owner', 'admin'], // Рахунки, ставки, чужі табелі

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

  // Comments and chat
  'create:comment': ['owner', 'admin', 'member', 'client_admin', 'client_member'],
  // The staff-only half of an incident. A public reply lives in `comments` and
  // is open to every participant of the project; an internal note lives in the
  // separately ruled `internalNotes` subcollection, beside the support-side
  // `audit` history. `firestore.rules` refuses both to the client roles, so a
  // client never opens a query those rules would only refuse.
  'access:internal_notes': ['owner', 'admin', 'member'],
  'edit:comment': ['owner', 'admin', 'member', 'client_admin', 'client_member'], // Only on own comments
  'moderate:content': ['owner', 'admin'],       // Прибрати чужий коментар або повідомлення
  'manage:channels': ['owner', 'admin'],        // Створити/видалити канал
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
