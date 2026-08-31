import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('scheduled notifications require a production bearer secret', async () => {
  const source = await read('../src/app/api/cron/notifications/route.js');
  assert.match(source, /process\.env\.CRON_SECRET/);
  // Compared in constant time — this was the last secret here still on `!==`.
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

test('qTicket delivers notifications in the app and nowhere else', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  const notificationSection = settings.slice(
    settings.indexOf("case 'notifications'"),
    settings.indexOf("case 'localization'"),
  );
  // Three cards, one per channel, from one factory — the shape QuickTeam has
  // shown for a year. A card per channel is the question people arrive with:
  // «що саме мені шле Telegram?».
  assert.match(notificationSection, /channelCard\(\{/);
  assert.match(notificationSection, /notifMatrix\[id\]\[row\.key\]/);
  assert.match(notificationSection, /setChannelEvent\(id, row\.key, value\)/);
  assert.match(notificationSection, /title: 'На сайті'/);
  assert.match(notificationSection, /title: 'Email'/);
  assert.match(notificationSection, /title: 'Telegram'/);

  // Email is drawn even where it cannot deliver, and says why rather than
  // vanishing: a hidden card is how «а куди мені шле листи?» became a question
  // with no screen to answer it. The switch is disabled, not absent.
  assert.match(notificationSection, /disabled=\{!emailDeliveryConfigured\}/);
  assert.match(settings, /const emailDeliveryConfigured = process\.env\.NEXT_PUBLIC_EMAIL_DELIVERY_ENABLED === 'true'/);

  // The Telegram switch *is* the connection — no separate «Підключити» button.
  // Linked-but-silent and enabled-but-unlinked are two states nobody wants and
  // everybody creates by accident.
  assert.match(notificationSection, /onChange=\{toggleTelegram\}/);
  assert.match(settings, /if \(telegramBotStatus\.connected\) \{\s*await disconnectTelegram\(\);/);
});

test('the Telegram channel delivers and never files a request', async () => {
  const [server, webhook, route] = await Promise.all([
    read('../src/lib/server/telegram.js'),
    read('../src/app/api/integrations/telegram/webhook/route.js'),
    read('../src/app/api/notifications/route.js'),
  ]);

  // QuickTeam's bot also takes a task command in a group chat and files an
  // issue from it. That half is deliberately absent: only a client opens a
  // request, from their own project, so a desk can always say who asked for
  // what — and a room in a group chat is not a client.
  // Asked of the code, not of the file: the comments explain what was left out
  // and why, and a note about an absent feature is not the feature.
  assert.doesNotMatch(server, /^export (async )?function createIssueFromTelegram/m);
  assert.doesNotMatch(server, /collection\('telegramChats'\)/);
  assert.doesNotMatch(webhook, /^async function connectGroup/m);
  assert.doesNotMatch(webhook, /collection\('telegramChats'\)/);
  assert.match(webhook, /message\.chat\?\.type !== 'private'/);

  // The webhook is authenticated by Telegram's own secret header, compared in
  // constant time, and the connect token is spent inside a transaction so two
  // updates arriving together cannot both claim it.
  assert.match(server, /timingSafeEqual/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/);
  assert.match(webhook, /runTransaction/);

  // Delivery hangs off the same per-event switches as the bell.
  assert.match(route, /const telegramAudience = audienceFor\('telegram'\)/);
  assert.match(route, /deliverTelegramNotification\(/);
});

test('development avoids persistent multi-tab leases while production keeps offline cache', async () => {
  const source = await read('../src/lib/firebase.js');
  assert.match(source, /process\.env\.NODE_ENV === 'development'/);
  assert.match(source, /\? memoryLocalCache\(\)/);
  assert.match(source, /: persistentLocalCache\(\{ tabManager: persistentMultipleTabManager\(\) \}\)/);
});
