import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { auditA11y } from '../scripts/kit-a11y.mjs';
import { computeSidebarTheme, computeTranslucentSidebarTheme, contrastRatio } from '../src/lib/utils/sidebarTheme.js';
import { createUkrainianDndAnnouncements } from '../src/lib/utils/dndAnnouncements.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('quiet text tokens and generated sidebar themes keep AA contrast', () => {
  assert.deepEqual(auditA11y().contrastFailures, []);

  // The rail's own text and its navigation keep AA — the navigation was never
  // what needed to move. The project group under them is deliberately far
  // quieter than any accessibility floor: a list of names you already know,
  // found by position and by icon, asked to stop competing with the navigation
  // above it. Every attempt to do that at 3:1 or better moved it by nine to
  // twenty points out of 255, which is a change that does not exist on a
  // screen. See SCANNABLE_CONTRAST in sidebarTheme.js.
  const FLOORS = { text: 4.5, muted: 4.5, mutedProject: 2.4, mutedHeader: 2.4 };
  for (let channel = 0; channel <= 255; channel += 17) {
    const hex = `#${channel.toString(16).padStart(2, '0').repeat(3)}`;
    const theme = computeSidebarTheme(hex);
    for (const [token, floor] of Object.entries(FLOORS)) {
      assert.ok(
        contrastRatio(theme[token], theme.bg) >= floor,
        `${token} must hold ${floor}:1 on custom sidebar ${hex}`,
      );
    }
    // The order is the whole point of having three, so a change that erases a
    // step fails here rather than on somebody's screen.
    assert.ok(
      contrastRatio(theme.muted, theme.bg) <= contrastRatio(theme.text, theme.bg),
      `the navigation must not be louder than the rail's own text on ${hex}`,
    );
    assert.ok(
      contrastRatio(theme.mutedProject, theme.bg) <= contrastRatio(theme.muted, theme.bg),
      `the project list must not be louder than the navigation on ${hex}`,
    );
  }
});

test('the glass tab bar keeps AA against the colour it is actually seen as', () => {
  // The bar is painted translucent, so a token that clears 4.5:1 against the
  // organization's colour can still fail against the lighter thing the reader
  // looks at. Every token here answers to `perceived`, and the tone the
  // organization chose never flips: a colour that cannot carry it at this
  // opacity is given less transparency instead of different labels.
  for (let red = 0; red <= 255; red += 51) {
    for (let green = 0; green <= 255; green += 51) {
      for (let blue = 0; blue <= 255; blue += 51) {
        const hex = `#${[red, green, blue].map(c => c.toString(16).padStart(2, '0')).join('')}`;
        const glass = computeTranslucentSidebarTheme(hex);
        assert.equal(glass.isDark, computeSidebarTheme(hex).isDark, `tone must hold on ${hex}`);
        assert.ok(glass.opacity >= 0.88 && glass.opacity <= 1, `opacity budget on ${hex}`);
        assert.equal(glass.bg, computeSidebarTheme(hex).bg, `the painted colour stays the brand on ${hex}`);
        for (const [token, floor] of Object.entries({
          text: 4.5, muted: 4.5, mutedProject: 2.4, mutedHeader: 2.4,
        })) {
          assert.ok(
            contrastRatio(glass[token], glass.perceived) >= floor,
            `${token} must hold ${floor}:1 on the glass bar over ${hex}`,
          );
        }
      }
    }
  }
});

test('dynamic control names are queued for runtime verification instead of accepted as proof', () => {
  const audit = auditA11y();
  assert.ok(audit.runtimeNameVerification.length > 0);
  assert.ok(audit.runtimeNameVerification.some(item => (
    item.location.includes('src/components/ui/Tabs.jsx')
    && item.attributes.includes('aria-label')
  )));
});

test('the known board controls, tab icons, headings and breadcrumbs carry accessible semantics', async () => {
  const [project, mine, topHeader, breadcrumb, board, analytics] = await Promise.all([
    read('src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('src/app/(app)/my/page.js'),
    read('src/components/ui/Layout/TopHeader.jsx'),
    read('src/components/ui/Navigation/Breadcrumb.jsx'),
    read('src/components/workspace/AgileBoard.jsx'),
    read('src/app/(app)/analytics/page.js'),
  ]);

  for (const label of [
    'Стан інцидентів',
    'Фільтр за виконавцем',
    'Фільтр за пріоритетом',
  ]) assert.match(project, new RegExp(`ariaLabel="${label}"`));

  assert.match(mine, /title: 'Дошка', ariaLabel: 'Дошка'/);
  assert.match(mine, /title: 'Список', ariaLabel: 'Список'/);
  // The customer page is a focused list, not a second board/table surface.
  assert.doesNotMatch(project, /ariaLabel: 'Дошка'|ariaLabel: 'Таблиця'/);
  assert.doesNotMatch(mine, /ariaLabel: 'Таблиця'/);
  assert.match(topHeader, /aria-label=\{unreadCount > 0/);
  assert.match(topHeader, /aria-label="Відкрити меню користувача"/);
  assert.match(breadcrumb, /<li key=\{index\}/);
  assert.doesNotMatch(breadcrumb, /<React\.Fragment/);
  assert.doesNotMatch(board, /<h3 className="ui-type-column-title/);
  assert.match(board, /<h2 className="ui-type-column-title/);
  // The projects table used to end each row with a 24px "Відкрити →" link that
  // only appeared on hover — a target you had to find before you could hit it.
  // `DataTable` makes the identifying cell of every row the link instead, so
  // the target is the row, and it is there whether or not a pointer is.
  assert.match(analytics, /<DataTable[\s\S]{0,400}rowHref=/);
  const dataTable = await read('src/components/ui/DataDisplay/DataTable.jsx');
  // The identifying cell stays a real link — that is what the keyboard tabs to,
  // what the middle button opens in a tab, and what the context menu can copy.
  // The row-wide click sits on top of it and must never replace it.
  assert.match(dataTable, /column === leadColumn && href \?[\s\S]{0,400}<Link href=\{href\}/);
  assert.match(dataTable, /onClick=\{href \? followRow\(href\) : undefined\}/);
  // And the shortcut steps aside for anything the reader actually aimed at,
  // so a control inside a row is still its own target.
  assert.match(dataTable, /event\.target\.closest\('a, button, input, select, textarea/);
  assert.doesNotMatch(analytics, /sm:opacity-0 sm:group-hover:opacity-100/);
});

test('drag announcements use Ukrainian labels and never expose droppable ids', () => {
  const messages = [];
  const announcements = createUkrainianDndAnnouncements({
    itemLabel: () => 'DES-42',
    listLabel: id => ({ backlog: 'Беклог', 'in-progress': 'У роботі' })[id],
  });
  const provided = { announce: message => messages.push(message) };
  const start = {
    draggableId: 'internal-issue-id',
    source: { droppableId: 'backlog', index: 1 },
  };
  announcements.onDragStart(start, provided);
  announcements.onDragUpdate({
    ...start,
    destination: { droppableId: 'in-progress', index: 0 },
  }, provided);
  announcements.onDragEnd({
    ...start,
    reason: 'DROP',
    destination: { droppableId: 'in-progress', index: 0 },
  }, provided);

  assert.equal(messages.length, 3);
  assert.ok(messages.every(message => /[А-ЯІЇЄа-яіїє]/.test(message)));
  assert.ok(messages.some(message => message.includes('Беклог')));
  assert.ok(messages.some(message => message.includes('У роботі')));
  assert.ok(messages.every(message => !message.includes('in-progress')));
  assert.ok(messages.every(message => !message.includes('internal-issue-id')));
});
