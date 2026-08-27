import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  escapeTelegramHtml,
  formatTelegramNotification,
  telegramTypeIcon,
} from '../src/lib/utils/telegramMessage.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a single notification carries its type, its text and a button — not a raw URL', () => {
  const message = formatTelegramNotification([{
    type: 'deadline',
    title: 'QT-12: дедлайн прострочено',
    body: 'Виправити Telegram',
    url: 'https://qt.example/qt/issue/abc?org=1',
  }]);

  assert.equal(message.parseMode, 'HTML');
  assert.equal(message.text, '⏰ <b>QT-12: дедлайн прострочено</b>\nВиправити Telegram');
  assert.deepEqual(message.button, {
    text: 'Відкрити в QuickTeam',
    url: 'https://qt.example/qt/issue/abc?org=1',
  });
  // The link no longer sits in the body, where Telegram rendered it as a wall
  // of percent-encoded path under every message.
  assert.doesNotMatch(message.text, /https:/);
});

test('several notifications for one person become one digest, not one ping each', () => {
  const message = formatTelegramNotification([
    { type: 'calendar_reminder', title: 'Синк команди', body: 'До початку 15 хв', url: 'https://qt.example/calendar/event/e1' },
    { type: 'deadline', title: 'QT-12: дедлайн сьогодні', body: 'Виправити Telegram', url: 'https://qt.example/p/issue/i1' },
    { type: 'assigned', title: 'Вам призначено QT-14', body: 'Мобільна навігація', url: 'https://qt.example/p/issue/i2' },
  ]);

  assert.match(message.text, /^🔔 <b>QuickTeam · 3 сповіщення<\/b>/);
  // Each row keeps its own icon and its own destination.
  assert.match(message.text, /📅 <a href="https:\/\/qt\.example\/calendar\/event\/e1"><b>Синк команди<\/b><\/a>\nДо початку 15 хв/);
  assert.match(message.text, /⏰ <a href=/);
  assert.match(message.text, /🎯 <a href=/);
  assert.equal(message.button, null);
});

test('markup that Telegram would reject cannot cost the notification', () => {
  const message = formatTelegramNotification([{
    type: 'commented',
    title: '<b>не</b> розмітка & не тег',
    body: 'a > b',
    url: 'javascript:alert(1)',
  }]);

  assert.equal(
    message.text,
    '💬 <b>&lt;b&gt;не&lt;/b&gt; розмітка &amp; не тег</b>\na &gt; b',
  );
  // A non-http scheme is not a link.
  assert.equal(message.button, null);
  // And a plain-text form always exists for the retry after a 400.
  assert.match(message.fallbackText, /<b>не<\/b> розмітка & не тег/);
});

test('an empty batch produces no message at all', () => {
  assert.equal(formatTelegramNotification([]), null);
  assert.equal(formatTelegramNotification([{ body: 'без назви' }]), null);
});

test('every notification type the product produces has an icon', async () => {
  // The allow-list used to be a literal in the route and this test read it back
  // out of the source. It is a shared registry now, and the registry is wider
  // than the allow-list: `birthday` is written by the greeting sweep through the
  // Admin SDK, so it never passes through the route and still reaches Telegram.
  const { NOTIFICATION_TYPES } = await import('../src/lib/utils/notificationChannels.mjs');

  assert.ok(NOTIFICATION_TYPES.length >= 10);
  for (const type of NOTIFICATION_TYPES) {
    assert.notEqual(telegramTypeIcon(type), '🔔', `${type} falls through to the generic bell`);
  }
});

test('escaping covers exactly what HTML parse mode needs', () => {
  assert.equal(escapeTelegramHtml('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d "e"');
  assert.equal(escapeTelegramHtml(null), '');
});

test('the sender asks for HTML, disables previews and falls back to plain text', async () => {
  const source = await read('../src/lib/server/telegram.js');
  assert.match(source, /parse_mode: message\.parseMode/);
  assert.match(source, /link_preview_options: \{ is_disabled: true \}/);
  // The deprecated flag is gone.
  assert.doesNotMatch(source, /disable_web_page_preview/);
  // A rejected message is retried as text rather than lost.
  assert.match(source, /retrying as text/);
  assert.match(source, /return sendTelegramMessage\(chatId, message\.fallbackText/);
});
