import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('deactivating a member closes their access and leaves their work alone', async () => {
  const [route, archive, hook] = await Promise.all([
    read('../src/app/api/organizations/[organizationId]/members/[memberId]/route.js'),
    read('../src/lib/server/orgMembership.js'),
    read('../src/lib/hooks/useOrganization.js'),
  ]);

  // Access is closed in the two places that grant it, and nowhere else.
  assert.match(route, /where\('team', 'array-contains', memberId\)/);
  assert.match(route, /team: FieldValue\.arrayRemove\(memberId\)/);
  assert.match(route, /transaction\.delete\(membershipRef\)/);
  assert.match(route, /MEMBERSHIP_ARCHIVE/);
  assert.match(route, /memberDirectoryVersion: FieldValue\.increment\(1\)/);

  // The record of what the person did is not access and is never rewritten.
  // These two writes are what turned "remove from team" into a quiet edit of
  // every task they had ever been assigned or had been watching.
  assert.doesNotMatch(route, /assigneeIds: FieldValue\.arrayRemove/);
  assert.doesNotMatch(route, /watcherIds = FieldValue\.arrayRemove/);

  // Leaving needs no privilege; taking someone else's access away does.
  assert.match(route, /const leavingSelf = memberId === authorization\.user\.uid/);
  assert.match(route, /!leavingSelf && !can\(authorization\.membership\?\.role, 'deactivate:member'\)/);
  assert.match(route, /role === 'owner'/);

  // Coming back restores the seat rather than creating a new one.
  assert.match(archive, /transaction\.delete\(archiveRef\)/);
  assert.match(archive, /arrayUnion\(userId\)/);

  assert.doesNotMatch(hook, /updateDoc\(membershipRef/);
  assert.doesNotMatch(hook, /deleteDoc\(membershipRef/);
  assert.match(hook, /deactivateOrganizationMember\(activeOrgId, uid\)/);
  assert.match(hook, /reactivateOrganizationMember\(activeOrgId, uid\)/);
});

test('legacy member roles stay protected while QuickTeam-managed seats are immutable here', async () => {
  const route = await read('../src/app/api/organizations/[organizationId]/members/[memberId]/route.js');
  assert.match(route, /authorizeOrgRequest\(request, organizationId, \['owner', 'admin'\]\)/);
  assert.doesNotMatch(route, /Only the owner can change member roles/);
  assert.match(route, /action === 'role' && membership\.role === 'owner'/);
  assert.match(route, /memberId === authorization\.user\.uid/);
  assert.match(route, /isQuickTeamManagedMembership\(membership\)/);
  assert.match(route, /QUICKTEAM_MANAGED_MESSAGE/);
});

test('qTicket does not expose internal team mutations and keeps personal exit separate', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  assert.match(settings, /Команда керується в QuickTeam/);
  assert.doesNotMatch(settings, /TeamMemberSettingsDialog/);
  assert.doesNotMatch(settings, /getMemberRemovalImpact/);

  // Signing out, leaving and deleting the account are personal actions and
  // must not sit inside an `adminOnly` section, where a member cannot see them.
  assert.match(settings, /\{ id: 'account',[^}]*group: 'Особисте' \}/);
  assert.doesNotMatch(settings, /\{ id: 'account',[^}]*adminOnly/);
  assert.match(settings, /handleLeaveOrganization/);
});

test('rates are served from protected paths and never persisted in public browser cache', async () => {
  const [membersRoute, memberService, workflowRoute, workflowService, positions] = await Promise.all([
    read('../src/app/api/organizations/[organizationId]/members/route.js'),
    read('../src/lib/services/members.js'),
    read('../src/app/api/organizations/[organizationId]/workflow/route.js'),
    read('../src/lib/services/workflow.js'),
    import('../src/lib/utils/workflowPositions.mjs'),
  ]);

  assert.match(membersRoute, /collection\('memberRates'\)/);
  assert.match(membersRoute, /canViewBilling/);
  assert.match(memberService, /members\.map\(\(\{ hourlyRate, \.\.\.member \}\) => member\)/);
  assert.match(workflowRoute, /collection\('private'\)[\s\S]{0,120}doc\('workflowRates'\)/);
  assert.match(workflowRoute, /canViewBilling[\s\S]{0,180}publicWorkflow\(workflow\)/);
  assert.match(workflowService, /fetchWorkflowViaApi/);
  assert.ok(positions.DEFAULT_WORKFLOW_POSITIONS.every(position => !('hourlyRate' in position)));
});

test('legacy ownership transfer is atomic and QuickTeam-backed organizations refuse it', async () => {
  const route = await read('../src/app/api/organizations/[organizationId]/route.js');
  assert.match(route, /authorizeOrgRequest\(request, organizationId, \['owner'\]\)/);
  assert.match(route, /isQuickTeamManagedOrganization\(organizationSnapshot\.data\(\)\)/);
  assert.match(route, /QUICKTEAM_MANAGED/);
  assert.match(route, /await db\.runTransaction/);
  assert.match(route, /transaction\.update\(currentRef, \{ role: 'admin'/);
  assert.match(route, /transaction\.update\(targetRef, \{ role: 'owner'/);
  assert.match(route, /ownerId: targetUserId/);
  assert.match(route, /targetSnap\.data\(\)\.removalPending === true/);
});

test('the one-time migration is explicit, dry-run by default and idempotent', async () => {
  const migration = await read('../scripts/migrate-member-access.mjs');
  assert.match(migration, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(migration, /--confirm-project/);
  assert.match(migration, /--confirm-organization/);
  assert.match(migration, /--confirm-writes-frozen/);
  assert.match(migration, /FieldValue\.arrayRemove/);
  assert.match(migration, /hourlyRate: FieldValue\.delete\(\)/);
});

test('every permission in the matrix is read by something', async () => {
  const { PERMISSIONS } = await import('../src/lib/utils/can.js');
  const sources = await Promise.all([
    'src/app/(app)/settings/page.js',
    'src/app/(app)/analytics/page.js',
    'src/app/(app)/chat/page.js',
    'src/app/(app)/page.js',
    'src/app/(app)/my/page.js',
    'src/app/(app)/sprints/page.js',
    'src/app/(app)/[projectId]/ProjectBoardClient.jsx',
    'src/components/MobileNav.jsx',
    'src/components/WorkspaceSidebar.jsx',
    'src/components/WorkspaceCommandPalette.jsx',
    'src/components/workspace/IssueDetail.jsx',
    'src/components/workspace/QtPlusProjectTab.jsx',
    'src/components/workspace/UnifiedTimeline.jsx',
    'src/lib/bulk/issueBulkActions.mjs',
    'src/app/api/issues/bulk/route.js',
    'src/app/api/organizations/[organizationId]/route.js',
    'src/app/api/organizations/[organizationId]/members/[memberId]/route.js',
    'src/app/api/invitations/route.js',
    'src/app/api/calendar/events/route.js',
    'src/app/api/issues/route.js',
    'src/app/api/issues/[issueId]/archive/route.js',
  ].map(path => read(`../${path}`)));
  const corpus = sources.join('\n');

  // A permission nothing reads is a claim nothing tests: it can say anything at
  // all and stay true, which is exactly how `manage:finance` came to document a
  // restriction the product did not have.
  const unused = Object.keys(PERMISSIONS).filter(permission => !corpus.includes(`'${permission}'`));
  assert.deepEqual(unused, []);
});
