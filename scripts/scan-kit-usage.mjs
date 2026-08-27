#!/usr/bin/env node
// Scans the codebase for real usage of every UI-kit component and writes the
// result to src/app/ui-kit/kit-usage.generated.json.
//
// Why this exists: /ui-kit is hand-written, so it had no way of knowing what
// the product actually uses. It showcased nine components with zero usages
// alongside ones used in dozens of places, with nothing telling them apart —
// which is what made the kit read as "not matching the site".
//
// Usage requires both an import binding and a JSX render of that binding.
// Counting imports alone leaves stale imports looking like live product UI;
// counting bare names produces nonsense ("Stat" matches "Status", "Grid"
// matches every `grid` class).
//
// Run `npm run kit:scan` after adding or removing a kit import.
// tests/kit-usage.test.mjs fails if the committed JSON is out of date.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { collectWorkspaceUiFiles, collectWorkspaceRouteMap } from './workspace-ui-files.mjs';
import { extractVariants } from './kit-variants.mjs';
import { readShowcase } from './ui-kit-showcase.mjs';

const traverse = traverseModule.default || traverseModule;

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'dynamicImport', 'topLevelAwait', 'importAttributes'],
  });
}

// ── Per-variant usage ───────────────────────────────────────────────────────
// The component-level count says Pill is used 51 times; it does not say that
// `size="sm"` accounts for 16 of those and `size="day-wide"` for exactly one.
// Only the second number tells you whether a variant is a real design decision
// or a one-off that should be folded into its neighbour — which is the question
// the catalogue has to answer to stay small.
function literalValue(node) {
  if (!node) return null;
  if (node.type === 'JSXExpressionContainer') return literalValue(node.expression);
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'NumericLiteral') return String(node.value);
  if (node.type === 'BooleanLiteral') return String(node.value);
  return null;
}

function scanVariantUsage(files, manifest, routeMap) {
  const usage = {};
  for (const [component, props] of Object.entries(manifest)) {
    usage[component] = {};
    for (const prop of Object.keys(props)) usage[component][prop] = {};
  }

  for (const file of files) {
    let ast;
    try {
      ast = parseSource(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const posix = toPosix(file);
    const routes = routeMap.fileRoutes[posix] || [];
    traverse(ast, {
      JSXOpeningElement(path) {
        if (path.node.name.type !== 'JSXIdentifier') return;
        const component = path.node.name.name;
        const tracked = usage[component];
        if (!tracked) return;

        const given = {};
        for (const attribute of path.node.attributes) {
          if (attribute.type !== 'JSXAttribute') continue;
          if (!(attribute.name.name in tracked)) continue;
          const value = literalValue(attribute.value);
          if (value !== null) given[attribute.name.name] = value;
        }

        for (const prop of Object.keys(tracked)) {
          // An omitted prop still renders something: the component default.
          // Counting it keeps the default honest about how dominant it is.
          const value = given[prop] ?? '(default)';
          const bucket = tracked[prop][value] || { count: 0, routes: [], files: [] };
          bucket.count += 1;
          for (const route of routes) if (!bucket.routes.includes(route)) bucket.routes.push(route);
          const line = path.node.loc?.start.line ?? 0;
          bucket.files.push(`${posix}:${line}`);
          tracked[prop][value] = bucket;
        }
      },
    });
  }

  for (const props of Object.values(usage)) {
    for (const values of Object.values(props)) {
      for (const bucket of Object.values(values)) {
        bucket.routes.sort();
        bucket.files.sort();
      }
    }
  }
  return usage;
}

// ── Preview source ──────────────────────────────────────────────────────────
// Extracted from page.js rather than written next to each preview: a hand-copied
// snippet is a second copy of the same JSX, free to fall out of step with the
// preview it claims to describe.
function extractPreviewCode(showcaseSource) {
  const previews = {};
  let ast;
  try {
    ast = parseSource(showcaseSource);
  } catch {
    return previews;
  }
  traverse(ast, {
    JSXElement(path) {
      const opening = path.node.openingElement;
      if (opening.name.type !== 'JSXIdentifier' || opening.name.name !== 'PreviewBlock') return;
      const titleAttribute = opening.attributes.find(
        attribute => attribute.type === 'JSXAttribute' && attribute.name.name === 'title',
      );
      const title = literalValue(titleAttribute?.value);
      if (!title) return;
      const children = path.node.children.filter(
        child => !(child.type === 'JSXText' && child.value.trim() === ''),
      );
      if (children.length === 0) return;
      const from = children[0].start;
      const to = children[children.length - 1].end;
      const raw = showcaseSource.slice(from, to).replace(/\r\n/g, '\n');
      // Strip the common indent so the snippet reads as standalone code.
      const lines = raw.split('\n');
      const indents = lines.slice(1).filter(line => line.trim()).map(line => line.match(/^ */)[0].length);
      const shift = indents.length ? Math.min(...indents) : 0;
      previews[title] = lines
        .map((line, index) => (index === 0 ? line : line.slice(shift)))
        .join('\n')
        .trimEnd();
    },
  });
  return previews;
}

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KIT_DIR = join(ROOT, 'src', 'components', 'ui');
const OUTPUT = join(ROOT, 'src', 'app', 'ui-kit', 'kit-usage.generated.json');

// The kit itself and the showcase page are excluded: a component being demoed
// on /ui-kit is not the same as the product using it.
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const toPosix = path => relative(ROOT, path).split(sep).join('/');

// ── Inventory: what the kit actually exports ────────────────────────────────
// The filename is the canonical component name; named exports (MultiSelect in
// Select.jsx, HeaderSearch in Forms/HeaderSearch.jsx) are picked up too.
// A file whose whole body is `import X from '…'; export default X` declares no
// component — it renames one. Counting the filename as an inventory entry
// invented `TaskCard`, a second name for the live `IssueCard`, which then sat
// in the unused list forever: it could never be "used", because every call site
// legitimately imports the real component instead.
function reexportedName(source) {
  const body = source
    .replace(/^['"]use client['"];?\s*$/gm, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  const match = body.match(
    /^import\s+([A-Z]\w*)\s+from\s+'([^']+)';?\s*export\s+default\s+\1;?$/,
  );
  if (!match) return null;
  return match[2].startsWith('@/components/ui') ? null : match[1];
}

function buildInventory() {
  const inventory = new Map();
  for (const file of walk(KIT_DIR)) {
    const name = file.split(sep).at(-1).replace(/\.jsx?$/, '');
    if (name === 'index') continue;
    const source = readFileSync(file, 'utf8');
    if (reexportedName(source)) continue;
    const names = new Set([name]);
    for (const match of source.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z]\w*)/g)) {
      // PascalCase only. Components now export their variant lookup maps
      // (SIZES, AVATAR_SIZES…) so the manifest can be derived from them, and a
      // SCREAMING_SNAKE_CASE constant is not a component to be showcased.
      const name = match[1];
      if (name === name.toUpperCase() && name.length > 1) continue;
      names.add(name);
    }
    for (const exported of names) {
      if (!inventory.has(exported)) inventory.set(exported, { file: toPosix(file), usedIn: [] });
    }
  }
  return inventory;
}

