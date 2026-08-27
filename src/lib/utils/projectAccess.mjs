// src/lib/utils/projectAccess.mjs
// Who may act inside a project, decided in one place.
//
// There are two different questions about a person and a project, and this
// module keeps them apart because the workspace once answered them with the
// same sentence and got a wrong screen out of it.
//
//   Access — may they open it?  `project.team` OR an owner/admin role.
//   Roster — are they on it?    `project.team`, and nothing else.
//
// Access is the visibility gate of the whole workspace: an owner or an admin
// reaches every project of the organization, everyone else reaches the projects
// they were added to. The same sentence is written three times over — in
// `firestore.rules` (`canAccessProject`), in the server routes that create,
// delete and bulk-edit issues, and in the page loader behind `/[projectId]`.
// This module is the copy the server routes share, so that adding a route
// cannot quietly invent a fourth interpretation.
//
// The roster is what the product *shows*: the faces on a project card, the
// «Команда» tab, who a picker offers. Conflating it with access made an admin
// assigned a task in a project invisible on that project's card — the grant
// step skipped them (correctly: they already had access) and so nothing ever
// recorded that they work there. Access is a permission; the roster is a fact
// about who is on the project, and an admin is not automatically on every one.

export function isPrivilegedRole(role) {
  return role === 'owner' || role === 'admin';
}

/** Does this person reach the project's contents at all? */
export function hasProjectAccess(project, role, uid) {
  if (!project) return false;
  if (isPrivilegedRole(role)) return true;
  return Array.isArray(project.team) && project.team.includes(uid);
}

/**
 * A project the plan's ceiling no longer has room for.
 *
 * Set by the plan switch, on the projects created most recently — the only
 * ordering somebody can predict. It is read-only, not gone: everything in it
 * opens, prints and reports exactly as before, and the flag is cleared the
 * moment the plan goes back up.
 */
export const PROJECT_OVER_PLAN_LIMIT = 'Проєкт понад ліміт тарифу — доступний лише для читання. Підніміть тариф або заархівуйте інший проєкт.';

/**
 * The localized reason a project cannot be written to, or '' when it can.
 * Order matters: "not found" and "being deleted" are facts about the project
 * and must not be reported as a permission problem — and being over the plan's
 * ceiling is a third kind of fact again, about the workspace rather than about
 * the person, so it is answered after access and never instead of it.
 */
export function projectWriteError(project, organizationId, role, uid) {
  if (!project || project.organizationId !== organizationId) return 'Проєкт задачі не знайдено';
  if (project.deletionPending === true) return 'Проєкт уже видаляється';
  if (!hasProjectAccess(project, role, uid)) return 'Ви не входите до команди цього проєкту';
  if (project.overPlanLimit === true) return PROJECT_OVER_PLAN_LIMIT;
  return '';
}

/**
 * A project whose team was never recorded is legacy data, not a project nobody
 * belongs to. Every reader of `team` has to make that distinction or it starts
 * refusing writes on the oldest projects in the workspace.
 */
export function hasRecordedTeam(project) {
  return Array.isArray(project?.team);
}

/**
 * The assignees who could not open the task being handed to them.
 *
 * A task's assignee has to be able to reach its project — otherwise the task is
 * not work assigned to somebody, it is a note about them. The workspace could
 * produce exactly that: «Команда» → a member → «Створити завдання» offers every
 * project, the composer offered the whole organization as assignees, and the
 * server only ever checked that an assignee was in the organization. The result
 * was a task its own assignee could not find, whose avatar the board then
 * dropped silently because the card resolves faces from the project's team.
 *
 * This is the *access* question, so an owner or an admin never appears here.
 * Whether they belong on the project's roster is `assigneesOffProjectTeam`.
 *
 * @param {object} project The project the task lives in.
 * @param {string[]} assigneeIds The people being assigned.
 * @param {(uid: string) => string|null} roleOf Their role in the organization.
 * @returns {string[]} The subset that cannot reach the project at all.
 */
export function assigneesOutsideProject(project, assigneeIds, roleOf) {
  if (!hasRecordedTeam(project)) return [];
  return [...new Set(assigneeIds || [])].filter(
    uid => uid && !hasProjectAccess(project, roleOf(uid), uid),
  );
}

/** Is this person recorded on the project, whatever their role would let them reach? */
export function isOnProjectTeam(project, uid) {
  return Boolean(uid) && Array.isArray(project?.team) && project.team.includes(uid);
}

/**
 * The assignees the project's roster does not name — the *roster* question.
 *
 * A superset of `assigneesOutsideProject`: it also names the owners and admins
 * who reach the project by role without being on it. They are not locked out of
 * anything, but nothing records that they work here either, so the card draws no
 * face for them and the «Команда» tab does not list them. That is the shape of
 * the bug this exists for — an admin with a task in a project that shows an
 * empty seat where they should be.
 *
 * @param {object} project The project the task lives in.
 * @param {string[]} assigneeIds The people being assigned.
 * @returns {string[]} The subset missing from `project.team`.
 */
export function assigneesOffProjectTeam(project, assigneeIds) {
  if (!hasRecordedTeam(project)) return [];
  return [...new Set(assigneeIds || [])].filter(uid => uid && !isOnProjectTeam(project, uid));
}
