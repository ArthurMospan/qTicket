export const QUICKTEAM_MANAGED_MESSAGE = 'Ця команда керується в QuickTeam';

export function isQuickTeamManagedOrganization(organization) {
  return Boolean(organization?.quickTeam?.sourceOrganizationId);
}

export function hasActiveQuickTeamEntitlement(organization) {
  return isQuickTeamManagedOrganization(organization)
    && organization.quickTeam.entitlement === 'active';
}

export function isQuickTeamManagedMembership(membership) {
  return membership?.managedBy === 'quickteam';
}

/**
 * Whether a signed snapshot may bring an organization into existence here.
 *
 * qTicket is an add-on, and a person may belong to any number of QuickTeam
 * organizations that never bought it. None of them is a qTicket workspace, and
 * none of them may leave a trace here — a seat in `orgMemberships` is what puts
 * an organization in the switcher, and nothing ever takes it back out.
 *
 * `inactive` is a suspension, and a suspension presupposes something to
 * suspend: the contract deliberately keeps a suspended organization whole, with
 * its incidents and its history, so that a later active snapshot restores the
 * same support space. A *first* snapshot that is already inactive is not that.
 * It describes an organization that was never a customer, and provisioning it
 * wrote an organization nobody can open plus a seat for every member of staff —
 * permanently, because the same rule that preserves a suspension also preserves
 * this. Rules and `authorizeOrgRequest` then refuse every read of it, so the
 * workspace opened onto its own errors.
 */
export function quickTeamSnapshotOpensOrganization({
  organizationExists = false,
  entitlement = 'inactive',
} = {}) {
  return Boolean(organizationExists) || entitlement === 'active';
}
