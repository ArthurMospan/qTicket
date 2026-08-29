// The permission matrix and the routes that are supposed to describe it.
//
// `src/lib/utils/can.js` opens by saying what it is for: «A route spelling its
// own list out is the drift this file exists to prevent.» Every route that
// authorizes a set of roles now names the permission — `rolesFor('edit:issue')`
// rather than `['owner', 'admin', 'member']` — so widening an entry widens the
// routes with it, in the one edit, and cannot leave a button that appears while
// the server still refuses. AGENTS.md states the invariant this holds up: «A
// change to a Firestore rule or a route's `allowedRoles` updates the matrix in
// the same change.»
//
// Naming the action is a judgement, and a route labelled with the wrong action
// gives the right answer today and the wrong one after the next edit — which is
// why the shape check below survives the rewrite rather than being replaced by
// it, and why the routes where being wrong costs the most are named one by one.
//
// One route still writes its list out, and it is listed here as what it is: no
// permission in the matrix describes editing an organization, because qTicket
// does not have that action — the route refuses every role with 409, since
// identity, ownership and staff belong to QuickTeam. Naming another permission
// there would be labelling a route with an action it does not enforce.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { PERMISSIONS, rolesFor } from '../src/lib/utils/can.js';

const API_ROOT = new URL('../src/app/api/', import.meta.url);

async function routeFiles(dir = API_ROOT, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      found.push(...await routeFiles(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`));
    } else if (entry.name === 'route.js') {
      found.push({ path: `${prefix}route.js`, source: await readFile(new URL(entry.name, dir), 'utf8') });
    }
  }
  return found;
}

// Every `authorizeOrgRequest(…, [ … ])` in a file, as a sorted role list. The
// call is written across several lines in about half the routes, so this reads
// the whole argument list rather than one line of it.
function roleListsIn(source) {
  const lists = [];
  for (const call of source.matchAll(/authorizeOrgRequest\(\s*([^;]*?)\)\s*;/gs)) {
    const literal = /\[([^\]]*)\]/.exec(call[1]);
    if (literal) {
      lists.push([...literal[1].matchAll(/'([a-z_]+)'/g)].map(match => match[1]).sort());
      continue;
    }
    const permission = /rolesFor\('([^']+)'\)/.exec(call[1]);
    if (permission) lists.push([...rolesFor(permission[1])].sort());
    // No list and no rolesFor() means "any member", which is not a claim.
  }
  return lists;
}

const key = roles => [...roles].sort().join('+');
const MATRIX_SHAPES = new Set(Object.values(PERMISSIONS).map(key));

test('no route authorises a set of roles the matrix does not describe', async () => {
  const offenders = [];
  for (const { path, source } of await routeFiles()) {
    for (const roles of roleListsIn(source)) {
      if (!MATRIX_SHAPES.has(key(roles))) offenders.push(`${path}: [${roles.join(', ')}]`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'a route allows a combination of roles no permission in can.js grants. '
    + 'Either the route is wrong, or the matrix has not been updated with it — '
    + 'AGENTS.md requires the second to happen in the same change as the first.',
  );
});

// The routes allowed to spell a list out, and why. Anything else must name a
// permission — that is the whole point of the matrix.
const LITERAL_LIST_ROUTES = new Set([
  // No `edit:organization` exists: the route answers 409 QUICKTEAM_MANAGED to
  // owner and admin alike, so there is no action for it to name.
  'organizations/[organizationId]/route.js',
]);

test('a route names the permission it enforces instead of listing roles', async () => {
  const offenders = [];
  for (const { path, source } of await routeFiles()) {
    if (LITERAL_LIST_ROUTES.has(path)) continue;
    for (const call of source.matchAll(/authorizeOrgRequest\(\s*([^;]*?)\)\s*;/gs)) {
      if (/\[([^\]]*)\]/.test(call[1])) offenders.push(path);
    }
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    'these routes authorize a hand-written role list. Call rolesFor(action) so '
    + 'that changing the matrix changes the route in the same edit.',
  );
});

// And the ones where being wrong costs the most, named. A general rule cannot
// tell `['owner', 'admin']` meaning "may change a member's role" from
// `['owner', 'admin']` meaning "may invite"; these two say which is which, so
// that widening one of them cannot pass by resembling the other.
const NAMED = [
  ['organizations/[organizationId]/members/[memberId]/route.js', 'manage:member_roles'],
  ['invitations/route.js', 'invite:client_member'],
];

test('roles and invitations authorise exactly what the matrix says', async () => {
  const files = new Map((await routeFiles()).map(file => [file.path, file.source]));
  for (const [path, action] of NAMED) {
    const source = files.get(path);
    assert.ok(source, `missing route ${path}`);
    const lists = roleListsIn(source);
    assert.ok(lists.length > 0, `${path} authorises without naming roles`);
    for (const roles of lists) {
      assert.deepEqual(
        roles,
        [...rolesFor(action)].sort(),
        `${path} no longer matches ${action}`,
      );
    }
  }
});

// The matrix may not quietly grow an entry nothing enforces. Every permission
// is either read by a screen (to decide what is on it) or by a route (to decide
// what is allowed); an entry read by neither is the claim AGENTS.md calls a bug.
test('every permission in the matrix is read by something', async () => {
  const sources = [];
  for (const dir of ['src', 'tests']) {
    const stack = [new URL(`../${dir}/`, import.meta.url)];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (entry.isDirectory()) stack.push(new URL(`${entry.name}/`, current));
        else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
          sources.push(await readFile(new URL(entry.name, current), 'utf8'));
        }
      }
    }
  }
  const corpus = sources.join('\n');
  const unread = Object.keys(PERMISSIONS).filter(action => {
    // The declaration in can.js is one of these occurrences, so a permission
    // with a single genuine reader appears twice. Fewer than that is an entry
    // nothing asks.
    const uses = corpus.split(`'${action}'`).length - 1;
    return uses < 2;
  });
  assert.deepEqual(unread, [], 'these permissions are declared and never asked');
});

