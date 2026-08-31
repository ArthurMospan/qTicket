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
// Measured glyph ink (ascent + descent, not the line box, which carries
// descender space nobody sees) is 14 for the 16px/700 name and 12 for the
// 12px/500 label, giving 19 + 17. This test recomputes the split, so changing a
// font size in the lockup fails here instead of drifting quietly.

const COLUMN_HEIGHT = 36;
const INK = { name: 14, label: 12 };

const nameRowFor = ({ name, label }) =>
  Math.round(COLUMN_HEIGHT / 2 + (name - label) / 2);

test('the brand lockup splits its 36px on the ink, not down the middle', () => {
  assert.equal(nameRowFor(INK), 19);
  assert.equal(COLUMN_HEIGHT - nameRowFor(INK), 17);
  assert.equal(nameRowFor(INK) + (COLUMN_HEIGHT - nameRowFor(INK)), COLUMN_HEIGHT);
});

// There is one lockup, and both readers get it: the big line names the space
// you are in, the small line says what that space is.
//
// The client's corner has always read that way. The staff rail read the other
// way round and did it in two different arrangements — «qTicket» big over the
// tenant's name small when the tenant had no branding, the two swapped when it
// did. Three shapes for one corner, and in one of them the organization the
// reader actually works in was the small print above their own product's name.
test('the sidebar ships one lockup for both readers', async () => {
  const sidebar = await read('src/components/WorkspaceSidebar.jsx');
  const nameLine = /className="h-\[19px\] truncate text-\[16px\] font-bold leading-\[19px\] tracking-tight"/g;
  const labelLine = /className="h-\[17px\] truncate text-\[12px\] font-medium leading-\[17px\]"/g;
  // Written once, not once per reader: `SidebarBrandLockup` takes the two pairs
  // of words as props, so a client's portal and a staff rail cannot drift apart
  // again the way three separate blocks of markup already had.
  assert.equal((sidebar.match(nameLine) || []).length, 1);
  assert.equal((sidebar.match(labelLine) || []).length, 1);
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
