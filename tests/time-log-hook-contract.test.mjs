import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('project time hooks clear old scope and ignore stale subscriptions', async () => {
  const [totalsHook, allLogsHook] = await Promise.all([
    read('src/lib/hooks/useProjectTimeLogs.js'),
    read('src/lib/hooks/useProjectAllTimeLogs.js'),
  ]);

  for (const source of [totalsHook, allLogsHook]) {
    assert.match(source, /let cancelled = false/);
    assert.match(source, /if \(cancelled\) return/);
    assert.match(source, /cancelled = true/);
    assert.match(source, /isValidRawTimeLogMinutes/);
  }
  assert.match(totalsHook, /setTotalMinutes\(0\)/);
  assert.match(totalsHook, /setByUser\(\{\}\)/);
  assert.match(allLogsHook, /setLogs\(\[\]\)/);
  assert.match(allLogsHook, /setByIssue\(\{\}\)/);
  assert.match(allLogsHook, /uniqueLogs/);
});
