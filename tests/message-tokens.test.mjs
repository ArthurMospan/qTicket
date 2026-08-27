import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeMessageLine } from '../src/lib/utils/messageTokens.mjs';

const memberNames = ['Arthur Mospan', 'Артур Моспан', 'John Doe', 'Анна'];
const parse = (line, options = {}) => tokenizeMessageLine(line, { memberNames, ...options });
const kinds = line => parse(line).map(token => token.type);

test('an at sign that names nobody stays text, wherever it stands', () => {
  assert.deepEqual(parse('@ у чаті завдання'), [{ type: 'text', value: '@ у чаті завдання' }]);
  assert.deepEqual(parse('@незнайомець, привіт'), [{ type: 'text', value: '@незнайомець, привіт' }]);
  assert.deepEqual(parse('пошта: a@b.com'), [{ type: 'text', value: 'пошта: a@b.com' }]);
});

test('a known name is a mention, and its boundary stays text', () => {
  assert.deepEqual(parse('@John Doe глянь'), [
    { type: 'mention', value: 'John Doe' },
    { type: 'text', value: ' глянь' },
  ]);
  assert.deepEqual(parse('питання до @Анна.'), [
    { type: 'text', value: 'питання до ' },
    { type: 'mention', value: 'Анна' },
    { type: 'text', value: '.' },
  ]);
});

test('a name glued to a longer word is not that name', () => {
  assert.deepEqual(parse('@Аннабель прийшла'), [{ type: 'text', value: '@Аннабель прийшла' }]);
});

test('the longest matching name wins', () => {
  assert.deepEqual(parse('@Arthur Mospan тут'), [
    { type: 'mention', value: 'Arthur Mospan' },
    { type: 'text', value: ' тут' },
  ]);
});

test('with no member list nothing at all is a person', () => {
  assert.deepEqual(
    tokenizeMessageLine('@Arthur Mospan тут', { memberNames: [] }),
    [{ type: 'text', value: '@Arthur Mospan тут' }],
  );
});

test('a task key is a task, a bare hash is not', () => {
  assert.deepEqual(parse('зробив у #QT-12 вчора'), [
    { type: 'text', value: 'зробив у ' },
    { type: 'issue', value: 'QT-12' },
    { type: 'text', value: ' вчора' },
  ]);
  assert.deepEqual(parse('# заголовок'), [{ type: 'text', value: '# заголовок' }]);
  assert.deepEqual(parse('колір #fff тут'), [
    { type: 'text', value: 'колір ' },
    { type: 'issue', value: 'fff' },
    { type: 'text', value: ' тут' },
  ]);
});

test('a link keeps its address and hands back the punctuation after it', () => {
  assert.deepEqual(parse('дивись https://example.com/a.'), [
    { type: 'text', value: 'дивись ' },
    { type: 'link', value: 'https://example.com/a' },
    { type: 'text', value: '.' },
  ]);
  assert.deepEqual(
    parse('https://uk.wikipedia.org/wiki/Ліс_(значення)').map(token => token.value),
    ['https://uk.wikipedia.org/wiki/Ліс_(значення)'],
  );
});

test('an at sign inside a link is not a mention', () => {
  assert.deepEqual(kinds('https://x.com/@Анна'), ['link']);
});

test('emphasis marks are read, and only when asked for', () => {
  assert.deepEqual(parse('**жирний** і `код`'), [
    { type: 'bold', value: 'жирний' },
    { type: 'text', value: ' і ' },
    { type: 'code', value: 'код' },
  ]);
  assert.deepEqual(
    tokenizeMessageLine('**жирний**', { memberNames, formatting: false }),
    [{ type: 'text', value: '**жирний**' }],
  );
});

test('plain text is one token, not one per gap', () => {
  assert.deepEqual(parse('просто речення без нічого'), [
    { type: 'text', value: 'просто речення без нічого' },
  ]);
  assert.equal(parse('').length, 0);
});

test('a message carries the task names its composer already knew', async () => {
  const { collectIssueMentions, issueMentionTitles } = await import('../src/lib/utils/messageTokens.mjs');
  const remembered = new Map([
    ['QT-12', { id: 'a', title: 'Форма створення договору' }],
    ['QT-99', { id: 'b', title: 'Видалено з тексту' }],
  ]);

  // Only what is still said. A mention the author typed and then deleted must
  // not travel with the message.
  assert.deepEqual(collectIssueMentions('готово у #QT-12', remembered), [
    { key: 'QT-12', id: 'a', title: 'Форма створення договору' },
  ]);
  assert.deepEqual(collectIssueMentions('нічого не згадано', remembered), []);
  assert.deepEqual(collectIssueMentions('#QT-12', {}), []);

  // Case is not a different task.
  assert.equal(collectIssueMentions('дивись #qt-12', remembered).length, 1);

  assert.deepEqual(
    issueMentionTitles([{ key: 'qt-12', title: 'Назва' }, { key: '', title: 'x' }, { title: 'y' }]),
    { 'QT-12': 'Назва' },
  );
});
