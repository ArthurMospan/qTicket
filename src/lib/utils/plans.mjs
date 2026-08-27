// What a plan gives, in one place, so the page and the product cannot disagree.
//
// Three of them, and they were already named: the onboarding screen has offered
// Free, Lite and Pro since before this file existed. What was missing was
// anything reading them afterwards. The settings screen drew a two-plan card
// from ternaries, `/api/projects` refused a fourth project with a hardcoded
// `plan !== 'pro' && count >= 3` — which quietly made Lite the same thing as
// Free — and nothing else in `src/` mentioned a plan at all.
//
// ── How the price list is shaped, and why ────────────────────────────────
//
// Two blocks per plan, in the order everybody's price list uses because it is
// the order the questions arrive in.
//
//   1. The ceilings, as a table of numbers. Not «До 10» — a column of bare
//      figures is compared down the row at a glance, and the word in front of
//      each one is read three times and adds nothing. A plan that does not have
//      something at all shows «–», and a plan with no ceiling shows lucide's
//      `Infinity` — the word for it is the widest thing on the card.
//   2. What the plan adds, as «Все з Lite +» and then only the new lines.
//      Repeating twelve shared features on every card makes the columns
//      unreadable and buries the two lines that actually differ.
//
// ── What is allowed to be a ceiling ──────────────────────────────────────
//
// Only something this workspace can count on its own side. That rule removed
// two rows written here as if a price list were free to invent them: «клієнти в
// порталі», when the portal is a separate product with its own database and
// this one has no client role at all, and «сховище файлів», when nothing here
// measures a byte of what is uploaded. A ceiling nobody counts is not a plan,
// it is a sentence on a page, and the first customer to test it finds that out
// on our behalf.
//
// What is left is what the workspace itself holds and can therefore refuse:
// projects, people, and the calls the AI is asked to read.
//
// ── The one rule that keeps this honest ──────────────────────────────────
//
// Every limit and capability carries `enforced`, and `enforcedAt` names the
// file that does the refusing. `false` means intended and not yet built.
// `planAllows` answers «yes» for an unenforced capability on every plan — a
// gate nobody built is not a gate, and reporting one would make the product
// hide something people are already using.
//
// `tests/plans.test.mjs` holds every `enforced: true` to a file that reads the
// plan, so flipping a flag is the last step of enforcing something.

export const DEFAULT_PLAN = 'free';

/**
 * Rendered by `planLimitRows`: `0` is «–», `Infinity` is «Безліміт».
 *
 * Each one also carries the two sentences it says when it is met, because a
 * refusal written at the place that refuses is a refusal written three times.
 * `title` names what ran out; `hint` names the way out that is not money,
 * since every one of these has one — archive a project, deactivate a seat,
 * wait for the month to turn.
 */
export const PLAN_LIMITS = [
  {
    id: 'projects',
    label: 'Проєкти',
    title: 'Ліміт проєктів вичерпано',
    // No tip. It read «або заархівуйте проєкт, який уже завершено», which is a
    // way of not paying, offered by the product, in the first sentence the
    // product says about its own ceiling — and then repeated under the price
    // list, where it was the last thing on the screen as well as the first.
    // Archiving still frees a place; the archive is where that is said.
    hint: '',
    absentTitle: 'Проєкти недоступні на цьому тарифі',
    absentHint: 'Проєкти зʼявляються на платному тарифі.',
    overageHint: 'створені останніми стануть тільки для читання, решта працює як працювала',
    enforced: true,
    enforcedAt: 'src/app/api/projects/route.js',
  },
  {
    id: 'members',
    label: 'Учасники команди',
    title: 'Ліміт учасників команди вичерпано',
    hint: 'Або деактивуйте учасника, який більше не працює: його задачі, час і коментарі лишаються, місце звільняється.',
    absentTitle: 'Запрошення недоступні на цьому тарифі',
    absentHint: 'Запрошення зʼявляються на платному тарифі.',
    overageHint: 'усі лишаються й працюють, нових не запросити, поки не звільниться місце',
    enforced: true,
    enforcedAt: 'src/app/api/invitations/route.js',
  },
  {
    id: 'aiCalls',
    // The tab in the composer says «AI Аудіо-завдання», so the price list says
    // it too. «Розбір дзвінків» was a name for this feature that appeared
    // nowhere a person could see it — a price list is the last place that may
    // invent its own vocabulary for something the product already named.
    label: 'AI Аудіо-завдання / міс',
    title: 'AI Аудіо-завдання на цей місяць вичерпано',
    hint: 'Лічильник обнулиться першого числа наступного місяця.',
    absentTitle: 'AI Аудіо-завдання недоступні на цьому тарифі',
    absentHint: 'Запис наради стає саммарі, рішеннями й чернетками задач — на платному тарифі.',
    overageHint: 'цього місяця вже витрачено більше, лічильник обнулиться першого числа',
    enforced: true,
    enforcedAt: 'src/app/api/ai/call-to-tasks/route.js',
  },
];

