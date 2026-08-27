import test from 'node:test';
import assert from 'node:assert/strict';
import { timerTargetHref } from '../src/lib/utils/timerNavigation.mjs';

test('builds task timer links with optional log-time handoff', () => {
  const timer = { issueId: 'issue-1', issueKey: 'ENG-12', projectId: 'project-1', organizationId: 'org-1' };
  assert.equal(timerTargetHref(timer), '/project-1/issue/ENG-12?org=org-1');
  assert.equal(
    timerTargetHref(timer, { minutes: 17 }),
    '/project-1/issue/ENG-12?logTime=17&org=org-1',
  );
});

test('builds calendar event timer links without requiring a project', () => {
  const timer = {
    entityType: 'calendar_event',
    eventId: 'event/1',
    occurrenceStartAt: '2026-07-25T12:30:00.000Z',
    organizationId: 'org-1',
  };
  assert.equal(
    timerTargetHref(timer, { minutes: 9 }),
    '/calendar/event/event%2F1?occurrence=2026-07-25T12%3A30%3A00.000Z&logTime=9&org=org-1',
  );
});

test('does not add invalid time or build links for incomplete task timers', () => {
  assert.equal(
    timerTargetHref({ issueId: 'issue-1', projectId: 'project-1' }, { minutes: 0 }),
    '/project-1/issue/issue-1',
  );
  assert.equal(timerTargetHref({ issueId: 'issue-1' }, { minutes: 5 }), '');
});
