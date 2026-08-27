import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isConversationOnScreen } from '../src/lib/utils/notificationPresence.mjs';
import {
  chatAttachmentKind,
  chatAttachmentNames,
  collectChatAttachments,
  formatChatFileSize,
  messageMatchesChatSearch,
} from '../src/lib/utils/chatAttachments.mjs';
import {
  attachmentKind,
  attachmentKindLabel,
  formatMediaTime,
  isMediaKind,
  isVisualKind,
} from '../src/lib/utils/attachmentKinds.mjs';
import {
  activeTypingUserIds,
  canAccessChatChannel,
  channelIdFromName,
  channelUnreadCount,
  directMessageRoomId,
  directRoomParticipants,
  isDirectRoomId,
  isVisibleChatChannel,
} from '../src/lib/utils/workspaceChat.mjs';

const ts = value => ({ toMillis: () => value });
// Firebase Auth uids are 28 alphanumeric characters; DM room ids are two of
// them joined by '_', which is what both the client and firestore.rules match.
const UID_A = 'Aa1bb2cc3dd4ee5ff6gg7hh8ii9j';
const UID_B = 'Zz9yy8xx7ww6vv5uu4tt3ss2rr1q';
const UID_C = 'Mm5nn4oo3pp2qq1rr0ss9tt8uu7v';

test('builds one stable DM room id for both participants', () => {
  assert.equal(directMessageRoomId(UID_B, UID_A), directMessageRoomId(UID_A, UID_B));
  assert.equal(directMessageRoomId(UID_B, UID_A), `${UID_A}_${UID_B}`);
});

test('recognises DM room ids by shape and never a human channel slug', () => {
  assert.equal(isDirectRoomId(directMessageRoomId(UID_A, UID_B)), true);
  assert.deepEqual(directRoomParticipants(directMessageRoomId(UID_A, UID_B)), [UID_A, UID_B]);
  // Legacy and human rooms must stay org-visible, otherwise the scoped query
  // and the rules disagree and the whole listing fails.
  for (const id of ['general', 'project_alpha', 'design', '11', 'back-end']) {
    assert.equal(isDirectRoomId(id), false, id);
    assert.deepEqual(directRoomParticipants(id), [], id);
  }
});

test('keeps DM documents out of public channels and scopes them to participants', () => {
  const id = directMessageRoomId(UID_A, UID_B);
  const dm = { id, type: 'dm', participants: [UID_A, UID_B] };
  assert.equal(isVisibleChatChannel(dm, UID_A), true);
  assert.equal(isVisibleChatChannel(dm, UID_C), false);
  // A forged `participants` array cannot widen access — the id is authoritative.
  assert.equal(isVisibleChatChannel({ ...dm, participants: [UID_A, UID_B, UID_C] }, UID_C), false);
  // Nor can mislabelling a DM room as public expose it.
  assert.equal(isVisibleChatChannel({ ...dm, type: 'public', name: 'team' }, UID_C), false);
});

test('channel slugs never collide with DM room ids or illegal document ids', () => {
  assert.equal(channelIdFromName('  Back End  '), 'back-end');
  // '_' is reserved for DM ids and '/' is illegal in a document id.
  assert.equal(channelIdFromName('front_back'), 'front-back');
  assert.equal(channelIdFromName('front/back'), 'front-back');
  assert.equal(channelIdFromName('Дизайн Команди'), 'дизайн-команди');
  assert.equal(channelIdFromName('---'), '');
  assert.equal(channelIdFromName('///'), '');
  assert.equal(channelIdFromName(null), '');
  assert.equal(isDirectRoomId(channelIdFromName(`${UID_A} ${UID_B}`)), false);
});

test('typing flags expire so a crashed tab cannot pin the indicator', () => {
  const channel = { typing: [UID_A, UID_B], typingAt: { [UID_A]: 1_000, [UID_B]: 9_000 } };
  assert.deepEqual(activeTypingUserIds(channel, { now: 10_000, ttlMs: 8000 }), [UID_B]);
  assert.deepEqual(activeTypingUserIds(channel, { now: 10_000, ttlMs: 8000, exclude: UID_B }), []);
  // Documents written before `typingAt` existed carry no heartbeat.
  assert.deepEqual(activeTypingUserIds({ typing: [UID_A] }, { now: 10_000 }), []);
});

