import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('organization picker counts come from a token-scoped server aggregation', async () => {
  const [route, hook, switcher, bridge] = await Promise.all([
    read('../src/app/api/notifications/unread-counts/route.js'),
    read('../src/lib/hooks/useOrganizationUnreadCounts.js'),
    read('../src/components/OrgSwitcherScreen.jsx'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
  ]);

  assert.match(route, /const authorization = await authenticateRequest\(request\);/);
  assert.match(route, /\.where\('userId', '==', uid\)/);
  assert.match(route, /db\.collection\('orgMemberships'\)/);
  assert.doesNotMatch(route, /searchParams|request\.json\(/);
  assert.match(route, /\.where\('read', '==', false\)/);
  assert.match(route, /\.where\('inapp', '==', false\)/);
  assert.match(route, /totalByOrganization\[organizationId\] - \(externalOnlyByOrganization\[organizationId\] \|\| 0\)/);
  assert.match(route, /query\.count\(\)\.get\(\)/);
  assert.match(route, /'Cache-Control': 'private, no-store, max-age=0'/);

  assert.match(hook, /'\/api\/notifications\/unread-counts'/);
  assert.match(hook, /inFlightRequests\.has\(userId\)/);
  assert.match(hook, /loadUnreadCounts\(userId\)/);
  assert.match(hook, /window\.addEventListener\('focus', refresh\)/);
  assert.match(hook, /window\.addEventListener\('online', refresh\)/);
  assert.match(switcher, /counts: unreadByOrg/);
  assert.doesNotMatch(switcher, /notifications\.reduce/);
  assert.match(bridge, /useOrganizationUnreadCounts\(\);/);
});

test('notification listeners do not replay another account or organization history', async () => {
  const source = await read('../src/lib/hooks/useNotifications.js');
  assert.match(source, /seenIds\.current = new Set\(\);/);
  assert.match(source, /isFirstLoad\.current = true;/);
  assert.match(source, /\[userId, activeOrganizationId\]/);
});

test('other-organization badges use the all-organization count map', async () => {
  const [sidebar, mobile] = await Promise.all([
    read('../src/components/WorkspaceSidebar.jsx'),
    read('../src/components/MobileNav.jsx'),
  ]);
  for (const source of [sidebar, mobile]) {
    assert.match(source, /notificationUnreadByOrg/);
    assert.match(source, /Object\.entries\(unreadByOrganization\)/);
  }
});
