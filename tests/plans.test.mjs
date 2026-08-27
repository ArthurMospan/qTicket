// Тариф — це те, що продукт справді робить інакше, а не те, що написано на
// сторінці з цінами.
//
// Тарифів троє, і названі вони були давно: онбординг пропонує Free, Lite і Pro
// за $0/$9/$19 ще до появи цього файлу. Бракувало того, хто прочитає їх далі.
// Екран налаштувань малював картку з тернарників по двох тарифах, а
// `/api/projects` відмовляв у четвертому проєкті через захардкоджене
// `plan !== 'pro' && count >= 3` — тобто Lite тихо дорівнював Free.
//
// Найважливіша перевірка тут — та, що звіряє прапорці `enforced` з кодом.
// Прапорець, якого ніхто не звіряє, перетворився б рівно на ту саму обіцянку,
// з якої все почалось.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_PLAN,
  PLANS,
  PLAN_CAPABILITIES,
  PLAN_LIMITS,
  capabilityAvailability,
  normalizePlan,
  planAddedCapabilities,
  planAllows,
  planById,
  planInheritanceLabel,
  planLimit,
  planLimitById,
  planLimitNotices,
  planLimitRefusal,
  planLimitRows,
  planLimitState,
  planLimitText,
  planLimitValue,
  planName,
  planDowngradeNotice,
  projectsOverPlanLimit,
  planUpgradeLine,
  planUsage,
  planUsagePeriod,
  plansRaisingLimit,
  previousPlan,
  storedPlanLimit,
  UNLIMITED,
} from '../src/lib/utils/plans.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('три тарифи, і саме ті, що названі в онбордингу', () => {
  assert.deepEqual(PLANS.map(plan => plan.id), ['free', 'lite', 'pro']);
  assert.deepEqual(PLANS.map(plan => plan.name), ['Free', 'Lite', 'Pro']);
  // Гривні. Долари тут не бере ніхто, а «9» і «19» читались як округлення
  // чогось, а не як ціна.
  assert.deepEqual(PLANS.map(plan => plan.priceLabel), ['0', '499', '999']);
  for (const plan of PLANS) assert.equal(plan.currencyLabel, 'грн / міс');
  assert.equal(planName('lite'), 'Lite');
  assert.equal(planName('казна-що'), 'Free');
});

test('невідомий тариф читається як безкоштовний, а не як помилка', () => {
  for (const id of ['free', 'lite', 'pro']) assert.equal(normalizePlan(id), id);
  // Організація, створена до появи поля, не має його зовсім.
  assert.equal(normalizePlan(undefined), DEFAULT_PLAN);
  assert.equal(normalizePlan(null), DEFAULT_PLAN);
  assert.equal(normalizePlan('enterprise'), DEFAULT_PLAN);
  assert.equal(planById('казна-що').id, DEFAULT_PLAN);
});

test('стелі ростуть від тарифу до тарифу і закінчуються безлімітом', () => {
  assert.deepEqual(PLANS.map(plan => planLimit(plan.id, 'projects')), [3, 20, Infinity]);
  assert.deepEqual(PLANS.map(plan => planLimit(plan.id, 'members')), [5, 20, Infinity]);
  // Модель — платимо за простір, а не за людину, тому жодна стеля не росте
  // від кількості людей у команді, і обидві зникають на верхньому тарифі.
  for (const plan of PLANS) {
    const projects = planLimit(plan.id, 'projects');
    const members = planLimit(plan.id, 'members');
    assert.ok(members >= projects, `${plan.id}: місць менше, ніж проєктів`);
  }
  // `Infinity` порівнюється тими самими операторами, тому виклик не мусить
  // розрізняти «безліміт» окремою гілкою — і саме цим Lite перестав бути Free.
  assert.ok(3 >= planLimit('free', 'projects'));
  assert.ok(3 < planLimit('lite', 'projects'));
  assert.ok(9999 < planLimit('pro', 'projects'));
  assert.equal(planLimit('free', 'придумане'), Infinity);
});

test('стеля друкується числом, рискою або маркером', () => {
  // Стовпчик голих чисел порівнюється поглядом по рядку; слово «до» перед
  // кожним читається тричі й щоразу означає те саме.
  assert.equal(planLimitValue('free', 'projects'), '3');
  assert.equal(planLimitValue('lite', 'members'), '20');
  // Безліміт у колонці цифр — це маркер, а не слово: «Безліміт» — вісім
  // символів там, де в кожній іншій картці одна-дві цифри, тобто найширше на
  // картці й саме в тому рядку, який порівнюють поглядом. Картка малює замість
  // нього іконку. І це не гліф «∞»: його немає в Inter, тож кожен екран
  // підставляв власний шрифт — тонший, іншого кегля і повз базову лінію цифр.
  assert.equal(planLimitValue('pro', 'projects'), UNLIMITED);
  // А в реченні іконці нема де стати, тому там і далі слово.
  assert.equal(planLimitText('pro', 'projects'), 'Безліміт');
  assert.equal(planLimitText('free', 'projects'), '3');
  // Три AI-завдання на Free: фіча, якої не можна спробувати, — це рядок на
  // сторінці, а не можливість. Тому нуля в стелях більше немає ніде, і риска
  // лишається як стан, а не як тариф.
  assert.equal(planLimitValue('free', 'aiCalls'), '3');
  assert.equal(planLimitValue('казна-що', 'aiCalls'), '3');
});

