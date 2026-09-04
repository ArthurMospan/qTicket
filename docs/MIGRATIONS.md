# Data migrations

One runbook per controlled migration script. They share one shape, and the shape
is the point: **dry run is the default**, apply demands the exact project (and
usually the organization) spelled out a second time, and a re-run after apply is
how the migration is declared finished.

None of these ever runs during login, deployment or a browser session
(`AGENTS.md`). JSON reports carry internal ids — keep them beside the operational
ticket, never in this repository.

---

## Міграція ієрархії завдань v2

Ця міграція переводить старі механізми `parentEpicId`, `subtasks[]` і парні
`issueLinks` на одну узгоджену модель:

- `parentIssueId` — єдине поле ієрархії, максимум один рівень;
- старі елементи `subtasks[]` стають Markdown-чеклістом в описі;
- один логічний зв’язок має один детермінований документ;
- вбудовані English labels локалізуються лише за точним стабільним `id` і
  точним старим label. Кастомні назви не змінюються.

Скрипт ніколи не вгадує напрямок старих `subtask-of` або `duplicates`.
Такі записи потрапляють до `manualReview` у JSON-звіті й залишаються без змін.
Так само не переносяться невалідні міжпроєктні батьки, глибші дерева та
циклічні залежності.

### 1. Dry run

Firebase project треба вказати явно:

```powershell
npm run migrate:issue-hierarchy -- --project quickteam-prod --report C:\tmp\issue-hierarchy-dry-run.json
```

За потреби можна обмежити одну організацію:

```powershell
npm run migrate:issue-hierarchy -- --project quickteam-prod --organization ORG_ID --report C:\tmp\issue-hierarchy-org.json
```

Перевірте `manualReview`, кількість змін і Firebase project у звіті. Dry run
нічого не записує.

### 2. Apply

Apply потребує окремого точного підтвердження project id:

```powershell
npm run migrate:issue-hierarchy -- --project quickteam-prod --apply --confirm-project quickteam-prod --report C:\tmp\issue-hierarchy-applied.json
```

Запускайте через Admin SDK з `GOOGLE_APPLICATION_CREDENTIALS` або
`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`. Скрипт не запускається під
час логіну чи роботи вебзастосунку.

### Ідемпотентність і конкурентні зміни

- `parentIssueId` після першого проходу є авторитетним; застаріле поле
  видаляється лише коли немає конфлікту.
- Чекліст має marker `quickteam:legacy-subtasks-migrated`, тому не дублюється.
- Canonical link id залежить від організації, проєкту та unordered пари задач.
- Кожне issue-оновлення повторно звіряє вихідні hierarchy/checklist поля й
  інваріанти у транзакції з `project.issueHierarchyVersion`. Якщо дані
  змінилися після dry run, запис пропускається й потрапляє до `manualReview`.
- Link migration читає та інкрементить `project.issueLinkVersion` у транзакції.
  Це серіалізує її з API та YouTrack importer без maintenance window.
- Повторний запуск пропускає вже канонічні записи й знову звітує невирішені
  неоднозначності.

Збережіть обидва JSON-звіти біля операційного ticket, але не комітьте їх у
репозиторій: вони можуть містити внутрішні issue ids.

---

## Historical issue-key migration

QuickTeam now creates URL-safe ASCII issue prefixes containing at least one
Latin letter. Older organizations may still contain Cyrillic keys such as
`МАЧ-1` or numeric-only prefixes such as `111-1`.

The product recognizes these historical keys immediately and canonicalizes an
opened URL. The migration makes that result durable: it updates the project
prefix when the stored prefix is no longer valid, replaces each affected
`issues.issueKey`, and appends the previous key to `legacyIssueKeys`. Old links
therefore continue to resolve and are replaced in the address bar by the new
ASCII URL.

Run one dry-run per explicit organization. The command never writes by default:

```powershell
npm run migrate:issue-keys -- --project quickteam-prod --organization org-id
```

Review every project and issue operation in the JSON report. In particular,
`collisions` must be empty. Stop project creation and all task writers for that
organization, then apply with exact confirmations:

```powershell
npm run migrate:issue-keys -- --project quickteam-prod --organization org-id --apply `
  --confirm-project quickteam-prod --confirm-organization org-id `
  --confirm-writes-frozen
```

