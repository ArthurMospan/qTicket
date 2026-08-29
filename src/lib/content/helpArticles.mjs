import { ISSUE_BULK_ACTIONS } from '../bulk/issueBulkActions.mjs';
import { STATUS_CATEGORY_IDS, STATUS_CATEGORIES } from '../utils/statusCategories.mjs';

export const HELP_CATEGORIES = Object.freeze([
  { id: 'start', label: 'Початок роботи', description: 'Організації, ролі, команда й доступ.' },
  { id: 'work', label: 'Робота зі зверненнями', description: 'Клієнтські простори, черга, статуси, поля й файли.' },
  { id: 'collaboration', label: 'Спілкування', description: 'Розмова у зверненні, пошук і сповіщення.' },
  { id: 'trust', label: 'Безпека й підтримка', description: 'Доступ, приватність, видалення та діагностика.' },
]);

export const REQUIRED_HELP_COVERAGE = Object.freeze([
  'organizations-roles-invitations',
  'projects-boards',
  'issue-creation',
  'statuses-categories',
  'issue-fields',
  'kanban-bulk-selection',
  'attachments',
  'chat-mentions',
  'search-shortcuts',
  'profiles-activity',
  'notifications',
  'security-access',
  'support-troubleshooting',
]);

// Controlled product areas cannot silently drift away from the help center.
// Tests verify that every source exists and that its coverage id is backed by
// a valid article. When one of these areas changes, AGENTS.md requires its
// mapped article, news entry and version history to change in the same PR.
export const CONTROLLED_HELP_FEATURES = Object.freeze([
  { id: 'access', coverage: 'organizations-roles-invitations', sources: ['src/lib/context/AppContext.js', 'src/app/api/invitations/route.js', 'src/app/api/invitations/link/route.js'] },
  { id: 'projects', coverage: 'projects-boards', sources: ['src/app/(app)/[projectId]/ProjectBoardClient.jsx', 'src/app/api/projects/route.js'] },
  { id: 'issue-create', coverage: 'issue-creation', sources: ['src/components/CreateTaskModal.jsx', 'src/app/api/issues/route.js'] },
  { id: 'statuses', coverage: 'statuses-categories', sources: ['src/lib/utils/statusCategories.mjs'] },
  { id: 'fields', coverage: 'issue-fields', sources: ['src/lib/hooks/useWorkflowConfig.js'] },
  { id: 'bulk', coverage: 'kanban-bulk-selection', sources: ['src/app/api/issues/bulk/route.js', 'src/lib/hooks/useIssueSelection.js'] },
  { id: 'attachments', coverage: 'attachments', sources: ['src/lib/services/fileUpload.js'] },
  { id: 'chat', coverage: 'chat-mentions', sources: ['src/components/workspace/UnifiedTimeline.jsx'] },
  { id: 'search', coverage: 'search-shortcuts', sources: ['src/components/WorkspaceCommandPalette.jsx'] },
  { id: 'profiles', coverage: 'profiles-activity', sources: ['src/components/profile/ProfileView.jsx'] },
  { id: 'notifications', coverage: 'notifications', sources: ['src/lib/hooks/useNotifications.js'] },
  { id: 'security', coverage: 'security-access', sources: ['src/lib/server/firebaseAdmin.js', 'firestore.rules'] },
  { id: 'support', coverage: 'support-troubleshooting', sources: ['src/components/WorkspaceHelpMenu.jsx'] },
]);

// Who may read an article, from the least access to the most.
//
// `minimumRole` sat on every article from the first commit and nothing ever
// read it, so an external client who opened «Довідка» was handed the support
// team's manual: how to create a client space, how to configure the workflow,
// how to change forty records at once. None of it is a screen they have, and
// the first two are about other customers.
//
// The public `/help` pages are prerendered and served before anyone signs in,
// so their reader is the least privileged reader there is and the catalogue
// they publish is exactly the client's. The support manual is read inside the
// product, where the product knows who is asking.
export const HELP_ROLE_ORDER = Object.freeze([
  'client_member',
  'client_admin',
  'member',
  'admin',
  'owner',
]);