// Deliberately not a limit: the number of tasks.
//
// It is the one ceiling that stops a task tracker being a task tracker, and no
// competitor uses it — Jira, Asana and Linear cap people, Trello caps boards,
// and all of them leave the work itself alone. A team that hits a task ceiling
// does not upgrade, it stops writing tasks down, and then the tracker is wrong
// about what the team is doing, which is worse for us than the free plan is.
//
// What is capped instead is what the workspace can count: the projects and the
// people it holds, and the recordings it is asked to send off for analysis.

/** What a plan adds over the one before it. Ids are stable; labels are not. */
export const PLAN_CAPABILITIES = [
  {
    id: 'boards',
    label: 'Дошки, списки, таблиця і спринти',
    plans: ['free', 'lite', 'pro'],
    enforced: false,
  },
  {
    id: 'calendar',
    label: 'Календар, події та нагадування',
    plans: ['free', 'lite', 'pro'],
    enforced: false,
  },
  {
    id: 'chat',
    label: 'Чат і обговорення в задачах',
    plans: ['free', 'lite', 'pro'],
    enforced: false,
  },
  {
    id: 'time',
    label: 'Облік часу, табель і аналітика',
    plans: ['free', 'lite', 'pro'],
    enforced: false,
  },
  {
    id: 'branding',
    label: 'Власний брендинг',
    detail: 'Логотип, колір і тема бічної панелі',
    gains: [
      'Ваш логотип замість QuickTeam на бічній панелі — у всіх учасників',
      'Свій колір і тема панелі, а не стандартна темна',
      'Налаштування лишається в базі: повернувся тариф — повернувся бренд',
    ],
    plans: ['lite', 'pro'],
    enforced: true,
    enforcedAt: 'src/app/(app)/settings/page.js',
  },
  {
    id: 'invoices',
    label: 'Виставлення рахунків і ставки',
    detail: 'Погодинні ставки команди й рахунок із табеля',
    gains: [
      'Погодинна ставка для кожного учасника команди',
      'Рахунок збирається з табеля — години не переносяться руками',
      'Готовий рахунок друкується й експортується',
    ],
    plans: ['lite', 'pro'],
    enforced: true,
    enforcedAt: 'src/app/(app)/analytics/page.js',
  },
  {
    id: 'integrations',
    label: 'Інтеграції',
    detail: 'Telegram, YouTrack, API-ключі',
    gains: [
      'Задачі створюються просто з робочої Telegram-групи',
      'API-ключі для власних сценаріїв і сторонніх сервісів',
      'Баг-репорти клієнтів із порталу приходять як задачі',
    ],
    plans: ['lite', 'pro'],
    enforced: true,
    enforcedAt: 'src/app/(app)/settings/page.js',
  },
  {
    id: 'data-import',
    label: 'Перенесення даних',
    detail: 'Імпорт задач, часу і звʼязків з іншого трекера',
    gains: [
      'Проєкти, задачі, коментарі та вкладення з YouTrack',
      'Записаний час і звʼязки переносяться разом із задачами',
      'Повторний запуск продовжує імпорт за зовнішніми ID, а не створює дублі',
    ],
    plans: ['lite', 'pro'],
    enforced: true,
    enforcedAt: 'src/app/(app)/settings/page.js',
  },
  {
    id: 'portal',
    label: 'Портал для клієнтів',
    detail: 'Замовник бачить свої проєкти, не заходячи в робочий простір',
    gains: [
      'Замовник бачить свої проєкти, не заходячи у ваш робочий простір',
      'Запити з порталу стають задачами тут',
      'Ви вирішуєте, що саме показано клієнту',
    ],
    plans: ['lite', 'pro'],
    enforced: true,
    enforcedAt: 'src/app/(app)/[projectId]/ProjectBoardClient.jsx',
  },
  {
    id: 'ai-calls',
    label: 'AI Аудіо-завдання',
    detail: 'Запис наради стає саммарі, рішеннями й чернетками задач',
    // On every plan, because Free has three of them: a feature nobody can try
    // is a line on a page. What differs is how many, and that is the ceiling
    // in PLAN_LIMITS, not a capability somebody does or does not have.
    plans: ['free', 'lite', 'pro'],
    enforced: false,
  },
  {
    id: 'priority-support',
    label: 'Пріоритетна підтримка',
    detail: 'Відповідаємо першими й розбираємось до кінця',
    plans: ['pro'],
    // Not a switch in the product and never will be. Listed with the rest
    // because it is part of what the plan buys; flagged like the rest because
    // nothing in the code enforces it.
    enforced: false,
  },
];

