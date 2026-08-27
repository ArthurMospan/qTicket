# How QuickTeam works

Four subsystems that a change is likely to touch, in one file so that finding
the rule costs one search rather than a guess at a filename. Setup, commands and
the data model are in [../README.md](../README.md); the rules a change must obey
are in [../AGENTS.md](../AGENTS.md); shared UI has its own contract in
[UI_KIT_CONTRACT.md](UI_KIT_CONTRACT.md).

- [Tasks, subtasks, links and accounting](#задачі-підзадачі-звязки-та-облік) — the task model, its execution invariants, time and invoices
- [View state: a screen's filters live in its address](#view-state-a-screens-filters-live-in-its-address) — URL state, the table view
- [What is new to whom: one feed, one cursor](#what-is-new-to-whom-one-feed-one-cursor) — read/unread, the task history feed
- [Notification delivery](#notification-delivery) — the two paths and their guarantees

One-time data migrations are runbooks, not architecture: they live in
[MIGRATIONS.md](MIGRATIONS.md).

---

## Задачі, підзадачі, зв’язки та облік

Цей документ фіксує продуктову й технічну модель QuickTeam. Вона є спільною
для дошки, списків, аналітики, обліку часу, рахунків та інтеграцій.

### Ментальна модель

#### Задача

Кожен робочий елемент зберігається в канонічній колекції `issues` і має власний
ключ, статус, виконавців, оцінку, фактичний час та історію.

Тип (`Фіча`, `Задача`, `Баг`) описує характер роботи, але не створює окремий
рівень ієрархії. `Епік` не доступний для нових задач. Наявні епіки тимчасово
показуються як `Епік (legacy)` до перевіреної міграції.

#### Справжня підзадача

Справжня підзадача — це повноцінний `issue` з `parentIssueId`. Вона має власний
ключ, статус, виконавця, оцінку, фактичний час, коментарі й зв’язки.

Підтримується один новий рівень:

```text
Основна задача
└── Підзадача
```

Основна задача — повноцінна задача зі своєю ціллю, виконавцем, статусом і
власним часом. Підзадачі стоять поруч з нею, а не замість неї: в аналітиці
рахуються всі, і поява підзадачі нічого не забирає з підрахунків. Раніше було
навпаки — задача випадала з усіх чисел, щойно в неї з'являлась дитина, через що
графік уже закритого тижня мінявся заднім числом.

Нову підзадачу не можна зробити батьком іншої задачі. Legacy-дерева більшої
глибини залишаються читабельними в аналітиці, але API не дозволяє поглиблювати
їх.

«Мої завдання» відбирає картки за виконавцем, але їхній лічильник підзавдань
не є персональним. `useAllMyTasks` окремо читає дітей своїх задач пакетами
батьківських ID у межах доступного проєкту (`parentIssueId` і legacy
`parentEpicId`). Діти входять у контекст картки, а не в персональний список;
архівні й скасовані відсікаються так само, як на дошці проєкту. Зміна складу
своїх задач перебудовує дочірні підписки; поки новий контекст не
завантажено, сторінка не показує неповний лічильник як остаточний.

#### Чекліст в описі

Markdown-пункти `- [ ]` — легкий чекліст усередині опису. Вони не мають власних
статусів, виконавців, часу чи аналітики і не блокують завершення задачі.

Старе поле `subtasks[]` не є другим типом підзадачі: воно доступне лише для
читання й може бути явно перенесене в Markdown-чекліст.

### Логічні зв’язки

У даних зберігаються лише три канонічні типи:

- `blocks`: напрямлений зв’язок «джерело блокує ціль»;
- `relates-to`: ненапрямлений зв’язок «пов’язана з»;
- `duplicates`: ненапрямлений зв’язок «дублює».

У UI користувач бачить чотири зрозумілі дії:

- `Блокує` створює `source → target`;
- `Залежить від` створює той самий `blocks`, але з оберненим напрямком;
- `Пов’язана з` створює `relates-to`;
- `Дублює` створює `duplicates`.

Для однієї пари задач існує не більше одного детермінованого документа
`issueLinks`. Напрямок і ID нормалізує сервер; клієнт не пише зв’язки напряму.

### Інваріанти виконання

- Основну задачу не можна завершити, поки відкрита хоча б одна справжня
  підзадача.
- Задачу не можна завершити, поки її блокує незавершена задача.
- Завершену підзадачу можна повторно відкрити лише після повторного відкриття
  завершеної основної задачі.
- Завершений заблокований елемент не дозволяє повторно відкрити його блокер.
- До завершеної основної задачі не можна приєднати відкриту підзадачу.
- До завершеної цілі не можна додати відкритий блокер.
- Зв’язки й ієрархія дозволені лише всередині тієї самої організації та
  проєкту.
- Видалення основної задачі вимагає явної політики для дітей. Поточна безпечна
  політика — підняти дітей на верхній рівень.

Переходи статусів виконує `PATCH /api/issues/:issueId/status`. Він
транзакційно перевіряє workflow, ієрархію, блокери, доступ до проєкту й
перестановку карток. Firestore Rules забороняють клієнту напряму змінювати
`status`, `columnId`, `completedAt` та `order`.

### Аналітика

Кількість, потік, навантаження й списки уваги рахують кожен канонічний
`issues`-документ один раз, включно з основною задачею, що має підзадачі.
Ієрархія не перетворює основну задачу на папку: вона лишається одиницею роботи,
а її прогрес окремо показується як завершені листові нащадки / усі листові
нащадки.

Кожен сирий `timeLogs` документ сумується не більше одного разу. Некоректні
від’ємні, дробові або надмірні значення не впливають на агрегати й не можуть
створюватися новими клієнтськими записами.

#### Один таймер на користувача

Поточний таймер не є станом вкладки. Авторитетний документ
`timerStates/{uid}` має максимум один `active` і максимум один `pending` запис
на обліковий запис. Старт, зупинка й відхилення pending-часу виконуються лише
серверними маршрутами в транзакції; Firestore Rules дозволяють браузеру читати
власний документ, але забороняють усі прямі записи. Тому дві вкладки, два
пристрої або дві організації не можуть мовчки перезаписати один одного.

Кожна сесія таймера зберігає `organizationId`, тип і id джерела, проєкт та
серверний `startedAt`. Зупинка звіряє очікуваний id: повтор того самого запиту
ідемпотентний, а стара вкладка отримує конфлікт. Офлайн-зупинка тимчасово тримає
тільки `{timerId, requestedAt}` під ключем користувача; reconnect відправляє її
на сервер, який обмежує час моментом старту, моментом reconnect і максимум
дванадцятьма годинами.

Збереження pending-часу й створення `timeLogs` — одна транзакція з
детермінованим id за timer session. Повтор запиту повертає вже створений лог і
не додає хвилини до денного підсумку вдруге. Logout/account switch очищає лише
екранний стан; серверний таймер нового акаунта завантажується окремим слухачем.

Відлік у браузері використовує server-clock offset з `/api/timer/clock`, а не
різницю між `startedAt` і голим `Date.now()`. Тому зміщений локальний годинник
не додає секунди на старті й не спотворює offline stop intent. Звичайна online
зупинка взагалі не передає клієнтський timestamp: момент фіксує сервер.

`taskMinutes` і `eventMinutes` — дві частини одного факту: реально
зафіксованого часу. Заплановані `startAt` / `endAt` події не підміняють лог і не
додаються до діаграми часу.

Новий time-log зберігає `sourceTitle`, а task-log також `sourceKey`. На живому
джерелі інтерфейс показує актуальну назву, snapshot є лише запасним підписом на
час між видаленням джерела й фінальним purge або для незмінного облікового
сліду. Запис часу не повинен ставати безіменним через порядок фонової чистки.

Період закриття й цикл використовують тільки явний достовірний `completedAt`.
`updatedAt` не є запасною датою завершення: редагування закритої задачі не
закриває її повторно. Legacy-задачі YouTrack без маркера `importedAt` також не
потрапляють у ці метрики, бо старий імпортер міг записати час міграції замість
дати завершення у джерелі. Вони залишаються в історії та загальній кількості,
але не створюють фальшивий сплеск у конкретному періоді.

#### Вікно, а не історія

Задачі — скінченна множина: один документ на одну одиницю роботи. Записи часу —
ні. Один пишеться щоразу, коли хтось зупиняє таймер, кожною людиною, щодня, і
жоден не видаляється. Екран показував «за 30 днів», а читав усе від першого дня
проєкту й відкидав зайве вже в браузері — тобто вартість відкриття росла з
віком робочого простору, а не з розміром періоду.

Тому період — це межа запиту, а не фільтр після нього.
`useWorkspaceAnalytics` не читає жодного логу без явного `timeLogWindow`:
викликач називає проміжок, який збирається малювати, і цей проміжок стає
`where('loggedAt', …)`. Вікна рахує один модуль
`src/lib/utils/analyticsWindow.mjs`, і той самий модуль дає компонентам їхній
власний предикат, щоб межа запиту й межа малювання не розійшлися у дві різні
відповіді:

- «Огляд» і «Команда» — `periodTimeLogWindow`: обраний період,
  вирівняний до локальної півночі. Вирівнювання навмисне: «Огляд» перечитує
  годинник щохвилини, і межа, що рухається разом із ним, перебудовувала б запит
  шістдесят разів на годину;
- «Табель» — `timesheetTimeLogWindow`: рівно той тиждень або місяць, який
  показано. Гортання назад **пересуває** вікно, а не розширює його;
- сторінка учасника читає період для «Огляду» й «Роботи», але перемикається на
  точний тиждень або місяць, щойно відкрито його «Табель»;
- «Рахунок» читає сирі логи свого проєкту власним хуком
  (`useProjectAllTimeLogs`): рахунок — це кожна невиставлена година, а не
  період, і жодний агрегат його не замінює.

Задачі й логи — два окремі підписники всередині хука, бо живуть за різними
годинниками: набір задач змінюється зі зміною проєктів, вікно логів — коли
людина перемикає період або гортає табель. В одному ефекті зміна періоду
перечитувала б усі задачі організації, щоб відповісти на питання про години.

Запит task-логів має дві нерівності — `issueId != ''` і діапазон по `loggedAt`,
— тож складений індекс містить обидва поля: `(organizationId, projectId,
issueId, loggedAt)`. Порядок не на вибір: Firestore добирає індекс за порядком
полів у наборі фільтрів, а не за тим, який діапазон вибірковіший. Варіант
`(…, loggedAt, issueId)` виглядав кращим планом і просто не є індексом, яким цей
запит можна обслужити — прод відповів `FAILED_PRECONDITION` і назвав правильний
порядок.

#### Денні підсумки

Вікно робить вартість пропорційною періоду, але «за 90 днів» по активній
команді — це все ще тисячі документів заради чотирьох чисел. Денний підсумок
проєкту — один невеликий документ, і девʼяносто днів коштують девʼяносто
читань незалежно від того, скільки роботи в них було.

    analyticsRollups/{organizationId}_{projectId}_{YYYY-MM-DD}

Поля: `taskMinutes`, `eventMinutes`, `cancelledTaskMinutes`, `minutesByUser`,
`cancelledMinutesByUser`, `version`. `projectId` порожній для командного часу
календаря без проєкту — та сама межа, яку вже проводять сирі логи й
`firestore.rules`. День береться в часовому поясі організації: до якого дня
належить запис — це факт про робочий простір, а не про того, хто відкрив звіт.

**Похідне, а не джерело правди.** Кожна цифра виводиться з `timeLogs`, і
`scripts/backfill-analytics-rollups.mjs` перебудовує будь-яку з них із нуля
(runbook — у [MIGRATIONS.md](MIGRATIONS.md)). Агрегат без способу відновлення —
це дані, які баг псує назавжди.

**І не гроші.** Рахунок читає точні `sourceTimeLogIds` кожної позиції і не має
права читати підсумок: хвилини, зведені за день, не можуть сказати, які саме
хвилини вже виставлені.

**Дельти, а не інкременти.** Запис часу можна відредагувати й видалити, тож
кожна зміна — це старий запис назовні й новий усередину. 30 хв, виправлені на
45, зсувають день на +15; інкремент нового значення зробив би з двох правок 75.

**Скасування — окрема цифра.** Задачу скасовують після того, як години вже
пораховані, і скасування оборотне. Тому `taskMinutes` лишається тим, що
записали, а `cancelledTaskMinutes` — тією частиною, що належить скасованим
задачам; читач віднімає одне від одного. Повернення задачі — точна інверсія, а
перебудова рахує обидві цифри незалежно, тож розбіжність між ними видно, а не
ховається всередині одного числа. Архівні задачі не коригуються взагалі.

**Лічильників задач тут немає.** Задачі — скінченна колекція, яку екрани
аналітики й так читають заради дощок, відкритих лічильників і списку уваги.
Рахувати їх із підсумку не дало б нічого, зате поставило б другого письменника
на кожен перехід статусу. Без межі росте саме час — його й зводимо.

**Конкуренція.** Firestore тримає ~1 запис на секунду на документ, але цей
документ ніколи не найзавантаженіший у власній транзакції: кожен task-лог і так
пише `issues/{id}` і `projects/{id}`, кожен календарний — `calendarEvents/{id}`
і `projects/{id}`. Документ проєкту приймає логи всіх днів усіх задач проєкту,
підсумок — логи одного дня. Шардити довелося б спочатку `projects/{id}`.
Арифметика погоджується: пʼятдесят людей по десять записів — це пʼятсот записів
на робочий день, розподілених ще й по проєктах.

**Хто що читає.** «Огляд» і «Команда» — це суми, тож вони читають дні: плитки,
«Куди пішов час», колонка часу в «По проєктах», хвилини кожної людини в
командній таблиці. «Продуктивність» описує потік задач і часу не читає.
Календар завантажується лише там, де потрібні назви подій або рахунок, а не при
кожному відкритті аналітики.

Денний підсумок знає проєкт, дату й того, хто списав годину. Він не знає, проти
якої задачі, тож не може відповісти на «час на задачах, призначених Анні», на
пошук чи на фільтр за пріоритетом і типом — це питання про задачі, а не про дні.
Тому агрегат — швидкий шлях, а записи — точний: щойно вмикається такий фільтр,
той самий період читається з логів, за тими самими днями, бо обидві межі дає
один `periodDayRange`.

«Табель» читає записи завжди — це сітка «хто що списав проти якої задачі», а не
сума. «Рахунок» читає сирі логи свого проєкту. Сторінка окремої людини теж читає
записи: вона малює її табель.

Помилка одного обовʼязкового читання зупиняє весь звіт і показує повторну
спробу. Частково прочитані колекції не публікуються як правдивий нуль: нуль —
це результат успішного запиту, а не запасне значення для збою мережі чи
відсутнього індексу.

«За 30 днів» тепер означає тридцять цілих днів у поясі організації, включно з
сьогоднішнім, а не «останні 720 годин». Так підсумок і записи говорять про той
самий проміжок — і так підпис під плиткою нарешті збігається з тим, що
порахували.

Точки запису: `applyTaskTimeLogMutation` (створення, зміна, видалення
task-логу), маршрут календарного часу, маршрут скасування задачі, чистка
tombstone у `issueTrash.js`, каскад видалення проєкту та YouTrack-імпортер.
`tests/analytics-rollups.test.mjs` перевіряє, що жоден із них не змінює хвилини
без підсумку.

### Облік часу задач

- Створення, зміна й видалення task-логів проходять лише через автентифіковані
  серверні API.
- Лог, `issues.spentMinutes` і версія бухгалтерського стану проєкту
  змінюються в одній транзакції.
- Учасник може змінювати лише власні логи; owner/admin — логи учасників свого
  проєкту.
- Лог, який уже потрапив у рахунок, незмінний.
- Legacy-задача з історією логів без підтвердженої версії дзеркала fail-closed
  до явної звірки.

### Рахунки

- Оцінка ніколи не стає грошима: рахунок рахується лише з фактичних логів, а
  робота без зафіксованого часу отримує суму вручну. Джерело `estimate`
  лишилося тільки на вже виставлених рахунках.
- Ієрархія задач на рахунок не впливає: основна задача виставляється за своїм
  фактичним часом так само, як будь-яка інша.
- Фактична позиція рахунку зберігає точні `sourceTimeLogIds`.
- Хвилини позиції на сервері мають точно дорівнювати сумі сирих джерел.
- Після створення рахунку кожне джерело отримує `invoiceId` і `billedAt` та
  стає незмінним.
- Детерміновані reservation-документи і транзакція не дозволяють двом
  паралельним рахункам використати одне джерело.
- Номер рахунку генерує серверна послідовність організації на календарний рік,
  тому два проєкти однієї організації не можуть отримати однаковий номер.
- Новий невиставлений лог тієї самої задачі можна включити в наступний рахунок;
  вже виставлені логи не потрапляють у нову позицію.
- Позиція без фактичних логів резервує сам `itemId`, щоб ту саму роботу не
  виставили двічі.
- Старі рахунки без `itemId` і `sourceTimeLogIds` консервативно блокують задачі
  з тим самим стабільним ключем. Такі збіги потребують ручної звірки, бо
  автоматично вгадати історичні джерела безпечно неможливо.
- Чернетку можна анулювати. Рахунок залишається в історії зі статусом `void`,
  а його точні маркери й reservation-документи звільняються в одній транзакції.

Видалення задачі з виставленими логами блокується, щоб не знищити аудиторський
ланцюжок рахунку.

### Час календарних подій

- Подія без проєкту може мати org-scoped час для командної аналітики, але такий
  час не є позицією рахунку.
- Час події з проєктом належить точному occurrence і може потрапити лише в
  рахунок цього проєкту.
- `eventId`, `occurrenceStartAt` і `projectId` разом утворюють ідентичність
  джерела; їх не можна непомітно змінювати після появи логів.
- Спільний трекінг доступний лише для подій із видимістю `team`. Події
  `participants` і `private` не створюють нових спільних таймлогів, щоб їхній
  опис не витікав у командні аналітичні запити.
- Повторення рахуються в UTC з календарною арифметикою. Точний occurrence
  залишається валідним навіть для щомісячної серії, створеної багато років тому.

### Локалізація системних довідників

Стабільні технічні id залишаються незмінними й англомовними — наприклад,
`backlog`, `in-progress`, `feature`, `meeting`. Користувач бачить українські
назви з усталеним продуктовим сленгом:

- статуси: `Беклог`, `До виконання`, `У роботі`, `Готово`;
- типи: `Фіча`, `Задача`, `Баг`;
- пріоритети: `Блокер`, `Високий`, `Середній`, `Низький`;
- мітки: `Баг`, `Фронтенд`, `Дизайн`;
- посади: `Розробник`, `Дизайнер`, `PM`, `QA`;
- системні типи календаря: `Мітинг`, `Подія`, `Фокус-час`, `Відсутність`,
  `Реліз / етап`, `Нотатка`.

Англійські назви відомих legacy-defaults локалізуються лише за точним
стабільним id. Власні назви організації не перекладаються й не перезаписуються.
Типи календаря є фіксованою семантикою для поведінки та аналітики, але їхні
людські назви локалізовані.

### Серверні точки запису

- `POST /api/issues` — створення задачі або підзадачі;
- `PATCH /api/issues/:id/parent` — зміна основної задачі;
- `PATCH /api/issues/:id/status` — статус і атомарна перестановка;
- `GET|POST|DELETE /api/issues/:id/links` — канонічні логічні зв’язки;
- `POST /api/issues/:id/legacy-checklist` — явне перенесення старого чекліста;
- `POST /api/issues/:id/time-logs` — списання часу на задачу;
- `PATCH|DELETE /api/issues/:id/time-logs/:logId` — зміна або видалення
  невиставленого task-логу;
- `DELETE /api/issues/:id` — ієрархічне видалення;
- `POST|PATCH|DELETE /api/calendar/events/:id/time-logs` — час точного
  occurrence командної події;
- `POST /api/invoices` — перевірений рахунок і резервування джерел;
- `POST /api/invoices/:id/void` — атомарне анулювання чернетки.

### Міграція legacy-даних

Операційні інструкції для ієрархії v2, звірки дзеркала task-часу та
класифікації календарного часу — у [MIGRATIONS.md](MIGRATIONS.md).

---

## View state: a screen's filters live in its address

Filters used to be `useState` mirrored into `localStorage` per device. Three
ordinary things were therefore impossible: a board could not be sent to anyone,
"my daily board" could not exist on two machines, and the browser's Back button
did not undo a filter because nothing had navigated.

The address is now the single source of truth for what a screen is showing.
There is no `useState` copy of a filter anywhere — two sources can disagree, and
one of them is the one you paste into a message.

### The pieces

- `src/lib/utils/viewState.mjs` — pure serialisation and the schemas. No React.
  Covered by `tests/view-state.test.mjs`.
- `src/lib/hooks/useViewState.js` — binds a schema to `useSearchParams` and
  `router.replace`, and remembers the last visit.

```js
const [state, setState] = useViewState(BOARD_VIEW_SCHEMA, {
  storageKey: `qt:view:board:${projectId}`,
  ready: resourceContextReady,
});

setState({ priority: 'high' });   // a patch, never a whole state
```

### The schema

```js
{ key: { default, values?, type?: 'list' } }
```

- `values` declares the closed set a key accepts. Anything else falls back to
  the default: an address outlives what it points at, and a renamed view mode or
  a hand-edited link must still open the screen.
- `type: 'list'` serialises as `a,b,c`. Its default is `[]`.

Shipped schemas: `BOARD_VIEW_SCHEMA`, `MY_TASKS_VIEW_SCHEMA`,
`SPRINTS_VIEW_SCHEMA`. Аналітика має окрему перевірену серіалізацію в
`analyticsUrlState.mjs`: вкладка, проєкти, виконавець, пріоритет, тип, період,
пошук і точний тиждень або місяць табеля переживають перезавантаження та
передаються посиланням. Сторінка учасника успадковує проєкти й період командної
аналітики.

### The four rules

1. **A value equal to its default is absent from the address.** An untouched
   board stays `/PROJ`, not `/PROJ?sprint=all&assignee=all&priority=all`.
2. **A key the schema does not declare is never read and never written.** `org`
   (the organization guard), `new` and `assignee` (the task composer) and
   `member` (the profile overlay) survive a filter change untouched. This is why
   `MY_TASKS_VIEW_SCHEMA` deliberately has no `assignee` key: that address
   already carries `assignee` to pre-fill the composer, and one parameter cannot
   mean two things on one screen.
3. **An address that already says something about the screen is never
   overruled.** That is what makes a shared link show the sender's board rather
   than the reader's habits. Only a bare address restores the previous visit,
   and it restores it *into the address*, so a bookmark always captures what you
   are actually looking at. The whole rule is `restoredViewQuery`, and it is
   tested there rather than inside the hook.
4. **A filter change is `replace`, not `push`.** Clicking through four selects
   must not need four presses of Back to leave the screen; each press undoes one
   filter because `replace` still writes the address the next entry is diffed
   against.

### Deliberate omissions

- **Search is not in the address.** `projectSearch`, `myTaskSearch` and
  `sprintSearch` live in the workspace store and are driven by the header, which
  is shared chrome. Binding a store to the address in both directions is a
  second source of truth, which is the thing this change exists to remove.
- **The old per-filter `localStorage` keys are not migrated.** `qt_board_sprint_*`,
  `qt_board_assignee_*`, `qt_board_priority_*`, `qt_board_type_*` and
  `qt_project_view_*` are no longer read or written. Filters reset once, and the
  alternative was carrying a migration shim indefinitely.
- **`/calendar` is not converted.** Він має окрему лексику дати й режиму
  календаря. `/analytics` уже зберігає власні періоди, вкладки й date anchor у
  своїй адресі.

### The table view

The board's `view` key was the extension point for further readings of the same
tasks, and the table is the first one to use it: `view=table` sits beside
`kanban` and `list`, with four keys of its own.

| key | default | what it says |
| --- | --- | --- |
| `group` | `status` | What a band is: `none`, `status`, `assignee`, `priority`, `type`, `sprint` |
| `sort` | `manual` | Which column orders the rows; `manual` is the board's own order |
| `dir` | `asc` | Direction of that sort |
| `cols` | *(empty)* | Which columns are on; empty means the default six |

Their accepted values come from `src/lib/utils/taskTable.mjs` rather than being
typed into the schema, so adding a column adds a sortable value to the address
in the same change. `taskTable.mjs` also owns the sorting comparators and the
grouping, and is covered by `tests/task-table.test.mjs`; the component in
`src/components/ui/TaskManagement/TaskTableView.jsx` renders what those
functions return and holds none of it.

Four consequences worth stating:

- **The keys stay declared while the kanban is showing.** They belong to the
  screen, not to one of its modes, so switching to the board and back does not
  throw away the columns you chose.
- **`cols` is empty for the default set, not a list of six.** Rule 1 again: an
  untouched table is `?view=table` and nothing else.
- **Column order is not in the address.** `cols` is a set; the table always
  draws the canonical order. What you send somebody is which columns, not a
  layout.
- **The table adds no reads.** It arranges the tasks the board already loaded.
  Sorting and grouping are pure functions over that array, and an edited cell
  goes back through `updateIssue` — the same path a drag on the board takes.

### Extending it

Add a key to a schema; there is nothing else to register.

---

## What is new to whom: one feed, one cursor

A task tells its reader two kinds of news — somebody said something, and somebody
changed something. The product used to treat them as unrelated: messages had a
boundary and a count, changes had a feed entry nobody marked, and the dot on a
card stood for both without saying which.

There is no second data model for this. Everything below rides on what already
existed: the `issues/{id}/audit` subcollection, the per-user cursor in
`organizations/{orgId}/issueReadState/{uid}_{issueId}`, and `lastActivityAt` on
the task document. No new field, no new query, and nothing extra read per row of
a list.

### The pieces

- `src/lib/utils/issueAuditEvents.mjs` — which field changes are worth logging
  (`AUDITED_ISSUE_FIELDS`) and how one reads out (`describeAuditEvent`). Pure, no
  React. Covered by `tests/issue-audit-events.test.mjs`.
- `src/lib/utils/issueReadState.mjs` — the cursor rules: `isIssueUnread` for a
  card, `isIssueChangeUnread` for one line of history, `unreadActivityLabel` for
  what the dot is about. Covered by `tests/issue-read-state.test.mjs`.
- `src/lib/services/issueReadState.js` — the writes: consume on leaving
  (`scheduleIssueSeen` / `cancelScheduledIssueSeen`) and `markIssueUnread`.
- `src/components/IssueReadStateBridge.jsx` — one organization-wide cursor
  listener at the workspace boundary. Unchanged, and the reason a board of five
  hundred cards costs no reads for any of this.
- `src/lib/hooks/useIssueTyping.js` — «друкує…» for a task, on the workspace
  chat's own mechanism (`activeTypingUserIds`, and the TTL and heartbeat beside
  it in `workspaceChat.mjs`). It writes `issues/{issueId}/presence/typing` — a
  document of its own, because the task itself is subscribed to by every board
  and card that shows it and a heartbeat written there would cost each of them a
  read.

### The rules

1. **The list of audited fields lives next to the phrases that read it.** They
   were in different files and drifted: three fields were logged while the
   timeline knew how to say five, so a moved deadline left no trace anywhere in
   the product. Adding a field to `AUDITED_ISSUE_FIELDS` and giving it a label in
   the same module is the whole change.
2. **Nothing names a status, priority, type, label or sprint from a table of its
   own.** `describeAuditEvent` is handed the live workflow, and statuses resolve
   through `statusLabel`. A hard-coded map of seven status ids is what made a
   project that renamed «QA» read somebody else's word for it, and a project that
   added a status read a raw id.
3. **One boundary for the whole feed.** Messages and changes are two kinds of the
   same question — «що тут сталося без мене» — so `UnreadDivider` counts both.
4. **The two halves are consumed differently, on purpose.** A message is read
   when the reader has looked at it for half a second — either the boundary or
   the end of the feed being on screen counts (`readBy` and `readAt.<uid>` per
   comment). A change is read when the reader *leaves the task*, or when either
   of those two observers fires. Rendering the detail used to advance the
   cursor, which broke the one case the boundary exists for: open a task, get
   called away, come back to a task that already counts as read.
5. **Two observers, because there are two ways of reading.** The boundary is the
   landmark for a conversation you came back to. A message that arrives while
   you are already sitting at the bottom of one crosses no line, so the end of
   the feed is observed as well — without it such a message stayed unread for
   good, and a reload drew «Нові повідомлення (1)» over something that had been
   on screen the whole time. Both consume messages and changes together.
6. **Leaving is not the same as unmounting.** Opening a task through a
   non-canonical link replaces the address a beat later and remounts the detail,
   so the consume is scheduled with a short delay and a fresh mount of the same
   task cancels it. A browser killed with a task open leaves it unread — the
   forgiving direction of the two.
7. **Your own activity is never new to you.** The dot, the boundary and the count
   all drop the current user's own entries. It is also why «Позначити
   непрочитаним» is offered only when somebody else acted last: marking your own
   change unread would light nothing.
8. **Marking unread never resets a cursor that already sits further back.** The
   cursor moves to just before the newest activity, so the dot returns and the
   boundary lands on the change that made you want to come back — while older
   changes you never saw stay unseen.
9. **Nothing is read in a tab nobody is looking at.** Both observers stand down
   while `document.visibilityState` is not `visible`, and are rebuilt when it
   returns — an `IntersectionObserver` reports what is on screen the moment it
   starts watching, so coming back to a task left open reads it, and a pane left
   open behind another window reads nothing. The workspace chat has always made
   the same check before moving its cursor.
10. **A message you sent is on screen because you sent it.** The task chat draws
   it immediately, marked as being sent and carrying its own upload progress,
   and the snapshot settles it by the id the write already knew (`addComment`
   returns it; a Firestore transaction is not applied to the local cache, so
   nothing else arrives until the server answers). A failed send leaves the
   message in place, marked and sendable again, rather than taking it away with
   the draft.
11. **The comparison is server clock against server clock.** `audit.createdAt` is
   written by Firestore, and the cursor it is measured against was copied from the
   task's own `lastActivityAt`. That is why the boundary needs no cursor of its
   own and no per-entry timestamp written by a client.

### Deliberate omissions

- **Time logs do not move the boundary.** Logging time deliberately does not
  touch `lastActivityAt` (see the comment in `issueReadState.mjs`), so counting it
  here would draw a line for something no card ever announced.
- **Comments are not audit entries.** A message is its own thing in the feed with
  its own read receipts; mirroring it into the history would be a second copy of
  the same fact.
- **Creating a task is not a change to it.** A new task is new in full; it has no
  fields that changed.
- **Marking a selection read is not implemented.** `ISSUE_BULK_ACTIONS` is a
  server-validated registry of writes to task documents, and a read cursor is a
  document of the user's own in another collection. It would be a client-only
  action wearing a server action's clothes, and it is a separate change.

### Extending it

Add the field to `AUDITED_ISSUE_FIELDS`, give it a label (and a value formatter
if it is not a plain string) in the same module, and write it from wherever that
field is saved. Server routes that already write `lastActivity*` also write their
own audit entry in the same transaction — `api/issues/[issueId]/status` is the
example to copy.

---

## Notification delivery

QuickTeam has two notification paths. They share channel preferences, but their
triggers and reliability guarantees are different.

### Event-driven notifications

Assignments, comments, mentions and chat messages originate in an authenticated
server request. That request writes the in-app notification and immediately
attempts the enabled external channels. No scheduler is involved.

This path is intentionally low-latency and stays that way: the message is
attempted the moment the event happens. A provider that is down no longer ends
there, though. Every recipient whose email or Telegram failed gets a row in the
same `scheduledNotifications` outbox the scheduled reminders use, and the
dispatcher retries it on the usual backoff.

Two details make that row behave: it carries `attempts: 1`, because the request
already spent an attempt and the dispatcher would otherwise read the record it
just wrote as somebody else's delivery and close the row unsent; and it carries
`emailSentAtMs` / `telegramSentAtMs` for whichever channel did succeed, so a
retry sends only what is still owed. The row id is the notification document's
id, which keeps the claim — and therefore the guarantee against a third
delivery — exactly where it already was.

Сповіщення завжди записується; спливне вікно внизу екрана — ні. Панель, яка
показує розмову, публікує її у `visibleConversation` (`{ kind: 'issue' | 'dm' |
'channel', id }`), а `WorkspaceNotificationBridge` питає `isConversationOnScreen`
перед показом картки. Повідомлення, яке щойно прийшло у відкритий чат, не
оголошується карткою поверх самого чату. Виняток — `emergency`, `alert` і
`test`: екстрений виклик має перебивати будь-що.

Розмова, відкрита перед читачем, ще й гасить свої записи у дзвіночку: запис
існує, щоб привести туди, де людини не було. Яку саме розмову називає запис,
відповідає `notificationConversationId` — з поля `channelId`, а для записів,
створених до появи цього поля, з посилання (`/chat?channel=…`, `/chat?dm=…`).

Карток може стояти до трьох, стосом, кожна зі своїми шістьма секундами. Поки
вкладка у фоні, відлік стоїть: картка чекає, доки на неї подивляться, а не
догорає у невидимому вікні.

Лічильник на екрані вибору організації не походить із активного live-вікна і не
покладається на Zustand/localStorage. `GET /api/notifications/unread-counts`
бере uid з перевіреного токена, організації — з `orgMemberships`, а кількість —
через серверні `count()` aggregation queries. Від загального unread віднімаються
лише документи з явним `inapp: false`; legacy-документи без поля лишаються
in-app. Незавершені запити дедуплікуються окремо для кожного uid, тому зміна
акаунта не може опублікувати чужий результат.

### Time-driven notifications

Calendar reminders and deadline notifications use
`scheduledNotifications/{id}`. Each row has its own delivery time, status,
attempt count, per-channel success timestamps and last error. Deterministic row
IDs make repeated materialisation and dispatch idempotent.

**A row is written when the deadline is set, not found by a scan later.** This
is the part that took two attempts to get right, and the first attempt is what
made reminders unaffordable. Asking «is anything due?» costs the whole `issues`
and `calendarEvents` collections, and ninety-nine passes in a hundred pay that
to find nothing. But a reminder is a consequence of a write: somebody types a
deadline, and at that instant it is fully known who has to be told and when.

So every server route that can change that writes the row —
`syncIssueReminderRows` from the task routes, `syncCalendarEventReminderRows`
from the calendar routes. Moving the deadline rewrites the row; finishing,
cancelling, archiving or deleting the task leaves nothing wanted, and what is
pending is cancelled. A task's own fields are still written straight from the
browser, and the browser cannot write this queue — no Firestore rule describes
`scheduledNotifications`, deliberately — so the composer writes the deadline and
then asks `POST /api/issues/{id}/reminders` to recompute from what is stored.
It accepts no body: a route that takes a delivery time is a route that can be
asked to notify anybody at any hour.

The worker therefore runs in three modes, on three schedules, because the three
passes cost three different amounts:

- `dispatch` — every minute. At most 50 pending rows whose `nextAttemptAtMs` is
  due, sent, then recorded as `sent`, `failed` or a backed-off retry. It reads
  no watermark and writes no state, so an idle pass costs one Firestore read.
  This is the only mode that decides how late a reminder is.
- `maintenance` — hourly. Three bounded indexed queries: finalising soft-deleted
  tasks past their undo window, expiring read records, and closing outbox rows
  that are more than seven days past their delivery time. Hourly rather than
  nightly because «Нещодавно видалене» promises twenty-four hours, and a nightly
  pass would stretch that to forty-eight.
- `materialise` — nightly, and now a safety net rather than the mechanism. It
  performs bounded reads of upcoming calendar events and issues, fills the
  outbox 48 hours ahead, corrects moved reminders and cancels pending rows whose
  source is no longer valid. It is what catches a write-time sync that failed,
  or a change made directly in the database.
- `health` — reads the watermark and answers whether anything has run the sweep
  inside `SWEEP_SILENCE_LIMIT_MS` (12 hours). It sweeps nothing and writes
  nothing; a silent sweep is a 503. See «Хто помічає, що розсилка стала» below.
- `full` runs all three working modes; materialisation is internally throttled to
  eleven hours, deliberately below the twelve that separate its two schedules.
  At exactly twelve there is no tolerance at all, and one late delivery from
  GitHub makes the second pass cancel itself — which happened on 27.08.2026 and
  took that day's `recountProjectIssueCounts` with it.

Rows the window can no longer see are closed rather than left pending.
Reconciliation only looks ten minutes back (`REMINDER_LOOKBACK_MS`), so a row
whose moment passed while delivery was down is invisible to it and, once out of
the retry query, to dispatch as well: pending forever, never sent, never
cancelled. `cancelStaleOutboxRows` closes anything more than seven days late.
Seven days rather than the reconciliation window because the two ask different
questions — ten minutes late is a slow scheduler and the reminder is still
wanted; a week late is a reminder about something that is over.

### Хто помічає, що розсилка стала

Between 3 and 27 August 2026 the sweep did not run once: the schedule that
drives it was switched off, and nothing said so. No deadline reminders, no
calendar reminders, no birthday greetings, no emptying of «Нещодавно видалене»,
for twenty-four days. Every part of the system behaved correctly — the watermark
in `system/notificationSweep` was accurate the whole time. It had no reader.

`readSweepHealth` is the reader, and `.github/workflows/sweep-watchdog.yml` is
what asks it, four times a day, on `?mode=health`. A silent sweep answers 503 and
the run goes red, which is a GitHub notification to the repository owner and
needs nothing configured beyond the `CRON_SECRET` the sweep already uses.

It is a separate workflow file on purpose. What happened was that the sweep's own
workflow was disabled; a check living inside it would have been disabled with it.
Twelve hours of silence rather than three, because the watermark is written by
the hourly and nightly passes (dispatch deliberately writes nothing), and an
hourly GitHub `cron` is hourly on a quiet day and three-hourly on a loaded one.

The scan that remains is bounded on both sides. Deadlines are read back one week
(`DEADLINE_FLOOR_MS`), because that is as far as an overdue nag can still reach.
One-off calendar events are read inside the reminder window. Recurring ones used
to have no window at all — a series' start is in the past forever, so the query
read every series ever created — and are now bounded forward by the reminder
lead and capped by `RECURRING_SCAN_LIMIT`, which logs loudly rather than
silently dropping events.

Email and Telegram outcomes are tracked separately. If email succeeds and
Telegram fails, only Telegram is retried; a successful channel is not sent a
second time. Telegram failures are recorded per recipient, so one successful
digest cannot hide another recipient's blocked bot.

A channel the deployment does not have is not a channel that failed. With
neither `RESEND_API_KEY` nor `BREVO_API_KEY` set, `deliverEmail` is a soft no-op
by design — features degrade rather than fall over — and dispatch used to read
that as a failed attempt: the reminder reached the bell, and the row still went
back to `pending` with an error, waited out a backoff, asked the same absent
provider again, and filed itself as `failed` after five rounds. Production held
ten such rows on 27.08.2026, every one already delivered in-app. `emailConfigured()`
is therefore asked once per pass, before any row decides which channels it wants.

The dispatch and materialisation watermarks are also separate. A frequent
dispatch pass therefore cannot shorten the recovery window after the
materialiser was unavailable.

The dispatch query used to run twice on every pass — once on
`nextAttemptAtMs`, once on `deliverAtMs` — to pick up rows written before the
retry-time field existed. A Firestore query that matches nothing still costs a
read, so that compatibility shim was fourteen hundred reads a day for a schema
nobody had written since. It is the index fallback now, and a legacy row still
inside the materialised window is upgraded by the nightly pass instead.

### Hygiene of the record itself

A notification record is not only a notification: with a dedupe key it is also
the claim that says «this person has already been told». That is why nothing
removed read records for so long — deleting a claim is how a reminder gets sent
twice.

`pruneReadNotifications` runs on the hourly `maintenance` pass and
deletes records that are read and older than `READ_NOTIFICATION_TTL_MS` (30
days), bounded to 100 per pass because deletions are writes and the daily write
budget is the tighter of the two free-tier limits. For the two types this outbox
produces — `deadline` and `calendar_reminder` — it first reads the scheduled row
of the same id and keeps the record while that row is still `pending`: a pending
row is a retry in flight, and a retry recreates the document it cannot find.
Every other type came from an event that happened once and cannot repeat, so its
record is only a record. An idle pass is one indexed query that matches nothing.

The bell also draws one row per conversation rather than one per record:
`notificationGrouping.mjs` collapses `commented`, `mentioned` and `chat_message`
by task or channel, so five comments on one task are one line saying «5 нових
повідомлень в QT-12». Read and unread never share a row — a mixed row could not
say whether the dot belongs to it — and every action a row offers reaches every
record it stands for. `assigned` and `status_changed` are deliberately not
grouped: two status changes are two different facts, and a number would hide the
newer one.

### Trigger during hosted testing

`GET /api/cron/notifications` validates `Authorization: Bearer $CRON_SECRET` and
accepts `?mode=full|dispatch|maintenance|materialise|health`.

The free external scheduler is an accepted temporary dependency while QuickTeam
is hosted on test infrastructure. Configure either:

- `?mode=full` every minute (the server self-throttles the expensive work); or
- `?mode=dispatch` every minute and `?mode=materialise` every twenty minutes.

Keep `.github/workflows/scheduled-notifications.yml` only as a fallback. GitHub
scheduled workflows are not punctual enough to be the primary production
trigger. `CRON_SECRET` must be identical in the deployed environment and in
every scheduler that calls the route.

### Trigger after moving to the own server

Run the same worker from a long-lived Node process under the service manager:
call `runScheduledNotificationSweep({ mode: 'full' })` every 30–60 seconds. The
outbox, idempotency and retry logic do not change; only the HTTP scheduler is
removed. For more than one application instance, ensure only one scheduler is
leader or let all instances call the idempotent endpoint with a distributed
claim before outbound delivery.

### Remaining operational visibility

- Show `system/notificationSweep` health and last successful materialisation in
  Settings.
- Show the last successful email/Telegram delivery and terminal channel errors.
- Mark a Telegram connection as needing attention after a permanent recipient
  error.

## Вартість читання

Продакшн живе на жорсткому денному ліміті читань Firestore. Обидва падіння
сервісу сталися не від навантаження, а від трьох рядків коду кожне — і жоден із
них не виглядав дорогим у місці виклику. Тому вартість читання тут описана як
частина архітектури, а не як порада.

### Три способи витратити квоту, які вже траплялись

**Питати сервер там, де відповідь уже була.** Капсула `#QT-12` дізнавалась назву
задачі через `/api/search`. Пошук не може знати, які документи містять слово, —
він читає всі задачі, всі проєкти, всі членства й усі події організації та
ранжує їх у памʼяті. Один раз на питання людини це нормально; на кожну капсулу —
це тисячі читань, щоб намалювати вісім слів. Тепер назва **записується в саме
повідомлення** тим композером, який її вже показав автору (`issueMentions`), а
історичні повідомлення розвʼязуються одним пакетним запитом за точним ключем
(`/api/issues/lookup`). Пошук лишається пошуком: нічого, що малюється на кожен
елемент, не має права його викликати — це перевіряє
`tests/firestore-read-cost.test.mjs`.

**Читати колекцію, щоб порахувати її.** Журнал змін задачі читався повністю,
сортувався в браузері й обрізався до пʼятдесяти рядків — чотириста документів
заради пʼятдесяти. Сортування й обмеження — робота бази: `orderBy` + `limit` у
запиті. Те саме стосується лічильників: непрочитане в каналі рахується з
`messageCount` каналу і курсора читача, а не з самих повідомлень.

**Підписуватись двічі на те саме.** Бічна панель і міст сповіщень кожен окремо
слухали список каналів організації, а картка проєкту на головній тримала пару
слухачів на кожну картку — над каналом `project_*`, у який продукт давно не
пише. Правило «один публікує, багато читають» уже описане у сторі для
`unreadChatCount` та `issueReadState`; воно поширюється на все, що потрібно
більш ніж одному екрану.

І це виявилось найдорожчим із трьох. Запит коштує рівно стільки, скільки
документів він повернув, **кожному слухачеві окремо**. Задачі читали чотири
незалежні підписки — головна, «Мої завдання», дошка, аналітика, — тож один запис
в одну задачу списував до чотирьох читань на вкладку, а на чотирьох вкладках до
шістнадцяти. За вечір 26→27.08.2026 із 49 000 витрачених читань приблизно 34 500
припали саме на це: не на запити, а на доставки змін уже відкритим слухачам.

Тепер підписка одна. `useOrganizationIssues` читає задачі всіх доступних
проєктів (і зв'язки між ними) один раз, з refcount і півгодинним grace-вікном, а
кожен екран фільтрує цей набір у памʼяті:

| Екран | Що бере |
| --- | --- |
| «Мої завдання» | `issues`, відфільтровані за виконавцем |
| Дошка / екран задачі | `documents`, звужені до одного проєкту |
| Аналітика | `issues`, `allIssues`, `cancelledIssues` |
| **Головна** | **нічого — вона більше не читає задачі** |

П'ятсот задач — ніщо для браузера і не ніщо для квоти. Тому окремої підписки на
дітей «Моїх завдань» більше немає: діти вже в наборі. `useIssues` теж не має
власного слухача — те, що виглядало дешевшим («один проєкт замість організації»),
насправді додавало ще одну копію доставки поверх тієї, яку головна вже тримала.
Ціна цього обміну: перший екран у новому браузері платить за весь набір, навіть
якщо це глибоке посилання на одну задачу. Це той самий набір, який усе одно
прочитав би наступний екран, — але один раз, а не по разу на екран.

### Головна більше не читає задачі

Найширше читання стояло на екрані, куди найчастіше повертаються, і тримало
воно там три речі: відсоток прогресу, яким лише сортувався список проєктів; три
рядки активності на великій картці; і одне число в підтвердженні. Сімсот
документів заради сортування, підпису й числа.

Тепер кожне з трьох питає рівно те, що йому треба:

| Що малюється | Звідки береться | Скільки коштує |
| --- | --- | --- |
| Прогрес проєкту | `project.issueCounts` | 0 — документ проєкту вже прочитано |
| Три рядки активності | `useProjectActivity`, `limit(3)` | 3 документи, тільки на великій картці |
| «N завдань буде перенесено» | `count()` у самій модалці | 1 читання, тільки при збереженні |

Тому `useOrganizationIssues` цим екраном не запускається взагалі. Дошка чи «Мої
завдання» його відкриють — ті екрани малюють задачі, — але вхідні двері ні.

**Чому запитів на активність два.** `issueActivity` читає `lastActivityAt`, а
за його відсутності падає на `createdAt`. Це не деталь: на проді 326 із 720
задач не мають позначки активності взагалі, бо імпортер із YouTrack навмисно її
не пише — `lastActivityAt` це ще й курсор непрочитаного, і проставити його на
імпорті означало б засвітити три сотні задач непрочитаними для всіх одразу.
Один `orderBy('lastActivityAt')` тихо викинув би половину простору, і два
реальні проєкти намалювали б один рядок там, де картка розрахована на три.
Firestore не вміє сортувати за «це поле, або те, якщо першого немає», тож
запасний запит — окремий, і тільки коли перший не набрав. Він одноразовий, а не
слухач: він існує заради старих імпортів, а старі імпорти не змінюються.

Індекси: `issues (organizationId, projectId, lastActivityAt DESC)` і
`(organizationId, projectId, createdAt DESC)`.

### Правила

- Живий слухач над колекцією або має `limit()`, або внесений у
  `BOUNDED_WITHOUT_LIMIT` у `tests/firestore-read-cost.test.mjs` з причиною, чому
  він не може рости. Тест падає на новому необмеженому слухачі.
- Історія, що росте вічно (повідомлення, коментарі, журнал змін, списаний час),
  відкривається вікном найновішого і розширюється на вимогу — спільний елемент
  `LoadOlderButton`.
- Звітний екран читає рівно той період, який показує. Період — це
  `where('loggedAt', …)`, а не `.filter()` після читання всієї колекції; див.
  «Аналітика» → «Вікно, а не історія». `tests/firestore-read-cost.test.mjs`
  падає, якщо в `useWorkspaceAnalytics` зʼявиться запит `timeLogs` без вікна.
- Живий слухач лишається там, де людина діє з даними, поки вони змінюються:
  дошка, задача, чат, планування спринту, архів. Звіт — не з них. Аналітика
  бере один замір (`live: false`), показує `RefreshStamp` — «Оновлено о HH:MM» —
  і кнопку взяти новий. Екран, який перестав оновлюватись і не сказав про це,
  гірший за слухача, якого прибрали.
- Те, що вже відоме під час запису, записується під час запису. Назва згаданої
  задачі, імʼя автора, кількість повідомлень у каналі — це поля, а не запити.
- Прочитане — це курсор на розмову, а не позначка в кожному повідомленні.
  Прочитати пʼятдесят повідомлень має коштувати один запис. Позначка на самому
  повідомленні лишається тільки там, де без неї не обійтись, — під квитанцією
  ✓✓, бо відправник не має права читати чужі курсори. Але й там пишеться не
  пʼятдесят позначок, а по одній на автора: квитанція монотонна, тож найновіше
  повідомлення людини відповідає за все, що вона надіслала раніше
  (`receiptMarkIds` / `receiptMarks` у `issueReadState.mjs`).
- Дані, потрібні кільком екранам, підписуються один раз на межі робочого
  простору й публікуються у стор. Для задач і `issueLinks` це
  `useOrganizationIssues`, і `tests/firestore-read-cost.test.mjs` падає на
  другому слухачі над цими колекціями.
- Оновлення «про всяк випадок» на `focus` — це запит на кожен alt-tab у кожній
  вкладці. Директорія організацій і список учасників мають живі сигнали, які
  кажуть, коли вони справді змінились; `focus` лишається лише як ремонт застряглого
  кешу і тому обмежений `claimActivityHeartbeat` (30 хв, спільно між вкладками).
  Без цього обмеження два ці запити давали ~600 виконань за вечір з незмінною
  відповіддю.
- Ранжування в памʼяті означає читання всього корпусу. `/api/search` тримає
  прочитане organization-корпус разом із профілями учасників 60 секунд,
  пропускає людей і календар у режимі згадки, і не викликається нічим, що
  малюється на кожен елемент.
- `count()` коштує одне читання на тисячу документів — рахувати треба ним, а не
  читанням документів.

### Сеанси облікового запису

«Налаштування» → «Безпека» показує, з яких пристроїв заходили в обліковий запис.
Це один документ — `users/{uid}/settings/sessions`, мапа за ідентифікатором
пристрою, який браузер тримає у власному сховищі, — а не підколекція: панель
читає одна людина про себе, і мапа коштує одне читання незалежно від кількості
пристроїв. Документ читається лише поки відкрито саме цей розділ.

Пише його сервер (`/api/account/sessions`), бо місце береться із заголовків
хостингу, яких браузер не бачить; клієнт лише позначає пристрій не частіше ніж
раз на дванадцять годин. Мапа обрізається до `MAX_REMEMBERED_SESSIONS` під час
того ж запису, тож документ не росте нескінченно.

Завершення сеансу відкликає refresh-токени всього облікового запису: Firebase
вміє відкликати їх лише цілком, окремого пристрою не існує. Підтвердження це
проговорює, і після нього застосунок виходить із акаунта тут-таки.

### Що лишилось дорогим навмисно

Робочий простір підписаний на задачі всіх проєктів, які користувач може
відкрити. Це і є основний набір даних продукту, і саме з нього рахуються прогрес
проєкту, «активні», «прострочені» та «мої». Постійний кеш Firestore
(`persistentLocalCache`, увімкнений у продакшні) робить повторні візити
дешевими, але перший візит у новому браузері платить повну ціну, і вона росте
разом із віком робочого простору.

### Скільки важить задача

Заміряно на проді 27.08.2026, бо про вагу документа не можна здогадуватись:
720 задач, 2 729 KiB, у середньому 3 881 B на документ. 672 з них імпортовані з
YouTrack і несуть 96% усієї ваги.

| Поле | Вага | Частка | Хто читає |
| --- | --- | --- | --- |
| `importMetadata` | 840 KiB | 31% | три підполя з 40 KiB |
| `description` | 769 KiB | 28% | екран задачі, пошук |
| `attachments` | 572 KiB | 21% | екран задачі |

Робочий простір підписаний на задачі всіх доступних проєктів, тож поле на
документі задачі — це поле, за яке платить кожна дошка, кожен список і «Мої
завдання», незалежно від того, чи його хтось малює. `importMetadata` був
найважчим полем у колекції — важчим за всі описи разом, — і 800 KiB із нього не
читало ніщо. Сирий запис імпорту переїхав у `issues/{id}/import/source`, куди не
дістає жодне правило Firestore (`issueImportRecord.mjs`, міграція в
[MIGRATIONS.md](MIGRATIONS.md)).

**Жодного читання це не економить.** Firestore рахує читання по документах —
дошка читає ті самі 720. Це трафік, парсинг і пам'ять браузера, і саме так це
треба називати: денна стеля, через яку були обидва падіння, — інша величина.

Описи лишаються на документі задачі, і це рішення, а не недогляд. Web SDK не
вміє проєкцій, тож дошка справді тягне повний текст кожного опису, щоб намалювати
картки, які його не показують. Але виносити його нікуди: читань це не зекономить,
а пошук по тексту опису (`searchRanking.mjs` → `WEIGHTS.body`, `/api/search`
через `.select()`) перетворився б на N додаткових читань на кожен запит —
погіршив би рівно ту величину, заради якої все затівалось. Той самий трафік
дешевше забрати з `importMetadata`, і його там більше.

### Лічильники задач на проєкті

Наступний крок уже зроблений наполовину: `projects/{id}.issueCounts` тримає
`total`, `delivered` і `overdue`, і їх підтримують ті самі серверні маршрути,
що вже пишуть задачі. Модель — у `src/lib/utils/projectIssueCounts.mjs`, запис —
у `src/lib/server/projectIssueCounts.js`, і обидва списані з
`analyticsRollups`: **дельти, не інкременти**. Одна зміна — це стара форма
задачі, знята з підсумку, і нова, додана до нього; тому задача, перенесена між
проєктами, лишає обидва лічильники правильними, а скасування симетричне до
повернення.

`total` — робочий набір: не архівні, не скасовані, не в процесі видалення. Той
самий набір, який `useOrganizationIssues` публікує як `issues`.
`delivered` — з них ті, чий статус має категорію `done`. `overdue` — з них ті,
чий дедлайн минув і чий статус не закриває задачу; це та сама пара запитань, яку
`statusCategories.mjs` уже тримає окремо, і жодне з них тут не виводиться заново.

**Годинник — уся складність.** `total` і `delivered` — це факти про збережені
поля, тож дельта тримає їх правильними вічно. `overdue` — ні: задача, до якої
ніхто не торкався, стає простроченою опівночі, а опівночі ніхто нічого не пише.
Тому документ каже, на який день він відповідає — `countedDay`, ключ дня в поясі
організації, — і працює правило:

> збережені цифри точні **станом на `countedDay`**.

Кожна дельта міряється проти `countedDay`, а не проти поточного моменту. Закрий
задачу опівдні, якщо вона прострочилась уночі, а перерахунок ще не був: на
`countedDay` вона не була простроченою, тож дельта не рухає `overdue` — і це
правильно, бо збережена цифра її ніколи не рахувала. Міряння проти «зараз»
відняло б задачу, якої в підсумку не було, і лічильник пішов би нижче нуля.

`countedDay` рухає повний перерахунок (`recountProjectIssueCounts`), який висить
на materialise-пасі. Не тому, що там знайшлось місце, а тому, що той пас — це
рівно те, що тут потрібне: два запуски за добу з різницею в дванадцять годин,
щоб один із них припадав на ранній ранок будь-якого часового поясу. Свого
розкладу для цього не існує: Vercel Hobby дозволяє один крон на добу, а суб-добовий
запис у `vercel.json` взагалі блокує створення деплоїв
(`.github/workflows/scheduled-notifications.yml`).

Перерахунок — і шлях назад. `total` та `delivered` тримаються інкрементами, а
інкремент правильний рівно настільки, наскільки правильними були останній
деплой, останній retry і останній випадок, якого ніхто не передбачив. Тут кожна
цифра рахується заново й пишеться як абсолютний підсумок, тож помилка в дельті —
це тимчасово неправильне число, а не назавжди.

Дві дії не виражаються дельтою взагалі й тому перебудовують усе: редагування
workflow (воно змінює, що означає «delivered» для кожної задачі одразу) та
завершення імпорту з YouTrack (він пише задачі по одній, тисячами кроків).

Читач вимагає, щоб за цифрами хоч раз стояв повний перерахунок:
`projectIssueCounts()` повертає `null` для блоку без `countedAt`, і екран
повертається до читання задач. Інкремент `countedAt` не пише — саме тому, що
інкремент нічого не встановлює. Новий проєкт отримує встановлені нулі одразу,
бо нуль — це підсумок, який можна встановити, нічого не читаючи.

**Хто їх читає.** Головна, і більше ніхто — вона бере з них відсоток, яким
сортує список проєктів, і задачі для цього не читає взагалі. Порядок був саме
такий і не міг бути іншим: спершу лічильники, потім звірка
(`npm run backfill:project-issue-counts` — dry run на проді має сказати
«розбіжностей: 0»), і лише потім екран перестав рахувати сам. Прибрати
розрахунок раніше означало б не мати з чим порівняти.

Звірку варто повторювати: нуль одразу після повного перерахунку доводить сам
перерахунок, а не дельти. Дельти доводить нуль після доби реальної роботи.

Лишається один шлях, який лічильник не бачить одразу: дедлайн, написаний із
браузера напряму (`updateDoc`). Клієнт не може писати ні `projectId`, ні
`status`, ні `archivedAt`, ні `cancelledAt` — `firestore.rules` відмовляє в
усьому цьому, — тож `dueDate` єдиний, і він рухає тільки `overdue`. Сервер не
знає попереднього значення, а маршрут, який приймав би його від клієнта, був би
маршрутом, у якому будь-хто може перекосити лічильник. Тому це виправляє
перерахунок, і саме тому `overdue` від початку описане як число, правдиве станом
на момент, а не вічно.

## Звіти про помилки

Тост із помилкою має найтихішу кнопку в застосунку — «Повідомити про помилку».
Вона надсилає те, що людина побачила, те, що сталося насправді, і де це було:
одним натисканням, бо помилка, яку треба описати словами, не буде описана ніколи.

Записує `POST /api/error-reports`: клієнт не може сам вирішувати, ким він є,
обмеження частоти живе на сервері, а колекція лишається закритою для читання з
браузера — жодне правило Firestore її не описує, а Firestore забороняє все, що
не дозволено явно.

Читання — не функція робочого простору, і це головне, що варто розуміти. Звіт
містить екран, шлях і збій конкретної людини, і адресований він тому, хто це
полагодить. Раніше це було записано як «власник організації» — правильна людина
рівно доти, доки організація одна і вона наша: власником простору клієнта є
клієнт, а той, хто лагодить, мусив би обходити всі простори, щоб зібрати свій
список.

Тому:

- звіти лежать в одній кореневій колекції `errorReports`, а робочий простір —
  поле в документі (`organizationId`, `organizationName`). Всередині організації
  вони лежали саме так, як треба, щоб її власник виглядав природним читачем;
- читає їх `/errors` — сторінка поза `(app)`, без організації і без сесії, через
  `POST /api/error-reports/inbox`;
- двері — пароль, записаний однією константою в самому маршруті
  (`src/app/api/error-reports/inbox/route.js`). Змінювати його там і більше
  ніде. Це навмисно не змінна оточення: сторінку відчиняє одна людина, і
  налаштування на рівні деплою не давало нічого, крім зайвого кроку. Пароль
  перевіряється на сервері, порівнюється як дайджест сталої довжини і
  обмежений десятьма спробами на адресу за пʼять хвилин;
- пароль ніде не зберігається на клієнті — ні в cookie, ні в storage. Він живе в
  стані сторінки, поки вкладка на ній, і після перезавантаження його питають
  знову.