// ── Usage: who imports from @/components/ui ─────────────────────────────────
// Anchored at the start of a line and forbidden from crossing a `;`, so the
// clause cannot swallow preceding import statements. A [\s\S]*? here matches
// across newlines AND across statements: the capture then starts at the file's
// first import and runs to the first kit import, and every name in between is
// lost. `[^;]` still spans newlines, so multi-line named imports keep working.
const IMPORT_RE = /^import\s+([^;]*?)\s+from\s+['"](@\/components\/ui[^'"]*)['"]/gm;

// `specifier` is the module path, which is what makes a renamed default import
// resolvable. `import UiToast from '@/components/ui/Feedback/Toast'` binds the
// local name `UiToast`, and matching on that alone found no `Toast` in the
// inventory — so WorkspaceToastHost, which renders it on every screen, reported
// `Toast` as an unused component. A default export has no name of its own to
// compare; the file it comes from is the name.
function importedBindings(clause, specifier = '') {
  const bindings = [];
  const braced = clause.match(/\{([\s\S]*)\}/);
  if (braced) {
    for (const part of braced[1].split(',')) {
      const [exportedPart, localPart] = part.split(/\bas\b/).map(value => value.trim());
      if (/^[A-Z]\w*$/.test(exportedPart)) {
        bindings.push({ exported: exportedPart, local: localPart || exportedPart });
      }
    }
  }
  const leading = clause.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
  if (/^[A-Z]\w*$/.test(leading)) {
    const fromFile = specifier.split('/').at(-1).replace(/\.jsx?$/, '');
    const exported = /^[A-Z]\w*$/.test(fromFile) ? fromFile : leading;
    bindings.push({ exported, local: leading });
  }
  return bindings;
}

