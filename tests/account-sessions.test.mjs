import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_REMEMBERED_SESSIONS,
  describeDevice,
  describePlace,
  describeSignInMethods,
  deviceKind,
  expiredSessionIds,
  isSessionId,
  listSessions,
} from '../src/lib/utils/accountSessions.mjs';

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/141.0.0.0`;
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

test('a device is named by the most specific claim its user agent makes', () => {
  assert.equal(describeDevice(CHROME_WINDOWS), 'Chrome · Windows');
  // Edge and Chrome both say "Chrome"; Chrome and Safari both say "Safari".
  // Reading them in the wrong order makes every browser the last one listed.
  assert.equal(describeDevice(EDGE_WINDOWS), 'Edge · Windows');
  assert.equal(describeDevice(SAFARI_IOS), 'Safari · iOS');
  assert.equal(describeDevice('curl/8.4.0'), 'Невідомий пристрій');
  assert.equal(describeDevice(undefined), 'Невідомий пристрій');
});

test('a session with no reported origin claims none', () => {
  assert.equal(describePlace({}), null);
  assert.equal(describePlace({ city: '', country: '  ' }), null);
  // The country is spelled out. «UA» is an identifier for a machine, and the
  // row it sits in is read by a person deciding whether they recognise a login.
  assert.equal(describePlace({ city: 'Kyiv', country: 'UA' }), 'Kyiv, Україна');
  // Vercel percent-encodes city names.
  assert.equal(describePlace({ city: '%D0%9A%D0%B8%D1%97%D0%B2', country: 'UA' }), 'Київ, Україна');
  // The region arrives as a code — «32» is Kyiv oblast — and a number in the
  // middle of an address tells nobody anything. The city already said where.
  assert.equal(
    describePlace({ city: 'Sofiivska Borschahivka', region: '32', country: 'UA' }),
    'Sofiivska Borschahivka, Україна',
  );
  assert.equal(describePlace({ city: 'Kyiv', region: 'Kyiv', country: 'UA' }), 'Kyiv, Україна');
  // With no city, a region that is an actual name still answers «звідки».
  assert.equal(describePlace({ region: 'Kyiv City', country: 'UA' }), 'Kyiv City, Україна');
  // A code nothing recognises is repeated, never invented.
  assert.equal(describePlace({ country: 'QQ' }), 'QQ');
});

test('the device you are reading on comes first, then the most recent', () => {
  const stored = {
    old: { device: 'Firefox · Linux', lastSeenAt: 1_000 },
    mine: { device: 'Chrome · Windows', lastSeenAt: 500 },
    recent: { device: 'Safari · iOS', lastSeenAt: 9_000 },
  };
  const rows = listSessions(stored, { currentSessionId: 'mine' });
  assert.deepEqual(rows.map(row => row.id), ['mine', 'recent', 'old']);
  assert.equal(rows[0].isCurrent, true);
  assert.equal(rows[1].isCurrent, false);
});

test('a record with no stored label is still named from its user agent', () => {
  const rows = listSessions({ a: { userAgent: SAFARI_IOS, lastSeenAt: 1 } });
  assert.equal(rows[0].device, 'Safari · iOS');
  assert.equal(rows[0].place, null);
});

test('the document never grows past the cap, and the current device survives it', () => {
  const stored = {};
  for (let index = 0; index < MAX_REMEMBERED_SESSIONS + 5; index += 1) {
    stored[`s${index}`] = { device: 'Chrome · Windows', lastSeenAt: index };
  }
  // `s0` is the oldest of them all and would fall off on recency alone.
  assert.equal(listSessions(stored).length, MAX_REMEMBERED_SESSIONS);
  const dropped = expiredSessionIds(stored, { keepId: 's0' });
  assert.ok(!dropped.includes('s0'));
  assert.equal(dropped.length, 5);
});

test('a session id is opaque and device-local, and nothing else is one', () => {
  assert.equal(isSessionId('4f2a9c1e-2b7d-4a0f-9c11-8f3d5a6b7c8d'), true);
  assert.equal(isSessionId('short'), false);
  assert.equal(isSessionId('../../users/someone-else'), false);
  assert.equal(isSessionId(null), false);
});

test('sign-in methods are named the way the sign-in page names them', () => {
  const methods = describeSignInMethods([
    { providerId: 'google.com' },
    { providerId: 'password' },
    { providerId: 'google.com' },
  ]);
  assert.deepEqual(methods.map(method => method.label), ['Google', 'Пошта і пароль']);
  assert.deepEqual(describeSignInMethods(undefined), []);
});

// ── Форма пристрою, а не його назва ──────────────────────────────────────
//
// «Chrome · Windows» уже каже, що це за браузер. Людина, яка проглядає цей
// список, шукає рядок, який не є жодною з її машин — і телефон між двома
// ноутбуками видно раніше, ніж прочитано бодай слово.

const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15';

test('телефон, планшет і компʼютер розрізняються за user agent', () => {
  assert.equal(deviceKind(SAFARI_IOS), 'mobile');
  assert.equal(deviceKind(ANDROID_PHONE), 'mobile');
  assert.equal(deviceKind(CHROME_WINDOWS), 'desktop');
  assert.equal(deviceKind(MAC), 'desktop');
  assert.equal(deviceKind(IPAD), 'tablet');
  // Android-планшет — це Android без слова «Mobile», тобто відсутність слова, а
  // не власне слово. Тому перевірки на планшет мусять іти перед телефонними.
  assert.equal(deviceKind(ANDROID_TABLET), 'tablet');
});

test('нерозпізнаний user agent не вигадує собі форму', () => {
  assert.equal(deviceKind(''), 'unknown');
  assert.equal(deviceKind(null), 'unknown');
  assert.equal(deviceKind('щось геть інше'), 'unknown');
});

test('рядок списку несе форму пристрою, навіть якщо його записали раніше', () => {
  const rows = listSessions({
    // Записано до появи `kind`: поле читається з user agent щоразу, тому
    // історія не лишається без іконок.
    old: { userAgent: SAFARI_IOS, lastSeenAt: 2 },
    fresh: { userAgent: CHROME_WINDOWS, lastSeenAt: 1 },
  });
  assert.deepEqual(rows.map(row => row.kind), ['mobile', 'desktop']);
});

// ── Два чесні масштаби виходу ────────────────────────────────────────────
//
// Firebase відкликає акаунт, а не пристрій: API «завершити цей один сеанс» не
// існує. Побудувати його поверх теж не можна — робочий простір читає Firestore
// прямо з браузера, а правило безпеки не знає, для якого пристрою випущено
// токен. Кнопка в рядку зупиняла б запис і лишала читання, тобто робила б менше
// за власну назву.
test('маршрут завершує все, крім пристрою, що просить', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/api/account/sessions/route.js', import.meta.url), 'utf8');
  // Без коментарів: те, чому обидва виклики стоять саме в цьому порядку,
  // написано прозою над ними, і проза про виклик — не виклик.
  const route = source.split(/\r?\n/).filter(line => !/^\s*\/\//.test(line)).join('\n');

  // Маршрут мусить знати, кого лишити, і робить рівно одну річ.
  assert.match(route, /!isSessionId\(sessionId\)/);
  assert.doesNotMatch(route, /SCOPES/);
  // Ключ випускається до відкликання і обмінюється після — саме це лишає
  // поточний пристрій усередині: відкликається refresh-токен, а цього ще немає.
  const mint = route.indexOf('createCustomToken');
  const revoke = route.indexOf('revokeRefreshTokens');
  assert.ok(mint > 0 && revoke > 0 && mint < revoke, 'ключ випускається перед відкликанням');
  // Рядки завершених пристроїв прибираються, інакше список стверджував би, що
  // акаунт досі на них відкритий.
  assert.match(route, /id !== sessionId/);
});

test('панель пропонує одну дію і не пояснює, як вона влаштована', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/(app)/settings/page.js', import.meta.url), 'utf8');

  // Кнопки в рядку більше немає — вона робила вчетверо більше за свою назву і
  // казала про це лише у вже відкритому діалозі.
  assert.doesNotMatch(page, /accountSecurity\.endSession/);
  assert.doesNotMatch(page, /endAllSessions/);
  assert.match(page, /accountSecurity\.endOtherSessions\(\)/);
  assert.match(page, /Вийти з усіх, крім цього/);
  // Та сама червона кнопка виходу, що й «Вийти з акаунта» нижче на екрані —
  // одна дія, один вигляд. Без іконки: підпис уже каже, що вона робить.
  assert.match(page, /style="ghost"\s+color="red"\s+size="sm"\s+loading=/);
  // Підпис групи — той самий, що в «Загальних»: малий капс, без іконки. `Row`
  // кладе підпис ліворуч і контрол праворуч, тож назва секції в ньому читалась
  // як налаштування, яке нікому не змінити.
  assert.match(page, /<GroupLabel\s+label="Пристрої"/);
  assert.match(page, /<GroupLabel label="Способи входу" \/>/);
  // Один компонент, не три: «Загальні» малювали цей підпис власними утилітами.
  assert.match(page, /<GroupLabel label="Організація" \/>/);
  assert.match(page, /<GroupLabel\s+label="Брендинг"/);
  assert.doesNotMatch(page, /text-\[11px\] font-bold text-muted uppercase tracking-wider/);
  // Пояснення, як це влаштовано, пішло: людині, яка вийшла з чужого ноутбука,
  // назва платформи не допомагає ніяк. (Firebase лишається згаданим на цьому
  // екрані в іншому місці — там, де власник іде вмикати OAuth, і це для нього
  // адреса, а не подробиця.)
  assert.doesNotMatch(page, /Окремий пристрій завершити не можна/);
  assert.doesNotMatch(page, /поки не спливе їхній ключ доступу/);
  // Іконка за формою пристрою.
  assert.match(page, /DEVICE_ICONS = \{ mobile: Smartphone, tablet: Tablet, desktop: Monitor \}/);
});