test('реєстр називає фічу так само, як її підписано в продукті', () => {
  // «Розбір дзвінків» не було видно в інтерфейсі ніде: вкладка в композері
  // підписана «AI Аудіо-завдання», і прайслист — останнє місце, якому вільно
  // вигадувати власне слово для того, що продукт уже назвав.
  const limit = PLAN_LIMITS.find(entry => entry.id === 'aiCalls');
  const capability = PLAN_CAPABILITIES.find(entry => entry.id === 'ai-calls');
  assert.equal(capability.label, 'AI Аудіо-завдання');
  assert.ok(limit.label.startsWith('AI Аудіо-завдання'));
  for (const text of [limit.label, limit.title, limit.absentTitle, capability.label]) {
    assert.doesNotMatch(text, /дзвінк/i, `«${text}» — назва, якої в інтерфейсі немає`);
  }
});

test('стелею стає лише те, що робочий простір може порахувати', () => {
  // Кількість задач не обмежується навмисно: це єдина стеля, від якої трекер
  // перестає бути трекером, і жоден конкурент її не ставить — Jira й Asana
  // рахують людей, Trello дошки, роботу не чіпає ніхто. Команда, що вперлась у
  // ліміт задач, не переходить на платний, вона перестає записувати задачі.
  //
  // «Клієнти в порталі» й «сховище файлів» пішли з іншої причини: портал — це
  // окремий продукт зі своєю базою, а байтів завантажень тут не міряє ніщо.
  // Стеля, якої нікому порахувати, — це речення на сторінці, а не тариф.
  assert.deepEqual(
    PLAN_LIMITS.map(limit => limit.id),
    ['projects', 'members', 'aiCalls'],
  );
  for (const limit of PLAN_LIMITS) {
    for (const plan of PLANS) {
      assert.equal(
        typeof plan.limits[limit.id],
        'number',
        `${plan.id} не має стелі «${limit.id}», яку прайслист друкує`,
      );
    }
  }
});

test('Pro має все, що має Lite, і ще щось понад те', () => {
  const lite = PLAN_CAPABILITIES.filter(capability => capability.plans.includes('lite'));
  const pro = PLAN_CAPABILITIES.filter(capability => capability.plans.includes('pro'));
  for (const capability of lite) {
    assert.ok(capability.plans.includes('pro'), `${capability.id} є в Lite, але не в Pro`);
  }
  assert.ok(pro.length > lite.length, 'Pro мусить додавати щось понад Lite');
  // І все, що є в безкоштовному, є в обох платних: сходинка вгору нічого не
  // забирає.
  for (const capability of PLAN_CAPABILITIES.filter(item => item.plans.includes('free'))) {
    assert.ok(capability.plans.includes('lite'), `${capability.id} зникає в Lite`);
    assert.ok(capability.plans.includes('pro'), `${capability.id} зникає в Pro`);
  }
});

test('брендинг починається з Lite і відмовляє безкоштовному', () => {
  assert.equal(planAllows('lite', 'branding'), true);
  assert.equal(planAllows('pro', 'branding'), true);
  assert.equal(planAllows('free', 'branding'), false);
  assert.equal(planAllows(undefined, 'branding'), false);
});

test('можливість, якої ніхто не стереже, не вдає обмеження', () => {
  // Якби `planAllows` відповідав «ні» безкоштовному на ще не втілене, виклик
  // почав би ховати те, чим люди вже користуються.
  const unenforced = PLAN_CAPABILITIES.find(capability => !capability.enforced);
  assert.ok(unenforced, 'у реєстрі має бути хоч одна ще не втілена можливість');
  for (const plan of PLANS) assert.equal(planAllows(plan.id, unenforced.id), true);
  assert.equal(planAllows('free', 'вигадана-можливість'), true);
});

test('замок називає найдешевший тариф, у якому фіча є', () => {
  assert.equal(capabilityAvailability('branding'), 'тільки в Lite і Pro');
  assert.equal(capabilityAvailability('priority-support'), 'тільки в Pro');
  // Те, що є всюди, не має чим бути обмеженим — і мовчить.
  assert.equal(capabilityAvailability('boards'), '');
  assert.equal(capabilityAvailability('вигадане'), '');
});

test('картка друкує лише те, що тариф додає до попереднього', () => {
  // Дванадцять спільних рядків на кожній картці ховають ті два, що справді
  // різні. Тому кожен тариф каже «Все з попереднього +» і перелічує нове.
  assert.equal(previousPlan('free'), null);
  assert.equal(previousPlan('lite').id, 'free');
  assert.equal(previousPlan('pro').id, 'lite');

  assert.equal(planInheritanceLabel('free'), 'Що входить');
  assert.equal(planInheritanceLabel('lite'), 'Все з Free +');
  assert.equal(planInheritanceLabel('pro'), 'Все з Lite +');

  const free = planAddedCapabilities('free').map(capability => capability.id);
  const lite = planAddedCapabilities('lite').map(capability => capability.id);
  const pro = planAddedCapabilities('pro').map(capability => capability.id);

  assert.ok(free.includes('boards'));
  assert.ok(lite.includes('branding'));
  assert.ok(pro.includes('priority-support'));
  // Нічого не повторюється між сходинками — саме це робить список читабельним.
  assert.equal(free.some(id => lite.includes(id)), false);
  assert.equal(lite.some(id => pro.includes(id)), false);
  // І разом вони покривають увесь реєстр.
  assert.equal(new Set([...free, ...lite, ...pro]).size, PLAN_CAPABILITIES.length);
});

