// scripts/kit-props.mjs — the API of every kit component, read from the code.
//
// «Які пропси в цього компонента?» was answerable only by opening the file.
// The catalogue showed what a component looks like and where the product uses
// it, and said nothing about how to call it — so every new call site was
// written by copying an existing one, defaults included, whether or not they
// were still the right defaults.
//
// A table written by hand would be a second copy of a signature, free to fall
// out of step with it — the same failure the preview snippets and the variant
// manifest were each built to remove. So the table is extracted:
//
//   • the props are the component's own destructured parameters;
//   • the default is the source text of its default value;
//   • the declared values come from the variant manifest, so the table and
//     «Матриця варіантів» can never disagree about what `size` accepts;
//   • the description comes from JSDoc — `@param {type} props.name - text` or
//     a `@prop` line — falling back to the trailing `// comment` this codebase
//     had already been writing next to props for years.
//
// Read by /ui-kit → the component drawer, and by tests/kit-props.test.mjs,
// which keeps the documented share from falling.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { extractVariants } from './kit-variants.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = join(ROOT, 'src', 'app', 'ui-kit', 'kit-usage.generated.json');
const OUTPUT = join(ROOT, 'src', 'app', 'ui-kit', 'kit-props.generated.json');

// Props every React component in this codebase takes and nobody needs a row
// about. `className` is the exception that stays: whether a component accepts
// one at all is a real question, and the drift contract has opinions about it.
const NOISE_PROPS = new Set(['children', '...rest', 'props']);

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'dynamicImport', 'topLevelAwait', 'importAttributes'],
  });
}

// The block comment immediately above a node, with nothing but whitespace in
// between. Read from the comment list by position rather than from
// `leadingComments`, because the comment above `export default function X`
// attaches to the export statement, not to the function babel hands back.
function docCommentAbove(node, comments, source) {
  let best = null;
  for (const comment of comments) {
    if (comment.type !== 'CommentBlock' || comment.end > node.start) continue;
    if (!/^\*/.test(comment.value)) continue;
    if (source.slice(comment.end, node.start).trim() !== '') continue;
    if (!best || comment.end > best.end) best = comment;
  }
  return best;
}

// A decorative rule, not a sentence: `// ─── Dialog ───` and friends open half
// the files in the kit and say nothing a reader does not already know.
const DIVIDER = /^[\s─=—*-]*$/;

// The run of `//` lines directly above the component. This codebase documents
// with line comments and has done since before anything read them — asking it
// to switch to `/** */` for the sake of a table would be a second convention
// covering the same ground, so the table reads the one that is already there.
// JSDoc still wins where it exists: only it can carry per-prop `@param` tags.
function lineCommentAbove(node, comments, source) {
  const above = comments
    .filter(comment => comment.type === 'CommentLine' && comment.end <= node.start)
    .sort((a, b) => a.start - b.start);

  const run = [];
  let boundary = node.start;
  for (let index = above.length - 1; index >= 0; index -= 1) {
    const comment = above[index];
    if (source.slice(comment.end, boundary).trim() !== '') break;
    run.unshift(comment.value.trim());
    boundary = comment.start;
  }

  const lines = run.filter(line => line && !DIVIDER.test(line));
  if (lines.length === 0) return '';
  return firstSentences(lines.join(' '));
}

// A table cell holds a sentence or two. The comment above a component in this
// codebase is usually a paragraph explaining a decision — worth keeping in the
// file, and not what somebody scanning an API wants to read.
function firstSentences(text, limit = 180) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let out = '';
  for (const sentence of sentences) {
    if (out && (out + sentence).length > limit) break;
    out += sentence;
  }
  return (out || clean.slice(0, limit)).trim();
}

