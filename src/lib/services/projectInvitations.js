// src/lib/services/projectInvitations.js
// Sending the inline invite list that both project dialogs collect.
//
// Kept out of the dialogs because they had drifted: creating a project sent its
// invitations one by one and reported the failures, editing one could not send
// any at all. One function means one behaviour, whichever dialog is open.

/**
 * Invite every address into the organization, pre-assigned to a project.
 *
 * Sent one at a time on purpose: the server rate-limits invitations, and a
 * failure has to name the address it belongs to. A single bad address must not
 * abandon the rest of the list.
 *
 * @param {(email: string, invitedBy: null, role: string, projectIds: string[]) => Promise<{ emailSent?: boolean }>} inviteMember
 * @param {{ emails: string[], projectId: string, role?: string }} options
 * @returns {Promise<{ invited: string[], undelivered: string[], failures: { email: string, message: string }[] }>}
 */
export async function sendProjectInvitations(inviteMember, { emails, projectId, role = 'member' }) {
  const invited = [];
  const undelivered = [];
  const failures = [];

  for (const email of emails) {
    try {
      const result = await inviteMember(email, null, role, projectId ? [projectId] : []);
      invited.push(email);
      // The invitation exists either way; `emailSent: false` means only that no
      // letter left. Reporting it is the difference between "email invites are
      // broken" and a product that says the mail provider is not configured.
      if (result?.emailSent === false && result?.type !== 'added_directly') undelivered.push(email);
    } catch (error) {
      failures.push({ email, message: error?.message || 'невідома помилка' });
    }
  }

  return { invited, undelivered, failures };
}
