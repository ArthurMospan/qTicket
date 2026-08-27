import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (['.js', '.jsx'].includes(extname(path))) found.push(path.split(sep).join('/'));
  }
  return found;
}

const sources = walk(join(ROOT, 'src'))
  .filter(file => !file.endsWith('lib/design/icons.js'))
  .map(file => ({ file: file.slice(file.indexOf('src/')), source: readFileSync(file, 'utf8') }));

// «Мої завдання», «Календар» and «Чат» are named once, in lib/design/icons, and
// everything that means one of those three reads the name. The rule exists
// because the first attempt at changing them was a find-and-replace over
// imports, and it missed every place that had not imported anything: the task
// card and the task row drew the chat bubble as a literal `<path d="…">`, so no
// rename could ever reach them, and they went on showing the old glyph beside
// the new one everywhere else.
test('no file draws a feature glyph past the names that own it', () => {
  // The exact lucide paths for the glyphs these three replaced. A hand-drawn
  // copy is invisible to every rename, which is the whole failure mode.
  const HAND_DRAWN = [
    ['MessageSquare', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5'],
    ['CalendarDays', 'M8 2v4M16 2v4M3 10h18'],
  ];
  const offenders = [];
  for (const { file, source } of sources) {
    for (const [name, path] of HAND_DRAWN) {
      if (source.includes(path)) offenders.push(`${file}: hand-drawn ${name}`);
    }
    // The glyphs themselves, imported by their lucide names.
    for (const name of ['CalendarDays', 'MessagesSquare']) {
      if (new RegExp(`\b${name}\b`).test(source)) offenders.push(`${file}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], `these bypass @/lib/design/icons:\n${offenders.join('\n')}`);
});

// The one that matters most: the type icon feeds the task detail, every type
// select and every filter in the product.
test('the task type reads the shared task icon', () => {
  const workflow = readFileSync(join(ROOT, 'src/lib/hooks/useWorkflowConfig.js'), 'utf8');
  const taskTypes = readFileSync(join(ROOT, 'src/lib/design/taskTypeIcons.js'), 'utf8');
  assert.match(workflow, /import \{ TASK_TYPE_ICONS \} from '@\/lib\/design\/taskTypeIcons'/);
  assert.match(workflow, /export const TYPE_ICONS = TASK_TYPE_ICONS/);
  assert.match(taskTypes, /task:\s*TaskIcon/);
  assert.match(taskTypes, /star:\s*Star/);
  assert.match(taskTypes, /return taskTypeIconKeyForType\(type\)/);
  assert.match(taskTypes, /from '@\/lib\/design\/icons'/);
});

test('type settings lock Task, offer presets, and never expose an icon picker', () => {
  const settings = readFileSync(join(ROOT, 'src/app/(app)/settings/page.js'), 'utf8');
  assert.match(settings, /locked=\{isSystemTaskTypeId\(t\.id\)\}/);
  assert.match(settings, /label: '',\s*color: '#8b5cf6'/);
  assert.match(settings, /typeSuggestions=\{DEFAULT_TYPES\.filter/);
  assert.match(settings, /onChooseTypeSuggestion=/);
  assert.match(settings, /Стандартні типи/);
  assert.doesNotMatch(settings, /TASK_TYPE_ICON_OPTIONS|chooseTypeIcon|Обрати іконку/);
});

// The two lists a task appears in, which is where the miss was visible.
test('the task card and the task row use the shared icons', () => {
  for (const file of [
    'src/components/workspace/IssueCard.jsx',
    'src/components/ui/TaskManagement/TaskRow.jsx',
  ]) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.match(source, /import \{ CalendarIcon, TaskIcon \} from '@\/lib\/design\/icons'/, file);
    assert.doesNotMatch(source, /<svg[\s\S]{0,200}M21 15a2 2/, `${file} still draws the bubble by hand`);
    // The message count itself is one component now, used by both, so neither
    // holds a chat glyph of its own to drift.
    assert.match(source, /<TaskCounters\b/, file);
    assert.doesNotMatch(source, /ChatIcon/, file);
  }
  const counters = readFileSync(join(ROOT, 'src/components/ui/TaskManagement/TaskCounters.jsx'), 'utf8');
  assert.match(counters, /import \{ ChatIcon \} from '@\/lib\/design\/icons'/);
  assert.match(counters, /<ChatIcon size=\{scale\.icon \+ 1\} \/>/);
});

// A `CheckCircle`-shaped tick that means "this succeeded" is a different
// decision that happens to look alike, and it keeps its own icon.
//
// Раніше тут стояв точний рядок класів, включно з `text-emerald-500`, і тест
// був єдиним, що про нього знало: `/invite` лежить поза обходом `kit:colors`,
// тож палітра Tailwind жила там непоміченою, а тест її ще й закріплював.
// Перевіряється намір — галочка лишається власною іконкою й фарбується
// токеном, — а не те, як саме її цього тижня набрали.
test('the success tick is left alone', () => {
  const invite = readFileSync(join(ROOT, 'src/app/invite/[token]/page.js'), 'utf8');
  assert.match(invite, /<CheckCircle2 /);
  assert.doesNotMatch(invite, /text-emerald-\d/);
});

// Той самий обхід, що його не бачить `kit:colors`: сторінка запрошення живе
// поза `(app)`, тож жоден зі згенерованих звітів туди не заглядає. Тут стояли
// індиговий спінер, смарагдова галочка, червоний хрестик і `bg-[#101010]` —
// чотири кольори, яких у гамі продукту немає.
test('the invite landing paints from tokens, like everything else', () => {
  const invite = readFileSync(join(ROOT, 'src/app/invite/[token]/page.js'), 'utf8');
  assert.doesNotMatch(invite, /(?:bg|text|border|ring)-\[#[0-9a-fA-F]{3,8}\]/);
  assert.doesNotMatch(
    invite,
    /(?:bg|text|border|ring)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d/,
  );
});
