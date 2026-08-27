// scripts/kit-states.mjs — which states each kit component actually has.
//
// The catalogue photographs one thing per component: the resting state. That
// answers "what does this look like" and never "what does it look like when it
// is unavailable, busy, wrong, or handed four times the text it was drawn for" —
// which is where UI breaks in production. None of those were visible anywhere.
//
// The list is derived, never written down. A hand-kept list is exactly the
// failure the variant manifest already fixed once: the first hand-written
// version of that was wrong within minutes. A component has a state when its
// own implementation says so:
//
//   • disabled / loading / error — the component destructures the prop, or it
//     spreads its rest props onto a native control that owns `disabled` itself
//     (Input and Textarea never name the prop and support it completely).
//   • hover — a `hover:` utility in the component, or a `:hover` rule in
//     globals.css keyed on a class the component renders.
//   • focus — a `focus…:` utility, or a natively focusable element: globals.css
//     gives every button, link, tab and field one focus ring in one place.
//   • long-text — the component takes a text-bearing prop, so sooner or later
//     somebody hands it a sentence where a word was drawn.
//
// Read by /ui-kit → «Матриця станів», which renders the matrix from this file,
// and by tests/kit-states.test.mjs, which fails when a component grows a state
// the catalogue does not show.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { readShowcase } from './ui-kit-showcase.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLOBALS = join(ROOT, 'src', 'app', 'globals.css');
const USAGE = join(ROOT, 'src', 'app', 'ui-kit', 'kit-usage.generated.json');
const OUTPUT = join(ROOT, 'src', 'app', 'ui-kit', 'kit-states.generated.json');

// The order the matrix reads in: what the user does to the control, then what
// the application does to it, then what the data does to it.
export const STATE_ORDER = ['hover', 'focus', 'disabled', 'loading', 'error', 'long-text'];

// `uploading` is MarkdownEditor's word for the same state. A component may not
// invent a third one silently — a name outside this map is simply not a state,
// and the matrix says so by not showing one.
const STATE_PROPS = {
  disabled: ['disabled'],
  loading: ['loading', 'uploading'],
  error: ['error'],
};

// A prop that carries prose. `value` and `name` were in this set first and had
// to come out: they matched `Counter value={3}` and every `name` that is an
// identifier, which put components with nothing to overflow into the matrix.
// A field still earns the state through its rest spread — see below.
const TEXT_PROPS = new Set([
  'children', 'label', 'title', 'placeholder', 'description', 'subtitle',
  'text', 'content', 'message', 'hint', 'caption',
]);

// Elements the browser focuses on its own, and which the two `:focus-visible`
// rules in globals.css therefore already style.
const NATIVE_FOCUSABLE = new Set(['button', 'input', 'textarea', 'select', 'a']);
const NATIVE_DISABLEABLE = new Set(['button', 'input', 'textarea', 'select', 'fieldset']);

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'dynamicImport', 'topLevelAwait', 'importAttributes'],
  });
}

// Every destructured parameter name in the file, plus what its JSX does with a
// rest spread. Subcomponents count: a file is one component as far as the
// catalogue is concerned, and MarkdownEditor's toolbar button is as disabled as
// the editor around it.
function readComponentFile(source) {
  const props = new Set();
  const nativeElements = new Set();
  const spreadOnNative = new Set();
  let ast;
  try {
    ast = parseSource(source);
  } catch (error) {
    return { props, nativeElements, spreadOnNative, parseError: error.message };
  }

  const visit = node => {
    if (!node || typeof node !== 'object') return;
    const isFunction = node.type === 'FunctionDeclaration'
      || node.type === 'ArrowFunctionExpression'
      || node.type === 'FunctionExpression';
    if (isFunction) {
      for (const param of node.params || []) {
        const target = param.type === 'AssignmentPattern' ? param.left : param;
        if (target.type !== 'ObjectPattern') continue;
        for (const property of target.properties) {
          if (property.type === 'ObjectProperty') {
            props.add(String(property.key.name ?? property.key.value));
          }
        }
      }
    }
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier') {
      const tag = node.name.name;
      if (/^[a-z]/.test(tag)) {
        nativeElements.add(tag);
        if ((node.attributes || []).some(attribute => attribute.type === 'JSXSpreadAttribute')) {
          spreadOnNative.add(tag);
        }
      }
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && child.type) visit(child);
    }
  };
  visit(ast.program);
  return { props, nativeElements, spreadOnNative };
}

