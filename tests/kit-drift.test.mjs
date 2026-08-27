import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkKitDrift } from '../scripts/check-kit-drift.mjs';
import { extractVariants, variantNamespaces } from '../scripts/kit-variants.mjs';
import { readShowcase } from '../scripts/ui-kit-showcase.mjs';

const committed = JSON.parse(
  readFileSync(new URL('../src/app/ui-kit/kit-drift.generated.json', import.meta.url), 'utf8'),
);

test('the committed drift report matches the code', () => {
  assert.deepEqual(
    checkKitDrift(),
    committed,
    'kit-drift.generated.json is stale — run `npm run kit:drift` and commit the result',
  );
});

// The whole point of the report. `kit:audit` asks whether the product takes a
// component from the kit; these three ask whether it then renders it the way
// the kit declares. A component can be imported everywhere, score green
// coverage, and still put something on screen the kit never sanctioned.
test('the product never renders a kit component outside what the kit declares', () => {
  assert.deepEqual(
    committed.undeclaredValues,
    [],
    'A variant value the implementation does not declare reached the product. '
    + 'Either declare it (a lookup-map entry or a globals.css rule) or use a declared one.',
  );
  assert.deepEqual(
    committed.unknownProps,
    [],
    'A variant-shaped prop the manifest does not know reached the product. '
    + 'Declare it in scripts/kit-variants.mjs SOURCES, or stop passing it.',
  );
  assert.deepEqual(
    committed.chromeOverrides,
    [],
    'A kit component was handed a className that redefines its own geometry or '
    + 'typography. Positioning (flex-1, h-full, margins) is fine; owning height, '
    + 'radius, padding or type is not — add a named variant instead.',
  );
});

// A variant the site ships but the catalogue never shows is the exact failure
// the kit exists to prevent: /ui-kit stops describing the product one value at
// a time, silently. This started at 53 and is now a fourth zero — «Матриця
// варіантів» renders every declared value of every component it can render
// standalone, and the handful that cannot (Dialog needs an open state,
// PageHeader a whole page) have real previews in their own sections.
test('every variant the product ships is visible somewhere in the catalogue', () => {
  assert.deepEqual(
    committed.usedWithoutPreview,
    [],
    'A variant ships on the site with no preview in /ui-kit. Either add the '
    + 'component to VARIANT_BASE in src/app/ui-kit/sections/variant-matrix.jsx so the matrix renders '
    + 'it, or show the value in its own section.',
  );
  assert.equal(committed.totals.usedWithoutPreview, 0);
});

