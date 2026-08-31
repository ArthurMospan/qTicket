// Every address in the product, every role that can be sent to one, and what
// happens next.
//
// This file exists because 805 assertions missed a bug that made qTicket
// unopenable. `src/app/(app)/page.js` redirected a client from `/` into their
// own space, `/{projectId}`; `isClientPortalRoute` did not list that address,
// so the authenticated layout bounced them back to `/`, which redirected
// forward again. Both halves were correct read on their own, and both halves
// had tests — the tests read the two files' source text with regular
// expressions, and a regular expression cannot see a seam, because a seam is
// not in either file.
//
// So nothing here reads source. The redirects are declared as a graph, the
// guards are the product's own functions, and the walk asks the only question
// that catches this class: follow every redirect from every address for every
// role, and say where it stops. A destination that does not exist, a
// destination the far end refuses, and a pair that hands each other back and
// forth are three answers to that one question.
//
// The route table is checked against `src/app`, so a route deleted on disk and
// left in a menu — or added and never reasoned about — fails here first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';

import { can, isClientRole, ORGANIZATION_ROLES, rolesFor } from '../src/lib/utils/can.js';
import { isClientPortalRoute, RESERVED_SEGMENTS } from '../src/lib/utils/clientPortalRoutes.mjs';
import { buildCommands, issueCommands, searchCommands } from '../src/lib/utils/commandPalette.mjs';
import {
  normalizeNotificationLink,
  notificationDestination,
  withNotificationOrganization,
} from '../src/lib/utils/notificationNavigation.mjs';
import { getSafeAuthRedirect } from '../src/lib/utils/authRedirect.js';
import { routeTitle } from '../src/lib/utils/documentTitle.mjs';

// ── The table ────────────────────────────────────────────────────────────────
// One row per address the product serves. `zone` is which shell answers it:
// `app` is the authenticated workspace under `src/app/(app)`, whose layout
// carries the client boundary; `public` and `auth` have no such boundary; a
// `legacy` row has no page at all and exists only to be redirected away from.
//
// `sample` is the same address with its dynamic segments filled in, because a
// guard is a function of a real path and `[projectId]` is not one.
const SPACE = 'space-a';
const OTHER_SPACE = 'space-b';
const ISSUE = 'SUP-12';

const ROUTES = [
  // The authenticated workspace — the eight screens.
  { path: '/', sample: '/', zone: 'app' },
  { path: '/overview', sample: '/overview', zone: 'app' },
  { path: '/my', sample: '/my', zone: 'app' },
  { path: '/clients', sample: '/clients', zone: 'app' },
  { path: '/team', sample: '/team', zone: 'app' },
  { path: '/settings', sample: '/settings', zone: 'app' },
  { path: '/[projectId]', sample: `/${SPACE}`, zone: 'app' },
  { path: '/[projectId]/issue/[issueId]', sample: `/${SPACE}/issue/${ISSUE}`, zone: 'app' },

  // The way in.
  { path: '/login', sample: '/login', zone: 'auth' },
  { path: '/login/email', sample: '/login/email', zone: 'auth' },
  { path: '/login/quickteam', sample: '/login/quickteam', zone: 'auth' },
  { path: '/invite/[token]', sample: '/invite/abc123', zone: 'auth' },
  // Two doors that only forward. Old bookmarks and cached deployments still
  // name them, which is the whole reason they are still on disk.
  { path: '/register', sample: '/register', zone: 'auth' },
  { path: '/onboarding', sample: '/onboarding', zone: 'auth' },

  // Read by anybody, including somebody who is not signed in.
  { path: '/help', sample: '/help', zone: 'public' },
  { path: '/help/[slug]', sample: '/help/pochatok', zone: 'public' },
  { path: '/news', sample: '/news', zone: 'public' },
  { path: '/news/[slug]', sample: '/news/reliz', zone: 'public' },
  { path: '/terms', sample: '/terms', zone: 'public' },
  { path: '/privacy', sample: '/privacy', zone: 'public' },
  { path: '/privacy-policy', sample: '/privacy-policy', zone: 'public' },
  { path: '/offer', sample: '/offer', zone: 'public' },
  { path: '/errors', sample: '/errors', zone: 'public' },
  { path: '/ui-kit', sample: '/ui-kit', zone: 'public' },

  // No page behind these, and no product either: the analytics, calendar,
  // sprint and chat screens are deleted. `src/proxy.js` intercepts them so a
  // copied bookmark lands in the nearest supported workflow instead of on a
  // 404, and they are in this table so the walk proves that it still does.
  { path: '/analytics', sample: '/analytics', zone: 'legacy' },
  { path: '/calendar', sample: '/calendar', zone: 'legacy' },
  { path: '/calendar/event/[eventId]', sample: '/calendar/event/e1', zone: 'legacy' },
  { path: '/sprints', sample: '/sprints', zone: 'legacy' },
  { path: '/chat', sample: '/chat', zone: 'legacy' },
];

