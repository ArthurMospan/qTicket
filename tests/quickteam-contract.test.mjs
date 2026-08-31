import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createQuickTeamSignedRequest,
  quickTeamAppConfig,
  normalizeQuickTeamLaunch,
  normalizeQuickTeamProvision,
  normalizeQuickTeamUnread,
  quickTeamIdentityId,
  quickTeamOrganizationId,
  quickTeamStaffUid,
  signQuickTeamRequest,
  verifyQuickTeamRequest,
} from '../src/lib/integrations/quickteamContract.mjs';
import { hasActiveQuickTeamEntitlement } from '../src/lib/utils/quickTeamManaged.mjs';
import { quickTeamSeatChanges } from '../src/lib/utils/orgMembership.mjs';

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
  // A request with no headers at all is not a stale one. `Number('')` is 0 and
  // 0 is a safe integer, so this used to answer «expired» and send whoever was
  // debugging an unsigned call to look at clocks.
  for (const missing of ['', null, undefined]) {
    assert.deepEqual(
      verifyQuickTeamRequest({ secret, timestamp: missing, nonce, signature, body, nowSeconds: timestamp }),
      { ok: false, code: 'timestamp' },
    );
  }
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

// Кого QuickTeam перестав надсилати, той втрачає місце — і повертається на те
// саме місце, коли зʼявляється в наступному знімку. README і `firestore.rules`
// обіцяють це обидва: «Restoring the archived seat returns the same role,
// position and projects». Provisioning робив протилежне — архівував місце без
// `projectIds`, вичищав `project.team`, а на поверненні видаляв архів замість
// того, щоб його спожити. Людина поверталася в організацію, де в неї немає
// жодного клієнтського простору, і ніхто вже не міг сказати, які були її.
test('співробітник, знятий у QuickTeam і повернутий, лишається у своїх клієнтських просторах', () => {
  const memberships = [
    { userId: 'owner-uid', role: 'owner' },
    { userId: 'agent-uid', role: 'member', positionId: 'support', joinedAt: 'joined-then', invitedBy: 'owner-uid' },
    { userId: 'client-uid', role: 'client_admin' },
  ];
  const projects = [
    { id: 'client-a', team: ['owner-uid', 'agent-uid'] },
    { id: 'client-b', team: ['agent-uid'] },
    { id: 'client-c', team: ['owner-uid'] },
  ];

  // Знімок без цієї людини: місце закривається.
  const removal = quickTeamSeatChanges({
    incomingUserIds: ['owner-uid'],
    memberships,
    projects,
  });
  assert.deepEqual(removal.departing.map(seat => seat.userId), ['agent-uid']);
  const [archived] = removal.departing;
  // Саме те, що втрачалося: простори записані в місце до того, як `project.team`
  // їх забуде, разом із роллю й посадою.
  assert.deepEqual(archived.projectIds, ['client-a', 'client-b']);
  assert.equal(archived.role, 'member');
  assert.equal(archived.positionId, 'support');
  assert.equal(archived.joinedAt, 'joined-then');
  // Чіпаються тільки ті простори, у яких вона була.
  assert.deepEqual(removal.projectIds, ['client-a', 'client-b']);
  // Клієнтські ролі QuickTeam не надсилає і не знімає.
  assert.equal(removal.departing.some(seat => seat.userId === 'client-uid'), false);

  // Наступний знімок називає її знову: місце споживається, а не видаляється.
  const restore = quickTeamSeatChanges({
    incomingUserIds: ['owner-uid', 'agent-uid'],
    memberships: memberships.filter(membership => membership.userId !== 'agent-uid'),
    projects: projects.map(project => ({
      ...project,
      team: project.team.filter(uid => uid !== 'agent-uid'),
    })),
    archives: [{ orgId: 'org', userId: 'agent-uid', ...archived }],
  });
  assert.deepEqual(restore.departing, []);
  assert.deepEqual(restore.returning.map(seat => seat.userId), ['agent-uid']);
  assert.deepEqual(restore.returning[0].projectIds, ['client-a', 'client-b']);
  assert.equal(restore.returning[0].seat.positionId, 'support');
});

