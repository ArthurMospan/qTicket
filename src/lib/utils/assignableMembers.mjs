import { activeMembers } from './orgMembership.mjs';
import { isClientRole } from './can.js';
import { assigneeIdsOf } from './incidentQueueMetrics.mjs';

// Who a request can be given to.
//
// One rule, and it was written out three times before this file existed: on a
// request's own page (correctly), in the assignee dialog that stops a move
// (correctly, after a fix), and in the bulk bar's «Відповідальні» selector,
// which listed the whole organization on every board. That last one is the same
// defect the other two had: offering somebody who is not on the project makes
// assigning them the side door into it, and an assignee who cannot open their
// own work is worse than no assignee at all.
//
// Three things the rule has to get right, all of them learned the hard way:
//
//   • **Active people only.** A colleague whose seat was switched off keeps
//     their name on everything they did — that is why the roster keeps them —
//     but you cannot hand new work to somebody who can no longer sign in.
//   • **The desk only.** `assigneeIds` is support's routing; a client role is
//     never written into it.
//   • **Every project of the selection.** A bulk action writes the same people
//     to all of it, so somebody on three projects of four cannot be made
//     answerable for the fourth. One request is that rule with a list of one.
//
// And two deliberate exceptions:
//
//   • A project with no recorded team is legacy data, not a project nobody may
//     be assigned to — it constrains nothing.
//   • Anyone already assigned stays on the list even if they have since left
//     the team, or they could never be un-assigned.

/**
 * The people this selection may be assigned to.
 *
 * @param {object[]} options.members The organization directory.
 * @param {object[]} options.issues The requests being acted on — one, or a whole selection.
 * @param {object[]} options.projects The projects those requests belong to, for their rosters.
 * @returns {object[]} Members, in the order the directory gave them.
 */
export function assignableMembersFor({ members = [], issues = [], projects = [] } = {}) {
  const desk = activeMembers(members).filter(member => !isClientRole(member.role));
  const scoped = (issues || []).filter(Boolean);
  if (scoped.length === 0) return desk;

  const projectIds = [...new Set(scoped.map(issue => issue.projectId).filter(Boolean))];
  const rosters = projectIds
    .map(projectId => (projects || []).find(project => project.id === projectId))
    .map(project => (Array.isArray(project?.team) ? new Set(project.team) : null))
    // A project whose team was never recorded constrains nothing.
    .filter(roster => roster && roster.size > 0);

  if (rosters.length === 0) return desk;

  const alreadyAssigned = new Set(scoped.flatMap(issue => assigneeIdsOf(issue)));
  return desk.filter(member => {
    const uid = member.id || member.uid;
    if (alreadyAssigned.has(uid)) return true;
    return rosters.every(roster => roster.has(uid));
  });
}