export function scanKitUsage() {
  const inventory = buildInventory();
  const showcased = new Set();

  const workspaceFiles = collectWorkspaceUiFiles();

  // One story file per navigable section, each with its own imports. Coverage
  // is decided inside a single file now: imported here and rendered here. The
  // old whole-page scan could pair an import at the top of a 3300-line file
  // with a `<Name` anywhere below it, in a different section entirely.
  const showcase = readShowcase();

  for (const story of showcase.visibleStories) {
    for (const match of story.source.matchAll(IMPORT_RE)) {
      for (const { exported: name, local } of importedBindings(match[1], match[2])) {
        if (!inventory.has(name)) continue;
        // An import alone is not a showcase. Requiring a JSX render prevents a
        // stale import or a story nobody navigates to from making coverage green.
        if (new RegExp(`<${local}\\b`).test(story.source)) showcased.add(name);
      }
    }
  }

  for (const file of workspaceFiles) {
    const source = readFileSync(file, 'utf8');
    const seen = new Set();
    for (const match of source.matchAll(IMPORT_RE)) {
      for (const { exported: name, local } of importedBindings(match[1], match[2])) {
        if (inventory.has(name) && new RegExp(`<${local}\\b`).test(source)) seen.add(name);
      }
    }
    for (const name of seen) inventory.get(name).usedIn.push(toPosix(file));
  }

  // A component the product reaches *through* another component is used, and
  // the workspace scan cannot see it: it deliberately stops at the kit boundary
  // (`includeSharedUi: false`), so `TopHeader` renders `Breadcrumb` and
  // `HeaderSearch` on every screen while both reported zero usages. Relative
  // imports are followed too — inside the kit that is how components refer to
  // each other (`'../Forms/HeaderSearch'`, never the `@/` alias).
  const INTERNAL_IMPORT_RE = /^import\s+([^;]*?)\s+from\s+['"]((?:@\/components\/ui|\.{1,2}\/)[^'"]*)['"]/gm;
  const usedByKit = new Map();
  for (const file of walk(KIT_DIR)) {
    const source = readFileSync(file, 'utf8');
    const host = file.split(sep).at(-1).replace(/\.jsx?$/, '');
    for (const match of source.matchAll(INTERNAL_IMPORT_RE)) {
      for (const { exported: name, local } of importedBindings(match[1], match[2])) {
        if (!inventory.has(name) || name === host) continue;
        if (!new RegExp(`<${local}\\b`).test(source)) continue;
        if (!usedByKit.has(name)) usedByKit.set(name, new Set());
        usedByKit.get(name).add(host);
      }
    }
  }

  // A file path answers "where is this imported"; a route answers "which screen
  // shows it". Only the second one is a question anybody actually asks about a
  // component, so both are recorded and the reverse index is built from them.
  const routeMap = collectWorkspaceRouteMap();

  const components = {};
  for (const name of [...inventory.keys()].sort()) {
    const entry = inventory.get(name);
    const routes = [...new Set(entry.usedIn.flatMap(file => routeMap.fileRoutes[file] || []))].sort();
    components[name] = {
      file: entry.file,
      count: entry.usedIn.length,
      showcased: showcased.has(name),

      // Which other kit components render this one. A non-empty list means the
      // product reaches it indirectly, so a zero `count` is not dead code.
      usedByKit: [...(usedByKit.get(name) || [])].sort(),
      routes,
      usedIn: entry.usedIn.sort(),
    };
  }

  const routes = {};
  for (const route of Object.keys(routeMap.routes).sort()) {
    routes[route] = Object.entries(components)
      .filter(([, entry]) => entry.routes.includes(route))
      .map(([name]) => name)
      .sort();
  }

  const manifest = extractVariants();
  const variants = scanVariantUsage(workspaceFiles, manifest, routeMap);
  const previews = {};
  for (const story of showcase.visibleStories) Object.assign(previews, extractPreviewCode(story.source));

  // "Used" means the product reaches it — directly from a workspace file, or
  // through another kit component that a workspace file reaches.
  const isLive = entry => entry.count > 0 || entry.usedByKit.length > 0;
  // Coverage is owed by what the product calls directly. A component reached
  // only through another kit component is previewed by its host: Breadcrumb and
  // HeaderSearch appear in every TopHeader preview, and giving each a preview
  // of its own would show a part in isolation the product never uses that way.
  const owesPreview = entry => entry.count > 0;
  const used = Object.values(components).filter(isLive).length;
  const covered = Object.values(components).filter(entry => owesPreview(entry) && entry.showcased).length;
  return {
    // Regenerate with `npm run kit:scan`; tests/kit-usage.test.mjs enforces it.
    generatedBy: 'scripts/scan-kit-usage.mjs',
    scope: 'authenticated-workspace',
    totals: {
      components: Object.keys(components).length,
      used,
      unused: Object.keys(components).length - used,
      covered,
      uncovered: Object.values(components).filter(entry => owesPreview(entry) && !entry.showcased).length,
      routes: Object.keys(routes).length,
      previews: Object.keys(previews).length,
      // Reached only through another kit component — live, but with no preview
      // obligation of its own beyond the host that renders it.
      internal: Object.values(components).filter(entry => entry.count === 0 && entry.usedByKit.length > 0).length,
      // Nothing reaches it at all. The contract is that this stays zero: an
      // unused component is deleted, not left in the barrel for later.
      unlisted: Object.values(components).filter(entry => !isLive(entry)).length,
    },
    routes,
    components,
    variants,
    previews,
  };
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join('/'));
if (isDirectRun) {
  const result = scanKitUsage();
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  const { components, used, unused } = result.totals;
  console.log(`kit usage: ${components} components — ${used} used, ${unused} unused → ${toPosix(OUTPUT)}`);
}
