import { isClientRole } from './can.js';

/**
 * Who hears about a new request.
 *
 * The support staff on this customer's own space — whoever is actually running
 * this account, and nobody who runs a different one. Client roles on the roster
 * are not recipients: a customer's colleague filing a request is not an event
 * for the rest of that customer's staff, and telling them would put one
 * customer's internal traffic into another person's bell.
 *
 * `fallbackAdminIds` covers the one case that would otherwise re-create the very
 * defect this exists to fix — a client space with no support staff assigned to
 * it yet. The owner deliberately chose "this client's support team" over
 * "always every owner and admin", and this is not that: it is the difference
 * between a narrow audience and no audience, and a request nobody is told about
 * is the bug whatever the reason for it.
 *
 * A uid on the roster with no role resolved is dropped rather than trusted. That
 * is somebody removed from the organization whose uid the project still lists,
 * and `project.team` is deliberately never rewritten to tidy up after a person.
 *
 * @param {string[]} projectTeam Uids on the client space's roster.
 * @param {Map<string, string|null>} roleByUid Organization role for each of them.
 * @param {string} actorId Whoever filed it; never told about their own action.
 * @param {string[]} fallbackAdminIds Owners and admins, used only when the roster names no support staff.
 * @returns {string[]} Uids to notify, in roster order, without duplicates.
 */
export function incidentAnnouncementRecipients({
  projectTeam = [],
  roleByUid = new Map(),
  actorId = '',
  fallbackAdminIds = [],
} = {}) {
  const support = [...new Set(projectTeam)].filter(uid => {
    if (!uid || uid === actorId) return false;
    const role = roleByUid.get(uid);
    return Boolean(role) && !isClientRole(role);
  });
  if (support.length) return support;
  return [...new Set(fallbackAdminIds)].filter(uid => uid && uid !== actorId);
}

/**
 * The bell's heading for one. The customer's name is the useful half: an agent
 * reading the bell wants to know whose desk this landed on before they want the
 * subject line, which is the body.
 */
export function incidentAnnouncementTitle({ projectName = '', issueKey = '' } = {}) {
  const heading = projectName ? `нове звернення від «${projectName}»` : 'нове звернення';
  if (issueKey) return `${issueKey}: ${heading}`;
  return heading.charAt(0).toUpperCase() + heading.slice(1);
}
