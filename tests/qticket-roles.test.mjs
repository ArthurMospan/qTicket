import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { can, invitedRoleFor, rolesFor } from '../src/lib/utils/can.js';
import { RESERVED_SEGMENTS, isClientPortalRoute } from '../src/lib/utils/clientPortalRoutes.mjs';
import { INCIDENT_TERMS_TABLE } from '../src/lib/content/incidentTerms.mjs';

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

test('сервер приймає від клієнта зміст звернення, але не робочий процес', async () => {
  const route = await read('../src/app/api/issues/route.js');
  assert.match(route, /const clientAuthor = isClientRole\(authorization\.membership\?\.role\)/);
  const projection = route.match(/const data = clientAuthor[\s\S]*?: submittedData;/)?.[0] || '';
  assert.ok(projection, 'проєкція полів клієнта на місці');
  // Те, що знає той, хто має проблему: про що вона, якого роду, наскільки
  // термінова, чим позначена і хто з його боку відповідає.
  for (const field of ['title', 'description', 'type', 'priority', 'labelIds', 'clientAssigneeIds']) {
    assert.match(projection, new RegExp(`\\b${field}: submittedData`), field);
  }
  // Те, що лишається столу підтримки: статус у робочому процесі, власні
  // виконавці, обіцяний термін, ієрархія та оцінка.
  assert.doesNotMatch(
    projection,
    /status: submittedData|columnId: submittedData|assigneeIds: submittedData\b|dueDate: submittedData|parentIssueId: submittedData|estimate/,
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
  // `/` веде клієнта на спільний «Огляд». Виняток один і він змістовний:
  // `?new=1` відкриває композер, а композер живе у просторі, тож цей перехід
  // іде прямо туди — інакше запит, який читач уже попросив, просто зникає.
  assert.match(
    root,
    /router\.replace\(searchParams\?\.get\('new'\) === '1' \? `\/\$\{clientProject\.id\}\?new=1` : '\/overview'\)/,
  );
  assert.doesNotMatch(board, /router\.replace\('\/'\)/);
  // One board, one list, one set of columns; the role decides what is inside.
  assert.match(board, /readOnly=\{clientViewer\}/);
  assert.match(board, /members=\{clientViewer \? \[\] : members\}/);
  assert.match(board, /onBulkUpdate=\{clientViewer \? undefined : handleBulkUpdate\}/);
  assert.match(board, /onMoveIssue=\{clientViewer \? undefined : handleMoveIssue\}/);
  // Only a client opens a request; support receives, works and closes it.
  assert.match(board, /const canOpenIncident = clientViewer && !isReadOnly/);
  assert.match(board, /\{canOpenIncident && \(/);
  assert.equal(INCIDENT_TERMS_TABLE.composerSubmit, 'Створити звернення');
  assert.match(board, /clientMode/);
  // No `entity` prop: the composer had one branch for a «звернення» and one for
  // a «завдання», and only the first was ever rendered. The record has one name,
  // so the composer has one wording and no switch in front of it.
  assert.doesNotMatch(board, /entity=/);
  assert.doesNotMatch(composer, /incidentComposer/);
  assert.match(board, /clientAdminMode/);
  assert.match(board, /useIssues\(scopedProjectId, \{ includeLinks: false \}\)/);
  assert.doesNotMatch(board, /useSprints|AnalyticsTab|QtPlusProjectTab/);
  // The rail is the same component too. A client sees «Огляд» · «Мої звернення»
  // · «Налаштування», and a client administrator one more between them:
  // «Співробітники», the roster they actually administer.
  assert.match(sidebar, /const topNav = clientViewer/);
  assert.match(sidebar, /label: 'Мої звернення'/);
  const clientRail = sidebar.slice(
    sidebar.indexOf('const topNav = clientViewer'),
    sidebar.indexOf(': internalNav;'),
  );
  assert.deepEqual(
    [...clientRail.matchAll(/label: '([^']+)'/g)].map(match => match[1]),
    ['Огляд', 'Мої звернення', 'Співробітники', 'Налаштування'],
  );
  // And that fourth one is conditional on the role, not on the audience: a
  // `client_member` administers nobody, and the route boundary refuses them
  // `/team`, so offering it would be a rail entry that answers with a redirect.
  assert.match(clientRail, /orgRole === 'client_admin'[\s\S]{0,200}href: '\/team'/);
  // «Співробітники» вело на `/settings?section=team` — ту саму адресу, яку
  // рейка налаштувань називає ще раз на екрані, що відкривається. Один
  // напрямок, названий двічі на одному екрані. Дублікат прибрано з іншого
  // боку: реєстр тепер окремий екран, і пункт веде саме на нього.
  assert.doesNotMatch(sidebar, /'\/settings\?section=team'/);
  // The tenant's mark never flips to the vendor's.
  assert.doesNotMatch(sidebar, /rotateY\(180deg\)/);
  assert.match(detail, /const canEditIssue = can\(orgRole, 'edit:issue'\)/);
  // Дві різні відповіді на два різні питання: що на цьому екрані належить
  // столу підтримки, і що належить самому зверненню. Друге тримають обидві
  // сторони — інакше автор не виправить власну ж описку.
  assert.match(detail, /const canEditContent = canWhileRoleLoads\(orgRole, 'edit:issue_content'\)/);
  const clientAttributesStart = detail.indexOf('primaryChildren={clientViewer ? (');
  const internalAttributesStart = detail.indexOf(') : (', clientAttributesStart);
  const clientAttributes = detail.slice(clientAttributesStart, internalAttributesStart);
  // Смуга клієнта — та сама смуга: ті самі клітинки, в тому самому порядку.
  // Різниця рівно одна, і вона змістовна: рухати звернення робочим процесом —
  // робота підтримки, тож «Статус» тут читають, а не змінюють.
  assert.match(clientAttributes, />Статус</);
  assert.match(clientAttributes, />Тип</);
  assert.match(clientAttributes, />Пріоритет</);
  assert.match(clientAttributes, />Відповідальні</);
  // Кого призначили з боку підтримки. Раніше це ховали як внутрішню маршрутизацію
  // — при тому, що ім'я й обличчя агента клієнт читає в розмові на цьому ж
  // екрані. Показуємо, але фактом: кого призначити вирішує стіл.
  assert.match(clientAttributes, />Підтримка</);
  assert.match(clientAttributes, /<MultiSelect\s+compact\s+readOnly/);
  // Той самий контрол, що й у підтримки, тільки без стрілочки: `readOnly`, а
  // не `disabled` — вимкнений контрол обіцяє зміну, якої не буде.
  assert.match(clientAttributes, /readOnlyItemClass[\s\S]{0,200}<Select\s+compact\s+readOnly/);
  // І жодного способу той статус змінити.
  assert.doesNotMatch(clientAttributes, /handleStatusChange/);
  const clientStatusCell = clientAttributes.slice(
    clientAttributes.indexOf('readOnlyItemClass'),
    clientAttributes.indexOf('Тип'),
  );
  assert.doesNotMatch(clientStatusCell, /onChange=/);
  // Решта — контроли, бо це зміст звернення, а не робочий процес.
  assert.match(clientAttributes, /<Select[\s\S]{0,400}EDITABLE_TYPES/);
  assert.match(clientAttributes, /prioritySelectOptions\(PRIORITIES\)/);
  // Те, що лишається столу підтримки цілком: обіцяний термін. Дата, яку клієнт
  // прочитав, — це обіцянка, а qTicket обіцянок не дає.
  assert.doesNotMatch(clientAttributes, /Виконавці|Спринт|Дедлайн|Термін/);
  // І жодного способу перепризначити: клітинка підтримки не має onChange.
  const clientSupportCell = clientAttributes.slice(
    clientAttributes.indexOf('>Підтримка<'),
    clientAttributes.indexOf('>Відповідальні<'),
  );
  assert.doesNotMatch(clientSupportCell, /onChange=/);
  assert.match(composer, /const submitted = clientMode[\s\S]{0,400}type: form\.type,[\s\S]{0,80}priority: form\.priority,[\s\S]{0,80}labelIds: form\.labelIds/);
});

test('клієнтська сесія не підписується на внутрішні модулі QuickTeam', async () => {
  const [bridge, detail, timeline] = await Promise.all([
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
  ]);
  assert.match(detail, /const internalViewer = Boolean\(orgRole\) && !clientViewer/);
  assert.match(detail, /const SHOW_INHERITED_TASK_HIERARCHY = false/);
  assert.match(detail, /const SHOW_INHERITED_TASK_SHORTCUTS = false/);
  // Розмова інциденту — спільна: клієнт читає все, що там пише підтримка.
  // Роллю відділена не вона, а журнал змін підтримки поруч із нею.
  assert.match(timeline, /const internalViewer = can\(orgRole, 'access:audit_log'\)/);
  assert.match(timeline, /useComments\(issueId, COMMENT_WINDOW \* historyWindow\)/);
  assert.match(timeline, /useAuditLog\(internalViewer \? issueId : null/);
  assert.doesNotMatch(timeline, /Внутрішня нотатка/);
  assert.doesNotMatch(timeline, /internalNotes/);

  // Підписки, які цей тест колись сторожив за роллю, більше не сторожаться за
  // роллю — їх немає ні для кого. Спринти, таймер, timeLogs і корпоративний
  // месенджер пішли разом з екранами, що їх читали, тому перевіряється
  // відсутність, а не прапорець: прапорець можна випадково перевернути, а
  // видалений модуль — ні.
  assert.doesNotMatch(bridge, /useUnreadChatCount/);
  assert.doesNotMatch(bridge, /useUserTimerState/);
  assert.doesNotMatch(detail, /useSprints/);
  assert.doesNotMatch(timeline, /useTimeLogs/);
});

// Один прапорець ховав три різні речі: ієрархію, звʼязки й кнопки, що їх
// створюють. Ієрархія лишається вимкненою назавжди — розділивши звернення
// клієнта на дочірні, ми залишаємо клієнта дивитись на один запис, поки робота
// йде в іншому. Звʼязки — це функція qTicket, і вона повертається, бо дублікат
// є найчастішим відношенням у підтримці, а позначити його було нічим.
//
// Тест сторожить саме розділення: прапорець ієрархії не має права знову
// зʼявитися на шляху звʼязків, а звʼязки не мають права зʼявитися в клієнта.
test('звʼязки живуть за змістом звернення, ієрархія — за прапорцем', async () => {
  const detail = await read('../src/components/workspace/IssueDetail.jsx');

  // Жодного сліду прапорця, який робив дві роботи одночасно.
  assert.doesNotMatch(detail, /SHOW_INHERITED_TASK_PLANNING/);

  // Підписка на звʼязки — одна для обох боків столу: «це те саме, що я писав
  // учора» знає радше клієнт, ніж підтримка.
  assert.match(detail, /useIssueLinks\(issueId\)/);

  // Ієрархія лишається за прапорцем у всіх трьох своїх місцях: хлібна крихта
  // основного звернення, селект «Основне звернення» і блок дочірніх.
  assert.match(detail, /\{SHOW_INHERITED_TASK_HIERARCHY && !clientViewer && parentIssueId && \(/);
  assert.match(detail, /\{SHOW_INHERITED_TASK_HIERARCHY && <div[\s\S]{0,200}Основне звернення/);
  assert.match(
    detail,
    /\{\/\* REAL CHILD ISSUES \*\/\}\s*\{SHOW_INHERITED_TASK_HIERARCHY && !clientViewer && \(childIssues\.length > 0 \|\| showSubInput\) && \(/,
  );
  assert.match(detail, /\{SHOW_INHERITED_TASK_HIERARCHY && !parentIssueId && <Button/);

  // Секція «Звʼязки» відкривається роллю, а не прапорцем.
  const linksStart = detail.indexOf('{/* ISSUE LINKS');
  assert.ok(linksStart > 0, 'секція звʼязків на місці');
  const linksSection = detail.slice(linksStart, detail.indexOf('</DetailSection>', linksStart));
  assert.match(linksSection, /\{\(currentIssueLinks\.length > 0 \|\| showLinkInput\) && \(/);
  assert.match(linksSection, /title="Зв’язки" count=\{currentIssueLinks\.length\}/);
  assert.doesNotMatch(linksSection, /SHOW_INHERITED/);
  // Розривають звʼязок ті самі, хто його ставить — за змістом звернення, а не
  // за роллю. Обидва кінці однаково лишаються в одному клієнтському просторі:
  // це перевіряє серверний маршрут.
  assert.match(linksSection, /canRemove=\{!isArchived && canEditContent\}/);
  assert.doesNotMatch(linksSection, /clientViewer/);

  // Кнопка створення — так само без ролі перед нею.
  assert.match(detail, /<Button\s+aria-label="Додати зв’язок"/);
  assert.doesNotMatch(detail, /\{!clientViewer && <Button\s+aria-label="Додати зв’язок"/);

  // Дублювання й AI-промпт — окреме рішення під власним іменем, а не безбілетні
  // пасажири прапорця ієрархії.
  assert.match(detail, /SHOW_INHERITED_TASK_SHORTCUTS && !isArchived && canEditIssue/);
  assert.match(detail, /SHOW_INHERITED_TASK_SHORTCUTS && canEditIssue/);
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

  assert.match(route, /const CLIENT_ROLES = \['client_admin', 'client_member'\];/);
  assert.match(route, /const isClientViewer = CLIENT_ROLES\.includes/);
  assert.match(route, /isClientViewer[\s\S]{0,260}visibleProjectIds\?\.has\(project\.id\)/);
  assert.match(route, /const events = \[\]/);
  assert.match(paletteHost, /clientViewer[\s\S]{0,80}\? EMPTY_MATCHES/);
});

// «Екран, до якого доходять обидві аудиторії, — це один екран, який знає, хто
// дивиться». Раніше «Огляд» був екраном підтримки: клієнта з нього
// перекидало, тож перший екран продукту мала лише половина його читачів.
test('«Огляд» — один екран, який знає, хто дивиться', async () => {
  const overview = await read('../src/app/(app)/overview/page.js');

  // Ані охоронця, ані порожнього рендера в очікуванні редиректу.
  assert.doesNotMatch(overview, /if \(orgRole && clientViewer\) router\.replace\('\/'\);/);
  assert.doesNotMatch(overview, /if \(clientViewer\) return null;/);
  // Один компонент, дві гілки — не два екрани.
  assert.match(overview, /\) : clientViewer \? \(/);

  const clientHalf = overview.slice(
    overview.indexOf(') : clientViewer ? ('),
    overview.indexOf('\n        ) : (\n', overview.indexOf(') : clientViewer ? (')),
  );
  assert.ok(clientHalf.length > 400, 'клієнтська гілка порожня — зріз узято не там');

  // Три плитки, і саме ці три.
  assert.deepEqual(
    [...clientHalf.matchAll(/label="([^"]+)"/g)].map(match => match[1]),
    ['Відкриті', 'Чекають на вас', 'Вирішені'],
  );
  // «Чекають на вас» рахує `incidentQueueMetrics`, а не сама сторінка: плитка
  // клієнта і плитка підтримки — один факт із двох крісел.
  assert.match(clientHalf, /value=\{metrics\.waitingOnClient\}/);
  assert.doesNotMatch(clientHalf, /lastCommentAuthorId/);

  // Панель — кітовий `TaskRow` без колонки відповідального, а не зібраний
  // вручну рядок із `ListRow` + `TaskIdentity`.
  assert.match(overview, /import TaskRow from '@\/components\/ui\/TaskManagement\/TaskRow';/);
  assert.match(clientHalf, /<TaskRow/);
  assert.match(clientHalf, /showAssignee=\{false\}/);
  assert.doesNotMatch(clientHalf, /<ListRow|<TaskIdentity/);
  // Обгортка — `Surface preset="panel"` з `DetailSection density="panel"`.
  assert.match(clientHalf, /<Surface preset="panel"[\s\S]{0,120}<DetailSection\s+density="panel"/);
  assert.match(clientHalf, /title="Останні оновлення"/);
  assert.match(clientHalf, /description="[^"]+"/);

  // Звернення відкриває тільки клієнт, тож кнопка є в його шапці — і навмисно
  // не існує на боці підтримки.
  assert.match(overview, /actions=\{clientViewer && clientSpace \? \(/);
  assert.match(overview, /\{INCIDENT_TERMS_TABLE\.composerSubmit\}/);
  assert.equal(INCIDENT_TERMS_TABLE.composerSubmit, 'Створити звернення');

  // Жодного відповідального, жодної панелі клієнтів, жодної дати вирішення:
  // дата, яку читає клієнт, — це обіцяний строк, а qTicket його не обіцяє.
  assert.doesNotMatch(clientHalf, /assigneeIdsOf|UserAvatar|memberById/);
  assert.doesNotMatch(clientHalf, /projectSummary|'\/clients'/);
  assert.doesNotMatch(clientHalf, /formatUpdatedAt|dueDate|Оновлено /);

  // Слово підтримки для місця, якого клієнт не обіймає, зникло з екрана, який
  // вони тепер ділять.
  assert.doesNotMatch(overview, /виконавц/i);
  assert.match(overview, /Без відповідального/);
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
  // It is a destination in the rail, not a footnote under the client list: the
  // entry is spliced into `internalNav` between «Команда» and «Налаштування»,
  // under the same gate. Position is the assertion because position was the
  // defect — a row people look for among the destinations, filed below every
  // customer's name.
  assert.match(sidebar, /\.\.\.\(showQuickTeamReturn[\s\S]{0,120}external: true \}\]/);
  const nav = sidebar.match(/const internalNav = \[([\s\S]*?)\n {2}\];/)?.[1] || '';
  assert.ok(nav.indexOf("label: 'Команда'") >= 0);
  assert.ok(nav.indexOf("label: 'Команда'") < nav.indexOf('showQuickTeamReturn'));
  assert.ok(nav.indexOf('showQuickTeamReturn') < nav.indexOf("label: 'Налаштування'"));

  // A neighbouring product is reached by an anchor, never by a client-side
  // route, and it is never drawn as the active row.
  assert.match(sidebar, /const Row = external \? 'a' : Link;/);

  // No diagonal arrow. It was the row's only icon, so the row said «leaving»
  // twice and never said «QuickTeam» — and it shared its slot with the unread
  // counter, which is why the indicator sat differently here than anywhere else
  // in the rail. Asked of the import and of the element, not of the file: an
  // icon named in a comment explaining why it went is not an icon anybody draws.
  assert.doesNotMatch(sidebar, /^\s*ArrowUpRight,\s*$/m);
  assert.doesNotMatch(sidebar, /<ArrowUpRight[\s/>]/);
  assert.match(sidebar, /Повернутися в QuickTeam/);
});

// «Співробітники» в рейці клієнта відкривали «Налаштування», де рейка
// налаштувань називала ту саму адресу вдруге — «Співробітники клієнта» в
// окремій групі. Одна адреса, двічі названа на одному екрані. Реєстр тепер
// один — «/team», — а розділу немає в жодних дверях.
test('керування співробітниками клієнта живе на «/team», а не в налаштуваннях', async () => {
  const [settings, team] = await Promise.all([
    read('../src/app/(app)/settings/page.js'),
    read('../src/app/(app)/team/page.js'),
  ]);

  assert.match(settings, /const CLIENT_SETTINGS_SECTIONS = new Set\(\[[\s\S]{0,180}'account',[\s\S]{0,20}\]\);/);
  assert.doesNotMatch(
    settings.match(/const CLIENT_SETTINGS_SECTIONS = new Set\(\[[\s\S]*?\]\);/)?.[0] || '',
    /'team'/,
  );
  // Немає ні другого набору розділів, ні перейменування в рейці, ні тіла.
  assert.doesNotMatch(settings, /CLIENT_ADMIN_SETTINGS_SECTIONS/);
  assert.doesNotMatch(settings, /label: 'Співробітники клієнта'/);
  assert.doesNotMatch(settings, /group: 'Клієнтський простір'/);
  assert.doesNotMatch(settings, /case 'team':/);
  assert.doesNotMatch(settings, /id: 'team',/);
  assert.doesNotMatch(settings, /InviteMemberDialog/);
  assert.match(settings, /const allowedNav = NAV\.filter\(item => reachableSections\.has\(item\.id\)\);/);

  // Один екран, який знає, хто дивиться: свої співробітники — за складом
  // простору, а не просто за роллю, і запрошення поруч із ними.
  assert.match(team, /const clientViewer = isClientRole\(orgRole\);/);
  assert.match(team, /isClientRole\(member\.role\) && isOnProjectTeam\(clientSpace, member\.id \|\| member\.uid\)/);
  assert.match(team, /orgRole === 'client_admin'\s*&& can\(orgRole, 'invite:client_member'\)/);
  assert.match(team, /title="Запросити співробітника"/);
  // Те саме вікно, що й у клієнтському просторі: пошта на одній вкладці,
  // посилання з QR — на другій. Роль, яку воно видає, лишається client_member.
  assert.match(team, /<InviteMemberDialog[\s\S]{0,220}clientMode/);
  assert.match(team, /projectIds=\{\[clientSpace\.id\]\}/);
  assert.doesNotMatch(team, /clientAdminMode/);
});

// Внутрішній працівник — копія акаунта QuickTeam: імʼя, аватар, мову й роль
// тримає QuickTeam і надсилає їх наново з кожною синхронізацією. Другий
// редактор того самого всередині qTicket програє наступному знімку, тож
// «Особистий профіль», «Локалізація» і «Сповіщення» лишаються тільки в
// клієнтських ролей, чий акаунт належить qTicket.
test('персональні розділи QuickTeam недосяжні внутрішній ролі — ні в рейці, ні за адресою', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  // Two, not three. A name, an avatar and a language arrive in QuickTeam's
  // signed snapshot and are re-sent on the next sync, so a qTicket editor for
  // them is a copy that loses. Notification preferences are not like that at
  // all: `users/{uid}/settings/notifications` is qTicket's own document and
  // QuickTeam holds no copy of it, so removing the panel did not prevent a
  // second editor losing to a sync — it pinned every internal seat to whatever
  // their document already held, with nobody able to change it, on a product
  // whose job is telling support that something arrived.
  assert.match(
    settings,
    /const CLIENT_ONLY_SETTINGS_SECTIONS = new Set\(\[\s*'profile',\s*'localization',\s*\]\);/,
  );
  // «Команда підтримки» не зникла, а переїхала: реєстр — це «Команда», і для
  // персоналу, і для співробітників адміністратора клієнта. Тому стара адреса
  // веде на екран, який тепер тримає відповідь, а не на перший-ліпший розділ
  // рейки. І тільки коли роль справді відома: до відповіді Firestore `myRole`
  // вгадує «member», і здогад відправив би `client_member` на екран, з якого
  // його викине layout.
  assert.match(settings, /const resolvedRole = orgRole \|\| myMemberInfo\?\.role \|\| null;/);
  assert.match(settings, /const knownTeamReader = Boolean\(resolvedRole\) && resolvedRole !== 'client_member';/);
  assert.match(settings, /if \(requestedSection === 'team' && knownTeamReader\) \{\s*router\.replace\('\/team'\);/);
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
  // `/overview` — спільний екран, який знає, хто дивиться, і саме туди веде
  // клієнта вхідні двері `/`. Якщо продукт когось кудись відправляє, межа має
  // це визнавати, інакше сторінка кидає вперед, а layout — назад.
  for (const allowed of ['/', '/overview', '/settings', '/settings/profile', '/client-a/issue/INC-12']) {
    assert.equal(isClientPortalRoute(allowed), true, `${allowed} має лишатися клієнтським маршрутом`);
  }
  for (const denied of ['/my', '/team', '/clients', '/analytics', '/chat']) {
    assert.equal(isClientPortalRoute(denied), false, `${denied} не має відкриватися клієнту`);
  }

  // Один реєстр на дві аудиторії, і межа — єдине місце, де їх розрізняють:
  // адміністратор клієнта відкриває «/team» зі своїми співробітниками,
  // співробітник клієнта не відкриває його взагалі.
  assert.equal(isClientPortalRoute('/team', ['client-a'], 'client_admin'), true);
  assert.equal(isClientPortalRoute('/team', ['client-a'], 'client_member'), false);

  // Своїм простором клієнт користується, чужим — ні, і форма адреси цього не
  // вирішує: `/my` виглядає точно так само. Тому межа звіряє id, а не
  // візерунок. Портал веде клієнта саме сюди — поки цього рядка не було,
  // сторінка кидала його в `/{projectId}`, layout кидав назад, і клієнт не міг
  // відкрити qTicket взагалі.
  assert.equal(isClientPortalRoute('/client-a', ['client-a']), true, 'свій простір відкривається');
  assert.equal(isClientPortalRoute('/client-b', ['client-a']), false, 'чужий простір — ні');
  assert.equal(isClientPortalRoute('/client-a'), false, 'без списку просторів нічого не відкривається');
  // Навіть якби простір назвали як екран, екран лишається екраном.
  assert.equal(isClientPortalRoute('/my', ['my']), false, 'зарезервована назва не стає простором');
  // Те саме для `/overview`: він відкривається як екран, а не як чийсь простір,
  // тому лишається серед зарезервованих назв.
  assert.ok(RESERVED_SEGMENTS.includes('overview'), '«overview» лишається назвою екрана');

  const layout = await read('../src/app/(app)/layout.js');
  assert.match(layout, /!isClientPortalRoute\(pathname, clientProjectIds, orgRole\)/);
  // Поки простори ще вантажаться, нікого не відкидає: рішення на порожньому
  // списку виганяло б клієнта з власного простору при кожному оновленні.
  assert.match(layout, /&& !projectsLoading/);
  assert.match(layout, /router\.replace\(`\/\?org=\$\{encodeURIComponent\(activeOrgId\)\}`\)/);
  assert.match(layout, /if \(clientRouteDenied\) \{[\s\S]{0,360}Повертаємо до порталу підтримки/);
});
