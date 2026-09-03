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

test('the JS half of the md gate is the same query as the CSS half', async () => {
  const hook = await read('../src/lib/hooks/useIsMobile.js');
  const layout = await read('../src/app/(app)/layout.js');

  // `(width < 48rem)` is character for character what Tailwind 4.3 compiles
  // `max-md:` into, and the exact complement of what it compiles `md:` into.
  // `(max-width: 767px)` is a different query at 767.5px — ordinary under browser
  // zoom or a fractional device pixel ratio — and the shell is where the two
  // spellings cost the most: the rail is mounted on `isMobile === false` and then
  // hidden by its own `hidden md:flex`, the bar is mounted on `isMobile === true`
  // inside a `md:hidden`, so in that band the workspace had no navigation at all.
  assert.match(hook, /matchMedia\('\(width < 48rem\)'\)/);
  assert.doesNotMatch(hook, /matchMedia\('\(max-width: 767px\)'\)/);
  assert.match(layout, /isMobile === false && \(\s*\n\s*<div className="print:hidden shrink-0 h-full hidden md:flex/);
  assert.match(layout, /isMobile === true && !isFocusedRoute && \(\s*\n\s*<div className="print:hidden md:hidden"/);
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
    // planning calendar, the sprint board, the whole `/analytics` tree and the
    // workspace messenger are gone for a different reason — they are deleted,
    // not merely outside the shell.
    'src/app/(app)/[projectId]/ProjectBoardClient.jsx',
    'src/components/workspace/AgileBoard.jsx',
    'src/components/ui/Navigation/MemberRail.jsx',
    // Below md the settings rail *is* the screen and is the element that
    // scrolls — `SidebarLayout` locks the pane's height — so its last entry was
    // the one sitting under the glass.
    'src/components/ui/Navigation/InnerNavigation.jsx',
    'src/components/profile/ProfileView.jsx',
  ];
  for (const screen of screens) {
    assert.match(await read(`../${screen}`), /qt-nav-scroll/, `${screen} scrolls under the bar`);
  }

  // The tail belongs to whichever box scrolls vertically. A board with one
  // swimlane scrolls inside each column; with several the columns grow and the
  // outer box is the scroller, and there the tail was on neither.
  const board = await read('../src/components/workspace/AgileBoard.jsx');
  assert.match(board, /swimlanes\.length === 1 \? 'overflow-y-hidden pb-2 flex flex-col' : 'qt-nav-scroll pb-6'/);
  assert.match(board, /swimlanes\.length === 1 \? 'qt-nav-scroll rounded-b-\[16px\] overflow-y-auto' : 'rounded-\[12px\]'/);

  // And the gate is spelled the way Tailwind emits `max-md:`, so it is the exact
  // complement of the `md:hidden` the shell wraps the bar in. `(max-width: 767px)`
  // is a different query at 767.5px, and there the bar is drawn while no scroller
  // reserves its footprint.
  assert.match(css, /@media \(width < 48rem\) \{\s*\n\s*\/\* What a screen does instead/);
  assert.match(css, /@media \(width < 48rem\) \{\s*\n\s*\.ui-toast-layer \{/);
});

// The bar and the rail are two navigations of one product, so they answer the
// same questions the same way: where the front screen is, and how many names a
// destination gets.
test('the bar offers a client the same destinations the rail does', async () => {
  const nav = await read('../src/components/MobileNav.jsx');
  const sidebar = await read('../src/components/WorkspaceSidebar.jsx');

  const clientTabs = nav.slice(nav.indexOf('const visibleTabs = clientViewer'), nav.indexOf(': TABS;'));
  // The same names, not merely the same destinations. The bar said «Звернення»
  // with a `Folder` — the mark this product gives a project — while the rail
  // two hundred pixels wider said «Мої звернення» with the record's own icon:
  // one product, one record, two navigations disagreeing about both.
  assert.deepEqual(
    [...clientTabs.matchAll(/label: '([^']+)'/g)].map(match => match[1]),
    ['Огляд', 'Мої звернення', 'Проєкти'],
  );
  assert.match(clientTabs, /icon: TaskIcon, label: 'Мої звернення'/);
  assert.match(sidebar, /icon: TaskIcon, label: 'Мої звернення'/);
  // And the entry changes where it cannot name a destination: a customer
  // holding two projects gets «Проєкти» — a screen that lists them — on both
  // navigations, plus the list below.
  assert.match(clientTabs, /clientProjects\.length === 1/);
  assert.match(clientTabs, /href: '\/clients', icon: Folder, label: 'Проєкти'/);
  assert.match(sidebar, /href: '\/clients', icon: Folder, label: 'Проєкти'/);
  assert.match(nav, /\(!clientViewer \|\| clientProjects\.length > 1\)/);
  // `/overview` serves both audiences, so both navigations lead there and the
  // phone no longer opens on a list where the desktop opens on a summary.
  assert.match(clientTabs, /href: '\/overview'/);
  assert.match(sidebar, /href: '\/overview', icon: LayoutDashboard, label: 'Огляд'/);

  // «Співробітники» pointed at `/settings?section=team`, which the settings rail
  // named again on the screen it opened: one destination, two names, one screen.
  // The duplicate is gone from the other end — the roster is a screen now — so
  // what both navigations must agree on is that the entry leads there, and only
  // for the role the route boundary admits.
  for (const source of [nav, sidebar]) {
    assert.doesNotMatch(source, /'\/settings\?section=team'/,
      'the roster is no longer a section of «Налаштування»');
    assert.match(source, /label: 'Співробітники'/);
    assert.match(source, /orgRole === 'client_admin'[\s\S]{0,160}href: '\/team'/,
      'the roster entry is offered to a client administrator only');
  }
  // On the phone it lives in the sheet rather than the bar: the bar holds the
  // two places a customer is in all day, and the third destination is not one
  // of them.
  assert.doesNotMatch(clientTabs, /label: 'Співробітники'/);
  // And `/settings` carries one name across both, not «Мій профіль» here and
  // «Налаштування» there.
  assert.doesNotMatch(nav, /label: 'Мій профіль'/);
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
  // Two things float above the bar — the toast layer and the bulk-action card —
  // and they clear it by the same 8px, so the three of them read as one stack at
  // the bottom of the screen rather than as slabs at unrelated heights. The bulk
  // bar used to sit 16px up, and the extra void was what made it a second object.
  assert.equal((css.match(/bottom: calc\(var\(--qt-nav-space\) \+ 8px\);/g) || []).length, 2);
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
  assert.match(layout, /<MobileNav keyboardOpen=\{keyboardOpen\} composerFocused=\{composerFocused\} \/>/);
  assert.doesNotMatch(nav, /useKeyboardOpen/);
  assert.match(nav, /const navHidden = keyboardOpen \|\| composerFocused;/);
  assert.match(nav, /navHidden \? 'pointer-events-none translate-y-\[140%\] opacity-0'/);
  assert.match(nav, /aria-hidden=\{navHidden\}/);
  // And the space it reserved collapses with it, so the composer gains the room.
  assert.match(css, /body\[data-keyboard='open'\] \{\s*\n\s*--qt-nav-space: 0px;/);
});

test('the keyboard shortens the shell, not the document', async () => {
  const layout = await read('../src/app/(app)/layout.js');
  const css = await read('../src/app/globals.css');

  // iOS covers the layout viewport rather than shrinking it, so a <body> made
  // shorter than the box the browser can pan across leaves that many pixels of
  // bare page canvas below it: invisible while the keys are down, and dragged
  // into view the moment somebody pans, with the composer's focus shadow on the
  // seam. Below md the document reaches the bottom again…
  assert.match(css, /@media \(width < 48rem\) \{\s*\n\s*body\[data-keyboard='open'\] \{\s*\n\s*height: 100dvh;/);
  // …and if a strip is still pannable it is the shell's own white, not canvas.
  assert.match(
    css,
    /body\[data-keyboard='open'\] \{[\s\S]*?background-color: var\(--color-surface\);/,
  );
  // …while the overlap becomes the shell's own padding, so the column still ends
  // exactly on the keys. `max-md:`, which is the same query as the block above.
  assert.match(layout, /max-md:pb-\[var\(--qt-keyboard-inset,0px\)\]/);
});

test('a caret in a composer takes the bar away, from the cause rather than the consequence', async () => {
  const hook = await read('../src/lib/hooks/useComposerFocus.js');
  const layout = await read('../src/app/(app)/layout.js');
  const nav = await read('../src/components/MobileNav.jsx');
  const css = await read('../src/app/globals.css');

  // One listener, keyed on the shelf every composer already sits on — here the
  // request conversation's, and whatever conversation is added next — so a
  // composer is covered by being a composer rather than by being wired up.
  assert.match(hook, /'\.chat-composer-dock'/);
  assert.match(hook, /addEventListener\('focusin'/);
  assert.match(hook, /addEventListener\('focusout'/);
  // Removing a focused element fires no focusout, so a dock that unmounts under
  // the caret would strand the flag; the next touch anywhere corrects it.
  assert.match(hook, /addEventListener\('pointerdown'/);
  // And a client navigation, which need not fire any of the three.
  assert.match(hook, /queueMicrotask\(\(\) => setFocused\(false\)\); \}, \[pathname\]\)/);
  assert.match(hook, /document\.body\.dataset\.composer/);
  // The dock the selector names is the one the product actually renders.
  const dock = await read('../src/components/ui/ChatComposerDock.jsx');
  assert.match(dock, /chat-composer-dock/);

  // Watched by the shell, like the keyboard, and for the same reason.
  assert.match(layout, /const composerFocused = useComposerFocus\(pathname\)/);
  assert.doesNotMatch(nav, /useComposerFocus/);
  // Off screen and aria-hidden is not out of the tab order.
  assert.match(nav, /inert=\{navHidden \|\| undefined\}/);

  // The space collapses with the bar, and only below md.
  assert.match(css, /@media \(width < 48rem\) \{\s*\n\s*body\[data-composer='focused'\] \{\s*\n\s*--qt-nav-space: 0px;/);
});

test('the active tab is announced, not only tinted', async () => {
  const nav = await read('../src/components/MobileNav.jsx');
  assert.match(nav, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(nav, /aria-expanded=\{moreOpen\}/);
  assert.match(nav, /aria-label="Основна навігація"/);
});

// The bar carries qTicket's destinations, and there is no internal chat among
// them any more — not hidden from the bar, deleted from the product.
test('qTicket has no chat destination and no listener left over from one', async () => {
  const nav = await read('../src/components/MobileNav.jsx');
  const bridge = await read('../src/components/WorkspaceNotificationBridge.jsx');
  const title = await read('../src/components/WorkspaceDocumentTitle.jsx');

  for (const source of [nav, bridge, title]) {
    assert.doesNotMatch(source, /useUnreadChatCount/);
    assert.doesNotMatch(source, /unreadChatCount/);
  }
  assert.doesNotMatch(nav, /href: '\/chat'/);
  // The bridge is still the one publisher of the number the bar and the tab
  // read back — it is the bell's own count now, not a second one.
  assert.match(bridge, /useOrganizationUnreadCounts\(\);/);
});

test('the app installs as an app rather than as a bookmark', async () => {
  const manifest = await read('../src/app/manifest.js');
  assert.match(manifest, /display: 'standalone'/);
  assert.match(manifest, /start_url: '\/'/);
  assert.match(manifest, /theme_color: '#f4f4f5'/);
  // A 32px favicon is not a home-screen icon.
  assert.match(manifest, /sizes: '436x436'/);
});
