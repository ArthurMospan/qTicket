import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('scheduled notifications require a production bearer secret', async () => {
  const source = await read('../src/app/api/cron/notifications/route.js');
  assert.match(source, /process\.env\.CRON_SECRET/);
  // Compared in constant time, the way the Telegram webhook secret and the API
  // keys already are — this was the last secret here still on `!==`.
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /presentedSecretMatches\(request\.headers\.get\('authorization'\), cronSecret\)/);
  assert.doesNotMatch(source, /!== `Bearer/);
  assert.match(source, /runScheduledNotificationSweep\(\{ mode: requested \}\)/);
});

test('a schedule invokes the notification sweep independently of a browser', async () => {
  // Vercel Hobby allows one cron run per day, so the five-minute sweep is
  // driven from GitHub Actions rather than vercel.json.
  const workflow = await read('../.github/workflows/scheduled-notifications.yml');
  const sweep = await read('../.github/scripts/sweep-notifications.sh');
  // Three schedules, because the three passes cost three different amounts:
  // delivery every minute, tidying hourly, and the scan once a night.
  assert.match(workflow, /cron: '\*\/5 \* \* \* \*'/);
  assert.match(workflow, /cron: '7 \* \* \* \*'/);
  assert.match(workflow, /cron: '11 3 \* \* \*'/);
  assert.match(workflow, /MODE: dispatch/);
  assert.match(workflow, /MODE: maintenance/);
  assert.match(workflow, /MODE: materialise/);
  assert.match(sweep, /\$\{APP_URL\}\/api\/cron\/notifications\?mode=\$\{MODE\}/);
  assert.match(sweep, /Authorization: Bearer \$\{CRON_SECRET\}/);

  // An unset secret must fail loudly instead of silently sending no header and
  // reading the endpoint's 401 as a healthy run.
  assert.match(sweep, /if \[ -z "\$\{CRON_SECRET\}" \]/);
  assert.match(sweep, /if \[ "\$\{status\}" != "200" \]/);

  await assert.rejects(read('../vercel.json'), /ENOENT/);

  const bridge = await read('../src/components/WorkspaceNotificationBridge.jsx');
  const header = await read('../src/components/WorkspaceHeader.jsx');
  assert.doesNotMatch(bridge, /\/api\/calendar\/reminders/);
  assert.doesNotMatch(header, /useDeadlineReminders/);
});

test('localhost can disconnect an existing Telegram binding without bot credentials', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  assert.match(
    settings,
    /\(!telegramBotStatus\.configured && !telegramBotStatus\.connected\)/,
  );
  assert.match(
    settings,
    /\(!telegramGroupStatus\.configured && !telegramGroupStatus\.connected\)/,
  );

  const route = await read('../src/app/api/integrations/telegram/route.js');
  const deleteHandler = route.slice(route.indexOf('export async function DELETE'));
  assert.match(deleteHandler, /\.collection\('private'\)\.doc\('telegram'\)\.delete\(\)/);
  assert.doesNotMatch(deleteHandler, /telegramStatus|ensureTelegramWebhook|TELEGRAM_BOT_TOKEN/);
});

test('development avoids persistent multi-tab leases while production keeps offline cache', async () => {
  const source = await read('../src/lib/firebase.js');
  assert.match(source, /process\.env\.NODE_ENV === 'development'/);
  assert.match(source, /\? memoryLocalCache\(\)/);
  assert.match(source, /: persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/);
});
