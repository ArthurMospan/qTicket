import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

// `dismiss` is a claim, and this file is what turns it into an observation.
//
// A Button marked `dismiss` says: pressing me does nothing except what the ×
// in this dialog's header does. On that promise, and only on it, globals.css
// stops drawing the button below md — a phone's dialog footer is a stack of
// full-width rows, and «Скасувати» was spending one of them repeating the ×.
//
// Two ways that promise can rot, and both of them are silent:
//   1. Somebody marks a button that also reverts, resets or steps back. Then a
//      phone loses an action that has no other affordance. ConfirmProvider's
//      «Скасувати» is exactly that shape — one of the two answers the dialog is
//      asking for — and is deliberately unmarked.
//   2. Somebody marks a button in a dialog that draws no × — no `title`, so no
//      header at all, or `showCloseButton={false}`. Then a phone loses the only
//      way out of the dialog.
// Neither shows up in a screenshot, in the drift report, or in a code review of
// the file that broke it. They show up here.
//
// A third shape was briefly a concern and is settled: a footer whose only child
// closes the dialog. It keeps its button. Standing alone the button is not a
// repeated answer but the action to take, and it crowds no other row, so it is
// simply never marked — the «Фільтри» sheet and the column-visibility sheet
// render on a phone exactly as they do on the desktop. The stylesheet no longer
// has a rule about that shape, and the fourth test below no longer counts it:
// it reads only where the `dismiss` rules are allowed to apply.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const SOURCE_EXTENSIONS = ['.js', '.jsx'];

async function sourceFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      found.push(...await sourceFiles(full));
    } else if (SOURCE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item.type === 'string') walk(item, visit);
      }
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

const elementName = node => (node.openingElement?.name?.type === 'JSXIdentifier'
  ? node.openingElement.name.name
  : null);

const attribute = (node, name) => node.openingElement?.attributes
  .find(item => item.type === 'JSXAttribute' && item.name?.name === name);

// The written form of an attribute's value, so two handlers can be compared as
// the reader compares them: `onClose` against `onClose`, and the same arrow
// body against the same arrow body.
const valueSource = (source, attr) => {
  if (!attr) return null;
  const value = attr.value;
  if (!value) return true; // bare `dismiss`
  if (value.type === 'StringLiteral') return value.value;
  if (value.type === 'JSXExpressionContainer') {
    return source.slice(value.expression.start, value.expression.end);
  }
  return source.slice(value.start, value.end);
};

// A Dialog may guard its own onClose — AssigneePicker and StatusTransitionPicker
// are `onClose={busy ? undefined : onClose}`, which makes the header × inert
// while a write is in flight, exactly as the footer button is `disabled={busy}`.
// The two are still the same action, so a conditional whose live branch is the
// footer's handler counts as the same handler.
function closeHandlerForms(source, dialog) {
  const attr = attribute(dialog, 'onClose');
  if (!attr) return [];
  const written = valueSource(source, attr);
  if (typeof written !== 'string') return [];
  const forms = [written];
  const expression = attr.value?.type === 'JSXExpressionContainer' ? attr.value.expression : null;
  if (expression?.type === 'ConditionalExpression') {
    for (const branch of [expression.consequent, expression.alternate]) {
      const branchSource = source.slice(branch.start, branch.end);
      if (branchSource !== 'undefined' && branchSource !== 'null') forms.push(branchSource);
    }
  }
  return forms;
}

// A file's `const footer = …`, so a Dialog written `footer={footer}` is read as
// the footer it is rather than as an identifier with nothing in it. To a scan
// that stops at the name, a lone «Закрити» built that way sits in no footer at
// all, which is the very shape assertion 1 exists to catch.
// Resolved only where the name is declared once in the file: a second
// declaration would mean guessing which one runs, and a wrong guess here lets a
// real stray through while claiming it checked.
function declarationsIn(ast) {
  const byName = new Map();
  walk(ast, node => {
    if (node.type !== 'VariableDeclarator') return;
    if (node.id?.type !== 'Identifier' || !node.init) return;
    const found = byName.get(node.id.name);
    if (found) found.push(node.init);
    else byName.set(node.id.name, [node.init]);
  });
  return name => {
    const found = byName.get(name);
    return found?.length === 1 ? found[0] : null;
  };
}

// The footer as the browser will be handed it: the attribute's own JSX, or
// whatever the identifier it names was assigned.
function footerRoot(dialog, resolve) {
  const value = attribute(dialog, 'footer')?.value;
  if (!value) return null;
  if (value.type === 'JSXExpressionContainer' && value.expression.type === 'Identifier') {
    return resolve(value.expression.name);
  }
  return value;
}

async function collect() {
  const files = await sourceFiles(SRC);
  const marked = [];   // every Button that carries `dismiss`
  const inFooter = []; // …and the Dialog whose `footer` it was found in
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!/(^|[^A-Za-z])dismiss($|[^A-Za-z])/.test(source)) continue;
    const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx'] });
    const where = relative(ROOT, file).split(sep).join('/');
    const resolve = declarationsIn(ast);

    walk(ast, node => {
      if (node.type !== 'JSXElement') return;
      if (elementName(node) === 'Button' && attribute(node, 'dismiss')) {
        marked.push({ where, line: node.loc.start.line });
      }
      if (elementName(node) !== 'Dialog') return;
      const root = footerRoot(node, resolve);
      if (!root) return;
      walk(root, inner => {
        if (inner.type !== 'JSXElement') return;
        if (elementName(inner) !== 'Button' || !attribute(inner, 'dismiss')) return;
        inFooter.push({
          where,
          line: inner.loc.start.line,
          title: valueSource(source, attribute(node, 'title')),
          showCloseButton: valueSource(source, attribute(node, 'showCloseButton')),
          onClick: valueSource(source, attribute(inner, 'onClick')),
          closeForms: closeHandlerForms(source, node),
        });
      });
    });
  }
  return { marked, inFooter };
}