const ROUTE_BY_PATH = new Map(ROUTES.map(route => [route.path, route]));
const SAMPLES = ROUTES.map(route => route.sample);

// ── The redirect graph ───────────────────────────────────────────────────────
// Where each hop comes from, so a reader can check the model against the code:
//
//   proxy      src/proxy.js — LEGACY_WORKSPACE_DESTINATIONS
//   forward    src/app/register/page.js, src/app/onboarding/page.js
//   boundary   src/app/(app)/layout.js — clientRouteDenied
//   front-door src/app/(app)/page.js — the two role effects
//   screen     src/app/(app)/overview/page.js, src/app/(app)/my/page.js
//
// A hop is a pure function of the path and the session, which is what makes the
// walk below possible at all.
const LEGACY_DESTINATIONS = [
  { prefix: '/analytics', destination: '/overview' },
  { prefix: '/calendar', destination: '/overview' },
  { prefix: '/sprints', destination: '/my' },
  { prefix: '/chat', destination: '/my' },
];

const STATIC_FORWARDS = { '/register': '/login', '/onboarding': '/' };

function isAppPath(path) {
  if (path === '/') return true;
  const [segment] = path.replace(/^\//, '').split('/');
  if (!segment) return true;
  // Everything that is not a named screen outside the workspace is a client
  // space, which is an `(app)` address.
  const outside = ['login', 'register', 'onboarding', 'invite', 'errors', 'ui-kit',
    'help', 'news', 'offer', 'privacy', 'terms', 'privacy-policy', 'api'];
  if (outside.includes(segment)) return false;
  return !LEGACY_DESTINATIONS.some(entry => path === entry.prefix || path.startsWith(`${entry.prefix}/`));
}

/**
 * One hop, in the order the running product applies them. `null` means the
 * address is where this session stops.
 *
 * @param {string} path A concrete address, no query string.
 * @param {{role: string, spaces: string[], projectsLoading: boolean}} session
 */
function nextHop(path, session) {
  const legacy = LEGACY_DESTINATIONS.find(entry => (
    path === entry.prefix || path.startsWith(`${entry.prefix}/`)
  ));
  if (legacy) return legacy.destination;

  if (STATIC_FORWARDS[path]) return STATIC_FORWARDS[path];
  if (!isAppPath(path)) return null;

  const client = isClientRole(session.role);
  // The boundary. While the spaces are still arriving it denies nothing: the
  // list is empty then, and deciding on an empty list threw a client off their
  // own space on every refresh.
  if (client && !session.projectsLoading && !isClientPortalRoute(path, session.spaces, session.role)) return '/';

  if (path === '/') {
    if (!session.role) return null;
    if (!client) return '/overview';
    const space = session.spaces[0];
    return space ? `/${space}` : null;
  }

  // The screen-level guards, which the boundary above already shadows. They are
  // modelled anyway: two guards that disagree are only visible when both are.
  if (client && (path === '/overview' || path === '/my')) return '/';

  return null;
}

function walk(startPath, session, limit = 8) {
  const seen = [];
  let path = startPath;
  for (let hop = 0; hop <= limit; hop += 1) {
    if (seen.includes(path)) {
      return { terminal: path, trail: [...seen, path], cycle: true };
    }
    seen.push(path);
    const next = nextHop(path, session);
    if (!next) return { terminal: path, trail: seen, cycle: false };
    path = next;
  }
  return { terminal: path, trail: seen, cycle: true };
}

/** Does the far end let this role in? For a client that is the boundary itself. */
function admits(session, path) {
  if (!isAppPath(path)) return true;
  if (!isClientRole(session.role)) return true;
  return isClientPortalRoute(path, session.spaces, session.role);
}

const SESSIONS = ORGANIZATION_ROLES.map(role => ({
  role,
  spaces: [SPACE],
  projectsLoading: false,
}));

// ── The table is the product's, not this file's ──────────────────────────────

test('every route on disk is in the table, and every route in the table is real', async () => {
  const appRoot = new URL('../src/app/', import.meta.url);

  async function pageRoutes(dir = appRoot, prefix = '') {
    const entries = await readdir(dir, { withFileTypes: true });
    const found = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // A route group — `(app)`, `(public)` — is a folder that is not a path.
        const segment = /^\(.+\)$/.test(entry.name) ? '' : `/${entry.name}`;
        found.push(...await pageRoutes(new URL(`${entry.name}/`, dir), `${prefix}${segment}`));
      } else if (entry.name === 'page.js') {
        found.push(prefix || '/');
      }
    }
    return found;
  }

  const onDisk = (await pageRoutes()).sort();
  const declared = ROUTES.filter(route => route.zone !== 'legacy').map(route => route.path).sort();

  assert.deepEqual(declared, onDisk,
    'A route was added or deleted without being reasoned about here. Every address '
    + 'the product answers has to be in the table, because the walk below is only '
    + 'as complete as the table is.');

  // And the legacy rows are the reverse claim: no page, but still intercepted.
  for (const route of ROUTES.filter(entry => entry.zone === 'legacy')) {
    assert.equal(onDisk.includes(route.path), false, `${route.path} is deleted and must stay deleted`);
    assert.ok(nextHop(route.sample, SESSIONS[0]), `${route.path} must still redirect somewhere real`);
  }
});

