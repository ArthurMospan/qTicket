import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('calendar event mutations are bounded, transactional and cleanup-safe', async () => {
  const route = await read('../src/app/api/calendar/events/[eventId]/route.js');

  assert.match(route, /function validEventId\(/);
  assert.match(route, /CALENDAR_EVENT_JSON_INVALID/);
  assert.match(route, /Object\.hasOwn\(body, 'response'\)/);
  assert.match(route, /await db\.runTransaction\(async transaction =>/);
  assert.match(route, /\.where\('eventId', '==', eventId\)\s*\.limit\(1\)/);
  assert.match(route, /previousProjectRef = null/);
  assert.match(route, /projectRef = null/);
  assert.doesNotMatch(route, /CALENDAR_PREVIOUS_PROJECT_INVALID/);
  assert.match(route, /notification failed after commit/);
  assert.doesNotMatch(route, /calendarTimeLogBillingDetails/);
});

test('calendar time writes are server-owned, canonical and team-only', async () => {
  const route = await read(
    '../src/app/api/calendar/events/[eventId]/time-logs/route.js',
  );
  const rules = await read('../firestore.rules');

  assert.match(route, /isCanonicalCalendarOccurrence/);
  assert.match(route, /CALENDAR_TIME_JSON_INVALID/);
  assert.match(route, /event\.visibility === 'team'/);
  assert.match(route, /eventVisibility:\s*'team'/);
  assert.match(route, /calendarOrganizerId:\s*event\.organizerId/);
  assert.match(route, /invoiceMutationVersion/);
  assert.match(rules, /function isTeamCalendarTimeLog/);
  assert.match(
    rules,
    /match \/timeLogs\/\{id\} \{[\s\S]*allow create, update, delete: if false;/,
  );
});

test('legacy calendar visibility backfill is explicit and dry-run by default', async () => {
  const script = await read(
    '../scripts/backfill-calendar-time-log-visibility.mjs',
  );

  assert.match(script, /const APPLY = process\.argv\.includes\('--apply'\)/);
  assert.match(script, /--confirm-writes-frozen/);
  assert.match(script, /--confirm-project/);
  assert.match(script, /--confirm-organization/);
  assert.match(script, /restricted-backfill/);
  assert.match(script, /isCalendarEventOccurrence/);
  assert.match(script, /cleanEventDocumentId/);
  assert.match(script, /log\.issueId/);
  assert.match(script, /transaction\.update\(currentLogSnapshot\.ref/);
});
