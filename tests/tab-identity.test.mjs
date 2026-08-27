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
// Скільки непрочитаного, каже заголовок вкладки, і тільки про чат.
test('обидва оголошені файли іконки несуть один малюнок', async () => {
  const { readFileSync } = await import('node:fs');
  const icoPath = new URL('../src/app/favicon.ico', import.meta.url);
  const pngPath = new URL('../public/favicon.png', import.meta.url);
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
    return [frame[source + 2], frame[source + 1], frame[source]];
  };
  // Плитка темна, а логотип на ній світлий. Якщо колись стане навпаки —
  // це і є той самий чорний логотип, через який іконка міняла колір.
  const [r, g, b] = centre(16, 16);
  assert.ok(r < 80 && g < 80 && b < 80, `плитка .ico має бути темною, а вона ${r},${g},${b}`);

  // PNG — той самий малюнок 32×32, а не окремий чорний логотип на прозорому.
  assert.equal(png.readUInt32BE(16), 32);
  assert.equal(png.readUInt32BE(20), 32);
  assert.equal(png[25], 6, 'RGBA');
});

// Лічильник у вкладці — це чат, і нічого більше.
test('вкладка рахує лише чат', async () => {
  const component = await read('../src/components/WorkspaceDocumentTitle.jsx');
  assert.match(component, /state\.unreadChatCount/);
  assert.doesNotMatch(component, /notifications/);
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
