import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('every new time-log records a source title for resilient analytics labels', async () => {
  const [taskRoute, calendarRoute, importer, timesheet, workload] = await Promise.all([
    read('../src/app/api/issues/[issueId]/time-logs/route.js'),
    read('../src/app/api/calendar/events/[eventId]/time-logs/route.js'),
    read('../src/lib/server/youtrackImporter.js'),
    read('../src/components/workspace/TimesheetTab.jsx'),
    read('../src/components/workspace/WorkloadTab.jsx'),
  ]);

  assert.match(taskRoute, /sourceTitle: String\(issue\.title/);
  assert.match(taskRoute, /sourceKey: String\(issue\.issueKey/);
  assert.match(calendarRoute, /sourceTitle: String\(event\.title/);
  assert.match(importer, /sourceTitle: String\(sourceTitle/);
  assert.match(timesheet, /entry\.sourceTitle/);
  assert.match(workload, /log\.sourceTitle/);
});