test('counts tracked unread messages and ignores own latest message', () => {
  const channel = { lastMessageAt: ts(20), messageCount: 7, lastMessageSenderId: 'other' };
  assert.equal(channelUnreadCount(channel, { lastReadAt: ts(10), messageCount: 4 }, 'me'), 3);
  assert.equal(channelUnreadCount({ ...channel, lastMessageSenderId: 'me' }, null, 'me'), 0);
});

test('chat attachment kind supports MIME types and URL extensions', () => {
  assert.equal(chatAttachmentKind({ type: 'image/png' }), 'image');
  assert.equal(chatAttachmentKind({ resourceType: 'video' }), 'video');
  assert.equal(chatAttachmentKind({ url: 'https://cdn.test/file.pdf?download=1' }), 'pdf');
});

// The chat and the task surface answer "what is this file" with one resolver,
// so this list is the contract for both. Office's own MIME types are the reason
// the map exists: nothing about `…spreadsheetml.sheet` says «таблиця», and a
// raw upload arrives as application/octet-stream with only its name to go on.
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
  // «Медіа» in the channel filter means image, video or audio — not "anything
  // with a preview", which would have swept PDFs in with the photos.
  assert.equal(isMediaKind('audio'), true);
  assert.equal(isMediaKind('pdf'), false);
  assert.equal(isVisualKind('video'), true);
  assert.equal(isVisualKind('audio'), false);
});

test('chat search finds text, author, and attachment names', () => {
  const message = {
    text: 'Оновив дизайн',
    user: 'Артур',
    attachments: [{ name: 'homepage-final.png', type: 'image/png' }],
  };
  assert.equal(messageMatchesChatSearch(message, 'дизайн'), true);
  assert.equal(messageMatchesChatSearch(message, 'артур'), true);
  assert.equal(messageMatchesChatSearch(message, 'homepage'), true);
  assert.equal(messageMatchesChatSearch(message, 'invoice'), false);
});

test('a pinned file is listed by name, not as the word «Вкладення»', async () => {
  // «Вкладення» is the one thing every such message has in common, so it told
  // the reader nothing: three pinned files were three identical lines.
  assert.equal(
    chatAttachmentNames([{ name: 'kosторис-Q3.xlsx' }, { name: 'brief.pdf' }]),
    'kosторис-Q3.xlsx, brief.pdf',
  );
  // A record with no name of its own still says what kind of thing it is.
  assert.equal(chatAttachmentNames([{ type: 'image/png' }]), 'Зображення');
  assert.equal(chatAttachmentNames([]), '');
  assert.equal(chatAttachmentNames(undefined), '');

  const panel = await readFile(new URL('../src/components/ui/Chat/ChannelInfoPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /chatAttachmentNames\(message\.attachments\)/);
  assert.doesNotMatch(panel, /\? 'Вкладення'/);
});

test('collectChatAttachments keeps message context and skips broken records', () => {
  const attachments = collectChatAttachments([
    {
      id: 'm1',
      user: 'Arthur',
      attachments: [
        { name: 'screen.png', url: 'https://cdn.test/screen.png' },
        { name: 'missing.txt' },
      ],
    },
  ]);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].messageId, 'm1');
  assert.equal(attachments[0].senderName, 'Arthur');
});

test('formatChatFileSize produces readable labels', () => {
  // Ukrainian decimal comma: the rest of the interface is Ukrainian and the
  // file size was the one number that said otherwise.
  assert.equal(formatChatFileSize(1024), '1,0 КБ');
  assert.equal(formatChatFileSize(5 * 1024 * 1024), '5,0 МБ');
  assert.equal(formatChatFileSize(undefined), '');
});

test('media time is clock-shaped and survives unknown durations', () => {
  assert.equal(formatMediaTime(0), '0:00');
  assert.equal(formatMediaTime(67), '1:07');
  assert.equal(formatMediaTime(3671), '1:01:11');
  // A browser reports NaN until it has read the metadata, and the player draws
  // that state on every card before the first byte arrives.
  assert.equal(formatMediaTime(NaN), '0:00');
});

