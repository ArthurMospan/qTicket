// Where the product uses a kit component, does it look like the preview?
//
// `kit:audit` asks whether the product takes a component from the kit at all.
// This asks the next question, and it is the one that was documented for months
// without ever being implemented: given that the product *does* import the
// component, is it rendered with values the kit declares, and does the
// catalogue actually show those values?
//
// A component can be imported everywhere, score green coverage, and still put
// something on screen that no preview in /ui-kit has ever displayed. That gap
// is what this report measures.
//
// Three of the numbers here are contract zeros, enforced by tests/kit-drift.test.mjs:
//   • undeclaredValues — a variant value the implementation does not declare
//   • unknownProps     — a variant-shaped prop the manifest does not know
//   • chromeOverrides  — a className that redefines the component's own geometry
//
// The fourth, `usedWithoutPreview`, is a live backlog rather than a zero: it is
// the list of variants the site ships and the catalogue never shows.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { extractVariants, variantNamespaces } from './kit-variants.mjs';
import { collectWorkspaceUiFiles, collectWorkspaceRouteMap } from './workspace-ui-files.mjs';
import { readShowcase } from './ui-kit-showcase.mjs';

const traverse = traverseModule.default || traverseModule;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'app', 'ui-kit', 'kit-drift.generated.json');

// Props that select a look. Anything else a component takes — onClick, icon,
// children, value — is behaviour, and behaviour is not a variant. Only names in
// this set are checked, so adding a callback can never trip the drift contract.
const VARIANT_PROP_NAMES = new Set([
  'align', 'appearance', 'bodyPadding', 'composition', 'context', 'density',
  'filterRole', 'gap', 'padding', 'preset', 'presentation', 'shape', 'size',
  'status', 'style', 'surface', 'titleContext', 'tone', 'variant', 'weight',
  // Skeleton's share-of-the-line. Safe as a variant name: the only other
  // `width=` in the workspace is next/image's, which is not a kit component.
  'width',
  // Which way a component lays itself out — Meter's reading above its bar or
  // beside it. Only kit imports are read here, so a `layout` on anything else
  // is invisible to this scan.
  'layout',
  // How much of a screen PageSkeleton stands in for.
  'region',
]);

// Positioning a component inside its parent is legitimate composition. Owning
// its height, radius, padding or type is not — that is a second copy of a kit
// decision, living at the call site where nothing can propagate to it.
//
// `min-h-0` and `max-h-full` are the flexbox escape hatches, not geometry: they
// let a child shrink inside its parent and set no size of their own. Only a
// concrete min/max height counts.
const CHROME_PATTERN =
  /(?:^|\s)!?(?:h-(?:\d|\[)|min-h-(?:\d*[1-9]\d*|\[|screen)|max-h-(?:\d*[1-9]\d*|\[|screen)|rounded|bg-|border(?:$|[\s-])|shadow|ring-|px-|py-|p-\[|text-\[|text-(?:xs|sm|base|lg|xl)\b|font-(?:medium|semibold|bold|black)|leading-)/;
const CHROME_ATTRIBUTES = [
  'className', 'buttonClassName', 'inputClassName', 'bodyClassName', 'contentClassName',
];

function toPosix(file) {
  return relative(ROOT, file).split(sep).join('/');
}

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'dynamicImport', 'topLevelAwait', 'importAttributes'],
  });
}

function jsxName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') return `${jsxName(node.object)}.${jsxName(node.property)}`;
  return '';
}

// Only a literal can be checked against the manifest. `size={isCompact ? …}`
// resolves at runtime, so both branches are read; anything else is skipped
// rather than guessed at, because a false positive here blocks a build.
function literalValues(node) {
  if (!node) return [];
  if (node.type === 'StringLiteral') return [node.value];
  if (node.type === 'JSXExpressionContainer') return literalValues(node.expression);
  if (node.type === 'ConditionalExpression') {
    return [...literalValues(node.consequent), ...literalValues(node.alternate)];
  }
  if (node.type === 'LogicalExpression') {
    return [...literalValues(node.left), ...literalValues(node.right)];
  }
  return [];
}

function kitImports(ast) {
  const bindings = new Map();
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (!String(statement.source.value).startsWith('@/components/ui')) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') {
        bindings.set(specifier.local.name, specifier.local.name);
      } else if (specifier.type === 'ImportSpecifier') {
        bindings.set(specifier.local.name, specifier.imported.name || specifier.imported.value);
      }
    }
  }
  return bindings;
}

