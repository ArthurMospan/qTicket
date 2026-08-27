// The permission matrix and the routes that are supposed to describe it.
//
// `src/lib/utils/can.js` opens by saying what it is for: «A route spelling its
// own list out is the drift this file exists to prevent.» Three routes call
// `rolesFor()`. Thirty-seven write `['owner', 'admin']` in the argument list.
//
// That is not, today, a hole — the lists happen to agree with the matrix. It is
// the kind of thing that becomes a hole quietly: change `create:project` to
// include members and the button appears while the server still refuses, and
// nothing in the repository notices, because the two halves never look at each
// other. AGENTS.md already states the invariant — «A change to a Firestore rule
// or a route's `allowedRoles` updates the matrix in the same change» — and this
// is what asks for it.
//
// Rewriting all thirty-seven call sites was the other option and is the worse
// one: choosing which action each route means is a judgement, and a route
// labelled with the wrong action gives the right answer today and the wrong one
// after the next edit. A literal that is checked against the matrix is honest.
// A wrong name is not.

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

// And the ones where being wrong costs the most, named. A general rule cannot
// tell `['owner', 'admin']` meaning "may invoice" from `['owner', 'admin']`
// meaning "may invite"; these five say which is which, so that widening one of
// them cannot pass by resembling another.
const NAMED = [
  ['organizations/[organizationId]/route.js', 'transfer:ownership'],
  ['organizations/[organizationId]/members/[memberId]/route.js', 'manage:member_roles'],
  ['invoices/route.js', 'manage:finance'],
  ['invoices/[invoiceId]/void/route.js', 'manage:finance'],
  ['invitations/route.js', 'invite:client_member'],
];

test('ownership, roles, money and invitations authorise exactly what the matrix says', async () => {
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

// An API key is a digest, and there is no second way in.
//
// `isValidApiKey` carried a branch calling itself temporary — «until the
// private-key migration runs» — and the migration it named did not exist, so it
// was permanent. What it kept alive was a key stored as its own plaintext on
// `organizations/{orgId}`, which every member of that organization may read,
// granting whatever /api/v1 grants to whoever reads it. `npm run
// migrate:api-keys` reported zero of those in production, so the branch is gone
// rather than permanent twice over.
test('an API key authenticates only as a hash, never as a stored token', async () => {
  const source = await readFile(new URL('../src/lib/server/firebaseAdmin.js', import.meta.url), 'utf8');
  // Without the comments. What was removed is written down right above the
  // function, and prose describing a deleted branch is not that branch.
  const admin = source.split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');

  assert.doesNotMatch(admin, /key\.token === token/);
  assert.doesNotMatch(admin, /if \(key\.token\)/);
  // And the read no longer falls back to the member-readable organization
  // document, which is the place the keys were being moved off.
  assert.doesNotMatch(admin, /legacyOrgData/);
  assert.match(admin, /if \(!key\.tokenHash\) return false;/);
  assert.match(admin, /timingSafeEqual\(expected, candidate\)/);
});
