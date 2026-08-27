import test from 'node:test';
import assert from 'node:assert/strict';
import { GLOBAL_NOTIFICATION_Z_INDEX } from '../src/lib/utils/overlayLayers.mjs';

test('global notifications stay above all standard application overlays', () => {
  assert.ok(
    GLOBAL_NOTIFICATION_Z_INDEX >= 10_000,
    'notification overlays must remain above modals, lightboxes, and popovers',
  );
});
