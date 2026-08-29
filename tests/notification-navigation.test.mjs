import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  notificationDestination,
  notificationOpenLabel,
  notificationDestinationWithOrganization,
  normalizeNotificationLink,
  withNotificationOrganization,
} from '../src/lib/utils/notificationNavigation.mjs';

test('adds organization context to app links', () => {
  assert.equal(
    withNotificationOrganization('/project-1/issue/issue-1', 'org-2'),
    '/project-1/issue/issue-1?org=org-2',
  );
});

test('preserves other query parameters and replaces stale organization context', () => {
  assert.equal(
    withNotificationOrganization('/project-1/issue/issue-1?logTime=5&org=old', 'org new'),
    '/project-1/issue/issue-1?logTime=5&org=org+new',
  );
});

test('rejects links outside the workspace', () => {
  for (const link of ['https://example.com', '//example.com', 'javascript:alert(1)', '/login', '/workspace\\evil']) {
    assert.equal(normalizeNotificationLink(link), '');
    assert.equal(withNotificationOrganization(link, 'org-1'), '');
  }
});

test('normalizes legacy workspace links', () => {
  assert.equal(withNotificationOrganization('/workspace/project-1/issue/issue-1', ''), '/project-1/issue/issue-1');
  assert.equal(withNotificationOrganization('/workspace?new=1', ''), '/?new=1');
});

test('a safe human-key link wins over legacy structured task metadata', () => {
  assert.equal(
    notificationDestination({
      link: '/project-1/issue/ENG-12',
      projectId: 'project-1',
      issueId: 'issue-1',
    }),
    '/project-1/issue/ENG-12',
  );
});

test('derives a scoped task destination when an old notification has no link', () => {
  assert.equal(
    notificationDestinationWithOrganization({
      projectId: 'project-1',
      issueId: 'issue-1',
      organizationId: 'org-1',
    }),
    '/project-1/issue/issue-1?org=org-1',
  );
});

test('keeps a calendar event deep link scoped to the right organization', () => {
  assert.equal(
    notificationDestinationWithOrganization({
      link: '/calendar/event/event-42?occurrence=2026-07-25T09%3A00%3A00.000Z',
      organizationId: 'org-1',
    }),
    '/calendar/event/event-42?occurrence=2026-07-25T09%3A00%3A00.000Z&org=org-1',
  );
});

// The card's button names its destination, and that is where the notification's
// type now lives.
test('a notification names its destination in words', () => {
  // The bell is shared with the external client, and there is one word for the
  // record, so the default and what a caller can pass are the same word.
  assert.equal(notificationOpenLabel({ type: 'commented', issueId: 'issue-1' }), 'Відкрити обговорення');
  assert.equal(notificationOpenLabel({ type: 'assigned', issueId: 'issue-1' }), 'Відкрити звернення');
  assert.equal(notificationOpenLabel({ type: 'deadline', issueId: 'issue-1' }), 'Відкрити звернення');
  assert.equal(
    notificationOpenLabel({ type: 'status_changed', issueId: 'issue-1' }, { record: 'звернення' }),
    'Відкрити звернення',
  );
  assert.equal(notificationOpenLabel({ type: 'emergency' }), 'Відкрити профіль');
  // Two deleted destinations, one rule. The planning calendar and the workspace
  // messenger are both gone, and a label that names a deleted screen is worse
  // than no label: it promises a page and delivers a redirect. Records still
  // carrying these types in people's bells fall back to the neutral word.
  for (const type of ['calendar_reminder', 'calendar_invite', 'calendar_changed', 'chat_message']) {
    assert.equal(notificationOpenLabel({ type }), 'Перейти', type);
  }
  // The same type reaches two different places; the request id is what tells
  // them apart.
  assert.equal(notificationOpenLabel({ type: 'mentioned', issueId: 'issue-1' }), 'Відкрити обговорення');
  assert.equal(notificationOpenLabel({ type: 'mentioned' }), 'Відкрити обговорення');
  // Nothing recognisable still gets a usable name.
  assert.equal(notificationOpenLabel({ type: 'test' }), 'Перейти');
  assert.equal(notificationOpenLabel(null), 'Перейти');
});

