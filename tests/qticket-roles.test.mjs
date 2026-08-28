import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { can, invitedRoleFor, rolesFor } from '../src/lib/utils/can.js';

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
  }
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
  const [route, acceptRoute, dialog] = await Promise.all([
    read('../src/app/api/invitations/route.js'),
    read('../src/app/api/invitations/accept/route.js'),
    read('../src/components/InviteMemberDialog.jsx'),
  ]);
  assert.match(route, /const clientInvitee = isClientRole\(safeRole\)/);
  assert.match(route, /exactlyOne: clientInvitee/);
  assert.match(route, /scope: clientInvitee \? 'client-project' : 'organization'/);
  assert.match(route, /restoreArchivedProjects: !clientInvitee/);
  assert.match(acceptRoute, /isClientRole\(invitation\.role\) \? invitation\.role : 'client_member'/);
  assert.match(dialog, /value: 'client_admin'/);
  assert.match(dialog, /internalClientInvite \? \[selectedProjectId\] : \[\]/);
  assert.match(dialog, /ariaLabel="Клієнтський проєкт"/);
  assert.match(dialog, /!clientInvite && !internalClientInvite && !clientAdminMode && <Tabs/);
  assert.match(dialog, /clientInvite \|\| internalClientInvite \|\| tab === 'email'/);
  assert.match(dialog, /clientAdminMode \? presetProjectId : ''/);
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
  const [bridge, sprints, detail] = await Promise.all([
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/lib/hooks/useSprints.js'),
    read('../src/components/workspace/IssueDetail.jsx'),
  ]);
  assert.match(bridge, /const internalViewer = Boolean\(orgRole\) && !isClientRole\(orgRole\)/);
  assert.match(bridge, /useUnreadChatCount\(\{ enabled: internalViewer \}\)/);
  assert.match(bridge, /useUserTimerState\(internalViewer \? userId : null\)/);
  assert.match(sprints, /export function useSprints\(\{ enabled = true \} = \{\}\)/);
  assert.match(detail, /const internalViewer = Boolean\(orgRole\) && !clientViewer/);
  assert.match(detail, /const SHOW_INHERITED_TASK_PLANNING = false/);
  assert.match(detail, /useSprints\(\{ enabled: SHOW_INHERITED_TASK_PLANNING && internalViewer \}\)/);
  assert.match(detail, /SHOW_INHERITED_TASK_PLANNING && internalViewer \? issueId : null/);
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
