import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createQuickTeamSignedRequest,
  quickTeamAppConfig,
  normalizeQuickTeamLaunch,
  normalizeQuickTeamPing,
  normalizeQuickTeamProvision,
  normalizeQuickTeamUnread,
  quickTeamPortalBranding,
  quickTeamIdentityId,
  quickTeamOrganizationId,
  quickTeamStaffUid,
  signQuickTeamRequest,
  verifyQuickTeamRequest,
} from '../src/lib/integrations/quickteamContract.mjs';
import {
  hasActiveQuickTeamEntitlement,
  quickTeamSnapshotOpensOrganization,
} from '../src/lib/utils/quickTeamManaged.mjs';
import { clientSeatCollisions, quickTeamSeatChanges } from '../src/lib/utils/orgMembership.mjs';

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

// Дві марки, які були одним значенням двічі. `name`/`logo` — це організація,
// те, що бачить персонал над чергою; `portal` — те, що бачить клієнт у своєму
// порталі. Поля в qTicket завжди були різні й завжди годувалися одним
// значенням, тож компанія не могла назвати свою підтримку інакше, ніж собою.
const brandSnapshot = portal => normalizeQuickTeamProvision({
  version: 1,
  sourceOrganizationId: 'quickteam-org-1',
  revision: 3,
  entitlement: 'active',
  organization: {
    name: 'OneB',
    logo: 'https://cdn.example/logo.png',
    sidebarTheme: 'custom',
    sidebarColor: '#121212',
    timezone: 'Europe/Kyiv',
    ...(portal === undefined ? {} : { portal }),
  },
  staff: [{ sourceUserId: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'owner' }],
});

test('без portal клієнтський портал носить марку організації', () => {
  const snapshot = brandSnapshot(undefined);
  assert.equal(snapshot.error, undefined);
  assert.equal(snapshot.data.organization.portal, null);
  // Головне в цьому тесті — що нічого не змінилося для знімка, який про portal
  // не знає. Стара поведінка — це і є фолбек.
  assert.deepEqual(quickTeamPortalBranding(snapshot.data.organization), {
    name: 'OneB',
    logo: 'https://cdn.example/logo.png',
    sidebarTheme: 'custom',
    sidebarColor: '#121212',
  });
});

test('порожнє поле в portal успадковує саме себе, а не всю марку', () => {
  const snapshot = brandSnapshot({ name: 'OneB Підтримка', sidebarTheme: 'light' });
  assert.equal(snapshot.error, undefined);
  assert.deepEqual(quickTeamPortalBranding(snapshot.data.organization), {
    name: 'OneB Підтримка',
    // Лого й колір ніхто не перевизначав — вони лишаються організаційні.
    logo: 'https://cdn.example/logo.png',
    sidebarTheme: 'light',
    sidebarColor: '#121212',
  });
  // Марка персоналу не поїхала за марком клієнта.
  assert.equal(snapshot.data.organization.name, 'OneB');
  assert.equal(snapshot.data.organization.sidebarTheme, 'custom');
});

test('portal з негодящою темою бере тему організації, а не dark', () => {
  const snapshot = brandSnapshot({ name: 'Desk', sidebarTheme: 'neon' });
  assert.equal(quickTeamPortalBranding(snapshot.data.organization).sidebarTheme, 'custom');
});

// Марка персоналу і марка клієнта — два різні поля в одному документі, і
// провіженінг писав в обидва одне значення.
test('провіженінг пише марку персоналу і марку клієнта з різних джерел', async () => {
  const route = await readFile(
    new URL('../src/app/api/integrations/quickteam/provision/route.js', import.meta.url),
    'utf8',
  );
  // Організація — те, що бачить персонал над чергою.
  assert.ok(route.includes('name: payload.organization.name'));
  // Портал — те, що бачить клієнт, через один фолбек, який знає про portal.
  assert.ok(route.includes('...quickTeamPortalBranding(payload.organization)'));
  assert.ok(route.includes("source: 'quickteam'"));
});