// ── The walk ─────────────────────────────────────────────────────────────────

test('every role reaches a resting place from every address, and never a loop', () => {
  for (const session of SESSIONS) {
    for (const sample of SAMPLES) {
      const { terminal, trail, cycle } = walk(sample, session);
      assert.equal(cycle, false,
        `${session.role} at ${sample} never stops: ${trail.join(' → ')}`);
      assert.ok(ROUTE_BY_PATH.has(terminal) || SAMPLES.includes(terminal),
        `${session.role} at ${sample} stops at ${terminal}, which is not an address the product serves`);
      assert.equal(admits(session, terminal), true,
        `${session.role} is sent to ${terminal} and the guard there refuses them: ${trail.join(' → ')}`);
    }
  }
});

// The bug itself, named. A client's front door and the boundary in front of it
// have to agree about one address, and when they did not, every path a client
// could take ran between the two of them for ever.
test('a client opens the product: / is a door into their own space, and the door admits it', () => {
  const client = { role: 'client_admin', spaces: [SPACE], projectsLoading: false };

  assert.equal(nextHop('/', client), `/${SPACE}`, 'the front door sends a client into their space');
  assert.equal(isClientPortalRoute(`/${SPACE}`, [SPACE]), true, 'and the boundary lets them in');
  assert.equal(nextHop(`/${SPACE}`, client), null, 'so the space is where they stop');

  const { trail, cycle } = walk('/', client);
  assert.equal(cycle, false);
  assert.deepEqual(trail, ['/', `/${SPACE}`]);

  // Somebody else's space is refused at the same boundary, by id and not by the
  // shape of the address: `/overview` and `/{projectId}` look identical.
  assert.equal(isClientPortalRoute(`/${OTHER_SPACE}`, [SPACE]), false);
  assert.equal(walk(`/${OTHER_SPACE}`, client).terminal, `/${SPACE}`);
});