// Hryvnia, and prices shaped like prices. The three plans carried $0/$9/$19 —
// a currency nobody here is billed in, at figures that read as a rounding of
// something rather than as what the product costs. `currencyLabel` holds the
// unit so the figure itself stays a bare number in the largest type on the
// card, which is what makes the three of them comparable across the row.
export const PLANS = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Щоб спробувати продукт у роботі',
    priceLabel: '0',
    currencyLabel: 'грн / міс',
    ctaLabel: 'Почати',
    ctaNote: 'Без картки й без строку',
    limits: { projects: 3, members: 5, aiCalls: 3 },
  },
  {
    id: 'lite',
    // «Коли робочий простір показують клієнтам» was the old line, and it was
    // describing a product that does not exist: there is no client role in this
    // workspace at all, and the portal a customer would look at is a separate
    // application with its own database. Lite is the plan a team actually works
    // on — everything the product does, at the size of one team.
    name: 'Lite',
    tagline: 'Для малих і середніх компаній',
    priceLabel: '499',
    currencyLabel: 'грн / міс',
    ctaLabel: 'Спробувати',
    ctaNote: 'Оплата ще не підключена',
    limits: { projects: 20, members: 20, aiCalls: 20 },
  },
  {
    id: 'pro',
    name: 'Pro',
    // Pro adds no feature Lite does not have. What it takes away is the
    // ceilings, and the tagline says that rather than implying a fourth column
    // of things nobody would find on the card.
    tagline: 'Для великих компаній',
    priceLabel: '999',
    currencyLabel: 'грн / міс',
    ctaLabel: 'Спробувати',
    ctaNote: 'Оплата ще не підключена',
    limits: { projects: Infinity, members: Infinity, aiCalls: 100 },
    recommended: true,
  },
];

/**
 * One free workspace per account, said once.
 *
 * The screen and the route have to agree about this or the product refuses in
 * two voices: onboarding greys out the Free card, and `/api/organizations`
 * is the half that actually holds the line — a rule in `firestore.rules`
 * cannot count how many organizations somebody already owns, because rules
 * cannot count anything.
 *
 * Nothing punitive: the second workspace is a second workspace, and a free plan
 * is what the first one is for.
 *
 * Створення — не єдиний шлях до другого безкоштовного простору. Друга
 * організація, створена на платному тарифі, могла наступної секунди перемкнутися
 * на Free: правило трималося рівно на одному маршруті, а обходилося у два кроки.
 * Тому те саме питання ставить і `PATCH /api/organizations/[id]` з дією
 * `set-plan`, і той самий екран, що пропонує перемкнути тариф, — звідси другий
 * набір рядків: відмова при створенні пояснює, чому новий простір платний, а
 * відмова при перемиканні — чому наявний не може стати безкоштовним.
 */
export const FREE_WORKSPACE = {
  lockedLabel: 'Уже використано',
  hint: 'Безкоштовний робочий простір на акаунті вже є — цей буде на платному тарифі.',
  refusal: 'Безкоштовний робочий простір на акаунті вже є. Другий створюється на платному тарифі — наявний нікуди не дінеться.',
  switchHint: 'Безкоштовний робочий простір на акаунті вже є — цей лишається на платному тарифі.',
  switchTitle: 'Безкоштовний тариф уже зайнятий',
  switchLead: 'Один безкоштовний робочий простір на акаунт — і він у вас уже є.',
  switchHow: 'Щоб перевести цю організацію на Free, спершу переведіть на платний тариф ту, що зараз на безкоштовному. Тариф перемикається будь-коли й без карти.',
  switchReassurance: 'Нічого не видаляється й нікуди не дінеться: обидва простори лишаються на місці, з усіма проєктами, задачами та людьми.',
  switchRefusal: 'Безкоштовний робочий простір на акаунті вже є. Щоб перевести цю організацію на Free, спершу змініть тариф тій, що вже на ньому.',
};

