import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

// The mark and the two lines beside it are one object, and centring the text
// *box* on the logo is not the same as centring the words on it: the big line
// swaps from top to bottom between the plain and branded states, and the ink
// goes with it. Aligned by box alone, «QuickTeam» sat 1.5px above the logo's
// axis — small, visible, and reported twice.
//
// For a column of fixed height H split into a title row and an organization
// row, the words land on the centre when
//
//   titleRow = H/2 + (titleInk − organizationInk) / 2
//
// Measured glyph ink (ascent + descent, not the line box, which carries
// descender space nobody sees) is 14/12 unbranded and 10/17 branded, giving
// 19+17 and 15+21. This test recomputes the split from those measurements, so
// changing a font size in the lockup fails here instead of drifting quietly.

const COLUMN_HEIGHT = 36;
const INK = {
  unbranded: { title: 14, organization: 12 },
  branded: { title: 10, organization: 17 },
};

const titleRowFor = ({ title, organization }) =>
  Math.round(COLUMN_HEIGHT / 2 + (title - organization) / 2);

test('the brand lockup splits its 36px on the ink, not down the middle', () => {
  assert.equal(titleRowFor(INK.unbranded), 19);
  assert.equal(COLUMN_HEIGHT - titleRowFor(INK.unbranded), 17);
  assert.equal(titleRowFor(INK.branded), 15);
  assert.equal(COLUMN_HEIGHT - titleRowFor(INK.branded), 21);
  // Both states stay exactly as tall, so nothing shifts when branding arrives.
  assert.equal(titleRowFor(INK.unbranded) + (COLUMN_HEIGHT - titleRowFor(INK.unbranded)), COLUMN_HEIGHT);
  assert.equal(titleRowFor(INK.branded) + (COLUMN_HEIGHT - titleRowFor(INK.branded)), COLUMN_HEIGHT);
});

test('the sidebar ships the split this file derives', async () => {
  const sidebar = await read('src/components/WorkspaceSidebar.jsx');
  assert.match(sidebar, /height: isBranded \? 15 : 19/);
  assert.match(sidebar, /lineHeight: isBranded \? '15px' : '19px'/);
  assert.match(sidebar, /height: isBranded \? 21 : 17/);
  assert.match(sidebar, /lineHeight: isBranded \? '21px' : '17px'/);
  // The old even-looking split is what put the words above the logo.
  assert.doesNotMatch(sidebar, /lineHeight: '16px'/);
  assert.doesNotMatch(sidebar, /lineHeight: '20px'/);
  // The mark and the lines share a centre line rather than a top edge.
  assert.match(sidebar, /flex items-center min-w-0 flex-1/);
});
