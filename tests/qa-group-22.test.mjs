import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MAX_ISSUE_ESTIMATE_HOURS,
  clampIssueEstimateHours,
  issueEstimateHoursError,
} from '../src/lib/utils/issueEstimate.mjs';
import { userFacingErrorMessage } from '../src/lib/utils/errors.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('task estimates clamp both bounds and report invalid half-hour steps', () => {
  assert.deepEqual(clampIssueEstimateHours('-500'), {
    value: '0',
    error: 'Оцінка не може бути відʼємною',
  });
  assert.equal(clampIssueEstimateHours('999999999').value, String(MAX_ISSUE_ESTIMATE_HOURS));
  assert.equal(issueEstimateHoursError('2.5'), '');
  assert.equal(issueEstimateHoursError('2.3'), 'Використовуйте крок 0,5 години');
});

test('task composer resets discarded drafts and owns its one inline failure', async () => {
  const modal = await read('src/components/CreateTaskModal.jsx');
  assert.match(modal, /const closeAndReset = \(\) => \{[\s\S]*?resetDraft\(\);[\s\S]*?onClose\(\);/);
  assert.match(modal, /onClose=\{closeAndReset\}/);
  assert.match(modal, /<form[\s\S]{0,180}noValidate/);
  assert.match(modal, /max=\{MAX_ISSUE_ESTIMATE_HOURS\}/);
  assert.match(modal, /error=\{fieldErrors\.estimateHours\}/);

  const board = await read('src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  const handler = board.slice(
    board.indexOf('const handleCreateFullIssue'),
    board.indexOf('const handleMoveIssue'),
  );
  assert.doesNotMatch(handler, /showToast\([^\n]*Помилка/);
});

test('stable API codes map to human task-form messages', () => {
  assert.equal(
    userFacingErrorMessage({ code: 'INVALID_PROJECT_SCOPE', message: 'internal' }, 'fallback'),
    'Обраний проєкт недоступний у цій організації',
  );
  assert.equal(userFacingErrorMessage({ message: '  Детальна помилка  ' }, 'fallback'), 'Детальна помилка');
});

test('comment composers lock synchronously against a same-tick double submit', async () => {
  const [timeline, plus, workspace] = await Promise.all([
    read('src/components/workspace/UnifiedTimeline.jsx'),
    read('src/components/workspace/qtplus/chat/ChatComposer.jsx'),
    read('src/app/(app)/chat/page.js'),
  ]);
  for (const source of [timeline, plus, workspace]) {
    assert.match(source, /sendingRef\.current/);
    assert.match(source, /sendingRef\.current = true/);
    assert.match(source, /sendingRef\.current = false/);
  }
});

test('invalid issue bodies do not consume the 60-per-minute creation limit', async () => {
  const route = await read('src/app/api/issues/route.js');
  const titleValidation = route.indexOf("typeof data.title !== 'string'");
  const estimateValidation = route.indexOf("code: 'INVALID_ESTIMATE'");
  const limiter = route.indexOf("enforceRateLimit('issue-create'");
  assert.ok(titleValidation >= 0 && estimateValidation > titleValidation);
  assert.ok(limiter > estimateValidation);
  assert.match(route, /enforceRateLimit\('issue-create', authorization\.user\.uid, 60, 60\)/);
});

test('calendar rejects inverted ranges in the form and server normalizer', async () => {
  const [dialog, server] = await Promise.all([
    read('src/components/workspace/calendar/CalendarEventDialog.jsx'),
    read('src/lib/server/calendarEvents.js'),
  ]);
  assert.match(dialog, /if \(endAt <= startAt\) throw new Error\('Завершення має бути пізніше за початок'\)/);
  // What this is about is the order: the payload is built — and therefore the
  // range is validated — before anything is sent. The save now carries one more
  // field beside the payload (the project-roster consent), so it is the build
  // reaching `onSave` that is asserted, not the shape of its argument.
  assert.match(dialog, /payload = calendarEventFormPayload\(form, currentUserId\);[\s\S]*?await onSave\(\{\s*\.\.\.payload,/);
  assert.match(server, /if \(endAt\.toMillis\(\) <= startAt\.toMillis\(\)\)/);
});

test('recurring events expose occurrence scope without changing recurrence maths', async () => {
  const [hook, page, dialog, route, recurrence] = await Promise.all([
    read('src/lib/hooks/useCalendarEvents.js'),
    read('src/components/workspace/calendar/CalendarEventPage.jsx'),
    read('src/components/workspace/calendar/CalendarEventDialog.jsx'),
    read('src/app/api/calendar/events/[eventId]/route.js'),
    read('src/lib/utils/calendarRecurrence.mjs'),
  ]);
  assert.match(hook, /excludedOccurrenceStarts/);
  assert.match(page, /Лише це входження/);
  assert.match(page, /Кількість видимих входжень/);
  assert.match(dialog, /scope !== 'occurrence'/);
  assert.match(route, /body\.scope === 'occurrence'/);
  assert.match(route, /seriesOccurrenceStartAt: occurrenceStartAt/);
  assert.doesNotMatch(recurrence, /excludedOccurrenceStarts|seriesOccurrenceStartAt/);
});

test('authenticated workspace mounts one toast host', async () => {
  const layout = await read('src/app/(app)/layout.js');
  assert.equal(layout.match(/<WorkspaceToastHost\s*\/>/g)?.length, 1);
});
