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
// `/overview` does.
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

export function isClientPortalRoute(pathname = '', clientProjectIds = [], role = null) {
  const path = String(pathname || '').trim();
  if (path === '/') return true;
  // «Огляд» is one screen that knows who is looking, so it is the client's
  // front screen as much as support's — and the front door at `/` sends them
  // here. If the product sends somebody somewhere, this list has to say so:
  // the paragraph above is the record of what happens when it does not.
  //
  // Admitted by exact name only. `/overview` stays a RESERVED_SEGMENT, so a
  // client space that happens to be called `overview` is still refused as a
  // space — the address opens the screen, never somebody's queue.
  if (path === '/overview' || path === '/overview/') return true;
  if (path === '/settings' || path.startsWith('/settings/')) return true;
  // The roster is one screen that knows who is looking, so the boundary in
  // front of it is where the two audiences are told apart. A `client_admin`
  // administers their own employees on «/team» — qTicket's own directory, and
  // the only client-side roster there is; a `client_member` has nobody to
  // administer and is sent back to the portal like any other internal address.
  // The answer lives here rather than in a guard inside the screen, because two
  // opinions about who may open an address is exactly how the two drift apart.
  if (path === '/team' || path === '/team/') return role === 'client_admin';
  // «Проєкти», and only for somebody who holds more than one.
  //
  // A client may be invited into several projects, and until that happened the
  // rail had one address to offer and the grid behind it was support's. It is
  // the same screen — `projects` is already scoped to what this account can
  // open, and every control on a card is behind a permission a client role does
  // not hold — so the boundary is the count, not a second copy of the screen.
  // One project needs no list: «Мої звернення» already points straight at it,
  // and a grid of one card is a page that says nothing.
  if (path === '/clients' || path === '/clients/') {
    return (Array.isArray(clientProjectIds) ? clientProjectIds : []).length > 1;
  }
  // A request opens from the portal and the page still enforces its exact scope.
  if (/^\/[^/]+\/issue\/[^/]+\/?$/.test(path)) return true;

  const ownSpace = /^\/([^/]+)\/?$/.exec(path);
  if (!ownSpace) return false;
  const segment = ownSpace[1];
  if (RESERVED_SEGMENTS.includes(segment)) return false;
  return (Array.isArray(clientProjectIds) ? clientProjectIds : []).includes(segment);
}
