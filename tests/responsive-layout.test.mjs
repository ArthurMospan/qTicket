import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('mobile keeps Kanban as a first-class horizontally swipeable board', () => {
  const board = read('src/components/workspace/AgileBoard.jsx');
  assert.match(board, /w-\[82vw\] max-w-\[320px\]/);
  assert.doesNotMatch(board, /max-(?:sm|md):hidden[^\n]*AgileBoard/);
});

test('task chat exposes an unread boundary and reads it only after visibility', () => {
  const timeline = read('src/components/workspace/UnifiedTimeline.jsx');
  const detail = read('src/components/workspace/IssueDetail.jsx');
  // The boundary counts everything the feed carries — messages and changes both.
  // Drawn from the messages alone, it left a task where somebody moved the
  // deadline and said nothing looking untouched.
  assert.match(timeline, /const unreadTotal = unreadCommentIds\.length \+ unreadChangeIds\.length;/);
  // The line carries no number: it stays where the visit found it while the
  // conversation moves, so any count on it goes stale the moment anybody writes.
  assert.match(timeline, /<UnreadDivider label=\{unreadLabel\}/);
  assert.match(timeline, /new IntersectionObserver/);
  assert.match(timeline, /scrollToUnread/);
  // The line stays where the visit found it. Derived live from `unreadTotal` it
  // disappeared the moment it was read, pulling its own height out of the list
  // under the reader.
  assert.match(timeline, /sessionBoundary/);
  // Reading the boundary consumes the changes too. They used to be consumed
  // only by leaving the task, so «11 нових» stood there for a whole visit no
  // matter how far you read.
  assert.match(timeline, /consumeChanges\(\);/);
  assert.match(timeline, /markIssueSeen\(\{/);
  // The jump button points where the line actually is.
  assert.match(timeline, /unreadDirection === 'up' \? ChevronUp : ChevronDown/);
  assert.match(detail, /label: 'Чат'.*count: unreadTaskChatCount/);
});

test('a tab gives up its label, never its icon, and only where it is squeezed', () => {
  const tabs = read('src/components/ui/Tabs.jsx');
  const css = read('src/app/globals.css');

  // The icon keeps its box; the label is the flex item that absorbs the
  // squeeze. Without `shrink-0` an <svg> with a viewBox has no content-based
  // minimum, hands over its whole width, and `preserveAspectRatio` scales the
  // glyph down with it — measured at 7.6px on a 393px viewport, and 0 at 375.
  assert.match(tabs, /<Icon size=\{14\} className="max-md:shrink-0" \/>/);

  // The label is wrapped so that it *can* be told to shrink, and the wrapper is
  // only rendered when there is a label: an empty span is still a flex item, and
  // the strip's 6px gap would open a hole in every icon-only tab.
  assert.match(tabs, /\{tab\.label \? <span className="ui-tab-label">\{tab\.label\}<\/span> : null\}/);

  // And above md the wrapper is not there at all. This is the half that broke
  // first: an ungated <span> swallows a fragment label's boxes — a 6px status
  // dot goes to zero, its gaps close, and an svg drops to a second line.
  assert.match(css, /\.ui-tab-label \{\s*\n\s*display: contents;\s*\n\s*\}/);

  // The three parts of the mobile half flip at one width. `(max-width: 767px)`
  // is a different query at 767.5px — ordinary under browser zoom or a
  // fractional device pixel ratio — and there a tab would keep the wide inset
  // while its label had already been told it may ellipsise.
  assert.match(
    css,
    /@media \(width < 48rem\) \{\s*\n\s*\.ui-tabs\[data-ui-composition='pane-switch'\] \.ui-tab-label \{[^}]*text-overflow: ellipsis;/,
  );
  assert.match(
    css,
    /@media \(width < 48rem\) \{\s*\n\s*\.ui-tabs\[data-ui-composition='pane-switch'\] > \[role='tab'\] \{\s*\n\s*padding-inline: 10px;/,
  );
  assert.doesNotMatch(css, /@media \(max-width: 767px\) \{\s*\n\s*\.ui-tabs\[data-ui-composition='pane-switch'\]/);
});

test('a date in a row of Selects is a declared composition, not an exception in a negation', () => {
  const css = read('src/app/globals.css');
  const detail = read('src/components/workspace/IssueDetail.jsx');
  const story = read('src/app/ui-kit/sections/task-attributes.jsx');
  const variants = read('scripts/kit-variants.mjs');

  // The size is stated where the rest of the named geometry is, so
  // `kit-variants` can read it and «Матриця варіантів» can render it. A
  // negation declares nothing on its own.
  assert.match(css, /\.ui-control\[data-ui-composition='attribute-field'\] \{\s*\n\s*font-size: 13px;\s*\n\s*\}/);
  // …and the iOS focus-zoom guard names it only to step aside. A DatePicker's
  // trigger is a readonly input, so the guard caught it while the custom Selects
  // beside it were invisible to the rule and the deadline came out 16px.
  assert.match(css, /:not\(\[readonly\]\[data-ui-composition='attribute-field'\]\),/);
  // Both places the picker stands in a column of Select triggers — the strip's
  // own cell and the «Деталі» drawer under it — and the story that mirrors them.
  // Comments stripped first: this composition is worth explaining where it is
  // used, and a scan that counts prose about a prop as a use of it would pass
  // while the prop had been deleted.
  const withoutComments = source => source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '');
  assert.equal((withoutComments(detail).match(/composition="attribute-field"/g) || []).length, 2);
  assert.equal((withoutComments(story).match(/composition="attribute-field"/g) || []).length, 2);
  // Declared, or the drift check skips the component outright and nothing is
  // ever checking the value the product ships.
  assert.match(variants, /DatePicker: \{\s*\n\s*composition: \{ css: \['\.ui-control', 'data-ui-composition'\] \},/);
});

test('the quick view moves its rarest buttons into the kebab rather than shrinking its title', () => {
  const detail = read('src/components/workspace/IssueDetail.jsx');

  // Four 36px squares beside the title left it 185px at 393px. The pencil and
  // the ⤢ go below md; the kebab and the ✕ stay.
  assert.match(detail, /icon=\{Pencil\}[^\n]*className="max-md:hidden"/);
  assert.match(detail, /aria-label="Відкрити на повній сторінці"\s*\n\s*title="Відкрити на повній сторінці"\s*\n\s*className="max-md:hidden"/);

  // `!== false`, not `=== true`. The CSS half is decided at the first paint
  // while `useIsMobile` answers null until its effect runs, so a strict `true`
  // leaves the phone with neither the button nor its replacement — and if the
  // answer never resolves, permanently.
  assert.match(detail, /\.\.\.\(isMobile !== false && !isArchived && canEditContent/);
  assert.match(detail, /\.\.\.\(isMobile !== false && isModal && onClose/);
  assert.doesNotMatch(detail, /isMobile === true && (?:isModal|!isArchived)/);

  // And the closing ✕ steps aside while an edit is open, because «Скасувати»
  // below sm is an icon-only ✕ too: two identical glyphs meaning two different
  // things, side by side.
  assert.match(detail, /icon=\{X\} onClick=\{onClose\}[^\n]*className=\{isEditing \? 'max-md:hidden' : undefined\}/);
});

test('settings workflow rows fit a phone', () => {
  const settings = read('src/app/(app)/settings/page.js');
  const css = read('src/app/globals.css');

  // Nothing is asserted about the settings *header* here, and that is the
  // finding rather than an omission. QuickTeam stacks it below md because its
  // description shares the row with a right-hand control; no `<Section>` in
  // this fork passes one, and there is no `icon` prop to fall back on, so the
  // ported `desc && rightAction` could only ever be false and the four
  // `max-md:` strings it gated never reached a browser. Asserting them would
  // have frozen an unreachable branch in place. What does share that row is the
  // back arrow, and it indents the title and the description together instead
  // of squeezing one of them — so there is no header behaviour left to hold.

  // A workflow row printed its name twice — once as text, once in the preview
  // badge — and the badge could not shrink, so the edit/delete box was pushed
  // off the card. Below md the plain copy goes and the badge wraps instead.
  assert.match(settings, /className="flex-1 text-\[13px\] font-semibold text-ink max-md:hidden"/);
  // The wrapping is a named kit preset, not a handful of utilities at the call
  // site: `justify-content`, `white-space` and `flex-shrink` are declarations
  // `.ui-pill` makes for itself, and a className that re-makes them is a second
  // copy of the kit's geometry living where nothing can propagate to it. Three
  // previews ask for it — type, priority, and everything else.
  assert.equal((settings.match(/preset="workflow-preview"/g) || []).length, 3);
  assert.doesNotMatch(settings, /max-md:whitespace-normal|max-md:break-words/);
  assert.match(
    css,
    /@media \(width < 48rem\) \{\s*\.ui-pill\[data-ui-pill-preset='workflow-preview'\] \{[^}]*\bwhite-space: normal;[^}]*\}/,
  );
  // The badge is a Pill, so the preset it is handed is the pill's; declared,
  // or the drift check skips the component and nothing checks the value the
  // product ships.
  assert.match(
    read('scripts/kit-variants.mjs'),
    /PriorityBadge: \{\s*\n\s*preset: \{ css: \['', 'data-ui-pill-preset'\] \},/,
  );
  assert.match(read('src/components/ui/DataDisplay/PriorityBadge.jsx'), /preset=\{preset\}/);
});

test('the bulk bar is two fixed rows on a phone and untouched above md', () => {
  const bar = read('src/components/ui/TaskManagement/BulkActionBar.jsx');
  const css = read('src/app/globals.css');

  // The pickers get a box of their own so they can be a row below md. It is
  // `display: contents` at every other width, ungated — `md:contents` and a
  // `max-width: 767px` block are not complements, and at 767.5px the wrapper
  // would fall back to a block and stack every picker in a column.
  assert.match(bar, /<div className="ui-bulk-actions__rail" role="none">/);
  assert.match(css, /\.ui-bulk-actions__rail \{\s*\n\s*display: contents;\s*\n\s*\}/);

  // Two rows, and the second one is the glyph row: the count and the ✕ share
  // the first, so the bar's height stops growing with the number of configured
  // attributes.
  assert.match(css, /\.ui-bulk-actions__rail \{\s*\n\s*grid-column: 1 \/ -1;\s*\n\s*grid-row: 2;/);
  assert.match(css, /\.ui-bulk-actions__clear \{\s*\n\s*grid-column: 2;\s*\n\s*grid-row: 1;\s*\n\s*\}/);
  assert.match(bar, /className="ui-bulk-actions__clear !text-white/);

  // `!w-auto` at the call site was the one declaration the phone layout could
  // not answer, and it only repeated what globals.css already says. Matched on
  // the whole line rather than by a negation: the comment above it in the
  // component explains the removal by name, and a bare `doesNotMatch` would
  // read that prose as the class coming back.
  assert.match(bar, /const triggerClass = 'ui-bulk-actions__trigger px-\[10px\] rounded-\[10px\] text-\[12px\]';/);
  assert.match(css, /\.ui-bulk-actions__control > button \{\s*\n\s*width: auto;/);
});

test('the task composer respects the device safe area', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /timeline-composer[^}]*calc\(20px \+ var\(--sab\)\)/s);
});