The script uses Firebase Admin credentials from the environment. It never runs
from a browser or login flow. Targets come from the same canonicalizer used by
task links, target collisions stop apply before any write, and each live
document is rechecked transactionally. Re-running an interrupted apply is safe.

After apply, run the dry-run again before lifting the write freeze.
`projectPrefixesPlanned` and `issueKeysPlanned` must both be zero. Keep the
reported `legacyIssueKeys`; they are the redirect aliases for links already in
chat, notifications, email, or browser history.

---

## Organization-scoped image assets

Legacy profile avatars and organization logos were uploaded below
`quickteam/avatars/`. That path does not prove tenant ownership, so the product
correctly refuses to delete those files. New uploads use
`quickteam/organizations/{organizationId}/avatars|logos` and persist the
Cloudinary public id beside the delivery URL.

Run the migration once per organization. It scans only that organization's
document and current member profiles. Dry-run is the default and does not call
Cloudinary:

```powershell
npm run migrate:image-assets -- --project quickteam-prod --organization org-id
```

Review the printed source/destination list, freeze avatar/logo changes for the
organization, then apply with exact confirmations:

```powershell
npm run migrate:image-assets -- --project quickteam-prod --organization org-id --apply `
  --confirm-project quickteam-prod --confirm-organization org-id `
  --confirm-writes-frozen
```

The script uses Firebase Admin credentials plus `CLOUDINARY_CLOUD_NAME`,
`CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` from the environment. Apply
is idempotent: destination ids are deterministic, an existing destination is
reused, and Firestore is updated only when the live URL still matches the
value classified by the script.

Re-run dry-run after apply. `legacyMovesPlanned` and
`metadataBackfillsPlanned` must both be zero before the write freeze is lifted.

---

## Member access and rate migration

This migration removes legacy payroll fields from member-readable documents,
moves them to server-only paths, and cleans stale member ids from project teams,
issue assignees, and issue watchers.

Run a dry-run first against one explicit organization:

```bash
npm run migrate:member-access -- --project quickteam-prod --organization org-id
```

Review the JSON counts, stop membership, workflow, project-team, and issue
assignment writes for that organization, then apply with exact confirmations:

```bash
npm run migrate:member-access -- --project quickteam-prod --organization org-id --apply --confirm-project quickteam-prod --confirm-organization org-id --confirm-writes-frozen
```

The script is idempotent. Re-run the dry-run after apply; every migration and
cleanup count should be zero. Repeat explicitly for each organization. Never run
it from a browser or login flow.

## Ключ батьківського завдання на підзавданні

`scripts/backfill-parent-issue-key.mjs`

Картка підзавдання називає задачу, під якою воно висить. Раніше вона шукала цю
задачу серед тих, що випадково завантажені на тому ж екрані, — а батьківська
зазвичай не там: інший спринт, інша колонка, за межами сторінки. Слот
ідентифікатора тоді показував слова «Батьківське завдання», що читалось як номер
самої задачі.

Задачі, створені після цієї зміни, несуть `parentIssueKey`: маршрути створення
(`/api/issues`) і зміни батька (`/api/issues/[issueId]/parent`) все одно читають
батьківський документ для валідації, тож зберегти його ключ не коштує нічого.
Скрипт дописує це поле старим підзавданням.

### Dry run

```bash
node scripts/backfill-parent-issue-key.mjs --dry-run
```

Друкує кількість підзавдань, скільки вже коректні, скільки треба полагодити і
список тих, чиє батьківське завдання не знайдено. Останні **не чіпаються**: це
зламане посилання, яке треба виправити руками, а не ключ, який можна вигадати.

### Apply

```bash
node scripts/backfill-parent-issue-key.mjs
```

Ідемпотентний: підзавдання з правильним `parentIssueKey` пропускається без
запису. Читає одне підзавдання і один унікальний батьківський документ, тож
повторний запуск після повного проходу майже безкоштовний.

Поки поле не проставлене, картка показує лише значок «це підзавдання» — без
номера, але й без вигаданого тексту в слоті ідентифікатора.

---

## Лічильники задач на проєкті (`projects/{id}.issueCounts`)

`scripts/backfill-project-issue-counts.mjs` перебудовує `total`, `delivered` і
`overdue` на документі проєкту з самих задач.

