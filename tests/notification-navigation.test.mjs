import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  notificationConversationId,
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
  assert.equal(notificationOpenLabel({ type: 'commented', issueId: 'issue-1' }), 'Відкрити чат завдання');
  assert.equal(notificationOpenLabel({ type: 'assigned', issueId: 'issue-1' }), 'Відкрити завдання');
  assert.equal(notificationOpenLabel({ type: 'deadline', issueId: 'issue-1' }), 'Відкрити завдання');
  assert.equal(notificationOpenLabel({ type: 'chat_message' }), 'Відкрити розмову');
  assert.equal(notificationOpenLabel({ type: 'calendar_reminder' }), 'Відкрити подію');
  assert.equal(notificationOpenLabel({ type: 'emergency' }), 'Відкрити профіль');
  // The same type reaches two different places; the task id is what tells them
  // apart, because a mention in the workspace chat has none.
  assert.equal(notificationOpenLabel({ type: 'mentioned', issueId: 'issue-1' }), 'Відкрити чат завдання');
  assert.equal(notificationOpenLabel({ type: 'mentioned' }), 'Відкрити розмову');
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
  // Both controls that do live inside it keep their own click to themselves.
  assert.match(card, /onClick=\{event => event\.stopPropagation\(\)\}>\{actions\}/);
  assert.match(card, /onClick=\{event => \{ event\.stopPropagation\(\); onDismiss\?\.\(\); \}\}/);
  // The badge on the sender's face could not separate twelve types across far
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

// Which conversation a bell record is about, without opening it.
test('a notification names its chat conversation, by field or by link', () => {
  // The field, on everything written since it existed.
  assert.equal(notificationConversationId({ channelId: 'general', link: '/chat?channel=general' }), 'general');
  // The link, on everything written before — those records are still in bells.
  assert.equal(notificationConversationId({ link: '/chat?channel=design&org=org-1' }), 'design');
  // A direct conversation is named by the person on the other side of it, which
  // is exactly what the chat pane calls that room.
  assert.equal(notificationConversationId({ link: '/chat?dm=user-7' }), 'user-7');
  // A thread reply belongs to the channel that holds the thread.
  assert.equal(notificationConversationId({ link: '/chat?channel=general&thread=msg-3' }), 'general');
  // Anything that is not a conversation names none.
  assert.equal(notificationConversationId({ link: '/qt/issue/QT-12?view=chat' }), '');
  assert.equal(notificationConversationId({ link: 'https://evil.example/chat?channel=general' }), '');
  assert.equal(notificationConversationId(null), '');
});

// The record that exists only to bring you somewhere you already are.
test('a channel marks its own bell records read while it is open', async () => {
  const [chatPage, route, chatHook] = await Promise.all([
    readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/api/notifications/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/hooks/useWorkspaceChat.js', import.meta.url), 'utf8'),
  ]);

  // The field the record could not carry before, written by the one route that
  // creates notifications and by the three places that announce a message.
  assert.match(route, /const channelId = cleanText\(payload\.channelId, 128\);/);
  assert.match(route, /organizationId, channelId,/);
  assert.match(chatPage, /channelId: activeChannel\.id,/);
  assert.match(chatHook, /channelId: uid,/);

  // Every conversation, not only the direct ones — that restriction is what
  // left a channel's records counting while the channel was on screen.
  assert.doesNotMatch(chatPage, /if \(activeChannel\.type !== 'dm' \|\| document\.visibilityState/);
  assert.match(chatPage, /notificationConversationId\(notification\) === activeChannel\.id/);
  assert.match(chatPage, /\(notification\.type === 'chat_message' \|\| notification\.type === 'mentioned'\)/);
  // Nothing is read in a tab nobody is looking at.
  assert.match(chatPage, /document\.visibilityState !== 'visible' \|\| !markNotificationRead/);
});
