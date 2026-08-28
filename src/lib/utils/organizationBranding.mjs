// The organization identity shown to an external qTicket client.
//
// qTicket is provisioned from QuickTeam eventually, but it keeps its own
// database and session.  That integration writes a snapshot under
// `portalBranding`; the portal never reaches into QuickTeam's Firebase data at
// render time.  Existing standalone qTicket organizations predate that field,
// so their ordinary name/logo/sidebar settings remain the fallback.

import { SIDEBAR_PRESETS } from './sidebarTheme';

const cleanText = (value, fallback = '') => (
  typeof value === 'string' && value.trim() ? value.trim() : fallback
);

const PORTAL_THEMES = new Set(['dark', 'light', 'custom']);

export function resolveOrganizationPortalBrand(organization = null) {
  const portalBranding = organization?.portalBranding || {};
  const name = cleanText(
    portalBranding.name,
    cleanText(organization?.name, 'Підтримка'),
  );
  const logo = cleanText(
    portalBranding.logo,
    cleanText(organization?.logo || organization?.logoUrl),
  );
  const requestedTheme = cleanText(
    portalBranding.sidebarTheme,
    cleanText(organization?.sidebarTheme, 'dark'),
  );
  const sidebarTheme = PORTAL_THEMES.has(requestedTheme) ? requestedTheme : 'dark';
  const sidebarColor = cleanText(
    portalBranding.sidebarColor,
    cleanText(organization?.sidebarColor),
  );

  return {
    name,
    logo,
    sidebarTheme,
    sidebarColor,
    source: portalBranding.source === 'quickteam' ? 'quickteam' : 'qticket',
  };
}

export function organizationPortalName(organization) {
  return resolveOrganizationPortalBrand(organization).name;
}

/**
 * The colour a client surface is painted in, from the brand above.
 *
 * The sidebar worked this out inline, and the invitation landing page needs the
 * same answer before anybody has signed in — one tenant, two screens, and a
 * second copy of the ternary is how the rail and the front door would end up
 * two different shades of the same company.
 *
 * @param {{sidebarTheme: string, sidebarColor: string}} brand From `resolveOrganizationPortalBrand`.
 * @returns {string} A HEX colour to hand `computeSidebarTheme`.
 */
export function organizationPortalBackground(brand) {
  if (brand?.sidebarTheme === 'light') return SIDEBAR_PRESETS.light;
  if (brand?.sidebarTheme === 'custom') return brand.sidebarColor || SIDEBAR_PRESETS.dark;
  return SIDEBAR_PRESETS.dark;
}