test('private attachment delivery uses the same channel membership boundary', () => {
  const directId = directMessageRoomId(UID_A, UID_B);
  assert.equal(canAccessChatChannel({ id: directId, type: 'dm' }, UID_A), true);
  assert.equal(canAccessChatChannel({ id: directId, type: 'dm' }, UID_C), false);
  assert.equal(canAccessChatChannel({ id: 'general', type: 'public' }, UID_C), true);
  assert.equal(canAccessChatChannel({ id: 'design', members: [UID_A] }, UID_A), true);
  assert.equal(canAccessChatChannel({ id: 'design', members: [UID_A] }, UID_C), false);
});

test('chat autocompletes and opens stable issue-key mentions', async () => {
  const [page, menu, content, mentionChip, hoverCardChip] = await Promise.all([
    readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/Chat/IssueMentionMenu.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/MessageContent.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/IssueMentionChip.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/HoverCard.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(page, /matchIssue = before\.match\(/);
  assert.match(page, /`\$\{before\}#\$\{issue\.issueKey\} \$\{after\}`/);
  assert.match(page, /<IssueMentionMenu/);
  assert.match(menu, /issue\.issueKey/);
  // A mentioned task reads like a mentioned person: the same neutral chip, no
  // colour of its own. The magenta pill was the one place in the product where
  // a hue meant «this is a task».
  assert.doesNotMatch(menu, /tone="accent"/);
  assert.doesNotMatch(mentionChip, /#c026d3|#fdf4ff/);
  // One shape, defined once: a mentioned task and a mentioned person are the
  // same kind of thing to read past, so the chip is literally the same string
  // rather than two that happen to agree today.
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
  // `#` searches task numbers, not prose: typing 12 used to return every task
  // whose description happened to contain those characters.
  assert.match(page, /searchIssues\(queryText, activeOrgId, null, \{ mention: true \}\)/);
  // Only what *matched* is a mention or a task. `String.split` with a capturing
  // group hands back the text between the matches too, and deciding what a piece
  // is by its first character therefore turned «@ у чаті завдання» — a sentence
  // that matched nothing — into a capsule naming somebody called « у чаті завдання».
  assert.match(content, /tokenizeMessageLine\(line, \{ memberNames \}\)/);
  assert.doesNotMatch(content, /part\.startsWith\('@'\)/);
  // A mention is read where it was written: it opens the quick-view panel, not
  // a navigation out of the conversation you are having.
  //
  // A mentioned task says what it is called, so there is nothing to hover for:
  // the chip resolves the title once per key through the same call the picker
  // makes, and clicking it opens the quick-view panel.
  // …and it resolves that title with an exact-key lookup, never with search.
  // Search cannot know which documents match a word, so it reads every task,
  // project, membership and event in the organization; paying that per capsule
  // is what exhausted a day's read quota in an afternoon.
  assert.match(mentionChip, /\/api\/issues\/lookup\?/);
  assert.doesNotMatch(mentionChip, /api\/search/);
  assert.match(mentionChip, /openIssueQuickView\(issue\)/);
  assert.match(content, /<IssueMentionChip/);
  assert.doesNotMatch(mentionChip, /collection\(db, 'issues'\)/);
  // A lookup that could not be made is not an answer. Caching it meant a chat
  // opened before Firebase restored the session never resolved a mention again.
  assert.match(mentionChip, /resolved\.delete\(`\$\{userId\}:\$\{organizationId\}:\$\{key\}`\)/);
});

test('a task chat reads back the task mentions its own composer writes', async () => {
  const [mentionText, timeline] = await Promise.all([
    readFile(new URL('../src/components/workspace/MentionText.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
  ]);

  // The task composer has offered the `#` picker all along — and the message it
  // produced then showed the bare key, while the identical text in the
  // workspace chat showed the task's name.
  assert.match(timeline, /<IssueMentionMenu/);
  assert.match(mentionText, /<IssueMentionChip/);
  // Both chats read the same sentences, so both ask the same tokenizer rather
  // than carrying two copies of the rules that disagree about what a mention is.
  assert.match(mentionText, /tokenizeMessageLine\(text, \{ memberNames, formatting: false \}\)/);
  // The very same component, not a lookalike span. The retyped copy could not be
  // clicked, so a person named in a task chat had no profile behind their name
  // while the identical text in the workspace chat did.
  assert.match(mentionText, /<HoverCard\b/);
  assert.doesNotMatch(mentionText, /mentionChipClass/);
  // And it survives a dark bubble: an own message here is white on near-black,
  // where a black tint is invisible.
  assert.match(mentionText, /dark=\{dark\}/);
});

test('chat user suggestions require an at sign and message actions are keyboard reachable', async () => {
  const [page, bubble] = await Promise.all([
    readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/Chat/MessageBubble.jsx', import.meta.url), 'utf8'),
  ]);

  assert.ok(page.includes('const matchUser = before.match(/(?:^|[\\s([{])([@])([^@\\n"]*)$/u);'));
  assert.doesNotMatch(page, /\(\[@"\]\)/);
  assert.match(bubble, /tabIndex=\{0\}/);
  assert.match(bubble, /onFocusCapture=\{\(\) => setShowActions\(true\)\}/);
  assert.match(bubble, /event\.currentTarget\.contains\(event\.relatedTarget\)/);
});

// A conversation opens showing its newest message. It does not scroll to it.
//
// Measured on the running app before this change: the list rendered at
// scrollTop 0 and animated 363px down over 10 frames — the visible "my chats
// are scrolling themselves" the report described. After: the first frame in
// which the list was scrollable was already at the bottom, and none of the 303
// sampled frames sat off it.
test('the chat places itself at the latest message instead of scrolling to it', async () => {
  const page = await readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8');

  // Before the paint, not after it.
  assert.match(page, /useLayoutEffect\(\(\) => \{\s*\r?\n\s*const count = messages\.length;/);
  // Smooth is reserved for a message arriving in a conversation you are already
  // sitting in; landing in one is instant.
  assert.match(page, /behavior: isInitialPlacement \|\| count <= 1 \? 'instant' : 'smooth'/);
  assert.match(page, /const isInitialPlacement = !initialScrollDoneRef\.current;/);
  // Switching conversation re-arms the placement rather than firing a second,
  // delayed correction that raced the first.
  assert.match(page, /initialScrollDoneRef\.current = false;/);
  assert.doesNotMatch(page, /setTimeout\(\(\) => \{\s*\r?\n\s*messagesEndRef\.current\?\.scrollIntoView/);

  // The thread panel opens the same way.
  assert.match(page, /useLayoutEffect\(\(\) => \{\s*\r?\n\s*if \(scrollRef\.current\) \{/);

  // And an image that decodes after the list was placed re-pins the bottom,
  // which needs one observable box around the messages.
  const list = await readFile(
    new URL('../src/components/ui/Chat/ChatMessageList.jsx', import.meta.url),
    'utf8',
  );
  assert.match(list, /<div ref=\{contentRef\}>/);
  assert.match(page, /observer\.observe\(chatContentRef\.current\)/);
});

// A reply in a thread used to be invisible from outside that thread: nothing
// was notified, nothing on the message said it had happened, and the reader had
// to already be looking at the thread to find out. Somebody answering a question
// asked three messages ago simply never reached the person who asked it.
test('a reply in a thread reaches the people the thread belongs to', async () => {
  const [page, hook, bubble, list] = await Promise.all([
    readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/hooks/useWorkspaceChat.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/Chat/MessageBubble.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/Chat/ChatMessageList.jsx', import.meta.url), 'utf8'),
  ]);

  // Whoever wrote the message, and whoever has answered it before — read off
  // the replies the pane already has open, so telling them costs no read.
  assert.match(page, /parent\.senderId,\s*\n\s*\.\.\.threadMessages\.map\(reply => reply\.senderId\)/);
  assert.match(page, /відповів у гілці/);
  assert.match(page, /згадав вас у гілці/);
  // A mention is the stronger thing, so nobody is told twice about one reply.
  assert.match(page, /followers\.filter\(userId => !mentioned\.includes\(userId\)\)/);
  // And the alert lands in the thread itself, not merely in the channel.
  assert.match(page, /&thread=\$\{encodeURIComponent\(activeThreadId\)\}/);
  assert.match(page, /searchParams\.get\('thread'\)/);
  assert.match(page, /if \(threadId\) queueMicrotask\(\(\) => openThread\(threadId\)\)/);

  // Read state per thread lives on the channel read-state document the reader
  // already has, so a thread costs no document and no listener of its own —
  // and it is deliberately not the channel's own unread counter, which walking
  // into the room would clear without the thread ever being opened.
  assert.match(hook, /threads: \{ \[parentMsgId\]: Number\(replyCount\) \|\| 0 \}/);
  assert.doesNotMatch(hook, /markThreadRead[\s\S]{0,400}messageCount: increment/);
  assert.match(page, /void markThreadRead\(activeThreadId, total\)/);

  // The message says how many of its replies are new, not only how many it has.
  assert.match(bubble, /const unreadReplies = Math\.max\(0, Number\(msg\.replyCount \|\| 0\) - Number\(seenReplyCount \|\| 0\)\)/);
  assert.match(bubble, /plural\(unreadReplies, \['нова', 'нові', 'нових'\]\)/);
  assert.match(bubble, /plural\(msg\.replyCount, \['відповідь', 'відповіді', 'відповідей'\]\)/);
  assert.match(list, /seenReplyCount=\{seenReplies\[msg\.id\] \|\| 0\}/);
});

// Editing a message is writing a message. What stood here was a fixed two-line
// box a long message had to be scrolled inside, and two words of underlined
// text where the buttons should be.
test('editing a chat message is a real form, not two underlined words', async () => {
  const bubble = await readFile(new URL('../src/components/ui/Chat/MessageBubble.jsx', import.meta.url), 'utf8');

  assert.match(bubble, /<Button size="sm" style="primary" onClick=\{commitEdit\} disabled=\{!editChanged\}>/);
  assert.match(bubble, /<Button size="sm" style="ghost" onClick=\{cancelEdit\}>/);
  assert.doesNotMatch(bubble, /className="font-semibold text-ink hover:underline">Зберегти/);
  // Grown from the value, not from a keystroke: opening a long message for
  // editing is an assignment, and an assignment is not an input event.
  assert.match(bubble, /\}, \[editing, editText\]\);/);
  // `scrollHeight` is content plus padding, and the box is `border-box`: without
  // the border added back the field sits one scroll-step short of its own text.
  assert.match(bubble, /const border = field\.offsetHeight - field\.clientHeight;/);
  assert.match(bubble, /field\.style\.height = `\$\{Math\.min\(wanted, 320\)\}px`/);
  assert.doesNotMatch(bubble, /autoFocus\s*\n\s*className="w-full bg-white border/);
  // An edit that changes nothing is not an edit; an empty one is a delete asked
  // for in the wrong place.
  assert.match(bubble, /editText\.trim\(\)\.length > 0 && editText\.trim\(\) !== \(msg\.text \|\| ''\)\.trim\(\)/);
});

// The line that says «this is where you stopped reading».
test('the unread boundary waits for the cursor, and stops repeating itself', async () => {
  const [timeline, bridge, store] = await Promise.all([
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/IssueReadStateBridge.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/store/useWorkspaceStore.js', import.meta.url), 'utf8'),
  ]);

  // An empty cursor map means two opposite things — «nothing has been opened»
  // and «the cursors have not arrived» — and a timeline that cannot tell them
  // apart reads its whole history as unread and sends the reader to the day the
  // task was created. That is «9 нових» pointing at the top of a quiet task.
  assert.match(store, /issueReadStateLoaded: false/);
  assert.match(bridge, /resetIssueReadState\(\)/);
  assert.match(timeline, /if \(!myId \|\| !readCursorsLoaded\) return \[\]/);
  // Three subscriptions settle in three renders; a line latched off the first
  // of them names the wrong item.
  assert.match(timeline, /const feedSettled = \(readCursorsLoaded \|\| cursorWaitIsOver\)/);
  // Waiting for those cursors is right; waiting forever is not. A network that
  // cannot answer must not leave the conversation unplaced — which is the
  // scroller sitting at the very top of the task's whole history.
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
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

  // Reading happens where the message is handed to the conversation, which is
  // now before the write rather than after it — editing returns earlier, so
  // nothing here can reach an edit.
  assert.match(timeline, /setPendingMessages\(current =>[\s\S]{0,700}?consumeConversation\(\);[\s\S]{0,40}?dismissBoundary\(\);/);
  // And the reader lands on their own message wherever they were standing.
  assert.match(timeline, /wasNearBottomRef\.current = true;[\s\S]{0,40}?setIsScrolledUp\(false\);[\s\S]{0,40}?scrollToBottom\(\);/);
  // One place decides what «read» means, so three callers cannot each remember
  // their own half of it.
  assert.match(timeline, /const consumeConversation = useCallback\(\(\) => \{/);
  assert.match(timeline, /dismissIssueNotifications\(\);/);
  // Including the records in the bell, which existed only to bring the reader
  // to the conversation they are now standing in.
  assert.match(timeline, /notification\.issueId === issueId/);
  assert.match(timeline, /notification\.type === 'commented'\s*\|\| notification\.type === 'mentioned'/);
});

// One person speaking without interruption is drawn as one run.
test('consecutive messages from one author share a name and a face', async () => {
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

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
test('the task feed corrects itself when its own height changes', async () => {
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

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

// What a project card costs to draw.
test('a project card counts what is new without reading anything', async () => {
  const [dashboard, chatUtils] = await Promise.all([
    readFile(new URL('../src/app/(app)/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/utils/workspaceChat.mjs', import.meta.url), 'utf8'),
  ]);

  // Two live listeners *per card*: the entire message history of
  // `project_<id>` and its read cursor — over a channel the product stopped
  // writing to, so the dashboard read a dead conversation's whole history, once
  // per project, for a number that could only ever be zero.
  assert.match(chatUtils, /channel\.id\.startsWith\('project_'\)/);
  assert.doesNotMatch(dashboard, /project_\$\{project\.id\}/);
  assert.doesNotMatch(dashboard, /onSnapshot\(query\(messagesRef\)/);
  // The fact the card still draws is already in the notification stream the
  // layout subscribes to once and the sidebar's project dot already reads.
  // Unread project chat is no longer among them: the card's last row is a
  // status band, and the sidebar's dot is where that number is said.
  assert.doesNotMatch(dashboard, /item\.type === 'chat_message'/);
  assert.match(dashboard, /item\.type === 'mentioned'/);
  assert.match(dashboard, /const notifications = useWorkspaceStore\(state => state\.notifications\)/);
});

// One publisher, many readers — the rule the store already states for this
// number, and the sidebar was quietly breaking it.
test('the workspace guards its single internal channel subscription', async () => {
  const [sidebar, bridge] = await Promise.all([
    readFile(new URL('../src/components/WorkspaceSidebar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WorkspaceNotificationBridge.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(bridge, /useUnreadChatCount\(\{ enabled: internalViewer \}\)/);
  assert.doesNotMatch(sidebar, /import \{ useUnreadChatCount \}/);
  assert.doesNotMatch(sidebar, /s\.unreadChatCount/);
});

// A task's history is not read whole to show the end of it.
test('a task opens on a window of its history, not all of it', async () => {
  const [audit, comments, timeline] = await Promise.all([
    readFile(new URL('../src/lib/hooks/useAuditLog.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/hooks/useComments.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
  ]);

  // The audit log read the subcollection whole, sorted it in the browser and
  // kept fifty — so four hundred recorded changes cost four hundred reads to
  // draw fifty rows, and the cost grew every time anybody touched the task.
  assert.match(audit, /orderBy\('createdAt', 'desc'\),\s*\n\s*limit\(windowSize\)/);
  assert.doesNotMatch(audit, /docs\.slice\(0, LIMIT\)/);
  assert.match(comments, /orderBy\('createdAt', 'desc'\),\s*\n\s*limit\(windowSize\)/);
  // Windowed, not truncated: what is not loaded is still reachable.
  assert.match(timeline, /setHistoryWindow\(current => current \+ 1\)/);
  assert.match(timeline, /hasOlderHistory/);
  // And through the same control the chat uses, rather than a second one that
  // happens to look like it.
  assert.match(timeline, /<LoadOlderButton/);
});

// A message that arrives on the screen you are looking at.
test('the live popup stays down for the conversation already on screen', () => {
  const comment = { type: 'commented', issueId: 'issue-1' };
  assert.equal(isConversationOnScreen(comment, { kind: 'issue', id: 'issue-1' }), true);
  assert.equal(isConversationOnScreen(comment, { kind: 'issue', id: 'issue-2' }), false);
  // Every kind of notification a task produces resolves to that task, so a
  // mention inside the chat you are reading is quiet too.
  assert.equal(
    isConversationOnScreen({ type: 'mentioned', issueId: 'issue-1' }, { kind: 'issue', id: 'issue-1' }),
    true,
  );
  // A direct conversation is named by the person on the other side of it.
  const dm = { type: 'chat_message', actorId: 'user-7' };
  assert.equal(isConversationOnScreen(dm, { kind: 'dm', id: 'user-7' }), true);
  assert.equal(isConversationOnScreen(dm, { kind: 'dm', id: 'user-8' }), false);
  // An open task does not silence somebody's direct message, and nothing at all
  // silences an emergency — that is the one notification whose whole job is to
  // interrupt.
  assert.equal(isConversationOnScreen(dm, { kind: 'issue', id: 'issue-1' }), false);
  assert.equal(
    isConversationOnScreen({ type: 'emergency', issueId: 'issue-1' }, { kind: 'issue', id: 'issue-1' }),
    false,
  );
  // Nothing open, nothing suppressed.
  assert.equal(isConversationOnScreen(comment, null), false);
  assert.equal(isConversationOnScreen(comment, { kind: 'issue', id: '' }), false);
});

// The two panes that can show a conversation publish it, and the bridge is the
// only thing that reads it back.
test('the panes showing a conversation say so, and the popup asks before it fires', async () => {
  const [timeline, chatPage, bridge] = await Promise.all([
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WorkspaceNotificationBridge.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(timeline, /const conversation = \{ kind: 'issue', id: issueId \};/);
  assert.match(timeline, /setVisibleConversation\(conversation\);/);
  // Both kinds of workspace conversation, not only the direct one: a card about
  // the channel you are reading covers the channel you are reading.
  assert.match(
    chatPage,
    /const conversation = \{ kind: activeChannel\.type === 'dm' \? 'dm' : 'channel', id: activeChannel\.id \}/,
  );
  // Registered only while the pane is actually on screen: below lg the task
  // page keeps the timeline mounted behind the task pane.
  assert.match(timeline, /if \(!isActive \|\| !issueId\) return undefined;/);
  assert.match(bridge, /isConversationOnScreen\(notification, useWorkspaceStore\.getState\(\)\.visibleConversation\)/);
  // And only while the tab is in front. A conversation left open in a
  // background tab is not a conversation somebody is reading, and treating it
  // as one swallowed the card that should have been waiting on return.
  assert.match(bridge, /document\.visibilityState === 'visible'/);
});

// The check that suppresses the card has to suppress the chime as well.
test('nothing announces a message arriving in the conversation on screen', async () => {
  const [hook, bridge] = await Promise.all([
    readFile(new URL('../src/lib/hooks/useNotifications.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WorkspaceNotificationBridge.jsx', import.meta.url), 'utf8'),
  ]);

  // The gate stands before the chime, not between the chime and the popup —
  // which is where it used to stand, so the card was suppressed and the sound
  // played anyway on the very task page the message had landed on.
  const announceGate = hook.indexOf('!announce(n)');
  const chime = hook.indexOf('playChime()', hook.indexOf('const prefs = prefsRef.current'));
  assert.ok(announceGate > 0, 'the hook asks whether to announce at all');
  assert.ok(announceGate < chime, 'and asks before it plays anything');
  // The bell keeps the record either way: the gate returns before the channels,
  // never before the list the panel draws.
  assert.match(hook, /setNotifications\(docs\);/);
  // One decision, passed in by the only component that knows what is on screen.
  assert.match(bridge, /shouldAnnounce,\s*\}\);/);
});

// A badge for something you are looking at is not information.
test('the task chat clears its own bell records while it is open', async () => {
  const [timeline, chatPage] = await Promise.all([
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8'),
  ]);

  // Not on the intersection observer's schedule: that consumed the record about
  // half a second after it arrived, so every message lit «(1)» and put it out
  // again while the reader watched.
  assert.match(timeline, /if \(!isActive \|\| !tabVisible\) return;\s*dismissIssueNotifications\(\);/);
  // The reply record is one of the task's own, so it is dismissed with them.
  assert.match(timeline, /notification\.type === 'chat_message'\)\s*\)\);/);
  // The workspace chat has always done this for an open channel; the task chat
  // is the same rule on the other screen.
  assert.match(chatPage, /if \(unreadForConversation\.length === 0\) return;/);
});

// Answering a person is addressed to that person.
test('a reply in a task chat reaches the person answered', async () => {
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

  // `replyTo` carries a name for the quote and no id, so the author is read off
  // the feed that is already open — no extra document.
  assert.match(timeline, /comments\.find\(item => item\.id === draft\.replyTo\.id\)\?\.authorId/);
  assert.match(timeline, /відповів вам у завданні/);
  // And is not told twice: the broad «написав у завданні» excludes both the
  // people mentioned and the person answered.
  assert.match(timeline, /exclude: \[\.\.\.mentionedUserIds, \.\.\.replyRecipients\]/);
});

// A task's reply record is a `chat_message` too, and it belongs to the task.
test('a reply inside a task is never mistaken for a direct message', async () => {
  const chatPage = await readFile(new URL('../src/app/(app)/chat/page.js', import.meta.url), 'utf8');

  const reply = { type: 'chat_message', actorId: 'user-7', issueId: 'issue-1' };
  // Having a direct conversation with the answerer open must not silence it…
  assert.equal(isConversationOnScreen(reply, { kind: 'dm', id: 'user-7' }), false);
  // …and the task it belongs to must.
  assert.equal(isConversationOnScreen(reply, { kind: 'issue', id: 'issue-1' }), true);
  // The DM badge in the chat sidebar counts direct messages, not task replies.
  assert.match(chatPage, /\|\| notification\.issueId\s*\) return;/);
});

// Reading a message is not only crossing the line that says where you stopped.
test('a message that arrives while you are reading is consumed without an unread line', async () => {
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

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
    readFile(new URL('../src/lib/hooks/useComments.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
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
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

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
test('the task chat draws a message as it is sent, and settles it by id', async () => {
  const [timeline, comments] = await Promise.all([
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/hooks/useComments.js', import.meta.url), 'utf8'),
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
  // The bytes are reported where the message now is, not on a composer that has
  // already been cleared.
  assert.match(timeline, /\{ \.\.\.item, progress: \{ \.\.\.item\.progress, \[index\]: percent \} \}/);
});

// «Друкує…», which the workspace chat has had all along.
test('the task chat says who is typing, on the workspace chat’s own mechanism', async () => {
  const [timeline, hook, rules] = await Promise.all([
    readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/hooks/useIssueTyping.js', import.meta.url), 'utf8'),
    readFile(new URL('../firestore.rules', import.meta.url), 'utf8'),
  ]);

  // The same reader, the same heartbeat, the same expiry — one implementation
  // of «who is typing» for both conversations in the product.
  assert.match(timeline, /activeTypingUserIds\(typingState, \{ now: typingNow, exclude: myId \}\)/);
  assert.match(hook, /import \{ TYPING_REFRESH_MS \} from '@\/lib\/utils\/workspaceChat\.mjs';/);
  // A document of its own, because the task is subscribed to by every board and
  // card that shows it and a heartbeat there would cost each of them a read.
  assert.match(hook, /doc\(db, 'issues', issueId, 'presence', 'typing'\)/);
  assert.match(rules, /match \/presence\/typing \{/);
  assert.match(rules, /request\.resource\.data\.keys\(\)\.hasOnly\(\['typing', 'typingAt'\]\)/);
  // Typing stops when the message is sent, and when the reader leaves.
  assert.match(timeline, /clearTimeout\(typingRef\.current\);\s*\n\s*setTyping\(false\);/);
  assert.match(hook, /if \(!isTypingRef\.current\) return;\s*\n\s*isTypingRef\.current = false;/);
});

// Nothing is read in a tab nobody is looking at.
test('the task chat reads nothing while its tab is in the background', async () => {
  const timeline = await readFile(new URL('../src/components/workspace/UnifiedTimeline.jsx', import.meta.url), 'utf8');

  assert.match(timeline, /const syncVisibility = \(\) => setTabVisible\(document\.visibilityState === 'visible'\);/);
  // Both observers — the unread line and the end of the conversation — stand
  // down while the tab is hidden, and are rebuilt when it comes back, because
  // an observer reports what is on screen the moment it starts watching.
  assert.match(timeline, /if \(!isActive \|\| !tabVisible \|\| !myId \|\| unreadTotal === 0/);
  assert.match(timeline, /if \(!isActive \|\| !tabVisible \|\| !myId \|\| unreadCommentIds\.length === 0/);
  assert.match(timeline, /\}, \[consumeConversation, isActive, myId, tabVisible, unreadCommentIds\.length\]\);/);
});
