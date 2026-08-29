import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  ROUTE_TITLES,
  decorateTitle,
  routeTitle,
  workspaceDocumentTitle,
} from '../src/lib/utils/documentTitle.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('every top-level workspace destination names itself in the tab', () => {
  assert.equal(routeTitle('/'), 'Огляд');
  assert.equal(routeTitle('/overview'), 'Огляд');
  assert.equal(routeTitle('/clients'), 'Клієнти');
  // Same words as the sidebar entry and the page heading.
  assert.equal(routeTitle('/my'), 'Звернення');
  assert.equal(routeTitle('/chat'), 'Чат');
  assert.equal(routeTitle('/team'), 'Команда');
  assert.equal(routeTitle('/settings'), 'Налаштування');
  // The planning calendar, the sprint board and the analytics tree are deleted,
  // so there is no screen for a title to name. These addresses redirect before
  // anything renders.
  assert.equal(routeTitle('/calendar'), 'Проєкт');
  assert.equal(routeTitle('/sprints'), 'Проєкт');
  assert.equal(routeTitle('/analytics'), 'Проєкт');
});

test('the external portal names the client experience instead of the staff overview', () => {
  assert.equal(routeTitle('/', [], { clientPortal: true }), 'Мої звернення');
  assert.equal(
    workspaceDocumentTitle({
      pathname: '/',
      organizationName: 'Acme Support',
      clientPortal: true,
    }),
    'Мої звернення · Acme Support',
  );
});

test('a project route is named by the project, not by its id', () => {
  const projects = [{ id: 'p1', name: 'Сайт RetroMagaz' }];
  assert.equal(routeTitle('/p1', projects), 'Сайт RetroMagaz');
  assert.equal(routeTitle('/p1/issue/i9', projects), 'Сайт RetroMagaz');
  // An id the workspace has not loaded yet still says something truthful.
  assert.equal(routeTitle('/unknown', projects), 'Проєкт');
});

test('a detail screen reuses the breadcrumb trail it already renders', () => {
  const title = workspaceDocumentTitle({
    pathname: '/p1/issue/i9',
    organizationName: 'Acme',
    breadcrumbs: [
      { label: 'Проєкти', href: '/' },
      { label: 'Сайт RetroMagaz', href: '/p1' },
      { label: 'QT-12' },
    ],
  });
  // Most specific first: browsers truncate a tab title from the right.
  assert.equal(title, 'QT-12 · Сайт RetroMagaz · Acme');
});

test('placeholder crumbs never reach the tab', () => {
  const title = workspaceDocumentTitle({
    pathname: '/p1/issue/i9',
    projects: [{ id: 'p1', name: 'Сайт' }],
    breadcrumbs: [{ label: 'Проєкти', href: '/' }, { label: '...' }, { label: '...' }],
  });
  assert.equal(title, 'Проєкти · qTicket');
});

test('the organization name replaces the brand rather than stacking on it', () => {
  assert.equal(
    workspaceDocumentTitle({ pathname: '/chat', organizationName: 'Acme' }),
    'Чат · Acme',
  );
  assert.equal(workspaceDocumentTitle({ pathname: '/chat' }), 'Чат · qTicket');
  // A screen already called after the organization is not repeated.
  assert.equal(
    workspaceDocumentTitle({ pathname: '/', organizationName: 'Огляд' }),
    'Огляд',
  );
});

test('the unread badge decorates the real title instead of replacing it', () => {
  assert.equal(decorateTitle('Чат · Acme', { unread: 0 }), 'Чат · Acme');
  assert.equal(decorateTitle('Чат · Acme', { unread: 3 }), '(3) Чат · Acme');
  assert.equal(
    decorateTitle('Чат · Acme', { unread: 3, alternate: true }),
    'Нове повідомлення · Чат · Acme',
  );
});

test('exactly one component writes document.title', async () => {
  const files = await readdir(new URL('../src/components/', import.meta.url), { recursive: true });
  const writers = [];
  for (const file of files) {
    if (!/\.jsx?$/.test(file)) continue;
    const source = await read(`../src/components/${file}`);
    if (/document\.title\s*=/.test(source)) writers.push(file);
  }
  assert.deepEqual(writers, ['WorkspaceDocumentTitle.jsx']);
});

test('an App Router head commit cannot replace the organization title after a switch', async () => {
  const owner = await read('../src/components/WorkspaceDocumentTitle.jsx');
  assert.match(owner, /new MutationObserver/);
  assert.match(owner, /headObserver\.observe\(document\.head/);
  assert.match(owner, /document\.title !== desiredTitle/);
  assert.match(owner, /headObserver\.disconnect\(\)/);
  assert.doesNotMatch(owner, /return \(\) => \{[\s\S]{0,240}document\.title = baseTitle/);
});

test('the root layout declares a title template and the app is not indexable', async () => {
  const layout = await read('../src/app/layout.js');
  assert.match(layout, /template: '%s · qTicket'/);
  assert.match(layout, /robots: \{ index: false, follow: false \}/);
  assert.match(layout, /manifest: '\/manifest\.webmanifest'/);
});

test('product fonts are self-hosted instead of blocking first paint on Google', async () => {
  const [layout, globals] = await Promise.all([
    read('../src/app/layout.js'),
    read('../src/app/globals.css'),
  ]);

  assert.match(layout, /from 'next\/font\/google'/);
  assert.match(layout, /Inter\(\{/);
  assert.match(layout, /Roboto_Condensed\(\{/);
  assert.doesNotMatch(globals, /fonts\.googleapis\.com/);
});

test('every unauthenticated screen carries its own metadata', async () => {
  for (const segment of ['login', 'onboarding', 'privacy-policy', 'ui-kit']) {
    const layout = await read(`../src/app/${segment}/layout.js`);
    assert.match(layout, /export const metadata = \{\s*\n\s*title: '.+'/, `${segment} has no title`);
  }
});

test('the route table stays ordered so "/" cannot swallow every path', () => {
  const root = ROUTE_TITLES.find(entry => entry.path === '/');
  assert.equal(root.exact, true);
  for (const entry of ROUTE_TITLES) {
    if (entry.path === '/') continue;
    assert.ok(entry.path.startsWith('/') && entry.path.length > 1);
  }
});
