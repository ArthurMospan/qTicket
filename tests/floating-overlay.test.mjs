import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFloatingOverlayPosition } from '../src/lib/utils/floatingOverlay.mjs';

test('keeps a large popup inside the viewport when neither side fully fits', () => {
  const result = calculateFloatingOverlayPosition({
    anchorRect: { top: 122, right: 1000, bottom: 150, left: 972, width: 28, height: 28 },
    overlayWidth: 300,
    overlayHeight: 360,
    viewportWidth: 1060,
    viewportHeight: 414,
    preferredPlacement: 'top',
    align: 'end',
  });

  assert.equal(result.placement, 'bottom');
  assert.equal(result.top, 46);
  assert.equal(result.left, 700);
});

test('flips a dropdown above its trigger when there is not enough room below', () => {
  const result = calculateFloatingOverlayPosition({
    anchorRect: { top: 700, right: 400, bottom: 736, left: 200, width: 200, height: 36 },
    overlayWidth: 200,
    overlayHeight: 240,
    viewportWidth: 900,
    viewportHeight: 760,
    preferredPlacement: 'bottom',
    align: 'start',
  });

  assert.equal(result.placement, 'top');
  assert.equal(result.top, 452);
  assert.equal(result.left, 200);
});
