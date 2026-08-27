import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  analyticsDateKey,
  analyticsDateParam,
  analyticsPeriodParam,
  analyticsTabParam,
  commaListParam,
  memberViewParam,
  setSearchParam,
  timesheetModeParam,
} from '../src/lib/utils/analyticsUrlState.mjs';

test('analytics URL values are validated before they become screen state', () => {
  assert.equal(analyticsTabParam('timesheet'), 'timesheet');
  assert.equal(analyticsTabParam('billing'), 'overview');
  assert.equal(analyticsTabParam('billing', { billing: true }), 'billing');
  assert.equal(analyticsTabParam('not-a-tab'), 'overview');
  assert.equal(analyticsPeriodParam('14'), 14);
  assert.equal(analyticsPeriodParam('31'), 30);
  assert.equal(memberViewParam('timesheet'), 'timesheet');
  assert.equal(memberViewParam('ranking'), 'overview');
  assert.equal(timesheetModeParam('month'), 'month');
  assert.equal(timesheetModeParam('quarter'), 'week');
  assert.deepEqual(commaListParam('p1,p2,p1,,'), ['p1', 'p2']);
});

test('analytics URL dates are local calendar dates, not parsed as UTC instants', () => {
  const fallback = new Date(2026, 7, 24);
  assert.equal(analyticsDateKey(analyticsDateParam('2026-03-15', fallback)), '2026-03-15');
  assert.equal(analyticsDateKey(analyticsDateParam('2026-02-31', fallback)), '2026-08-24');
  assert.equal(analyticsDateKey(analyticsDateParam('broken', fallback)), '2026-08-24');
});

test('default analytics URL values are omitted while organization context survives', () => {
  const params = new URLSearchParams('org=org-a&tab=timesheet');
  setSearchParam(params, 'tab', 'overview', 'overview');
  setSearchParam(params, 'period', 30, 30);
  setSearchParam(params, 'projects', ['p1', 'p2']);
  assert.equal(params.toString(), 'org=org-a&projects=p1%2Cp2');
});

test('workspace and member analytics synchronize durable state with browser history', async () => {
  const [workspace, member] = await Promise.all([
    readFile(new URL('../src/app/(app)/analytics/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/(app)/analytics/team/[memberId]/page.js', import.meta.url), 'utf8'),
  ]);

  for (const source of [workspace, member]) {
    assert.match(source, /useSearchParams/);
    assert.match(source, /window\.history\.replaceState/);
    assert.match(source, /window\.history\.pushState/);
  }
  assert.match(workspace, /analyticsTabParam\(params\.get\('tab'\)/);
  assert.match(member, /memberViewParam\(params\.get\('view'\)\)/);
});
