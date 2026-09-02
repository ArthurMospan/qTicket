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
// The support side of the workspace: the seats QuickTeam provisions and the
// only ones a QuickTeam launch opens. Not a permission — a permission says what
// a role may do, and this says which roles are staff at all — so it is a role
// list rather than an entry in the matrix below.
export const INTERNAL_ROLES = ORGANIZATION_ROLES.filter(role => !CLIENT_ROLES.includes(role));

export function isClientRole(role) {
  return CLIENT_ROLES.includes(role);
}

/**
 * The seat an invitation may actually open, whatever its body asked for.
 *
 * A client administrator issues one seat and one only: `client_member`.
 *
 * Handing them the second administrator's seat was tried on 2026-09-02 and
 * withdrawn the same day, on the owner's reasoning — which is the right
 * reasoning and worth keeping written down. Granting a role is only half a
 * feature; the other half is taking it back, and qTicket has no screen that
 * demotes a client administrator, deliberately: the desk does not administer a
 * customer's people, and a customer's roster is not a place to put a role
 * editor. A one-way door is worse than a closed one — a customer who promoted
 * the wrong colleague would have had to phone their supplier, who would have
 * had to open a database.
 *
 * A second administrator is not refused, it is asked for: support seats one
 * from the client project's «Учасники», which is where a `client_admin` came
 * from in the first place. The dialog says so on the card it draws disabled.
 */
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
  'manage:team': ['owner', 'admin'],          // Запрошення, склад команди клієнта
  // A client administrator may invite a client member only, and only into a
  // project they already belong to. The invitation route enforces that project
  // scope and `invitedRoleFor` enforces the single role; this permission must
  // never be used as a substitute for `manage:team`.
  'invite:client_member': ['owner', 'admin', 'client_admin'],
  'manage:member_roles': ['owner', 'admin'],  // member ↔ admin, /api/organizations/[id]/members/[memberId]
  'deactivate:member': ['owner', 'admin'],    // Забрати доступ, лишивши дані

  // Money is not in this matrix. qTicket answers incidents; invoices, rates and
  // timesheets are not part of «клієнт написав → підтримка відповіла → закрили»
  // and have been deleted rather than gated, so there is no permission left to
  // describe.

  // The planning calendar is not in this matrix either. `access:calendar` said
  // owner/admin/member may reach `/api/calendar/*` long after that route and
  // every screen behind it were deleted — a permission nothing reads is a claim
  // nothing can test, and this one guarded an address that answers no request.
  // The last affordance that spoke to it, the three reply buttons on a calendar
  // invitation in the bell, went with it.

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
  // The record's own content, as opposed to the desk's handling of it.
  //
  // A customer files a звернення and then owns what they wrote: the subject,
  // the description, the attachments, what kind of problem it is, how urgent
  // they judge it, which labels it carries and what else it relates to. A typo
  // they cannot correct in their own request is not a safety property.
  //
  // What is missing from this entry is the whole of the difference between the
  // two sides of the desk: status, support's own assignees, the resolution
  // date, the archive and cancel stamps, hierarchy and deletion stay in
  // `edit:issue` above, which no client role holds. Content is written through
  // PATCH /api/issues/[issueId], which accepts these keys and no others —
  // `firestore.rules` still refuses a client's direct write, so the narrow list
  // is enforced by a route rather than by what the browser chose to send.
  'edit:issue_content': ['owner', 'admin', 'member', 'client_admin', 'client_member'],
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