const helpRoleRank = role => {
  const index = HELP_ROLE_ORDER.indexOf(role);
  return index === -1 ? 0 : index;
};

const UPDATED_AT = '2026-08-29';
const categoryNames = STATUS_CATEGORY_IDS.map(id => `${id} — ${STATUS_CATEGORIES[id].label}`);
const QTICKET_BULK_ACTION_IDS = new Set([
  'status',
  'assignees-add', 'assignees-remove', 'assignees-replace', 'assignees-clear',
  'priority', 'priority-clear',
  'labels-add', 'labels-remove', 'labels-clear',
  'type', 'deadline', 'deadline-clear',
  'archive', 'cancel', 'delete',
]);
const bulkActionNames = ISSUE_BULK_ACTIONS
  .filter(action => QTICKET_BULK_ACTION_IDS.has(action.id))
  .map(action => action.label);

// One record, one name. «Звернення» is what the client's portal calls it and
// what the support queue calls it, so it is what these articles call it: a help
// centre that invents a second word for the record has told the reader there
// are two different things.
const HELP_ARTICLE_CATALOGUE = Object.freeze([
  {
    id: 'organizations-and-roles', slug: 'organizations-and-roles', coverage: ['organizations-roles-invitations'],
    title: 'З чого почати й кого запросити', category: 'start', summary: 'Що таке простір підтримки, чим відрізняються внутрішні та клієнтські ролі й як надати доступ.',
    keywords: ['почати', 'організація', 'запросити', 'клієнт', 'співробітник', 'команда', 'роль', 'власник', 'адміністратор', 'учасник', 'посилання', 'запрошення', 'доступ за посиланням'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/overview', '/team', '/settings'], minimumRole: 'member', relatedIds: ['projects-and-boards', 'security-and-access'],
    sections: [
      { id: 'organization', title: 'Організація приходить із QuickTeam', paragraphs: ['Власник активує qTicket у «Налаштуваннях» QuickTeam і обирає внутрішню команду з уже наявних учасників. Назва, логотип і оформлення організації синхронізуються автоматично; робочі дані QuickTeam не копіюються. Працівник відкриває qTicket з QuickTeam без окремої реєстрації. Усередині qTicket власник або адміністратор створює окремий простір для кожного клієнта. Клієнт отримує доступ тільки до свого простору, бачить свої звернення, створює нові й відповідає в обговоренні.'] },
      { id: 'roles', title: 'Пʼять ролей, і чим вони відрізняються', paragraphs: ['Роль визначає дозволені дії та межі доступу. Внутрішні ролі синхронізуються з QuickTeam; клієнтські створюються тільки в qTicket.'], bullets: ['Власник — активує qTicket, обирає працівників у QuickTeam і повністю керує клієнтськими просторами.', 'Адміністратор — створює клієнтські простори та керує статусами, пріоритетами й відповідальними; його доступ до qTicket вмикає власник у QuickTeam.', 'Менеджер підтримки — внутрішній учасник QuickTeam, який працює зі зверненнями в доступних клієнтських просторах.', 'Адміністратор клієнта — бачить і створює звернення тільки у своєму просторі, відповідає в обговоренні та може запросити своїх співробітників.', 'Співробітник клієнта — бачить і створює звернення у своєму просторі та відповідає в обговоренні, але не запрошує інших і не змінює робочий процес.', 'Клієнтські ролі не можуть змінювати статус, пріоритет, відповідального чи налаштування простору.'] },
      { id: 'invites', title: 'Як дати клієнту або колезі доступ', paragraphs: ['Внутрішніх працівників у qTicket не запрошують: власник повертається до «Налаштування → Інтеграції → qTicket» у QuickTeam, обирає чинних учасників і синхронізує команду. Для першого представника клієнта відкрийте «Клієнти» → потрібного клієнта → «Учасники» → «Запросити клієнта»: qTicket уже знає простір і створить доступ адміністратора клієнта. Після входу цей адміністратор може відкрити «Налаштування» → «Співробітники клієнта» → «Запросити співробітника» й додати своїх людей у той самий простір.'], bullets: ['Поки поштову відправку не підключено, qTicket покаже кнопку «Скопіювати інструкцію». Надішліть цей текст людині в месенджері.', 'Людина відкриває вказану сторінку та входить через Google. Email Google-акаунта має точно збігатися з адресою, яку ввели під час запрошення.', 'Після першого входу запрошення приймається автоматично.', 'Клієнтське запрошення відкриває тільки один заздалегідь підготовлений простір і не дає доступу до налаштувань організації.'] },
      { id: 'invite-link', title: 'Коли адреси немає: посилання-запрошення', paragraphs: ['Запрошення поштою потребує точної адреси Google-акаунта наперед. Якщо ви її не знаєте, натисніть «Створити посилання» — на тій самій вкладці «Учасники» для адміністратора клієнта, а в «Налаштування» → «Співробітники клієнта» для його співробітників. Скопіюйте посилання й надішліть у месенджері. Той, хто його відкриє, побачить ваш логотип і назву ще до входу, увійде через Google і одразу отримає доступ.'], bullets: ['Роль і клієнтський простір зафіксовані в момент створення. Змінити їх у вже створеному посиланні неможливо, а внутрішнього доступу воно не видає взагалі.', 'Посилання діє 7 днів і має обмеження на кількість входів. Коли термін або ліміт вичерпано, воно перестає працювати само.', '«Відкликати» вимикає посилання одразу. Уже наданий доступ при цьому не забирається — його знімають у списку людей.', 'Адреса показується один раз. Якщо ви закрили екран, не скопіювавши її, створіть нове посилання.', 'Ставтеся до посилання як до ключа: хто його має, той отримає доступ до цього клієнтського простору.'] },
    ],
  },
  {
    id: 'projects-and-boards', slug: 'projects-and-boards', coverage: ['projects-boards'],
    title: 'Клієнтський простір і черга звернень', category: 'work', summary: 'Як створити простір клієнта й контролювати його звернення в загальній черзі.',
    keywords: ['клієнт', 'простір', 'звернення', 'черга', 'дошка', 'список', 'колонки', 'фільтр', 'архів'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/overview', '/clients', '/my', '/[projectId]'], minimumRole: 'member', relatedIds: ['organizations-and-roles', 'statuses-and-categories'],
    sections: [
      { id: 'project', title: 'Один клієнт — один підготовлений простір', paragraphs: ['Власник або адміністратор відкриває «Клієнти» → «Новий клієнт», створює простір і додає внутрішніх працівників підтримки. Сторінка клієнта має дві вкладки: «Звернення» — черга саме цього клієнта, і «Учасники» — команда клієнта поруч із командою підтримки. Налаштування простору відкриває кнопка-шестерня у шапці сторінки. У вкладці «Учасники» натисніть «Запросити клієнта», щоб надати першому представнику роль адміністратора саме цього простору. Кожне звернення отримує короткий номер на кшталт ACME-12, за яким його зручно називати в розмові.'] },
      { id: 'overview', title: 'Огляд показує, що потребує уваги зараз', paragraphs: ['На «Огляді» зібрані відкриті, нові, активні та нерозподілені звернення, останні оновлення і клієнти з найбільшою відкритою чергою. Натискання на звернення відкриває його розмову, а на клієнта — його окремий простір.'] },
      { id: 'queue', title: 'Одна черга для всієї підтримки', paragraphs: ['Розділ «Звернення» показує записи з усіх доступних клієнтських просторів, а не тільки призначені на вас. Можна перемикатись між дошкою і списком та фільтрувати за клієнтом, статусом, відповідальним, пріоритетом, типом і періодом створення.'] },
      { id: 'board', title: 'Дошка', paragraphs: ['Внутрішня команда бачить звернення колонками за статусом і може перетягувати картку між ними. Клієнт бачить поточний статус, але не керує колонками, пріоритетом чи відповідальним.'] },
      { id: 'filters', title: 'Фільтри можна передати посиланням', paragraphs: ['Вибраний вигляд і фільтри записуються в адресу сторінки. Скопіюйте посилання на чергу — колега відкриє той самий набір звернень. Кнопка «назад» у браузері скасовує останню зміну фільтра.'] },
      { id: 'archive', title: 'Співпраця завершилась', paragraphs: ['Архівуйте простір клієнта в його налаштуваннях. Він зникне з активних списків, але залишиться доступним для перегляду, і його можна повернути. Видалити організацію повністю поки не можна — якщо це потрібно, напишіть у підтримку.'] },
    ],
  },
  {
    id: 'creating-issues', slug: 'creating-issues', coverage: ['issue-creation'],
    title: 'Як створити звернення', category: 'work', summary: 'Нове звернення від клієнта або внутрішньої команди підтримки.',
    keywords: ['створити звернення', 'нове звернення', 'описати проблему', 'номер звернення'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/?new=1', '/[projectId]'], minimumRole: 'client_member', relatedIds: ['issue-fields', 'statuses-and-categories'],
    sections: [
      { id: 'ways', title: 'Хто може створити звернення', paragraphs: ['Звернення створює клієнт — у своєму єдиному клієнтському просторі: описує проблему, додає файли й подальші повідомлення. Підтримка звернення приймає, веде й закриває, але не відкриває його за клієнта: інакше десь у черзі з’явиться запис, про який уже не сказати, хто саме про нього просив.'], bullets: ['Клієнту не пропонуються внутрішні поля керування: статус, пріоритет і відповідальний належать команді підтримки.', 'Після створення відкривається звернення з його спільною розмовою.', 'Поки email-відправку вимкнено, нові запрошення передаються клієнту скопійованою інструкцією через месенджер.'] },
      { id: 'number', title: 'Номер звернення', paragraphs: ['Кожне звернення отримує свій номер у клієнтському просторі — ACME-12, SHOP-4. Номер видається один раз і не змінюється після редагування назви. За ним звернення шукається в пошуку й згадується в розмові через «#».'] },
    ],
  },
  {
    id: 'statuses-and-categories', slug: 'statuses-and-categories', coverage: ['statuses-categories'],
    title: 'Статуси: свої назви, спільний зміст', category: 'work', summary: 'Чому статуси можна називати як завгодно й що при цьому лишається спільним.',
    keywords: ['статус', 'колонка', 'категорія', 'новий', 'прийнято', 'у роботі', 'очікує відповіді', 'вирішено', 'налаштування'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/settings?section=statuses', '/my'], minimumRole: 'member', relatedIds: ['projects-and-boards', 'kanban-and-bulk-actions'],
    sections: [
      { id: 'own-names', title: 'Готовий процес підтримки', paragraphs: ['Новий простір починає з п’яти зрозумілих етапів: «Новий», «Прийнято», «У роботі», «Очікує відповіді», «Вирішено». Власник або адміністратор може перейменувати їх, змінити порядок і кольори або додати власні — у «Налаштуваннях», у розділі статусів.'] },
      { id: 'categories', title: 'Кожен статус має спільний зміст', paragraphs: ['Кожен статус належить до однієї з п’яти стабільних категорій. За ними qTicket будує загальну чергу, визначає відкриті й вирішені звернення та підбирає правильний статус, коли картку перетягують між колонками.'], bullets: categoryNames },
      { id: 'cross-project', title: 'Одна дошка для всіх клієнтів', paragraphs: ['У різних клієнтських просторах статуси можуть називатися по-різному, тому загальна черга групує звернення за категоріями. Перетягування картки записує відповідний статус саме з того клієнтського простору, якому належить звернення.'] },
    ],
  },
  {
    id: 'issue-fields', slug: 'issue-fields', coverage: ['issue-fields'],
    title: 'Пріоритет, тип, мітки й відповідальні', category: 'work', summary: 'Як внутрішня команда класифікує звернення і бере його в роботу.',
    keywords: ['пріоритет', 'тип', 'мітка', 'відповідальний', 'термін вирішення'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/settings?section=priorities', '/settings?section=types', '/settings?section=labels', '/my'], minimumRole: 'member', relatedIds: ['creating-issues', 'kanban-and-bulk-actions'],
    sections: [
      { id: 'fields', title: 'Внутрішні поля звернення', paragraphs: ['Набір пріоритетів, типів і міток налаштовується один раз для всієї організації. Клієнт бачить стан свого звернення, але не керує внутрішніми полями підтримки.'], bullets: ['Пріоритет — наскільки терміново команда має відреагувати.', 'Тип — звернення, помилка або побажання; він допомагає фільтрувати чергу.', 'Мітки — власні ярлики команди підтримки.', 'Відповідальний — внутрішній працівник, який робить наступний крок.'] },
      { id: 'assignees', title: 'Відповідальних може бути кілька', paragraphs: ['Звернення можна призначити одному або кільком працівникам підтримки. Клієнт бачить відповіді команди, але не може змінювати призначення.'] },
    ],
  },
  {
    id: 'kanban-and-bulk-actions', slug: 'kanban-and-bulk-actions', coverage: ['kanban-bulk-selection'],
    title: 'Як змінити багато звернень одразу', category: 'work', summary: 'Вибір кількох звернень і безпечні масові дії з чергою.',
    keywords: ['кілька звернень', 'масово', 'вибрати всі', 'shift', 'змінити всім'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/my'], minimumRole: 'member', relatedIds: ['statuses-and-categories', 'issue-fields'],
    sections: [
      { id: 'selection', title: 'Як вибрати кілька', paragraphs: ['У меню колонки або списку натисніть «Вибрати всі». Після цього на картках зʼявляться прапорці: зайві можна зняти, а інші додати. Утримуйте Shift, щоб вибрати діапазон.'], bullets: ['Escape або «×» знімає вибір.', 'Поки вибір активний, картки не перетягуються.', 'Після зміни фільтра або переходу на інший екран вибір скидається, тому приховані звернення не потраплять у дію.'] },
      { id: 'actions', title: 'Що можна зробити з вибраними', paragraphs: ['Знизу зʼявиться темна панель із діями. qTicket покаже прогрес і окремо повідомить, якщо частину звернень змінити не вдалося.'], bullets: bulkActionNames },
      { id: 'excluded', title: 'Чого масово зробити не можна', paragraphs: ['Змінювати клієнта, опис, файли або повідомлення в розмові можна тільки в одному зверненні за раз. Так контекст одного звернення не потрапить в інші.'] },
    ],
  },
  {
    id: 'attachments', slug: 'attachments', coverage: ['attachments'],
    title: 'Опис і файли звернення', category: 'work', summary: 'Як додати контекст, скриншоти й документи до звернення.',
    keywords: ['опис', 'форматування', 'чекліст', 'файл', 'прикріпити', 'фото', 'документ'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/[projectId]/issue/[issueId]'], minimumRole: 'client_member', relatedIds: ['security-and-access', 'chat-and-mentions'],
    sections: [
      { id: 'description', title: 'Дайте підтримці відтворюваний опис', paragraphs: ['Напишіть, що сталося, якої поведінки очікували і як повторити проблему. Опис підтримує заголовки, списки, посилання, цитати й блоки коду; перемикач «Перегляд» показує результат до збереження.'] },
      { id: 'files', title: 'Додайте докази', paragraphs: ['Перетягніть файл у звернення або натисніть скріпку. Скриншот, відео, документ чи лог доступні тільки учасникам клієнтського простору та внутрішній команді підтримки — пряме посилання сторонній людині файл не відкриє.'] },
      { id: 'file-types', title: 'Перегляд вкладень', paragraphs: ['Фото, PDF, відео й текст відкриваються у перегляді, решту файлів можна завантажити. Ті самі правила доступу діють для вкладень у розмові звернення.'] },
    ],
  },
  {
    id: 'chat-and-mentions', slug: 'chat-and-mentions', coverage: ['chat-mentions'],
    title: 'Розмова у зверненні', category: 'collaboration', summary: 'Одна спільна розмова клієнта й підтримки: відповіді, згадки та вкладення.',
    keywords: ['розмова', 'відповісти', 'згадка', 'тегнути', 'непрочитане', 'обговорити звернення'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/[projectId]/issue/[issueId]'], minimumRole: 'client_member', relatedIds: ['attachments', 'notifications'],
    sections: [
      { id: 'shared', title: 'Одна розмова на всіх', paragraphs: ['Кожне звернення має одну розмову, і вона спільна. Усе, що пише підтримка, читає клієнт: усередині звернення немає прихованих повідомлень і немає перемикача, яким відповідь можна залишити «для своїх». Клієнт також бачить поточний статус звернення.'] },
      { id: 'mentions', title: 'Згадати учасника', paragraphs: ['Наберіть «@» і почніть писати імʼя — зʼявиться список доступних учасників. Згадана людина отримає сповіщення, але згадка не розширює її доступ до чужого клієнтського простору.'] },
      { id: 'reply', title: 'Відповіді й непрочитане', paragraphs: ['Кнопка «Відповісти» привʼязує повідомлення до конкретної репліки. Позначка нового в картці звернення та межа у стрічці допомагають повернутися туди, де ви зупинились. Ваші власні повідомлення не створюють непрочитане для вас.'] },
      { id: 'files', title: 'Файли в розмові', paragraphs: ['Вкладення доступні лише тим, хто має доступ до цього звернення. Фото й документи можна переглянути в інтерфейсі, решту — завантажити.'] },
    ],
  },
  {
    id: 'search-and-shortcuts', slug: 'search-and-shortcuts', coverage: ['search-shortcuts'],
    title: 'Як швидко щось знайти', category: 'collaboration', summary: 'Пошук, командна палітра й гарячі клавіші.',
    keywords: ['пошук', 'знайти', 'палітра', 'гарячі клавіші', 'швидко'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/', '/my'], minimumRole: 'client_member', relatedIds: ['chat-and-mentions', 'profiles-and-activity'],
    sections: [
      { id: 'search', title: 'Пошук', paragraphs: ['Для внутрішньої команди поле вгорі шукає звернення, клієнтські простори й працівників підтримки. Клієнт шукає тільки звернення у своєму просторі. Точний номер звернення виходить першим, потім збіги в темі та описі. Показується лише те, до чого у вас є доступ.'] },
      { id: 'palette', title: 'Командна палітра', paragraphs: ['Ctrl+K (на Mac ⌘K) відкриває палітру. Стрілками ↑↓ вибираєте рядок, Enter відкриває його, Esc закриває вікно. Набір команд залежить від ролі.'], bullets: ['Внутрішня команда може створити клієнта, перейти в Огляд, Звернення, Клієнти, Команду чи Налаштування та змінити організацію.', 'Клієнт бачить тільки свої звернення, створення звернення, власний профіль і — для адміністратора клієнта — співробітників.'] },
      { id: 'shortcuts', title: 'Гарячі клавіші', paragraphs: ['Натисніть «?» у нижньому куті бічної панелі, щоб побачити всі клавіші. Перші дві групи працюють будь-де, решта — там, де написано.'], bullets: ['Ctrl/⌘ + K — відкрити пошук.', 'Esc — закрити вікно, меню або перегляд.', 'Enter — надіслати повідомлення; Shift + Enter — перейти на новий рядок.', '@ — згадати учасника в розмові звернення.'] },
    ],
  },
  {
    id: 'profiles-and-activity', slug: 'profiles-and-activity', coverage: ['profiles-activity'],
    title: 'Команда, історія звернення й непрочитане', category: 'collaboration', summary: 'Профілі підтримки, журнал змін звернення та позначки нового.',
    keywords: ['профіль', 'хто змінив', 'історія', 'прочитано', 'непрочитано', 'нове'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/team', '/settings'], minimumRole: 'member', relatedIds: ['organizations-and-roles', 'notifications'],
    sections: [
      { id: 'profile', title: 'Профілі команди підтримки', paragraphs: ['Натисніть на учасника у «Команді», щоб побачити його роль, клієнтські простори й відкриті звернення. Клієнтські працівники керуються окремо у вкладці «Учасники» свого клієнтського простору й не змішуються з внутрішньою командою.'] },
      { id: 'issue-history', title: 'Хто що змінив у зверненні', paragraphs: ['У стрічці видно автора й зміст кожної відповіді, а також службові події: створення звернення, зміну статусу та відповідального. Клієнт бачить зрозумілий результат роботи, але не отримує внутрішніх контролів робочого процесу.'] },
      { id: 'read-state', title: 'Що тут нового', paragraphs: ['Позначка на картці або в рядку означає, що після вашого останнього перегляду зʼявилась відповідь чи зміна. Ваші власні дії не створюють непрочитане для вас; звернення можна вручну позначити непрочитаним, щоб повернутися до нього пізніше.'] },
    ],
  },
  {
    id: 'notifications', slug: 'notifications', coverage: ['notifications'],
    title: 'Сповіщення в qTicket', category: 'collaboration', summary: 'Які події зʼявляються під дзвіночком і як їх налаштувати.',
    keywords: ['сповіщення', 'дзвіночок', 'повідомлення', 'нагадування', 'вимкнути'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/settings?section=notifications'], minimumRole: 'client_member', relatedIds: ['chat-and-mentions', 'profiles-and-activity'],
    sections: [
      { id: 'channel', title: 'Поки що — всередині застосунку', paragraphs: ['qTicket показує сповіщення під дзвіночком і, за бажанням, короткою карткою та звуком. Пошта навмисно не показується, доки для неї немає підтвердженого домену. Інших каналів доставки продукт не має.'] },
      { id: 'what', title: 'Про що вам повідомлять', paragraphs: ['Призначення звернення, нова відповідь, згадка, зміна статусу та наближення терміну вирішення. Про власні дії сповіщення не створюються.'] },
      { id: 'settings', title: 'Кому це налаштовується', paragraphs: ['Якщо ви заходите в qTicket як представник клієнта, відкрийте «Налаштування» → «Сповіщення» і окремо вимкніть непотрібні типи подій, звук або спливаючу картку. Зміна діє тільки для вашого акаунта.'], bullets: ['Внутрішня команда підтримки такого розділу не має: обліковий запис працівника належить QuickTeam, і qTicket не тримає його другої копії. Працівник отримує стандартний набір — усі пʼять типів подій, звук і спливаючу картку.'] },
    ],
  },
  {
    id: 'security-and-access', slug: 'security-and-access', coverage: ['security-access'],
    title: 'Хто що бачить і що буде з даними', category: 'trust', summary: 'Межі доступу, приватність файлів і видалення.',
    keywords: ['доступ', 'безпека', 'приватність', 'не бачу простір', 'видалити дані', 'архів', 'звільнився', 'забрати доступ', 'вийти з організації'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/settings?section=account', '/privacy'], minimumRole: 'client_member', relatedIds: ['organizations-and-roles', 'support'],
    sections: [
      { id: 'boundaries', title: 'Внутрішня команда і клієнти розділені', paragraphs: ['Власник, адміністратор і менеджер підтримки входять через QuickTeam та працюють тільки з клієнтами, до яких мають доступ. Адміністратор клієнта й співробітник клієнта входять у qTicket окремо та бачать лише свій клієнтський простір. Розмова у зверненні при цьому спільна — у ній немає нічого, що бачить підтримка й не бачить клієнт. Розділені не слова, а керування: клієнт не змінює статус, пріоритет, відповідального чи налаштування організації й не бачить черги інших клієнтів. Навіть спроба відкрити внутрішній огляд, команду або чужу чергу напряму не покаже ці дані; окреме посилання на доступне звернення продовжить працювати.'] },
      { id: 'files', title: 'Файли', paragraphs: ['Вкладення доступне лише учасникам того клієнтського простору, де створено звернення. Пряме посилання, передане сторонній людині, не відкриє файл.'] },
      { id: 'deletion', title: 'Архів, скасування і видалення', paragraphs: ['Архівоване звернення зберігає історію без обмеження часу. Скасоване звернення не рахується відкритою або виконаною роботою. Помилково видалене звернення доступне у «Нещодавно видаленому» протягом 24 годин, після чого відновлення неможливе. Ці дії доступні лише внутрішній команді.'] },
      { id: 'leaving', title: 'Коли людина втрачає доступ', paragraphs: ['Внутрішні місця вмикаються та вимикаються у QuickTeam. Клієнтські місця керуються у вкладці «Учасники» відповідного клієнта. Відкликання доступу не переписує минуле: авторство повідомлень і журнал змін звернень залишаються. Посилання-запрошення відкликається окремо, кнопкою «Відкликати» поруч із ним: воно перестає впускати нових людей, а тих, хто вже увійшов, це не стосується.'] },
    ],
  },
  {
    id: 'support', slug: 'support', coverage: ['support-troubleshooting'],
    title: 'Щось не працює — що робити', category: 'trust', summary: 'Що перевірити самому і як написати в підтримку, щоб швидко допомогли.',
    keywords: ['не працює', 'помилка', 'підтримка', 'написати', 'проблема', 'баг'], updatedAt: UPDATED_AT,
    relatedRoutes: ['/help', '/settings'], minimumRole: 'client_member', relatedIds: ['security-and-access', 'notifications'],
    sections: [
      { id: 'before', title: 'Спершу перевірте це', paragraphs: ['Більшість випадків «зникло» пояснюється контекстом доступу або фільтром.'], bullets: ['Внутрішня команда: чи відкрили ви потрібну організацію у перемикачі ліворуч?', 'Чи не залишився активним фільтр клієнта, статусу, відповідального або періоду?', 'Не бачите клієнта — перевірте у QuickTeam, чи ваш qTicket-доступ увімкнений, і чи вас додали до його команди підтримки.', 'Клієнт не входить — email Google-акаунта має точно збігатися з адресою запрошення.'] },
      { id: 'contact', title: 'Що написати', paragraphs: ['Скопіюйте адресу сторінки, вкажіть час проблеми, номер звернення, свої дії, очікуваний і фактичний результат. Скриншот або коротке відео часто економить кілька уточнень.'], bullets: ['Не надсилайте паролі, секретні ключі й одноразові коди.', 'Канали підтримки відкриваються через «Допомога та інформація». Якщо увійти не вдається, використайте контакти на екрані входу.'] },
    ],
  },
]);

export const HELP_ARTICLES = Object.freeze(HELP_ARTICLE_CATALOGUE.map(article => Object.freeze(article)));

/**
 * The catalogue as one role may read it.
 *
 * `relatedIds` is pruned to the same set: a «Пов’язані матеріали» link into an
 * article the reader cannot open is a dead end, and on the public pages it is a
 * dead end that answers 404.
 *
 * @param {string|null|undefined} role An organization role, or nothing at all
 *   for an anonymous reader — both resolve to the least privileged catalogue.
 */
export function helpArticlesForRole(role) {
  const rank = helpRoleRank(role);
  const visible = HELP_ARTICLES.filter(article => helpRoleRank(article.minimumRole) <= rank);
  const visibleIds = new Set(visible.map(article => article.id));
  return Object.freeze(visible.map(article => Object.freeze({
    ...article,
    relatedIds: article.relatedIds.filter(id => visibleIds.has(id)),
  })));
}

// What `/help` publishes: the pages are prerendered and served to anybody, so
// the reader is unknown and the catalogue is the client's.
export const PUBLIC_HELP_ARTICLES = helpArticlesForRole(null);
export const PUBLIC_HELP_ARTICLE_BY_SLUG = new Map(PUBLIC_HELP_ARTICLES.map(article => [article.slug, article]));
export const PUBLIC_HELP_ARTICLE_BY_ID = new Map(PUBLIC_HELP_ARTICLES.map(article => [article.id, article]));

export function articleSearchText(article) {
  return [
    article.title,
    article.summary,
    ...(article.keywords || []),
    ...(article.sections || []).flatMap(section => [section.title, ...(section.paragraphs || []), ...(section.bullets || [])]),
  ].join(' ').toLocaleLowerCase('uk-UA');
}

export function searchHelpArticles(query, role = null) {
  const articles = helpArticlesForRole(role);
  const words = String(query || '').trim().toLocaleLowerCase('uk-UA').split(/\s+/).filter(Boolean);
  if (!words.length) return articles;
  return articles.filter(article => {
    const text = articleSearchText(article);
    return words.every(word => text.includes(word));
  });
}
