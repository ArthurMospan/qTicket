import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeQuickTeamLaunch,
  normalizeQuickTeamProvision,
  quickTeamIdentityId,
  quickTeamOrganizationId,
  quickTeamStaffUid,
  signQuickTeamRequest,
  verifyQuickTeamRequest,
} from '../src/lib/integrations/quickteamContract.mjs';
import { hasActiveQuickTeamEntitlement } from '../src/lib/utils/quickTeamManaged.mjs';

const secret = 'test-shared-secret-with-at-least-32-characters';

test('QuickTeam request signatures cover version, timestamp, nonce and exact body', () => {
  const body = JSON.stringify({ version: 1, action: 'provision' });
  const timestamp = 2_000_000_000;
  const nonce = 'nonce_0123456789abcdef';
  const signature = signQuickTeamRequest(secret, { timestamp, nonce, body });

  assert.deepEqual(
    verifyQuickTeamRequest({ secret, timestamp, nonce, signature, body, nowSeconds: timestamp }),
    { ok: true, timestamp, nonce },
  );
  assert.deepEqual(
    verifyQuickTeamRequest({ secret, timestamp, nonce, signature, body: `${body} `, nowSeconds: timestamp }),
    { ok: false, code: 'signature' },
  );
  assert.deepEqual(
    verifyQuickTeamRequest({ secret, timestamp, nonce, signature, body, nowSeconds: timestamp + 301 }),
    { ok: false, code: 'expired' },
  );
});

test('provisioning accepts one exact owner and only internal qTicket roles', () => {
  const valid = normalizeQuickTeamProvision({
    version: 1,
    sourceOrganizationId: 'quickteam-org-1',
    revision: 7,
    entitlement: 'active',
    organization: {
      name: 'OneB',
      logo: 'https://cdn.example/logo.png',
      sidebarTheme: 'custom',
      sidebarColor: '#121212',
      timezone: 'Europe/Kyiv',
    },
    staff: [
      { sourceUserId: 'owner-1', email: 'Owner@example.com', name: 'Owner', role: 'owner' },
      { sourceUserId: 'manager-1', email: 'manager@example.com', name: 'Manager', role: 'member' },
    ],
  });
  assert.equal(valid.error, undefined);
  assert.equal(valid.data.staff[0].email, 'owner@example.com');
  assert.equal(valid.data.organization.sidebarTheme, 'custom');

  const secondOwner = structuredClone(valid.data);
  secondOwner.staff[1].role = 'owner';
  assert.equal(normalizeQuickTeamProvision(secondOwner).error, 'owner_required');

  const clientRole = structuredClone(valid.data);
  clientRole.staff[1].role = 'client_admin';
  assert.equal(normalizeQuickTeamProvision(clientRole).error, 'invalid_staff');
});

test('source ids map to stable opaque qTicket ids', () => {
  assert.equal(quickTeamOrganizationId('org-1'), quickTeamOrganizationId('org-1'));
  assert.equal(quickTeamStaffUid('user-1'), quickTeamStaffUid('user-1'));
  assert.equal(quickTeamIdentityId('user-1'), quickTeamIdentityId('user-1'));
  assert.notEqual(quickTeamOrganizationId('org-1'), quickTeamOrganizationId('org-2'));
  assert.doesNotMatch(quickTeamStaffUid('private-user-id'), /private-user-id/);
});

test('launch destinations stay on the qTicket origin', () => {
  assert.deepEqual(normalizeQuickTeamLaunch({
    version: 1,
    sourceOrganizationId: 'org-1',
    sourceUserId: 'user-1',
    returnTo: '/overview?filter=new',
  }).data.returnTo, '/overview?filter=new');

  assert.deepEqual(normalizeQuickTeamLaunch({
    version: 1,
    sourceOrganizationId: 'org-1',
    sourceUserId: 'user-1',
    returnTo: '//evil.example/path',
  }).data.returnTo, '/overview');
});

test('QuickTeam entitlement gates both Firestore and authenticated server routes', async () => {
  const [rules, server, consume] = await Promise.all([
    readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/server/firebaseAdmin.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/api/integrations/quickteam/consume/route.js', import.meta.url), 'utf8'),
  ]);
  assert.match(rules, /function organizationEntitlementActive\(orgId\)/);
  assert.match(rules, /sourceOrganizationId[^\n]*!= ''/);
  assert.match(rules, /signedIn\(\) && organizationEntitlementActive\(orgId\)/);
  assert.match(server, /isQuickTeamManagedOrganization\(organizationSnap\.data\(\)\)/);
  assert.match(server, /QTICKET_NOT_PROVISIONED/);
  assert.match(server, /QTICKET_INACTIVE/);
  assert.match(consume, /organization\.data\(\)\?\.quickTeam\?\.entitlement !== 'active'/);
  assert.ok(
    consume.indexOf("quickTeam?.entitlement !== 'active'") < consume.indexOf('createCustomToken'),
    'a launch created before deactivation must not mint a new session afterward',
  );
});

test('only an active QuickTeam snapshot is a qTicket entitlement', () => {
  assert.equal(hasActiveQuickTeamEntitlement(null), false);
  assert.equal(hasActiveQuickTeamEntitlement({}), false);
  assert.equal(hasActiveQuickTeamEntitlement({ quickTeam: { entitlement: 'active' } }), false);
  assert.equal(hasActiveQuickTeamEntitlement({
    quickTeam: { sourceOrganizationId: 'quickteam-org-1', entitlement: 'inactive' },
  }), false);
  assert.equal(hasActiveQuickTeamEntitlement({
    quickTeam: { sourceOrganizationId: 'quickteam-org-1', entitlement: 'active' },
  }), true);
});
