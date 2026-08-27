import test from 'node:test';
import assert from 'node:assert/strict';
import { MINUTES_PER_DAY, dayEventBounds, layoutDayEvents } from '../src/lib/utils/calendarLayout.mjs';

const day = new Date(2026, 6, 25);
const at = (hour, minute = 0, offsetDays = 0) =>
  new Date(2026, 6, 25 + offsetDays, hour, minute, 0).toISOString();
const event = (id, startHour, endHour, extra = {}) => ({
  id, startAt: at(startHour), endAt: at(endHour), ...extra,
});

test('night-time events are placed at their real hour, not clamped', () => {
  // The old grid started at 07:00 and used Math.max(0, …), which drew a 03:00
  // meeting on the 07:00 row.
  const bounds = dayEventBounds(event('early', 3, 4), day);
  assert.equal(bounds.top, 180);
  assert.equal(bounds.height, 60);
});

test('late events stay inside the day instead of overflowing', () => {
  const bounds = dayEventBounds(event('late', 23, 24), day);
  assert.equal(bounds.top, 23 * 60);
  assert.equal(bounds.top + bounds.height, MINUTES_PER_DAY);
});

test('an event spanning midnight appears on both days', () => {
  const overnight = { id: 'night', startAt: at(22), endAt: at(2, 0, 1) };
  const first = dayEventBounds(overnight, day);
  const second = dayEventBounds(overnight, new Date(2026, 6, 26));
  assert.equal(first.top, 22 * 60);
  assert.equal(first.continuesAfter, true);
  assert.equal(second.top, 0);
  assert.equal(second.continuesBefore, true);
  assert.equal(second.height, 120);
});

test('events outside the day are not placed', () => {
  assert.equal(dayEventBounds(event('other', 9, 10, { startAt: at(9, 0, 3), endAt: at(10, 0, 3) }), day), null);
});

test('overlapping events share the column instead of covering each other', () => {
  const boxes = layoutDayEvents([
    event('a', 9, 11),
    event('b', 10, 12),
    event('c', 14, 15),
  ], day);
  const byId = Object.fromEntries(boxes.map(box => [box.event.id, box]));
  assert.equal(byId.a.lanes, 2);
  assert.equal(byId.b.lanes, 2);
  assert.notEqual(byId.a.lane, byId.b.lane);
  assert.equal(byId.a.widthPercent, 50);
  // A non-overlapping event keeps the full width.
  assert.equal(byId.c.lanes, 1);
  assert.equal(byId.c.widthPercent, 100);
});

test('three concurrent events each get their own lane', () => {
  const boxes = layoutDayEvents([event('a', 9, 12), event('b', 9, 12), event('c', 9, 12)], day);
  assert.deepEqual([...new Set(boxes.map(box => box.lane))].sort(), [0, 1, 2]);
  for (const box of boxes) assert.equal(box.lanes, 3);
});

test('a freed lane is reused by a later event', () => {
  const boxes = layoutDayEvents([event('a', 9, 10), event('b', 9, 12), event('c', 10, 11)], day);
  const byId = Object.fromEntries(boxes.map(box => [box.event.id, box]));
  assert.equal(byId.a.lane, byId.c.lane);
  assert.notEqual(byId.b.lane, byId.c.lane);
});

test('a zero-length or inverted event still gets a visible, non-negative box', () => {
  const bounds = dayEventBounds({ id: 'broken', startAt: at(9), endAt: at(8) }, day);
  assert.ok(bounds.height > 0);
  assert.equal(bounds.top, 9 * 60);
});
