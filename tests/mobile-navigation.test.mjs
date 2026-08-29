import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the bar states its footprint once, and nothing reserves a strip for it', async () => {
  const css = await read('../src/app/globals.css');
  const layout = await read('../src/app/(app)/layout.js');
  const nav = await read('../src/components/MobileNav.jsx');

  // Geometry is declared once.
  assert.match(css, /--qt-nav-height: \d+px;/);
  assert.match(css, /--qt-nav-inset: max\(var\(--qt-nav-gap\), env\(safe-area-inset-bottom\)\);/);
  assert.match(css, /--qt-nav-space: calc\(var\(--qt-nav-height\) \+ var\(--qt-nav-inset\) \+ var\(--qt-nav-gap\)\);/);
  assert.match(nav, /bottom: 'var\(--qt-nav-inset\)'/);
  assert.match(nav, /height: 'var\(--qt-nav-height\)'/);

  // The shell reserves nothing. Below md it is white, so a reserved strip was a
  // dead band under the bar that no screen could paint into or scroll through.
  assert.doesNotMatch(layout, /pb-\[var\(--qt-nav-space\)\]/);
  assert.doesNotMatch(layout, /pb-\[calc\(56px/);
  assert.match(layout, /w-full p-0 md:p-\[12px\]/);
});