// `@param {type} props.size - what it does`, with the braces counted rather
// than matched by a regex: a type is very often an object or a callback
// (`{{label: string}[]}`, `{(range: {a, b}) => void}`) and `\{([^}]*)\}` stops
// at the first inner brace. That silently dropped every prop whose type had
// one — `items`, `tabs`, `options`, `onClick` — while the ones beside them
// documented fine, which is a hard difference to see in a diff.
function readTag(line) {
  const start = line.match(/^\s*@(?:param|prop)\s+/);
  if (!start) return null;
  let rest = line.slice(start[0].length);
  let type = '';
  if (rest.startsWith('{')) {
    let depth = 0;
    let index = 0;
    for (; index < rest.length; index += 1) {
      if (rest[index] === '{') depth += 1;
      else if (rest[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) return null;
    type = rest.slice(1, index).trim();
    rest = rest.slice(index + 1).trimStart();
  }
  const named = rest.match(/^\[?(?:props\.)?([\w.]+)\]?\s*(?:-\s*)?(.*)$/);
  if (!named) return null;
  return { type, name: named[1], description: named[2].trim() };
}

// The component's own summary is every line before the first tag.
function parseJsDoc(comment) {
  if (!comment) return { summary: '', props: {} };
  const lines = comment.value
    .split('\n')
    .map(line => line.replace(/^\s*\*ic?\s?/, '').replace(/^\s*\*\s?/, '').trimEnd());

  const summary = [];
  const props = {};
  for (const line of lines) {
    if (/^\s*@(param|prop)\b/.test(line)) {
      const tag = readTag(line);
      // `@param` with no resolvable name is malformed, and quietly dropping it
      // is better than recording a prop called `undefined`.
      if (tag && tag.name !== 'props') props[tag.name] = { type: tag.type, description: tag.description };
      continue;
    }
    if (/^\s*@/.test(line)) continue;
    if (summary.length || line.trim()) summary.push(line.trim());
  }
  return { summary: firstSentences(summary.join(' ')), props };
}

// `size = 'md', // sm, md, lg` — the shape this codebase was already using to
// document props before anything read them.
function trailingComment(source, endIndex) {
  const lineEnd = source.indexOf('\n', endIndex);
  const rest = source.slice(endIndex, lineEnd === -1 ? source.length : lineEnd);
  // No `$` anchor: half the kit is stored with CRLF, and `.` does not match the
  // `\r`, so an end-anchored pattern silently found nothing in exactly those
  // files — Button documented none of its props while ToggleSwitch documented
  // all of them, for no reason visible in either file.
  const match = rest.match(/\/\/\s*(.+)/);
  return match ? match[1].trim() : '';
}

function defaultText(source, node) {
  if (!node) return '';
  const text = source.slice(node.start, node.end).replace(/\s+/g, ' ').trim();
  return text.length > 48 ? `${text.slice(0, 45)}…` : text;
}

// Which function in the file is the component. The name is the first answer;
// a default-exported function is the second; the first function that takes a
// destructured object is the fallback, which is what `forwardRef(({…}) => …)`
// resolves to.
function findComponent(ast, name) {
  const candidates = [];
  const visit = (node, exported = false) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ExportDefaultDeclaration') {
      visit(node.declaration, true);
      return;
    }
    const isFunction = node.type === 'FunctionDeclaration'
      || node.type === 'ArrowFunctionExpression'
      || node.type === 'FunctionExpression';
    if (isFunction && (node.params || []).some(param => {
      const target = param.type === 'AssignmentPattern' ? param.left : param;
      return target.type === 'ObjectPattern';
    })) {
      candidates.push({ node, name: node.id?.name || '', exported });
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(item => visit(item, exported));
      else if (child && typeof child === 'object' && child.type) {
        // A `const X = forwardRef(…)` names the component on the declarator.
        if (node.type === 'VariableDeclarator' && key === 'init') {
          const before = candidates.length;
          visit(child, exported);
          for (let index = before; index < candidates.length; index += 1) {
            if (!candidates[index].name) candidates[index].name = node.id?.name || '';
          }
          continue;
        }
        visit(child, exported);
      }
    }
  };
  // A doc comment sits above the *statement*, not above the function node:
  // `export default function X` starts the FunctionDeclaration at `function`,
  // so measuring the gap from there always finds `export default` in the way
  // and every summary in the kit came back empty. Each candidate therefore
  // carries the top-level statement it belongs to.
  for (const statement of ast.program.body) {
    const before = candidates.length;
    visit(statement);
    for (let index = before; index < candidates.length; index += 1) {
      candidates[index].anchor = statement.start;
    }
  }

  return candidates.find(candidate => candidate.name === name)
    || candidates.find(candidate => candidate.exported)
    || candidates[0]
    || null;
}

export function extractProps() {
  const usage = JSON.parse(readFileSync(USAGE, 'utf8'));
  const variants = extractVariants();
  const components = {};
  const missingDoc = [];
  let documented = 0;
  let total = 0;

  for (const [name, entry] of Object.entries(usage.components)) {
    let source = '';
    try {
      source = readFileSync(join(ROOT, entry.file), 'utf8');
    } catch {
      continue;
    }
    let ast;
    try {
      ast = parseSource(source);
    } catch {
      continue;
    }

    const found = findComponent(ast, name);
    if (!found) {
      components[name] = { file: entry.file, summary: '', props: [] };
      continue;
    }

    const anchor = { start: found.anchor ?? found.node.start };
    const doc = parseJsDoc(docCommentAbove(anchor, ast.comments || [], source));
    if (!doc.summary) doc.summary = lineCommentAbove(anchor, ast.comments || [], source);
    const declared = variants[name] || {};
    const props = [];

    for (const param of found.node.params) {
      const target = param.type === 'AssignmentPattern' ? param.left : param;
      if (target.type !== 'ObjectPattern') continue;
      for (const property of target.properties) {
        if (property.type !== 'ObjectProperty') continue;
        const propName = String(property.key.name ?? property.key.value);
        if (NOISE_PROPS.has(propName)) continue;
        const value = property.value;
        const description = doc.props[propName]?.description || trailingComment(source, property.end);
        const row = {
          name: propName,
          default: value.type === 'AssignmentPattern' ? defaultText(source, value.right) : '',
          type: doc.props[propName]?.type || '',
          values: declared[propName] || [],
          description,
        };
        props.push(row);
        total += 1;
        if (description) documented += 1;
      }
    }

    props.sort((a, b) => a.name.localeCompare(b.name));
    components[name] = { file: entry.file, summary: doc.summary, props };
    if (!doc.summary) missingDoc.push(name);
  }

  return {
    generatedBy: 'scripts/kit-props.mjs',
    contract: {
      derivation: 'Props are the component\'s own destructured parameters; defaults are its source text; declared values come from the variant manifest.',
      documentation: 'A description comes from JSDoc (@param props.name / @prop) or the trailing // comment beside the prop.',
    },
    totals: {
      components: Object.keys(components).length,
      props: total,
      documentedProps: documented,
      undocumentedProps: total - documented,
      componentsWithoutSummary: missingDoc.length,
    },
    componentsWithoutSummary: missingDoc.sort(),
    components,
  };
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join('/'));
if (isDirectRun) {
  const result = extractProps();
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  const { components, props, documentedProps, componentsWithoutSummary } = result.totals;
  console.log(
    `kit props: ${components} components, ${props} props — ${documentedProps} documented, `
    + `${componentsWithoutSummary} components without a summary`,
  );
}