// The matrix is what makes the zero above hold without anybody maintaining it.
// If a component drops out of VARIANT_BASE, its values silently stop being
// previewed — the count would still read zero until someone added a variant.
test('the variant matrix renders every component that can stand alone', () => {
  const matrix = readShowcase().stories.find(story => story.id === 'variant-matrix').source;
  const base = matrix.slice(matrix.indexOf('const VARIANT_BASE = {'), matrix.indexOf('const VARIANT_ELSEWHERE'));
  const elsewhere = matrix.slice(matrix.indexOf('const VARIANT_ELSEWHERE'), matrix.indexOf('const NEEDS_DARK'));

  const rendered = new Set([...base.matchAll(/^ {2}(\w+):\s*\(props\)/gm)].map(match => match[1]));
  const excused = new Set([...elsewhere.matchAll(/^ {2}(\w+):\s*'/gm)].map(match => match[1]));

  for (const component of Object.keys(committed.manifest)) {
    assert.ok(
      rendered.has(component) || excused.has(component),
      `${component} declares variants but the matrix neither renders it nor says why not`,
    );
  }
  // An excuse is only an excuse while the component really cannot stand alone.
  for (const component of excused) {
    assert.ok(!rendered.has(component), `${component} is both rendered and excused`);
  }
});

// A shared CSS namespace has no per-component owner: `.ui-control[data-ui-composition]`
// is one selector serving Button, IconAction and Input at once. Before this was
// A ceiling, not a zero: plenty of declared values are legitimately unused
// today. What this catches is the specific way the surfaces pass can break the
// report. The usage scan stops at the kit boundary on purpose, so moving a
// component into `src/components/ui` takes its call site out of view — and with
// it, the evidence for every variant that call site was the only user of.
//
// `UserStatusDialog` is the live example and the reason this number is pinned.
// It is the sole user of `Input composition="status-entry"`, `Button
// composition="status-submit"` and `Dialog size="status"`; promoting it to the
// kit would move three variants into this list while the product went on
// rendering them every time somebody set a status. A component whose call site
// is the only evidence for a declared variant stays where it is.
//
// Raised 96 → 100 when the calendar's day cell arrived. That is a different
// cause and worth naming, because the number no longer means only one thing:
// the scan can read a literal and nothing else, so a state chosen at runtime —
// `state={!inMonth ? 'outside' : isToday ? 'today' : …}` — is invisible to it
// however plainly the product renders it. Four states of `CalendarDayCell` went
// into this list on the day they started being drawn. Where a literal is
// available the call site should pass one instead of spending the ceiling;
// where the value is genuinely computed, this is the honest place for it.
//
// Raised 100 → 107 when the page skeletons were removed. `PageSkeleton` was the
// only product user of most of `Skeleton`'s presets — dot, chip, card, tile,
// chart, panel and the rest existed to draw the shape of a whole screen. The
// route loaders are a spinner now, so the sidebar is the last caller and it
// asks for two presets. The presets stay declared: they are the component's
// vocabulary, and `preset="text"` / `width="full"` are its own defaults, which
// cannot be deleted for want of a call site.
// Raised 107 → 109 with the analytics vocabulary. Both additions are a
// component's own default — `DetailSection density="section"` and
// `FileThumb density="md"` — which no call site passes and none should, for the
// same reason `Skeleton preset="text"` does not: a default is the value you get
// by writing nothing.
// Raised 109 → 111 by the calendar's phone month. `CalendarDayCell` gained
// `state="selected"` — the day whose entries are open under the grid — and a
// second geometry, whose `roomy` is the default the timesheet gets by writing
// nothing. Neither can ever be counted: `state` is not a variant prop name the
// scan reads, so every state of both calendar components has always lived in
// this list, and a default has no call site by definition.
// Raised 111 → 112 by the meter's inline layout. `Meter layout="inline"` is
// what a table row uses and three call sites pass it; `stack` is the value you
// get by writing nothing, and a default has no call site by definition.
// Raised 112 → 113 by the table's row density, for the same reason: a row
// carrying a face is `comfortable` and says so, a row of figures is `compact`
// and says nothing, because that is what it gets by default.
// Raised 113 → 114 because `Pill tone="info"` lost its last call site on
// purpose. It was the blue badge over the most popular plan, and the price list
// no longer marks that plan with a second colour — it carries a badge and
// nothing else. The tone stays declared: blue is a status the product has, it
// simply is not a thing to be in a price list.
test('promoting a component to the kit does not orphan the variants it used', () => {
  assert.ok(
    committed.totals.declaredUnused <= 114,
    `declaredUnused grew to ${committed.totals.declaredUnused}: a call site that evidenced a variant has gone out of the scan's view`,
  );
  for (const key of ['Input.composition.status-entry', 'Button.composition.status-submit', 'Dialog.size.status']) {
    assert.ok(committed.usage[key] > 0, `${key} lost its only call site`);
  }
});

// modelled, the report called `Button.composition="duration-hours"` a dead
// Button variant when it is an Input composition Button also happens to accept.
test('a shared CSS namespace is never reported as one component\'s dead variant', () => {
  const namespaces = variantNamespaces();
  assert.equal(namespaces['Button.composition'], namespaces['Input.composition']);
  assert.equal(namespaces['Button.composition'], namespaces['IconAction.composition']);
  assert.notEqual(namespaces['Surface.composition'], namespaces['Button.composition']);

  const dead = new Set(committed.declaredUnused.map(entry => `${entry.component}.${entry.prop}.${entry.value}`));
  for (const [key, count] of Object.entries(committed.usage)) {
    if (count > 0) assert.ok(!dead.has(key), `${key} is used ${count}× but reported as unused`);
  }
  for (const entry of committed.declaredUnused) {
    if (!entry.namespace) continue;
    const sharing = Object.entries(variantNamespaces())
      .filter(([, namespace]) => namespace === entry.namespace)
      .map(([pair]) => pair.split('.')[0]);
    for (const component of sharing) {
      const used = committed.usage[`${component}.${entry.prop}.${entry.value}`] || 0;
      assert.equal(
        used,
        0,
        `${entry.component}.${entry.prop}="${entry.value}" is called dead while ${component} uses it`,
      );
    }
  }
});

// The manifest is derived, never written down. A hand-kept list was tried first
// and was wrong within minutes; this asserts the derivation still reaches both
// of its sources — a component lookup map and a globals.css rule.
test('the variant manifest is still derived from the implementation', () => {
  const manifest = extractVariants();
  assert.ok(manifest.Button.size.includes('lg'), 'Button sizes should come from its SIZES map');
  assert.ok(manifest.Pill.tone.includes('ink-subtle'), 'Pill tones should come from globals.css');
  assert.ok(manifest.Popover.padding.includes('tight'), 'Popover paddings should come from its PADDINGS map');
  for (const context of ['settings', 'team', 'chat']) {
    assert.ok(
      manifest.SidebarLayout.context.includes(context),
      `the ${context} layout should be declared by SidebarLayout.CONTEXTS`,
    );
  }
  for (const context of ['default', 'detail', 'projects', 'stacked']) {
    assert.ok(
      manifest.FilterBar.context.includes(context),
      `the ${context} filter layout should be declared by FilterBar.WIDTHS`,
    );
  }
  assert.deepEqual(manifest, committed.manifest, 'the committed manifest is stale — run `npm run kit:drift`');
});

// QUI: the free-value prop is the thing that makes propagation impossible —
// every call site keeps its own copy of a decision the kit is supposed to own.
test('Popover padding is a named scale, not a raw CSS length', () => {
  const popover = readFileSync(new URL('../src/components/ui/Navigation/Popover.jsx', import.meta.url), 'utf8');
  const issueDetail = readFileSync(new URL('../src/components/workspace/IssueDetail.jsx', import.meta.url), 'utf8');
  const calendarEvent = readFileSync(new URL('../src/components/workspace/calendar/CalendarEventPage.jsx', import.meta.url), 'utf8');

  assert.match(popover, /export const PADDINGS = \{/);
  assert.match(popover, /padding: PADDINGS\[padding\]/);
  for (const source of [issueDetail, calendarEvent]) {
    assert.doesNotMatch(source, /padding=(?:"|\{')\d+px/, 'a raw CSS length is back on Popover');
  }
});

// Settings, Team and Chat are three different layouts — that was never the
// problem. The problem was that only Settings said so: Chat and Team each
// hand-wrote the same canvas-rail-beside-white-pane shell, so the same 12px
// gutter was spelled `gap-3` in one and `gap: '12px'` in the other, and the two
// screens under the fixed 56px header each remembered the offset separately.
test('every screen with the two-pane shell declares it instead of retyping it', () => {
  const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
  const shell = read('../src/components/ui/Layout/SidebarLayout.jsx');
  const screens = {
    settings: read('../src/app/(app)/settings/page.js'),
    team: read('../src/app/(app)/team/page.js'),
    chat: read('../src/app/(app)/chat/page.js'),
  };

  for (const [context, source] of Object.entries(screens)) {
    assert.match(source, /<SidebarLayout/, `${context} should render the shared shell`);
    assert.match(
      source,
      new RegExp(`<SidebarLayout[\\s\\S]{0,200}context="${context}"`),
      `${context} should name its layout context`,
    );
    assert.match(shell, new RegExp(`^ {2}${context}: \\{`, 'm'), `SidebarLayout should declare the ${context} context`);
  }

  // The shell owns the gutter and the header offset now, so no screen may keep
  // a second copy of either.
  assert.doesNotMatch(screens.chat, /flex-1 flex overflow-hidden gap-3 p-\[12px\] pt-\[56px\]/);
  assert.doesNotMatch(screens.team, /flex w-full h-full p-\[12px\] pt-\[56px\] gap-\[12px\] bg-white/);
  assert.match(shell, /pt-\[56px\]/, 'the header offset belongs to the shell');

  // The background behind the panes belongs to the context too. Chat used to
  // paint it on its own page wrapper, so two contexts declared it here and one
  // did not — the same split the component exists to end.
  for (const context of ['settings', 'team', 'chat']) {
    const block = shell.slice(shell.indexOf(`  ${context}: {`), shell.indexOf('wrapsContent', shell.indexOf(`  ${context}: {`)));
    assert.match(block, /bg-white/, `the ${context} context declares its own background`);
  }
  assert.doesNotMatch(
    screens.chat,
    /flex-1 flex flex-col overflow-hidden bg-white/,
    'the chat page must not repaint the shell background itself',
  );
});

// Three rails, one shell, one inset. Team's rail used `p-4` while chat's and
// settings' used 32px of vertical padding, so the rail content sat 16px higher
// on one of the three screens and visibly jumped when you moved between them.
// Measured in the browser before the fix: settings 32px, chat 35px, team 16px
// from the top of the rail to its first line of text.
test('every rail in the two-pane shell insets its content the same way', () => {
  const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
  const shell = read('../src/components/ui/Layout/SidebarLayout.jsx');
  const channelRail = read('../src/components/ui/Navigation/ChannelRail.jsx');
  const memberRail = read('../src/components/ui/Navigation/MemberRail.jsx');
  const innerNavigation = read('../src/components/ui/Navigation/InnerNavigation.jsx');

  assert.match(shell, /export const RAIL_INSET = 'px-\[16px\] py-\[32px\]'/);
  assert.match(channelRail, /px-\[16px\] py-\[32px\]/, 'the chat rail keeps the shared inset');
  assert.match(innerNavigation, /px-\[16px\] py-\[32px\]/, 'the settings rail keeps the shared inset');
  // QUI-107. MemberRail splits the inset because its header does not scroll
  // with the list, and it opens with a heading and a counter rather than the
  // 10px caption the other two open with — twice the block, so it starts
  // higher. What must not come back is `p-4`, which set the *sides* to 16px
  // too and left the header narrower than the list under it.
  assert.match(memberRail, /px-4 pt-\[16px\] pb-4/, 'the team rail opens above its taller heading');
  assert.doesNotMatch(memberRail, /"p-4 flex items-center/, 'the all-round 16px header inset must not come back');
});

// QUI: `editor`/`editor-active` were merged away as byte-identical duplicates
// and MarkdownEditor was never updated, so every toolbar button fell back to
// the default appearance and the pressed state rendered as not-pressed. The
// drift check is what finally surfaced it; this keeps it surfaced.
test('every IconAction appearance a call site asks for actually exists', () => {
  const iconAction = readFileSync(new URL('../src/components/ui/IconAction.jsx', import.meta.url), 'utf8');
  const markdown = readFileSync(new URL('../src/components/ui/Forms/MarkdownEditor.jsx', import.meta.url), 'utf8');

  assert.doesNotMatch(markdown, /appearance=\{active \? 'editor-active' : 'editor'\}/);
  assert.match(markdown, /appearance=\{active \? 'soft' : 'quiet'\}/);
  for (const appearance of ['soft', 'quiet']) {
    assert.match(iconAction, new RegExp(`^\\s+${appearance}: '`, 'm'), `IconAction lost the ${appearance} appearance`);
  }
});
