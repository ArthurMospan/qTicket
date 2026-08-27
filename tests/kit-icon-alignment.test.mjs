import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '@babel/parser';

// Why an icon button can be crooked, and why nobody could find it by looking.
//
// An icon button centres its glyph with flexbox. The gap on each side is
// `(box - icon) / 2`, so when the box is 20 and the icon is 13 the glyph starts
// at 3.5px — half a device pixel in. The browser cannot paint half a pixel, so
// it picks a side; a stroked glyph then antialiases more heavily on that side
// and the button reads as visibly off-centre. Which side it picks depends on
// the zoom level, because 3.5 CSS pixels is 4.375 device pixels at 125% and a
// whole 7 at 200% — which is why the same button looked crooked one way, then
// the other, then briefly correct.
//
// That was the board column's kebab: 13px in a 20px box, sitting beside a plus
// that was 16px in the same box and therefore landed on a clean 2px. One of the
// two was always going to look wrong, and no amount of adjusting the *icon*
// could fix it — the fault was in the parity of the pair.
//
// Every box in `SIZES` is an even number of pixels. So the whole class of bug
// disappears if every icon size is even too, and this file is what keeps it
// that way: the next 13 or 15 anybody adds fails here rather than shipping as a
// button somebody has to squint at.

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx'],
  });
}

// The numeric values of a top-level `const NAME = { key: 12, … }`.
function numericMap(ast, name) {
  const declaration = ast.program.body
    .flatMap(node => (node.type === 'ExportNamedDeclaration' ? [node.declaration] : [node]))
    .filter(Boolean)
    .find(node => node.type === 'VariableDeclaration'
      && node.declarations.some(item => item.id?.name === name));
  const object = declaration?.declarations.find(item => item.id?.name === name)?.init;
  assert.ok(object?.type === 'ObjectExpression', `${name} must be an object literal`);
  return Object.fromEntries(object.properties
    .filter(property => property.type === 'ObjectProperty' && property.value.type === 'NumericLiteral')
    .map(property => [String(property.key.name ?? property.key.value), property.value.value]));
}

// The pixel widths declared by the icon entries of `SIZES` — `w-[20px] p-0`.
function boxWidths(source) {
  const boxes = {};
  const block = source.slice(source.indexOf('export const SIZES = {'), source.indexOf('};', source.indexOf('export const SIZES = {')));
  for (const match of block.matchAll(/'?([\w-]+)'?:\s*'w-\[(\d+)px\]/g)) {
    boxes[match[1]] = Number(match[2]);
  }
  return boxes;
}

test('every icon button box is an even number of pixels', async () => {
  const source = await read('../src/components/ui/Button.jsx');
  const boxes = boxWidths(source);
  assert.ok(Object.keys(boxes).length >= 7, 'the icon sizes were not found in SIZES');
  const odd = Object.entries(boxes).filter(([, width]) => width % 2 !== 0);
  assert.deepEqual(odd, [], 'an odd box cannot hold an even glyph on a whole pixel');
});

test('every icon size is even, so a centred glyph lands on a whole pixel', async () => {
  const source = await read('../src/components/ui/Button.jsx');
  const ast = parseSource(source);
  const sizes = {
    ...numericMap(ast, 'ICON_SIZES'),
    ...numericMap(ast, 'COMPOSITION_ICON_SIZES'),
  };
  const odd = Object.entries(sizes).filter(([, size]) => size % 2 !== 0);
  assert.deepEqual(
    odd,
    [],
    'an odd icon in an even box is centred on a half pixel and reads as crooked',
  );
});

test('the board kebab and the plus beside it share a whole-pixel gap', async () => {
  const source = await read('../src/components/ui/Button.jsx');
  const ast = parseSource(source);
  const boxes = boxWidths(source);
  const iconSizes = numericMap(ast, 'ICON_SIZES');
  const compositionSizes = numericMap(ast, 'COMPOSITION_ICON_SIZES');

  // The exact pair from the board column header: both `size="icon-xs"`, one
  // with the kebab composition and one without.
  const box = boxes['icon-xs'];
  const kebabGap = (box - compositionSizes['section-kebab']) / 2;
  const plusGap = (box - iconSizes['icon-xs']) / 2;
  assert.equal(kebabGap, Math.round(kebabGap), 'the kebab must not sit on a half pixel');
  assert.equal(plusGap, Math.round(plusGap), 'the plus must not sit on a half pixel');
  // The kebab is deliberately the smaller of the two: three filled dots carry
  // more ink than two hairlines, so at the same size it reads darker.
  assert.ok(
    compositionSizes['section-kebab'] < iconSizes['icon-xs'],
    'the kebab stays optically lighter than the plus it sits beside',
  );
});

test('the file square centres its glyph and its play badge on whole pixels', async () => {
  const source = await read('../src/components/ui/Attachments/FileThumb.jsx');
  const ast = parseSource(source);
  // The squares `.ui-file-glyph` declares, per density.
  const boxes = { sm: 28, md: 36, lg: 56 };
  for (const map of ['GLYPH_SIZES', 'PLAY_BADGE_SIZES']) {
    for (const [density, size] of Object.entries(numericMap(ast, map))) {
      const gap = (boxes[density] - size) / 2;
      assert.equal(gap, Math.round(gap), `${map}.${density} lands on a half pixel`);
    }
  }
});