// The half of the loop that a boundary deciding too early would have restored.
test('a client whose spaces have not arrived yet is not thrown out of one', () => {
  const loading = { role: 'client_member', spaces: [], projectsLoading: true };
  assert.equal(nextHop(`/${SPACE}`, loading), null,
    'an empty space list is not proof that the space is not theirs');
  assert.equal(nextHop(`/${SPACE}/issue/${ISSUE}`, loading), null);

  // Once the list is genuinely empty and settled, the front door has nowhere to
  // send them and says so on `/` rather than redirecting into nothing.
  const settled = { role: 'client_member', spaces: [], projectsLoading: false };
  assert.equal(walk('/', settled).terminal, '/');
});

test('a screen guard and the boundary in front of it never disagree', () => {
  // Every screen that bounces a role away from itself, and the role it bounces.
  // The boundary must refuse the same address for the same role — a screen that
  // sends somebody away from a page the boundary would have admitted, or one
  // that admits somebody the boundary refuses, is the two of them arguing.
  const SCREEN_GUARDS = [
    { path: '/overview', bounces: isClientRole, to: '/' },
    { path: '/my', bounces: isClientRole, to: '/' },
  ];

  for (const guard of SCREEN_GUARDS) {
    assert.ok(ROUTE_BY_PATH.has(guard.path), `${guard.path} is not a route any more`);
    assert.ok(ROUTE_BY_PATH.has(guard.to), `${guard.path} bounces to ${guard.to}, which does not exist`);
    for (const session of SESSIONS) {
      const bounced = guard.bounces(session.role);
      assert.equal(
        admits(session, guard.path), !bounced,
        `${guard.path} ${bounced ? 'bounces' : 'admits'} ${session.role} while the boundary says the opposite`,
      );
    }
  }
});

// ── What the product actually hands people ───────────────────────────────────

function samplePathOf(href) {
  const path = String(href).split('?')[0].split('#')[0];
  return path === '' ? '/' : path;
}

test('every destination the command palette offers is a real address that answers the role', () => {
  const projects = [{ id: SPACE, name: 'Клієнт', status: 'active' }];

  for (const session of SESSIONS) {
    const commands = buildCommands({
      projects,
      allowedPermissions: ['create:project'].filter(permission => can(session.role, permission)),
      organizationCount: 2,
      role: session.role,
    });
    assert.ok(commands.length > 0, `${session.role} is offered nothing at all`);

    for (const command of commands) {
      if (!command.href) continue;
      const path = samplePathOf(command.href);
      assert.ok(SAMPLES.includes(path),
        `${session.role} is offered «${command.label}» → ${command.href}, which is not an address the product serves`);
      const { terminal, cycle, trail } = walk(path, session);
      assert.equal(cycle, false, `«${command.label}» loops for ${session.role}: ${trail.join(' → ')}`);
      assert.equal(admits(session, terminal), true,
        `${session.role} is offered «${command.label}» and the guard at ${terminal} refuses them`);
    }
  }
});

test('the composer door and the button in front of it ask the same permission', () => {
  // `/clients?new=1` is the second door into «Новий клієнт». The button asks
  // `create:project`; the address used to ask nothing, so a member who followed
  // it got a form the server was always going to refuse. One permission, both
  // doors — which is only checkable because the palette is data.
  const NEW_CLIENT_HREF = '/clients?new=1';
  const allowed = new Set(rolesFor('create:project'));

  for (const role of ORGANIZATION_ROLES) {
    const commands = buildCommands({
      projects: [],
      allowedPermissions: ['create:project'].filter(permission => can(role, permission)),
      organizationCount: 1,
      role,
    });
    const offered = commands.some(command => command.href === NEW_CLIENT_HREF);
    assert.equal(offered, allowed.has(role) || role === 'owner',
      `${role} is ${offered ? 'offered' : 'refused'} ${NEW_CLIENT_HREF} against what the matrix says`);
    assert.equal(offered, can(role, 'create:project'), `${role}: the menu and can() disagree`);
  }
});