/**
 * Чи є на акаунті інший робочий простір, який уже займає безкоштовний тариф.
 *
 * Питання ставлять двоє — екран тарифів і маршрут, що пише поле, — і обидва
 * мають рахувати однаково, інакше кнопка каже одне, а сервер відповідає інше.
 *
 * @param {Array<{id?: string, plan?: string}>} organizations простори, якими володіє акаунт
 * @param {string} exceptOrganizationId той, тариф якого зараз змінюють
 * @returns {object|null} перший знайдений безкоштовний простір, або `null`
 */
export function freeWorkspaceElsewhere(organizations = [], exceptOrganizationId = '') {
  return (Array.isArray(organizations) ? organizations : []).find(organization => (
    organization?.id
    && organization.id !== exceptOrganizationId
    && normalizePlan(organization.plan) === DEFAULT_PLAN
  )) || null;
}

/**
 * The projects a plan no longer has room for.
 *
 * The newest ones, because that is the only ordering somebody can predict: a
 * workspace that drops to a ceiling of three keeps the three it has had
 * longest, and the ones it opened last week are the ones that go quiet. They go
 * read-only, not away — this returns ids to mark, and nothing deletes anything.
 *
 * A project with no `createdAt` predates the field and is therefore old, so it
 * sorts first and is kept.
 */
export function projectsOverPlanLimit(planId, projects) {
  const ceiling = planLimit(planId, 'projects');
  if (!Number.isFinite(ceiling)) return [];
  const millis = value => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (Array.isArray(projects) ? projects : [])
    .filter(project => project?.id && project.status !== 'archived')
    .map((project, index) => ({ id: project.id, index, at: millis(project.createdAt) }))
    .sort((a, b) => (a.at - b.at) || (a.index - b.index))
    .slice(ceiling)
    .map(entry => entry.id);
}

/**
 * What changes when a workspace moves down a plan.
 *
 * Two lists, because they are two different kinds of change and answering them
 * as one flat list of bullets made the dialog read like an error log. Something
 * that *turns off* is a switch that stops working and keeps its setting; a
 * ceiling that is *already past* is a number that stops growing while
 * everything under it goes on working. Nothing in either list is destructive,
 * which is why the dialog leads with that instead of ending with it — it is the
 * part nobody believes without being told.
 *
 * Built from the registry rather than written out, so a plan that gains or
 * loses a capability changes this dialog by changing the table above.
 */
export function planDowngradeEffects(fromPlan, toPlan, used = {}) {
  const from = normalizePlan(fromPlan);
  const to = normalizePlan(toPlan);
  const turnedOff = PLAN_CAPABILITIES
    .filter(capability => capability.enforced)
    .filter(capability => planAllows(from, capability.id) && !planAllows(to, capability.id))
    // The name and nothing else. The registry's `detail` is written as a line
    // of a price list — capitalised, and sometimes three product names — and
    // neither reads as a clause inside a sentence. What each of these is is one
    // click away on the price list this dialog is asking about.
    .map(capability => capability.label);

  const overCeiling = [];
  for (const limit of PLAN_LIMITS) {
    const ceiling = planLimit(to, limit.id);
    if (!Number.isFinite(ceiling)) continue;
    const spent = typeof used[limit.id] === 'number' && used[limit.id] >= 0 ? used[limit.id] : null;
    if (spent === null || spent <= ceiling) continue;
    overCeiling.push({
      id: limit.id,
      label: limit.label,
      used: spent,
      ceiling,
      reading: `${spent} із ${ceiling}`,
      hint: limit.overageHint || '',
    });
  }

  return { turnedOff, overCeiling };
}

/**
 * The same thing as a dialog: a title and a body a confirm box can print.
 *
 * `null` when the move takes nothing away — going up a plan, or going down one
 * a workspace was not using.
 */