test('пінг просить лише організацію і нічого про людину', () => {
  assert.deepEqual(
    normalizeQuickTeamPing({ version: 1, sourceOrganizationId: 'org-1', sourceUserId: 'nosy' }).data,
    { sourceOrganizationId: 'org-1' },
  );
  assert.equal(normalizeQuickTeamPing({ version: 2, sourceOrganizationId: 'org-1' }).error, 'unsupported_version');
  assert.equal(normalizeQuickTeamPing({ version: 1 }).error, 'invalid_payload');
});

// Проба, яка мовчить, коли новина погана, гірша за відсутню пробу: чи вимкнене
// доповнення — це частина відповіді, а не причина не відповідати.
test('пінг відповідає і про організацію, якої qTicket не знає', async () => {
  const route = await readFile(
    new URL('../src/app/api/integrations/quickteam/ping/route.js', import.meta.url),
    'utf8',
  );
  assert.match(route, /known: organizationSnap.exists/);
  assert.match(route, /portalUrl:/);
  assert.doesNotMatch(route, /code: 'inactive'/);
  // Ревізія, яку qTicket справді тримає — вона й відрізняє «я синхронізував»
  // від «я думаю, що синхронізував».
  assert.match(route, /revision: Number(organization.quickTeam?.revision || 0)/);
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

// qTicket існує тільки для тих організацій QuickTeam, які його купили. Решта —
// а їх у власника може бути скільки завгодно — не мають лишати тут ані сліду.
//
// `inactive` за контрактом означає «призупинено», і призупинити можна лише те,
// що вже було: організація зберігається цілою, щоб наступний активний знімок
// повернув той самий простір підтримки. Але перший знімок, який уже неактивний,
// описує зовсім інше — організацію QuickTeam, яка ніколи не була клієнтом
// qTicket. Провіженінг не розрізняв ці два випадки і писав обидва, тож у
// свічері назавжди зʼявлялася організація, яку неможливо відкрити: рулзи і
// `authorizeOrgRequest` вимагають `active`, а місце в `orgMemberships` — це
// рівно те, що малює організацію у списку.
test('перший неактивний знімок не створює організацію в qTicket', () => {
  // Ніколи не був клієнтом — нічого не пишемо.
  assert.equal(quickTeamSnapshotOpensOrganization({
    organizationExists: false,
    entitlement: 'inactive',
  }), false);
  // Купив — створюємо.
  assert.equal(quickTeamSnapshotOpensOrganization({
    organizationExists: false,
    entitlement: 'active',
  }), true);
  // Був клієнтом і призупинився — зберігаємо все, як обіцяє контракт.
  assert.equal(quickTeamSnapshotOpensOrganization({
    organizationExists: true,
    entitlement: 'inactive',
  }), true);
  assert.equal(quickTeamSnapshotOpensOrganization({
    organizationExists: true,
    entitlement: 'active',
  }), true);
  // Відсутній аргумент — це не дозвіл.
  assert.equal(quickTeamSnapshotOpensOrganization(), false);
  assert.equal(quickTeamSnapshotOpensOrganization({}), false);
});

test('провіженінг відмовляє першому неактивному знімку до того, як пише місця', async () => {
  const route = await readFile(
    new URL('../src/app/api/integrations/quickteam/provision/route.js', import.meta.url),
    'utf8',
  );
  assert.match(route, /quickTeamSnapshotOpensOrganization\(\{/);
  assert.match(route, /organizationExists: organizationSnap\.exists/);
  assert.match(route, /status: 'skipped'/);
  // Відмова стоїть перед `resolveQuickTeamStaff`, бо той не читає, а створює
  // акаунти в Firebase Auth і переписує імʼя, пошту й аватар кожного знайденого.
  // Організація, яка ніколи не купувала qTicket, не має коштувати нікому
  // облікового запису тут. Далі — перед записом самої організації та місць.
  const decision = route.indexOf('quickTeamSnapshotOpensOrganization');
  // Виклик більше не однорядковий — знімок фільтрується від зіткнень із
  // клієнтськими місцями, — але правило те саме: спершу рішення, потім акаунти.
  const staffResolution = route.indexOf('await resolveQuickTeamStaff(');
  const organizationWrite = route.indexOf('transaction.set(organizationRef');
  const seatWrite = route.indexOf('MEMBERSHIP_COLLECTION).doc(seatId)');
  assert.ok(decision > 0 && staffResolution > 0 && organizationWrite > 0 && seatWrite > 0);
  assert.ok(decision < staffResolution, 'ентайтлмент перевіряється перед створенням акаунтів');
  assert.ok(decision < organizationWrite, 'ентайтлмент перевіряється перед записом організації');
  assert.ok(decision < seatWrite, 'ентайтлмент перевіряється перед записом місць');
  // І ще раз у транзакції, проти документа, який вона справді пише.
  assert.ok(
    route.indexOf('quickTeamSnapshotOpensOrganization', decision + 1) < organizationWrite,
    'транзакція перевіряє ентайтлмент повторно',
  );
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

test('знімок персоналу не займає місце, на якому вже сидить клієнт', async () => {
  const memberships = [
    { userId: 'owner-uid', role: 'owner' },
    { userId: 'both-uid', role: 'client_admin' },
    { userId: 'agent-uid', role: 'member' },
  ];

  // Та сама пошта — один акаунт qTicket, і роль у членстві одна. Тому це не
  // «дві ролі», а заміна однієї на іншу: адмін дістає кожен проєкт організації,
  // тобто черги всіх інших клієнтів.
  const collisions = clientSeatCollisions({
    candidates: [
      { sourceUserId: 'qt-1', email: 'owner@example.com', role: 'owner', userId: 'owner-uid' },
      { sourceUserId: 'qt-2', email: 'both@example.com', role: 'admin', userId: 'both-uid' },
      { sourceUserId: 'qt-3', email: 'agent@example.com', role: 'member', userId: 'agent-uid' },
      { sourceUserId: 'qt-4', email: 'new@example.com', role: 'member', userId: '' },
    ],
    memberships,
  });
  assert.deepEqual(collisions.map(conflict => conflict.sourceUserId), ['qt-2']);
  assert.equal(collisions[0].currentRole, 'client_admin');
  assert.equal(collisions[0].requestedRole, 'admin');

  // Ніхто інший не зачеплений: чинний персонал лишається персоналом, а нова
  // людина без акаунта в qTicket не може зіткнутися ні з чим.
  assert.deepEqual(
    clientSeatCollisions({
      candidates: [{ sourceUserId: 'qt-3', email: 'agent@example.com', role: 'admin', userId: 'agent-uid' }],
      memberships,
    }),
    [],
  );

  const route = await readFile(
    new URL('../src/app/api/integrations/quickteam/provision/route.js', import.meta.url),
    'utf8',
  );
  // Перевірка йде до `resolveQuickTeamStaff`, бо той створює і переписує акаунти
  // Firebase — після нього відмовляти вже нікому не безкоштовно.
  assert.ok(
    route.indexOf('clientSeatCollisions({') < route.indexOf('resolveQuickTeamStaff('),
    'зіткнення шукається після того, як акаунти вже переписані',
  );
  // Місце не пишеться навіть у гонці: транзакція перепитує документи, які
  // збирається перезаписати.
  assert.match(route, /if \(blockedUserIds\.has\(member\.qTicketUserId\)\) continue;/);
  // Власник — єдине зіткнення, що відмовляє весь знімок.
  assert.match(route, /client_seat_conflict/);
  // І QuickTeam дізнається, чому колега лишився без місця.
  assert.match(route, /\{ conflicts \}/);
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
  // звернення у списку проєкті як активність, якої він не бачив.
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
