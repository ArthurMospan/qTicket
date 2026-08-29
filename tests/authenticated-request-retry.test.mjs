import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('every screen that calls the API shares the one-refresh authenticated request', async () => {
  const [calendar, settings, issueLinks, invitations] = await Promise.all([
    read('../src/lib/hooks/useCalendarEvents.js'),
    read('../src/app/(app)/settings/page.js'),
    read('../src/lib/hooks/useIssueLinks.js'),
    read('../src/lib/hooks/useOrganization.js'),
  ]);

  for (const source of [calendar, settings, issueLinks, invitations]) {
    assert.match(source, /authenticatedRequest/);
  }
});
