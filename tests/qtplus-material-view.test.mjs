import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMaterialUrl, extOf, kindOf, kindLabelOf, toMaterialView,
} from '../src/lib/portal/qtplusMaterialView.mjs';

// Фікстури відтворюють РЕАЛЬНУ схему порталу.
// Джерело: qt/src/components/MaterialsGrid.jsx (resolve: previewUrl||audioUrl||url,
// audioSource: audioUrl||previewUrl||url) та qt/src/lib/hooks/useMaterials.js.
// Не вигадувати поля — Фаза 4a впала саме на вигаданому `url` для файлів.

test('resolveMaterialUrl: файл читає previewUrl (регресія кореневого дефекту 4a)', () => {
  const m = { type: 'file', title: 'brief.pdf', previewUrl: 'https://res.cloudinary.com/x/brief.pdf' };
  assert.equal(resolveMaterialUrl(m), 'https://res.cloudinary.com/x/brief.pdf');
});

test('resolveMaterialUrl: аудіо віддає перевагу audioUrl', () => {
  const m = { type: 'audio', title: 'memo.mp3', audioUrl: 'https://res.cloudinary.com/x/memo.mp3', previewUrl: 'https://res.cloudinary.com/x/other.mp3' };
  assert.equal(resolveMaterialUrl(m), 'https://res.cloudinary.com/x/memo.mp3');
});

test('resolveMaterialUrl: аудіо без audioUrl падає на previewUrl', () => {
  const m = { type: 'audio', title: 'memo.mp3', previewUrl: 'https://res.cloudinary.com/x/memo.mp3' };
  assert.equal(resolveMaterialUrl(m), 'https://res.cloudinary.com/x/memo.mp3');
});

test('resolveMaterialUrl: лінк читає url', () => {
  assert.equal(resolveMaterialUrl({ type: 'link', url: 'https://figma.com/file/1' }), 'https://figma.com/file/1');
});

test('resolveMaterialUrl: нічого немає -> null', () => {
  assert.equal(resolveMaterialUrl({ type: 'note', content: 'текст' }), null);
});

test('resolveMaterialUrl: відкидає javascript: та небезпечні data:', () => {
  assert.equal(resolveMaterialUrl({ type: 'link', url: 'javascript:alert(1)' }), null);
  assert.equal(resolveMaterialUrl({ type: 'link', url: 'data:text/html,<script>' }), null);
  assert.equal(resolveMaterialUrl({ type: 'link', url: 'data:text/html;base64,PHNjcmlwdD4=' }), null);
  // SVG у data: виконує скрипт, якщо його відкрити документом — не пропускаємо.
  assert.equal(resolveMaterialUrl({ type: 'sketch', previewUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }), null);
});

test('resolveMaterialUrl: скетч приходить растровим data: URL і мусить пройти', () => {
  // Портальний скетч зберігається як canvas.toDataURL('image/png') прямо в
  // документі матеріалу (qt FunctionalModals.jsx). Суцільна заборона data:
  // означала, що намальоване від руки не показувалось узагалі.
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  assert.equal(resolveMaterialUrl({ type: 'sketch', title: 'sketch-1.png', previewUrl: png, url: png }), png);
  assert.equal(kindOf({ type: 'sketch', title: 'sketch-1.png', previewUrl: png }), 'image');
  const v = toMaterialView({ id: 's1', type: 'sketch', title: 'sketch-1.png', desc: 'Намальовано від руки', previewUrl: png, url: png, fileType: 'image/png' });
  assert.equal(v.kind, 'image');
  assert.equal(v.url, png);
  assert.equal(v.meta, 'Зображення · Намальовано від руки');
});

test('resolveMaterialUrl: не падає на сміттєвому вводі', () => {
  assert.equal(resolveMaterialUrl(null), null);
  assert.equal(resolveMaterialUrl(undefined), null);
  assert.equal(resolveMaterialUrl({ type: 'link', url: 42 }), null);
});

test('extOf', () => {
  assert.equal(extOf('logo-v2.PNG'), 'png');
  assert.equal(extOf('archive.tar.gz'), 'gz');
  assert.equal(extOf('README'), '');
  assert.equal(extOf(null), '');
});