test('a client is never offered an address the client boundary refuses', () => {
  for (const role of ['client_admin', 'client_member']) {
    const session = { role, spaces: [SPACE], projectsLoading: false };
    const commands = buildCommands({
      projects: [{ id: SPACE, name: 'Клієнт', status: 'active' }],
      allowedPermissions: [],
      organizationCount: 1,
      role,
    });
    for (const command of commands) {
      if (!command.href) continue;
      const path = samplePathOf(command.href);
      const { terminal } = walk(path, session);
      assert.equal(isClientPortalRoute(terminal, [SPACE], role), true,
        `«${command.label}» takes a ${role} to ${terminal}, which is not part of the portal`);
    }
    // And the internal screens are not quietly in the client's catalogue.
    // `/team` is the exception, and only for a `client_admin`: the roster is
    // one screen for both audiences now, and what a client administrator opens
    // there is their own employees. A `client_member` administers nobody, so
    // for them it is an internal screen like the other three.
    const hrefs = commands.map(command => command.href).filter(Boolean);
    const internalScreens = role === 'client_admin'
      ? ['/overview', '/my', '/clients']
      : ['/overview', '/my', '/clients', '/team'];
    for (const internal of internalScreens) {
      assert.equal(hrefs.includes(internal), false, `${role} is offered ${internal}`);
    }
    assert.equal(hrefs.includes('/team'), role === 'client_admin',
      `${role} is ${hrefs.includes('/team') ? 'offered' : 'refused'} the roster against what the boundary says`);
  }
});

// The duplicate door, closed. «Співробітники» in a client's rail used to open
// «Налаштування», where the settings rail named the same address a second time
// as «Співробітники клієнта». One roster screen now answers both audiences —
// which makes the boundary in front of it the only place that may say which
// client role opens it, and this is the walk that proves it does.
test('the roster admits a client administrator and returns a client employee to their portal', () => {
  const admin = { role: 'client_admin', spaces: [SPACE], projectsLoading: false };
  const employee = { role: 'client_member', spaces: [SPACE], projectsLoading: false };

  assert.equal(isClientPortalRoute('/team', [SPACE], 'client_admin'), true);
  assert.equal(isClientPortalRoute('/team', [SPACE], 'client_member'), false);
  // Asked without a role — every internal caller — the roster is a staff screen.
  assert.equal(isClientPortalRoute('/team', [SPACE]), false);

  assert.equal(nextHop('/team', admin), null, 'a client administrator stops on the roster');
  assert.deepEqual(walk('/team', employee).trail, ['/team', '/', `/${SPACE}`],
    'a client employee is returned to their own space, the way every other internal address returns them');
  assert.equal(walk('/team', employee).cycle, false);

  // And staff are untouched by any of it.
  for (const session of SESSIONS.filter(entry => !isClientRole(entry.role))) {
    assert.equal(walk('/team', session).terminal, '/team');
  }
});

test('a search result and an incident row lead to addresses that exist', () => {
  const projects = [{ id: SPACE, name: 'Клієнт', issuePrefix: 'SUP', status: 'active' }];
  const fromIssues = issueCommands(
    [{ id: 'doc1', title: 'Не працює пошта', issueKey: ISSUE, projectId: SPACE }],
    projects,
  );
  const fromSearch = searchCommands({
    people: [{ id: 'u1', name: 'Ірина', email: 'i@example.com' }],
    projects: [{ id: SPACE, name: 'Клієнт' }],
  });

  for (const command of [...fromIssues, ...fromSearch]) {
    const path = samplePathOf(command.href);
    assert.ok(SAMPLES.includes(path), `${command.href} is not an address the product serves`);
    for (const session of SESSIONS.filter(entry => !isClientRole(entry.role))) {
      const { cycle, terminal } = walk(path, session);
      assert.equal(cycle, false, `${command.href} loops for ${session.role}`);
      assert.equal(admits(session, terminal), true);
    }
  }
  // Deliberately not asserted: `/team?member=<id>` is offered for every person
  // the search answers with, and `/team` is the support roster — it filters the
  // client roles out, so a customer contact found by name lands on a list that
  // does not hold them. Making that link true means either putting customers in
  // the staff roster or teaching the search API to say who is staff; the first
  // is a boundary and the second is a server contract, so neither belongs in a
  // navigation pass. See the report that came with this commit.
});

