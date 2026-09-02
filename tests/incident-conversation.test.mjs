// tests/incident-conversation.test.mjs
//
// The one conversation qTicket has: the thread inside an incident, read by the
// client who opened it and by the support agent working it, with nothing in it
// that only one of them can see.
//
// This file used to be `workspace-chat.test.mjs` and covered two conversations
// — a corporate messenger with channels, direct rooms, threads and pinned files,
// and the incident timeline that had borrowed half its parts. The messenger is
// deleted. What is left here is everything that was ever about the incident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isConversationOnScreen } from '../src/lib/utils/notificationPresence.mjs';
import {
  attachmentKind,
  attachmentKindLabel,
  formatMediaTime,
  isMediaKind,
  isVisualKind,
} from '../src/lib/utils/attachmentKinds.mjs';
import { activeTypingUserIds } from '../src/lib/utils/workspaceChat.mjs';
import { PERMISSIONS } from '../src/lib/utils/can.js';

const UID_A = 'Aa1bb2cc3dd4ee5ff6gg7hh8ii9j';
const UID_B = 'Zz9yy8xx7ww6vv5uu4tt3ss2rr1q';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// ── One thread, both sides of the desk ───────────────────────────────────────

// The owner's decision, and the whole point of this slice: everything support
// writes in an incident, the client reads. An internal note is not a feature
// that was turned off — there is no collection, no flag and no composer for it.
test('an incident carries one conversation and no staff-only half of it', async () => {
  const [comments, timeline, rules, can] = await Promise.all([
    read('../src/lib/hooks/useComments.js'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../firestore.rules'),
    read('../src/lib/utils/can.js'),
  ]);

  // No second collection to write into, and no flag on the documents in the
  // first one. Both existed: `internalNotes` was separately ruled precisely
  // because a field inside `comments` would not have been a boundary.
  assert.doesNotMatch(comments, /internalNotes/);
  assert.doesNotMatch(comments, /includeInternal/);
  assert.doesNotMatch(comments, /visibility/);
  assert.doesNotMatch(rules, /internalNotes/);
  assert.doesNotMatch(rules, /get\('visibility', 'public'\)/);

  // No selector above the composer, no badge on a message, and no upload folder
  // that only staff could reach.
  assert.doesNotMatch(timeline, /Внутрішня нотатка/);
  assert.doesNotMatch(timeline, /composerVisibility/);
  assert.doesNotMatch(timeline, /internal-notes/);
  assert.doesNotMatch(timeline, /visibility: draft\.visibility/);

  // And no permission describing a right nothing enforces any more. The matrix
  // is documentation that must stay true: an entry nothing consults can say
  // anything and stay unfalsifiable.
  assert.doesNotMatch(can, /access:internal_notes/);
  assert.ok(!('access:internal_notes' in PERMISSIONS));
});

// What did *not* go with the notes. The support side still has a private
// record — who reassigned the incident, who moved it, when — and it is the
// change history, not the conversation.
test('the change history stays support-side, and it is the only thing that does', async () => {
  const [timeline, rules] = await Promise.all([
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../firestore.rules'),
  ]);

  assert.deepEqual(PERMISSIONS['access:audit_log'], ['owner', 'admin', 'member']);
  // The screen reads the answer out of the matrix rather than re-deriving it,
  // so it and `firestore.rules` cannot drift apart about what a client opens.
  assert.match(timeline, /const internalViewer = can\(orgRole, 'access:audit_log'\);/);
  assert.match(timeline, /useAuditLog\(internalViewer \? issueId : null/);
  // A client never starts a query the rules would only refuse.
  assert.match(rules, /match \/audit\/\{auditId\} \{\s*\n(?:.*\n)*?\s*allow read: if isInternalContributor\(issueOrg\(issueId\)\)/);
});

// Everybody who can read the incident can be named in it. The composer used to
// hold a second, narrower list for a note nobody outside support could see;
// with one shared thread, hiding the client from the picker would offer a
// privacy the message itself does not have.
test('the mention picker offers everyone the conversation reaches', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  assert.match(timeline, /const composerMentionMembers = mentionMembers \|\| members;/);
  assert.doesNotMatch(timeline, /internalMentionMembers/);
  assert.doesNotMatch(timeline, /isClientRole\(member\.role\)/);
});

// ── The parts of the kit the conversation still owns ─────────────────────────

test('typing flags expire so a crashed tab cannot pin the indicator', () => {
  const channel = { typing: [UID_A, UID_B], typingAt: { [UID_A]: 1_000, [UID_B]: 9_000 } };
  assert.deepEqual(activeTypingUserIds(channel, { now: 10_000, ttlMs: 8000 }), [UID_B]);
  assert.deepEqual(activeTypingUserIds(channel, { now: 10_000, ttlMs: 8000, exclude: UID_B }), []);
  // Documents written before `typingAt` existed carry no heartbeat.
  assert.deepEqual(activeTypingUserIds({ typing: [UID_A] }, { now: 10_000 }), []);
});

// The conversation and the materials list answer "what is this file" with one
// resolver, so this list is the contract for both. Office's own MIME types are
// the reason the map exists: nothing about `…spreadsheetml.sheet` says
// «таблиця», and a raw upload arrives as application/octet-stream with only its
// name to go on.
test('attachment kinds cover the families a workspace actually receives', () => {
  assert.equal(attachmentKind({ name: 'notes.docx' }), 'doc');
  assert.equal(attachmentKind({ name: 'кошторис.xlsx' }), 'sheet');
  assert.equal(attachmentKind({ name: 'звіт.csv' }), 'sheet');
  assert.equal(attachmentKind({ name: 'deck.pptx' }), 'slides');
  assert.equal(attachmentKind({ name: 'макети.zip' }), 'archive');
  assert.equal(attachmentKind({ name: 'schema.json' }), 'code');
  assert.equal(attachmentKind({ name: 'нотатки.txt' }), 'text');
  assert.equal(attachmentKind({ name: 'дзвінок.m4a' }), 'audio');
  assert.equal(attachmentKind({ name: 'дамп.bin' }), 'file');
  assert.equal(attachmentKind({ type: 'image/png' }), 'image');
  assert.equal(attachmentKind({ resourceType: 'video' }), 'video');
  assert.equal(attachmentKind({ url: 'https://cdn.test/file.pdf?download=1' }), 'pdf');
  assert.equal(
    attachmentKind({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    'sheet',
  );
  // The declared type wins over the name, and a query string is not an extension.
  assert.equal(attachmentKind({ name: 'report.pdf', mimeType: 'image/png' }), 'image');
  assert.equal(attachmentKind({ url: 'https://cdn.test/a/b?name=x.zip' }), 'file');
});

test('a kind knows what it is called and how it may be shown', () => {
  assert.equal(attachmentKindLabel('sheet'), 'Таблиця');
  assert.equal(attachmentKindLabel('nonsense'), 'Файл');
  // «Медіа» means image, video or audio — not "anything with a preview", which
  // would have swept PDFs in with the photos.
  assert.equal(isMediaKind('audio'), true);
  assert.equal(isMediaKind('pdf'), false);
  assert.equal(isVisualKind('video'), true);
  assert.equal(isVisualKind('audio'), false);
});

test('media time is clock-shaped and survives unknown durations', () => {
  assert.equal(formatMediaTime(0), '0:00');
  assert.equal(formatMediaTime(67), '1:07');
  assert.equal(formatMediaTime(3671), '1:01:11');
  // A browser reports NaN until it has read the metadata, and the player draws
  // that state on every card before the first byte arrives.
  assert.equal(formatMediaTime(NaN), '0:00');
});

// A file on a message is delivered like every other file the product stores.
// The one folder that used Cloudinary's `authenticated` type belonged to the
// workspace messenger and needed a route of its own to sign each read; signing
// anything closed now would produce a file nothing in the app can open again.
test('an attachment in an incident is a plain upload with no signing route behind it', async () => {
  const [list, sign] = await Promise.all([
    read('../src/components/ui/Chat/ChatAttachmentList.jsx'),
    read('../src/app/api/upload/sign/route.js'),
  ]);

  assert.match(list, /const url = previewUrl \|\| attachmentUrl\(attachment\);/);
  assert.doesNotMatch(list, /useChatAttachmentAccess/);
  assert.match(sign, /const deliveryType = 'upload';/);
  assert.doesNotMatch(sign, /isOrganizationChatUploadFolder/);
});

// ── Mentions ─────────────────────────────────────────────────────────────────

test('the conversation reads back the incident mentions its own composer writes', async () => {
  const [mentionText, timeline, menu, mentionChip, hoverCardChip] = await Promise.all([
    read('../src/components/workspace/MentionText.jsx'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/components/ui/Chat/IssueMentionMenu.jsx'),
    read('../src/components/workspace/IssueMentionChip.jsx'),
    read('../src/components/workspace/HoverCard.jsx'),
  ]);

  assert.match(timeline, /<IssueMentionMenu/);
  assert.match(mentionText, /<IssueMentionChip/);
  assert.match(menu, /issue\.issueKey/);
  // A mentioned incident reads like a mentioned person: the same neutral chip,
  // no colour of its own.
  assert.doesNotMatch(menu, /tone="accent"/);
  assert.doesNotMatch(mentionChip, /#c026d3|#fdf4ff/);
  // One shape, defined once, rather than two that happen to agree today.
  assert.match(mentionChip, /mentionChipClass \} from '\.\/HoverCard'/);
  assert.match(mentionChip, /className=\{mentionChipClass\(\{ dark \}\)\}/);
  assert.match(hoverCardChip, /export function mentionChipClass/);
  assert.match(hoverCardChip, /bg-black\/\[0\.06\]/);
  // The chip is an inline-block, and that is what makes the name in it sit on
  // the sentence's own baseline: an inline-block takes the baseline of the text
  // inside it. A flex chip has none to offer — its first item is a face — so the
  // browser synthesises one, and the sentence steps where anybody is named.
  assert.match(hoverCardChip, /relative inline-block whitespace-nowrap rounded-full/);
  assert.match(hoverCardChip, /align-baseline/);
  // Two things would silently take that baseline away again. Measured in the
  // browser: a line carrying a capsule is 22.75px, and 26.75px the instant that
  // capsule clips — so a long name is shortened as a string, by `useFittedLabel`
  // against the width the capsule really has, and never clipped as a box.
  assert.doesNotMatch(hoverCardChip, /mentionChipClass[\s\S]{0,400}overflow-hidden/);
  assert.match(hoverCardChip, /useFittedLabel\(fullName\)/);
  assert.match(mentionChip, /useFittedLabel\(fullTitle\)/);
  assert.match(hoverCardChip, /MENTION_CHIP_BADGE = 'absolute/);
  assert.match(hoverCardChip, /className="relative inline-block align-baseline"/);
  // The composer asks the same tokenizer the reader does, rather than carrying
  // a second copy of the rules about what a mention is.
  assert.match(mentionText, /tokenizeMessageLine\(text, \{ memberNames, formatting: false \}\)/);
  // The very same component, not a lookalike span: a person named in an
  // incident has a profile behind their name.
  assert.match(mentionText, /<HoverCard\b/);
  assert.doesNotMatch(mentionText, /mentionChipClass/);
  // And it survives a dark bubble: an own message here is white on near-black,
  // where a black tint is invisible.
  assert.match(mentionText, /dark=\{dark\}/);
  // A mentioned incident says what it is called, resolved with an exact-key
  // lookup and never with search. Search cannot know which documents match a
  // word, so it reads every incident, client, membership and event in the
  // organization; paying that per capsule exhausted a day's read quota in an
  // afternoon.
  assert.match(mentionChip, /\/api\/issues\/lookup\?/);
  assert.doesNotMatch(mentionChip, /api\/search/);
  assert.match(mentionChip, /openIssueQuickView\(issue\)/);
  assert.doesNotMatch(mentionChip, /collection\(db, 'issues'\)/);
  // A lookup that could not be made is not an answer. Caching it meant a
  // conversation opened before Firebase restored the session never resolved a
  // mention again.
  assert.match(mentionChip, /resolved\.delete\(`\$\{userId\}:\$\{organizationId\}:\$\{key\}`\)/);
});

// Only what *matched* is a mention or an incident. `String.split` with a
// capturing group hands back the text between the matches too, and deciding
// what a piece is by its first character therefore turned «@ у розмові» — a
// sentence that matched nothing — into a capsule naming somebody called
// « у розмові».
test('a message draws capsules only where something actually matched', async () => {
  const content = await read('../src/components/workspace/MessageContent.jsx');

  assert.match(content, /tokenizeMessageLine\(line, \{ memberNames \}\)/);
  assert.doesNotMatch(content, /part\.startsWith\('@'\)/);
  assert.match(content, /<IssueMentionChip/);
});

// ── The unread line ──────────────────────────────────────────────────────────

test('the unread boundary waits for the cursor, and stops repeating itself', async () => {
  const [timeline, bridge, store] = await Promise.all([
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/components/IssueReadStateBridge.jsx'),
    read('../src/store/useWorkspaceStore.js'),
  ]);

  // An empty cursor map means two opposite things — «nothing has been opened»
  // and «the cursors have not arrived» — and a timeline that cannot tell them
  // apart reads its whole history as unread and sends the reader to the day the
  // incident was created. That is «9 нових» pointing at the top of a quiet one.
  assert.match(store, /issueReadStateLoaded: false/);
  assert.match(bridge, /resetIssueReadState\(\)/);
  assert.match(timeline, /if \(!myId \|\| !readCursorsLoaded\) return \[\]/);
  // Three subscriptions settle in three renders; a line latched off the first
  // of them names the wrong item.
  assert.match(timeline, /const feedSettled = \(readCursorsLoaded \|\| cursorWaitIsOver\)/);
  // Waiting for those cursors is right; waiting forever is not. A network that
  // cannot answer must not leave the conversation unplaced — which is the
  // scroller sitting at the very top of the incident's whole history.
  assert.match(timeline, /setWaitedOutFor\(issueId\), 2500/);
  assert.match(timeline, /isActive && feedSettled && !boundary\.key && liveFirstUnreadKey/);
  // The effect that places the conversation has to watch the line, or the wait
  // for it never ends and the scroller stays where an unplaced one sits — the
  // very top.
  assert.match(timeline, /\}, \[feedSettled, isActive, issueId, sessionBoundary, syncScrollPosition, timeline\.length\]\);/);
  // The line says no number at all, and the jump control says a live one. A
  // frozen «2» stood over four messages, two of them the reader's own.
  assert.doesNotMatch(timeline, /\{boundaryCount\} нових/);
  assert.match(timeline, /plural\(unreadTotal, \['нове', 'нові', 'нових'\]\)/);
  // One control, two jobs: the unread line while there is one off screen, the
  // end of the conversation for a reader who has climbed into the history.
  assert.match(timeline, /if \(isScrolledUp\) return \{ to: 'bottom', label: 'До останнього'/);
  // And the line is not taken down by putting a mouse pointer on it — a phone
  // has no pointer to put anywhere, so there it was permanent for the visit.
  assert.doesNotMatch(timeline, /onMouseEnter=\{boundary\.read \? dismissBoundary : undefined\}/);
});

// Answering is reading, and every messenger has always treated it that way.
test('sending a message reads the conversation and takes the line down', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  // Reading happens where the message is handed to the conversation, which is
  // now before the write rather than after it — editing returns earlier, so
  // nothing here can reach an edit.
  assert.match(timeline, /setPendingMessages\(current =>[\s\S]{0,700}?consumeConversation\(\);[\s\S]{0,40}?dismissBoundary\(\);/);
  // And the reader lands on their own message wherever they were standing.
  assert.match(timeline, /wasNearBottomRef\.current = true;[\s\S]{0,40}?setIsScrolledUp\(false\);[\s\S]{0,40}?scrollToBottom\(\);/);
  // One place decides what «read» means, so three callers cannot each remember
  // their own half of it.
  assert.match(timeline, /const consumeConversation = useCallback\(\(\) => \{/);
  // The records in the bell are not this screen's to read: it publishes the
  // conversation it shows, and the notification stream settles them with the
  // same rule for every type the incident produces.
  assert.doesNotMatch(timeline, /dismissIssueNotifications/);
  assert.match(timeline, /const conversation = \{ kind: 'issue', id: issueId \};/);
});

// One person speaking without interruption is drawn as one run.
test('consecutive messages from one author share a name and a face', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  assert.match(timeline, /const RUN_WINDOW_MS = 5 \* 60 \* 1000;/);
  assert.match(timeline, /function continuesRun\(previous, next\)/);
  // The name opens the run, the face closes it, and the tail marks the end.
  assert.match(timeline, /\{!isMe && startsRun &&/);
  assert.match(timeline, /\{!endsRun \? null : isExternalAuthor \?/);
  assert.match(timeline, /endsRun \? \(isMe \? 'rounded-br-none' : 'rounded-bl-none'\) : ''/);
  // A day break or the unread line ends a run wherever it falls.
  assert.match(timeline, /`comment-\$\{item\.id\}` === sessionBoundary/);
});

// A list that grows under a reader at the end of it has to keep them there.
test('the feed corrects itself when its own height changes', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  assert.match(timeline, /new ResizeObserver\(/);
  assert.match(timeline, /observer\.observe\(feed\);/);
  // It stands down until the conversation has been placed: during placement the
  // list is on its way to the unread line, not to the bottom.
  assert.match(timeline, /if \(positionedIssueRef\.current !== issueId \|\| !wasNearBottomRef\.current\) return;/);
  // Where the reader stands is read off the scroller, not remembered from the
  // last scroll event — a list placed by code never fires one.
  assert.match(timeline, /const syncScrollPosition = useCallback/);
  assert.match(timeline, /const AT_BOTTOM_SLACK = 80;/);
});

// ── Cost ─────────────────────────────────────────────────────────────────────

// What a client card costs to draw.
test('a client card counts what is new without reading anything', async () => {
  const dashboard = await read('../src/app/(app)/page.js');

  // Two live listeners *per card*: the entire message history of
  // `project_<id>` and its read cursor — over a channel the product stopped
  // writing to, so the dashboard read a dead conversation's whole history, once
  // per client, for a number that could only ever be zero.
  assert.doesNotMatch(dashboard, /project_\$\{project\.id\}/);
  assert.doesNotMatch(dashboard, /onSnapshot\(query\(messagesRef\)/);
  // The fact the card still draws is already in the notification stream the
  // layout subscribes to once and the sidebar's dot already reads.
  assert.doesNotMatch(dashboard, /item\.type === 'chat_message'/);
  assert.match(dashboard, /item\.type === 'mentioned'/);
  assert.match(dashboard, /const notifications = useWorkspaceStore\(state => state\.notifications\)/);
});

// The workspace opened two Firestore listeners per signed-in agent — every
// channel document in the organization and every read cursor of theirs — to put
// a number beside a screen the product no longer has. Both are gone with it.
test('nothing in the workspace subscribes to a channel any more', async () => {
  const [sidebar, bridge, store, title] = await Promise.all([
    read('../src/components/WorkspaceSidebar.jsx'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
    read('../src/store/useWorkspaceStore.js'),
    read('../src/components/WorkspaceDocumentTitle.jsx'),
  ]);

  for (const [name, source] of Object.entries({ sidebar, bridge, title })) {
    assert.doesNotMatch(source, /useUnreadChatCount/, name);
    assert.doesNotMatch(source, /unreadChatCount/, name);
  }
  assert.doesNotMatch(store, /unreadChatCount/);
  assert.doesNotMatch(store, /chatOnlineUsers/);
  assert.doesNotMatch(store, /chatSearch/);
  // The tab's badge did not go with it: the bell's own count for the
  // organization on screen is the unread the product has left, and the bridge
  // already publishes it.
  assert.match(title, /state\.notificationUnreadByOrg\[activeOrgId\] \|\| 0/);
  assert.match(bridge, /useOrganizationUnreadCounts\(\);/);
});

// An incident's history is not read whole to show the end of it.
test('an incident opens on a window of its history, not all of it', async () => {
  const [audit, comments, timeline] = await Promise.all([
    read('../src/lib/hooks/useAuditLog.js'),
    read('../src/lib/hooks/useComments.js'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
  ]);

  // The audit log read the subcollection whole, sorted it in the browser and
  // kept fifty — so four hundred recorded changes cost four hundred reads to
  // draw fifty rows, and the cost grew every time anybody touched the incident.
  assert.match(audit, /orderBy\('createdAt', 'desc'\),\s*\n\s*limit\(windowSize\)/);
  assert.doesNotMatch(audit, /docs\.slice\(0, LIMIT\)/);
  assert.match(comments, /orderBy\('createdAt', 'desc'\),\s*\n\s*limit\(windowSize\)/);
  // Windowed, not truncated: what is not loaded is still reachable.
  assert.match(timeline, /setHistoryWindow\(current => current \+ 1\)/);
  assert.match(timeline, /hasOlderHistory/);
  assert.match(timeline, /<LoadOlderButton/);
});

// ── The card in the corner ───────────────────────────────────────────────────

// A message that arrives on the screen you are looking at.
test('the live popup stays down for the conversation already on screen', () => {
  const comment = { type: 'commented', issueId: 'issue-1' };
  assert.equal(isConversationOnScreen(comment, { kind: 'issue', id: 'issue-1' }), true);
  assert.equal(isConversationOnScreen(comment, { kind: 'issue', id: 'issue-2' }), false);
  // Every kind of notification an incident produces resolves to that incident,
  // so a mention inside the conversation you are reading is quiet too.
  assert.equal(
    isConversationOnScreen({ type: 'mentioned', issueId: 'issue-1' }, { kind: 'issue', id: 'issue-1' }),
    true,
  );
  // There is one kind of conversation left, so there is one kind to match. A
  // record naming no incident names nothing that can be on screen.
  assert.equal(isConversationOnScreen({ type: 'chat_message', actorId: 'user-7' }, { kind: 'dm', id: 'user-7' }), false);
  assert.equal(isConversationOnScreen({ type: 'commented' }, { kind: 'issue', id: 'issue-1' }), false);
  // Nothing at all silences an emergency — that is the one notification whose
  // whole job is to interrupt.
  assert.equal(
    isConversationOnScreen({ type: 'emergency', issueId: 'issue-1' }, { kind: 'issue', id: 'issue-1' }),
    false,
  );
  // Nothing open, nothing suppressed.
  assert.equal(isConversationOnScreen(comment, null), false);
  assert.equal(isConversationOnScreen(comment, { kind: 'issue', id: '' }), false);
});

// The pane showing a conversation publishes it, and the bridge is the only
// thing that reads it back.
test('the pane showing a conversation says so, and the popup asks before it fires', async () => {
  const [timeline, bridge] = await Promise.all([
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
  ]);

  assert.match(timeline, /const conversation = \{ kind: 'issue', id: issueId \};/);
  assert.match(timeline, /setVisibleConversation\(conversation\);/);
  // Registered only while the pane is actually on screen: below lg the incident
  // page keeps the timeline mounted behind the detail pane.
  assert.match(timeline, /if \(!isActive \|\| !issueId\) return undefined;/);
  assert.match(bridge, /isConversationOnScreen\(notification, useWorkspaceStore\.getState\(\)\.visibleConversation\)/);
  // And only while the tab is in front. A conversation left open in a
  // background tab is not a conversation somebody is reading, and treating it
  // as one swallowed the card that should have been waiting on return.
  assert.match(bridge, /document\.visibilityState === 'visible'/);
});

// The check that suppresses the card has to suppress the chime as well — and
// settle the record, which is the same question asked a third time.
test('nothing announces a message arriving in the conversation on screen', async () => {
  const [hook, bridge] = await Promise.all([
    read('../src/lib/hooks/useNotifications.js'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
  ]);

  // The gate stands before the chime, not between the chime and the popup —
  // which is where it used to stand, so the card was suppressed and the sound
  // played anyway on the very incident page the message had landed on.
  const announceGate = hook.indexOf('if (witnessed.has(n.id)) return;');
  const chime = hook.indexOf('playChime()', hook.indexOf('const prefs = prefsRef.current'));
  assert.ok(announceGate > 0, 'the hook asks whether the reader witnessed it');
  assert.ok(announceGate < chime, 'and asks before it plays anything');
  // A witnessed record is not a notification: it leaves before the list the
  // panel draws is published, and what was already waiting is published read —
  // so the counter never draws either unread.
  assert.match(hook, /const kept = witnessed\.size \? docs\.filter\(n => !witnessed\.has\(n\.id\)\) : docs;/);
  assert.match(hook, /publish\(settleOnScreen\(kept\)/);
  // One decision, passed in by the only component that knows what is on screen.
  assert.match(bridge, /readerIsWatching,\s*\}\);/);
});

// A badge for something you are looking at is not information.
test('the conversation clears its own bell records while it is open', async () => {
  const [timeline, hook, bridge] = await Promise.all([
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/lib/hooks/useNotifications.js'),
    read('../src/components/WorkspaceNotificationBridge.jsx'),
  ]);

  // The pane marks nothing read itself any more. It publishes what it shows, and
  // the stream settles the records — at the snapshot, so nothing lights «(1)»
  // and puts it out again while the reader watches, and again when the pane in
  // front changes or the tab comes back.
  assert.doesNotMatch(timeline, /dismissIssueNotifications/);
  assert.match(timeline, /setVisibleConversation\(conversation\);/);
  assert.match(bridge, /\}, \[settleVisible, visibleConversation\]\);/);
  assert.match(bridge, /document\.visibilityState === 'visible'\) settleVisible\(\);/);
  // Every type the incident produces, through the one presence rule — not a
  // hand-kept list of two that left a status change silenced and unread. The
  // messenger's `chat_message` went with the messenger.
  assert.match(hook, /settleRecordsOnScreen\(\s*docs,\s*record => !settledIds\.has\(record\.id\) && watching\(record\),\s*\)/);
  assert.doesNotMatch(timeline, /chat_message/);
});

// Answering a person is addressed to that person.
test('a reply in the conversation reaches the person answered', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  // `replyTo` carries a name for the quote and no id, so the author is read off
  // the feed that is already open — no extra document.
  assert.match(timeline, /comments\.find\(item => item\.id === draft\.replyTo\.id\)\?\.authorId/);
  // Named for the conversation, not the record: the same notification reaches
  // support («інцидент») and the external client («звернення»).
  assert.match(timeline, /відповів вам у розмові/);
  // And is not told twice: the broad incident reply excludes both the
  // people mentioned and the person answered.
  assert.match(timeline, /exclude: \[\.\.\.mentionedUserIds, \.\.\.replyRecipients\]/);
  // On a type the product can still publish. `chat_message` was the messenger's
  // event and has no switch in Settings any more, so a record written with it
  // would be one nobody can turn off or on.
  assert.doesNotMatch(timeline, /type: 'chat_message'/);
});

// Reading a message is not only crossing the line that says where you stopped.
test('a message that arrives while you are reading is consumed without an unread line', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  // The boundary is latched a render *after* the unread count that the receipt
  // observer watches, and the marker is a ref — so the observer ran once
  // against a marker that had not mounted, returned, and was never rebuilt.
  assert.match(
    timeline,
    /\}, \[boundary\.dismissed, consumeConversation, isActive, myId, sessionBoundary, tabVisible, unreadTotal\]\);/,
  );
  // And a message that lands while the reader is already at the bottom crosses
  // no line at all, so the end of the conversation is observed too.
  assert.match(timeline, /<div ref=\{feedEndRef\} aria-hidden/);
  assert.match(timeline, /observer\.observe\(feedEnd\);/);
});

// The ticks under a sent message.
test('a read receipt records when, not only whether', async () => {
  const [comments, timeline, rules] = await Promise.all([
    read('../src/lib/hooks/useComments.js'),
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../firestore.rules'),
  ]);

  assert.match(comments, /\[`readAt\.\$\{userId\}`\]: serverTimestamp\(\)/);
  // The rule that lets any member mark a comment read carries both fields, or
  // the receipt write is refused whole and nothing is ever marked read.
  assert.match(rules, /hasOnly\(\['readBy', 'readAt'\]\)/);
  // The readers are no longer read off the message: a message now carries a mark
  // only when it is the newest one its author sent before the reader arrived,
  // and `commentReaders` resolves the rest from the mark that covers them.
  assert.match(timeline, /title=\{readReceiptLabel\(commentReaders\(item, myReceiptMarks\), members\)\}/);
  assert.match(timeline, /commentReaders\(item, myReceiptMarks\)\.length > 0/);
  // Messages read before the stamp existed carry only the array, and say
  // «Прочитано» rather than inventing an hour for it.
  assert.match(timeline, /return stamp \? `Прочитано \$\{stamp\}` : 'Прочитано';/);
});

// The quote above an answer is the way back to what was answered.
test('a reply quote leads to the message it quotes', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  assert.match(timeline, /onJump=\{item\.replyTo\?\.id \? \(\) => jumpToComment\(item\.replyTo\.id\) : undefined\}/);
  assert.match(timeline, /data-comment-id=\{item\.id\}/);
  assert.match(timeline, /querySelector\(`\[data-comment-id="\$\{CSS\.escape\(commentId\)\}"\]`\)/);
  // The answered message is often older than the window the feed opened on, so
  // the history grows until it is found — and stops, because each step is
  // another window of reads.
  assert.match(timeline, /const JUMP_HISTORY_LIMIT = 5;/);
  assert.match(timeline, /historyWindow >= JUMP_HISTORY_LIMIT/);
});

// A message you sent is on screen because you sent it, not because Firestore
// has come back and said so.
test('the conversation draws a message as it is sent, and settles it by id', async () => {
  const [timeline, comments] = await Promise.all([
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/lib/hooks/useComments.js'),
  ]);

  // The composer hands the message over and is free again; the delivery runs
  // after it, not in front of it.
  assert.match(timeline, /void deliverComment\(draft\);/);
  assert.match(timeline, /status: 'sending',/);
  // A transaction is not applied to the local cache, so the id decided before
  // the write is the only thing that can recognise the real document later.
  assert.match(comments, /return commentRef\.id;/);
  assert.match(timeline, /patchDraft\(\{ serverId: commentId, status: 'sent' \}\);/);
  assert.match(
    timeline,
    /draft => Boolean\(draft\.serverId\) && \(draft\.issueId !== issueId \|\| arrivedCommentIds\.has\(draft\.serverId\)\)/,
  );
  // A failed send leaves the message where the sender put it, marked, and
  // sendable again — it used to disappear along with what they had typed.
  assert.match(timeline, /patchDraft\(\{ status: 'failed' \}\);/);
  assert.match(timeline, /onRetry=\{\(\) => retryPendingMessage\(draft\)\}/);
  assert.match(timeline, /icon=\{RotateCw\} size="micro" composition="chat-micro-action"/);
  assert.match(timeline, /Не надіслано/);
  // The files go to the one folder an incident's attachments have.
  assert.match(timeline, /organizations\/\$\{project\?\.organizationId \|\| 'shared'\}\/comments/);
  // The bytes are reported where the message now is, not on a composer that has
  // already been cleared.
  assert.match(timeline, /\{ \.\.\.item, progress: \{ \.\.\.item\.progress, \[index\]: percent \} \}/);
});

test('the conversation says who is typing', async () => {
  const [timeline, hook, rules] = await Promise.all([
    read('../src/components/workspace/UnifiedTimeline.jsx'),
    read('../src/lib/hooks/useIssueTyping.js'),
    read('../firestore.rules'),
  ]);

  // One reader, one heartbeat, one expiry, in one module.
  assert.match(timeline, /activeTypingUserIds\(typingState, \{ now: typingNow, exclude: myId \}\)/);
  assert.match(hook, /import \{ TYPING_REFRESH_MS \} from '@\/lib\/utils\/workspaceChat\.mjs';/);
  // A document of its own, because the incident is subscribed to by every board
  // and card that shows it and a heartbeat there would cost each of them a read.
  assert.match(hook, /doc\(db, 'issues', issueId, 'presence', 'typing'\)/);
  assert.match(rules, /match \/presence\/typing \{/);
  assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly\(\['typing', 'typingAt'\]\)/);
  // Typing stops when the message is sent, and when the reader leaves.
  assert.match(timeline, /clearTimeout\(typingRef\.current\);\s*\n\s*setTyping\(false\);/);
  assert.match(hook, /if \(!isTypingRef\.current\) return;\s*\n\s*isTypingRef\.current = false;/);
});

// Nothing is read in a tab nobody is looking at.
test('the conversation reads nothing while its tab is in the background', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');

  assert.match(timeline, /const syncVisibility = \(\) => setTabVisible\(document\.visibilityState === 'visible'\);/);
  // Both observers — the unread line and the end of the conversation — stand
  // down while the tab is hidden, and are rebuilt when it comes back, because
  // an observer reports what is on screen the moment it starts watching.
  assert.match(timeline, /if \(!isActive \|\| !tabVisible \|\| !myId \|\| unreadTotal === 0/);
  assert.match(timeline, /if \(!isActive \|\| !tabVisible \|\| !myId \|\| unreadCommentIds\.length === 0/);
  assert.match(timeline, /\}, \[consumeConversation, isActive, myId, tabVisible, unreadCommentIds\.length\]\);/);
});