test('a screen ends its own scroller with the footprint the shell stopped reserving', async () => {
  const css = await read('../src/app/globals.css');

  // A tail, not a padding: these scrollers already carry paddings of their own
  // and one of them is handed a padding-bottom from JavaScript.
  assert.match(css, /\.qt-nav-scroll \{\s*\n\s*scroll-padding-bottom: var\(--qt-nav-space\);/);
  assert.match(css, /\.qt-nav-scroll::after \{[\s\S]*?height: var\(--qt-nav-space\);/);
  // An overlay covers the bar, so a shared view read inside a dialog adds none.
  assert.match(css, /\[role='dialog'\] \.qt-nav-scroll::after,\s*\n\s*\[data-ui-overlay\] \.qt-nav-scroll::after \{\s*\n\s*height: 0;/);
  // A screen that ends in a composer clears the bar with the dock instead.
  assert.match(css, /\.qt-nav-dock \{\s*\n\s*margin-bottom: var\(--qt-nav-space\);/);

  // Every screen that scrolls under the bar opts in, through the one class.
  const screens = [
    'src/app/(app)/page.js',
    'src/app/(app)/my/page.js',
    'src/app/(app)/settings/page.js',
    // `/errors` is not in this list any more and must not come back: it left
    // the workspace shell entirely, so there is no bar over it to clear. The
    // planning calendar, the sprint board and the whole `/analytics` tree are
    // gone for a different reason — they are deleted, not merely outside the
    // shell.
    'src/app/(app)/[projectId]/ProjectBoardClient.jsx',
    'src/components/workspace/AgileBoard.jsx',
    'src/components/ui/Navigation/MemberRail.jsx',
    'src/components/ui/Navigation/ChannelRail.jsx',
    'src/components/profile/ProfileView.jsx',
  ];
  for (const screen of screens) {
    assert.match(await read(`../${screen}`), /qt-nav-scroll/, `${screen} scrolls under the bar`);
  }
  assert.match(await read('../src/app/(app)/chat/page.js'), /className="qt-nav-dock"/);
});

test('the last of the page dissolves under the bar instead of stopping at it', async () => {
  const css = await read('../src/app/globals.css');
  const nav = await read('../src/components/MobileNav.jsx');

  assert.match(nav, /className=\{`qt-nav-veil transition-opacity/);
  // Full width: the bar is inset from both sides and the content beside it was
  // the sharpest edge of the lot.
  assert.match(css, /\.qt-nav-veil \{[\s\S]*?left: 0;[\s\S]*?right: 0;/);
  assert.match(css, /\.qt-nav-veil \{[\s\S]*?pointer-events: none;/);
  assert.match(css, /\.qt-nav-veil \{[\s\S]*?height: calc\(var\(--qt-nav-space\) \+ 16px\);/);
  // Behind the bar, never in front of it.
  assert.match(css, /\.qt-nav-veil \{[\s\S]*?z-index: 39;/);
  assert.match(nav, /className=\{`qt-nav-bar fixed z-40/);
});

test('the bar is glass, and falls back to paint where there is no blur', async () => {
  const css = await read('../src/app/globals.css');
  const nav = await read('../src/components/MobileNav.jsx');

  // As round as a capsule of that height can be.
  assert.match(css, /--qt-nav-radius: calc\(var\(--qt-nav-height\) \/ 2\);/);
  assert.match(css, /\.qt-nav-bar \{[\s\S]*?border-radius: var\(--qt-nav-radius\);/);
  assert.doesNotMatch(nav, /rounded-\[22px\]/);

  // Opaque first; the glass is added only where it can actually be seen.
  assert.match(css, /\.qt-nav-bar \{[\s\S]*?background-color: var\(--sb-bg\);/);
  assert.match(css, /@supports \(background-color: color-mix\(in srgb, red 50%, transparent\)\)[\s\S]*?backdrop-filter: blur\(20px\) saturate\(180%\)/);
  assert.match(css, /background-color: color-mix\(in srgb, var\(--sb-bg\) var\(--qt-nav-opacity, 88%\), transparent\)/);

  // The heavy drop shadow is gone; a light bar keeps a short dense one and a
  // firmer border, or it disappears into a white page.
  assert.doesNotMatch(nav, /shadow-\[0_8px_24px/);
  assert.match(css, /\.qt-nav-bar\[data-nav-tone='light'\] \{[\s\S]*?border-color: rgb\(31 31 31 \/ 14%\);/);
  assert.match(nav, /data-nav-tone=\{barTheme\.isDark \? 'dark' : 'light'\}/);

  // The opacity is the theme's answer, not a number typed into the CSS.
  assert.match(nav, /'--qt-nav-opacity': `\$\{barTheme\.opacity \* 100\}%`/);
  assert.match(nav, /computeTranslucentSidebarTheme\(theme\.bg, \{ opacity: NAV_OPACITY \}\)/);
});

test('the boot script can no longer paint over the glass', async () => {
  const root = await read('../src/app/layout.js');
  const sidebar = await read('../src/components/WorkspaceSidebar.jsx');
  const nav = await read('../src/components/MobileNav.jsx');

  // It writes variables. `background-color: <hex> !important` on [data-app-sb]
  // beat every translucent background the bar could ask for.
  assert.match(root, /var css='--sb-bg:'\+t\.bg\+' !important;'/);
  assert.doesNotMatch(root, /background-color:'\+t\.bg/);

  // Which means both surfaces have to paint themselves from the variable, or
  // the branded rail flashes dark for the few hundred ms before hydration.
  assert.match(sidebar, /backgroundColor: 'var\(--sb-bg\)'/);
  assert.match(sidebar, /'--sb-bg': theme\.bg/);
  assert.match(nav, /'--sb-bg': barTheme\.bg/);
});

test('every --qt-nav variable read in the stylesheet is one that exists', async () => {
  const css = await read('../src/app/globals.css');
  const nav = await read('../src/components/MobileNav.jsx');
  // Declared in the stylesheet, or published onto the element by the bar itself.
  const declared = new Set([
    ...[...css.matchAll(/(--qt-nav-[a-z-]+):/g)].map(match => match[1]),
    ...[...nav.matchAll(/'(--qt-nav-[a-z-]+)':/g)].map(match => match[1]),
  ]);
  const consumed = new Set([...css.matchAll(/var\((--qt-nav-[a-z-]+)/g)].map(match => match[1]));
  // `--qt-nav-bottom-height` was read by the mobile bulk-action bar and written
  // by nobody, so it had been silently falling back to a 64px guess — a fallback
  // is a default for a value somebody supplies, not a place for a typo to live.
  assert.deepEqual([...consumed].filter(name => !declared.has(name)), []);
  assert.match(css, /bottom: calc\(var\(--qt-nav-space\) \+ 16px\);/);
});

test('the bar floats with real corners instead of sitting on the viewport edge', async () => {
  const nav = await read('../src/components/MobileNav.jsx');
  assert.match(nav, /left: 'var\(--qt-nav-gap\)'/);
  assert.match(nav, /right: 'var\(--qt-nav-gap\)'/);
  // A bar welded to bottom-0 is the thing being replaced.
  assert.doesNotMatch(nav, /fixed bottom-0 left-0 right-0/);
  // The sheet matches the bar rather than going full-bleed under it.
  assert.match(nav, /rounded-\[24px\] max-h-\[78dvh\]/);
});

test('the page does not opt into viewport-fit=cover', async () => {
  // Deliberate. With the default fit the browser keeps the home indicator and
  // the gesture bar outside the layout viewport, so a fixed bar cannot end up
  // under them — the reason a bottom menu built this way never fights the
  // mobile browser chrome. Opting into cover moves that responsibility into
  // every env() call site.
  const layout = await read('../src/app/layout.js');
  // The property, not the word — the comment above it explains the choice.
  assert.doesNotMatch(layout, /^\s*viewportFit:/m);
  assert.match(layout, /export const viewport = \{/);
  assert.match(layout, /themeColor: '#f4f4f5'/);
  // Pinch-zoom must survive: the app has 10-11px type.
  assert.match(layout, /maximumScale: 5/);
  assert.doesNotMatch(layout, /userScalable: false/);
});

test('the keyboard is watched by the shell, and the bar reacts to it', async () => {
  const hook = await read('../src/lib/hooks/useKeyboardOpen.js');
  const layout = await read('../src/app/(app)/layout.js');
  const nav = await read('../src/components/MobileNav.jsx');
  const css = await read('../src/app/globals.css');

  assert.match(hook, /window\.visualViewport/);
  // Measured as a fraction of the viewport, so it holds on a phone and a tablet
  // and is not tripped by a collapsing URL bar.
  assert.match(hook, /KEYBOARD_FRACTION = 0\.3/);
  assert.match(hook, /document\.body\.dataset\.keyboard/);
  // And how much of the viewport it covers, which is what keeps a composer
  // above the keys on a platform that covers the layout viewport instead of
  // shortening it.
  assert.match(hook, /--qt-keyboard-inset/);
  assert.match(css, /height: calc\(100dvh - var\(--qt-keyboard-inset, 0px\)\)/);

  // The watching belongs to the shell, not to the bar. A task and an event
  // render no bar at all, and they are the two screens with the most typing on
  // them; while the hook lived in MobileNav those two went unmeasured.
  assert.match(layout, /const keyboardOpen = useKeyboardOpen\(\)/);
  assert.match(layout, /<MobileNav keyboardOpen=\{keyboardOpen\} \/>/);
  assert.doesNotMatch(nav, /useKeyboardOpen/);
  assert.match(nav, /keyboardOpen \? 'pointer-events-none translate-y-\[140%\] opacity-0'/);
  assert.match(nav, /aria-hidden=\{keyboardOpen\}/);
  // And the space it reserved collapses with it, so the composer gains the room.
  assert.match(css, /body\[data-keyboard='open'\] \{\s*\n\s*--qt-nav-space: 0px;/);
});

test('the active tab is announced, not only tinted', async () => {
  const nav = await read('../src/components/MobileNav.jsx');
  assert.match(nav, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(nav, /aria-expanded=\{moreOpen\}/);
  assert.match(nav, /aria-label="Основна навігація"/);
});

test('qTicket keeps internal chat out of navigation and guards its one subscription', async () => {
  const nav = await read('../src/components/MobileNav.jsx');
  const bridge = await read('../src/components/WorkspaceNotificationBridge.jsx');
  const title = await read('../src/components/WorkspaceDocumentTitle.jsx');

  // The bridge subscribes; everyone else reads the published number.
  assert.match(bridge, /useUnreadChatCount\(\{ enabled: internalViewer \}\)/);
  assert.match(bridge, /setUnreadChatCount\(displayedUnreadChats\)/);
  assert.doesNotMatch(nav, /useUnreadChatCount/);
  assert.doesNotMatch(title, /useUnreadChatCount/);
  assert.doesNotMatch(nav, /href: '\/chat'/);
  assert.doesNotMatch(nav, /s\.unreadChatCount/);
});

test('the app installs as an app rather than as a bookmark', async () => {
  const manifest = await read('../src/app/manifest.js');
  assert.match(manifest, /display: 'standalone'/);
  assert.match(manifest, /start_url: '\/'/);
  assert.match(manifest, /theme_color: '#f4f4f5'/);
  // A 32px favicon is not a home-screen icon.
  assert.match(manifest, /sizes: '436x436'/);
});