test('a notification leads to the request it is about, for whoever receives it', () => {
  const NOTIFICATIONS = [
    { type: 'commented', projectId: SPACE, issueId: ISSUE, organizationId: 'org-1' },
    { type: 'assigned', projectId: SPACE, issueId: ISSUE, organizationId: 'org-1' },
    { type: 'status_changed', projectId: SPACE, organizationId: 'org-1' },
    { type: 'mentioned', link: `/${SPACE}/issue/${ISSUE}`, organizationId: 'org-1' },
  ];

  for (const notification of NOTIFICATIONS) {
    const destination = notificationDestination(notification);
    const path = samplePathOf(destination);
    assert.ok(SAMPLES.includes(path), `${destination} is not an address the product serves`);
    for (const session of SESSIONS) {
      const { cycle, terminal } = walk(path, session);
      assert.equal(cycle, false, `${destination} loops for ${session.role}`);
      assert.equal(admits(session, terminal), true,
        `${session.role} receives a notification for ${destination} and is refused at ${terminal}`);
    }
  }

  // A notification can only ever name an address inside the product, and the
  // three prefixes that are not a screen are refused outright.
  for (const blocked of ['/api/issues', '/login', '/oauth2/result', 'https://example.com/x', '//example.com']) {
    assert.equal(normalizeNotificationLink(blocked), '', `${blocked} must not be a notification destination`);
  }
});

// ── The way in ───────────────────────────────────────────────────────────────

test('every entry point lands somewhere the arriving role can open', () => {
  // Where each door puts somebody, and the file that decides it.
  //   /login?next=…       src/app/login/page.js → getSafeAuthRedirect
  //   /invite/[token]     src/app/invite/[token]/InviteLandingClient.jsx → '/'
  //   /login/quickteam    src/app/login/quickteam/page.js → returnTo || '/overview'
  //   /onboarding         src/app/onboarding/page.js → '/'
  const ARRIVALS = [
    { door: '/login', landing: getSafeAuthRedirect(null, '/') },
    { door: '/login?next=/overview', landing: getSafeAuthRedirect('/overview', '/') },
    { door: '/login?next=/my', landing: getSafeAuthRedirect('/my', '/') },
    { door: `/login?next=/${SPACE}/issue/${ISSUE}`, landing: getSafeAuthRedirect(`/${SPACE}/issue/${ISSUE}`, '/') },
    // A stale bookmark into a deleted screen is still a legal `next`; the proxy
    // is what makes it land somewhere, which the walk proves.
    { door: '/login?next=/analytics', landing: getSafeAuthRedirect('/analytics', '/') },
    { door: '/invite/[token]', landing: '/' },
    { door: '/onboarding', landing: '/' },
    { door: '/login/quickteam', landing: '/overview' },
  ];

  for (const arrival of ARRIVALS) {
    const path = samplePathOf(arrival.landing);
    assert.ok(SAMPLES.includes(path), `${arrival.door} lands on ${arrival.landing}, which does not exist`);
    for (const session of SESSIONS) {
      const { cycle, terminal, trail } = walk(path, session);
      assert.equal(cycle, false, `${arrival.door} loops for ${session.role}: ${trail.join(' → ')}`);
      assert.equal(admits(session, terminal), true,
        `${arrival.door} leaves a ${session.role} at ${terminal}, which refuses them`);
    }
  }

  // A sign-in may never be talked into bouncing back through itself.
  for (const hostile of ['/login', '/login/quickteam', '/api/auth/session', '/oauth2/result', 'https://evil.example/x']) {
    const landing = getSafeAuthRedirect(hostile, '/');
    assert.notEqual(landing, hostile, `${hostile} must not survive as a post-login destination`);
  }
});