// globals.css as `@media` blocks and the rest. Comments go first: that file
// quotes its own selectors and queries in prose, and a scan that cannot tell a
// rule from a paragraph about a rule reports whichever it read last.
function splitMedia(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  let outside = '';
  let cursor = 0;
  while (cursor < source.length) {
    const at = source.indexOf('@media', cursor);
    if (at === -1) { outside += source.slice(cursor); break; }
    outside += source.slice(cursor, at);
    const open = source.indexOf('{', at);
    if (open === -1) { outside += source.slice(at); break; }
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') depth -= 1;
      end += 1;
    }
    blocks.push({ condition: source.slice(at + '@media'.length, open).trim(), body: source.slice(open + 1, end - 1) });
    cursor = end;
  }
  return { blocks, outside };
}

// Below md, and the same below md every time. `(width < 48rem)` is what Tailwind
// 4.3 compiles `max-md:` into; `(max-width: 767px)` is a different query at a
// viewport of 767.5px, which browser zoom and fractional device pixel ratios
// produce all day. Either spelling is allowed here, one spelling per feature is
// not negotiable: the two rules that hide a dismiss must never land on opposite
// sides of md.
const BELOW_MD = /^\(\s*(?:width\s*<\s*48rem|max-width:\s*767(?:\.\d+)?px)\s*\)$/;

test('every `dismiss` button sits in a dialog footer', async () => {
  const { marked, inFooter } = await collect();
  assert.ok(marked.length > 0, 'the prop is in use — this scan found nothing, so it is broken');
  const seen = new Set(inFooter.map(item => `${item.where}:${item.line}`));
  const stray = marked
    .filter(item => !seen.has(`${item.where}:${item.line}`))
    .map(item => `${item.where}:${item.line}`);
  assert.deepEqual(stray, [], 'only a dialog footer can hide a button below md — a `dismiss` anywhere else does nothing and lies about the button');
});

test('every `dismiss` button sits under a header that draws an ×', async () => {
  const { inFooter } = await collect();
  const unreachable = inFooter
    .filter(item => !item.title || item.showCloseButton === 'false')
    .map(item => `${item.where}:${item.line}`);
  assert.deepEqual(unreachable, [], 'Dialog draws its header, and its ×, only when it has a title and keeps showCloseButton — hiding this button would leave the dialog with no way out on a phone');
});

test('a `dismiss` button does exactly what its dialog\'s × does', async () => {
  const { inFooter } = await collect();
  const different = inFooter
    .filter(item => !item.closeForms.includes(item.onClick))
    .map(item => `${item.where}:${item.line}`);
  assert.deepEqual(different, [], 'this button is hidden on a phone because the × replaces it — if its handler is not the dialog\'s onClose, something it does is only reachable above md');
});

// The one the first three cannot see. They read the buttons; this reads the
// stylesheet, and asks the only question left about it: where are these rules
// allowed to apply? Below md and nowhere else, on one spelling of the query. A
// `dismiss` rule that reached the desktop would take a button out of a row where
// it is one of a line and hides nothing, and two spellings of "below md" would
// disagree at 767.5px — ordinary under browser zoom or a fractional device pixel
// ratio — leaving a footer with one of its two buttons drawn.
test('every rule keyed on `dismiss` applies below md and nowhere else', async () => {
  const { marked } = await collect();
  assert.ok(
    marked.length > 0,
    'the prop is in use — this scan found nothing, so it is broken and the rules below are being checked against nothing',
  );

  const { blocks, outside } = splitMedia(await readFile(join(ROOT, 'src/app/globals.css'), 'utf8'));
  const gated = blocks.filter(block => block.body.includes("data-ui-dismiss='true'"));

  assert.ok(
    !outside.includes("data-ui-dismiss='true'"),
    'a `dismiss` rule outside a media query reaches the desktop, where the footer row is one of a line of buttons and hides nothing',
  );
  assert.deepEqual(
    [...new Set(gated.map(block => block.condition))].filter(condition => !BELOW_MD.test(condition)),
    [],
    'every rule keyed on `dismiss` is a phone rule and must be gated below md',
  );
  assert.equal(
    new Set(gated.map(block => block.condition)).size,
    1,
    'the direct-child rule and the wrapped-child rule are one behaviour written twice — at a viewport of 767.5px two different queries disagree, and a footer keeps the copy it was supposed to lose',
  );

  // There is deliberately no rule here about a footer whose only child is a
  // dismiss, and no count of such footers. A footer like that keeps its button:
  // standing alone it reads as the action to take rather than as a second copy
  // of one, and it crowds nothing, so it costs the phone nothing. Which is why
  // neither the «Фільтри» sheet nor the column-visibility sheet carries the mark
  // — the whole point of marking is to remove a *repeated* answer, and a lone
  // button is not one.
});
