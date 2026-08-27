// Видаляючи акаунт, людина йде — а не переписує історію роботи.
//
// AGENTS.md формулює це як інваріант: «never edit assigneeIds, watcherIds,
// comments or time logs to "clean up" after a person. That is the record of
// what happened, and rewriting it is how a workspace loses its own history.»
// Шлях адміністратора («Забрати доступ») дотримувався його з самого початку —
// він читає ці два списки, щоб показати наслідки, і ніколи їх не пише.
// DELETE /api/account робив протилежне: вирізав uid з `assigneeIds` і
// `watcherIds` кожної задачі кожної організації і видаляв членство замість
// того, щоб його заархівувати.
//
// Видно це було на екрані. Довідник учасників навмисно повертає деактивованих
// людей з архіву, щоб задача й списана година показували імʼя. Самовидалений
// акаунт не лишав ні активного членства, ні архівного, тож TimeLogRow падав у
// «Невідомий» — на табелі, з якого будується рахунок.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Тільки тіло DELETE. GET у цьому ж файлі читає задачі навмисно — щоб
// підтвердження назвало, що саме лишиться позаду, точно як робить сторона
// адміністратора. Читання — не переписування, і правило про друге.
const deleteHandler = source => source.slice(source.indexOf('export async function DELETE'));

test('видалення акаунта не переписує списки виконавців і спостерігачів', async () => {
  const route = deleteHandler(await read('src/app/api/account/route.js'));

  // Раніше тут стояли два arrayRemove по issues. Жодного запису в задачі
  // лишитись не має — саме це відрізняє «пішов» від «роботи не було».
  assert.doesNotMatch(route, /assigneeIds: FieldValue\.arrayRemove/);
  assert.doesNotMatch(route, /watcherIds: FieldValue\.arrayRemove/);
  assert.doesNotMatch(route, /collection\('issues'\)/);

  // Доступ при цьому закривається повністю: і членство, і склад проєктів.
  assert.match(route, /team: FieldValue\.arrayRemove\(uid\)/);
  assert.match(route, /transaction\.delete\(membership\.ref\)/);
});

test('місце людини архівується так само, як при знятті доступу адміністратором', async () => {
  const route = await read('src/app/api/account/route.js');
  const admin = await read('src/app/api/organizations/[organizationId]/members/[memberId]/route.js');

  // Обидва шляхи пишуть в один архів, однією формою — інакше довідник мусив би
  // знати, який із них закрив місце.
  for (const source of [route, admin]) {
    assert.match(source, /MEMBERSHIP_ARCHIVE/);
    for (const field of ['orgId', 'userId', 'role', 'positionId', 'joinedAt', 'projectIds']) {
      assert.match(source, new RegExp(String.raw`\b${field}\b`), field);
    }
  }
  // І один факт, який їх розрізняє.
  assert.match(route, /accountDeleted: true/);
  assert.match(route, /reason: 'account-deleted'/);
});

test('профіль стирається повністю — лишається форма запису, не персональні дані', async () => {
  const route = await read('src/app/api/account/route.js');
  assert.match(route, /recursiveDelete\(userRef\.collection\(name\)\)/);
  assert.match(route, /userRef\.delete\(\)/);
  assert.match(route, /collection\('memberRates'\)\.doc\(uid\)\.delete/);
});

test('довідник називає видалений акаунт, а не лишає його безіменним', async () => {
  const members = await read('src/app/api/organizations/[organizationId]/members/route.js');
  assert.match(members, /accountDeleted/);
  assert.match(members, /safeProfile\.name = 'Видалений акаунт'/);
});

test('архівоване місце видаленого акаунта не можна відновити', async () => {
  const membership = await read('src/lib/server/orgMembership.js');
  assert.match(membership, /archived\.accountDeleted === true/);
  assert.match(membership, /reason: 'ACCOUNT_DELETED'/);
});

test('власник може піти з робочого простору, у якому більше нікого немає', async () => {
  const route = await read('src/app/api/account/route.js');

  // Дві розумні заборони — «власник не видаляє акаунт» і «організація не
  // видаляється» — разом давали стан, з якого немає виходу взагалі. Причина
  // першої з них це інші люди; для простору з однієї людини причини немає.
  assert.match(route, /blockedOwnerIds/);
  assert.match(route, /soleOwnerIds/);
  assert.match(route, /someoneElseIsHere/);
  assert.match(route, /code: 'OWNS_ORGANIZATION'/);

  // Організація позначається, а не видаляється: каскад — окрема робота
  // (docs/ROADMAP.md), і починати її як побічний ефект чийогось виходу не можна.
  assert.match(route, /ownerlessAt: FieldValue\.serverTimestamp\(\)/);
  assert.doesNotMatch(route, /organizations'\)\.doc\([^)]*\)\.delete\(\)/);
});

test('мертвий виклик після видалення користувача прибрано', async () => {
  const route = await read('src/app/api/account/route.js');
  // deleteUser вже завершує всі сесії, тож revokeRefreshTokens кидав
  // user-not-found у порожній catch на кожному запуску. Згадка в коментарі
  // лишається — зникнути мав виклик.
  assert.doesNotMatch(route, /await auth\.revokeRefreshTokens/);
  assert.match(route, /await auth\.deleteUser\(uid\)/);
});
