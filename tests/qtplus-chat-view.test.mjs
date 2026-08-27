import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toChatMessageView, formatMsgTime, dayLabel, unreadCount, unreadMessages,
} from '../src/lib/portal/qtplusChatView.mjs';

// Фікстури відтворюють РЕАЛЬНУ схему порталу (qt/src/lib/hooks/useChat.js:
// addDoc { senderId, role:'user', text, senderName, avatarUrl, createdAt, readBy }).
const ts = (ms) => ({ toMillis: () => ms }); // Firestore Timestamp-подібний

test('toChatMessageView: моє повідомлення позначене mine', () => {
  const v = toChatMessageView(
    { id: 'm1', senderId: 'u1', role: 'user', text: 'Привіт', senderName: 'Артур', avatarUrl: 'a.png', readBy: ['u1'], createdAt: ts(1000) },
    'u1',
  );
  assert.equal(v.mine, true);
  assert.equal(v.system, false);
  assert.equal(v.text, 'Привіт');
  assert.equal(v.senderName, 'Артур');
  assert.equal(v.avatarUrl, 'a.png');
  assert.equal(v.createdAtMs, 1000);
});

test('toChatMessageView: чуже повідомлення не mine', () => {
  const v = toChatMessageView({ id: 'm2', senderId: 'u2', role: 'user', text: 'Здоров', senderName: 'Оля' }, 'u1');
  assert.equal(v.mine, false);
  assert.equal(v.senderName, 'Оля');
});

test('toChatMessageView: системна дія з реальним автором зберігає сторону автора', () => {
  assert.equal(toChatMessageView({ role: 'system', text: 'Етап завершено', senderId: 'u1' }, 'u1').system, true);
  assert.equal(toChatMessageView({ role: 'system', text: 'x', senderId: 'u1' }, 'u1').mine, true);
  assert.equal(toChatMessageView({ role: 'ai', text: 'x', senderId: 'assistant' }, 'u1').mine, false);
});

test('toChatMessageView: без імені -> Я / Учасник', () => {
  assert.equal(toChatMessageView({ senderId: 'u1', text: 'x' }, 'u1').senderName, 'Я');
  assert.equal(toChatMessageView({ senderId: 'u2', text: 'x' }, 'u1').senderName, 'Учасник');
});

test('toChatMessageView: createdAt як {seconds} і як Date', () => {
  assert.equal(toChatMessageView({ text: 'x', createdAt: { seconds: 5 } }, 'u1').createdAtMs, 5000);
  const d = new Date(1710000000000);
  assert.equal(toChatMessageView({ text: 'x', createdAt: d }, 'u1').createdAtMs, 1710000000000);
});

test('toChatMessageView: сміттєвий ввід не кидає', () => {
  const v = toChatMessageView(null, 'u1');
  assert.equal(v.text, '');
  assert.equal(v.mine, false);
  assert.deepEqual(v.readBy, []);
  assert.equal(v.createdAtMs, null);
});

test('formatMsgTime', () => {
  const d = new Date(2026, 0, 1, 9, 5);
  assert.equal(formatMsgTime(d.getTime()), '09:05');
  assert.equal(formatMsgTime(null), '');
  assert.equal(formatMsgTime(NaN), '');
});

test('dayLabel: Сьогодні / Вчора / дата', () => {
  const now = new Date(2026, 6, 17, 12, 0).getTime();
  assert.equal(dayLabel(new Date(2026, 6, 17, 8, 0).getTime(), now), 'Сьогодні');
  assert.equal(dayLabel(new Date(2026, 6, 16, 23, 0).getTime(), now), 'Вчора');
  assert.equal(dayLabel(new Date(2026, 6, 10, 8, 0).getTime(), now), '10 липня');
  assert.equal(dayLabel(new Date(2025, 4, 1, 8, 0).getTime(), now), '1 травня 2025 р.');
  assert.equal(dayLabel(null, now), '');
});

test('unreadCount: чужі непрочитані рахуються, мої й системні — ні', () => {
  const msgs = [
    { senderId: 'u2', role: 'user', readBy: [] },            // unread
    { senderId: 'u2', role: 'user', readBy: ['u1'] },        // read
    { senderId: 'u1', role: 'user', readBy: [] },            // mine
    { senderId: 'u3', role: 'system', readBy: [] },          // system
    { senderId: 'u3', role: 'user', readBy: ['u2'] },        // unread (not me)
  ];
  assert.equal(unreadCount(msgs, 'u1'), 2);
  assert.equal(unreadCount([], 'u1'), 0);
  assert.equal(unreadCount(null, 'u1'), 0);
  assert.equal(unreadCount(msgs, null), 0);
});

test('unreadMessages: повертає самі непрочитані чужі доки', () => {
  const a = { id: 'a', senderId: 'u2', role: 'user', readBy: [] };
  const b = { id: 'b', senderId: 'u1', role: 'user', readBy: [] };
  const c = { id: 'c', senderId: 'u2', role: 'user', readBy: ['u1'] };
  const out = unreadMessages([a, b, c], 'u1');
  assert.deepEqual(out.map((m) => m.id), ['a']);
});