test('kindOf: родина файлу — зі спільного словника вкладень', () => {
  // Портал зберігає відео як type:'file' — родина визначається розширенням.
  // Словник той самий, що й у вкладеннях задачі: doc/sheet/slides окремо,
  // архів окремо, код окремо від простого тексту.
  assert.equal(kindOf({ type: 'file', title: 'promo.mp4' }), 'video');
  assert.equal(kindOf({ type: 'file', title: 'brief.pdf' }), 'pdf');
  assert.equal(kindOf({ type: 'file', title: 'photo.heic' }), 'image');
  assert.equal(kindOf({ type: 'file', title: 'kostorys.docx' }), 'doc');
  assert.equal(kindOf({ type: 'file', title: 'kostorys.xlsx' }), 'sheet');
  assert.equal(kindOf({ type: 'file', title: 'pitch.pptx' }), 'slides');
  assert.equal(kindOf({ type: 'file', title: 'index.tsx' }), 'code');
  assert.equal(kindOf({ type: 'file', title: 'notes.txt' }), 'text');
  assert.equal(kindOf({ type: 'file', title: 'archive.zip' }), 'archive');
  assert.equal(kindOf({ type: 'file', title: 'README' }), 'file');
});

test('kindOf: MIME файлу з порталу (fileType) перемагає назву без розширення', () => {
  assert.equal(kindOf({ type: 'file', title: 'kostorys', fileType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'sheet');
  assert.equal(kindOf({ type: 'file', title: 'scan', fileType: 'application/pdf' }), 'pdf');
});

test('kindOf: аудіо за type або за розширенням', () => {
  assert.equal(kindOf({ type: 'audio', title: 'memo.ogg' }), 'audio');
  assert.equal(kindOf({ type: 'file', title: 'memo.mp3' }), 'audio');
});

test('kindOf: аудіозапис із type:audio перемагає webm/mp4-розширення (регресія: показувало «відео»)', () => {
  // Портальний диктофон (qt FunctionalModals.jsx:1515-1533) кодує запис через
  // MediaRecorder у audio/webm або audio/mp4 і зберігає title='audio-recording-MM-SS.webm'
  // з type:'audio' + audioUrl. webm/mp4 також у списку ВІДЕО, тож розширення хибно
  // перемагало явний type -> картка казала «відео» на аудіозаписі.
  assert.equal(kindOf({ type: 'audio', title: 'audio-recording-01-30.webm', audioUrl: 'https://res.cloudinary.com/x/a.webm' }), 'audio');
  assert.equal(kindOf({ type: 'audio', title: 'audio-recording-00-42.mp4', audioUrl: 'https://res.cloudinary.com/x/a.mp4' }), 'audio');
  // Сигнал audioUrl теж достатній сам по собі (файли-відео мають previewUrl, не audioUrl).
  assert.equal(kindOf({ type: 'file', title: 'clip.webm', audioUrl: 'https://res.cloudinary.com/x/a.webm' }), 'audio');
  // РЕГРЕС-ЗАХИСТ: справжнє відео (type:'file' + previewUrl, без audioUrl) лишається відео.
  assert.equal(kindOf({ type: 'file', title: 'promo.webm', previewUrl: 'https://res.cloudinary.com/x/v.webm' }), 'video');
  assert.equal(kindOf({ type: 'file', title: 'promo.mp4', previewUrl: 'https://res.cloudinary.com/x/v.mp4' }), 'video');
});

test('kindOf: нефайлові типи проходять як є', () => {
  assert.equal(kindOf({ type: 'link', title: 'Figma' }), 'link');
  assert.equal(kindOf({ type: 'checklist', title: 'Здача' }), 'checklist');
  assert.equal(kindOf({ type: 'poll', title: 'Колір' }), 'poll');
  assert.equal(kindOf({ type: 'note', title: 'Ідея' }), 'note');
});

test('kindLabelOf: підпис родини — той самий, що бачить вкладення задачі', () => {
  assert.equal(kindLabelOf({ type: 'file', title: 'brief.pdf' }), 'PDF');
  assert.equal(kindLabelOf({ type: 'file', title: 'kostorys.docx' }), 'Документ');
  assert.equal(kindLabelOf({ type: 'file', title: 'kostorys.xlsx' }), 'Таблиця');
  assert.equal(kindLabelOf({ type: 'file', title: 'logo.png' }), 'Зображення');
  assert.equal(kindLabelOf({ type: 'file', title: 'promo.mp4' }), 'Відео');
  assert.equal(kindLabelOf({ type: 'file', title: 'README' }), 'Файл');
});

test('toMaterialView: файл', () => {
  const v = toMaterialView({
    id: 'm1', type: 'file', title: 'brief.pdf', desc: 'Бриф клієнта',
    previewUrl: 'https://res.cloudinary.com/x/brief.pdf',
  });
  assert.equal(v.id, 'm1');
  assert.equal(v.kind, 'pdf');
  assert.equal(v.title, 'brief.pdf');
  assert.equal(v.subtitle, 'Бриф клієнта');
  assert.equal(v.url, 'https://res.cloudinary.com/x/brief.pdf');
  assert.equal(v.meta, 'PDF · Бриф клієнта');
  // Форма для FileThumb/AttachmentViewer — щоб картка й вьюер читали файл однаково.
  assert.equal(v.attachment.name, 'brief.pdf');
  assert.equal(v.attachment.previewUrl, 'https://res.cloudinary.com/x/brief.pdf');
});

test('toMaterialView: нефайловий матеріал не має ані meta, ані форми вкладення', () => {
  const v = toMaterialView({ type: 'note', title: 'Ідея', content: 'Текст' });
  assert.equal(v.meta, null);
  assert.equal(v.attachment, null);
});

test('toMaterialView: без назви -> "Без назви"', () => {
  assert.equal(toMaterialView({ type: 'file' }).title, 'Без назви');
});

test('toMaterialView: чеклист', () => {
  const v = toMaterialView({ id: 'c1', type: 'checklist', title: 'Здача', items: ['a', 'b', 'c'], checkedItems: [0, 2] });
  assert.deepEqual(v.checklist, { items: ['a', 'b', 'c'], checkedItems: [0, 2], done: 2, total: 3, percent: 67 });
});

test('toMaterialView: чеклист без items', () => {
  const v = toMaterialView({ type: 'checklist', title: 'Порожній' });
  assert.deepEqual(v.checklist, { items: [], checkedItems: [], done: 0, total: 0, percent: 0 });
});

test('toMaterialView: опитування рахує відсотки', () => {
  const v = toMaterialView({ id: 'p1', type: 'poll', title: 'Колір', options: ['Синій', 'Червоний'], votes: [3, 1] });
  assert.equal(v.poll.total, 4);
  assert.deepEqual(v.poll.results, [
    { option: 'Синій', count: 3, percent: 75 },
    { option: 'Червоний', count: 1, percent: 25 },
  ]);
});

test('toMaterialView: опитування без голосів не ділить на нуль', () => {
  const v = toMaterialView({ type: 'poll', title: 'Колір', options: ['Синій'] });
  assert.equal(v.poll.total, 0);
  assert.deepEqual(v.poll.results, [{ option: 'Синій', count: 0, percent: 0 }]);
});

test('toMaterialView: нотатка несе колір стікера з порталу', () => {
  const v = toMaterialView({ id: 'n1', type: 'note', title: 'Ідея', content: 'Текст', source: 'Дзвінок', color: '#fff3cd' });
  assert.deepEqual(v.note, { content: 'Текст', source: 'Дзвінок', color: '#fff3cd' });
});

test('toMaterialView: нотатка без кольору (або зі сміттям) падає на жовтий порталу', () => {
  assert.equal(toMaterialView({ type: 'note', content: 'Текст' }).note.color, '#fff3cd');
  assert.equal(toMaterialView({ type: 'note', content: 'Текст', color: 'red; }' }).note.color, '#fff3cd');
});

test('toMaterialView: лінк з OG', () => {
  const v = toMaterialView({ id: 'l1', type: 'link', title: 'Макети', url: 'https://figma.com/file/1', ogImage: 'https://cdn/og.png', ogTitle: 'Figma — Макети' });
  assert.equal(v.kind, 'link');
  assert.equal(v.link.domain, 'figma.com');
  assert.equal(v.link.image, 'https://cdn/og.png');
  assert.equal(v.link.title, 'Figma — Макети');
});

test('toMaterialView: лінк без OG падає на title і домен', () => {
  const v = toMaterialView({ type: 'link', title: 'Макети', url: 'https://www.figma.com/file/1' });
  assert.equal(v.link.image, null);
  assert.equal(v.link.title, 'Макети');
  assert.equal(v.link.domain, 'figma.com');
});

test('toMaterialView: битий URL лінка не кидає виняток', () => {
  const v = toMaterialView({ type: 'link', title: 'Зламаний', url: 'не-url' });
  assert.equal(v.link.domain, '');
  assert.equal(v.url, null);
});