// Which variant values the catalogue puts on screen.
//
// Two ways a value can be shown. A hand-written preview may render it, in which
// case the literal appears in the source — read loosely, because a preview may
// drive the value through a map (`composition={token}`), and being generous
// here under-reports the gap rather than inventing one.
//
// The second way is «Матриця варіантів», which renders one live example per
// declared value straight from the manifest. Any component listed in the page's
// `VARIANT_BASE` map is therefore previewed for *every* value it declares, and
// always will be — that is what makes "a variant cannot exist without a
// preview" structural instead of a rule somebody has to remember. Components
// that cannot stand alone (Dialog needs an open state, PageHeader a whole page)
// are not in that map and still owe their values a real preview.
function previewedValues(manifest) {
  const showcase = readShowcase();
  // A value can be shown by any story, so the search is over the whole
  // catalogue; the auto-rendering map lives with the matrix that reads it.
  const source = showcase.everything;
  const matrix = showcase.stories.find(story => story.id === 'variant-matrix')?.source ?? '';
  const baseMap = matrix.slice(
    matrix.indexOf('const VARIANT_BASE = {'),
    matrix.indexOf('const VARIANT_ELSEWHERE'),
  );
  const autoRendered = new Set(
    [...baseMap.matchAll(/^ {2}(\w+):\s*\(props\)/gm)].map(match => match[1]),
  );

  const shown = new Set();
  for (const [component, props] of Object.entries(manifest)) {
    for (const [prop, values] of Object.entries(props)) {
      for (const value of values) {
        if (autoRendered.has(component) || source.includes(`'${value}'`) || source.includes(`"${value}"`)) {
          shown.add(`${component}.${prop}.${value}`);
        }
      }
    }
  }
  return shown;
}