// Classes globals.css gives a `:hover` rule to. A component that renders one of
// them has hover styling it did not write itself, and the matrix must still
// show it — `.ui-surface[data-ui-surface='project-card']:hover` is a real hover
// state living entirely outside the component file.
let hoverClassCache = null;
function cssHoverClasses() {
  if (hoverClassCache) return hoverClassCache;
  const css = readFileSync(GLOBALS, 'utf8');
  const classes = new Set();
  for (const [selector] of css.matchAll(/^[^@{}\n]*:hover[^{}\n]*\{/gm)) {
    for (const [, name] of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) classes.add(name);
  }
  hoverClassCache = classes;
  return classes;
}

export function extractStates() {
  const usage = JSON.parse(readFileSync(USAGE, 'utf8'));
  const hoverClasses = cssHoverClasses();
  const components = {};
  const parseErrors = [];

  for (const [name, entry] of Object.entries(usage.components)) {
    let source = '';
    try {
      source = readFileSync(join(ROOT, entry.file), 'utf8');
    } catch {
      parseErrors.push({ component: name, reason: 'unreadable' });
      continue;
    }
    const { props, nativeElements, spreadOnNative, parseError } = readComponentFile(source);
    if (parseError) {
      parseErrors.push({ component: name, reason: parseError });
      continue;
    }

    const states = {};
    for (const [state, aliases] of Object.entries(STATE_PROPS)) {
      if (aliases.some(alias => props.has(alias))) states[state] = 'prop';
    }
    // A rest spread onto a native control hands it every attribute the caller
    // passes, `disabled` included — the component supports the state without
    // ever naming it.
    if (!states.disabled && [...spreadOnNative].some(tag => NATIVE_DISABLEABLE.has(tag))) {
      states.disabled = 'native';
    }

    if (/hover:/.test(source)) states.hover = 'own';
    else if ([...hoverClasses].some(name => source.includes(name))) states.hover = 'css';

    if (/focus(?:-visible|-within)?:/.test(source)) states.focus = 'own';
    else if ([...nativeElements].some(tag => NATIVE_FOCUSABLE.has(tag))) states.focus = 'global';

    const textProps = [...props].filter(prop => TEXT_PROPS.has(prop)).sort();
    if (textProps.length) states['long-text'] = textProps.join(', ');
    // A field never names `placeholder` or `value` — it forwards both through
    // its rest spread — and it is the control most likely to be handed more
    // text than it was drawn for.
    else if (spreadOnNative.has('input') || spreadOnNative.has('textarea')) states['long-text'] = 'value';

    components[name] = states;
  }

  const totals = { components: Object.keys(components).length, stateful: 0 };
  for (const state of STATE_ORDER) {
    totals[state] = Object.values(components).filter(states => states[state]).length;
  }
  totals.stateful = Object.values(components).filter(states => Object.keys(states).length > 0).length;

  return {
    generatedBy: 'scripts/kit-states.mjs',
    contract: {
      derivation: 'A state exists because the implementation declares it: a destructured prop, a rest spread onto a native control, a hover/focus utility, or a text-bearing prop.',
      shown: 'Every stateful component appears in /ui-kit → «Матриця станів»; ones that render standalone appear live, the rest point at the section that shows them.',
    },
    stateOrder: STATE_ORDER,
    totals,
    components,
    parseErrors,
  };
}

// Which story file each component is previewed in, so the matrix can point at a
// real section instead of carrying a hand-written "see also" that goes stale.
// Read out of the story sources rather than written down for the same reason
// everything else here is derived.
export function previewSections() {
  const { visibleStories } = readShowcase();
  const usage = JSON.parse(readFileSync(USAGE, 'utf8'));
  const sections = {};
  for (const name of Object.keys(usage.components)) {
    const ids = visibleStories
      .filter(story => new RegExp(`<${name}\\b`).test(story.source))
      .map(story => story.id);
    if (ids.length) sections[name] = ids;
  }

  // A component the catalogue only ever shows through a host has no `<Name` in
  // any story and would look uncovered here. Breadcrumb and HeaderSearch are
  // rendered by TopHeader on every screen, MessageBubble by ChatMessageList —
  // the section that shows the host is the section that shows them. Resolved in
  // a loop because a host can itself be an internal component.
  for (let pass = 0; pass < 4; pass += 1) {
    let resolved = 0;
    for (const [name, entry] of Object.entries(usage.components)) {
      if (sections[name]) continue;
      const viaHost = [...new Set(entry.usedByKit.flatMap(host => sections[host] || []))].sort();
      if (viaHost.length) {
        sections[name] = viaHost;
        resolved += 1;
      }
    }
    if (resolved === 0) break;
  }
  return sections;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join('/'));
if (isDirectRun) {
  const result = { ...extractStates(), previewSections: previewSections() };
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  const { totals } = result;
  console.log(
    `kit states: ${totals.stateful}/${totals.components} components with a state — `
    + STATE_ORDER.map(state => `${state} ${totals[state]}`).join(', '),
  );
}
