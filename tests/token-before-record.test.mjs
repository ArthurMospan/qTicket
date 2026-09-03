import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A route that has to read a record to learn which organization to authorize
// against verifies the caller's token *before* that read. The other order —
// read first, ask who is asking second — makes the read on behalf of nobody:
// an anonymous caller can ask for it at any rate they like, against a project
// on a daily read cap, and learn from 404-versus-401 which ids exist.
// `reminders/route.js` had this right and documented why; these are the
// routes that did not.

const ROUTES_THAT_READ_TO_AUTHORIZE = [
  'src/app/api/issues/[issueId]/route.js',
  'src/app/api/issues/[issueId]/status/route.js',
  'src/app/api/issues/[issueId]/archive/route.js',
  'src/app/api/issues/[issueId]/cancel/route.js',
  'src/app/api/issues/[issueId]/links/route.js',
  'src/app/api/issues/[issueId]/parent/route.js',
  'src/app/api/issues/[issueId]/quickteam-task/route.js',
  'src/app/api/projects/[projectId]/route.js',
  'src/app/api/projects/[projectId]/team/[memberId]/route.js',
];

const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every route that reads a record to find its organization verifies the token first', async () => {
  for (const path of ROUTES_THAT_READ_TO_AUTHORIZE) {
    const text = await source(path);
    const firstToken = text.indexOf('await authenticateRequest(request)');
    const firstRead = text.search(/\.doc\((issueId|projectId)\)[\s\S]{0,40}?\.get\(\)|await (issueRef|ref|projectRef)\.get\(\)/);
    assert.ok(firstToken !== -1, `${path} never verifies the token itself`);
    assert.ok(firstRead !== -1, `${path} reads no record — remove it from this table`);
    assert.ok(firstToken < firstRead, `${path} reads the record before verifying the token`);
    // The verified identity is handed on, so the token is checked once.
    assert.match(text, /authorizeOrgRequest\([\s\S]*?\{ identity \}/, `${path} verifies the token twice`);
  }
});

test('the shared authorizer accepts an identity a route already verified', async () => {
  const text = await source('src/lib/server/firebaseAdmin.js');
  assert.match(text, /export async function authorizeOrgRequest\(request, organizationId, allowedRoles = \[\], \{ identity \} = \{\}\)/);
  assert.match(text, /identity\?\.user \? identity : await authenticateRequest\(request\)/);
});

// «Створити завдання в QuickTeam» sends a request's title and description out
// of the desk. The role said the person may transfer at all; nothing said they
// may transfer *this* one, so any support seat could export any request in the
// organization by id. Now the project answers, the way it does for every
// sibling route.
test('a transfer to QuickTeam is refused off the request’s project', async () => {
  const text = await source('src/app/api/issues/[issueId]/quickteam-task/route.js');
  const access = text.indexOf('projectWriteError(');
  const transfer = text.indexOf('await createQuickTeamTask(');
  assert.ok(access !== -1 && transfer !== -1);
  assert.ok(access < transfer, 'the project is asked after the task was already created');
  assert.match(text, /authorization\.membership\?\.role,\s*authorization\.user\.uid,\s*\);\s*if \(projectAccessError\)/);
  assert.match(text, /transferError\(\s*'PROJECT_FORBIDDEN'/);
  assert.match(text, /enforceRateLimit\('quickteam-task', identity\.user\.uid/);
});

// The content PATCH turned its own refusals into 500s: `routeErrorResponse`
// takes an options object, and a string in its place left both the context and
// the message undefined, so a customer off their space never saw a 403.
test('the content PATCH answers its transaction refusals with their status', async () => {
  const text = await source('src/app/api/issues/[issueId]/route.js');
  assert.doesNotMatch(text, /routeErrorResponse\(error, '/);
  const patchCatch = text.slice(text.indexOf('export async function PATCH'), text.indexOf('export async function DELETE'));
  assert.match(patchCatch, /if \(error\?\.api\) \{[\s\S]*?status: error\.api\.status/);
  assert.match(patchCatch, /routeErrorResponse\(error, \{\s*context: 'Issue PATCH'/);
});

// The trash is a support screen: a title, a key and who deleted it are the
// desk's business, and a customer may not restore anything anyway.
test('the trash lists to the roles that may restore from it', async () => {
  const text = await source('src/app/api/issues/trash/route.js');
  assert.match(text, /authorizeOrgRequest\(request, organizationId, rolesFor\('delete:issue'\)\)/);
});

// Unlinking OneB used to clear a flag the login route never read — it resolves
// an account by `onebId` alone — so the «unlinked» OneB account kept signing in.
test('unlinking OneB removes the binding the login route resolves by', async () => {
  const [unlink, login] = await Promise.all([
    source('src/app/api/auth/oneb/unlink/route.js'),
    source('src/app/oauth2/result/route.js'),
  ]);
  assert.match(login, /\.where\('onebId', '==', profile\.accountId\)/);
  assert.match(unlink, /onebId: FieldValue\.delete\(\)/);
  assert.match(unlink, /onebConnected: false/);
});

// Every internal seat is QuickTeam-managed, so the only seat the role route
// could still change was a customer's — into `admin`, with every other
// customer's queue. Staff arrive through provisioning and nowhere else.
test('a client seat is never re-roled into a support seat', async () => {
  const text = await source('src/app/api/organizations/[organizationId]/members/[memberId]/route.js');
  const managed = text.indexOf("throw memberMutationError('QUICKTEAM_MANAGED'");
  const client = text.indexOf("if (action === 'role' && isClientRole(membership.role))");
  const write = text.indexOf("if (action === 'role') transaction.update(membershipRef, { role: body.role");
  assert.ok(managed !== -1 && client !== -1 && write !== -1);
  assert.ok(managed < client && client < write, 'the client-seat refusal must sit between the managed check and the write');
  assert.match(text, /memberMutationError\(\s*'CLIENT_SEAT',\s*409/);
});