test('рядки стель приходять готовими до друку', () => {
  const rows = planLimitRows('lite');
  assert.deepEqual(rows.map(row => row.id), PLAN_LIMITS.map(limit => limit.id));
  assert.deepEqual(rows.map(row => row.value), ['20', '20', '20']);
  assert.deepEqual(planLimitRows('pro').map(row => row.value), [UNLIMITED, UNLIMITED, '100']);
  // Прапорець сказаний окремо, щоб картка малювала гліф, не знаючи, яким саме
  // рядком записаний маркер.
  assert.deepEqual(planLimitRows('pro').map(row => row.unlimited), [true, true, false]);
  assert.deepEqual(planLimitRows('free').map(row => row.unlimited), [false, false, false]);
  // Жодна стеля не стоїть на нулі: кожен тариф дає спробувати все, що продукт
  // уміє, і різниця між тарифами — у числі, а не в наявності.
  for (const plan of PLANS) {
    for (const row of planLimitRows(plan.id)) {
      assert.equal(row.absent, false, `${plan.id}: «${row.label}» немає зовсім`);
    }
  }
});

test('у документ організації безліміт пишеться як null, а не як Infinity', () => {
  // Онбординг вирішував це тернарником `plan === 'free' ? 3 : null` — і Lite
  // отримував безлімітну копію стелі, яку прайслист ставить на десяти.
  assert.equal(storedPlanLimit('free', 'projects'), 3);
  assert.equal(storedPlanLimit('lite', 'projects'), 20);
  assert.equal(storedPlanLimit('pro', 'projects'), null);
  assert.equal(storedPlanLimit('pro', 'members'), null);
});

test('кожен тариф має все, що потрібно, щоб його намалювати', () => {
  for (const plan of PLANS) {
    for (const field of ['name', 'tagline', 'priceLabel', 'currencyLabel', 'ctaLabel', 'ctaNote']) {
      assert.equal(typeof plan[field], 'string', `${plan.id}.${field}`);
      assert.ok(plan[field].trim().length > 0, `${plan.id}.${field}`);
    }
  }
  const ids = PLAN_CAPABILITIES.map(capability => capability.id);
  assert.equal(new Set(ids).size, ids.length, 'id можливостей унікальні');
});

// ── Те, заради чого весь файл ────────────────────────────────────────────
test('кожен enforced-прапорець вказує на код, який справді питає про тариф', async () => {
  const enforced = [...PLAN_CAPABILITIES, ...PLAN_LIMITS].filter(entry => entry.enforced);
  assert.ok(enforced.length > 0);
  for (const entry of enforced) {
    assert.ok(entry.enforcedAt, `${entry.id}: enforced: true без enforcedAt — нікому перевірити`);
    const source = await read(entry.enforcedAt);
    // Стеля мусить бути прочитана з реєстру в тому самому файлі, який відмовляє.
    // Раніше тут стояли два дослівні виклики, і це тримало рівно один роут:
    // будь-яке інше місце, що читає тариф якось інакше, могло поставити
    // `enforced: true` й нічого не стерегти.
    const asks = new RegExp(
      `(planAllows|allowsOnPlan|planLimit|planLimitRefusalResponse|reserveAiCall)\\b[\\s\\S]{0,120}?'${entry.id}'`
      + `|'${entry.id}'[\\s\\S]{0,120}?(planAllows|allowsOnPlan|planLimit)\\b`
      // `PlanGate` is the third way of asking, and the only one that can put a
      // whole screen behind the answer. It names the capability as a literal
      // and calls `planAllows` itself, which is what the other two do inline.
      + `|<PlanGate capabilityId="${entry.id}"`,
    );
    assert.match(
      source,
      asks,
      `${entry.id}: ${entry.enforcedAt} не питає реєстр про цю стелю`,
    );
  }
});

test('стан стелі — одна функція, а не шість копій «чи повно»', () => {
  const full = planLimitState('free', 'projects', 3);
  assert.equal(full.reached, true);
  assert.equal(full.blocked, true);
  assert.equal(full.absent, false);
  assert.equal(full.reading, '3 з 3');

  const room = planLimitState('free', 'projects', 2);
  assert.equal(room.reached, false);
  assert.equal(room.blocked, false);
  assert.equal(room.reading, '2 з 3');

  // Безліміт не буває повним, скільки б там не було.
  const unlimited = planLimitState('pro', 'projects', 9999);
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.blocked, false);
  assert.equal(unlimited.reading, '');

  // Стеля в нуль — це не «вичерпано», це «цього тут немає»: інше речення і
  // інша відповідь. Жоден тариф зараз на нулі не стоїть, але стан лишається:
  // саме він відрізняє «закінчилось» від «цього у вас не було».
  const none = planLimitState('вигаданий-тариф', 'вигадана-стеля', 0);
  assert.equal(planLimitState('free', 'aiCalls', 3).absent, false);
  assert.equal(planLimitState('free', 'aiCalls', 3).reached, true);
  assert.equal(none.absent, false);

  // Число, якого ніхто ще не порахував, — це не нуль. Інакше порожній кеш
  // означав би «все вільно» саме тоді, коли він нічого не знає.
  const unknown = planLimitState('free', 'members', null);
  assert.equal(unknown.used, null);
  assert.equal(unknown.reached, false);
  assert.equal(unknown.reading, '');
});

