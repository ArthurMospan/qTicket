import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('calendar and every settings integration share the one-refresh authenticated request', async () => {
  const [calendar, settings, youtrack, issueLinks, invitations, portalSession, portalAccount] = await Promise.all([
    read('../src/lib/hooks/useCalendarEvents.js'),
    read('../src/app/(app)/settings/page.js'),
    read('../src/components/integrations/YouTrackImportCard.jsx'),
    read('../src/lib/hooks/useIssueLinks.js'),
    read('../src/lib/hooks/useOrganization.js'),
    read('../src/lib/portal/usePortalSession.js'),
    read('../src/lib/portal/qtplusAccount.js'),
  ]);

  for (const source of [calendar, settings, youtrack, issueLinks, invitations, portalSession, portalAccount]) {
    assert.match(source, /authenticatedRequest/);
  }
  assert.match(settings, /Не вдалося оновити інтеграцію BuggyBag/);
  assert.match(settings, /Не вдалося виконати запит до Telegram/);
  assert.match(settings, /toggleDisabled=\{buggyBagLoading\}/);
  assert.doesNotMatch(portalSession, /getIdToken\(/);
  assert.doesNotMatch(portalAccount, /getIdToken\(/);
});
