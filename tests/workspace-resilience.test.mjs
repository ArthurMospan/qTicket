import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a route transition shows that something is happening', async () => {
  const loading = await read('../src/app/(app)/loading.js');
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /<LoadingSpinner size="md" \/>/);
  // And an announcement for anyone who cannot see it.
  assert.match(loading, /sr-only">Завантаження…/);
});

// Nine per-screen skeletons, each drawing the shape of the screen that was
// arriving, were meant to stop the layout jumping. They did the opposite: the
// placeholder's padding never matched the real screen closely enough, so the
// swap read as everything shifting at once. One loader replaces all of them.
test('the workspace has exactly one route loader and no page skeletons', async () => {
  const root = new URL('../src/app/(app)/', import.meta.url);

  const loaders = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) await walk(child);
      else if (entry.name === 'loading.js') loaders.push(child.pathname);
    }
  };
  await walk(root);

  assert.equal(loaders.length, 1, 'only (app)/loading.js may exist');
  assert.match(loaders[0], /\(app\)\/loading\.js$/);

  // A screen waiting on its own data uses the same spinner, not a portrait of
  // itself. `PageSkeleton` is gone; nothing may reach for it again.
  for (const path of ['../src/app/(app)/[projectId]/ProjectBoardClient.jsx', '../src/app/(app)/my/page.js', '../src/app/(app)/page.js']) {
    const source = await read(path);
    assert.doesNotMatch(source, /PageSkeleton/, `${path} must not use PageSkeleton`);
    assert.match(source, /<LoadingSpinner size="md"(?:\s+label="[^"]+")?\s*\/>/, `${path} must show the shared loader`);
  }

  // The sidebar keeps its skeleton: it waits on organisation data inside a
  // fixed frame, where the placeholder and the real rows do line up.
  const sidebar = await read('../src/components/WorkspaceSidebar.jsx');
  assert.match(sidebar, /<Skeleton preset="logo" tone="sidebar"/);
});

test('losing the connection is visible, persistently', async () => {
  const hook = await read('../src/lib/hooks/useOnlineStatus.js');
  assert.match(hook, /addEventListener\('offline', update\)/);
  assert.match(hook, /addEventListener\('online', update\)/);
  // Starts optimistic so the server render and the first client render agree.
  assert.match(hook, /useState\(true\)/);

  const banner = await read('../src/components/ui/Feedback/ConnectionBanner.jsx');
  assert.match(banner, /role="status"/);
  assert.match(banner, /aria-live="polite"/);
  assert.match(banner, /зміни зараз не зберігаються/);
  assert.doesNotMatch(banner, /Зміни збережуться, щойно зʼявиться інтернет/);
  // Always mounted, so the change is announced rather than merely rendered.
  assert.doesNotMatch(banner, /if \(!offline\) return null/);

  const layout = await read('../src/app/(app)/layout.js');
  assert.match(layout, /<ConnectionBanner offline=\{!online\} \/>/);
});

test('failed drag writes explain that the optimistic move did not persist', async () => {
  const clientWorkspace = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  const myTasks = await read('../src/app/(app)/my/page.js');

  // The customer workspace drags for support and refuses to for the client:
  // one board, and the role decides whether there is a hand on it.
  assert.match(clientWorkspace, /onMoveIssue=\{clientViewer \? undefined : handleMoveIssue\}/);
  assert.match(clientWorkspace, /readOnly=\{clientViewer\}/);
  assert.match(myTasks, /зміни не збережено/);
});

test('the keyboard reaches the content without walking the sidebar', async () => {
  const layout = await read('../src/app/(app)/layout.js');
  assert.match(layout, /href="#qt-main"/);
  assert.match(layout, /Перейти до вмісту/);
  // The target has to be focusable for the jump to move focus, not just scroll.
  assert.match(layout, /<main id="qt-main" tabIndex=\{-1\}/);
});

test('focus is visible by default rather than per component', async () => {
  const [css, button] = await Promise.all([
    read('../src/app/globals.css'),
    read('../src/components/ui/Button.jsx'),
  ]);
  assert.match(css, /:focus-visible \{\s*\n\s*outline: 2px solid var\(--color-ink\);/);
  // The dark sidebar and bottom bar need their own colour or the ring vanishes.
  assert.match(css, /\[data-app-sb\] :where\(a, button, \[tabindex\]\):focus-visible \{\s*\n\s*outline-color/);
  // The skip link is only visible while focused.
  assert.match(css, /\.qt-skip-link \{[\s\S]*?transform: translateY\(-200%\);/);
  assert.match(css, /\.qt-skip-link:focus-visible \{\s*\n\s*transform: translateY\(0\);/);
  assert.doesNotMatch(button, /focus:outline-none/);
  assert.doesNotMatch(
    css,
    /:where\(input, textarea, select, \[contenteditable='true'\]\):focus-visible\s*\{\s*outline: none/,
  );
});

test('a materialisation larger than one Firestore batch still commits', async () => {
  const source = await read('../src/lib/server/notificationOutbox.js');
  assert.match(source, /const BATCH_LIMIT = 400;/);
  assert.match(source, /await commitInChunks\(db, writes\)/);
  // The 500-write ceiling is a hard Firestore limit, and the first pass after a
  // quiet period is exactly when there are most of them.
  assert.match(source, /index \+= BATCH_LIMIT/);
});

// A tab that opens behind the current one, or comes back with a restored
// session, boots with `document.visibilityState === 'hidden'`. firebase-auth's
// IndexedDB persistence refuses to open in that state — «Database is
// closing/hidden» — and the refusal lands inside the SDK's own
// `initializeCurrentUser()`, which does not catch it. The initialization
// promise rejects, `onAuthStateChanged` hangs off it with no rejection handler
// and is never called, `authStateReady()` never settles, and the workspace sat
// on a spinner until its stall timer gave up and announced an outage. Only a
// reload repaired it, so the fault looked random and self-healing.
test('a tab that boots hidden still finds its signed-in session', async () => {
  const firebase = await read('../src/lib/firebase.js');

  // localStorage first: synchronous, no lifecycle of its own, never «hiding».
  // IndexedDB stays behind it only so a session written there by an earlier
  // build is migrated across on the next load.
  assert.match(
    firebase,
    /const AUTH_PERSISTENCE = \[\s*browserLocalPersistence,\s*indexedDBLocalPersistence,\s*browserSessionPersistence,\s*\];/,
  );
  assert.match(firebase, /initializeAuth\(app, \{\s*\n\s*persistence: AUTH_PERSISTENCE,/);
  // `getAuth()` carries the popup resolver; `initializeAuth()` does not, and
  // without it every `signInWithPopup(auth, provider)` in the product throws.
  assert.match(firebase, /popupRedirectResolver: browserPopupRedirectResolver,/);
  // The browser instance must never fall back to the SDK's own hierarchy.
  assert.match(firebase, /^export const auth = createAuth\(\);$/m);
  assert.doesNotMatch(firebase, /^export const auth = getAuth\(app\);$/m);
});
