import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { can, invitedRoleFor, rolesFor } from '../src/lib/utils/can.js';
import { isClientPortalRoute } from '../src/lib/utils/clientPortalRoutes.mjs';

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

test('клієнтський інтерфейс створює інцидент і не відкриває керування ним', async () => {
  const [root, portal, board, detail, composer] = await Promise.all([
    read('../src/app/(app)/page.js'),
    read('../src/components/client/ClientIncidentPortal.jsx'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/CreateTaskModal.jsx'),
  ]);
  assert.match(root, /<ClientIncidentPortal/);
  assert.match(portal, /title="Мої звернення"/);
  assert.match(portal, /Створити інцидент/);
  assert.match(portal, /clientMode/);
  assert.doesNotMatch(portal, /Пріоритет|Виконавці|Спринт|Дедлайн/);
  assert.match(board, /if \(clientViewer\) router\.replace\('\/'\)/);
  assert.match(board, /const PROJECT_TABS = \[[\s\S]{0,240}Інциденти[\s\S]{0,120}Люди[\s\S]{0,120}Налаштування/);
  assert.match(board, /clientAdminMode/);
  assert.match(board, /useIssues\(scopedProjectId, \{ includeLinks: false \}\)/);
  assert.doesNotMatch(board, /useSprints|AgileBoard|AnalyticsTab|QtPlusProjectTab/);
  assert.match(board, /entity="incident"/);
  assert.doesNotMatch(board, /clientMode=\{clientViewer\}/);
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
  const [bridge, sprints, detail, timeline] = await Promise.all([
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/lib/hooks/useSprints.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
  ]);
  assert.match(bridge, /const internalViewer = Boolean\(orgRole\) && !isClientRole\(orgRole\)/);
  assert.match(bridge, /useUnreadChatCount\(\{ enabled: internalViewer \}\)/);
  assert.match(bridge, /useUserTimerState\(internalViewer \? userId : null\)/);
  assert.match(sprints, /export function useSprints\(\{ enabled = true \} = \{\}\)/);
  assert.match(detail, /const internalViewer = Boolean\(orgRole\) && !clientViewer/);
  assert.match(detail, /const SHOW_INHERITED_TASK_PLANNING = false/);
  assert.match(detail, /useSprints\(\{ enabled: SHOW_INHERITED_TASK_PLANNING && internalViewer \}\)/);
  assert.match(detail, /SHOW_INHERITED_TASK_PLANNING && internalViewer \? issueId : null/);
  assert.match(timeline, /const internalViewer = can\(orgRole, 'access:internal_notes'\)/);
  assert.match(timeline, /useComments\(issueId, COMMENT_WINDOW \* historyWindow, \{ includeInternal: internalViewer \}\)/);
  assert.match(timeline, /useAuditLog\(internalViewer \? issueId : null/);
  assert.match(timeline, /useTimeLogs\(\s*internalViewer \? issueId : null,\s*projectId,\s*\)/);
  assert.match(timeline, /Відповідь клієнту/);
  assert.match(timeline, /Внутрішня нотатка/);
});

// Внутрішнє місце в qTicket видає лише підписаний provisioning із QuickTeam.
// Посилання-запрошення з фіксованою роллю `member`/`admin` було другим входом
// повз цю межу: будь-хто з URL отримував staff-доступ, а перевірка
// QuickTeam-керованої організації, яку робить `/api/invitations`, до нього не
// доходила. Тому механізм не «вимкнено» — його немає.
test('qTicket не має самостійного шляху до внутрішнього місця', async () => {
  const dialog = await read('../src/components/InviteMemberDialog.jsx');

  assert.doesNotMatch(dialog, /Менеджер підтримки|Адміністратор'|InviteLinkSection|Посилання та QR/);
  assert.match(dialog, /const invitedRole = clientInvite \? 'client_member' : 'client_admin'/);

  for (const removed of [
    '../src/app/api/invitations/link/route.js',
    '../src/app/api/invitations/link/accept/route.js',
    '../src/app/invite/[token]/page.js',
    '../src/components/InviteLinkSection.jsx',
    '../src/lib/server/inviteLinks.js',
  ]) {
    await assert.rejects(read(removed), { code: 'ENOENT' }, `${removed} має бути видалений`);
  }
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

test('лише client_admin бачить керування співробітниками у налаштуваннях', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  assert.match(settings, /const CLIENT_SETTINGS_SECTIONS = new Set\(\[[\s\S]{0,180}'account',[\s\S]{0,20}\]\);/);
  assert.doesNotMatch(
    settings.match(/const CLIENT_SETTINGS_SECTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '',
    /'team'/,
  );
  assert.match(settings, /const CLIENT_ADMIN_SETTINGS_SECTIONS = new Set\(\[[\s\S]{0,100}'team'/);
  assert.match(settings, /clientAdmin\s*\? CLIENT_ADMIN_SETTINGS_SECTIONS\s*:\s*CLIENT_SETTINGS_SECTIONS/);
  assert.match(settings, /clientViewer && !clientSettingsSections\.has\(qTicketSection\)/);
  assert.match(settings, /label: 'Співробітники клієнта', group: 'Клієнтський простір'/);
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