test('a QuickTeam launch always names a destination, even when it names a refused one', () => {
  // `returnTo` is normalized by the contract to a same-origin path, which
  // `/login` and `/api/…` also are. `normalizeNotificationLink` then refuses
  // them and answers with an empty string — and `router.replace('')` is not a
  // navigation, it is the page you are already on. That page is a spinner.
  const ORG = 'org-1';
  const resolve = returnTo => (
    withNotificationOrganization(returnTo || '/overview', ORG)
    || withNotificationOrganization('/overview', ORG)
    || '/overview'
  );

  for (const returnTo of ['/overview', '/my', `/${SPACE}`, '', undefined, '/login', '/api/issues', '/oauth2/result']) {
    const destination = resolve(returnTo);
    assert.ok(destination, `a launch with returnTo=${String(returnTo)} resolved to nothing`);
    const path = samplePathOf(destination);
    assert.ok(SAMPLES.includes(path), `${destination} is not an address the product serves`);
    // The launch is a staff door: QuickTeam provisions internal seats only.
    for (const session of SESSIONS.filter(entry => !isClientRole(entry.role))) {
      assert.equal(walk(path, session).cycle, false);
    }
  }
});

// ── The two lists that decide what is a screen and what is a client ──────────

test('a client space can never be reached under the name of a screen', () => {
  for (const route of ROUTES) {
    if (route.zone === 'legacy') continue;
    const [segment] = route.path.replace(/^\//, '').split('/');
    if (!segment || segment.startsWith('[')) continue;
    assert.ok(RESERVED_SEGMENTS.includes(segment),
      `«${segment}» is a screen on disk but not a reserved segment: a client space named `
      + `«${segment}» would answer to its address`);
    // And the reservation holds even if a space were somehow given that id. The
    // exception is `/settings`, which is a portal address in its own right —
    // there the answer is «yes, open it», and what it opens is the screen.
    if (segment === 'settings') continue;
    // Asked as a space — no role, the way every id is checked — a screen's
    // name is never a space. `/team` answers `true` for a `client_admin`, and
    // that is the screen answering, not the id: the reservation above is what
    // stops a space from ever being called that.
    assert.equal(isClientPortalRoute(`/${segment}`, [segment]), false,
      `a space with the id «${segment}» must not be reachable under a screen's name`);
  }
});

test('every address the workspace serves has a name for its browser tab', () => {
  const projects = [{ id: SPACE, name: 'Клієнт' }];
  for (const route of ROUTES.filter(entry => entry.zone === 'app')) {
    for (const clientPortal of [false, true]) {
      const title = routeTitle(route.sample, projects, { clientPortal });
      assert.ok(title && title !== 'qTicket',
        `${route.sample} has no tab name${clientPortal ? ' for a client' : ''}`);
    }
  }
});

// ── Nothing in the graph points at what was deleted ──────────────────────────

test('no destination the product offers is a screen or an API that was deleted', () => {
  const DELETED = ['/chat', '/analytics', '/calendar', '/sprints'];
  const DELETED_APIS = ['/api/v1', '/api/timer', '/api/invoices', '/api/calendar', '/api/ai', '/api/chat'];

  const offered = [];
  for (const role of ORGANIZATION_ROLES) {
    for (const command of buildCommands({
      projects: [{ id: SPACE, name: 'Клієнт', status: 'active' }],
      allowedPermissions: ['create:project'],
      organizationCount: 2,
      role,
    })) {
      if (command.href) offered.push(command.href);
    }
  }
  offered.push(...ROUTES.filter(route => route.zone === 'app').map(route => route.sample));

  for (const href of offered) {
    for (const dead of [...DELETED, ...DELETED_APIS]) {
      assert.equal(href === dead || href.startsWith(`${dead}/`), false,
        `${href} points at ${dead}, which the product no longer has`);
    }
  }

  // The deleted screens keep exactly one job: forwarding a bookmark. If one of
  // them ever answers with a page again, this walk stops moving and says so.
  for (const dead of DELETED) {
    const { terminal, cycle } = walk(dead, SESSIONS[0]);
    assert.equal(cycle, false);
    assert.notEqual(terminal, dead, `${dead} is deleted and must not be a resting place`);
    assert.ok(ROUTE_BY_PATH.has(terminal));
  }
});
