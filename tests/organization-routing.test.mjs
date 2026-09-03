import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  organizationLoadErrorKind,
  organizationLoadRetryDelay,
  shouldRetryOrganizationLoad,
} from '../src/lib/utils/organizationLoadErrors.mjs';
import {
  buildOrganizationList,
  createMembershipSnapshotGate,
  organizationMembershipSignature,
  parseOrganizationDirectory,
} from '../src/lib/utils/organizationList.mjs';
import { firestoreDocumentData } from '../src/lib/utils/firestoreDocument.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('each browser tab owns its organization selection and keeps it in the URL', async () => {
  const [context, guard, switcher] = await Promise.all([
    read('../src/lib/context/OrgContext.js'),
    read('../src/components/WorkspaceOrganizationRouteGuard.jsx'),
    read('../src/components/OrgSwitcherScreen.jsx'),
  ]);

  assert.match(context, /sessionStorage\.setItem\(TAB_STORAGE_KEY, orgId\)/);
  assert.match(context, /sessionStorage\.getItem\(TAB_STORAGE_KEY\)/);
  assert.doesNotMatch(context, /localStorage\.(?:getItem|setItem)\(TAB_STORAGE_KEY/);
  assert.match(context, /window\.history\.replaceState\(null, '', scoped\)/);
  assert.match(guard, /withNotificationOrganization\(current, activeOrgId\)/);
  // A click must navigate to the organization it selected. A bare `/` races
  // the state update and lets the guard restore the previous organization.
  assert.match(switcher, /sessionStorage\.setItem\('qt_active_org_id', org\.id\)/);
  assert.match(switcher, /router\.push\(withNotificationOrganization\('\/', org\.id\)\)/);
  assert.doesNotMatch(switcher, /switchOrg\(org\.id\)/);
  assert.doesNotMatch(switcher, /router\.push\('\/'\)/);
});