Головна рахує смугу прогресу, читаючи всі задачі всіх доступних проєктів — це
найширше читання в продукті, на екрані, куди повертаються найчастіше. Три числа
на документі проєкту замінюють це одним читанням на картку.

**Поки цей скрипт не відпрацював, нічого не змінюється.** Читач вимагає, щоб за
цифрами хоч раз стояв повний перерахунок: `projectIssueCounts()` повертає `null`
для блоку без `countedAt`, і картка повертається до читання задач. Інкремент
`countedAt` не пише — саме тому, що інкремент нічого не встановлює.

Скрипт — чотири інструменти в одному: міграція, ремонт, аудит і шлях назад. Це і
є та **звірка**, без якої не можна прибирати читання задач із головної: спершу
dry run на проді, потім читання звіту, і лише потім екран перестає читати задачі.

### 1. Dry run

```powershell
npm run backfill:project-issue-counts -- --project quickteam-me --report C:\tmp\counts-dry-run.json
```

Можна обмежити однією організацією:

```powershell
npm run backfill:project-issue-counts -- --project quickteam-me --organization ORG_ID
```

Друкує кожен проєкт, чиї збережені цифри не збігаються з перерахованими, із
причиною: `missing` (лічильника ще немає), `stale-day` (цифри відповідають на
інший день) або `differs` (інкрементний шлях розійшовся з задачами).

### 2. Apply

```powershell
npm run backfill:project-issue-counts -- --project quickteam-me --apply --confirm-project quickteam-me --report C:\tmp\counts-applied.json
```

### 3. Повторний dry run — це і є підтвердження

Має надрукувати `Розбіжностей : 0`. Будь-яке інше число зі `differs` означає, що
якийсь шлях запису змінює задачі, не змінюючи лічильник, — і його треба знайти,
а не перезаписати цифри ще раз. `stale-day` розбіжністю такого роду **не є**:
`overdue` правдиве станом на `countedDay`, а не вічно, і день переводить
перерахунок на materialise-пасі, а не інкремент.

### Що саме перебудовується

- `total` — задачі робочого набору: не архівні, не скасовані, не в процесі
  видалення. Той самий набір, який публікує `useOrganizationIssues` як `issues`;
- `delivered` — з них ті, чий статус має категорію `done` (`deliveredStatusIds`);
- `overdue` — з них ті, чий дедлайн минув і чий статус не закриває задачу
  (`closedStatusIds`), станом на `countedDay` у поясі організації;
- `countedDay` / `countedAt` — день, на який відповідають цифри, і момент
  перерахунку. Пише тільки повний перерахунок.

Живий продукт робить те саме двічі на добу сам (`recountProjectIssueCounts` на
materialise-пасі). Скрипт потрібен для першого запуску і для моменту, коли треба
знати **зараз**, чи цифри правдиві.

---

## Курсор замість позначки в кожному повідомленні (міграції немає)

Цей розділ існує саме тому, що скрипта тут немає, і це треба було перевірити, а
не припустити.

Чат завдання більше не питає `readBy` кожного коментаря, чи прочитане
повідомлення, — на це відповідає курсор `organizations/{orgId}/issueReadState/{uid}_{issueId}`,
той самий, з якого вже жила крапка на картці й межа в стрічці змін. Позначка на
самому повідомленні лишилась тільки під квитанцією ✓✓ і пишеться по одній на
автора, а не на кожне повідомлення.

**Backfill не потрібен, і ось чому:**

- Старі повідомлення несуть повний `readBy` і `readAt`. `receiptMarks` читає їх
  так само, як читав, тож квитанції в історії не змінюються і не втрачають
  годину.
- Нові повідомлення несуть позначку тільки на найновішому від кожного автора, а
  квитанція для старіших виводиться з неї (`commentReaders`). Обидві форми даних
  живуть в одній колекції одночасно й читаються одним кодом.
- Непрочитане тепер рахується від курсора. Курсор пишеться з першої хвилі, тож
  у людей, які відкривали задачу після неї, він уже є. У кого його нема, той
  побачить розмову як непрочитану один раз — і вихід із задачі його поставить.
- Зайвий `readBy` у старих документах нікому не заважає: його ніхто не читає для
  непрочитаного, а місця він не коштує помітно.

