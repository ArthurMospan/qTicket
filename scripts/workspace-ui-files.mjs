import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE_APP_ROOT = join(ROOT, 'src', 'app', '(app)');
const SHARED_UI_ROOT = join(ROOT, 'src', 'components', 'ui');
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs'];

function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) files.push(...walk(path));
    else if (SOURCE_EXTENSIONS.includes(extname(path))) files.push(path);
  }
  return files;
}

function resolveSourceFile(candidate) {
  const normalized = normalize(candidate);
  const candidates = [
    // Only when the specifier already names a source file. An exact path was
    // accepted whatever its extension, so `import pkg from '../package.json'`
    // resolved to package.json and the graph walker then handed it to a
    // JavaScript parser, which died on the first colon.
    ...(SOURCE_EXTENSIONS.includes(extname(normalized)) ? [normalized] : []),
    ...SOURCE_EXTENSIONS.map(extension => `${normalized}${extension}`),
    ...SOURCE_EXTENSIONS.map(extension => join(normalized, `index${extension}`)),
  ];
  return candidates.find(path => existsSync(path) && statSync(path).isFile()) || null;
}

function resolveLocalImport(fromFile, specifier) {
  if (specifier.startsWith('@/')) {
    return resolveSourceFile(join(ROOT, 'src', specifier.slice(2)));
  }
  if (specifier.startsWith('.')) {
    return resolveSourceFile(resolve(dirname(fromFile), specifier));
  }
  return null;
}

function isInside(path, directory) {
  const prefix = directory.endsWith(sep) ? directory : `${directory}${sep}`;
  return path === directory || path.startsWith(prefix);
}

function localSpecifiers(source) {
  const ast = parse(source, {
    sourceType: 'unambiguous',
    plugins: [
      'jsx',
      'typescript',
      'decorators-legacy',
      'classProperties',
      'dynamicImport',
      'topLevelAwait',
      'importAttributes',
    ],
  });
  const specifiers = [];
  for (const statement of ast.program.body) {
    if (
      statement.type === 'ImportDeclaration'
      || statement.type === 'ExportNamedDeclaration'
      || statement.type === 'ExportAllDeclaration'
    ) {
      if (statement.source?.value) specifiers.push(statement.source.value);
    }
  }
  return specifiers;
}

/**
 * Returns the local source graph reachable from authenticated App Router
 * routes. Public, auth, onboarding and showcase-only files are intentionally
 * absent unless an authenticated workspace route imports them.
 */
export function collectWorkspaceUiFiles({ includeSharedUi = false } = {}) {
  const roots = walk(WORKSPACE_APP_ROOT);
  const queued = [...roots];
  const seen = new Set();

  while (queued.length > 0) {
    const file = queued.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(file, 'utf8');
    for (const specifier of localSpecifiers(source)) {
      const imported = resolveLocalImport(file, specifier);
      if (!imported) continue;
      if (!includeSharedUi && isInside(imported, SHARED_UI_ROOT)) continue;
      if (!seen.has(imported)) queued.push(imported);
    }
  }

  return [...seen].sort();
}

// ── Route provenance ────────────────────────────────────────────────────────
// collectWorkspaceUiFiles answers "is this file part of the workspace?" but not
// "which screen does the user see it on?", so a drift finding could only ever
// name a file path. Walking the same graph once per route root records who
// reaches what, which is what lets the kit report a screen instead.

function routeNameFor(pageFile) {
  const relativeDir = relative(WORKSPACE_APP_ROOT, dirname(pageFile));
  const segments = relativeDir
    .split(sep)
    .filter(segment => segment && !segment.startsWith('(')); // (app), (marketing) are grouping-only
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function reachableFrom(entryFile, { includeSharedUi }) {
  const queued = [entryFile];
  const seen = new Set();
  while (queued.length > 0) {
    const file = queued.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const specifier of localSpecifiers(source)) {
      const imported = resolveLocalImport(file, specifier);
      if (!imported) continue;
      if (!includeSharedUi && isInside(imported, SHARED_UI_ROOT)) continue;
      if (!seen.has(imported)) queued.push(imported);
    }
  }
  return seen;
}

/**
 * Maps every authenticated workspace route to the files it reaches, and every
 * file back to the routes that reach it. A file shared by several screens
 * legitimately lists all of them — that breadth is the point, since it is what
 * makes a drift finding's blast radius visible.
 */
export function collectWorkspaceRouteMap({ includeSharedUi = true } = {}) {
  const pageFiles = walk(WORKSPACE_APP_ROOT).filter(file =>
    /^page\.(js|jsx|ts|tsx)$/.test(file.split(sep).at(-1)),
  );

  const routeToFiles = new Map();
  const fileToRoutes = new Map();

  for (const pageFile of pageFiles) {
    const route = routeNameFor(pageFile);
    const reached = reachableFrom(pageFile, { includeSharedUi });
    const bucket = routeToFiles.get(route) || new Set();
    for (const file of reached) {
      bucket.add(file);
      const routes = fileToRoutes.get(file) || new Set();
      routes.add(route);
      fileToRoutes.set(file, routes);
    }
    routeToFiles.set(route, bucket);
  }

  const toSortedPosix = files =>
    [...files].map(file => relative(ROOT, file).split(sep).join('/')).sort();

  return {
    routes: Object.fromEntries(
      [...routeToFiles.keys()].sort().map(route => [route, toSortedPosix(routeToFiles.get(route))]),
    ),
    fileRoutes: Object.fromEntries(
      [...fileToRoutes.keys()]
        .map(file => [relative(ROOT, file).split(sep).join('/'), [...fileToRoutes.get(file)].sort()])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
  };
}

export const workspacePaths = {
  root: ROOT,
  appRoot: WORKSPACE_APP_ROOT,
  sharedUiRoot: SHARED_UI_ROOT,
};
