import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';


const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// Одна іконка вкладки, і вона завжди та сама.
//
// Тут малювався червоний бейдж із сумою непрочитаного: компонент читав
// `/favicon.png` у canvas, штампував кружечок і віддавав браузеру data-URL. Дві
// причини, чому його більше немає. Перша: на шістнадцяти пікселях цифру не
// видно — сигнал, який не читається, це не сигнал. Друга серйозніша: два
// оголошені файли іконки несли різні малюнки — `.ico` білий логотип на темній
// плитці, `.png` чорний логотип на прозорому, — і перемалювання підміняло
// перший другим. Логотип у вкладці міняв колір залежно від того, чи є
// непрочитане. Тепер обидва файли — один малюнок, і нікому його підміняти.
//
// Малюнок відтоді змінився — це знак qTicket, темний на прозорому, — а
// інваріант ні: `.ico` збирається з того самого `favicon_qticket.png`, який
// оголошено як PNG-іконку, тож розійтися вони не можуть.
//
// Скільки непрочитаного, каже заголовок вкладки, і тільки про чат.
test('обидва оголошені файли іконки несуть один малюнок', async () => {
  const { readFileSync } = await import('node:fs');
  const icoPath = new URL('../src/app/favicon.ico', import.meta.url);
  const pngPath = new URL('../public/favicon_qticket.png', import.meta.url);
  const ico = readFileSync(icoPath);
  const png = readFileSync(pngPath);

  // 32×32 кадр з .ico, у RGBA.
  const entries = ico.readUInt16LE(4);
  let frame = null;
  for (let index = 0; index < entries; index += 1) {
    const offset = 6 + index * 16;
    if ((ico[offset] || 256) !== 32) continue;
    const start = ico.readUInt32LE(offset + 12);
    frame = ico.subarray(start, start + ico.readUInt32LE(offset + 8));
  }
  assert.ok(frame, '.ico має кадр 32×32');

  const pixelOffset = frame.readUInt32LE(0);
  const centre = (y, x) => {
    const source = pixelOffset + (31 - y) * 32 * 4 + x * 4;
    return [frame[source + 2], frame[source + 1], frame[source], frame[source + 3]];
  };
  // Знак темний і непрозорий у центрі — між очима, — і прозорий у кутку.
  // Перевіряється саме пара: один лише «темний центр» пройшов би й для
  // суцільного чорного квадрата, а один лише «прозорий кут» — для порожнього
  // файлу.
  const [r, g, b, a] = centre(16, 16);
  assert.ok(r < 80 && g < 80 && b < 80, `знак у .ico має бути темним, а він ${r},${g},${b}`);
  assert.equal(a, 255, 'знак у .ico має бути непрозорим');
  assert.equal(centre(1, 1)[3], 0, 'кут .ico має лишатися прозорим');
  // І око світле: якщо знак колись інвертують, це побачить саме ця пара.
  assert.ok(centre(16, 11)[0] > 200, 'око знака має лишатися світлим');

  // PNG — той самий малюнок 32×32 з альфою.
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
  assert.equal(png[25], 6, 'RGBA');
});

// Лічильник у вкладці — це одне число з одного джерела.
//
// Раніше його рахували курсори прочитаного корпоративного месенджера. Месенджер
// видалено; лишився дзвоник, і його число по активній організації вже лежить у
// сторі — публікує його `WorkspaceNotificationBridge`, а не друга підписка тут.
test('вкладка рахує непрочитане активної організації, і нічого не підписує', async () => {
  const component = await read('../src/components/WorkspaceDocumentTitle.jsx');
  assert.match(component, /state\.notificationUnreadByOrg\[activeOrgId\] \|\| 0/);
  assert.doesNotMatch(component, /unreadChatCount/);
  assert.doesNotMatch(component, /onSnapshot|useNotifications\(/);
});

// І перемальовувати іконку більше нікому.
test('іконку вкладки ніхто не перемальовує', async () => {
  const layout = await read('../src/app/(app)/layout.js');
  assert.doesNotMatch(layout, /FaviconBadge/);
});

test('a pasted link unfurls as something', async () => {
  const card = await read('../src/app/opengraph-image.js');
  assert.match(card, /export const size = \{ width: 1200, height: 630 \}/);
  assert.match(card, /export const contentType = 'image\/png'/);
  // The tagline is Ukrainian and the bundled fallback font has no Cyrillic.
  assert.match(card, /fonts: fonts\.length \? fonts : undefined/);

  const twitter = await read('../src/app/twitter-image.js');
  assert.match(twitter, /from '\.\/opengraph-image'/);

  const layout = await read('../src/app/layout.js');
  assert.match(layout, /metadataBase: new URL\(SITE_URL\)/);
  assert.match(layout, /card: 'summary_large_image'/);
});

// The one screen most likely to be a customer's first impression, and it was
// signed by somebody else's product.
//
// qTicket was forked from QuickTeam, and the card the workspace shows when it
// cannot open came across with the parent's name hardcoded into it: «QuickTeam
// тимчасово недоступний», on qticket-qt.vercel.app, to a client of a support
// desk who has never heard of QuickTeam and has no account in it. Staff arrive
// through QuickTeam and its name belongs on the screens about that handoff;
// an outage is not one of them.
test('a workspace that will not open is signed by this product', async () => {
  const layout = await read('../src/app/(app)/layout.js');

  assert.match(layout, /import \{ PRODUCT_NAME \} from '@\/lib\/content\/product\.mjs';/);
  assert.match(layout, /\$\{PRODUCT_NAME\} тимчасово недоступний/);
  assert.match(layout, /Не вдалося відкрити \$\{PRODUCT_NAME\}/);
  assert.doesNotMatch(layout, /'QuickTeam тимчасово недоступний'/);

  // And it no longer blames a read that never happened. The stall timer renders
  // this card with no error at all — the boot did not finish — which is a
  // different sentence from an organization that answered «no».
  assert.match(layout, /const stalled = !error;/);
  assert.match(layout, /Завантаження не завершилося\./);
});