// What the card stopped saying, and why it could never have been saying it.
test('the notification card drops the two lines that carried nothing', async () => {
  const [card, header, notifications] = await Promise.all([
    readFile(new URL('../src/components/ui/Layout/NotificationCard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WorkspaceHeader.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/hooks/useNotifications.js', import.meta.url), 'utf8'),
  ]);

  // The organisation is filtered three times over on the way to this card — in
  // the query, before the popup fires, and again in the bell — so its name here
  // could only ever repeat what the header already says.
  assert.match(notifications, /where\('organizationId', '==', activeOrganizationId\)/);
  assert.match(notifications, /if \(n\.organizationId !== activeOrganizationIdRef\.current\) return;/);
  assert.match(header, /const scopedNotifications = notifications\.filter\(n => n\.organizationId === activeOrgId\)/);
  assert.doesNotMatch(card, /organizationName/);
  // And the capitalised category repeated the title in the product's own words.
  assert.doesNotMatch(card, /categoryLabel|categoryColor/);
  // The destination is still named — to a screen reader, as the second half of
  // the card's accessible name. It is no longer a 60px link inside a 320px card
  // whose only purpose is that destination: the card is the control, the way
  // the row for the same notification in the bell always was.
  assert.match(card, /aria-label=\{onOpen \? \[title, openLabel\]\.filter\(Boolean\)\.join\(' — '\) : undefined\}/);
  assert.match(card, /role=\{onOpen \? 'button' : undefined\}/);
  assert.match(card, /tabIndex=\{onOpen \? 0 : undefined\}/);
  assert.match(card, /onClick=\{onOpen\}/);
  assert.doesNotMatch(card, /<button onClick=\{onOpen\}/);
  // The one control that does live inside it keeps its own click to itself.
  assert.match(card, /onClick=\{event => \{ event\.stopPropagation\(\); onDismiss\?\.\(\); \}\}/);
  // There is no second one any more: the `actions` slot existed for the three
  // calendar reply buttons, which PATCHed `/api/calendar/events/[id]` — a route
  // deleted with the planning calendar, so the buttons could only ever be
  // refused. The slot went with them.
  assert.doesNotMatch(card, /\{actions\}/);
  assert.doesNotMatch(header, /calendarEventId/);
  assert.doesNotMatch(header, /fetch\(`\/api\/calendar/);
  assert.doesNotMatch(header, /'calendar_invite'|calendar_invite:/);
  // The badge on the sender's face could not separate the types across far
  // fewer glyphs, so the face is drawn on its own.
  assert.doesNotMatch(header, /absolute -bottom-\[3px\] -right-\[3px\]/);
});

// Three notifications in ten seconds used to be one card and two flashes.
test('live notification cards stand in a stack, one countdown each', async () => {
  const [store, header, card, bridge] = await Promise.all([
    readFile(new URL('../src/store/useWorkspaceStore.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WorkspaceHeader.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/Layout/NotificationCard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WorkspaceNotificationBridge.jsx', import.meta.url), 'utf8'),
  ]);

  // A list bounded at three, not a slot that the next arrival overwrites.
  assert.match(store, /const LIVE_NOTIF_LIMIT = 3;/);
  assert.match(store, /liveNotifs: \[\]/);
  assert.doesNotMatch(store, /_liveNotifTimer:/);
  // Bounded at three conversations, not three messages: what the stack holds is
  // one card per conversation, and the card carries the count.
  assert.match(store, /const next = \[\.\.\.kept, card\]\.slice\(-LIVE_NOTIF_LIMIT\);/);
  // One countdown per card, so an arrival cannot cut the card before it short.
  assert.match(store, /const liveNotifTimers = new Map\(\);/);
  assert.match(store, /dismissLiveNotif: \(id\) => \{/);
  // And the countdown is spent in front of somebody: a hidden tab holds it.
  assert.match(store, /if \(tabIsVisible\(\)\) runLiveNotifTimer\(notif\.id, expire\);/);
  assert.match(store, /entry\.remaining = Math\.max\(400, entry\.remaining - \(Date\.now\(\) - entry\.startedAt\)\);/);
  assert.match(bridge, /document\.addEventListener\('visibilitychange', syncVisibility\);/);
  assert.match(bridge, /if \(document\.visibilityState === 'visible'\) resumeLiveNotifs\(\);/);

  // The corner is the stack's, so two cards cannot sit on top of each other.
  assert.match(header, /\{liveNotifs\.map\(card => \(/);
  assert.match(header, /className="fixed bottom-\[72px\] right-\[12px\] flex flex-col items-end gap-2 md:bottom-5 md:right-\[24px\]"/);
  assert.doesNotMatch(card, /fixed bottom-\[72px\]/);
});

// The record that exists only to bring you somewhere you already are.
test('an incident marks its own bell records read while it is open', async () => {
  const [timeline, route] = await Promise.all([
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/api/notifications/route.js', import.meta.url), 'utf8'),
  ]);

  // The record names the incident it belongs to, written by the one route that
  // creates notifications.
  assert.match(route, /issueId, projectId,|issueId,/);
  assert.match(timeline, /notification\.issueId === issueId/);
  assert.match(timeline, /notification\.type === 'commented'\s*\|\| notification\.type === 'mentioned'/);
  // Nothing is read in a tab nobody is looking at.
  assert.match(timeline, /if \(!isActive \|\| !tabVisible\) return;\s*dismissIssueNotifications\(\);/);
});