export function planDowngradeNotice(fromPlan, toPlan, used = {}) {
  const { turnedOff, overCeiling } = planDowngradeEffects(fromPlan, toPlan, used);
  if (!turnedOff.length && !overCeiling.length) return null;

  const name = planName(toPlan);
  const current = planName(fromPlan);
  return {
    title: `Перейти на ${name}?`,
    // Said first, because it is the part nobody believes.
    reassurance: 'Нічого не видаляється. Проєкти, задачі, час, файли й налаштування лишаються на місці — і повертаються такими, як були, щойно тариф повернеться.',
    turnedOffTitle: 'Перестане працювати',
    turnedOff,
    overCeilingTitle: `Уже більше, ніж дозволяє ${name}`,
    overCeiling,
    // The button that stays is the one that reads like the answer: this dialog
    // exists because somebody is one click from turning five things off, and a
    // pair of equally weighted buttons is not a question, it is a coin toss.
    stayLabel: `Залишитись на ${current}`,
    confirmLabel: `Все одно перейти на ${name}`,
    footnote: 'Повернути тариф можна будь-коли — вмикати наново нічого не доведеться.',
  };
}

/**
 * What the button on a plan's card says, given the plan the workspace is on.
 *
 * A card's own `ctaLabel` is written for somebody arriving at it from below:
 * «Почати» is what Free says to a new account. Said to somebody on Pro it is
 * nonsense — they have started, and pressing it would take something away. So a
 * plan cheaper than the current one asks to be moved to by name, and only a
 * plan above it keeps its own invitation.
 */
export function planCtaLabel(planId, activePlanId) {
  const plan = planById(planId);
  const order = PLANS.map(entry => entry.id);
  const goingDown = order.indexOf(plan.id) < order.indexOf(normalizePlan(activePlanId));
  return goingDown ? `Перейти на ${plan.name}` : plan.ctaLabel;
}

export function normalizePlan(value) {
  return PLANS.some(plan => plan.id === value) ? value : DEFAULT_PLAN;
}

export function planById(value) {
  const id = normalizePlan(value);
  return PLANS.find(plan => plan.id === id);
}

/** The plan's own name, for a badge that says which one a workspace is on. */
export function planName(value) {
  return planById(value).name;
}

export function planLimit(value, key) {
  const limit = planById(value).limits[key];
  return typeof limit === 'number' ? limit : Infinity;
}

/** What `planLimitValue` returns where a plan has no ceiling at all. */
export const UNLIMITED = 'unlimited';

/**
 * A number, «–» or the `UNLIMITED` marker — never «До 10».
 *
 * A column of bare figures is compared down the row at a glance; a word in
 * front of every one of them is read three times and says the same thing each
 * time.
 *
 * No ceiling is a marker rather than a word, because the two places that print
 * it want two different things. In the column of figures «Безліміт» is eight
 * characters of prose sitting where every other card has one or two digits, and
 * it is the widest thing on the card — so the card draws lucide's `Infinity`
 * there instead. It is not the «∞» glyph: that one is missing from Inter, and
 * every screen fell back to whatever font on the machine had it — thin, a
 * different size from the digits beside it and off their baseline. An icon is
 * drawn, not typeset, so it does neither.
 *
 * A sentence has no room for an icon, so it asks `planLimitText`.
 */
export function planLimitValue(value, key) {
  const limit = planLimit(value, key);
  if (limit === Infinity) return UNLIMITED;
  if (limit === 0) return '–';
  return String(limit);
}

/**
 * The same ceiling as something a sentence can contain.
 *
 * This is what the 403 body, the upgrade line and every other place with no
 * components print. `planLimitRefusal` reaches this and not the marker.
 */
export function planLimitText(value, key) {
  const raw = planLimitValue(value, key);
  return raw === UNLIMITED ? 'Безліміт' : raw;
}

/** The ceiling rows for one plan's card, ready to print. */
export function planLimitRows(value) {
  return PLAN_LIMITS.map(limit => ({
    id: limit.id,
    label: limit.label,
    value: planLimitValue(value, limit.id),
    // Said as a flag as well as in the value, so the card can decide to draw a
    // glyph without knowing what the marker string happens to be.
    unlimited: planLimit(value, limit.id) === Infinity,
    absent: planLimit(value, limit.id) === 0,
  }));
}

/**
 * Whether a plan includes a capability *and* the product enforces it.
 *
 * A capability nobody enforces yet answers `true` for every plan: a gate that
 * was never built is not a gate, and reporting one would make the caller hide
 * something people are using.
 */