test('речення відмови збирається з реєстру, і в ньому є вихід', () => {
  const refusal = planLimitRefusal('free', 'projects', 3);
  assert.match(refusal, /Ліміт проєктів вичерпано/);
  // Без поради «заархівуйте»: спосіб не платити, запропонований продуктом у
  // першому ж реченні про власну стелю, — і повторений під прайслистом.
  assert.doesNotMatch(refusal, /заархівуйте/);
  assert.equal(planLimitById('projects').hint, '');
  // І названі обидва тарифи, що піднімають цю стелю, а не тільки найдорожчий.
  assert.match(refusal, /на Lite — 20/);
  // Серверне речення не має куди подіти іконку, тому безліміт у ньому — слово.
  assert.match(refusal, /на Pro — Безліміт/);
  assert.doesNotMatch(refusal, /unlimited/);

  // А те, що в тарифі є й закінчилось, — саме «вичерпано».
  assert.match(planLimitRefusal('free', 'aiCalls', 3), /AI Аудіо-завдання на цей місяць вичерпано/);
  // А там, де все гаразд, речення немає взагалі.
  assert.equal(planLimitRefusal('free', 'projects', 2), '');
  assert.equal(planLimitRefusal('pro', 'projects', 9999), '');
});

test('діалог не продає Pro тому, хто вже на Pro', () => {
  assert.deepEqual(plansRaisingLimit('free', 'projects').map(plan => plan.id), ['lite', 'pro']);
  assert.deepEqual(plansRaisingLimit('lite', 'projects').map(plan => plan.id), ['pro']);
  assert.deepEqual(plansRaisingLimit('pro', 'projects'), []);
  assert.equal(planUpgradeLine('pro', 'projects'), '');
});

test('місяць для помісячної стелі рахується в часовому поясі команди', () => {
  // 31 серпня 23:30 у Києві — це вже 1 вересня для команди, і саме тоді
  // лічильник має обнулитись, а не через дві години за Гринвічем.
  assert.equal(planUsagePeriod(new Date('2026-08-31T20:30:00Z'), 'Europe/Kyiv'), '2026-08');
  assert.equal(planUsagePeriod(new Date('2026-08-31T22:30:00Z'), 'Europe/Kyiv'), '2026-09');
});

test('лічильник із минулого місяця — це не менше число, а жодного', () => {
  const organization = { usage: { projects: 2, members: 7, aiCalls: 9, aiCallsPeriod: '2026-07' } };
  assert.deepEqual(planUsage(organization, { period: '2026-08' }), {
    projects: 2, members: 7, aiCalls: 0,
  });
  assert.deepEqual(planUsage(organization, { period: '2026-07' }), {
    projects: 2, members: 7, aiCalls: 9,
  });
  // Організація, у якої лічильників ще немає, не вдає, що вони нульові.
  assert.deepEqual(planUsage({}, { period: '2026-08' }), {
    projects: null, members: null, aiCalls: 0,
  });
});

test('смуга нагорі каже лише про те, що вичерпалось', () => {
  // Free не має розбору дзвінків узагалі, і смуга про це мовчить: це не подія,
  // а рядок прайслиста, який людина вже читала. Вішати його вгорі кожного
  // екрана порожнього нового простору — це не новина, а вимога грошей.
  const notices = planLimitNotices('free', { projects: 3, members: 2, aiCalls: 0 });
  assert.deepEqual(notices.map(notice => notice.id), ['projects']);
  assert.equal(notices[0].reached, true);
  // Дві вичерпані стелі — обидві в списку, щоб смуга могла сказати «ще одна».
  const both = planLimitNotices('free', { projects: 3, members: 5, aiCalls: 0 });
  assert.deepEqual(both.map(notice => notice.id), ['projects', 'members']);
  // Там, де все вільно, смуги немає.
  assert.deepEqual(planLimitNotices('pro', { projects: 100, members: 100, aiCalls: 10 }), []);
  assert.deepEqual(planLimitNotices('free', { projects: 1, members: 1, aiCalls: 0 }), []);
});

