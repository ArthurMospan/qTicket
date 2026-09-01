import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// The mark and the two lines beside it are one object, and centring the text
// *box* on the logo is not the same as centring the words on it. Aligned by box
// alone, the words sat 1.5px above the logo's axis — small, visible, and
// reported twice.
//
// For a column of fixed height H split into a name row and a label row, the
// words land on the centre when
//
//   nameRow = H/2 + (nameInk − labelInk) / 2
//
// The ink is QuickTeam's measurement of the very same two lines, because this
// corner and that one have to be one corner: 10 for the 12px/500 label that
// leads and 17 for the 16px/700 name under it, giving 15 + 21. This file used
// to carry a different measurement of the same pair — 12 and 14, giving
// 17 + 19 — and two measurements of one pair are not both right. The one tuned
// against the rendered rail is the one that stays.

const COLUMN_HEIGHT = 36;
// `qt-workspace/tests/sidebar-brand-lockup.test.mjs`, INK.branded.
const INK = { label: 10, name: 17 };

const labelRowFor = ({ label, name }) =>
  Math.round(COLUMN_HEIGHT / 2 + (label - name) / 2);

test('the brand lockup splits its 36px on the ink, not down the middle', () => {
  assert.equal(labelRowFor(INK), 15);
  assert.equal(COLUMN_HEIGHT - labelRowFor(INK), 21);
  assert.equal(labelRowFor(INK) + (COLUMN_HEIGHT - labelRowFor(INK)), COLUMN_HEIGHT);
});

// There is one lockup, and both readers get it: the small line says what this
// place is, the big line under it names which one you are in.
//
// It used to read the other way round, which put the switcher — a control that
// changes the organization — on the row that says «qTicket», one line below the
// organization it changes. The staff rail had also drawn it in two different
// arrangements before that: «qTicket» big over the tenant's name small when the
// tenant had no branding, the two swapped when it did.
test('the sidebar ships one lockup for both readers', async () => {
  const sidebar = await read('src/components/WorkspaceSidebar.jsx');
  // The two rows, spelled the way the QuickTeam rail spells them.
  const nameLine = /style=\{nameStyle\}/g;
  const labelLine = /fontSize: 12,[\s\S]{0,60}height: 15,[\s\S]{0,60}lineHeight: '15px',[\s\S]{0,60}fontWeight: 500,/g;
  // Written once, not once per reader: `SidebarBrandLockup` takes the two pairs
  // of words as props, so a client's portal and a staff rail cannot drift apart
  // again the way three separate blocks of markup already had.
  // Two spellings of the name row — one inside the switcher, one without it —
  // and one label row above them both. Both name rows read one `nameStyle`, so
  // the switcher and the plain line cannot drift apart.
  assert.equal((sidebar.match(nameLine) || []).length, 2);
  assert.equal((sidebar.match(labelLine) || []).length, 1);
  assert.match(sidebar, /const nameStyle = \{ fontSize: 16, lineHeight: '21px', fontWeight: 700 \};/);
  assert.equal((sidebar.match(/style=\{\{ color: theme\.text, height: 21 \}\}/g) || []).length, 2);
  // The label leads: it is the first of the two lines in the lockup's markup.
  const lockup = sidebar.slice(sidebar.indexOf('function SidebarBrandLockup({'));
  assert.ok(lockup.search(labelLine) < lockup.search(nameLine));
  assert.match(sidebar, /function SidebarBrandLockup\(\{/);
  assert.match(sidebar, /label=\{clientViewer \? 'Портал підтримки' : 'qTicket'\}/);

  // Branding decides which mark is drawn, never how the words are arranged.
  assert.doesNotMatch(sidebar, /fontSize: isBranded/);
  assert.doesNotMatch(sidebar, /fontWeight: isBranded/);
  assert.doesNotMatch(sidebar, /height: isBranded/);
  assert.doesNotMatch(sidebar, /lineHeight: isBranded/);
  // The old even-looking split is what put the words above the logo.
  assert.doesNotMatch(sidebar, /lineHeight: '16px'/);
  assert.doesNotMatch(sidebar, /lineHeight: '20px'/);
  // The mark and the lines share a centre line rather than a top edge.
  assert.match(sidebar, /flex items-center min-w-0 flex-1/);
});

// A picker of one is a door onto a wall. The rail offered it unconditionally on
// the staff side — chevron, hover, keyboard target and all — to owners who have
// exactly one workspace and nothing to switch to. The client's corner and the
// phone's sheet had both asked the question already.
// The check is proximity rather than scope, because this is source text and not
// a rendered tree: a guard that opens the picker's own branch is within a few
// hundred characters of the control, and a control with no guard of its own
// borrows one from a lockup far above it. `unguardedSwitcherOpeners` is exported
// as a function of the source so the case below can hold the code that shipped
// the defect against it.
const GUARD = '(allOrgs || []).length > 1';
const GUARD_REACH = 600;

function unguardedSwitcherOpeners(source) {
  return [...source.matchAll(/setShowOrgSwitcher\(true\)/g)]
    .map(opener => opener.index)
    .filter(index => {
      const guard = source.slice(0, index).lastIndexOf(GUARD);
      return guard < 0 || index - guard > GUARD_REACH;
    });
}

test('the organization switcher is offered only when there is somewhere to switch to', async () => {
  const [sidebar, mobile] = await Promise.all([
    read('src/components/WorkspaceSidebar.jsx'),
    read('src/components/MobileNav.jsx'),
  ]);
  for (const [name, source] of [['sidebar', sidebar], ['mobile nav', mobile]]) {
    assert.ok(
      /setShowOrgSwitcher\(true\)/.test(source),
      `${name} opens the switcher somewhere`,
    );
    assert.deepEqual(
      unguardedSwitcherOpeners(source),
      [],
      `${name}: a control opens the organization picker without checking there is a second one`,
    );
  }
});

// The test above is only worth having if it fails on the code it was written
// for. The staff rail's opener was a bare `div role="button"` with no check
// anywhere near it, so an owner of exactly one workspace was shown a chevron,
// a hover state and a keyboard target that led to a picker of one.
test('that check fails on the rail that shipped the chevron to everybody', () => {
  const shipped = `
    <div className="flex flex-col min-w-0 ml-[12px]">
      <Link href={homeHref}><h1>qTicket</h1></Link>
      <div
        onClick={() => setShowOrgSwitcher(true)}
        role="button"
        tabIndex={0}
        aria-label="Змінити організацію"
      >
        <span>{activeOrg?.name || 'Company name'}</span>
        <ChevronsUpDown size={12} />
      </div>
    </div>
  `;
  assert.equal(unguardedSwitcherOpeners(shipped).length, 1);
});