export function planAllows(value, capabilityId) {
  const capability = PLAN_CAPABILITIES.find(entry => entry.id === capabilityId);
  if (!capability) return true;
  if (!capability.enforced) return true;
  return capability.plans.includes(normalizePlan(value));
}

/** The cheapest plan that includes a capability — «тільки в Lite і Pro». */
export function capabilityAvailability(capabilityId) {
  const capability = PLAN_CAPABILITIES.find(entry => entry.id === capabilityId);
  if (!capability) return '';
  const named = PLANS.filter(plan => capability.plans.includes(plan.id)).map(plan => plan.name);
  if (named.length === 0 || named.length === PLANS.length) return '';
  if (named.length === 1) return `тільки в ${named[0]}`;
  return `тільки в ${named.slice(0, -1).join(', ')} і ${named.at(-1)}`;
}

/** The plan before this one, or `null` for the first. */
export function previousPlan(value) {
  const index = PLANS.findIndex(plan => plan.id === normalizePlan(value));
  return index > 0 ? PLANS[index - 1] : null;
}

/**
 * Only what this plan adds over the one before it, plus the heading that says
 * so. The first plan inherits nothing, so it lists everything it has.
 *
 * This is why the columns stay readable: repeating the four shared lines on
 * every card buries the two that actually differ.
 */
export function planAddedCapabilities(value) {
  const id = normalizePlan(value);
  const earlier = previousPlan(id);
  return PLAN_CAPABILITIES.filter(capability => (
    capability.plans.includes(id)
    && (!earlier || !capability.plans.includes(earlier.id))
  ));
}

export function planInheritanceLabel(value) {
  const earlier = previousPlan(value);
  return earlier ? `Все з ${earlier.name} +` : 'Що входить';
}

/**
 * A ceiling as a number a Firestore document can hold. `Infinity` is not a
 * value that may be written, so no ceiling is stored as `null` — which is what
 * every reader of the organization's `limits` field already treats as
 * unlimited. Onboarding used to decide this with `plan === 'free' ? 3 : null`,
 * which handed Lite the unlimited copy of a ceiling the registry sets at ten.
 */
export function storedPlanLimit(value, key) {
  const limit = planLimit(value, key);
  return Number.isFinite(limit) ? limit : null;
}

// ── Where a ceiling stops being a page and starts being a gate ───────────
//
// Everything below answers one question in one place: given a plan, a ceiling
// and how much of it is spent, what does the product do and what does it say?
//
// It is one function because it was going to be six otherwise — the API route
// that refuses, the button that has to look refused before it is pressed, the
// strip across the top, the dialog that opens from the crown, and whatever
// comes next. Six copies of «is this full» is how a price list ends up promising
// one thing while the code does another, which is the whole failure this
// registry exists to prevent.

export function planLimitById(key) {
  return PLAN_LIMITS.find(limit => limit.id === key) || null;
}

/** What a capability is called and what it does — the price list's own words. */
export function capabilityById(capabilityId) {
  return PLAN_CAPABILITIES.find(entry => entry.id === capabilityId) || null;
}

/**
 * What a ceiling is doing right now.
 *
 * `absent` — the plan does not have this at all (a ceiling of zero), which is a
 * different sentence from `reached` and a different one from being close to it.
 * `blocked` is the one a caller usually wants: it is true for both.
 *
 * @param {string} planId
 * @param {string} key One of `PLAN_LIMITS`.
 * @param {number} used How many are in use. A number nobody knows yet is `null`.
 */
export function planLimitState(planId, key, used) {
  const ceiling = planLimit(planId, key);
  const spent = Number.isFinite(used) && used >= 0 ? used : null;
  const unlimited = ceiling === Infinity;
  const absent = ceiling === 0;
  const known = spent !== null;
  const reached = !absent && !unlimited && known && spent >= ceiling;
  return {
    id: key,
    planId: normalizePlan(planId),
    ceiling,
    used: spent,
    unlimited,
    absent,
    reached,
    blocked: absent || reached,
    // «3 з 3». Nothing to print where there is no ceiling or no count.
    reading: unlimited || absent || !known ? '' : `${spent} з ${ceiling}`,
  };
}

/**
 * The sentence that goes with that state, or `null` while nothing is wrong.
 *
 * Both halves come from `PLAN_LIMITS`, so the API route, the strip and the
 * dialog cannot word the same refusal three different ways.
 */