Правило запису в Firestore Rules (`hasOnly(['readBy', 'readAt'])`) лишається без
змін: воно й далі описує рівно те, що клієнт має право писати в чужий коментар.

### Порядок розгортання строку давності

`pruneReadNotifications` виконує запит `read == true` + діапазон по `createdAt`.
Складений індекс на це вже описаний у `firestore.indexes.json`, але Firestore
створює індекси не миттєво:

```powershell
firebase deploy --only firestore:indexes --project quickteam-prod
```

Поки індекс будується, запит падає з `failed-precondition`, і прохід чистки
просто нічого не видалить — доставка сповіщень від цього не залежить і не
зупиняється. Тому індекс варто розкотити перед кодом, але зворотний порядок не є
аварією: наступний повільний прохід підбере те саме.

## Лічильники обмеження частоти

`npm run cleanup:rate-limits`

`enforceRateLimit` пише документ на кожну пару «scope + субʼєкт» у
`serverRateLimits` і перезаписує його, коли вікно закінчилось. Не видаляє ніколи.
Для скоупів по акаунту це обмежено кількістю людей; для двох скоупів по
IP-адресі — інбокс звітів і початок входу поштою — росте з кількістю унікальних
адрес і не спадає.

**Рішення, яке нічого не коштує — не робити нічого.** 61 документ за весь час
життя проєкту — це кілька кілобайт при безкоштовному ліміті в 1 ГіБ. Колекція
росте з кількістю унікальних IP-адрес, а не з обсягом роботи, і сама по собі
нічого не ламає.

Якщо колись почне заважати, є TTL-політика Firestore на полі `resetAt`: вона
видаляє прострочене сама і не витрачає квоту записів. Живе вона **в Google Cloud
Console, а не у Firebase Console** — у Firebase такої вкладки немає:

    https://console.cloud.google.com/firestore/databases/-default-/ttl?project=quickteam-me

Через Admin SDK це не автоматизується: сервісний акаунт Firebase читає
конфігурацію полів, але на `PATCH … ?updateMask=ttlConfig` відповідає
`403 PERMISSION_DENIED` — перевірено 26.08.2026. Щоб дати йому це право, треба
рівно та сама консоль, тож автоматизація не економить жодного кроку.

Скрипт існує, щоб те саме можна було зробити без консолі, і щоб пропуск цього
кроку був рішенням, а не витоком. Видаляє лише те, чий `resetAt` уже минув
понад хвилину тому — такий документ уже не впливає на жодне рішення, бо
`enforceRateLimit` читає його так само, як відсутній.

```powershell
node --env-file=.env.local scripts/cleanup-rate-limits.mjs --project quickteam-me
node --env-file=.env.local scripts/cleanup-rate-limits.mjs --project quickteam-me `
  --apply --confirm-project quickteam-me
