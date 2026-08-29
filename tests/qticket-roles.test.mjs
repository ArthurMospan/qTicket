import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { can, invitedRoleFor, rolesFor } from '../src/lib/utils/can.js';
import { isClientPortalRoute } from '../src/lib/utils/clientPortalRoutes.mjs';
import { INCIDENT_TERMS } from '../src/lib/content/incidentTerms.mjs';

const read = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');

test('клієнтські ролі можуть створити інцидент і відповідати в чаті', () => {
  for (const role of ['client_admin', 'client_member']) {
    assert.equal(can(role, 'create:issue'), true);
    assert.equal(can(role, 'create:comment'), true);
    assert.equal(can(role, 'edit:comment'), true);
  }
});

test('клієнтські ролі не керують інцидентом або налаштуваннями', () => {
  for (const role of ['client_admin', 'client_member']) {
    assert.equal(can(role, 'edit:issue'), false);
    assert.equal(can(role, 'delete:issue'), false);
    assert.equal(can(role, 'edit:project_settings'), false);
    assert.equal(can(role, 'manage:team'), false);
    assert.equal(can(role, 'access:calendar'), false);
  }
});

test('усі calendar API залишаються внутрішнім server-only модулем', async () => {
  for (const role of ['owner', 'admin', 'member']) {
    assert.equal(can(role, 'access:calendar'), true);
  }

  const routePaths = [
    '../src/app/api/calendar/events/route.js',
    '../src/app/api/calendar/events/[eventId]/route.js',
    '../src/app/api/calendar/events/[eventId]/time-logs/route.js',
    '../src/app/api/calendar/reminders/route.js',
    '../src/app/api/calendar/birthday/route.js',
  ];
  for (const path of routePaths) {
    const route = await read(path);
    const authorizationCalls = [
      ...route.matchAll(/authorizeOrgRequest\(\s*([\s\S]*?)\)\s*;/g),
    ];
    assert.ok(authorizationCalls.length > 0, `${path} має авторизувати організацію`);
    for (const [, argumentsSource] of authorizationCalls) {
      assert.match(
        argumentsSource,
        /rolesFor\('access:calendar'\)/,
        `${path} не має приймати клієнтську роль`,
      );
    }
  }

  const rules = await read('../firestore.rules');
  assert.match(
    rules,
    /match \/calendarEvents\/\{eventId\} \{\s*allow read, write: if false;/,
  );
});

test('лише client_admin отримує окреме право запросити співробітника клієнта', () => {
  assert.equal(can('client_admin', 'invite:client_member'), true);
  assert.equal(can('client_member', 'invite:client_member'), false);
  assert.deepEqual(
    [...rolesFor('invite:client_member')].sort(),
    ['admin', 'client_admin', 'owner'],
  );
});

test('client_admin не може підвищити роль через тіло запрошення', () => {
  for (const requested of ['owner', 'admin', 'member', 'client_admin', 'client_member', 'anything']) {
    assert.equal(invitedRoleFor(requested, 'client_admin'), 'client_member');
  }
  assert.equal(invitedRoleFor('client_admin', 'admin'), 'client_admin');
  assert.equal(invitedRoleFor('unknown', 'admin'), 'member');
});

test('сервер приймає від клієнта лише тему та опис інциденту', async () => {
  const route = await read('../src/app/api/issues/route.js');
  assert.match(route, /const clientAuthor = isClientRole\(authorization\.membership\?\.role\)/);
  assert.match(route, /const data = clientAuthor[\s\S]{0,180}title: submittedData\.title,[\s\S]{0,80}description: submittedData\.description/);
  assert.doesNotMatch(
    route.match(/const data = clientAuthor[\s\S]*?: submittedData;/)?.[0] || '',
    /status: submittedData|priority: submittedData|assigneeIds: submittedData|dueDate: submittedData/,
  );
});

test('клієнтське запрошення завжди прив’язане рівно до одного проєкту', async () => {
  const [route, scope, acceptRoute, dialog] = await Promise.all([
    read('../src/app/api/invitations/route.js'),
    read('../src/lib/server/invitationScope.mjs'),
    read('../src/app/api/invitations/accept/route.js'),
    read('../src/components/InviteMemberDialog.jsx'),
  ]);
  assert.match(route, /resolveInvitationScope\(db, \{/);
  assert.match(route, /projectIds: invitedProjectIds/);
  assert.match(route, /restoreArchivedProjects,/);
  assert.match(scope, /if \(clientInvitee && ids\.length !== 1\)/);
  assert.match(scope, /clientScopedInvitation && !snapshot\.data\(\)\.team\?\.includes\(inviterUid\)/);
  assert.match(scope, /scope: clientInvitee \? 'client-project' : 'organization'/);
  assert.match(acceptRoute, /isClientRole\(invitation\.role\) \? invitation\.role : 'client_member'/);
  // Проєкт більше не питається окремо: діалог відкривають або зі сторінки
  // клієнтського проєкту, або з простору самого клієнта, і обидва вже його
  // назвали. `projectIds` іде в запит як є, а сервер тримає межу «рівно один».
  assert.match(dialog, /const invitedRole = clientInvite \? 'client_member' : 'client_admin'/);
  assert.match(dialog, /inviteMember\(normalizedEmail, uid, invitedRole, projectIds\)/);
});

test('без поштового провайдера клієнт отримує ручну інструкцію, а не недоступну вкладку', async () => {
  const [dialog, login] = await Promise.all([
    read('../src/components/InviteMemberDialog.jsx'),
    read('../src/app/login/page.js'),
  ]);
  assert.match(dialog, /Доступ підготовлено без листа/);
  assert.match(dialog, /Скопіювати інструкцію/);
  assert.match(dialog, /\/login\?mode=client/);
  assert.doesNotMatch(dialog, /надішліть\s+посилання з вкладки «Посилання та QR»/);
  assert.match(login, /Вхід до порталу підтримки/);
  assert.match(login, /NEXT_PUBLIC_STANDALONE_STAFF_LOGIN_ENABLED/);
  assert.match(login, /!clientLogin && <button[\s\S]{0,180}handleOneB/);
  assert.match(login, /GITHUB_LOGIN_ENABLED && <button/);
});

test('клієнт і підтримка бачать один екран, і звернення відкриває клієнт', async () => {
  const [root, board, detail, composer, sidebar] = await Promise.all([
    read('../src/app/(app)/page.js'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/CreateTaskModal.jsx'),
    read('../src/components/WorkspaceSidebar.jsx'),
  ]);
  // There is no second screen for a client any more. `/` is a door into their
  // own space — the same `[projectId]` route support opens.
  assert.doesNotMatch(root, /ClientIncidentPortal/);
  assert.match(root, /router\.replace\(`\/\$\{clientProject\.id\}\$\{suffix\}`\)/);
  assert.doesNotMatch(board, /router\.replace\('\/'\)/);
  // One board, one list, one set of columns; the role decides what is inside.
  assert.match(board, /readOnly=\{clientViewer\}/);
  assert.match(board, /members=\{clientViewer \? \[\] : members\}/);
  assert.match(board, /onBulkUpdate=\{clientViewer \? undefined : handleBulkUpdate\}/);
  assert.match(board, /onMoveIssue=\{clientViewer \? undefined : handleMoveIssue\}/);
  // Only a client opens a request; support receives, works and closes it.
  assert.match(board, /const canOpenIncident = clientViewer && !isReadOnly/);
  assert.match(board, /\{canOpenIncident && \(/);
  assert.equal(INCIDENT_TERMS.client.composerSubmit, 'Створити звернення');
  assert.match(board, /clientMode/);
  assert.match(board, /entity="incident"/);
  assert.match(board, /clientAdminMode/);
  assert.match(board, /useIssues\(scopedProjectId, \{ includeLinks: false \}\)/);
  assert.doesNotMatch(board, /useSprints|AnalyticsTab|QtPlusProjectTab/);
  // The rail is the same component too, with three destinations for a client.
  assert.match(sidebar, /const topNav = clientViewer/);
  assert.match(sidebar, /label: 'Мої звернення'/);
  // The tenant's mark never flips to the vendor's.
  assert.doesNotMatch(sidebar, /rotateY\(180deg\)/);
  assert.match(detail, /const canEditIssue = can\(orgRole, 'edit:issue'\)/);
  assert.match(detail, /internalViewer \? issueId : null/);
  const clientAttributesStart = detail.indexOf('primaryChildren={clientViewer ? (');
  const internalAttributesStart = detail.indexOf(') : (', clientAttributesStart);
  const clientAttributes = detail.slice(clientAttributesStart, internalAttributesStart);
  assert.match(clientAttributes, />Статус</);
  assert.doesNotMatch(clientAttributes, /Виконавці|Спринт|Дедлайн|Пріоритет/);
  assert.match(composer, /const submitted = clientMode[\s\S]{0,180}title: form\.title,[\s\S]{0,80}description: form\.description/);
});

test('клієнтська сесія не підписується на внутрішні модулі QuickTeam', async () => {
  const [bridge, detail, timeline] = await Promise.all([
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
  ]);
  assert.match(bridge, /const internalViewer = Boolean\(orgRole\) && !isClientRole\(orgRole\)/);
  assert.match(bridge, /useUnreadChatCount\(\{ enabled: internalViewer \}\)/);
  assert.match(detail, /const internalViewer = Boolean\(orgRole\) && !clientViewer/);
  assert.match(detail, /const SHOW_INHERITED_TASK_PLANNING = false/);
  assert.match(timeline, /const internalViewer = can\(orgRole, 'access:internal_notes'\)/);
  assert.match(timeline, /useComments\(issueId, COMMENT_WINDOW \* historyWindow, \{ includeInternal: internalViewer \}\)/);
  assert.match(timeline, /useAuditLog\(internalViewer \? issueId : null/);
  assert.match(timeline, /Відповідь клієнту/);
  assert.match(timeline, /Внутрішня нотатка/);

  // Три підписки, які цей тест колись сторожив за роллю, більше не сторожаться
  // за роллю — їх немає ні для кого. Спринти, таймер і timeLogs пішли разом з
  // екранами, що їх читали, тому перевіряється відсутність, а не прапорець:
  // прапорець можна випадково перевернути, а видалений модуль — ні.
  assert.doesNotMatch(bridge, /useUserTimerState/);
  assert.doesNotMatch(detail, /useSprints/);
  assert.doesNotMatch(timeline, /useTimeLogs/);
});

// Внутрішнє місце в qTicket видає лише підписаний provisioning із QuickTeam.
//
// Посилання-запрошення з фіксованою роллю `member`/`admin` було другим входом
// повз цю межу — будь-хто з URL отримував staff-доступ, — і 1717ab1 видалив
// увесь механізм. Клієнтська його половина повернулася: пошта не підключена,
// тож посилання, передане в месенджері, і є підтриманим способом видати
// доступ. Тому перевіряється вже не відсутність файлів, а те, що жоден із них
// не вміє назвати внутрішню роль. Відмова стоїть у трьох місцях, бо зламатися
// можуть три різні речі: маршрут створення, транзакція прийняття і Rules.
test('qTicket не має самостійного шляху до внутрішнього місця', async () => {
  const [dialog, helper, createRoute, acceptRoute, rules] = await Promise.all([
    read('../src/components/InviteMemberDialog.jsx'),
    read('../src/lib/server/inviteLinks.mjs'),
    read('../src/app/api/invitations/link/route.js'),
    read('../src/app/api/invitations/link/accept/route.js'),
    read('../firestore.rules'),
  ]);

  // Діалог і далі не пропонує внутрішньої ролі й не має QR-половини старого
  // механізму: qTicket видає рівно два запрошення.
  assert.doesNotMatch(dialog, /Менеджер підтримки|Адміністратор'|Посилання та QR/);
  assert.match(dialog, /const invitedRole = clientInvite \? 'client_member' : 'client_admin'/);

  // 1. Виписати внутрішню роль неможливо: `isClientRole` — умова, а не
  //    підстраховка, і немає гілки, що повертає щось інше.
  assert.match(helper, /if \(!isClientRole\(requestedRole\)\) throw new Error\('INTERNAL_ROLE_REFUSED'\)/);
  assert.match(helper, /if \(inviterRole === 'client_admin'\) return 'client_member'/);
  assert.doesNotMatch(helper, /return 'member'|return 'admin'|return 'owner'/);

  // 2. Маршрут створення питає саме цю функцію, а не власний список ролей, і
  //    звіряє її з тією самою політикою, що й запрошення поштою.
  assert.match(createRoute, /const safeRole = inviteLinkRole\(role, inviterRole\)/);
  assert.match(createRoute, /resolveInvitationScope/);
  assert.match(createRoute, /if \(scope\.role !== safeRole \|\| scope\.projectIds\.length !== 1\)/);

  // 3. Прийняття перечитує роль із документа з тією ж підозрою: документ, що
  //    каже `admin`, не садить нікого.
  assert.match(acceptRoute, /role = acceptedInviteLinkRole\(invitation\.role\)/);
  assert.doesNotMatch(acceptRoute, /request\.role|body\.role/);

  // 4. Firestore Rules не дають браузеру ані прочитати `tokenHash`, ані
  //    переписати роль у вже створеному посиланні.
  assert.match(rules, /function isInviteLinkInvitation\(data\) \{\s*return data\.get\('type', ''\) == 'link';/);
  assert.match(rules, /allow get: if signedIn\(\) &&\s*!isInviteLinkInvitation\(resource\.data\)/);
  // Умова на документ не захищає запит: браузер, якому відмовили в `get`,
  // отримував той самий документ списком. Тому список закритий геть.
  assert.match(rules, /allow list: if false;/);
  assert.match(rules, /allow update: if isOrgAdminOrOwner\(resource\.data\.organizationId\) &&\s*!isInviteLinkInvitation\(resource\.data\) &&\s*!isInviteLinkInvitation\(request\.resource\.data\)/);

  // Старий помічник із внутрішньою роллю не повернувся під своїм ім'ям.
  await assert.rejects(
    read('../src/lib/server/inviteLinks.js'),
    { code: 'ENOENT' },
    'внутрішній помічник посилань має лишатися видаленим',
  );
});

test('клієнтський глобальний пошук не відкриває людей або події поза його простором', async () => {
  const [route, paletteHost] = await Promise.all([
    read('../src/app/api/search/route.js'),
    read('../src/components/WorkspaceCommandPalette.jsx'),
  ]);

  assert.match(route, /const isClientViewer = \['client_admin', 'client_member'\]\.includes/);
  assert.match(route, /isClientViewer[\s\S]{0,260}visibleProjectIds\?\.has\(project\.id\)/);
  assert.match(route, /const events = \[\]/);
  assert.match(paletteHost, /clientViewer[\s\S]{0,80}\? EMPTY_MATCHES/);
});

test('qTicket shell не повертає таймер QuickTeam у desktop або mobile навігацію', async () => {
  const [sidebar, mobile] = await Promise.all([
    read('../src/components/WorkspaceSidebar.jsx'),
    read('../src/components/MobileNav.jsx'),
  ]);

  for (const source of [sidebar, mobile]) {
    assert.doesNotMatch(source, /timerTargetHref|activeTimer|timerElapsed|stopTimer/);
    assert.doesNotMatch(source, /Зупинити та зберегти|активним таймером/);
  }
  assert.doesNotMatch(mobile, /SheetTimerCapsule/);
});

// Підписаний перехід із QuickTeam замінює запис в історії браузера, тож
// «назад» звідти не працює — рейка несе зворотний вихід. Клієнтові його
// показувати нема куди: у нього немає боку QuickTeam.
test('повернення в QuickTeam бачить лише внутрішня роль провіженої організації', async () => {
  const sidebar = await read('../src/components/WorkspaceSidebar.jsx');

  assert.match(sidebar, /const quickTeamUrl = \(process\.env\.NEXT_PUBLIC_QUICKTEAM_URL \|\| ''\)\.trim\(\)/);
  assert.match(
    sidebar,
    /showQuickTeamReturn = Boolean\(\s*quickTeamUrl && !clientViewer && activeOrg\?\.quickTeam\?\.sourceOrganizationId,/,
  );
  assert.match(sidebar, /\{showQuickTeamReturn && \(/);
  assert.match(sidebar, /Повернутися в QuickTeam/);
});

test('лише client_admin бачить керування співробітниками у налаштуваннях', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  assert.match(settings, /const CLIENT_SETTINGS_SECTIONS = new Set\(\[[\s\S]{0,180}'account',[\s\S]{0,20}\]\);/);
  assert.doesNotMatch(
    settings.match(/const CLIENT_SETTINGS_SECTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '',
    /'team'/,
  );
  assert.match(settings, /const CLIENT_ADMIN_SETTINGS_SECTIONS = new Set\(\[[\s\S]{0,100}'team'/);
  assert.match(settings, /clientAdmin\s*\? CLIENT_ADMIN_SETTINGS_SECTIONS\s*:\s*CLIENT_SETTINGS_SECTIONS/);
  assert.match(settings, /clientViewer\s*\?\s*clientSettingsSections\.has\(item\.id\)/);
  assert.match(settings, /label: 'Співробітники клієнта', group: 'Клієнтський простір'/);
});

// Внутрішній працівник — копія акаунта QuickTeam: імʼя, аватар, мову й роль
// тримає QuickTeam і надсилає їх наново з кожною синхронізацією. Другий
// редактор того самого всередині qTicket програє наступному знімку, тож
// «Особистий профіль», «Локалізація» і «Сповіщення» лишаються тільки в
// клієнтських ролей, чий акаунт належить qTicket.
test('персональні розділи QuickTeam недосяжні внутрішній ролі — ні в рейці, ні за адресою', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  assert.match(
    settings,
    /const CLIENT_ONLY_SETTINGS_SECTIONS = new Set\(\[\s*'profile',\s*'notifications',\s*'localization',\s*\]\);/,
  );
  // Одна відповідь на всі три двері в розділ: рейка, адреса й тіло розділу.
  assert.match(settings, /const reachableSections = useMemo\(/);
  assert.match(settings, /!CLIENT_ONLY_SETTINGS_SECTIONS\.has\(item\.id\) && \(!item\.adminOnly \|\| isAdmin\)/);
  // `?section=` більше не відкриває розділ, якого немає в рейці цієї ролі.
  assert.match(
    settings,
    /reachableSections\.has\(requestedSection\) \? requestedSection : defaultSection/,
  );
  assert.match(settings, /const allowedNav = NAV[\s\S]{0,40}\.filter\(item => reachableSections\.has\(item\.id\)\)/);
  // Стан секції — здогад до того, як прочитано роль; малюється лише досяжне.
  assert.match(
    settings,
    /const activeSection = reachableSections\.has\(chosenSection\) \? chosenSection : defaultSection;/,
  );
  // Видалені разом із їхніми тілами, а не приховані прапорцем.
  assert.doesNotMatch(settings, /case 'positions':|case 'danger':/);
  assert.doesNotMatch(settings, /function PositionItem/);
  assert.doesNotMatch(settings, /case 'integrations':|case 'migration':/);
});

// «Безпека» змішувала своє з чужим: сеанси qTicket — це qTicket, а особа,
// спосіб входу й саме місце в організації приходять із QuickTeam.
test('внутрішня «Безпека» лишає сеанси qTicket і не дублює акаунт QuickTeam', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  const account = settings.slice(settings.indexOf("case 'account': {"), settings.indexOf("case 'archives': {"));

  // Сеанси й вихід із цього пристрою — без ролі: це сесія qTicket.
  assert.match(account, /<GroupLabel\s+label="Пристрої"/);
  assert.match(account, /Вийти з акаунта/);
  // Способи входу, вихід з організації й видалення акаунта — лише клієнтам.
  assert.match(account, /\{clientViewer && \(\s*<Card preset="borderless" padding="lg">\s*<GroupLabel label="Способи входу" \/>/);
  assert.match(account, /\{clientViewer && \([\s\S]{0,40}<>[\s\S]{0,60}label="Вийти з організації"/);
  assert.match(account, /label="Видалення облікового запису"/);
});

test('клієнтська сесія не може відкрити внутрішній workspace прямим URL', async () => {
  for (const allowed of ['/', '/settings', '/settings/profile', '/client-a/issue/INC-12']) {
    assert.equal(isClientPortalRoute(allowed), true, `${allowed} має лишатися клієнтським маршрутом`);
  }
  for (const denied of ['/overview', '/my', '/team', '/clients', '/client-a', '/analytics', '/chat']) {
    assert.equal(isClientPortalRoute(denied), false, `${denied} не має відкриватися клієнту`);
  }

  const layout = await read('../src/app/(app)/layout.js');
  assert.match(layout, /const clientRouteDenied = isClientRole\(orgRole\) && !isClientPortalRoute\(pathname\)/);
  assert.match(layout, /router\.replace\(`\/\?org=\$\{encodeURIComponent\(activeOrgId\)\}`\)/);
  assert.match(layout, /if \(clientRouteDenied\) \{[\s\S]{0,360}Повертаємо до порталу підтримки/);
});
