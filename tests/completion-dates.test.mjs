import test from 'node:test';
import assert from 'node:assert/strict';

import { reliableCompletedAtMillis } from '../src/lib/utils/completionDates.mjs';

const timestamp = millis => ({ toMillis: () => millis });

test('native completion uses the explicit completion date', () => {
  assert.equal(reliableCompletedAtMillis({
    completedAt: timestamp(300),
    updatedAt: timestamp(900),
  }), 300);
});
test('an edit date never stands in for a missing completion date', () => {
  assert.equal(reliableCompletedAtMillis({ updatedAt: timestamp(900) }), 0);
});

test('legacy YouTrack completion stamped without import provenance is excluded', () => {
  assert.equal(reliableCompletedAtMillis({
    source: 'youtrack',
    completedAt: timestamp(300),
  }), 0);
});

test('current YouTrack imports use the source completion date', () => {
  assert.equal(reliableCompletedAtMillis({
    source: 'youtrack',
    importedAt: timestamp(900),
    completedAt: timestamp(300),
  }), 300);
});
