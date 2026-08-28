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