export function checkKitDrift() {
  const manifest = extractVariants();
  const namespaces = variantNamespaces();
  const routeMap = collectWorkspaceRouteMap();
  const files = collectWorkspaceUiFiles();

  const undeclaredValues = [];
  const unknownProps = [];
  const chromeOverrides = [];
  const usage = {};

  for (const file of files) {
    let ast;
    try {
      ast = parseSource(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const bindings = kitImports(ast);
    if (bindings.size === 0) continue;
    const routes = routeMap.fileRoutes[toPosix(file)] || [];

    traverse(ast, {
      JSXOpeningElement(path) {
        const component = bindings.get(jsxName(path.node.name));
        if (!component) return;
        const declared = manifest[component];
        const where = `${toPosix(file)}:${path.node.loc?.start?.line || 1}`;

        for (const attribute of path.node.attributes || []) {
          if (attribute.type !== 'JSXAttribute') continue;
          const prop = attribute.name.name;

          if (CHROME_ATTRIBUTES.includes(prop)) {
            for (const value of literalValues(attribute.value)) {
              if (CHROME_PATTERN.test(value)) {
                chromeOverrides.push({ component, attribute: prop, value, location: where, routes });
              }
            }
            continue;
          }

          if (!VARIANT_PROP_NAMES.has(prop)) continue;
          if (!declared) continue; // component declares no variants at all

          // Only a string literal selects a variant. `Popover gap={8}` and
          // `padding={spacing.lg}` share a name with FormGroup's and Surface's
          // variant props but carry open numeric values, so reading them as
          // undeclared variants was a false positive on a prop that is simply
          // a different kind of prop.
          const values = literalValues(attribute.value);
          if (values.length === 0) continue;

          if (!(prop in declared)) {
            unknownProps.push({ component, prop, values, location: where, routes });
            continue;
          }
          for (const value of values) {
            const key = `${component}.${prop}.${value}`;
            usage[key] = (usage[key] || 0) + 1;
            if (!declared[prop].includes(value)) {
              undeclaredValues.push({ component, prop, value, location: where, routes });
            }
          }
        }
      },
    });
  }

  // A second pass over the kit's own files, counting usage and nothing else.
  //
  // A variant a kit component ships on behalf of the product is shipped. The
  // first pass cannot see that: it walks the workspace graph with the shared UI
  // directory excluded, so `PageSkeleton` rendering thirteen `Skeleton` presets
  // across ten routes looked like thirteen variants nobody uses. The same
  // reasoning the contract already applies to whole components — TopHeader
  // renders Breadcrumb, so Breadcrumb is used — applied to their values.
  //
  // Usage only. `undeclaredValues`, `unknownProps` and `chromeOverrides` are
  // findings about call sites, and a kit component is not one.
  for (const file of collectWorkspaceUiFiles({ includeSharedUi: true })) {
    if (!toPosix(file).includes('src/components/ui/')) continue;
    let ast;
    try {
      ast = parseSource(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    // Inside the kit a sibling is reached relatively (`./Skeleton`), not through
    // the `@/components/ui` barrel, so the element name is the component name.
    traverse(ast, {
      JSXOpeningElement(path) {
        const component = jsxName(path.node.name);
        const declared = manifest[component];
        if (!declared) return;
        for (const attribute of path.node.attributes || []) {
          if (attribute.type !== 'JSXAttribute') continue;
          const prop = attribute.name.name;
          if (!VARIANT_PROP_NAMES.has(prop) || !(prop in declared)) continue;
          for (const value of literalValues(attribute.value)) {
            if (!declared[prop].includes(value)) continue;
            const key = `${component}.${prop}.${value}`;
            usage[key] = (usage[key] || 0) + 1;
          }
        }
      },
    });
  }

  const previewed = previewedValues(manifest);

  // Ownership of a shared CSS namespace is answered per namespace, not per
  // component: `.ui-control[data-ui-composition]` belongs to Button, IconAction
  // and Input at once, so a value one of them uses is not dead for the others.
  const namespaceUsage = new Map();
  for (const [component, props] of Object.entries(manifest)) {
    for (const [prop, values] of Object.entries(props)) {
      const namespace = namespaces[`${component}.${prop}`];
      if (!namespace) continue;
      for (const value of values) {
        const key = `${namespace}.${value}`;
        namespaceUsage.set(key, (namespaceUsage.get(key) || 0) + (usage[`${component}.${prop}.${value}`] || 0));
      }
    }
  }

  const usedWithoutPreview = [];
  const declaredUnused = [];
  let declaredValues = 0;
  let usedAndPreviewed = 0;

  for (const [component, props] of Object.entries(manifest)) {
    for (const [prop, values] of Object.entries(props)) {
      const namespace = namespaces[`${component}.${prop}`];
      for (const value of values) {
        declaredValues += 1;
        const key = `${component}.${prop}.${value}`;
        const count = usage[key] || 0;
        const sharedCount = namespace ? namespaceUsage.get(`${namespace}.${value}`) || 0 : count;
        if (count > 0 && previewed.has(key)) usedAndPreviewed += 1;
        else if (count > 0) usedWithoutPreview.push({ component, prop, value, count });
        else if (sharedCount === 0) declaredUnused.push({ component, prop, value, namespace: namespace || null });
      }
    }
  }

  const byCount = (a, b) => b.count - a.count
    || `${a.component}.${a.prop}.${a.value}`.localeCompare(`${b.component}.${b.prop}.${b.value}`);
  const byLocation = (a, b) => a.location.localeCompare(b.location);

  return {
    generatedBy: 'scripts/check-kit-drift.mjs',
    scope: 'authenticated-workspace',
    contract: {
      undeclaredValues: 'A variant value the implementation does not declare must not reach the product.',
      unknownProps: 'A variant-shaped prop the manifest does not know must not reach the product.',
      chromeOverrides: 'A kit component must not be handed a className that redefines its own geometry or typography.',
      usedWithoutPreview: 'Every variant the product ships should be visible somewhere in /ui-kit. Tracked against a baseline, not zero.',
    },
    totals: {
      componentsWithVariants: Object.keys(manifest).length,
      declaredValues,
      undeclaredValues: undeclaredValues.length,
      unknownProps: unknownProps.length,
      chromeOverrides: chromeOverrides.length,
      usedAndPreviewed,
      usedWithoutPreview: usedWithoutPreview.length,
      declaredUnused: declaredUnused.length,
    },
    undeclaredValues: [...undeclaredValues].sort(byLocation),
    unknownProps: [...unknownProps].sort(byLocation),
    chromeOverrides: [...chromeOverrides].sort(byLocation),
    usedWithoutPreview: [...usedWithoutPreview].sort(byCount),
    declaredUnused: [...declaredUnused].sort((a, b) =>
      `${a.component}.${a.prop}.${a.value}`.localeCompare(`${b.component}.${b.prop}.${b.value}`)),
    // Read by /ui-kit → «Матриця варіантів», which renders every declared value
    // and colours it by these two lookups.
    manifest,
    namespaces,
    usage,
    previewedValues: [...previewed].sort(),
  };
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join('/'));
if (isDirectRun) {
  const result = checkKitDrift();
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  const { undeclaredValues, unknownProps, chromeOverrides, usedWithoutPreview } = result.totals;
  console.log(
    `kit drift: ${undeclaredValues} undeclared values, ${unknownProps} unknown props, `
    + `${chromeOverrides} chrome overrides, ${usedWithoutPreview} variants without a preview `
    + `→ ${toPosix(OUTPUT)}`,
  );
}