```

Прогнано 26.08.2026 проти `quickteam-me`: видалено 61 прострочений лічильник.

## Ліміт розміру завантаження: підписаний пресет Cloudinary

### Що не так без нього

`/api/upload/sign` перевіряє розмір файлу через `uploadFilePolicy(params.file)`,
а `params.file` — це `{ name, size, type }` **зі слів браузера**. Клієнт, який
оголосив «1 КБ» і надіслав 500 МБ, проходить усі перевірки сервера, і Cloudinary
його приймає: підпис покриває формат (`allowed_formats`), але не розмір.

Один учасник може так вичерпати кредити безкоштовного тарифу хмари, і зламається
не його завантаження, а аватарки, логотипи й вкладення чату **в усіх**.

Окремого параметра «максимальний розмір» у запиті Cloudinary не має. Стеля живе
на upload preset, а підписаний `upload_preset` — це те, що привʼязує її до
нашого підпису.

### Що зробити (чотири кроки в консолі)

1. Cloudinary → Settings → Upload → **Upload presets** → «Add upload preset».
2. Назва — будь-яка, наприклад `quickteam-signed`. **Signing Mode: Signed.**
3. У «Upload manipulations» → **Max file size**: `104857600` (100 МБ — стеля для
   відео; для зображень і документів нижчу межу вже тримає
   `MAX_UPLOAD_BYTES_BY_RESOURCE` на клієнті й сервері).
4. Vercel → Project → Environment Variables → `CLOUDINARY_UPLOAD_PRESET` =
   назва пресета. Production і Preview.

### Поки змінної немає

Код умовний: без `CLOUDINARY_UPLOAD_PRESET` підпис і форма збираються **точно
так само, як раніше**. Нічого не ламається і нічого не змінюється — просто ліміт
лишається на слові браузера. Клієнт додає поле `upload_preset` рівно тоді, коли
сервер його підписав: надіслати поле, якого немає в підписі, Cloudinary
відмовляється, тож обидві сторони мусять збігатися.

### Рішення на 26.08.2026: не робити

Власник свідомо не створює пресет — Cloudinary все одно змінюється на власне
сховище, а до того часу поверхня зловживання вимагає навмисних дій з дійсного
акаунта робочого простору. Ліміт швидкості на `/api/upload/sign` (30 підписів на
хвилину на людину) обмежує темп, і реальних сторонніх користувачів у продукті
поки немає.

Перестане бути прийнятним тоді, коли робочі простори відкриються людям, яким ви
не довіряєте особисто. До того — код тут умовний і не робить нічого, поки немає
змінної, тож жодного боргу він не створює.

### Коли переїдемо на своє сховище

Ця сторінка стає непотрібною: на власному сервері розмір перевіряється там, куди
приходять байти, і оголошений розмір взагалі перестає щось означати.

---

## Організації QuickTeam, які ніколи не купували qTicket

`npm run migrate:noncustomer-orgs`

Провіженінг писав усе, що підписав QuickTeam. Знімок з
`entitlement: "inactive"` для організації, якої qTicket ще не бачив, створював
документ організації і місце в `orgMemberships` кожному співробітнику з нього.
Місце — це те, що малює організацію у свічері, і назад його ніщо не забирає:
власник з трьома організаціями QuickTeam і одним придбаним qTicket бачив тут
три, з яких дві відкривалися у власні помилки. Маршрут це більше не робить
(`quickTeamSnapshotOpensOrganization`), а цей скрипт прибирає те, що вже лежить
у базі.

Скрипт видаляє організацію тільки якщо виконано **все**:

- ентайтлмент не `active`;
- є `quickTeam.sourceOrganizationId` — старі standalone-організації це інша
  історія, вони потрапляють до `manualReview` і лишаються без змін;
- організація **порожня**: жодного клієнтського простору, звернення, запрошення,
  сповіщення, тумбстоуна, звʼязку, і жодної підколекції `issueReadState`,
  `settings`, `private`.

Порожнеча — не здогадка. Поки ентайтлмент неактивний, рулзи відмовляють у
кожному записі з браузера, тож організація, яку справді призупинили після
роботи, зберігає свій вміст. Контракт обіцяє, що він переживе призупинення до
наступного активного знімка, і скрипт цю обіцянку не порушує: усе, що має
вміст, іде в `manualReview` і лишається недоторканим.

Документ організації видаляється разом з місцями **навмисно**. Провіженінг
визначає «перший знімок» за тим, чи існує документ; лишити його — означає, що
наступний неактивний знімок буде прийнятий за призупинення і місця повернуться.

### 1. Dry run

Firebase project треба вказати явно:

```powershell
npm run migrate:noncustomer-orgs -- --project quickteam-prod --report C:\tmp\noncustomer-dry-run.json
```

За потреби можна обмежити одну організацію:

```powershell
npm run migrate:noncustomer-orgs -- --project quickteam-prod --organization ORG_ID --report C:\tmp\noncustomer-one.json
```

Перевірте `removed`, `manualReview` і Firebase project у звіті. Dry run нічого
не записує.

### 2. Apply

```powershell
npm run migrate:noncustomer-orgs -- --project quickteam-prod --apply --confirm-project quickteam-prod --confirm-writes-frozen --report C:\tmp\noncustomer-applied.json
```

`--confirm-writes-frozen` тут означає одне конкретне: **зупиніть провіженінг з
боку QuickTeam на час запуску**. Знімок, який прилетить у момент видалення,
створить організацію заново.

Запускайте через Admin SDK з `GOOGLE_APPLICATION_CREDENTIALS` або
`FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`.

### Ідемпотентність

Місця видаляються раніше за документ організації, тож перерваний запуск
доробляється повторним — організація ще на місці, і наступний прохід її знайде.
Після apply повторний dry run має показати `removed: []`; це і є ознака, що
міграція завершена.