export function planLimitNotice(planId, key, used) {
  const state = planLimitState(planId, key, used);
  const limit = planLimitById(key);
  if (!limit || !state.blocked) return null;
  return {
    ...state,
    title: state.absent ? limit.absentTitle : limit.title,
    hint: state.absent ? (limit.absentHint || limit.hint) : limit.hint,
    label: limit.label,
  };
}

/**
 * The plans that would raise this ceiling, cheapest first, each with what it
 * raises it to. This is what the dialog offers, and it offers nothing when the
 * workspace is already on the plan with the highest ceiling — a dialog that
 * tries to sell Pro to somebody on Pro is worse than no dialog.
 */
export function plansRaisingLimit(planId, key) {
  const current = planLimit(planId, key);
  return PLANS
    .filter(plan => planLimit(plan.id, key) > current)
    .map(plan => ({
      id: plan.id,
      name: plan.name,
      priceLabel: plan.priceLabel,
      currencyLabel: plan.currencyLabel,
      value: planLimitText(plan.id, key),
    }));
}

/**
 * «На Lite — 10, на Pro — Безліміт». One line, for the places too small to
 * hold the price list itself: a tooltip, a toast, the body of a 403.
 */
export function planUpgradeLine(planId, key) {
  const raised = plansRaisingLimit(planId, key);
  if (!raised.length) return '';
  return raised.map(plan => `на ${plan.name} — ${plan.value}`).join(', ');
}

/**
 * The whole refusal as one string, for a server that has no components.
 *
 * `/api/projects` used to write its own — «Ліміт активних проєктів вичерпано.
 * Змініть тариф або заархівуйте проєкт.» — which is the same sentence as the
 * dialog's, kept in a different file, and the two would have parted company the
 * first time either was edited.
 */
export function planLimitRefusal(planId, key, used) {
  const notice = planLimitNotice(planId, key, used);
  if (!notice) return '';
  const line = planUpgradeLine(planId, key);
  return [notice.title, notice.hint, line && `Стеля ${line}.`].filter(Boolean).join(' ');
}

/**
 * The month a per-month ceiling is counted in, as `YYYY-MM`.
 *
 * Written from the organization's own timezone rather than the server's: a call
 * analysed at 01:00 Kyiv on the first belongs to the month that has just begun
 * for the team, not to the one still running in UTC.
 */
export function planUsagePeriod(date = new Date(), timeZone = 'Europe/Kyiv') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find(part => part.type === 'year')?.value || '0000';
  const month = parts.find(part => part.type === 'month')?.value || '00';
  return `${year}-${month}`;
}

/**
 * How much of each ceiling an organization has spent, read from the shape the
 * organization document carries.
 *
 * `usage` is a **display cache**, not the gate. Every refusal counts for real on
 * the server at the moment of the write — the project transaction counts
 * projects, the invitation counts memberships — and this exists so that a
 * button can look refused before it is pressed, and a strip can appear on a
 * screen that has loaded nothing but the organization. A client could write a
 * smaller number into it and change nothing about what it is allowed to do.
 *
 * A count nobody has written yet reads as `null`, which every caller here
 * treats as «not known», never as zero.
 */
export function planUsage(organization, { period = planUsagePeriod() } = {}) {
  const usage = organization?.usage || {};
  const number = value => (typeof value === 'number' && value >= 0 ? value : null);
  return {
    projects: number(usage.projects),
    members: number(usage.members),
    // A counter from a month that has ended is not a smaller number, it is no
    // number at all — the ceiling has already reset.
    aiCalls: usage.aiCallsPeriod === period ? number(usage.aiCalls) : 0,
  };
}

/**
 * Every ceiling that has actually run out. What the strip across the top of the
 * workspace prints, and what decides whether it is there at all.
 *
 * Only `reached`, never `absent`, and the difference is the whole point. A
 * ceiling that filled up is something that happened: yesterday it worked and
 * today it does not, and nobody was told. A capability the plan never had is
 * not an event — it is a line of the price list, which the reader has already
 * seen, and pinning it to the top of every screen of a brand-new empty
 * workspace says nothing except that we would like their money. That one is the
 * crown's job, beside the control, at the moment somebody reaches for it.
 */
export function planLimitNotices(planId, used = {}) {
  return PLAN_LIMITS
    .map(limit => planLimitNotice(planId, limit.id, used[limit.id]))
    .filter(notice => notice?.reached);
}