test('provisioning повертає місце тим самим шляхом, що й екран команди', async () => {
  const route = await readFile(
    new URL('../src/app/api/integrations/quickteam/provision/route.js', import.meta.url),
    'utf8',
  );

  // Одне рішення на обидві половини, а не два списки ролей у маршруті.
  assert.match(route, /quickTeamSeatChanges\(\{/);
  // Архів пишеться з `projectIds`, бо саме цей рядок і був загублений.
  assert.match(route, /projectIds/);
  // Повернення — це відновлення доступу до проєктів, а не видалення архіву.
  assert.match(route, /restoreProjectAccess\(\{/);
  assert.match(route, /joinedAt: seat\?\.joinedAt \|\| now/);
  // І документ організації більше не носить списку, який ніхто не читає, —
  // а читати його міг кожен клієнт, бо організація йому відкрита.
  assert.doesNotMatch(route, /memberUids/);
});

// Одне число в чужій рейці. Воно каже «сюди варто зайти» — і більше нічого:
// ні заголовка звернення, ні клієнта, ні ключа. Друга скринька — це друга
// скринька, яку треба тримати правдивою.
test('the unread badge answers with a number and only for an enabled staff seat', async () => {
  assert.deepEqual(
    normalizeQuickTeamUnread({ version: 1, sourceOrganizationId: ' org-1 ', sourceUserId: 'user-1' }).data,
    { sourceOrganizationId: 'org-1', sourceUserId: 'user-1' },
  );
  assert.equal(normalizeQuickTeamUnread({ version: 2, sourceOrganizationId: 'o', sourceUserId: 'u' }).error, 'unsupported_version');
  assert.equal(normalizeQuickTeamUnread({ version: 1, sourceOrganizationId: 'o' }).error, 'invalid_payload');

  const [route, verification, counts] = await Promise.all([
    readFile(new URL('../src/app/api/integrations/quickteam/unread/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/server/quickteamIntegration.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/server/notificationCounts.js', import.meta.url), 'utf8'),
  ]);

  // Ті самі дві відмови, що й у launch: вимкнене доповнення й не той, кого
  // QuickTeam надіслав. Організація, яка вимкнула qTicket, перестає
  // розповідати про себе навіть числом.
  assert.match(route, /quickTeam\?\.entitlement !== 'active'/);
  assert.match(route, /INTERNAL_ROLES\.includes\(membershipSnap\.data\(\)\?\.role\)/);
  assert.ok(
    route.indexOf("code: 'not_enabled'") < route.indexOf('unreadInAppCount(db, qTicketUserId'),
    'the count is read after the seat is verified, not before',
  );
  // Відповідь — рівно два поля. Заголовок, клієнт чи ключ звернення тут
  // перетворили б бейдж на другу скриньку.
  assert.match(
    route,
    /NextResponse\.json\(\{\s*version: 1,\s*unread: await unreadInAppCount\(db, qTicketUserId, organizationId\),\s*\}/,
  );

  // Підпис і пʼятихвилинне вікно лишаються; nonce — ні, і це навмисно.
  assert.match(route, /readSignedQuickTeamRequest\(request, \{ recordNonce: false \}\)/);
  assert.match(verification, /export async function readSignedQuickTeamRequest\(request, \{ recordNonce = true \} = \{\}\)/);
  assert.ok(
    verification.indexOf('if (!recordNonce) return { body };') > verification.indexOf('if (!verification.ok)'),
    'an unsigned request is refused before the nonce store is skipped',
  );

  // Одне визначення «непрочитаного» на обидва боки: дзвіночок тут і бейдж там.
  assert.match(counts, /export async function unreadInAppCount\(db, uid, organizationId\)/);
  assert.match(counts, /Math\.max\(0, total - externalOnly\)/);
  const bell = await readFile(new URL('../src/app/api/notifications/unread-counts/route.js', import.meta.url), 'utf8');
  assert.match(bell, /unreadInAppCount\(db, uid, organizationId\)/);
  assert.doesNotMatch(bell, /\.where\('inapp', '==', false\)/);
});

// Той самий конверт, але в інший бік: тепер підписує qTicket.
test('qTicket signs its own requests to QuickTeam with the one shared envelope', () => {
  const environment = {
    NEXT_PUBLIC_QUICKTEAM_URL: 'https://quickteam.example.com/',
    QUICKTEAM_QTICKET_SHARED_SECRET: secret,
  };
  assert.deepEqual(quickTeamAppConfig(environment), {
    origin: 'https://quickteam.example.com',
    secret,
    configured: true,
  });
  assert.equal(quickTeamAppConfig({ NEXT_PUBLIC_QUICKTEAM_URL: 'https://q.example' }).configured, false);
  assert.equal(quickTeamAppConfig({ QUICKTEAM_QTICKET_SHARED_SECRET: secret }).configured, false);

  const request = createQuickTeamSignedRequest({ version: 1, projectId: 'p1' }, {
    environment,
    timestamp: 2_000_000_000,
    nonce: 'nonce_0123456789abcdef',
  });
  assert.equal(request.origin, 'https://quickteam.example.com');
  assert.equal(
    request.headers['X-QT-Signature'],
    signQuickTeamRequest(secret, {
      timestamp: 2_000_000_000,
      nonce: 'nonce_0123456789abcdef',
      body: request.body,
    }),
  );
  // Підпис накриває саме ті байти, які поїдуть.
  assert.deepEqual(JSON.parse(request.body), { version: 1, projectId: 'p1' });
});

// «Створити завдання в QuickTeam»: звернення лишається тут і відкритим, а
// робота живе там. Перенос — це посилання й рядок в історії, не зміна статусу.
test('the transfer sends what QuickTeam needs and keeps the request open', async () => {
  const [route, proxy, client, detail] = await Promise.all([
    readFile(new URL('../src/app/api/issues/[issueId]/quickteam-task/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/api/integrations/quickteam/projects/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/server/quickteamTransfer.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/IssueDetail.jsx', import.meta.url), 'utf8'),
  ]);

  // Внутрішнє рішення про внутрішню роботу: клієнт має `create:issue`, але
  // сюди не потрапляє ні через маршрут, ні через меню.
  for (const source of [route, proxy]) {
    assert.match(source, /rolesFor\('edit:issue'\)/);
    assert.match(source, /isClientRole\(authorization\.membership\?\.role\)/);
  }
  assert.match(detail, /internalViewer && canWhileRoleLoads\(orgRole, 'edit:issue'\)/);

  // Особу називає QuickTeam, а не браузер: секрет лишається на сервері, а
  // `sourceUserId` дістається зі звʼязку, який записало провіження.
  assert.match(client, /quickTeamIdentities'\)\s*\.where\('qTicketUserId', '==', qTicketUserId\)/s);
  assert.match(route, /const sourceUserId = await quickTeamSourceUserId\(authorization\.user\.uid\);/);
  assert.match(route, /QUICKTEAM_IDENTITY_MISSING/);

  // Звернення нікуди не зникає: ні статусу, ні архіву, ні скасування.
  assert.doesNotMatch(route, /columnId|archivedAt|cancelledAt/);
  // І сам документ звернення не чіпається взагалі: посилання в чужий трекер —
  // це маршрутизація, а її клієнтові не показують. Плюс перенос не піднімає
  // звернення у списку клієнта як активність, якої він не бачив.
  assert.match(route, /issueRef\.collection\('internal'\)\.doc\('quickteam'\)\.set\(quickTeamTask/);
  assert.doesNotMatch(route, /issueRef\.set\(/);
  assert.match(route, /audit'\)\.doc\('quickteam-transfer'\)/);
  // Лишається слід: поле з посиланням і рядок історії з детермінованим id,
  // щоб друге натискання не написало другий рядок про той самий факт.
  assert.match(route, /quickTeamTask/);
  assert.match(route, /action: 'quickteam-transferred'/);

  // Опис, який читатимуть у QuickTeam, складає qTicket — разом із посиланням
  // назад. Інакше сусідній продукт вигадував би слова про чужий запис.
  assert.match(route, /Перенесено зі звернення/);
  assert.match(route, /incidentUrl/);
});
