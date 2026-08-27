'use client';

import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCheck, ChevronDown, ChevronUp, Clock, Paperclip, Pencil, Reply, RotateCw, Trash2, X } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { useRouter } from 'next/navigation';
import AvatarButton from '@/components/ui/DataDisplay/AvatarButton';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import MentionMenu from '@/components/ui/Chat/MentionMenu';
import IssueMentionMenu from '@/components/ui/Chat/IssueMentionMenu';
import FileInput from '@/components/ui/Forms/FileInput';
import AttachmentViewer from '@/components/ui/AttachmentViewer';
import { ChatAttachmentList, PendingChatAttachments } from '@/components/ui/Chat/ChatAttachmentList';
import Button from '@/components/ui/Button';
import ChatComposerDock from '@/components/ui/ChatComposerDock';
import ChatComposerCore from '@/components/ui/ChatComposerCore';
import UnreadDivider from '@/components/ui/Chat/UnreadDivider';
import LoadOlderButton from '@/components/ui/Chat/LoadOlderButton';
import { IconAction, Pill, Popover, useConfirm } from '@/components/ui';
import EmptyState from '@/components/ui/Feedback/EmptyState';
import { useAppContext } from '@/lib/context/AppContext';
import { can, canWhileRoleLoads } from '@/lib/utils/can';
import { COMMENT_WINDOW, useComments } from '@/lib/hooks/useComments';
import { useIssueTyping } from '@/lib/hooks/useIssueTyping';
import { useSearch } from '@/lib/hooks/useSearch';
import { AUDIT_WINDOW, useAuditLog } from '@/lib/hooks/useAuditLog';
import { useTimeLogs } from '@/lib/hooks/useTimeLogs';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { describeAuditEvent } from '@/lib/utils/issueAuditEvents.mjs';
import {
  commentReaders,
  isIssueChangeUnread,
  issueActivityCursor,
  receiptMarkIds,
  receiptMarks,
  timestampMillis,
} from '@/lib/utils/issueReadState.mjs';
import { markIssueSeen } from '@/lib/services/issueReadState';
import { reportLoadError } from '@/lib/utils/errors';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import { uploadFile } from '@/lib/utils/uploadFile';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import MentionText from '@/components/workspace/MentionText';
import { issueParticipants } from '@/lib/utils/issueParticipants.mjs';
import { sendNotification } from '@/lib/hooks/useNotifications';
import { extractMentionedUserIds, filterMentionCandidates } from '@/lib/utils/mentions';
import { collectIssueMentions } from '@/lib/utils/messageTokens.mjs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { activeTypingUserIds } from '@/lib/utils/workspaceChat.mjs';
import { plural } from '@/lib/utils/plural.mjs';
import {
  ATTACHMENT_UPLOAD_ACCEPT,
  uploadFilePolicy,
} from '@/lib/utils/uploadPolicy.mjs';

// How far back a reply quote may pull the history before it gives up. Each
// step is another `COMMENT_WINDOW` of reads, and a quote pointing at a message
// deleted long ago must not walk a year of conversation to discover that.
const JUMP_HISTORY_LIMIT = 5;

// How close together two messages from the same person have to be to be drawn
// as one run — the same five minutes the workspace chat uses. Without this the
// name and the face were repeated over every single message, so four «ку» in a
// row cost four avatars and four headers saying the same name.
const RUN_WINDOW_MS = 5 * 60 * 1000;

// «At the bottom», in pixels. Matches the workspace chat, so the two lists
// agree about when a new message should push the view and when it should not.
const AT_BOTTOM_SLACK = 80;

// Whether `next` continues the run `previous` started: same author, close
// enough in time, same day.
function continuesRun(previous, next) {
  return Boolean(
    previous && next
    && previous._type === 'comment' && next._type === 'comment'
    && previous.authorId === next.authorId
    && Math.abs((next._time || 0) - (previous._time || 0)) <= RUN_WINDOW_MS
    && dayKey(previous.createdAt) === dayKey(next.createdAt),
  );
}

