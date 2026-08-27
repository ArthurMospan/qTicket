// «Дзвінок → задачі» слухає тільки записи свого робочого простору.
//
// Перевірка хоста зупиняє запит за межами Cloudinary — заради цього її й
// писали. Але хмара в усіх організацій одна, тож URL із чужої теки вона
// пропускала: учасник A з посиланням B отримував саммарі чужої наради.
// `/api/upload/sign` відмовляється підписувати чужу теку рівно з цієї причини;
// тут те саме правило шляху працює на вхід.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { organizationIdFromPath } from '../src/lib/utils/uploadPaths.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// Те, що робить маршрут, відтворене тут із того самого запису URL, який пише
// AudioTaskPanel. Якби це жило лише в маршруті, перевірити його без мережі
// було б нічим.
function storagePathOf(url, cloud) {
  const prefix = `https://res.cloudinary.com/${cloud}/`;
  if (!url.startsWith(prefix)) return '';
  const rest = url.slice(prefix.length).split(/[?#]/, 1)[0];
  const match = /^[a-z]+\/[a-z]+\/(?:v\d+\/)?(.+)$/.exec(rest);
  return match ? match[1].replace(/\.[A-Za-z0-9]+$/, '') : '';
}

const url = (path, cloud = 'demo') =>
  `https://res.cloudinary.com/${cloud}/video/upload/v1712345678/${path}.m4a`;

test('запис читається лише з теки тієї організації, під якою авторизувались', () => {
  const mine = url('quickteam/organizations/org-a/ai-calls/abc123');
  const theirs = url('quickteam/organizations/org-b/ai-calls/abc123');

  assert.equal(organizationIdFromPath(storagePathOf(mine, 'demo')), 'org-a');
  assert.equal(organizationIdFromPath(storagePathOf(theirs, 'demo')), 'org-b');
  // Тобто рівність із organizationId запиту пропускає перший і відхиляє другий.
  assert.notEqual(
    organizationIdFromPath(storagePathOf(theirs, 'demo')),
    'org-a',
  );
});

test('чужа хмара, коренева тека і сміття не дають організації', () => {
  for (const candidate of [
    url('quickteam/organizations/org-a/ai-calls/abc', 'someone-else'),
    url('quickteam/avatars/abc'),
    'https://evil.example.com/quickteam/organizations/org-a/ai-calls/abc.m4a',
    'not a url',
  ]) {
    assert.equal(organizationIdFromPath(storagePathOf(candidate, 'demo')), '');
  }
});

test('URL, який пише панель, читається саме тим записом, який чекає маршрут', async () => {
  const panel = await read('src/components/AudioTaskPanel.jsx');
  // Тека складається тут; якщо вона зміниться, перевірка на вході має змінитись
  // разом із нею, а не мовчки почати відхиляти всі завантаження.
  assert.match(panel, /`quickteam\/organizations\/\$\{activeOrgId\}\/ai-calls`/);
});

test('маршрут звіряє теку з організацією запиту, а не лише хост', async () => {
  const route = await read('src/app/api/ai/call-to-tasks/route.js');
  assert.match(route, /organizationIdFromPath\(path\) === organizationId/);
  assert.match(route, /audioUrlAllowed\(audioUrl, organizationId\)/);
});

test('розмір питається із заголовка до того, як файл потрапить у памʼять', async () => {
  const route = await read('src/app/api/ai/call-to-tasks/route.js');
  const headerCheck = route.indexOf("response.headers.get('content-length')");
  const bodyRead = route.indexOf('await response.arrayBuffer()');
  assert.ok(headerCheck > 0 && bodyRead > 0);
  assert.ok(headerCheck < bodyRead, 'заголовок читається першим');
});

test('дата для дедлайнів береться в часовому поясі організації, не в UTC', async () => {
  const route = await read('src/app/api/ai/call-to-tasks/route.js');
  assert.match(route, /dayKeyInTimeZone\(new Date\(\), timeZone\)/);
  assert.doesNotMatch(route, /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});
