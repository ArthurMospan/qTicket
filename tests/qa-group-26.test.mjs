import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { plural } from '../src/lib/utils/plural.mjs';
import {
  issueCycleStartMillis,
  summarizeCycleTimes,
} from '../src/lib/utils/velocityMetrics.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const timestamp = millis => ({ toMillis: () => millis });

test('Ukrainian plural forms handle teens, compound counts and negative values', () => {
  const forms = ['завдання', 'завдання', 'завдань'];
  const expected = new Map([
    [0, 'завдань'],
    [1, 'завдання'],
    [2, 'завдання'],
    [4, 'завдання'],
    [5, 'завдань'],
    [11, 'завдань'],
    [14, 'завдань'],
    [21, 'завдання'],
    [22, 'завдання'],
    [25, 'завдань'],
    [111, 'завдань'],
    [122, 'завдання'],
    [-2, 'завдання'],
  ]);

  for (const [count, form] of expected) assert.equal(plural(count, forms), form);
  assert.equal(plural(Number.NaN, forms), 'завдань');
  assert.throws(() => plural(2, ['одна', 'дві']), /three Ukrainian forms/);
});
