import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitTelegramTask,
  telegramCommandPayload,
  telegramTaskContent,
} from '../src/lib/utils/telegramTask.mjs';

test('parses Telegram commands with bot suffixes', () => {
  assert.equal(telegramCommandPayload('/quickteam_connect@QuickTeamBot qtg_abc', 'quickteam_connect'), 'qtg_abc');
  assert.equal(telegramCommandPayload('not a command', 'start'), null);
});

test('accepts /task and direct bot mentions', () => {
  assert.equal(telegramTaskContent('/task Зробити реліз | до п’ятниці', 'QuickTeamBot'), 'Зробити реліз | до п’ятниці');
  assert.equal(telegramTaskContent('@QuickTeamBot, задача: Перевірити оплату', 'QuickTeamBot'), 'Перевірити оплату');
  assert.equal(telegramTaskContent('звичайне повідомлення', 'QuickTeamBot'), '');
});

test('splits title and description without losing multiline context', () => {
  assert.deepEqual(splitTelegramTask('Назва | Детальний опис'), { title: 'Назва', description: 'Детальний опис' });
  assert.deepEqual(splitTelegramTask('Назва\nРядок 1\nРядок 2'), { title: 'Назва', description: 'Рядок 1\nРядок 2' });
});