function fmtTime(minutes) {
  if (!minutes && minutes !== 0) return '—';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}хв`;
  if (rest === 0) return `${hours}г`;
  return `${hours}г ${rest}хв`;
}

function fmtClock(timestamp) {
  if (!timestamp) return '';
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function timestampDate(timestamp) {
  if (!timestamp) return null;
  const date = timestamp?.toDate ? timestamp.toDate() : new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(timestamp) {
  const date = timestampDate(timestamp);
  if (!date) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(timestamp) {
  const date = timestampDate(timestamp);
  if (!date) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return 'Сьогодні';
  if (dayKey(date) === dayKey(yesterday)) return 'Вчора';
  return date.toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'long',
    ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

// «о 14:32» for something that happened today, and the day as well for
// anything older — a read receipt from Tuesday reading «о 14:32» says the wrong
// thing more confidently than saying nothing.
function readStamp(timestamp) {
  const time = fmtClock(timestamp);
  if (!time) return '';
  return dayKey(timestamp) === dayKey(new Date())
    ? `о ${time}`
    : `${dayLabel(timestamp)} о ${time}`;
}

// What the ticks under your own message say when you point at them. The readers
// are resolved by `commentReaders` out of the marks left across this author's
// own messages, so a message carrying no mark of its own is still answered by
// the newer one that covers it. A mark written before `readAt` existed says
// «Прочитано» without inventing an hour for it.
function readReceiptLabel(readers, members) {
  if (readers.length === 0) return 'Надіслано · ще не прочитано';
  if (readers.length === 1) {
    const stamp = readStamp(readers[0].stamp);
    return stamp ? `Прочитано ${stamp}` : 'Прочитано';
  }
  return ['Прочитано:', ...readers.map(({ readerId, stamp }) => {
    const member = members.find(candidate => (candidate.id || candidate.uid) === readerId);
    const when = readStamp(stamp);
    return `· ${member?.name || 'Учасник'}${when ? ` — ${when}` : ''}`;
  })].join('\n');
}

function ReplyQuote({ replyTo, dark = false, onJump }) {
  if (!replyTo) return null;
  const skin = `mb-2 block w-full rounded-[7px] px-2.5 py-2 text-left text-[11px] leading-4 ${dark ? 'bg-white/10 text-white/75' : 'bg-black/[0.05] text-muted'}`;
  const body = (
    <>
      <div className={`mb-0.5 font-bold ${dark ? 'text-white' : 'text-ink'}`}>{replyTo.authorName || 'Учасник'}</div>
      <div className="line-clamp-2 whitespace-pre-wrap">{replyTo.text || 'Вкладення'}</div>
    </>
  );
  // The quote already shows what was answered, so it is also the way back to
  // it. Without that, following a reply in a long conversation meant scrolling
  // for the original by hand and hoping to recognise it.
  if (!onJump) return <div className={skin}>{body}</div>;
  return (
    <button
      type="button"
      data-ui-control="chat-reply-quote"
      onClick={onJump}
      title="Перейти до повідомлення"
      className={`${skin} cursor-pointer transition-colors ${dark ? 'hover:bg-white/20' : 'hover:bg-black/[0.09]'}`}
    >
      {body}
    </button>
  );
}

function StatusEmoji({ member }) {
  if (!member?.statusEmoji) return null;
  return (
    <span
      className="cursor-help"
      title={member.statusText || 'Статус користувача'}
      aria-label={member.statusText || 'Статус користувача'}
    >
      {member.statusEmoji}
    </span>
  );
}

// «Пріоритет змінено: «Низький» → «Високий»» is a sentence with two facts in
// it, and it used to arrive as one flat grey run where the values — the only
// part anybody is scanning for — read exactly like the words around them. The
// phrase already marks them, in the quotes `describeAuditEvent` writes; this
// just honours the marking it was already given.
function emphasise(text) {
  return String(text || '').split(/(«[^»]*»)/g).map((part, index) => (
    part.startsWith('«') && part.endsWith('»')
      ? <strong key={index} className="font-semibold text-ink">{part.slice(1, -1)}</strong>
      : <React.Fragment key={index}>{part}</React.Fragment>
  ));
}

/**
 * One thing that happened to the task, as a line in the conversation.
 *
 * A face, then who and what, then when — all of it in one flowing paragraph.
 * The time used to be a flex sibling of the text, so a change long enough to
 * wrap left it floating vertically centred against three lines with nothing
 * under it; inline at the end of the sentence it simply follows the last word.
 */
function SystemEventMessage({ text, time, actorName, actor }) {
  return (
    <div className="flex justify-center px-3">
      <div data-ui-surface="system-message" className="ui-surface flex max-w-[92%] items-start gap-2">
        <span className="mt-[1px] shrink-0">
          <UserAvatar user={actor || { name: actorName }} size="chat-mention" />
        </span>
        <p className="min-w-0 text-[11px] leading-[18px] text-muted">
          {actorName && <strong className="font-semibold text-ink">{actorName}</strong>}
          {actorName && ' '}
          {emphasise(text)}
          {time && <span className="ml-1.5 whitespace-nowrap text-[10px] text-faint">{time}</span>}
        </p>
      </div>
    </div>
  );
}

function DaySeparator({ timestamp }) {
  const label = dayLabel(timestamp);
  if (!label) return null;
  return (
    <div className="flex justify-center py-2.5" aria-label={`Дата: ${label}`}>
      {/* A date marker is a landmark, not content: bold + widest tracking made
          it heavier than the messages it separates. */}
      <Pill tone="surface" size="chat-day" weight="medium" uppercase>
        {label}
      </Pill>
    </div>
  );
}

/**
 * A message that has been sent and has not come back yet, drawn where it will
 * stand once it has. The composer used to hold it — and the reader — until
 * Firestore answered, which on a transaction means a round trip to the server:
 * a second of an empty conversation and a box that had swallowed what you
 * typed. Now the message is on screen at once, and the only difference is the
 * mark under it.
 *
 * @param {object} props.draft The queued message: text, files, upload progress and status.
 * @param {object[]} props.members Participants, so a mention reads the same before and after it lands.
 * @param {() => void} props.onRetry Sends it again, after a failure.
 * @param {() => void} props.onDiscard Drops a failed message.
 */
function PendingMessage({ draft, members, onRetry, onDiscard }) {
  const failed = draft.status === 'failed';
  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_28px] items-end gap-x-2.5">
      <div className="col-start-1 row-start-1 flex max-w-[84%] min-w-0 flex-col items-end justify-self-end">
        <div className={`max-w-full break-words rounded-[16px] rounded-br-none p-3 text-[14px] leading-[22px] ${failed ? 'bg-ink-hover/55 text-white/85' : 'bg-ink-hover text-white'}`}>
          <ReplyQuote replyTo={draft.replyTo} dark />
          {draft.text && (
            <div className="whitespace-pre-wrap">
              <MentionText text={draft.text} members={members} dark issueMentions={draft.issueMentions} />
            </div>
          )}
          {draft.files.length > 0 && (
            <PendingChatAttachments
              files={draft.files}
              progress={draft.progress}
              onRemove={() => {}}
              className="mt-2"
            />
          )}
        </div>
      </div>
      <div className="col-start-1 row-start-2 mt-1 flex flex-row-reverse items-center gap-1 justify-self-end">
        {failed ? (
          <>
            <span className="px-1 text-[10px] font-medium text-danger">Не надіслано</span>
            {/* The same two controls the row under a real message carries, in
                the same size and shape — a failed message is a message, and
                sending it again is one of the things you do to one. */}
            <IconAction label="Надіслати ще раз" icon={RotateCw} size="micro" composition="chat-micro-action" appearance="quiet" shape="micro" onClick={onRetry} title="Надіслати ще раз" />
            <IconAction label="Прибрати повідомлення" icon={Trash2} size="micro" composition="chat-micro-action" appearance="quiet-danger" shape="micro" onClick={onDiscard} title="Прибрати" />
          </>
        ) : (
          <span className="inline-flex items-center gap-1 px-1 text-[10px] font-medium text-muted">
            <Clock size={11} aria-hidden />
            Надсилається
          </span>
        )}
      </div>
    </div>
  );
}

export default function UnifiedTimeline({
  issueId,
  projectId,
  issue,
  isArchived,
  org,
  members = [],
  // Кого пропонує пікер згадок — і це не той самий список, що `members`.
  //
  // `members` — це вся організація, і саме так і має бути: підпис під
  // коментарем має розвʼязати ім'я автора, навіть якщо той давно не в команді
  // проєкту. Але пікер — інше питання. Він не розвʼязує імена, він пропонує
  // покликати людину, і пропонувати він має тих, хто в цьому проєкті справді є.
  // Одним списком обслуговувались обидва питання, тож у чаті задачі можна було
  // тегнути будь-кого з організації — людину, для якої цієї задачі не існує.
  mentionMembers,
  sprints = [],
  isActive = true,
  onUnreadCountChange,
}) {
  const router = useRouter();
  const { currentUser, projects = [], activeOrgId, orgRole } = useAppContext();
  // Owners and admins may remove a comment that should not stand; editing one
  // stays with its author, because an edited comment still carries their name.
  const canModerateComments = can(orgRole, 'moderate:content');
  // Writing and editing a comment are open to every role that can work in the
  // project. Reading that from the matrix rather than assuming it keeps the
  // matrix honest: an entry nothing consults can say anything and stay true.
  //
  // Asked so that a role still in flight is not read as a refusal. Both of
  // these hold for every role in the workspace, so `can(null, …)` returning
  // false could only ever mean "the membership has not arrived" — and it took
  // the composer off the task screen while it hadn't, which looked exactly like
  // a task you are not allowed to write in.
  const canWriteComments = canWhileRoleLoads(orgRole, 'create:comment');
  const canEditOwnComment = canWhileRoleLoads(orgRole, 'edit:comment');
  const showToast = useWorkspaceStore(state => state.showToast);
  const setVisibleConversation = useWorkspaceStore(state => state.setVisibleConversation);
  const clearVisibleConversation = useWorkspaceStore(state => state.clearVisibleConversation);
  const notifications = useWorkspaceStore(state => state.notifications);
  const markNotificationRead = useWorkspaceStore(state => state.notificationActions?.markRead);
  const confirmDialog = useConfirm();
  const project = projects.find(item => item.id === projectId);
  // The history is read out through the live workflow: a project that renamed a
  // status or added one of its own has to read its own words back.
  const { statuses, priorities, types, labels } = useWorkflowConfig();
  const auditContext = useMemo(() => ({
    statuses,
    priorities,
    types,
    labels,
    sprints,
    members,
    timeZone: organizationTimeZone(org),
  }), [statuses, priorities, types, labels, sprints, members, org]);

  // A task discussed for a year must not cost its whole year to open. The feed
  // arrives as a window of the newest activity — the same rule the chat channel
  // follows — and grows only when the reader asks for more.
  const [historyWindow, setHistoryWindow] = useState(1);
  const {
    comments, loading: commentsLoading, hasMore: hasOlderComments,
    addComment, updateComment, deleteComment, markCommentsRead,
  } = useComments(issueId, COMMENT_WINDOW * historyWindow);
  const {
    entries: auditLogs,
    loading: auditLoading,
    hasMore: hasOlderChanges,
  } = useAuditLog(issueId, AUDIT_WINDOW * historyWindow);
  const hasOlderHistory = hasOlderComments || hasOlderChanges;
  const { logs: timeLogs, loading: timeLogsLoading } = useTimeLogs(issueId, projectId);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  // Messages that have been sent and have not come back yet. Each one is drawn
  // at the end of the conversation the instant it is sent, carries its own
  // upload progress, and is dropped when the snapshot brings the real document
  // — or stays, marked as unsent, when the write fails.
  const [pendingMessages, setPendingMessages] = useState([]);
  const pendingSeqRef = useRef(0);
  const [replyTo, setReplyTo] = useState(null);
  const [editingComment, setEditingComment] = useState(null);
  const [viewerAttachment, setViewerAttachment] = useState(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const wrapperRef = useRef(null);
  const unreadMarkerRef = useRef(null);
  const feedRef = useRef(null);
  const feedEndRef = useRef(null);
  const highlightTimerRef = useRef(null);
  // Which message a reply quote is still trying to reach, and the snapshot that
  // has already been searched for it. Refs, not state: a jump in progress is a
  // conversation with the feed, not something the list draws.
  const pendingJumpRef = useRef(null);
  const jumpedOverRef = useRef(null);
  const wasNearBottomRef = useRef(true);
  const wasActiveRef = useRef(false);
  const previousTimelineLengthRef = useRef(0);
  const positionedIssueRef = useRef(null);
  const [isUnreadMarkerVisible, setIsUnreadMarkerVisible] = useState(false);
  const [unreadDirection, setUnreadDirection] = useState('down');
  // Whether the reader has left the end of the conversation. A ref alone could
  // not answer this: the jump control has to redraw when it changes, and only
  // state redraws.
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [highlightedCommentId, setHighlightedCommentId] = useState(null);
  // Waiting for the read cursors is right, and waiting forever is not. They
  // arrive over the network, and a network that cannot answer — an exhausted
  // quota, a denied read — must not leave the conversation unplaced, which is
  // the scroller sitting at the very top of the history. After this the list
  // lands at its newest message, the way a chat with nothing unread opens.
  // Held as «which task has waited long enough», so opening another one resets
  // it during that render rather than through a second state update.
  const [waitedOutFor, setWaitedOutFor] = useState(null);
  const cursorWaitIsOver = waitedOutFor === issueId;
  useEffect(() => {
    const timer = window.setTimeout(() => setWaitedOutFor(issueId), 2500);
    return () => window.clearTimeout(timer);
  }, [issueId]);

  // Reading happens in front of somebody. A pane left open in a background tab
  // is not being read, and the workspace chat has always checked this before it
  // moves its cursor — the task chat marked messages read while the window was
  // behind another one, which is how a conversation could be «прочитано»
  // without ever having been seen.
  //
  // Held as state rather than asked at the moment of intersection, because both
  // observers below have to be rebuilt when the tab comes back: an observer
  // reports what is on screen the moment it starts watching, so returning to a
  // task left open reads it, while nothing at all happens while away.
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const syncVisibility = () => setTabVisible(document.visibilityState === 'visible');
    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, []);

  const [mentionState, setMentionState] = useState({
    active: false,
    query: '',
    startIndex: -1,
    cursorIndex: -1,
    selectedIndex: 0,
    ignoreIndex: -1,
  });
  const [issueMention, setIssueMention] = useState({ active: false, query: '', startIndex: -1, cursorIndex: -1 });
  const resolvedIssues = useRef(new Map());
  const {
    results: issueResults,
    loading: issueSearchLoading,
    search: searchIssues,
    clear: clearIssueSearch,
  } = useSearch();
  useEffect(() => {
    if (!issueMention.active || !activeOrgId) {
      clearIssueSearch();
      return;
    }
    searchIssues(issueMention.query, activeOrgId, null, { mention: true });
  }, [activeOrgId, clearIssueSearch, issueMention.active, issueMention.query, searchIssues]);

  const myId = currentUser?.uid || currentUser?.id;
  // The same cursor the dot on the card reads, and now the same cursor the
  // conversation reads. It is already in the store, so neither the unread
  // messages nor the boundary cost a read of their own.
  //
  // Until the cursor stream has actually answered, this reads 0 — «never seen
  // anything» — and every line of the task's history back to the day it was
  // created counts as new. That is where «9 нових» pointing at the top of a
  // task nobody had touched came from, so nothing is judged unread before the
  // answer arrives.
  const readCursorsLoaded = useWorkspaceStore(state => state.issueReadStateLoaded);
  const lastSeenAt = useWorkspaceStore(state => state.issueReadState[issueId] || 0);
  const unreadChangeIds = useMemo(() => {
    if (!myId || !readCursorsLoaded) return [];
    return auditLogs
      .filter(entry => isIssueChangeUnread(entry, lastSeenAt, myId))
      .map(entry => entry.id);
  }, [auditLogs, lastSeenAt, myId, readCursorsLoaded]);
  // What is new in the conversation, answered by that same cursor rather than by
  // a mark inside every message. A message used to stay unread until this
  // reader's id appeared in its own `readBy`, which is what made reading fifty
  // messages cost fifty writes; the cursor already knows, and it answers the
  // card and the change feed by this very comparison.
  const unreadMessages = useMemo(() => {
    if (!myId || !readCursorsLoaded) return [];
    return comments.filter(comment => (
      comment.authorId !== myId
      && timestampMillis(comment.createdAt) > timestampMillis(lastSeenAt)
    ));
  }, [comments, lastSeenAt, myId, readCursorsLoaded]);
  const unreadCommentIds = useMemo(
    () => unreadMessages.map(comment => comment.id),
    [unreadMessages],
  );
  // Whose ticks to draw under this reader's own messages, gathered once for the
  // whole window instead of read out of each message on its own.
  const myReceiptMarks = useMemo(() => receiptMarks(comments, myId), [comments, myId]);

  const filteredMembers = useMemo(() => {
    if (!mentionState.active) return [];
    return filterMentionCandidates(mentionMembers || members, myId, mentionState.query);
  }, [mentionState.active, mentionState.query, mentionMembers, members, myId]);

  // «Друкує…», on the workspace chat's own mechanism. A flag is only worth
  // anything while it is fresh, so the list is recomputed on a clock of its own
  // — otherwise somebody who closed their laptop mid-sentence stays typing
  // until the next message arrives.
  const { typingState, setTyping } = useIssueTyping(issueId, { userId: myId, active: isActive });
  const typingHeartbeat = typingState?.typing?.length || 0;
  const [typingNow, setTypingNow] = useState(() => Date.now());
  useEffect(() => {
    if (!typingHeartbeat) return undefined;
    const timer = window.setInterval(() => setTypingNow(Date.now()), 2000);
    return () => window.clearInterval(timer);
  }, [typingHeartbeat]);
  const typingNames = useMemo(() => activeTypingUserIds(typingState, { now: typingNow, exclude: myId })
    .map(uid => members.find(member => (member.id || member.uid) === uid)?.name)
    .filter(Boolean), [members, myId, typingNow, typingState]);
  const typingRef = useRef(null);
  const noteTyping = () => {
    setTyping(true);
    clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => setTyping(false), 2000);
  };

  const timeline = useMemo(() => {
    const items = [];
    comments.forEach(comment => items.push({
      _type: 'comment',
      _time: comment.createdAt?.toMillis ? comment.createdAt.toMillis() : 0,
      ...comment,
    }));
    auditLogs.forEach(entry => items.push({
      _type: 'audit',
      _time: entry.createdAt?.toMillis ? entry.createdAt.toMillis() : 0,
      ...entry,
    }));
    timeLogs.forEach(log => items.push({
      _type: 'time',
      _time: log.loggedAt?.toMillis ? log.loggedAt.toMillis() : 0,
      ...log,
    }));
    return items.sort((a, b) => a._time - b._time);
  }, [comments, auditLogs, timeLogs]);

  // Where the optimistic message hands over to the real one. A transaction is
  // not applied to the local cache the way a plain write is, so the snapshot
  // arrives only once the server has it — until then the draft is the message,
  // and the id the write already knows is what recognises the two as one.
  //
  // Read out of the list rather than deleted from it, because deciding this is
  // arithmetic on what the snapshot says and not an event: a draft is finished
  // the moment its document is in `comments`, whether or not anything else
  // happens afterwards. A draft also belongs to the task it was typed in — going
  // to another task leaves it be, so an unsent message is still there, and still
  // retryable, when the sender comes back to it.
  const arrivedCommentIds = useMemo(() => new Set(comments.map(comment => comment.id)), [comments]);
  const draftSettled = useCallback(
    draft => Boolean(draft.serverId) && (draft.issueId !== issueId || arrivedCommentIds.has(draft.serverId)),
    [arrivedCommentIds, issueId],
  );
  const visibleDrafts = useMemo(
    () => pendingMessages.filter(draft => draft.issueId === issueId && !draftSettled(draft)),
    [draftSettled, issueId, pendingMessages],
  );

  // One boundary for the whole feed. Messages and changes are two kinds of the
  // same thing to a reader coming back to a task — «що тут сталося без мене» —
  // and the line used to be drawn from the messages alone, so a task where
  // somebody moved the deadline and said nothing looked untouched below it.
  const unreadTotal = unreadCommentIds.length + unreadChangeIds.length;
  const liveFirstUnreadKey = useMemo(() => {
    if (unreadTotal === 0) return null;
    const unreadComments = new Set(unreadCommentIds);
    const unreadChanges = new Set(unreadChangeIds);
    const first = timeline.find(item => (
      (item._type === 'comment' && unreadComments.has(item.id))
      || (item._type === 'audit' && unreadChanges.has(item.id))
    ));
    return first ? `${first._type}-${first.id}` : null;
  }, [timeline, unreadCommentIds, unreadChangeIds, unreadTotal]);

  // Where the line was when this visit began, and where it stays for the rest
  // of it. Reading is what empties `unreadTotal`, and a boundary derived
  // straight from it therefore vanished the instant it was read — taking its
  // own height out of the list under the reader and leaving nothing to say what
  // had been new. Every messenger keeps that line until you leave and come
  // back; so does this one now.
  //
  // Latched during render, not in an effect: it is derived from what this very
  // render already knows, and an effect would mean one painted frame in which
  // the list has no line — at exactly the moment the list is being placed on it.
  //
  // «Settled» is the second half of the same problem. A task's feed arrives as
  // three subscriptions that finish in three different renders, and a boundary
  // latched off the first of them names the first unread *comment* in a task
  // whose oldest unread item is a change. It waits for all three.
  const feedSettled = (readCursorsLoaded || cursorWaitIsOver)
    && !commentsLoading && !auditLoading && !timeLogsLoading;
  const BOUNDARY_NONE = { key: null, count: 0, read: false, dismissed: false };
  const [boundary, setBoundary] = useState({ issueId: null, ...BOUNDARY_NONE });
  if (boundary.issueId !== issueId) {
    setBoundary({ issueId, ...BOUNDARY_NONE });
  } else if (isActive && feedSettled && !boundary.key && liveFirstUnreadKey) {
    setBoundary({ ...boundary, key: liveFirstUnreadKey, count: unreadTotal });
  }
  const sessionBoundary = boundary.issueId === issueId ? boundary.key : null;
  const boundaryCount = boundary.count;
  // Taken down by answering, and by leaving. The line is a landmark, not a
  // notice, and it used to be removable in exactly one way — putting a mouse
  // pointer on it. A phone has no pointer to put anywhere, so on a phone the
  // line was permanent for the whole visit; and on a desktop it stood over a
  // conversation the reader was actively taking part in, with their own replies
  // under it. Sending a message is the strongest statement there is that
  // everything above has been read, so that is what takes it down.
  // Kept on the boundary itself, which is already reset by a change of task, so
  // there is no second piece of state to keep in step with the first.
  const dismissBoundary = useCallback(
    () => setBoundary(current => (current.dismissed ? current : { ...current, dismissed: true })),
    [],
  );

  // One control, because to a reader there is one question: «take me to what I
  // have not seen». While an unread line exists off screen it points there;
  // otherwise, if the reader has climbed into the history, it points at the end
  // of the conversation — which is what somebody reading upwards while messages
  // arrive below them needs, and never had. Its number is live, unlike the
  // line's, which is exactly why the line no longer carries one.
  // Described here, performed in the handler: what it points at is a fact about
  // this render, while reaching for the scroller is not.
  const jumpTarget = (() => {
    if (sessionBoundary && !boundary.dismissed && !isUnreadMarkerVisible && unreadTotal > 0) {
      return {
        to: 'unread',
        label: `${unreadTotal} ${plural(unreadTotal, ['нове', 'нові', 'нових'])}`,
        icon: unreadDirection === 'up' ? ChevronUp : ChevronDown,
      };
    }
    if (isScrolledUp) return { to: 'bottom', label: 'До останнього', icon: ChevronDown };
    return null;
  })();

  const unreadLabel = unreadChangeIds.length === 0
    ? 'Нові повідомлення'
    : (unreadCommentIds.length === 0 ? 'Нові зміни' : 'Нове в задачі');
  const renderUnreadBoundary = itemKey => (itemKey === sessionBoundary && !boundary.dismissed ? (
    <div
      ref={unreadMarkerRef}
      className={`transition-opacity duration-300 ${boundary.read ? 'opacity-70' : 'opacity-100'}`}
    >
      <UnreadDivider label={unreadLabel} />
    </div>
  ) : null);

  const resetComposer = () => {
    setInput('');
    setPendingFiles([]);
    setReplyTo(null);
    setEditingComment(null);
  };

  const focusComposer = () => setTimeout(() => inputRef.current?.focus(), 0);

  const beginReply = comment => {
    setEditingComment(null);
    setReplyTo({ id: comment.id, authorName: comment.authorName, text: comment.text });
    focusComposer();
  };

  const beginEdit = comment => {
    setReplyTo(null);
    setPendingFiles([]);
    setEditingComment(comment);
    setInput(comment.text || '');
    focusComposer();
  };

  const handleDelete = async (comment, mine = true) => {
    const hasFiles = Array.isArray(comment.attachments) && comment.attachments.length > 0;
    const confirmed = await confirmDialog({
      title: mine ? 'Видалити повідомлення?' : 'Видалити повідомлення учасника?',
      message: hasFiles
        ? 'Повідомлення та прикріплені файли буде видалено остаточно, зокрема зі сховища.'
        : 'Цю дію неможливо скасувати.',
      confirmText: 'Видалити',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await deleteComment(comment.id, comment.attachments);
      if (editingComment?.id === comment.id || replyTo?.id === comment.id) resetComposer();
    } catch (error) {
      showToast(`Не вдалося видалити повідомлення: ${error.message}`, 'error');
    }
  };

  const checkMentions = (text, cursorPosition) => {
    setMentionState(previous => {
      const lastAtIndex = text.lastIndexOf('@', cursorPosition - 1);
      const lastQuoteIndex = text.lastIndexOf('"', cursorPosition - 1);
      const triggerIndex = Math.max(lastAtIndex, lastQuoteIndex);
      if (triggerIndex === -1) return { active: false, query: '', startIndex: -1, cursorIndex: -1, selectedIndex: 0, ignoreIndex: -1 };
      const precedingChar = triggerIndex > 0 ? text[triggerIndex - 1] : '';
      if (precedingChar && !/[\s([{]/.test(precedingChar)) {
        return { active: false, query: '', startIndex: -1, cursorIndex: -1, selectedIndex: 0, ignoreIndex: -1 };
      }
      const textBetween = text.slice(triggerIndex + 1, cursorPosition);
      if (/[\n@"]/.test(textBetween)) return { active: false, query: '', startIndex: -1, cursorIndex: -1, selectedIndex: 0, ignoreIndex: -1 };
      if (previous.ignoreIndex === triggerIndex) return previous;
      return {
        active: true,
        query: textBetween,
        startIndex: triggerIndex,
        cursorIndex: cursorPosition,
        selectedIndex: previous.active && previous.startIndex === triggerIndex ? previous.selectedIndex : 0,
        ignoreIndex: -1,
      };
    });
  };

  // The same rule the workspace composer uses: `#` at a word boundary, and the
  // run of letters, digits and dashes after it.
  const checkIssueMention = (text, cursorPosition) => {
    const before = text.slice(0, cursorPosition);
    const match = before.match(/(?:^|[\s([{])#([\p{L}\p{N}-]*)$/u);
    if (!match) {
      setIssueMention(previous => (previous.active
        ? { active: false, query: '', startIndex: -1, cursorIndex: -1 }
        : previous));
      return;
    }
    setIssueMention({
      active: true,
      query: match[1].toLocaleLowerCase('uk-UA'),
      startIndex: cursorPosition - match[1].length - 1,
      cursorIndex: cursorPosition,
    });
  };

  const selectIssueMention = mentioned => {
    if (!mentioned?.issueKey) return;
    // The picker had the name on screen; the comment keeps it.
    resolvedIssues.current.set(
      String(mentioned.issueKey).toLocaleUpperCase('uk-UA'),
      { id: mentioned.id, title: mentioned.title || '' },
    );
    const textBefore = input.slice(0, issueMention.startIndex);
    const textAfter = input.slice(issueMention.cursorIndex);
    const mentionText = `#${mentioned.issueKey} `;
    setInput(textBefore + mentionText + textAfter);
    setIssueMention({ active: false, query: '', startIndex: -1, cursorIndex: -1 });
    clearIssueSearch();
    setTimeout(() => {
      if (!inputRef.current) return;
      const cursorPosition = textBefore.length + mentionText.length;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
    }, 0);
  };

  const selectMention = member => {
    if ((member?.id || member?.uid) === myId) return;
    const textBefore = input.slice(0, mentionState.startIndex);
    const textAfter = input.slice(mentionState.cursorIndex);
    const mentionText = `@${member.name} `;
    setInput(textBefore + mentionText + textAfter);
    setMentionState({ active: false, query: '', startIndex: -1, cursorIndex: -1, selectedIndex: 0, ignoreIndex: -1 });
    setTimeout(() => {
      if (!inputRef.current) return;
      const cursorPosition = textBefore.length + mentionText.length;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(cursorPosition, cursorPosition);
    }, 0);
  };

  useEffect(() => {
    if (!mentionState.active) return undefined;
    const handleOutsideClick = event => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setMentionState({ active: false, query: '', startIndex: -1, cursorIndex: -1, selectedIndex: 0, ignoreIndex: -1 });
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [mentionState.active]);

  const scrollToUnread = (behavior = 'smooth') => {
    unreadMarkerRef.current?.scrollIntoView({ behavior, block: 'center' });
  };

  const scrollToBottom = (behavior = 'smooth') => {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollTo({ top: scroll.scrollHeight, behavior });
  };

  // Where the reader is standing, answered from the scroller itself rather than
  // remembered from the last scroll event — a list that has not been scrolled
  // yet never fired one, and a list whose images have just finished decoding
  // fired one that is no longer true.
  const syncScrollPosition = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < AT_BOTTOM_SLACK;
    wasNearBottomRef.current = atBottom;
    setIsScrolledUp(previous => (previous === !atBottom ? previous : !atBottom));
  }, []);

  // Bringing one message into view and marking it, briefly, as the one that was
  // asked for — a conversation scrolled by a click has to say where it landed.
  const revealComment = useCallback(commentId => {
    const target = scrollRef.current?.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedCommentId(commentId);
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = window.setTimeout(() => setHighlightedCommentId(null), 1800);
    return true;
  }, []);

  const giveUpOnJump = useCallback(moreToLoad => {
    pendingJumpRef.current = null;
    showToast(moreToLoad
      ? 'Повідомлення надто давнє — відкрийте давнішу історію'
      : 'Це повідомлення видалено', 'error');
  }, [showToast]);

  // The answered message is often older than the window the feed opened on, so
  // the click grows the history until it is found rather than doing nothing.
  // Bounded: each step is another `COMMENT_WINDOW` of reads, and a quote left
  // behind by a message deleted long ago must not walk a year of conversation
  // to discover that.
  const jumpToComment = useCallback(commentId => {
    if (!commentId || revealComment(commentId)) return;
    if (!hasOlderComments || historyWindow >= JUMP_HISTORY_LIMIT) {
      giveUpOnJump(hasOlderComments);
      return;
    }
    pendingJumpRef.current = commentId;
    // The attempt this click already made, so the wait below starts at the
    // *next* snapshot rather than immediately repeating what just failed.
    jumpedOverRef.current = comments;
    setHistoryWindow(current => current + 1);
  }, [comments, giveUpOnJump, hasOlderComments, historyWindow, revealComment]);

  // Every wider window arrives as a new snapshot, and the target is looked for
  // once per snapshot — after the render that drew it, which is why this waits
  // for a frame rather than reading the DOM straight out of the effect.
  useEffect(() => {
    if (!pendingJumpRef.current || commentsLoading || jumpedOverRef.current === comments) {
      return undefined;
    }
    jumpedOverRef.current = comments;
    const frame = requestAnimationFrame(() => {
      const commentId = pendingJumpRef.current;
      if (!commentId) return;
      if (revealComment(commentId)) {
        pendingJumpRef.current = null;
        return;
      }
      if (!hasOlderComments || historyWindow >= JUMP_HISTORY_LIMIT) {
        giveUpOnJump(hasOlderComments);
        return;
      }
      setHistoryWindow(current => current + 1);
    });
    return () => cancelAnimationFrame(frame);
  }, [comments, commentsLoading, giveUpOnJump, hasOlderComments, historyWindow, revealComment]);

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  // Landing the conversation, once.
  //
  // This effect re-ran on every change to `timeline.length`, and a task's feed
  // does not arrive in one piece: comments, changes and time logs are three
  // separate subscriptions that settle in three separate renders. The first of
  // them placed the reader on the unread line correctly — and the second, no
  // longer the "first position", fell through to `wasNearBottomRef`, which is
  // `true` before anybody has scrolled anything. So the list snapped to the
  // newest message a frame later, and a task opened with eleven unread items
  // showed its bottom. The flag that says "this issue has been placed" is now
  // set by the placement itself rather than by having run at all.
  useEffect(() => {
    // The reset belongs to the transition itself, not to the first render that
    // also has something to show: leaving it below the guard meant reopening a
    // task whose feed had not arrived yet consumed the transition and never
    // placed the conversation at all.
    if (isActive && !wasActiveRef.current) positionedIssueRef.current = null;
    wasActiveRef.current = isActive;
    if (!isActive || timeline.length === 0) return undefined;
    const shouldPositionConversation = positionedIssueRef.current !== issueId;

    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      if (shouldPositionConversation) {
        // Waiting for the boundary rather than placing at the bottom and
        // correcting afterwards — that correction is the jump this was reported
        // for. `sessionBoundary` is in this effect's dependencies precisely so
        // that the wait ends: the line is latched during a render that changes
        // neither the feed's length nor the unread count, so an effect that did
        // not watch it simply never ran again, and the conversation stayed
        // where an unplaced scroller sits — at the very top.
        if (!feedSettled) return;
        if (sessionBoundary && !unreadMarkerRef.current) return;
        positionedIssueRef.current = issueId;
        if (unreadMarkerRef.current) scrollToUnread('auto');
        else scroll.scrollTop = scroll.scrollHeight;
      } else if (wasNearBottomRef.current) {
        // Afterwards the list only follows new activity, and only for a reader
        // who is already at the bottom of it.
        scroll.scrollTop = scroll.scrollHeight;
      }
      // And wherever it landed, that is now where the reader is standing — read
      // off the scroller rather than waited for as a scroll event, because a
      // list placed by code never fires one.
      syncScrollPosition();
    });
    return () => cancelAnimationFrame(frame);
  }, [feedSettled, isActive, issueId, sessionBoundary, syncScrollPosition, timeline.length]);

  // A compact task screen keeps the timeline mounted while its chat pane is
  // hidden. That preserves the live unread badge without falsely consuming the
  // messages before the reader actually opens the chat.
  useEffect(() => {
    onUnreadCountChange?.(unreadCommentIds.length);
  }, [onUnreadCountChange, unreadCommentIds.length]);

  // Changes were consumed only by leaving the task, which is why the badge
  // stayed at «11 нових» for a whole visit however far you read: nothing on
  // this screen could move that cursor. Seeing the boundary is the same act of
  // reading for a change as it is for a message, so it consumes both halves
  // now, and the count actually falls to zero while you are looking at it.
  // A number, not the array it came from: an audit snapshot arrives with a new
  // array identity every time it refreshes, and hanging the observer's callback
  // off that identity meant the half-second read timer was torn down and
  // restarted by traffic that had changed nothing.
  const newestActivityMillis = useMemo(() => Math.max(
    issueActivityCursor(issue),
    ...auditLogs.map(entry => timestampMillis(entry.createdAt)),
    0,
  ), [auditLogs, issue]);
  const consumeChanges = useCallback(() => {
    if (!activeOrgId || !myId || !issueId || !newestActivityMillis) return;
    markIssueSeen({
      organizationId: activeOrgId,
      issueId,
      userId: myId,
      lastSeenAt: new Date(newestActivityMillis),
    }).catch(error => reportLoadError('[task-chat] mark changes seen', error));
  }, [activeOrgId, issueId, myId, newestActivityMillis]);

  // A notification exists to bring somebody to a conversation. Standing in that
  // conversation, the record has already done its whole job, so it is marked
  // read instead of sitting in the bell as a badge for something on screen.
  const dismissIssueNotifications = useCallback(() => {
    if (!markNotificationRead || !issueId) return;
    const answered = notifications.filter(notification => (
      !notification.read
      && notification.issueId === issueId
      && (notification.type === 'commented'
        || notification.type === 'mentioned'
        || notification.type === 'chat_message')
    ));
    if (answered.length === 0) return;
    Promise.allSettled(answered.map(notification => markNotificationRead(notification.id)));
  }, [issueId, markNotificationRead, notifications]);

  // Знято щойно воно з'явилось, а не тоді, коли межа непрочитаного втрапить у
  // видиму частину списку. Це те саме, що робочий чат робить для відкритого
  // каналу, і завданню бракувало саме цього: запис приходив, дзвоник спалахував
  // «(1)», а за півсекунди спостерігач кінця стрічки гасив його — і так на
  // кожне повідомлення. Лічильник, який блимає над розмовою, що ти її читаєш, —
  // це не інформація.
  //
  // Курсор прочитаного цього не стосується: він і далі живе за суворішим
  // правилом (`consumeConversation`), бо позначка «прочитано» на повідомленні —
  // обіцянка іншій людині, а запис у дзвонику — лише спосіб тебе сюди привести.
  useEffect(() => {
    if (!isActive || !tabVisible) return;
    dismissIssueNotifications();
  }, [dismissIssueNotifications, isActive, tabVisible]);

  // Reading the conversation, in every sense this product keeps one: the
  // messages, the changes, the line that says where you stopped, and the
  // records in the bell that were only ever there to bring you here. Three
  // callers reach it — the unread line coming into view, the end of the feed
  // coming into view, and answering — and they must not each remember their own
  // half of the list.
  const consumeConversation = useCallback(() => {
    if (!myId) return;
    // Only the newest message from each other author carries a mark: it is the
    // one the ✓✓ receipt needs, and it covers every older message of theirs.
    // Unread itself is the cursor `consumeChanges` writes on the next line.
    const receipts = receiptMarkIds(unreadMessages, myId);
    if (receipts.length > 0) markCommentsRead(receipts, myId);
    consumeChanges();
    setBoundary(current => (current.read ? current : { ...current, read: true }));
    dismissIssueNotifications();
  }, [consumeChanges, dismissIssueNotifications, markCommentsRead, myId, unreadMessages]);

  // What the reader currently has in front of them, so the live notification
  // popup can stay down for a message that arrived on this very screen instead
  // of landing on top of the conversation it is announcing.
  useEffect(() => {
    if (!isActive || !issueId) return undefined;
    const conversation = { kind: 'issue', id: issueId };
    setVisibleConversation(conversation);
    return () => clearVisibleConversation(conversation);
  }, [clearVisibleConversation, isActive, issueId, setVisibleConversation]);

  // Read receipts: a visible pane alone is not enough. The unread boundary has
  // to enter the scroll viewport, so opening a long task chat cannot consume
  // messages that remained above or below the fold.
  //
  // The observer also reports which way the line lies. The jump button carried a
  // fixed chevron pointing down while the boundary, on a conversation that had
  // been sent to its bottom, was almost always above — so it announced eleven
  // new messages, pointed down, and then scrolled up.
  useEffect(() => {
    const marker = unreadMarkerRef.current;
    const scroll = scrollRef.current;
    if (!isActive || !tabVisible || !myId || unreadTotal === 0 || !marker || !scroll) {
      return undefined;
    }

    let readTimer = null;
    const observer = new IntersectionObserver(([entry]) => {
      setIsUnreadMarkerVisible(entry.isIntersecting);
      if (!entry.isIntersecting && entry.rootBounds) {
        setUnreadDirection(entry.boundingClientRect.top < entry.rootBounds.top ? 'up' : 'down');
      }
      if (!entry.isIntersecting || readTimer) return;
      readTimer = window.setTimeout(consumeConversation, 500);
    }, { root: scroll, threshold: 0.8 });

    observer.observe(marker);
    return () => {
      observer.disconnect();
      if (readTimer) window.clearTimeout(readTimer);
    };
    // The line itself is in the dependencies because the marker is a ref, and a
    // task's feed latches its boundary a render *after* the unread count that
    // this effect otherwise watches. Without it the observer ran once against a
    // marker that had not mounted yet, returned, and was never rebuilt — so
    // messages sat unread under a reader who was looking straight at them.
  }, [boundary.dismissed, consumeConversation, isActive, myId, sessionBoundary, tabVisible, unreadTotal]);

  // Reading is not only crossing the line. The boundary is the landmark for a
  // conversation you came back to; a message that arrives while you are already
  // sitting at the bottom of one never crosses it, and there was nothing else
  // on this screen that could consume it — so the tab kept «1», and a reload
  // drew «Нові повідомлення (1)» over a message that had been on screen the
  // whole time. Seeing the end of the conversation is reading too.
  useEffect(() => {
    const feedEnd = feedEndRef.current;
    const scroll = scrollRef.current;
    if (!isActive || !tabVisible || !myId || unreadCommentIds.length === 0 || !feedEnd || !scroll) {
      return undefined;
    }

    let readTimer = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) {
        if (readTimer) window.clearTimeout(readTimer);
        readTimer = null;
        return;
      }
      if (readTimer) return;
      readTimer = window.setTimeout(consumeConversation, 500);
    }, { root: scroll });

    observer.observe(feedEnd);
    return () => {
      observer.disconnect();
      if (readTimer) window.clearTimeout(readTimer);
    };
  }, [consumeConversation, isActive, myId, tabVisible, unreadCommentIds.length]);

  // A list that grows under a reader sitting at the end of it has to keep them
  // there. An image finishing its decode, or a composer growing by a line, used
  // to leave the newest message below the fold — the same correction the
  // workspace chat has always made and this one never did. It stands down until
  // the conversation has been placed, because during placement the list is on
  // its way to the unread line, not to the bottom.
  useEffect(() => {
    const feed = feedRef.current;
    if (!isActive || !feed || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (positionedIssueRef.current !== issueId || !wasNearBottomRef.current) return;
      requestAnimationFrame(() => {
        const scroll = scrollRef.current;
        if (scroll && wasNearBottomRef.current) scroll.scrollTop = scroll.scrollHeight;
      });
    });
    observer.observe(feed);
    return () => observer.disconnect();
  }, [isActive, issueId]);

  const addPendingFiles = fileList => {
    const files = Array.from(fileList || []);
    // Same rule and same wording as the workspace composer: the file that was
    // refused says so itself, instead of one flat sentence carrying a size limit
    // that was never the storage's real one.
    const rejected = files.map(file => ({ file, ...uploadFilePolicy(file) })).filter(entry => entry.error);
    const accepted = files
      .filter(file => !uploadFilePolicy(file).error)
      .slice(0, Math.max(0, 5 - pendingFiles.length));
    if (rejected.length > 0) {
      showToast(`${rejected[0].file.name}: ${rejected[0].error}`, 'error');
    } else if (accepted.length !== files.length) {
      showToast('До 5 файлів на повідомлення', 'error');
    }
    setPendingFiles(previous => [...previous, ...accepted]);
  };

  // The whole of sending, once the message has already been drawn: the files go
  // up, the comment is written, and the people with a stake in the task are
  // told. Separate from the handler because a message that failed to send can be
  // sent again without being typed again — the draft is still on screen.
  const deliverComment = useCallback(async draft => {
    const patchDraft = changes => setPendingMessages(current => current.map(item => (
      item.clientId === draft.clientId ? { ...item, ...changes } : item
    )));
    try {
      const folder = `organizations/${project?.organizationId || 'shared'}/comments`;
      const attachments = [];
      for (const [index, file] of draft.files.entries()) {
        attachments.push(await uploadFile(file, folder, percent => {
          setPendingMessages(current => current.map(item => (
            item.clientId === draft.clientId
              ? { ...item, progress: { ...item.progress, [index]: percent } }
              : item
          )));
        }));
      }
      // Той самий список, що його пропонує пікер, а не вся організація.
      // Пікер був підказкою, а не дверима: дописане руками «@Імʼя» резолвилось
      // по повному списку й тегало людину, для якої цієї задачі не існує.
      // Двері — на сервері (`/api/notifications` відмовляє тим, хто не дістає
      // проєкту); тут просто нічого зайвого не резолвиться.
      const mentionedUserIds = extractMentionedUserIds(draft.text, mentionMembers || members, myId);
      const commentId = await addComment(issueId, draft.text, currentUser, attachments, draft.replyTo, {
        mentionedUserIds,
        issueMentions: draft.issueMentions,
        // Щоб розмова підняла проєкт на головному екрані — див. `addComment`.
        // Разом зі штампом, який там уже стоїть: свіжий штамп означає, що
        // писати вдруге нема потреби.
        projectId: project?.id || projectId,
        projectAt: project?.updatedAt,
      });
      // From here the message exists. The draft stays on screen until the
      // snapshot carrying it arrives — dropping it now would blink the message
      // out and back in — and the id is how the two are recognised as one.
      patchDraft({ serverId: commentId, status: 'sent' });
      const taskChatLink = `${issuePath(issue, project || projectId)}?view=chat`;
      if (mentionedUserIds.length > 0) {
        try {
          const result = await sendNotification({
            userIds: mentionedUserIds,
            type: 'mentioned',
            title: `${currentUser?.name || 'Колега'} згадав вас у завданні`,
            body: draft.text.slice(0, 500),
            link: taskChatLink,
            issueId,
            projectId,
            organizationId: project?.organizationId || org?.id || '',
          });
          // Правило, а не збій: сервер не кличе в проєкт тих, хто до нього не
          // дістає. Сказати про це має саме той, хто щойно писав повідомлення —
          // мовчазно проковтнута згадка виглядає як доставлена.
          if (result?.skippedNoProjectAccess > 0) {
            showToast(
              `Не сповіщено ${result.skippedNoProjectAccess} ${plural(result.skippedNoProjectAccess, ['учасника', 'учасників', 'учасників'])}: немає доступу до проєкту`,
              'warning',
            );
          }
        } catch (notificationError) {
          console.error('[task-chat] mention notification failed:', notificationError);
          showToast('Повідомлення надіслано, але сповіщення про згадку не доставлено', 'error');
        }
      }

      // Відповідь адресована конкретній людині, і досі вона нічим не
      // відрізнялась від будь-якого іншого повідомлення в стрічці: той, кому
      // відповіли, дізнавався про це тим самим загальним «написав у завданні»,
      // що й решта учасників, або не дізнавався зовсім, якщо вимкнув коментарі.
      // Гілка в робочому чаті так не робить — вона сповіщає саме тих, до кого
      // звернулись. Автора беремо зі стрічки, що вже відкрита: `replyTo` несе
      // лише ім'я для цитати, а не id.
      const repliedToAuthorId = draft.replyTo?.id
        ? comments.find(item => item.id === draft.replyTo.id)?.authorId || ''
        : '';
      const replyRecipients = repliedToAuthorId
        && repliedToAuthorId !== myId
        && !mentionedUserIds.includes(repliedToAuthorId)
        ? [repliedToAuthorId]
        : [];
      if (replyRecipients.length > 0) {
        sendNotification({
          userIds: replyRecipients,
          type: 'chat_message',
          title: `${currentUser?.name || 'Колега'} відповів вам у завданні`,
          body: draft.text.slice(0, 500) || 'Вкладення',
          link: taskChatLink,
          issueId,
          projectId,
          organizationId: project?.organizationId || org?.id || '',
        }).catch(error => console.error('[task-chat] reply notification failed:', error));
      }

      // Everyone with a stake in the task hears about a new comment. Nothing
      // sent this type before — «Новий коментар» sat in Settings as a switch
      // wired to no sender at all, so it silently did nothing. Mentioned
      // people are excluded: they already get the mention, which says the
      // same thing more precisely — and so is the person answered directly,
      // whose reply record is more precise still.
      const commentRecipients = issueParticipants(issue, {
        actorId: myId,
        commentAuthorIds: comments.map(item => item.authorId),
        exclude: [...mentionedUserIds, ...replyRecipients],
      });
      if (commentRecipients.length > 0) {
        sendNotification({
          userIds: commentRecipients,
          type: 'commented',
          title: `${currentUser?.name || 'Колега'} написав у завданні`,
          body: draft.text.slice(0, 500) || 'Вкладення',
          link: taskChatLink,
          issueId,
          projectId,
          organizationId: project?.organizationId || org?.id || '',
        }).catch(error => console.error('[task-chat] comment notification failed:', error));
      }
    } catch (error) {
      // The message stays where the sender put it, marked as what it is. It used
      // to vanish with the composer's contents, so a failed send was a message
      // typed twice.
      patchDraft({ status: 'failed' });
      showToast(`Помилка надсилання: ${error.message}`, 'error');
    }
  }, [addComment, comments, currentUser, issue, issueId, members, mentionMembers, myId, org, project, projectId, showToast]);

  const retryPendingMessage = draft => {
    setPendingMessages(current => current.map(item => (
      item.clientId === draft.clientId
        ? { ...item, status: 'sending', progress: Object.fromEntries(item.files.map((_, index) => [index, 0])) }
        : item
    )));
    void deliverComment(draft);
  };

  const discardPendingMessage = draft => {
    setPendingMessages(current => current.filter(item => item.clientId !== draft.clientId));
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    // The message is the answer; nobody is still typing it.
    clearTimeout(typingRef.current);
    setTyping(false);

    // Editing is still a form: the message is already on screen and the change
    // has to land on it, so the composer waits for the write.
    if (editingComment) {
      if (sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      try {
        await updateComment(editingComment.id, text);
        resetComposer();
      } catch (error) {
        showToast(`Помилка надсилання: ${error.message}`, 'error');
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
      return;
    }

    // A new message is not. It appears the moment it is sent — marked as being
    // sent, and settled by the snapshot that carries the real one — because
    // waiting for a Firestore transaction to answer is a second of an empty
    // conversation and a composer that has swallowed what you typed.
    pendingSeqRef.current += 1;
    const draft = {
      clientId: `draft-${pendingSeqRef.current}`,
      issueId,
      text,
      files: pendingFiles,
      replyTo,
      issueMentions: collectIssueMentions(text, resolvedIssues.current),
      // Seeded at zero so the files read as «being sent» from the first frame,
      // rather than offering a remove button for an upload already under way.
      progress: Object.fromEntries(pendingFiles.map((_, index) => [index, 0])),
      status: 'sending',
      serverId: null,
      createdAt: new Date(),
    };
    // The settled ones go here rather than in an effect of their own: a list
    // that is already being rewritten is the cheapest place to drop what it no
    // longer needs.
    setPendingMessages(current => [...current.filter(item => !draftSettled(item)), draft]);
    resetComposer();
    // Answering is the strongest statement there is that everything above
    // has been read, and every messenger treats it that way. Ours did not:
    // the unread line stood over a conversation with the reader's own
    // replies under it, and the tab kept counting messages they had plainly
    // seen. It also takes the line down, because it has nothing left to say.
    consumeConversation();
    dismissBoundary();
    // And wherever they were standing in the history, their own message is
    // what they are now looking for.
    wasNearBottomRef.current = true;
    setIsScrolledUp(false);
    scrollToBottom();
    void deliverComment(draft);
  };

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      {viewerAttachment && <AttachmentViewer attachment={viewerAttachment} onClose={() => setViewerAttachment(null)} />}
      <div
        ref={scrollRef}
        onScroll={syncScrollPosition}
        className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-5"
      >
        {timeline.length === 0 && (
          <EmptyState
            icon={ChatIcon}
            title="Ще немає повідомлень"
            description="Почніть обговорення завдання з командою."
            context="flexible"
          />
        )}

        {/* One box around the messages, so their combined height can be
            watched. A picture that finishes decoding after the list was placed
            grows this box and nothing else, and the scroller re-pins itself to
            the bottom; without a box to watch, the reader was simply left short
            of it. */}
        <div ref={feedRef} className="flex flex-col gap-4">
        {/* The window's edge, and the way past it. Without this control the
            feed would simply end, and a task's older history would be
            unreachable rather than merely unloaded. */}
        {hasOlderHistory && timeline.length > 0 && (
          <LoadOlderButton onClick={() => setHistoryWindow(current => current + 1)}>
            Показати давнішу історію
          </LoadOlderButton>
        )}

        {timeline.map((item, index) => {
          const itemTimestamp = item._type === 'time' ? item.loggedAt : item.createdAt;
          const previousItem = timeline[index - 1];
          const previousTimestamp = previousItem?._type === 'time' ? previousItem.loggedAt : previousItem?.createdAt;
          const separator = index === 0 || dayKey(itemTimestamp) !== dayKey(previousTimestamp)
            ? <DaySeparator timestamp={itemTimestamp} />
            : null;

          if (item._type === 'comment') {
            const isMe = item.authorId === currentUser?.uid || item.authorId === currentUser?.id;
            // One run of messages is one person speaking without interruption.
            // The name and the face are drawn once for it — Telegram's rule, and
            // the workspace chat's already: the name opens the run, the face
            // closes it, and the tail on the bubble marks the end. Four «ку» in
            // a row used to cost four avatars and four identical headers.
            // A day break or the unread line ends a run wherever it falls.
            const nextItem = timeline[index + 1];
            const startsRun = Boolean(separator)
              || `comment-${item.id}` === sessionBoundary
              || !continuesRun(previousItem, item);
            const endsRun = !continuesRun(item, nextItem)
              || (nextItem && `${nextItem._type}-${nextItem.id}` === sessionBoundary);
            const authorMember = members.find(candidate => (candidate.id || candidate.uid) === item.authorId);
            const isExternalAuthor = !isMe && !authorMember;
            // Prefer the live profile over `item.authorAvatar`. That field is a
            // snapshot taken when the comment was written: imports (YouTrack)
            // never set it, and for everyone else it goes stale as soon as they
            // change their photo. Only genuinely external authors — who have no
            // profile to read — fall back to what the document carries.
            const authorProfile = (isMe ? currentUser : authorMember) || null;
            const authorUser = authorProfile
              ? { ...authorProfile, name: authorProfile.name || item.authorName }
              : { id: item.authorId, name: item.authorName, avatar: item.authorAvatar };
            return (
              <Fragment key={`comment-${item.id}`}>
              {separator}
              {renderUnreadBoundary(`comment-${item.id}`)}
              <div
                data-comment-id={item.id}
                className={`group grid items-end gap-x-2.5 ${startsRun ? '' : '-mt-3'} ${isMe ? 'grid-cols-[minmax(0,1fr)_28px]' : 'grid-cols-[28px_minmax(0,1fr)]'}`}
              >
                {!endsRun ? null : isExternalAuthor ? (
                  <Popover
                    position="top"
                    hideCloseIcon
                    className="col-start-1 row-start-1 self-end"
                    trigger={(
                      <AvatarButton
                        user={authorUser}
                        size="chat-member"
                        label={`Інформація про зовнішнього автора: ${item.authorName || 'користувач'}`}
                      />
                    )}
                  >
                    <div className="w-[240px]">
                      <p className="text-[13px] font-bold text-ink">Зовнішній автор</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">
                        {item.source === 'youtrack'
                          ? 'Коментар перенесено з YouTrack.'
                          : 'Коментар додано через зовнішню інтеграцію.'}
                      </p>
                      <p className="mt-2 text-[11px] leading-relaxed text-faint">
                        Це не учасник організації, тому профіль та особистий чат недоступні.
                      </p>
                    </div>
                  </Popover>
                ) : (
                  <AvatarButton
                    user={authorUser}
                    size="chat-member"
                    className={`${isMe ? 'col-start-2' : 'col-start-1'} row-start-1 self-end`}
                    onClick={() => router.push(`?member=${item.authorId}`)}
                    label={`Профіль: ${item.authorName || 'учасник'}`}
                  />
                )}
                <div className={`row-start-1 flex max-w-[84%] min-w-0 flex-col ${isMe ? 'col-start-1 items-end justify-self-end' : 'col-start-2 items-start'}`}>
                  {!isMe && startsRun && (
                    <span className="mb-1 ml-1 flex items-center gap-1 text-[11px] font-bold text-ink">
                      {item.authorName}
                      <StatusEmoji member={authorMember} />
                    </span>
                  )}
                  <div className={`max-w-full break-words rounded-[16px] p-3 text-[14px] leading-[22px] transition-shadow duration-300 ${isMe ? 'bg-ink-hover text-white' : 'bg-white text-ink'} ${endsRun ? (isMe ? 'rounded-br-none' : 'rounded-bl-none') : ''} ${highlightedCommentId === item.id ? 'ring-2 ring-ink/30' : ''}`}>
                    <ReplyQuote
                      replyTo={item.replyTo}
                      dark={isMe}
                      onJump={item.replyTo?.id ? () => jumpToComment(item.replyTo.id) : undefined}
                    />
                    {item.text && (
                      <div className="whitespace-pre-wrap">
                        <MentionText
                          text={item.text}
                          members={members}
                          dark={isMe}
                          excludeMemberId={item.authorId}
                          issueMentions={item.issueMentions}
                        />
                      </div>
                    )}
                    <ChatAttachmentList
                      attachments={item.attachments}
                      dark={isMe}
                      onOpen={setViewerAttachment}
                    />
                  </div>
                </div>
                <div
                  // Точна хвилина, коли годинника в рядку немає: вона нікуди не
                  // поділася, просто більше не коштує порожнього місця.
                  title={endsRun || item.editedAt ? undefined : fmtClock(item.createdAt)}
                  className={`row-start-2 mt-1 flex items-center gap-1 ${isMe ? 'col-start-1 justify-self-end flex-row-reverse' : 'col-start-2 justify-self-start'}`}
                >
                    {/* The clock belongs to the run, not to every line of it:
                        four messages a minute apart used to stamp «20:47» four
                        times.

                        Усередині серії його не було видно — але місце він
                        тримав. `opacity-0` ховає напис і лишає коробку, тож під
                        кожним повідомленням серії зяяла дірка рівно завширшки з
                        «16:09», просто перед галочками. Порожнє місце читається
                        як зламана верстка, а не як «тут навмисно нічого немає».
                        Тому всередині серії годинника немає зовсім, а точна
                        хвилина лишається за наведенням на рядок. */}
                    {(endsRun || item.editedAt) && (
                      <span className="px-1 text-[10px] font-medium text-muted">
                        {fmtClock(item.createdAt)}{item.editedAt ? ' · змінено' : ''}
                      </span>
                    )}
                    {/* Read receipt на своїх повідомленнях: ✓ надіслано / ✓✓ прочитано іншими.
                        «Прочитано» alone answers whether, never when, and when is
                        the half a sender is actually asking about — so pointing
                        at the ticks names the hour, and every reader in a task
                        with more than one of them. */}
                    {isMe && (
                      <span
                        className="inline-flex cursor-help items-center"
                        title={readReceiptLabel(commentReaders(item, myReceiptMarks), members)}
                      >
                        {commentReaders(item, myReceiptMarks).length > 0
                          ? <CheckCheck size={13} className="text-muted" aria-label="Прочитано" />
                          : <Check size={13} className="text-muted" aria-label="Надіслано" />}
                      </span>
                    )}
                    {!isArchived && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-lg:opacity-100">
                        <IconAction label="Відповісти" icon={Reply} size="micro" composition="chat-micro-action" appearance="quiet" shape="micro" onClick={() => beginReply(item)} title="Відповісти" />
                        {isMe && canEditOwnComment && <IconAction label="Редагувати повідомлення" icon={Pencil} size="micro" composition="chat-micro-action" appearance="quiet" shape="micro" onClick={() => beginEdit(item)} title="Редагувати" />}
                        {(isMe || canModerateComments) && <IconAction label="Видалити повідомлення" icon={Trash2} size="micro" composition="chat-micro-action" appearance="quiet-danger" shape="micro" onClick={() => handleDelete(item, isMe)} title={isMe ? 'Видалити' : 'Видалити як адміністратор'} />}
                      </div>
                    )}
                </div>
              </div>
              </Fragment>
            );
          }

          if (item._type === 'time') {
            const member = members.find(candidate => (candidate.id || candidate.uid) === item.userId);
            const text = `Зафіксовано ${fmtTime(item.spentMinutes)}${item.description ? ` · ${item.description}` : ''}`;
            const actorName = member?.name || item.userName || item.externalActor?.name || org?.name || 'Система';
            return (
              <Fragment key={`time-${item.id}`}>
                {separator}
                <SystemEventMessage text={text} time={fmtClock(item.loggedAt)} actorName={actorName} actor={member} />
              </Fragment>
            );
          }

          if (item._type === 'audit') {
            const member = members.find(candidate => (candidate.id || candidate.uid) === item.userId);
            const actorName = item.userName || member?.name || org?.name || 'Система';
            return (
              <Fragment key={`audit-${item.id}`}>
                {separator}
                {renderUnreadBoundary(`audit-${item.id}`)}
                <SystemEventMessage
                  text={describeAuditEvent(item, auditContext)}
                  time={fmtClock(item.createdAt)}
                  actorName={actorName}
                  actor={member}
                />
              </Fragment>
            );
          }
          return null;
        })}

        {/* What has been sent and has not come back yet. Always the newest thing
            in the conversation, so it belongs after everything the snapshot
            knows about and before the end of the feed. */}
        {visibleDrafts.map(draft => (
          <PendingMessage
            key={draft.clientId}
            draft={draft}
            members={members}
            onRetry={() => retryPendingMessage(draft)}
            onDiscard={() => discardPendingMessage(draft)}
          />
        ))}

        {/* Somebody is answering right now. The same three dots the workspace
            chat has always had, off the same heartbeat. */}
        {typingNames.length > 0 && (
          <div className="flex items-center gap-2 py-1" aria-live="polite">
            <span className="flex gap-0.5">
              {[0, 1, 2].map(dot => (
                <span
                  key={dot}
                  className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted"
                  style={{ animationDelay: `${dot * 0.15}s` }}
                />
              ))}
            </span>
            <span className="text-[12px] italic text-muted">
              {typingNames.join(', ')} {typingNames.length === 1 ? 'друкує' : 'друкують'}...
            </span>
          </div>
        )}

        {/* The end of the conversation, as something that can be observed.
            Seeing it is what consumes a message that arrived while the reader
            was already here — no unread line is ever crossed for those. */}
        <div ref={feedEndRef} aria-hidden className="-mt-4 h-px shrink-0" />
        </div>
      </div>

      {!isArchived && canWriteComments && (
        <ChatComposerDock ref={wrapperRef} scrollRef={scrollRef} composition="timeline-composer">
          {/* The button and the line are one thing said twice, so they say the
              same number. The button used to count what was *still* unread
              while the line counted what had been unread on arrival, which is
              how «1 нове» could take a reader to a line reading «3». And once
              the line has been read the button has nowhere left to send
              anybody, so it goes. */}
          {jumpTarget && (
            <div className="absolute inset-x-0 -top-10 z-20 flex justify-center">
              <Button
                style="primary"
                size="sm"
                icon={jumpTarget.icon}
                onClick={() => (jumpTarget.to === 'unread' ? scrollToUnread() : scrollToBottom())}
              >
                {jumpTarget.label}
              </Button>
            </div>
          )}
          {issueMention.active && (
            <IssueMentionMenu
              issues={issueResults}
              projects={projects}
              loading={issueSearchLoading}
              onSelect={selectIssueMention}
              className="absolute bottom-full left-3 right-3 z-[60] mb-2"
            />
          )}
          {mentionState.active && filteredMembers.length > 0 && (
            <MentionMenu
              density="timeline"
              members={filteredMembers}
              selectedIndex={mentionState.selectedIndex}
              onSelect={selectMention}
              className="absolute bottom-full left-3 right-3 z-[60] mb-2"
            />
          )}

          {/* The dock's top half is a transparent gradient, so a 5% black tint
              here was not a panel — it was the last message showing through its
              own reply preview, at almost full contrast. Same treatment the chat
              header uses for exactly this problem: a near-opaque canvas over a
              real blur, with a hairline to end it. */}
          {(replyTo || editingComment) && (
            <div data-ui-surface="local" className="mb-2 flex items-start gap-2 rounded-[10px] border border-line/70 bg-canvas/90 px-3 py-2 backdrop-blur-xl">
              <div className="min-w-0 flex-1 border-l-2 border-muted pl-2">
                <div className="text-[11px] font-bold text-ink">{editingComment ? 'Редагування повідомлення' : `Відповідь для ${replyTo.authorName || 'учасника'}`}</div>
                <div className="truncate text-[11px] text-muted">{editingComment?.text || replyTo?.text || 'Вкладення'}</div>
              </div>
              <IconAction label="Скасувати" icon={X} size="micro" composition="chat-composer-cancel" appearance="quiet" shape="micro" onClick={resetComposer} />
            </div>
          )}

          <FileInput accept={ATTACHMENT_UPLOAD_ACCEPT} ref={fileInputRef} multiple onChange={event => { addPendingFiles(event.target.files); event.target.value = ''; }} />
          <ChatComposerCore
            variant="timeline"
            textareaRef={inputRef}
            value={input}
            onChange={event => {
              // No manual resize here: `ChatComposerCore` measures the value, so
              // a message opened for editing arrives at its full height instead
              // of in a two-line box that has to be scrolled.
              setInput(event.target.value);
              noteTyping();
              checkMentions(event.target.value, event.target.selectionStart);
              checkIssueMention(event.target.value, event.target.selectionStart);
            }}
            onClick={event => {
              checkMentions(event.target.value, event.target.selectionStart);
              checkIssueMention(event.target.value, event.target.selectionStart);
            }}
            onKeyDown={event => {
              if (issueMention.active && issueResults.length > 0) {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  selectIssueMention(issueResults[0]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setIssueMention({ active: false, query: '', startIndex: -1, cursorIndex: -1 });
                  return;
                }
              }
              if (mentionState.active && filteredMembers.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const delta = event.key === 'ArrowDown' ? 1 : -1;
                  setMentionState(previous => ({ ...previous, selectedIndex: (previous.selectedIndex + delta + filteredMembers.length) % filteredMembers.length }));
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  selectMention(filteredMembers[mentionState.selectedIndex]);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setMentionState(previous => ({ ...previous, active: false, ignoreIndex: previous.startIndex }));
                  return;
                }
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder={editingComment ? 'Змінити повідомлення...' : 'Написати повідомлення...'}
            attachments={pendingFiles.length > 0 ? (
              <div className="border-b border-black/[0.05] p-2">
                {/* No progress here any more: the upload starts after the
                    composer has already handed the message to the conversation,
                    and that is where the bytes are now reported. */}
                <PendingChatAttachments
                  files={pendingFiles}
                  onRemove={index => setPendingFiles(files => files.filter((_, fileIndex) => fileIndex !== index))}
                />
              </div>
            ) : null}
            leading={!editingComment ? <Button className="self-center" shape="circle" style="ghost" size="icon" composition="chat-composer-action" icon={Paperclip} type="button" onClick={() => fileInputRef.current?.click()} aria-label="Додати файл" title="Додати файл" /> : null}
            onSubmit={handleSend}
            canSubmit={Boolean(input.trim() || pendingFiles.length > 0)}
            sending={sending}
            sendAriaLabel={editingComment ? 'Зберегти зміни' : 'Надіслати'}
          />
        </ChatComposerDock>
      )}
    </div>
  );
}
