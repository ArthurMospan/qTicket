import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// «Немає доступу до цих даних», яке виправляли чотири рази й щоразу не там.
//
// Кожен читок у qTicket стоїть за `organizationEntitlementActive(orgId)` —
// організація, проєкти, налаштування процесу, стан прочитаного. Тобто підписка
// на організацію, про яку ще не відомо, чи вона робочий простір цього акаунта,
// не «може не пощастити»: вона гарантовано отримує `permission-denied`.
//
// А непідтверджена організація буває обраною навмисно. `buildOrganizationList`
// лишає запис `pending`, коли документа не видно, — інакше короткий читок із
// кешу видаляв би живий простір із перемикача. Вікно між кешовим і
// підтвердженим довідником існує за задумом; помилка була в тому, що в цьому
// вікні відкривались слухачі.
//
// `WorkspaceOrganizationRouteGuard` уже тримає екрани саме тут. Але підписки
// живуть вище за нього — у `AppContext` і у двох мостах, змонтованих сусідами
// гварда, — тож гвард закривав вікно для очей і лишав відчиненим для мережі.
//
// Попередні виправлення вчили екрани мовчати (`isUnresolvedAccessError`). Це
// лікувало реакцію: відмови генерувалися далі, і кожен новий слухач мусив
// вивчити той самий трюк, інакше картка поверталась. Цей тест тримає шлюз, а
// не мовчання.
test('нічого не підписується на непідтверджену організацію', async () => {
  const context = await read('../src/lib/context/AppContext.js');

  // Шлюз існує і рахується з одного місця.
  assert.match(
    context,
    /const subscribableOrgId = orgDirectoryVerified \? activeOrgId : ''/,
    'AppContext має публікувати organization id, підтверджений довідником',
  );
  assert.match(context, /subscribableOrgId,/, '`subscribableOrgId` має бути в значенні контексту');

  // Підписка на проєкти бере саме його.
  assert.match(
    context,
    /useProjects\(userId, subscribableOrgId, orgRole\)/,
    'useProjects має отримувати підтверджений id, інакше кожен холодний вхід — це permission-denied',
  );

  // Обидва мости стоять вище за гвард маршруту, тож вони мусять брати шлюз самі.
  for (const file of ['../src/components/IssueReadStateBridge.jsx', '../src/components/WorkspaceNotificationBridge.jsx']) {
    const source = await read(file);
    assert.match(
      source,
      /subscribableOrgId: activeOrgId/,
      `${file} змонтований поза гвардом, тож має брати підтверджений id`,
    );
  }
});

// Мости справді сусіди гварда, а не його діти. Якщо колись їх перенесуть
// усередину — шлюз вище стане зайвим, але не шкідливим; якщо ж хтось додасть
// третій міст поруч, цей тест назве його поіменно.
test('усе, що стоїть поза гвардом маршруту, названо', async () => {
  const layout = await read('../src/app/(app)/layout.js');
  const guardAt = layout.indexOf('<WorkspaceOrganizationRouteGuard>');
  assert.ok(guardAt > 0, 'layout має рендерити гвард маршруту');

  const above = layout.slice(0, guardAt);
  const bridgesAbove = [...above.matchAll(/<(\w*Bridge)\s*\/>/g)].map(match => match[1]);
  assert.deepEqual(
    [...new Set(bridgesAbove)].sort(),
    ['IssueReadStateBridge', 'WorkspaceNotificationBridge'],
    'Компонент, що підписується на Firestore поза гвардом, має брати `subscribableOrgId` — '
    + 'додайте його до цього списку разом зі шлюзом',
  );
});

// І сама причина, через яку підписка на непідтверджену організацію не може
// вціліти: у правилах немає жодного читка робочого простору без entitlement.
test('кожен читок робочого простору стоїть за entitlement', async () => {
  const rules = await read('../firestore.rules');
  assert.match(rules, /function organizationEntitlementActive\(orgId\)/);
  assert.match(
    rules,
    /function isOrgMember\(orgId\)\s*\{\s*return signedIn\(\) && organizationEntitlementActive\(orgId\)/,
    'isOrgMember має вимагати активний entitlement — на цьому тримається весь шлюз вище',
  );
});

// Довідка не має описувати екран, якого продукт не показує.
test('копія відмови лишається однією на всі екрани', async () => {
  const helpers = await read('../src/lib/utils/organizationLoadErrors.mjs');
  assert.match(helpers, /Немає доступу до цих даних/);
  // Захист у глибину: шлюз прибирає причину, ця перевірка лишається на випадок
  // справжньої відмови — коли доступ таки забрали.
  assert.match(helpers, /export function isUnresolvedAccessError/);
  const screens = await readdir(new URL('../src/app/(app)', import.meta.url), { withFileTypes: true });
  assert.ok(screens.length > 0);
});

// Друга половина тієї самої причини: entitlement, знятий поки вкладка відкрита.
//
// `organizationEntitlementActive` можна не пройти двома способами. Перший —
// організація ще не підтверджена; його тримає шлюз вище. Другий — entitlement
// справді `inactive`: у QuickTeam вимкнули доповнення, поки людина сиділа в
// qTicket. Довідник у цей момент уже підтверджений, тож шлюз пропускає, і все
// правильно: простір БУВ робочим, коли його перевіряли.
//
// Помітити зміну може лише той слухач, що дивиться на документ організації —
// той самий, чий entitlement усе вирішує. Він обидва рази ковтав відмову під
// коментарем «expected during logout», і це правда рівно під час виходу.
// Entitlement лежить на організації, а не на членстві, тож жодна підписка на
// членства не змінюється й ніщо не перезапитує довідник: організація лишалась
// обраною, і людина читала «Сесія могла завершитися» про цілу сесію.
test('відмова активної організації перепитує довідник, а не пишеться в консоль', async () => {
  const context = await read('../src/lib/context/OrgContext.js');

  // Один обробник, і його викликають обидва слухачі активної організації.
  assert.match(context, /const handleActiveOrganizationRefusal = \(scope, err\) =>/);
  assert.equal(
    (context.match(/handleActiveOrganizationRefusal\(/g) || []).length,
    2,
    'обробник має викликатись обома слухачами — організації та членства',
  );

  // Старе мовчання не повертається.
  assert.doesNotMatch(
    context,
    /console\.warn\('\[OrgContext\] (org|membership) sync permission error/,
    'відмова активної організації більше не є рядком у консолі й нічим більше',
  );

  // Відмова в правах веде до авторитетної перевірки, а не до здогадки.
  assert.match(context, /organizationLoadErrorKind\(err\) !== 'permission-denied'/);
  assert.match(context, /revalidateDirectoryRef\.current\?\.\(\)/);
  assert.match(
    context,
    /REFUSAL_REVALIDATION_WINDOW_MS/,
    'пачка одночасних відмов має перепитувати довідник один раз',
  );
});
