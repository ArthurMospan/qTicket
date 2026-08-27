// Every colour that is styling comes from a token.
//
// The three reports that already existed could not see this one. `kit:drift`
// asks whether a component is passed a variant it declares; `kit:audit` asks
// whether a control is the kit's. A raw `#f0f0f0` on a div is neither — it is a
// value nobody declared anywhere, which is how the product came to own
// twenty-six status colours and six spellings of its own canvas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scanColors } from '../scripts/kit-colors.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('no product UI file paints a colour the tokens do not name', () => {
  const { findings } = scanColors();
  assert.deepEqual(
    findings.map(f => `${f.file}:${f.line} ${f.value}`),
    [],
    'use a token utility — ink/canvas/surface/line/muted/faint, the four status '
    + 'scales, or the chart tokens. A colour that is genuinely data belongs in '
    + 'DATA_COLORS in scripts/kit-colors.mjs with its reason.',
  );
});

test('the committed colour report matches the code', async () => {
  const committed = JSON.parse(await read('../src/app/ui-kit/kit-colors.generated.json'));
  const { findings } = scanColors();
  assert.equal(committed.totals.hardcoded, findings.length);
});

// A zero is only worth what it was measured over.
//
// This scan reported zero for months while fifty-nine raw colours shipped
// inside src/components/ui, because `collectWorkspaceUiFiles()` stops at the
// kit boundary by default and nobody had asked it not to. That default is right
// for `kit:scan`, which counts how the product reaches for the kit; it is wrong
// here, because the kit is what paints most of the product. Narrowing the walk
// again would restore the silence, not the compliance — so the walk is the
// thing under test, not just its result.
test('the colour scan covers the kit, which is where most of the product is painted', async () => {
  const script = await read('../scripts/kit-colors.mjs');
  assert.match(script, /collectWorkspaceUiFiles\(\{ includeSharedUi: true \}\)/);

  const { collectWorkspaceUiFiles } = await import('../scripts/workspace-ui-files.mjs');
  const walked = collectWorkspaceUiFiles({ includeSharedUi: true });
  const kitFiles = walked.filter(file => file.split(/[\\/]/).join('/').includes('/src/components/ui/'));
  assert.ok(
    kitFiles.length > 100,
    `the scan reaches ${kitFiles.length} kit files; it used to reach none`,
  );
  // Named rather than counted, so that losing one of the two files whose raw
  // colours started this reads as a failure and not as a smaller number.
  for (const name of ['DataDisplay/Counter.jsx', 'Layout/TopHeader.jsx']) {
    assert.ok(
      kitFiles.some(file => file.split(/[\\/]/).join('/').endsWith(`/src/components/ui/${name}`)),
      name,
    );
  }
});

// Nothing moved on screen. Where a token already held the exact value the kit
// was writing by hand, the utility replaced the hex; where it did not, the value
// became a token rather than being snapped onto a near neighbour. These four are
// the ones that were added, and they are the ones a future edit is most likely
// to "tidy up" into the three greys above them — which would change pixels.
test('the greys the kit was already painting keep their own names and values', async () => {
  const css = await read('../src/app/globals.css');
  for (const [token, value] of [
    ['line-strong', '#d4d4d4'],
    ['selected', '#f1f1f1'],
    ['placeholder', '#b0b0b0'],
    ['ink-soft', '#6b6b6b'],
    ['surface-dark', '#2a2a2a'],
    ['success-on-dark', '#4ade80'],
    ['danger-on-dark', '#f87171'],
    ['muted-on-dark', '#a3a3a3'],
  ]) {
    assert.match(css, new RegExp(String.raw`--color-${token}:\s*${value};`), token);
  }

  // A selected row and a hovered row must stay two different greys. Collapsing
  // `selected` onto `canvas` — they are four levels apart — would make the
  // table's selection invisible under the pointer.
  const table = await read('../src/components/ui/TaskManagement/TaskTableView.jsx');
  assert.match(table, /selected \? 'bg-selected' : 'hover:bg-canvas'/);
});

test('the status scale is declared once, in three roles, and clears AA on white', async () => {
  const css = await read('../src/app/globals.css');
  const lum = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(s => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const onWhite = hex => (1.05) / (lum(hex) + 0.05);

  for (const status of ['success', 'warning', 'danger', 'info']) {
    for (const role of ['', '-solid', '-soft']) {
      assert.match(css, new RegExp(String.raw`--color-${status}${role}:\s*#[0-9a-f]{6};`), `${status}${role}`);
    }
    // The ink is the role that carries text, so it is the one with a floor.
    const ink = css.match(new RegExp(String.raw`--color-${status}:\s*(#[0-9a-f]{6});`))[1];
    const contrast = onWhite(ink);
    assert.ok(contrast >= 4.5, `--color-${status} is ${contrast.toFixed(2)}:1 on white, needs 4.5`);
  }

  // The four Pill tones were the only written-down copy of this palette, which
  // is why the tokens carry their values — and why the tones now read them back
  // instead of holding a second copy.
  for (const tone of ['success', 'warning', 'danger', 'info']) {
    assert.match(
      css,
      new RegExp(String.raw`\[data-ui-pill-tone='${tone}'\] \{\s*background: var\(--color-${tone}-soft\);\s*color: var\(--color-${tone}\);`),
      tone,
    );
  }
});

test('a counter on a branded rail takes the rail’s own two colours', async () => {
  const counter = await read('../src/components/ui/DataDisplay/Counter.jsx');
  // `computeSidebarTheme` guarantees 4.5:1 between --sb-text and --sb-bg on
  // every background an organization can pick, so inverting them is legible by
  // construction. The `bg-ink text-white` span this replaced was ink on ink —
  // contrast 1.0 — on the default dark sidebar.
  assert.match(counter, /appearance === 'sidebar'/);
  assert.match(counter, /bg-\[var\(--sb-text,var\(--color-ink\)\)\] text-\[var\(--sb-bg,var\(--color-surface\)\)\]/);

  // Крапка бере ту саму пару, і з тієї самої причини. «В іншій організації щось
  // є» — це факт «так» або «ні»: піти туди й подивитися доведеться однаково, чи
  // там одне повідомлення, чи сім, а число біля назви організації читалося як
  // мітка самої організації. Одна форма на всі три місця, де це сказано.
  assert.match(counter, /bg-\[var\(--sb-text,var\(--color-ink\)\)\]'/);

  const sidebar = await read('../src/components/WorkspaceSidebar.jsx');
  const mobile = await read('../src/components/MobileNav.jsx');
  for (const source of [sidebar, mobile]) {
    assert.match(source, /<Counter variant="dot" size="sm" appearance="sidebar" \/>/);
    assert.doesNotMatch(source, /<Counter value=\{otherOrgUnreadCount\}/);
  }
  // And the row it sits in yields the name rather than the chevron: 120px of
  // name plus the counter plus the chevron is 156px in a 140px column.
  assert.match(sidebar, /className="flex w-full min-w-0 items-center gap-\[4px\] cursor-pointer transition-colors"/);
  assert.match(sidebar, /className="min-w-0 truncate transition-all"/);
  assert.doesNotMatch(sidebar, /data-ui-pill="branding-counter"/);
});