test('project and issue routes derive organization scope from the project resource', async () => {
  const [access, projectPage, issuePage, projectClient] = await Promise.all([
    read('../src/lib/server/workspaceProjectAccess.js'),
    read('../src/app/(app)/[projectId]/page.js'),
    read('../src/app/(app)/[projectId]/issue/[issueId]/page.js'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
  ]);

  assert.match(access, /collection\('projects'\)\.doc\(cleanProjectId\)\.get\(\)/);
  assert.match(access, /if \(!projectSnapshot\.exists\) notFound\(\)/);
  assert.match(access, /doc\(`\$\{organizationId\}_\$\{user\.uid\}`\)/);
  assert.match(access, /if \(!privileged && !onProjectTeam\) notFound\(\)/);
  for (const route of [projectPage, issuePage]) {
    assert.match(route, /readWorkspaceProjectAccess\(projectId\)/);
    assert.match(route, /query\?\.org !== access\.organizationId/);
    assert.match(route, /redirect\(withNotificationOrganization/);
  }
  assert.match(projectClient, /resourceOrganizationId !== activeOrgId/);
  assert.match(projectClient, /switchOrg\(resourceOrganizationId\)/);
  assert.match(projectClient, /if \(!project\)/);
});

test('a denied read is retried before it is called a loss of access', async () => {
  assert.equal(organizationLoadErrorKind({ code: 'permission-denied' }), 'permission-denied');
  assert.equal(organizationLoadErrorKind({ code: 'not-found' }), 'not-found');
  assert.equal(organizationLoadErrorKind({ code: 'unavailable' }), 'retryable');
  // Signing out and back in swaps the credential under listeners that are
  // already attached, and the first snapshot across that swap comes back
  // denied. Believing it on sight put a person who had just logged in on
  // «Немає доступу до організації», so the denial is retried on the same
  // bounded budget as a network failure. An organization that is genuinely
  // gone is still terminal — nothing is going to make it reappear.
  assert.equal(shouldRetryOrganizationLoad({ code: 'permission-denied' }), true);
  assert.equal(shouldRetryOrganizationLoad({ code: 'unavailable' }), true);
  assert.equal(shouldRetryOrganizationLoad({ code: 'not-found' }), false);
  assert.deepEqual([1, 2, 3].map(organizationLoadRetryDelay), [250, 750, 1_500]);

  const [context, layout, issueDetail] = await Promise.all([
    read('../src/lib/context/OrgContext.js'),
    read('../src/app/(app)/layout.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
  ]);
  assert.match(context, /retryAttempt < ORG_LOAD_RETRY_LIMIT/);
  assert.match(context, /window\.setTimeout\(subscribe, organizationLoadRetryDelay\(retryAttempt\)\)/);
  // The retry goes back out with a token that belongs to the account that is
  // signed in now, not the one that was rejected.
  assert.match(context, /auth\.currentUser\?\.getIdToken\(true\)/);
  // And the card that survives all of that still offers a way off itself. It is
  // one component for all three failures now — a stalled load, a refused read
  // and a denied organization used to be three cards that could disagree about
  // what had happened.
  assert.match(layout, /function WorkspaceLoadFailure\(/);
  assert.match(layout, /accessFailure && !quotaSpent \? \([\s\S]*Увійти іншим акаунтом/);
  assert.match(issueDetail, /!issueAccessFailure && \([\s\S]*Спробувати ще раз/);
});

// A stale membership snapshot must not be able to hide a workspace.
//
// The handler is async: it takes a snapshot of `orgMemberships` and then goes
// back to Firestore for the organization documents. Snapshots arrive in pairs —
// Firestore's persistent cache answers first, the server a moment later — and
// the two need not agree, because a browser whose cache never held one of the
// memberships emits the shorter list first. Both fetches were then in flight at
// once and whichever returned last won, so a cached snapshot that lost the race
// by a millisecond removed a workspace the person owns from the switcher, and
// it stayed removed until a membership changed. Reloading was a coin toss, and
// another account with a cold cache looked perfectly healthy.
//
// Snapshots are numbered inside their source class, and a server snapshot has
// priority over every cached one. Arrival order alone cannot establish that:
// a delayed cache callback is still cache even when it happens to arrive last.
test('an organization list published late cannot overwrite a newer one', async () => {
  const context = await read('../src/lib/context/OrgContext.js');

  const gate = createMembershipSnapshotGate();
  const cachedFirst = gate.begin(false);
  const serverSecond = gate.begin(true);
  assert.equal(cachedFirst.isCurrent(), false);
  assert.equal(serverSecond.isCurrent(), true);

  // Arrival after a server read started cannot make a cache result authoritative.
  assert.equal(gate.begin(false), null);

  // Two real server refreshes can race too; the newest one wins among equals.
  const newerServer = gate.begin(true);
  assert.equal(serverSecond.isCurrent(), false);
  assert.equal(newerServer.isCurrent(), true);

  assert.match(context, /const membershipSnapshotGate = createMembershipSnapshotGate\(\);/);
  assert.match(context, /const snapshotTicket = membershipSnapshotGate\.begin\(authoritative\);/);
  assert.match(context, /const current = \(\) => !cancelled && snapshotTicket\.isCurrent\(\);/);
  // The publish is guarded, not merely the unmount.
  assert.match(
    context,
    /if \(!current\(\)\) return;\s*\n\s*if \(authoritative\) \{[\s\S]*hasVerifiedDirectory = true;[\s\S]*setOrgDirectoryVerified\(true\);[\s\S]*\}\s*\n\s*publishedOrgs = organizations;\s*\n\s*setOrgError\(null\);\s*\n\s*setAllOrgs\(organizations\);/,
  );

  // A non-empty but short cache is still provisional. It cannot select a
  // different workspace in place of the org this tab explicitly requested.
  assert.match(context, /const requestedOrganization = requested && organizations\.find\(o => o\.id === requested\);/);
  assert.match(context, /const explicitOrganizationId = requested \|\| stored;/);
  assert.match(context, /if \(!authoritative && explicitOrganizationId && !preferred\) \{[\s\S]*setOrgLoading\(true\);[\s\S]*return;/);
  assert.match(context, /if \(!requested \|\| requestedOrganization\) persistTabOrganization\(chosen\.id\);/);

  // The list itself is still built from memberships alone — access is
  // `orgMemberships` and nothing else — so the guard protects the right thing.
  assert.match(context, /collection\(db, 'orgMemberships'\),\s*\n\s*where\('userId', '==', uid\)/);
});

// Every organization qTicket can actually open is a QuickTeam tenant with a live
// entitlement — `firestore.rules` and `authorizeOrgRequest` both require both
// halves — so a fixture standing for a real workspace has to carry them.
const ACTIVE_QUICKTEAM = Object.freeze({
  sourceOrganizationId: 'quickteam-org-1',
  entitlement: 'active',
});

// A seat is what draws an organization in the switcher, and nothing ever took
// one back out. Provisioning stopped creating seats for QuickTeam tenants that
// never bought qTicket, but that fixed only the seats it made: the standalone
// organizations from before the QuickTeam contract have no source id at all,
// were never in scope for it, and their owners kept being offered a door that
// opens onto «організація не підключена через QuickTeam». Nothing is deleted
// here — the seat stays exactly where it is. It simply stops being offered.
test('a workspace the product refuses to open is not offered as one', () => {
  const memberships = [
    { orgId: 'org-live', role: 'owner' },
    { orgId: 'org-standalone', role: 'owner' },
    { orgId: 'org-suspended', role: 'member' },
  ];

  const { organizations, roles } = buildOrganizationList(memberships, [
    { id: 'org-live', name: 'OneB', quickTeam: ACTIVE_QUICKTEAM },
    // Older than the QuickTeam contract: no source organization at all.
    { id: 'org-standalone', name: 'Arthur.mospan Team' },
    {
      id: 'org-suspended',
      name: 'Колишній клієнт',
      quickTeam: { sourceOrganizationId: 'quickteam-org-2', entitlement: 'inactive' },
    },
  ]);

  assert.deepEqual(organizations.map(organization => organization.id), ['org-live']);
  // The role goes with the entry. A switcher that prints «власник» beside a
  // workspace it is not showing has kept half of a fact.
  assert.deepEqual(roles, { 'org-live': 'owner' });
});

// The case the first version of this filter missed entirely, and the reason it
// missed it: the browser cannot read an organization without an active
// entitlement — the rules refuse it — so the two standalone organizations it was
// written to remove were exactly the ones whose document never arrived. They
// stayed `pending`, and `pending` was exempt. The directory route reads through
// the Admin SDK and sees every document there is, so once it has answered, a
// membership with nothing behind it is not a workspace.
test('once the Admin SDK has answered, a membership with no organization is not a workspace', () => {
  const memberships = [
    { orgId: 'org-live', role: 'owner' },
    { orgId: 'org-unreadable', role: 'owner' },
  ];
  const documents = [{ id: 'org-live', name: 'OneB', quickTeam: ACTIVE_QUICKTEAM }];

  const verified = buildOrganizationList(memberships, documents, [], { verified: true });
  assert.deepEqual(verified.organizations.map(entry => entry.id), ['org-live']);
  assert.deepEqual(verified.roles, { 'org-live': 'owner' });

  // And the same inputs from the cache-backed pass keep it, because there the
  // missing document really can mean a short read.
  const provisional = buildOrganizationList(memberships, documents, []);
  assert.deepEqual(provisional.organizations.map(entry => entry.id), ['org-live', 'org-unreadable']);
});

// A previously published `pending` entry must not survive the verified pass
// either — it is the same absent document, remembered.
test('a remembered pending entry does not outlive the answer that refutes it', () => {
  const published = [{ id: 'org-unreadable', pending: true }];
  const { organizations } = buildOrganizationList(
    [{ orgId: 'org-unreadable', role: 'owner' }],
    [],
    published,
    { verified: true },
  );
  assert.deepEqual(organizations, []);
});

// The one thing this filter must never do. A document that did not come back is
// a short read — `getDocs` answers from a cache that never held it whenever the
// SDK believes it is offline — and dropping an entry on that evidence would
// delete a live workspace from the switcher and leave it deleted.
test('a short read is never mistaken for a workspace nobody may open', () => {
  const { organizations } = buildOrganizationList(
    [{ orgId: 'org-one', role: 'owner' }],
    [],
  );

  assert.deepEqual(organizations.map(organization => organization.id), ['org-one']);
  assert.equal(organizations[0].pending, true);
});

// Ordering was only half of it. The list was assembled out of the organization
// documents, so however the reads were sequenced, a read that came back short
// deleted a workspace — and `getDocs` comes back short without failing whenever
// the SDK believes it is offline and answers from a cache that never held the
// document. Nothing re-runs until a membership changes, so the workspace stayed
// gone. A membership is the proof a workspace exists; the document only names
// it.
test('a workspace survives an organization document that did not come back', () => {
  const memberships = [
    { orgId: 'org-one', userId: 'u', role: 'owner' },
    { orgId: 'org-two', userId: 'u', role: 'member' },
  ];

  const { organizations, roles } = buildOrganizationList(
    memberships,
    [{ id: 'org-two', name: 'Друга', quickTeam: ACTIVE_QUICKTEAM }],
  );

  assert.deepEqual(organizations.map(organization => organization.id), ['org-one', 'org-two']);
  assert.equal(organizations[0].pending, true);
  assert.equal(organizations[1].name, 'Друга');
  // The role is the membership's own, so it is known even for the entry whose
  // document is missing — that is what the switcher prints under the name.
  assert.deepEqual(roles, { 'org-one': 'owner', 'org-two': 'member' });
});

test('an entry whose document is missing keeps the name it already had', () => {
  const memberships = [{ orgId: 'org-one', role: 'owner' }];
  const known = [{ id: 'org-one', name: 'OneB', logo: 'https://example.test/logo.png', quickTeam: ACTIVE_QUICKTEAM }];

  const { organizations } = buildOrganizationList(memberships, [], known);

  assert.equal(organizations[0].name, 'OneB');
  assert.equal(organizations[0].logo, 'https://example.test/logo.png');
  assert.notEqual(organizations[0].pending, true);

  // A document that did come back is the fresher of the two.
  const refreshed = buildOrganizationList(memberships, [{ id: 'org-one', name: 'OneB Ltd', quickTeam: ACTIVE_QUICKTEAM }], known);
  assert.equal(refreshed.organizations[0].name, 'OneB Ltd');
});

test('a membership names its workspace once, whatever the snapshot holds', () => {
  const { organizations, roles } = buildOrganizationList(
    [
      { orgId: 'org-one', role: 'owner' },
      { orgId: 'org-one', role: 'owner' },
      { role: 'member' },
      null,
    ],
    [
      { id: 'org-one', name: 'OneB', quickTeam: ACTIVE_QUICKTEAM },
      { id: 'org-ghost', name: 'Не наша', quickTeam: ACTIVE_QUICKTEAM },
    ],
  );

  // Deduplicated, and an organization no membership names is not a workspace of
  // this person's however it got into the read.
  assert.deepEqual(organizations.map(organization => organization.id), ['org-one']);
  assert.deepEqual(roles, { 'org-one': 'owner' });
});

test('a cached organization field cannot replace its Firestore path id', () => {
  const organization = firestoreDocumentData({
    id: 'org-oneb',
    data: () => ({ id: 'org-arthur-team', name: 'OneB' }),
  });

  assert.deepEqual(organization, { id: 'org-oneb', name: 'OneB' });
});

test('the workspace remounts and clears shared UI state when organization scope changes', async () => {
  const [layout, context, store] = await Promise.all([
    read('../src/app/(app)/layout.js'),
    read('../src/lib/context/AppContext.js'),
    read('../src/store/useWorkspaceStore.js'),
  ]);

  assert.match(layout, /<ConfirmProvider key=\{activeOrgId\}>/);
  assert.match(context, /useLayoutEffect\(\(\) => \{[\s\S]*resetOrganizationScope\(\)/);
  // `sidebarPreview` used to close this list. It was the settings page's live
  // preview of a brand edit, and qTicket no longer edits the brand — QuickTeam
  // owns it — so the field, its setters and this reset of it are gone.
  assert.match(store, /resetOrganizationScope:[\s\S]*quickView: null,[\s\S]*breadcrumbs: \[\],/);
  assert.doesNotMatch(store, /sidebarPreview/);
});

test('role-filtered organization caches are isolated by organization, user and role', async () => {
  const [organizationHook, workflowHook, issueLinks, members, mentions] = await Promise.all([
    read('../src/lib/hooks/useOrganization.js'),
    read('../src/lib/hooks/useWorkflowConfig.js'),
    read('../src/lib/hooks/useIssueLinks.js'),
    read('../src/lib/services/members.js'),
    read('../src/components/workspace/IssueMentionChip.jsx'),
  ]);

  for (const hook of [organizationHook, workflowHook]) {
    assert.match(hook, /const viewerScope = viewerId \? `\$\{viewerId\}:\$\{orgRole \|\| 'pending'\}` : '';/);
    assert.match(hook, /const key = `\$\{organizationId\}:\$\{viewerScope\}`;/);
  }
  assert.match(issueLinks, /linkRequestCacheKey\(viewerScope, issueId\)/);
  assert.match(issueLinks, /activeOrgId \|\| 'none'[\s\S]*viewerId \|\| 'anonymous'[\s\S]*orgRole \|\| 'pending'/);
  assert.match(issueLinks, /generation !== requestGeneration\.current/);
  assert.match(members, /\$\{organizationId\}_\$\{currentUser\.uid\}_\$\{cacheScope \|\| 'default'\}/);
  assert.match(mentions, /function mentionScope\(userId, organizationId\)/);
  assert.match(mentions, /pendingKeysByScope\.get\(scope\)/);
  assert.match(mentions, /`\$\{userId\}:\$\{organizationId\}:\$\{issueKey\}`/);
  assert.match(mentions, /auth\.currentUser\?\.uid !== userId/);
});

test('remembered workspace filters are scoped to the organization', async () => {
  const [myTasks, clientWorkspace] = await Promise.all([
    read('../src/app/(app)/my/page.js'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
  ]);

  assert.match(myTasks, /storageKey: `qt:view:\$\{activeOrgId\}:incident-queue`/);
  assert.match(myTasks, /qt:incident-queue:hidden-categories:\$\{uid \|\| 'anonymous'\}:\$\{activeOrgId \|\| 'none'\}/);
  // The qTicket client workspace is a short customer queue, not another board
  // with a second remembered view contract. Its three filters reset when the
  // customer changes, while the organization-wide queue remains bookmarkable.
  assert.doesNotMatch(clientWorkspace, /useViewState|storageKey:/);
  assert.match(clientWorkspace, /const \[scope, setScope\] = useState\('open'\)/);
});

test('membership signatures ignore snapshot order but notice access changes', () => {
  const memberships = [
    { orgId: 'org-two', role: 'member' },
    { orgId: 'org-one', role: 'owner' },
  ];

  assert.equal(
    organizationMembershipSignature(memberships),
    organizationMembershipSignature([...memberships].reverse()),
  );
  assert.notEqual(
    organizationMembershipSignature(memberships),
    organizationMembershipSignature([
      { orgId: 'org-two', role: 'admin' },
      { orgId: 'org-one', role: 'owner' },
    ]),
  );
});

test('only a valid server directory may replace the visible organization list', () => {
  assert.deepEqual(
    parseOrganizationDirectory({
      memberships: [{ orgId: 'org-one', role: 'owner' }],
      organizations: [{ id: 'org-one', name: 'OneB' }],
    }),
    {
      memberships: [{ orgId: 'org-one', role: 'owner' }],
      organizations: [{ id: 'org-one', name: 'OneB' }],
    },
  );
  assert.throws(
    () => parseOrganizationDirectory({ memberships: [], organizations: null }),
    error => error?.code === 'invalid-organization-directory',
  );
  assert.throws(
    () => parseOrganizationDirectory({ memberships: [{ role: 'owner' }], organizations: [] }),
    error => error?.code === 'invalid-organization-directory',
  );
});

test('no memberships is the only thing that means no workspace', () => {
  const { organizations, roles } = buildOrganizationList([], []);
  assert.deepEqual(organizations, []);
  assert.deepEqual(roles, {});
});

test('a short organizations read is asked again, of the server', async () => {
  const [context, layout] = await Promise.all([
    read('../src/lib/context/OrgContext.js'),
    read('../src/app/(app)/layout.js'),
  ]);

  // The list is the memberships', and the documents only decorate it.
  assert.match(context, /buildOrganizationList\(\s*memberships,\s*documents,\s*publishedOrgs,\s*\{ verified: authoritative \},\s*\)/);
  // Whatever the cache failed to supply is requested from the server, and the
  // request being unreachable does not shorten the list either.
  assert.match(context, /const missing = orgIds\.filter\(orgId => !found\.has\(orgId\)\);/);
  assert.match(context, /documents\.concat\(await readOrganizationsById\(missing, true\)\)/);
  assert.match(context, /fromServer \? getDocsFromServer\(request\) : getDocs\(request\)/);
  // A closed access screen follows only from a server-confirmed empty
  // membership list, never from an empty cache.
  assert.match(context, /if \(organizations\.length === 0\) \{[\s\S]*if \(!authoritative\) \{[\s\S]*setNoOrg\(true\);/);
  // One closed door, not two: an account with no organization reads the same
  // card as a membership that was refused. The owner met the second screen
  // the night a client seat was taken off its last project and asked why a
  // new one existed.
  assert.doesNotMatch(layout, /NoOrganizationAccess|Доступ до qTicket не надано/);
  assert.match(layout, /if \(noOrg\) \{[\s\S]*<WorkspaceLoadFailure[\s\S]{0,80}error=\{NO_ORGANIZATION_ACCESS\}/);
  assert.match(layout, /NO_ORGANIZATION_ACCESS = Object\.freeze\(\{ code: 'permission-denied'/);
  assert.doesNotMatch(layout, /router\.replace\('\/onboarding'/);
});

test('every browser membership list is verified through the independent server directory', async () => {
  const [context, route] = await Promise.all([
    read('../src/lib/context/OrgContext.js'),
    read('../src/app/api/organizations/route.js'),
  ]);

  // A browser-SDK query can complete successfully while its persistent target
  // is short. The Admin SDK directory is therefore unconditional and primary,
  // rather than a fallback that only runs after getDocsFromServer throws.
  assert.match(context, /refreshOrganizationDirectory\(\);/);
  assert.match(context, /authenticatedRequest\(\s*'\/api\/organizations',\s*\{ cache: 'no-store', signal: controller\.signal \}/);
  assert.doesNotMatch(context, /getDocsFromServer\(membershipsQuery\)/);
  assert.match(context, /window\.addEventListener\('focus', refreshOnFocus\)/);
  assert.match(context, /window\.addEventListener\('online', refreshOnFocus\)/);
  assert.match(context, /directoryAbortController\?\.abort\(\)/);
  assert.doesNotMatch(context, /ORG_DIRECTORY_REFRESH_MS|membershipServerRefreshInterval/);
  assert.match(context, /const verified = parseOrganizationDirectory\(directory\);/);

  // A stuck Firestore client has an independent recovery channel through the
  // authenticated app server. The token supplies the uid; a caller cannot ask
  // this route for somebody else's directory.
  assert.match(route, /const authorization = await authenticateRequest\(request\);/);
  assert.match(route, /\.where\('userId', '==', uid\)/);
  assert.doesNotMatch(route, /searchParams|request\.json\(/);
  assert.match(route, /'Cache-Control': 'private, no-store, max-age=0'/);

  // Cache results remain useful for a fast first paint, but only a server result
  // can prove that zero memberships really means zero workspaces.
  assert.match(context, /return applyMembershipDocuments\(memberships, false\);/);
  assert.doesNotMatch(context, /authoritative = !memSnap\.metadata\?\.fromCache/);
  assert.match(context, /const snapshotTicket = membershipSnapshotGate\.begin\(authoritative\);\s*if \(!snapshotTicket\) return;/);
  assert.match(context, /if \(!authoritative\) \{\s*setNoOrg\(false\);\s*setOrgLoading\(true\);\s*return;/);
  assert.match(context, /\{ includeMetadataChanges: true \}/);
});

test('switching to a server-recovered organization does not erase its verified role from a short cache', async () => {
  const context = await read('../src/lib/context/OrgContext.js');

  assert.match(context, /applyOrg\(target, orgRoles\[orgId\]\)/);
  assert.doesNotMatch(context, /const memSnap = await getDoc/);
  assert.match(context, /if \(snap\.exists\(\)\) setOrgRole\(snap\.data\(\)\.role\);\s*else if \(!snap\.metadata\.fromCache\) setOrgRole\(null\);/);
});

test('the obsolete client-side organization bootstrap is gone', async () => {
  const hook = await read('../src/lib/hooks/useOrganization.js');

  assert.doesNotMatch(hook, /initOrg/);
  assert.doesNotMatch(hook, /getDoc\(membershipRef\)/);
  assert.doesNotMatch(hook, /setDoc\(membershipRef/);
});

test('qTicket tenants can only be provisioned by QuickTeam', async () => {
  const [onboarding, authLayout, route, provision] = await Promise.all([
    read('../src/app/onboarding/page.js'),
    read('../src/components/AuthLayout.jsx'),
    read('../src/app/api/organizations/route.js'),
    read('../src/app/api/integrations/quickteam/provision/route.js'),
  ]);

  assert.match(onboarding, /redirect\('\/'\)/);
  assert.doesNotMatch(onboarding, /createOrganization|PlanCards|setDoc/);
  assert.doesNotMatch(authLayout, /Створити організацію|\/onboarding/);
  assert.match(route, /export async function POST\(\)/);
  assert.match(route, /code: 'quickteam_provisioning_required'/);
  const standaloneCreate = route.slice(route.indexOf('export async function POST'));
  assert.doesNotMatch(standaloneCreate, /batch\.set|collection\('orgMemberships'\)/);
  assert.match(provision, /readSignedQuickTeamRequest\(request\)/);
  assert.match(provision, /transaction\.set\(organizationRef/);
  assert.match(provision, /collection\(MEMBERSHIP_COLLECTION\)\.doc\(seatId\)/);

  const rules = await read('../firestore.rules');
  const organizations = rules.slice(rules.indexOf('match /organizations/{orgId}'), rules.indexOf('match /orgMemberships/{membershipId}'));
  assert.match(organizations, /allow create: if false;/);
  const memberships = rules.slice(rules.indexOf('match /orgMemberships/{membershipId}'));
  assert.match(memberships.slice(0, 1600), /allow create, update, delete: if false;/);
});
