// The external client has a portal, not a smaller copy of the staff workspace.
// Keep this route boundary pure so the authenticated layout and its regression
// tests ask exactly the same question.
//
// Their own space is on the list, and that is the part worth reading twice.
// `/{projectId}` and `/overview` are the same shape, so a shape test would have
// opened the staff queue to a customer. The check is therefore against the ids
// the client actually holds — the layout passes the spaces their own
// `useProjects` stream returned, which is already scoped by `project.team` and
// by the rules behind it. An id that is not theirs fails here exactly as
// `/team` does.
//
// This is also why the boundary is not merely cosmetic bookkeeping: for one
// commit the portal redirected a client from `/` into `/{projectId}` while this
// file still refused that address, so the layout bounced them back to `/` and
// the portal bounced them forward again. A client could not open qTicket at
// all. Menu visibility is not an access boundary, and neither is a redirect: if
// the product sends somebody somewhere, this list has to say so.

// Paths that name a screen rather than a client space. A space can never be
// reached under one of these names, whatever its id happens to be.
//
// Exported because the workspace header asks the same question — "is this first
// segment a screen or a client id?" — to decide whether to draw a client's
// name. It kept its own copy of the answer, and the copy had already drifted:
// it still named `calendar`, a screen deleted with the planning calendar, and
// had never heard of half the addresses listed here. One question, one list.
export const RESERVED_SEGMENTS = Object.freeze([
  'overview', 'my', 'team', 'clients', 'settings',
  'login', 'register', 'onboarding', 'invite', 'errors', 'ui-kit',
  'help', 'news', 'offer', 'privacy', 'terms', 'privacy-policy', 'api',
]);

export function isClientPortalRoute(pathname = '', clientProjectIds = []) {
  const path = String(pathname || '').trim();
  if (path === '/') return true;
  if (path === '/settings' || path.startsWith('/settings/')) return true;
  // A request opens from the portal and the page still enforces its exact scope.
  if (/^\/[^/]+\/issue\/[^/]+\/?$/.test(path)) return true;

  const ownSpace = /^\/([^/]+)\/?$/.exec(path);
  if (!ownSpace) return false;
  const segment = ownSpace[1];
  if (RESERVED_SEGMENTS.includes(segment)) return false;
  return (Array.isArray(clientProjectIds) ? clientProjectIds : []).includes(segment);
}
