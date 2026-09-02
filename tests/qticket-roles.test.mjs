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
  // Ані до місця в підтримці, ані до другого адміністраторського місця своєї
  // компанії. Друге пробували видати 2026-09-02 і того ж дня забрали: видати
  // роль — це половина, друга половина — забрати її назад, а екрана, що знімає
  // адміністратора клієнта, в qTicket немає й не планується. Двері, які лише
  // відчиняються, гірші за зачинені.
  for (const requested of ['owner', 'admin', 'member', 'client_admin', 'client_member', 'anything', '', null, undefined]) {
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
  // Проєкт питається тільки тоді, коли є з чого обирати: адміністратор
  // клієнта може стояти на кількох просторах, і доти «+» біля «Співробітники»
  // просто зникав. Хоч скільки їх у списку, в запит іде рівно один — межу
  // «рівно один» тримає сервер, а діалог не має способу надіслати більше.
  assert.match(dialog, /inviteMember\(normalizedEmail, uid, invitedRole, \[projectId\]\)/);
  assert.doesNotMatch(dialog, /inviteMember\([^)]*projectIds\)/);
});

test('без поштового провайдера клієнт отримує ручну інструкцію, а не недоступну вкладку', async () => {
  const [dialog, login] = await Promise.all([
    read('../src/components/InviteMemberDialog.jsx'),
    read('../src/app/login/page.js'),
  ]);
  assert.match(dialog, /Запрошення підготовлено без листа/);
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
    /router\.replace\(wantsComposer && clientProject \? `\/\$\{clientProject\.id\}\?new=1` : '\/overview'\)/,
  );
  assert.doesNotMatch(board, /router\.replace\('\/'\)/);
  // One board, one list, one set of columns; the role decides what is inside.
  assert.match(board, /readOnly=\{clientViewer\}/);
  assert.match(board, /members=\{clientViewer \? projectMembers : members\}/);
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
  // «Співробітники», the roster they actually administer. «Мої звернення» has
  // a single address only while there is a single project; holding several
  // turns it into «Проєкти», which is a real screen for them now.
  assert.match(sidebar, /const topNav = clientViewer/);
  assert.match(sidebar, /label: 'Мої звернення'/);
  const clientRail = sidebar.slice(
    sidebar.indexOf('const topNav = clientViewer'),
    sidebar.indexOf(': internalNav;'),
  );
  assert.deepEqual(
    [...clientRail.matchAll(/label: '([^']+)'/g)].map(match => match[1]),
    ['Огляд', 'Мої звернення', 'Проєкти', 'Співробітники', 'Налаштування'],
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
  // Обидві клітинки називають СТОРОНУ, а не поле. «Відповідальні» означало
  // `assigneeIds` у підтримки і `clientAssigneeIds` у клієнта — одне слово, два
  // різні поля, тож агент і клієнт, кажучи одне й те саме, говорили про різних
  // людей. Перша спроба це звести поставила обом «Відповідальні клієнта» —
  // тобто сказала клієнтові «відповідальні клієнта» про нього самого; друга
  // поставила обом «Від клієнта», що каже те саме коротше.
  //
  // Сторону не можна назвати нізвідки: немає слова, яке з обох крісел означає
  // «вони». Тож клітинка називається з того крісла, у якому її читають, і
  // рівно одним виразом на три місця — смугу, її вузький варіант і мобільний
  // лист. Ім'я запису при цьому лишається одне для всіх; це правило про запис,
  // а не про сторони.
  assert.match(clientAttributes, />\{clientSideLabel\}</);
  assert.match(
    detail,
    /const clientSideLabel = clientViewer \? 'Ваша команда' : 'Від клієнта';/,
  );
  assert.doesNotMatch(clientAttributes, />Відповідальні</);
  // Кого призначили з боку підтримки. Раніше це ховали як внутрішню маршрутизацію
  // — при тому, що ім'я й обличчя агента клієнт читає в розмові на цьому ж
  // екрані. Показуємо, але фактом: кого призначити вирішує стіл.
  assert.match(clientAttributes, />Підтримка</);
  // І не ховається на вузькому екрані. Ховалась: смуги мали однакову КІЛЬКІСТЬ
  // клітинок під `lg` і різний зміст, тож клієнт на вузькому ноутбуці втрачав
  // відповідь на «хто цим займається», а агент поруч — ні.
  const clientSupportCellStart = clientAttributes.indexOf('>Підтримка<');
  assert.doesNotMatch(
    clientAttributes.slice(Math.max(0, clientSupportCellStart - 400), clientSupportCellStart),
    /max-lg:hidden \$\{readOnlyItemClass\}/,
  );
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
    clientAttributes.indexOf('>{clientSideLabel}<'),
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

  // Діалог пропонує рівно дві ролі, і обидві клієнтські. Внутрішнє місце —
  // QuickTeam-ове, і його тут не називають ані в списку варіантів, ані в
  // жодному рядку копії. «Посилання та QR» колись стояло в цьому переліку як
  // третій спосіб сказати «це не діалог QuickTeam», і це був хибний маркер:
  // вкладка справді показує посилання й QR-код. Не має зʼявлятись саме роль.
  assert.match(dialog, /const CLIENT_ROLE_OPTIONS = \[/);
  for (const option of ["value: 'client_member'", "value: 'client_admin'"]) {
    assert.ok(dialog.includes(option), option);
  }
  for (const internal of ["value: 'member'", "value: 'admin'", "value: 'owner'", 'Менеджер підтримки']) {
    assert.ok(!dialog.includes(internal), internal);
  }
  // Одна форма для обох читачів: ті самі дві картки, і хто відкрив діалог,
  // вирішує лише те, яку з них можна натиснути. Адміністратору клієнта з двох
  // видається одна; друга стоїть вимкненою — не схованою, бо «а чи можу я
  // зробити колегу адміністратором?» — питання, з яким приходять, і картка
  // коротше за все каже, де відповідь. Підтримці відкриті обидві, і місце
  // адміністратора запропоноване першим: новому проєкту потрібен саме він.
  assert.match(dialog, /value: 'client_admin',[\s\S]{0,400}clientLocked: true,/);
  assert.match(dialog, /const locked = clientInvite && Boolean\(option\.clientLocked\)/);
  assert.match(dialog, /disabled=\{locked\}/);
  assert.match(dialog, /onClick=\{locked \? undefined :/);
  assert.doesNotMatch(dialog, /\{clientInvite \? \(\s*<section>/);
  // Відповідь адміністратора клієнта не читається взагалі — сервер її фіксує,
  // тож і діалог не вдає, що вона щось важить.
  assert.match(dialog, /const invitedRole = clientInvite \? 'client_member' : role/);
  assert.match(dialog, /useState\(clientInvite \? 'client_member' : 'client_admin'\)/);

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

  // Панель — стрічка подій, а не список записів. `TaskRow`, відсортований за
  // `updatedAt`, відповідав «щось змінилося» і на цьому спинявся, а `updatedAt`
  // взагалі не про дію: перетягування картки перенумеровує всю колонку. Рядки
  // читають `lastActivity*`, які пишуть навмисно.
  assert.match(overview, /issueActivityFeed/);
  assert.match(clientHalf, /<ActivityRow/);
  assert.doesNotMatch(clientHalf, /<TaskRow/);
  // Клієнту не називають, хто саме з підтримки діяв: `issueActivityFeed`
  // віддає такий рядок без імені й без обличчя, і `ActivityRow` не малює
  // кружечок на місці людини, якої немає.
  assert.match(overview, /clientViewer, memberById/);
  assert.doesNotMatch(clientHalf, /showAssignee=\{false\}/);
  assert.doesNotMatch(clientHalf, /<ListRow|<TaskIdentity/);
  // Обгортка — сіра `Surface preset="panel"`, а на ній біла `nested-card` з
  // `DetailSection`: той самий шар, що й «Аналітика» проєкту та «Аналітика» в
  // QuickTeam. Доти тут був сірий слаб просто на білому.
  assert.match(clientHalf, /<Surface preset="panel"/);
  assert.match(clientHalf, /<Surface preset="nested-card"[\s\S]{0,120}<DetailSection/);
  assert.ok(
    clientHalf.indexOf('<Surface preset="panel"') < clientHalf.indexOf('<Surface preset="nested-card"'),
    'біла картка має лежати на сірій панелі, а не навпаки',
  );
  assert.match(clientHalf, /title="Останні дії"/);
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
  // Заборонена саме ДАТА ВИРІШЕННЯ: та, яку читає клієнт, — це обіцяний строк,
  // а qTicket його не обіцяє. `formatUpdatedAt` стояло тут як замінник цього
  // правила і ним не є: воно форматує час події у стрічці — «12 черв, 14:20»
  // біля «Нова відповідь у зверненні», — а час того, що вже сталося, клієнт
  // читає у власній розмові й так.
  assert.doesNotMatch(clientHalf, /dueDate|Оновлено /);

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
  assert.doesNotMatch(settings, /group: 'Проєкт'/);
  assert.doesNotMatch(settings, /case 'team':/);
  assert.doesNotMatch(settings, /id: 'team',/);
  assert.doesNotMatch(settings, /InviteMemberDialog/);
  assert.match(settings, /const allowedNav = NAV\.filter\(item => reachableSections\.has\(item\.id\)\);/);

  // Один екран, який знає, хто дивиться: свої співробітники — за складом
  // простору, а не просто за роллю, і запрошення поруч із ними.
  assert.match(team, /const clientViewer = isClientRole\(orgRole\);/);
  // Scoped by the projects this person is on, not merely by role — and by all
  // of them: a client may hold more than one project since 2026-09-01, and
  // «the first one» would have shown an administrator of two the colleagues of
  // one with no way to tell which.
  assert.match(team, /clientSpaces\.some\(space => isOnProjectTeam\(space, member\.id \|\| member\.uid\)\)/);
  assert.match(team, /orgRole === 'client_admin'\s*&& can\(orgRole, 'invite:client_member'\)/);
  assert.match(team, /title="Запросити співробітника"/);
  // Те саме вікно, що й у клієнтському просторі: пошта на одній вкладці,
  // посилання з QR — на другій.
  assert.match(team, /<InviteMemberDialog[\s\S]{0,220}clientMode/);
  // Усі простори цього адміністратора, а не один. Кнопка зникала, щойно їх
  // ставало двоє — і чим більше проєктів вела людина, тим менше могла; питання
  // «в який?» тепер ставить сам діалог.
  assert.match(team, /projects=\{clientSpaces\}/);
  assert.match(team, /&& clientSpaces\.length > 0;/);
  assert.doesNotMatch(team, /clientSpaces\.length === 1 \? clientSpaces\[0\] : null/);
  assert.doesNotMatch(team, /clientAdminMode/);
});

// Внутрішній працівник — копія акаунта QuickTeam: імʼя, аватар, мову й роль
// тримає QuickTeam і надсилає їх наново з кожною синхронізацією. Другий
// редактор того самого всередині qTicket програє наступному знімку, тож
// «Особистий профіль», «Локалізація» і «Сповіщення» лишаються тільки в
// клієнтських ролей, чий акаунт належить qTicket.
test('персональні розділи QuickTeam недосяжні внутрішній ролі — ні в рейці, ні за адресою', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  // None, now — and the three entries this set once held came out for three
  // different reasons, which is the point.
  //
  // «Сповіщення» left on 2026-08-31: `users/{uid}/settings/notifications` is
  // qTicket's own document, QuickTeam holds no copy of it, and removing the
  // panel pinned every internal seat to whatever their document already held
  // with nobody able to change it. «Локалізація» is the same mistake found a
  // day later — the provisioning contract carries `name`, `email` and `avatar`
  // and no time zone at all, so there was never a copy to lose to. And
  // «Особистий профіль» is the one where the reasoning held and the control did
  // not: those three fields really are re-written on every sync, so the section
  // is read-only rather than gone. A locked field answers «яке в мене імʼя»; a
  // missing screen does not.
  assert.match(settings, /const CLIENT_ONLY_SETTINGS_SECTIONS = new Set\(\[\]\);/);
  // Staff read their profile; only a client edits one.
  assert.match(settings, /case 'profile': return clientViewer \? \(/);
  assert.match(settings, /Профіль керується в QuickTeam/);
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

// The one fact qTicket withholds from a customer, and it was withheld nowhere.
//
// ROADMAP has said since 2026-08-31 that the resolution date is not shown to
// the client — a date they can read is a promised resolution time, and this
// product promises none. The composer obeyed it. The card, the list row and the
// request's own attribute strip drew it for every reader, so the date was on
// every surface the customer opens; the rule existed only in prose. It was
// found by the owner on 2026-09-02, after the history had been taught to
// withhold it — which had made the product inconsistent in the other direction:
// visible everywhere, and silent about changing.
test('термін вирішення прихований від клієнта на кожній поверхні, а не лише в документації', async () => {
  const [card, row, detail, composer] = await Promise.all([
    read('../src/components/workspace/IssueCard.jsx'),
    read('../src/components/ui/TaskManagement/TaskRow.jsx'),
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/CreateTaskModal.jsx'),
  ]);

  // The chip and the cell are computed, not merely hidden by CSS: an overdue
  // date must not colour a row it is not drawn on.
  for (const source of [card, row]) {
    assert.match(source, /const showDueDate = !isClientRole\(orgRole\);/);
    assert.match(source, /showDueDate \? parseDueDate\(/);
    assert.match(source, /const isOverdue = showDueDate\s*&& isDueDateOverdue\(/);
  }
  // Both halves of the attribute strip — the wide row and the «Деталі» popover
  // that carries the cells which do not fit.
  assert.match(detail, /max-lg:hidden \$\{attributeItemClass\} \$\{internalViewer \? '' : 'hidden'\}/);
  assert.match(detail, /flex-col gap-1\.5 \$\{internalViewer \? 'flex' : 'hidden'\}/);
  // And the composer, which had it right all along.
  assert.match(composer, /\{!clientMode && \(\s*<div[\s\S]{0,120}Термін вирішення/);
});