// Без коментарів у обох файлах: те, що звідти прибрано, описане прозою поруч,
// і опис видаленого коду — не код.
const withoutComments = source => source
  .split(/\r?\n/)
  .filter(line => !/^\s*(\/\/|\*|\{\/\*)/.test(line))
  .join('\n');

test('обидва місця, що рахують проєкти, читають одну стелю', async () => {
  const createRoute = withoutComments(await read('src/app/api/projects/route.js'));
  const home = withoutComments(await read('src/app/(app)/page.js'));
  // Захардкоджена трійка мала на один тариф менше, ніж продукт.
  assert.doesNotMatch(createRoute, /!== 'pro' && activeProjectsCount >= 3/);
  assert.doesNotMatch(home, /orgPlan !== 'pro'/);
  assert.match(createRoute, /planLimit\(refusedPlan, 'projects'\)/);
  // Екран більше не рахує стелю сам: він друкує те саме `planLimitNotice`, з
  // якого зібрана відмова роуту, тож речення на екрані й речення з сервера — це
  // одне речення.
  assert.match(home, /planLimitNotice\(orgPlan, 'projects', activeProjectsCount\)/);
  assert.doesNotMatch(home, /На тарифі \{planById/);
  // І відмова більше не називає єдиним виходом найдорожчий тариф.
  assert.doesNotMatch(createRoute, /Перейдіть на Pro план/);
});

test('прайслист один на весь продукт', async () => {
  // Дві рукописні копії прайслиста розійшлися рівно так, як копії й розходяться:
  // онбординг показував $0/$9/$19 із чотирма вигаданими пунктами на картку, а
  // налаштування — реєстр. Людина бачила перший у день реєстрації, а другий —
  // коли вперше пішла шукати рахунок.
  const settings = withoutComments(await read('src/app/(app)/settings/page.js'));
  const onboarding = withoutComments(await read('src/app/onboarding/page.js'));

  for (const [name, page] of [['налаштування', settings], ['онбординг', onboarding]]) {
    assert.match(page, /<PlanCards/, `${name} малює прайслист сам, замість PlanCards`);
    // Ціни, назви й списки не переказуються на екрані жодного разу.
    assert.doesNotMatch(page, /\$0|\$9|\$19|\$15/, `${name} називає ціну сам`);
    assert.doesNotMatch(page, /До \d+ активних проєктів/, `${name} переказує стелю словами`);
  }

  assert.doesNotMatch(settings, /isPro \? Infinity : 3/);
  assert.match(settings, /activePlanId=\{orgPlan\}/);
  // Онбординг більше не тримає «обраний» тариф: кнопка картки — це і вибір, і
  // дія одночасно, тож між ними нічого не лежить, і окремої «Продовжити» немає.
  assert.match(onboarding, /activePlanId=""/);
  assert.match(onboarding, /onChoose=\{handleFinish\}/);
  assert.doesNotMatch(onboarding, /Продовжити/);
  // Один безкоштовний простір на акаунт — принаймні цей екран так каже.
  assert.match(onboarding, /lockedPlanIds=\{freeTaken \? \['free'\] : \[\]\}/);
  // Стеля в документі організації теж із реєстру, а не з тернарника — і пише
  // її тепер сервер, бо plan і limits браузеру заборонені: зміна тарифу ще й
  // вирішує, для яких проєктів нової стелі вже не вистачає.
  assert.doesNotMatch(onboarding, /maxProjects: 3/);
  assert.doesNotMatch(onboarding, /limits: {/);
  const createRoute = await read('src/app/api/organizations/route.js');
  assert.match(createRoute, /storedPlanLimit\(plan, 'projects'\)/);
  const planRoute = await read('src/app/api/organizations/[organizationId]/route.js');
  assert.match(planRoute, /storedPlanLimit\(plan, 'projects'\)/);
  assert.match(planRoute, /resyncProjectsOverPlanLimit\(/);

  // Перемикання щось робить, а не показує тост про майбутнє. І пише його одне
  // місце: два екрани, що пишуть одне поле, писали б його двома способами.
  assert.doesNotMatch(settings, /Підключення платіжної системи в розробці/);
  assert.match(settings, /switchOrganizationPlan\(activeOrgId, next\)/);
  assert.doesNotMatch(settings, /updateDoc\(doc\(db, 'organizations', activeOrgId\), \{ plan/);
  const service = await read('src/lib/services/organizationPlan.js');
  assert.match(service, /action: 'set-plan', plan: next/);
  assert.doesNotMatch(service, /updateDoc\(/);
  // Пониження питають перед тим, як зробити, і питають обидва екрани — з
  // одного реєстру, щоб діалог із корони не був тихішим способом втратити фічу.
  const upgradeHost = await read('src/components/WorkspacePlanUpgradeHost.jsx');
  assert.match(settings, /planDowngradeNotice\(/);
  assert.match(upgradeHost, /planDowngradeNotice\(/);
  assert.match(settings, /Оплата ще не підключена/);
  // Тост називає тариф його іменем: на трьох тарифах дві гілки казали «Тариф
  // змінено на Безкоштовний» тому, хто щойно взяв Lite.
  assert.match(settings, /Тариф змінено на \$\{planName\(next\)\}/);

  // Тариф видно з меню, і безкоштовний позначений червоним — саме там є стеля,
  // в яку хтось упреться.
  assert.match(settings, /badge: planName\(orgPlan\)/);
  assert.match(settings, /badgeAlert: orgPlan === DEFAULT_PLAN/);
  // Який це колір, вирішує кіт, а не сторінка.
  const nav = await read('src/components/ui/Navigation/InnerNavigation.jsx');
  assert.match(nav, /tone=\{item\.badgeAlert \? 'danger-strong' : 'dark'\}/);

  // Корона живе біля контрола в продукті, а не в прайслисті: прайс уже сказав,
  // що входить у тариф, тим що перелічив це. І вона знає, про що вона, —
  // інакше клік відкрив би просто прайслист і лишив читача шукати рядок.
  assert.match(settings, /<PlanMark capabilityId="branding" label=\{capabilityAvailability\('branding'\)\} \/>/);
});

test('картка тарифу вирівнює колонки сіткою, а не сподіванням', async () => {
  const card = withoutComments(await read('src/components/ui/DataDisplay/PlanCards.jsx'));

  assert.match(card, /planLimitRows\(plan\.id\)/);
  assert.match(card, /planAddedCapabilities\(plan\.id\)/);
  assert.match(card, /planInheritanceLabel\(plan\.id\)/);

  // П'ять смуг картки — п'ять рядків зовнішньої сітки. Стовпчик із блоків, що
  // просто складені один на одного, вирівняти не можна: підпис, який у одній
  // картці переноситься на другий рядок, зсуває вниз лише її ціну.
  assert.match(card, /lg:grid-rows-\[auto_auto_auto_auto_auto\]/);
  assert.match(card, /lg:grid-rows-subgrid lg:row-span-5/);
  const bands = (card.match(/px-5/g) || []).length;
  assert.equal(bands, 5, 'смуг має бути рівно пʼять, і кожна зі своїм відступом');

  // Порядок: ціна -> стелі -> кнопка -> що додає. «Скільки це коштує» і «чи
  // беру» — одне рішення, тому кнопка стоїть під ціною, а не в підвалі.
  const price = card.indexOf('{plan.priceLabel}');
  const limits = card.indexOf('planLimitRows(plan.id)');
  const button = card.indexOf('onChoose?.(plan.id)');
  const added = card.indexOf('planInheritanceLabel(plan.id)');
  assert.ok(price > 0 && limits > price && button > limits && added > button,
    'ціна -> стелі -> кнопка -> що додає');

  // Кольори тільки наші. Найпопулярніший тариф не фарбується в синє — він несе
  // бейдж і більше нічого, — а галочка малюється чорнилом продукту, бо зелений
  // у цьому продукті означає «зроблено».
  assert.doesNotMatch(card, /tone="info"|border-info|text-success/);
  assert.match(card, /Популярний/);
  assert.doesNotMatch(card, /Найпопулярніший/);
  assert.match(card, /<Check size=\{14\} className="mt-\[3px\] shrink-0 text-ink-soft"/);
  // Стелі гучніші за список фіч, а не тихіші: саме їх порівнюють поглядом по
  // рядку, а список однаковий у кожній колонці.
  assert.match(card, /\{limit\.absent \? 'text-faint' : 'text-ink'\}/);

  // Безліміт у колонці цифр — іконка, а не слово. Імпортована під іншим
  // іменем: `Infinity` — глобал, і імпорт під власним іменем його затінює.
  assert.match(card, /Infinity as InfinityIcon/);
  assert.match(card, /{limit.unlimited/);
  assert.match(card, /<InfinityIcon size=/);
  assert.doesNotMatch(card, /Безліміт<|>Безліміт/);

  // Бейджа «Ваш тариф» немає: кнопка тієї самої картки вже це каже.
  assert.doesNotMatch(card, /Ваш тариф/);
});

// ── Стеля мусить бути видною до кліку, а не тільки після нього ───────────
test('кожен контрол, що впреться в стелю, носить корону', async () => {
  const surfaces = [
    // «Новий проєкт»
    ['src/app/(app)/page.js', 'projects'],
    // «Запросити» — обидва місця, звідки запрошують
    ['src/app/(app)/team/page.js', 'members'],
    ['src/app/(app)/settings/page.js', 'members'],
    // Вкладка «Аудіо-завдання (AI)»
    ['src/components/CreateTaskModal.jsx', 'aiCalls'],
  ];
  for (const [path, limitId] of surfaces) {
    const source = withoutComments(await read(path));
    assert.match(source, /usePlanLimits\(\)/, `${path}: не питає, чи є місце`);
    assert.match(source, /PlanCrownIcon/, `${path}: контрол не носить корону`);
    assert.match(
      source,
      new RegExp(`openPlanUpgrade\\(\\{ limitId: '${limitId}' \\}\\)`),
      `${path}: корона не відкриває прайслист на тій стелі, що заважає`,
    );
  }
});

test('корона — це корона, і вона клікається', async () => {
  const mark = await read('src/components/ui/DataDisplay/PlanMark.jsx');
  // Зірочка означає «улюблене» в кожному продукті, який людина бачила, — і в
  // цьому теж. Позначати нею «сюди не можна» означало малювати одним гліфом
  // дві протилежні речі.
  assert.doesNotMatch(mark, /\bStar\b/);
  assert.match(mark, /PlanCrownIcon/);
  assert.match(mark, /openPlanUpgrade\(/);
  const icons = await read('src/lib/design/icons.js');
  assert.match(icons, /export const PlanCrownIcon/);
  assert.match(icons, /fill="currentColor"/);
});

test('стеля живе в рейці, а діалог — у каркасі, а не на кожному екрані окремо', async () => {
  const layout = await read('src/app/(app)/layout.js');
  assert.match(layout, /<WorkspacePlanUpgradeHost \/>/);
  // Нічого між оболонкою і білою панеллю. Смуга, що там висіла, робила кожен
  // екран під нею на свою висоту нижчим — а два екрани, які міряють себе від
  // вікна, а не від власної колонки, ставали вищими за місце, яке мають.
  assert.doesNotMatch(layout, /WorkspacePlanLimitBanner/);
  const sidebar = await read('src/components/WorkspaceSidebar.jsx');
  assert.ok(sidebar.includes('<WorkspacePlanLimitRail collapsed={collapsed} />'));
  // І рейка каже це там само, де вже говорить про організацію, проєкти й
  // таймер, — над «?», не над сторінкою.
  const railAt = sidebar.indexOf('<WorkspacePlanLimitRail');
  const helpAt = sidebar.indexOf('<WorkspaceHelpMenu collapsed');
  assert.ok(railAt > 0 && helpAt > railAt, 'смужка стелі має стояти над кнопкою «?»');
  // Кольори намішані з власного тексту рейки, тому вони переживають будь-який
  // брендинг: усередині рейки бренд-токенів не буває.
  const notice = await read('src/components/ui/Feedback/PlanLimitRail.jsx');
  assert.doesNotMatch(notice, /text-ink|bg-line|bg-canvas|text-muted/);
  const css = await read('src/app/globals.css');
  assert.ok(css.includes('.ui-rail-notice {'));
  assert.ok(css.includes('color-mix(in srgb, var(--sb-text'));
  // І висота рейки завдання більше не виводиться з вікна: її міряють.
  assert.ok(css.includes('var(--ui-detail-scrollport'));
  const detail = await read('src/components/ui/Layout/DetailLayout.jsx');
  assert.ok(detail.includes("setProperty('--ui-detail-scrollport'"));

  const store = await read('src/store/useWorkspaceStore.js');
  assert.match(store, /openPlanUpgrade: \(context = \{\}\) =>/);
  // Перемикання організації не має лишати на екрані діалог про тариф тієї, з
  // якої щойно вийшли.
  assert.match(store, /resetOrganizationScope[\s\S]{0,600}planUpgrade: null/);

  // Прайслист у діалозі — той самий компонент, а не четверта копія цін.
  const dialog = await read('src/components/ui/Feedback/PlanUpgradeDialog.jsx');
  assert.match(dialog, /<PlanCards/);
  assert.doesNotMatch(dialog, /\d+ грн|\$\d/);
});

test('усе, що створює проєкт, питає одну стелю', async () => {
  // Їх троє, і третій ховався: імпорт із YouTrack теж створює проєкт, і теж мав
  // власну копію — `plan !== 'pro'` з захардкодженою трійкою і «перейдіть на
  // Pro» як єдиним виходом. Стеля, записана тричі, розходиться в трьох місцях.
  const creators = [
    'src/app/api/projects/route.js',
    'src/app/api/projects/[projectId]/route.js',
    'src/lib/server/youtrackImporter.js',
  ];
  for (const path of creators) {
    const source = withoutComments(await read(path));
    assert.match(source, /planLimit\([^)]*, 'projects'\)/, `${path}: не питає реєстр про стелю`);
    assert.match(source, /planLimitRefusal\(/, `${path}: пише відмову сам`);
    assert.doesNotMatch(source, /!== 'pro'/, `${path}: досі порівнює з Pro`);
    assert.doesNotMatch(source, />= 3\b/, `${path}: досі має захардкоджену трійку`);
    assert.doesNotMatch(source, /перейдіть на Pro|Перейдіть на Pro/, `${path}: називає лише найдорожчий тариф`);
  }
});

test('усі три стелі мають роут, який справді рахує', async () => {
  const invitations = withoutComments(await read('src/app/api/invitations/route.js'));
  const ai = withoutComments(await read('src/app/api/ai/call-to-tasks/route.js'));

  // Місця рахуються агрегатом, а не вичиткою всієї колекції: у продукту денний
  // бюджет читань, і «порахувати команду» не має його з'їдати.
  assert.match(invitations, /countActiveMembers\(db, organizationId\)/);
  assert.match(invitations, /planLimitRefusalResponse\([\s\S]{0,120}?'members'/);
  // Запрошення, яке ще висить, — це вже зайняте місце. Інакше можна було б
  // нарозсилати їх скільки завгодно й дізнатись про стелю, коли всі приймуть.
  assert.match(invitations, /pendingSeats/);
  assert.match(invitations, /seatsTaken \+ pendingSeats/);

  // Дзвінок питають ДО моделі, а рахують ПІСЛЯ відповіді: те, що Gemini не
  // віддав, не має з'їдати чийсь місяць.
  // Скрізь `await`: без нього перший збіг — це рядок імпорту вгорі файлу або
  // оголошення самої функції, а не те місце, де її викликають.
  const reserve = ai.indexOf('await reserveAiCall(');
  const refuse = ai.indexOf("planLimitRefusalResponse(allowance.plan, 'aiCalls'");
  const analyze = ai.indexOf('await analyzeWithGemini(');
  const commit = ai.indexOf('await commitAiCall(');
  assert.ok(reserve > 0 && refuse > reserve && analyze > refuse && commit > analyze,
    'reserve -> refuse -> analyze -> commit');
});

// ── Екран ховає кнопку; двері відповідають, коли кнопки немає ────────────
//
// Саме на дверях і трималися всі дірки, знайдені при пониженні тарифу: гейт
// стояв там, де щось малюється, і ніде більше. Оплатив місяць, увімкнув
// логотип, повернувся на Free — логотип лишався назавжди, бо перемикач у
// налаштуваннях знав про тариф, а сайдбар, який його малює, ні. Ключ, виданий
// на Lite, далі пускав. Телеграм-група далі створювала задачі.
//
// Тому кожна платна можливість тут названа разом із файлами, які справді
// відмовляють. Список — не документація: якщо у файлі не залишиться виклику,
// тест упаде.
test('кожна платна можливість має двері, а не лише екран', async () => {
  const doors = {
    branding: [
      'src/lib/hooks/useCachedOrgBranding.js',
      'src/components/OrgSwitcherScreen.jsx',
    ],
    invoices: ['src/app/api/invoices/route.js'],
    integrations: [
      'src/app/api/v1/projects/route.js',
      'src/app/api/v1/tasks/route.js',
      'src/app/api/integrations/api-keys/route.js',
      'src/app/api/integrations/telegram/route.js',
      'src/app/api/integrations/telegram/group/route.js',
      'src/app/api/integrations/telegram/webhook/route.js',
    ],
    'data-import': [
      'src/app/api/integrations/youtrack/route.js',
      'src/app/api/integrations/youtrack/import/route.js',
    ],
    // Портал живе в іншому застосунку з власною базою: тут можна зачинити
    // вкладку й перемикач, а показує проєкт замовнику QuickTeam+. Двері для
    // нього — у контракті між репозиторіями, не в цьому файлі.
    portal: [],
  };

  for (const capability of PLAN_CAPABILITIES.filter(entry => entry.enforced)) {
    assert.ok(capability.id in doors, `у «${capability.id}» немає списку дверей`);
    for (const path of doors[capability.id]) {
      const source = withoutComments(await read(path));
      assert.match(
        source,
        /planAllows\(|refuseWithoutCapability\(|planCapabilityRefusalResponse\(/,
        `${path}: малює або пускає, не спитавши реєстр`,
      );
      assert.ok(
        source.includes(`'${capability.id}'`),
        `${path}: не називає можливість, за яку відповідає`,
      );
    }
  }

  // І відмова збирається з реєстру, а не пишеться в роуті.
  const helper = await read('src/lib/server/planLimits.js');
  assert.match(helper, /capabilityById\(capabilityId\)/);
  assert.match(helper, /capabilityAvailability\(capabilityId\)/);
  assert.match(helper, /Дані збережені/);
});

test('проєкт понад стелю стає тільки для читання, а не зникає', async () => {
  // Найновіші, бо це єдиний порядок, який людина може передбачити сама.
  const projects = [
    { id: 'old', status: 'active', createdAt: '2024-01-01' },
    { id: 'mid', status: 'active', createdAt: '2024-02-01' },
    { id: 'new', status: 'active', createdAt: '2024-03-01' },
    { id: 'newest', status: 'active', createdAt: '2024-04-01' },
    { id: 'archived', status: 'archived', createdAt: '2024-05-01' },
  ];
  assert.deepEqual(projectsOverPlanLimit('free', projects), ['newest']);
  // Безліміт нічого не закриває, і архів не рахується.
  assert.deepEqual(projectsOverPlanLimit('pro', projects), []);
  assert.deepEqual(projectsOverPlanLimit('lite', projects), []);
  // Проєкт без createdAt — старий, а не новий: поле зʼявилось пізніше за нього.
  assert.deepEqual(
    projectsOverPlanLimit('free', [{ id: 'legacy', status: 'active' }, ...projects.slice(0, 3)]),
    ['new'],
  );

  // Позначка перераховується скрізь, де змінюється сам набір активних
  // проєктів, а не лише коли міняється тариф: заархівував один — звільнилось
  // місце для того, що став тільки для читання, і про це не дізнався б ніхто.
  const helper = await read('src/lib/server/planLimits.js');
  assert.match(helper, /export async function resyncProjectsOverPlanLimit/);
  assert.match(helper, /overPlanLimit: overLimit.has\(document.id\)/);
  for (const path of [
    'src/app/api/organizations/[organizationId]/route.js',
    'src/app/api/projects/[projectId]/route.js',
  ]) {
    assert.match(await read(path), /resyncProjectsOverPlanLimit\(/, path);
  }
  // Писати її з браузера не можна — інакше можна було б зняти позначку й
  // писати далі.
  const rules = await read('firestore.rules');
  assert.match(rules, /'overPlanLimit'/);

  // Читається все, пишеться нічого: спільна відповідь для роутів, що правлять
  // і видаляють задачу, і власна перевірка там, де задачу створюють.
  const access = withoutComments(await read('src/lib/utils/projectAccess.mjs'));
  assert.match(access, /project.overPlanLimit === true/);
  const create = withoutComments(await read('src/app/api/issues/route.js'));
  assert.match(create, /PROJECT_OVER_PLAN_LIMIT/);
});

test('пониження тарифу описане до того, як сталося', () => {
  // Нічого не видаляється — і це перше, що там написано, бо саме в це не
  // вірять. Далі тільки те, що справді зміниться, зібране з реєстру.
  const notice = planDowngradeNotice('pro', 'free', { projects: 12, members: 20, aiCalls: 30 });
  assert.match(notice.title, /Free/);
  assert.match(notice.reassurance, /Нічого не видаляється/);
  // Дві різні речі — і два різні списки: перемикач, який перестане працювати,
  // і число, яке перестане рости. Одним плоским переліком це читалось як лог
  // помилок, і саме тому діалог тепер малює їх по-різному.
  assert.ok(notice.turnedOff.includes('Власний брендинг'));
  const projects = notice.overCeiling.find(limit => limit.id === 'projects');
  assert.equal(projects.label, 'Проєкти');
  assert.equal(projects.reading, '12 із 3');
  assert.match(projects.hint, /тільки для читання/);
  assert.ok(notice.overCeiling.some(limit => limit.reading === '20 із 5'));
  // Кнопки не рівні: та, що лишає все як є, названа тарифом, на якому ви вже є.
  assert.match(notice.stayLabel, /Залишитись на Pro/);
  assert.match(notice.confirmLabel, /Все одно перейти на Free/);
  // І в кінці — що це оборотно, бо саме в це не вірять.
  assert.match(notice.footnote, /Повернути тариф можна будь-коли/);
  // Угору по тарифах нічого не втрачається, тож і питати нема про що.
  assert.equal(planDowngradeNotice('free', 'pro', { projects: 1, members: 1 }), null);
  // І вниз теж, поки простір не переріс нову стелю й нічого платного не вмикав.
  assert.equal(planDowngradeNotice('free', 'free', { projects: 1 }), null);
});

test('брендинг зачинений тарифом, але не вимикається заднім числом', async () => {
  const page = await read('src/app/(app)/settings/page.js');
  assert.match(page, /const brandingAllowed = allowsOnPlan\('branding'\)/);
  assert.match(page, /disabled=\{!orgLogo \|\| !brandingAllowed\}/);
  assert.match(page, /if \(!brandingAllowed\) return;/);
  // Причина названа короною біля самого перемикача — так само, як скрізь у
  // продукті. Півпрозорий блок цього не каже: 50% непрозорості означає «щось
  // вантажиться або зламалось», а не «це коштує грошей».
  assert.match(page, /<PlanMark capabilityId="branding"/);
  // І сам `allowsOnPlan` — це реєстр плюс одне: «документ уже прочитано».
  assert.match(page, /const allowsOnPlan = capabilityId => !planKnown \|\| planAllows\(orgPlan, capabilityId\);/);
  assert.doesNotMatch(page, /opacity-50 pointer-events-none/);
  assert.doesNotMatch(page, /Доступно на тарифах Lite і Pro/);
});
