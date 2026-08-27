'use client';
// src/app/workspace/chat/page.js — Rebuilt from scratch
import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Smile, Paperclip, Plus, Trash2, X, UserPlus, Search } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import Button from '@/components/ui/Button';
import ChatComposerDock from '@/components/ui/ChatComposerDock';
import ChatComposerCore from '@/components/ui/ChatComposerCore';
import Dialog from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { MultiSelect } from '@/components/ui/Select';
import { useConfirm, ChannelRail, Counter, FileInput, FormGroup, IconAction, IssueMentionMenu, Label, MentionMenu, SidebarLayout, Textarea } from '@/components/ui';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { can } from '@/lib/utils/can';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { useWorkspaceChat } from '@/lib/hooks/useWorkspaceChat';
import { useMobilePaneBack } from '@/lib/hooks/useMobilePaneBack';
import { useOrganization } from '@/lib/hooks/useOrganization';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import ChannelInfoPanel from '@/components/ui/Chat/ChannelInfoPanel';
import ChatConversationHeader from '@/components/ui/Chat/ChatConversationHeader';
import ChatMessageList from '@/components/ui/Chat/ChatMessageList';
import ChatSearchBanner from '@/components/ui/Chat/ChatSearchBanner';
import AttachmentViewer from '@/components/ui/AttachmentViewer';
import { ChatAttachmentList, PendingChatAttachments } from '@/components/ui/Chat/ChatAttachmentList';
import { db } from '@/lib/firebase';
import {
  collection, query, where, onSnapshot, updateDoc, doc, setDoc
} from 'firebase/firestore';
import { uploadFile } from '@/lib/utils/uploadFile';
import dynamic from 'next/dynamic';
import { activeTypingUserIds, channelUnreadCount, directMessageRoomId } from '@/lib/utils/workspaceChat.mjs';
import { extractMentionedUserIds } from '@/lib/utils/mentions';
import { notificationConversationId } from '@/lib/utils/notificationNavigation.mjs';
import { collectIssueMentions } from '@/lib/utils/messageTokens.mjs';
import { formatLastSeenUk } from '@/lib/utils/presence.mjs';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { sendNotification } from '@/lib/hooks/useNotifications';
import { useFloatingOverlay } from '@/lib/hooks/useFloatingOverlay';
import { messageMatchesChatSearch } from '@/lib/utils/chatAttachments.mjs';
import { useSearch } from '@/lib/hooks/useSearch';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import {
  ATTACHMENT_UPLOAD_ACCEPT,
  uploadFilePolicy,
} from '@/lib/utils/uploadPolicy.mjs';

// Loaded when somebody opens it, not when the page does.
//
// emoji-picker-react carries its own emoji data and is the largest dependency
// in the bundle; imported at the top it shipped to everyone who opened a chat,
// and through MessageBubble to everyone who opened a task. It appears behind a
// click on a face, which is exactly what a dynamic import is for — the pattern
// pdfjs-dist and write-excel-file already use here.
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

// ─── Message Input ───────────────────────────────────────────────────────────
function MessageInput({
  onSend,
  onTyping,
  onError,
  placeholder = 'Написати повідомлення...',
  members = [],
  projects = [],
}) {
  const { activeOrgId } = useAppContext();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionType, setMentionType] = useState(null);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionCursor, setMentionCursor] = useState(0);
  const [mentionStart, setMentionStart] = useState(-1);
  const textareaRef = useRef(null);
  const fileRef = useRef(null);
  const emojiRef = useRef(null);
  const emojiBtnRef = useRef(null);
  const emojiPosition = useFloatingOverlay({
    open: showEmoji,
    anchorRef: emojiBtnRef,
    overlayRef: emojiRef,
    preferredPlacement: 'top',
    align: 'start',
  });
  const sendingRef = useRef(false);
  // What the picker already knew. The list the author chose from carried the
  // task's name; writing it into the message is why the capsule never has to
  // ask the server what that task is called again.
  const resolvedIssues = useRef(new Map());
  const {
    results: issueResults,
    loading: issueSearchLoading,
    search: searchIssues,
    clear: clearIssueSearch,
  } = useSearch();

  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target) && emojiBtnRef.current && !emojiBtnRef.current.contains(e.target)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  useEffect(() => {
    const queryText = mentionQuery.trim();
    if (mentionType !== 'issue' || queryText.length < 1 || !activeOrgId) {
      clearIssueSearch();
      return;
    }
    searchIssues(queryText, activeOrgId, null, { mention: true });
  }, [activeOrgId, clearIssueSearch, mentionQuery, mentionType, searchIssues]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    // The field's height is `ChatComposerCore`'s job now: it measures the value
    // rather than the keystroke, which is the only way text that arrives without
    // one — an edit opened, a mention inserted, a draft restored — can size it.
    // Mention detection
    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);
    const matchIssue = before.match(/(?:^|[\s([{])#([\p{L}\p{N}-]*)$/u);
    const matchUser = before.match(/(?:^|[\s([{])([@])([^@\n"]*)$/u);
    if (matchIssue) {
      setMentionType('issue');
      setMentionQuery(matchIssue[1].toLocaleLowerCase('uk-UA'));
      setMentionCursor(cursor);
      setMentionStart(cursor - matchIssue[1].length - 1);
    } else if (matchUser) {
      setMentionType('user');
      setMentionQuery(matchUser[2].toLowerCase());
      setMentionCursor(cursor);
      setMentionStart(cursor - matchUser[2].length - 1);
    } else {
      setMentionType(null);
      setMentionQuery('');
      setMentionStart(-1);
    }
    // Notify parent about typing
    if (onTyping) onTyping();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && mentionType === 'issue' && issueResults.length > 0) {
      e.preventDefault();
      insertIssue(issueResults[0]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && mentionType === 'user' && filteredMembers.length > 0) {
      e.preventDefault();
      insertMention(filteredMembers[0]);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      setMentionType(null);
      setShowEmoji(false);
    }
  };

  const handleSend = async () => {
    if ((!text.trim() && attachments.length === 0) || sendingRef.current) return;
    sendingRef.current = true;
    setUploading(true);
    let uploaded = [];
    if (attachments.length > 0) {
      try {
        // Organization-scoped so ownership stays provable when the file is
        // later released by /api/upload/delete.
        uploaded = await Promise.all(attachments.map((file, index) =>
          uploadFile(file, `organizations/${activeOrgId}/chat`, percent => {
            setUploadProgress(previous => ({ ...previous, [index]: percent }));
          })));
      } catch (e) {
        console.error('Upload error', e);
        // The uploader now says what the storage refused and why; repeating
        // «Не вдалося завантажити вкладення» over it threw that away.
        onError?.(e?.message || 'Не вдалося завантажити вкладення');
        setUploadProgress({});
        setUploading(false);
        sendingRef.current = false;
        return;
      }
    }
    try {
      await onSend(text, uploaded, collectIssueMentions(text, resolvedIssues.current));
      setText('');
      setAttachments([]);
      setUploadProgress({});
      setMentionType(null);
    } catch (error) {
      console.error('[workspace-chat] Send failed:', error);
      onError?.('Не вдалося надіслати повідомлення');
    } finally {
      setUploading(false);
      sendingRef.current = false;
    }
  };

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const roomLeft = Math.max(0, 5 - attachments.length);
    // The refusal is the file's own, in its own words. One flat sentence about
    // «20 МБ» was the wrong number as well as the wrong reason: an unsupported
    // type and a file over the limit read identically, and neither was true of
    // the file the reader had actually picked.
    const rejected = files.map(file => ({ file, ...uploadFilePolicy(file) })).filter(entry => entry.error);
    const accepted = files.filter(file => !uploadFilePolicy(file).error).slice(0, roomLeft);
    if (rejected.length > 0) {
      onError?.(`${rejected[0].file.name}: ${rejected[0].error}`);
    } else if (accepted.length !== files.length) {
      onError?.('До 5 файлів на повідомлення');
    }
    setAttachments(previous => [...previous, ...accepted]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const insertMention = (member) => {
    const name = member.name || member.email;
    const before = text.slice(0, mentionStart);
    const after = text.slice(mentionCursor);
    const newText = `${before}@${name} ${after}`;
    setText(newText);
    setMentionType(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const insertIssue = issue => {
    if (!issue?.issueKey) return;
    resolvedIssues.current.set(
      String(issue.issueKey).toLocaleUpperCase('uk-UA'),
      { id: issue.id, title: issue.title || '' },
    );
    const before = text.slice(0, mentionStart);
    const after = text.slice(mentionCursor);
    setText(`${before}#${issue.issueKey} ${after}`);
    setMentionType(null);
    clearIssueSearch();
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // You can only summon someone who can still read the channel. Their name
  // keeps rendering on every message they already wrote — `members` holds the
  // whole directory for exactly that reason.
  const filteredMembers = mentionType === 'user'
    ? activeMembers(members).filter(m => `${m.name || m.displayName || ''} ${m.email || ''}`.toLowerCase().includes(mentionQuery.trim()))
    : [];

  const canSend = (text.trim() || attachments.length > 0) && !uploading;

  return (
    <div className="relative px-4 pb-4 max-md:px-2 max-md:pb-2">
      {/* Mention dropdown */}
      {mentionType === 'user' && (
        <MentionMenu
          density="composer"
          members={filteredMembers}
          onSelect={insertMention}
          className="absolute bottom-full left-4 right-4 mb-2 z-30 max-md:left-2 max-md:right-2"
        />
      )}
      {mentionType === 'issue' && mentionQuery.trim().length >= 1 && (
        <IssueMentionMenu
          issues={issueResults}
          projects={projects}
          loading={issueSearchLoading}
          onSelect={insertIssue}
          className="absolute bottom-full left-4 right-4 z-30 mb-2 max-md:left-2 max-md:right-2"
        />
      )}

      {/* Emoji picker */}
      {showEmoji && typeof document !== 'undefined' && createPortal(
        <div
          ref={emojiRef}
          className="fixed z-[1000] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl shadow-2xl"
          style={{
            top: emojiPosition.top,
            left: emojiPosition.left,
            visibility: emojiPosition.ready ? 'visible' : 'hidden',
          }}
        >
          <EmojiPicker
            onEmojiClick={(d) => { setText(prev => prev + d.emoji); setShowEmoji(false); textareaRef.current?.focus(); }}
            autoFocusSearch={false}
            skinTonesDisabled
            width={320}
            height={380}
            emojiStyle="native"
          />
        </div>,
        document.body,
      )}

      <ChatComposerCore
        variant="workspace"
        textareaRef={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={placeholder}
        attachments={attachments.length > 0 ? (
          <div className="border-b border-black/[0.05] p-2">
            <PendingChatAttachments
              files={attachments}
              progress={uploadProgress}
              onRemove={index => setAttachments(previous => previous.filter((_, itemIndex) => itemIndex !== index))}
            />
          </div>
        ) : null}
        toolbar={(
          <>
            <IconAction
              buttonRef={emojiBtnRef}
              onClick={() => setShowEmoji(v => !v)}
              icon={Smile}
              label="Emoji"
              appearance={showEmoji ? 'soft' : 'quiet'}
              composition="chat-composer-action"
            />
            <FileInput accept={ATTACHMENT_UPLOAD_ACCEPT} multiple ref={fileRef} onChange={handleFiles} />
            <IconAction
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              icon={Paperclip}
              label="Прикріпити файл"
              composition="chat-composer-action"
            />
          </>
        )}
        onSubmit={handleSend}
        canSubmit={Boolean(canSend)}
        sending={uploading}
      />
    </div>
  );
}

// ─── Thread Sidebar ──────────────────────────────────────────────────────────
function ThreadSidebar({
  parentMsg,
  replies,
  myUid,
  members,
  projects,
  onSend,
  onDeleteReply,
  onOpenAttachment,
  onError,
  onClose,
  loading,
  canModerate = false,
}) {
  const scrollRef = useRef(null);
  const confirmDialog = useConfirm();

  // Before the paint, like the main conversation: a thread opens showing its
  // latest reply rather than scrolling to it.
  useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [replies.length]);

  if (!parentMsg) return null;

  return (
    // A pane that fills the screen is `position: fixed`, and a fixed box is laid
    // out against the layout viewport — which the keyboard covers rather than
    // shortens. The app shell subtracts the overlap from its own height and this
    // pane is not inside that box, so it subtracts it too; otherwise its
    // composer sits under the keys with nothing able to scroll to it.
    <div data-ui-overlay="responsive-pane" className="fixed inset-0 z-50 max-md:bottom-[var(--qt-keyboard-inset,0px)] md:static md:z-auto md:w-[360px] md:rounded-[16px] shrink-0 bg-canvas flex flex-col overflow-hidden">
      {/* Header. `md:rounded-t-*` is the same repair `ChatConversationHeader`
          carries and for the same reason: Chromium does not apply an ancestor's
          rounded clip to a descendant that paints a `backdrop-filter`, so this
          bar filled the pane's top corners square while the rest of it rounded.
          Only at md+ — below that the pane is the whole screen. */}
      <div data-ui-surface="local" className="relative z-10 flex h-[56px] shrink-0 items-center justify-between border-b border-line/70 bg-canvas/90 px-5 backdrop-blur-xl md:rounded-t-[var(--ui-radius-surface)]">
        <div className="flex items-center gap-2">
          <ChatIcon size={16} className="text-muted" />
          <h3 className="ui-type-card-title text-ink">Гілка</h3>
          {replies.length > 0 && (
            <Counter value={replies.length} size="sm" appearance="subtle" />
          )}
        </div>
        <IconAction
          onClick={onClose}
          icon={X}
          label="Закрити гілку"
          appearance="quiet"
              composition="chat-panel-action"
            />
      </div>

      {/* Parent message */}
      <div className="px-5 py-4 border-b border-line/70 bg-white/40">
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-xl overflow-hidden shrink-0">
            <UserAvatar user={{ name: parentMsg.user, avatar: parentMsg.avatar }} size="md" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="font-semibold text-[13px] text-ink">{parentMsg.user}</span>
              <span className="text-[10px] text-muted">{parentMsg.time}</span>
            </div>
            <p className="text-[13px] text-ink leading-relaxed line-clamp-4">{parentMsg.text}</p>
          </div>
        </div>
      </div>

      {/* Replies */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-5 pb-12 pt-4 flex flex-col gap-0.5">
        {replies.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ChatIcon size={32} className="text-faint mb-3" />
            <p className="text-[13px] text-muted font-medium">Ще немає відповідей</p>
            <p className="text-[12px] text-faint mt-1">Будь першим!</p>
          </div>
        )}
        {replies.map((reply, i) => {
          const prevReply = i > 0 ? replies[i - 1] : null;
          const showHead = !prevReply || prevReply.senderId !== reply.senderId
            || ((reply.createdAt?.toMillis?.() ?? 0) - (prevReply.createdAt?.toMillis?.() ?? 0) > 300000);

          return (
            <div key={reply.id} className={`relative flex gap-2.5 group px-2 py-1 rounded-xl hover:bg-black/[0.03] transition-colors ${showHead ? 'mt-3' : 'mt-0.5'}`}>
              <div className="w-8 shrink-0 flex justify-end items-start pt-0.5">
                {showHead ? (
                  <div className="w-8 h-8 rounded-xl overflow-hidden">
                    <UserAvatar user={{ name: reply.user, avatar: members?.find(m => (m.id || m.uid) === reply.senderId)?.avatar || reply.avatar }} size="md" />
                  </div>
                ) : (
                  <span className="text-[10px] text-muted opacity-0 group-hover:opacity-100 pt-1 transition-opacity">{reply.time}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {showHead && (
                  <div className="flex items-baseline gap-2 mb-0.5">
                    <span className="font-semibold text-[13px] text-ink flex items-center gap-1">
                      {reply.user}
                      {members?.find(m => (m.id || m.uid) === reply.senderId)?.statusEmoji && <span>{members.find(m => (m.id || m.uid) === reply.senderId).statusEmoji}</span>}
                    </span>
                    <span className="text-[10px] text-muted">{reply.time}</span>
                  </div>
                )}
                <p className="text-[13px] text-ink leading-relaxed">{reply.text}</p>
                <ChatAttachmentList
                  attachments={reply.attachments}
                  onOpen={onOpenAttachment}
                />
              </div>
              {(reply.senderId === myUid || canModerate) && (
                <IconAction
                  onClick={async () => {
                    const mine = reply.senderId === myUid;
                    const confirmed = await confirmDialog({
                      title: mine ? 'Видалити відповідь?' : 'Видалити відповідь учасника?',
                      message: mine ? undefined : 'Її не побачить ніхто в гілці. Скасувати не вийде.',
                      confirmText: 'Видалити',
                      danger: true,
                    });
                    if (confirmed) onDeleteReply(reply.id);
                  }}
                  icon={Trash2}
                  label="Видалити відповідь"
                  title={reply.senderId === myUid ? 'Видалити' : 'Видалити як адміністратор'}
                  size="xs"
                  shape="compact"
                  appearance="quiet-danger"
                  composition="chat-micro-action"
                  className="opacity-0 group-hover:opacity-100 shrink-0"
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Thread Input */}
      <ChatComposerDock scrollRef={scrollRef}>
        <MessageInput
          onSend={onSend}
          onError={onError}
          placeholder="Відповісти в гілку..."
          members={members}
          projects={projects}
        />
      </ChatComposerDock>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function ChatPage() {
  const { currentUser, projects, activeOrgId } = useAppContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { members } = useOrganization();
  const { positions = [] } = useWorkflowConfig();
  const showToast = useWorkspaceStore(s => s.showToast);
  const chatSearch = useWorkspaceStore(s => s.chatSearch);
  const setChatSearch = useWorkspaceStore(s => s.setChatSearch);
  const setChatOnlineUsers = useWorkspaceStore(s => s.setChatOnlineUsers);
  const notifications = useWorkspaceStore(s => s.notifications);
  const markNotificationRead = useWorkspaceStore(s => s.notificationActions?.markRead);
  const setVisibleConversation = useWorkspaceStore(s => s.setVisibleConversation);
  const clearVisibleConversation = useWorkspaceStore(s => s.clearVisibleConversation);

  const [activeChannel, setActiveChannel] = useState({ id: 'general', type: 'channel' });
  // Mobile single-pane mode: 'list' (channels) або 'chat' (розмова); md+ показує обидві панелі
  const [mobilePane, setMobilePane] = useState('list');
  // Re-opening the conversation that is already open must write nothing. The
  // object literal a caller passes is new every time, so an unconditional
  // `setActiveChannel` always re-renders — and this is called from an effect
  // that reads the URL, which is a render loop with no exit as soon as the URL
  // carries a conversation. Opening a member's profile from a direct message
  // does exactly that.
  const openChannel = (ch) => {
    setActiveChannel(current => (
      current.id === ch.id && current.type === ch.type ? current : ch
    ));
    setMobilePane('chat');
  };
  // Системний «назад» на телефоні повертає до списку чатів, а не виходить зі сторінки
  const requestPaneClose = useMobilePaneBack(mobilePane === 'chat', () => setMobilePane('list'));
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelNameError, setNewChannelNameError] = useState('');
  const [newChannelDescription, setNewChannelDescription] = useState('');
  const [newChannelMemberIds, setNewChannelMemberIds] = useState([]);
  const [isSubmittingChannel, setIsSubmittingChannel] = useState(false);
  const [presenceMap, setPresenceMap] = useState({});
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [unreadBadge, setUnreadBadge] = useState(0);
  const [lastMsgCount, setLastMsgCount] = useState(0);
  const [showChannelInfo, setShowChannelInfo] = useState(false);
  const [channelInfoTab, setChannelInfoTab] = useState('info');
  const [viewerAttachment, setViewerAttachment] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [typingNow, setTypingNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const myUid = currentUser?.uid || currentUser?.id;
  const myMemberInfo = members.find(m => (m.id || m.uid) === myUid);
  const myRole = myMemberInfo?.role || 'member';
  // Through the matrix: `manage:channels` is what creating and deleting a
  // channel needs, and `moderate:content` is what removing somebody else's
  // message needs. They happen to hold for the same roles today, and writing
  // them as one role comparison is how that stops being visible.
  const isAdminOrOwner = can(myRole, 'manage:channels');
  // Moderation reaches group channels only. A direct room is not readable by an
  // administrator — the rules say so — and so must not be deletable either.
  const canModerateRoom = can(myRole, 'moderate:content') && activeChannel.type === 'channel';

  const getRoomId = useCallback(() => {
    if (activeChannel.type === 'channel') return activeChannel.id;
    return directMessageRoomId(myUid, activeChannel.id) || 'general';
  }, [activeChannel, myUid]);

  const {
    channels, dmChannels, messages, loading, activeChannelData,
    activeThreadId, threadMessages, activeDMs, readState,
    hasMoreMessages, loadOlderMessages,
    sendMessage, deleteMessage, editMessage, toggleReaction,
    createChannel, setTyping, openThread, closeThread,
    sendThreadMessage, markThreadRead, markAsRead, deleteReply
  } = useWorkspaceChat(getRoomId(), activeChannel.type, activeChannel.type === 'dm' ? activeChannel.id : null);

  const messagesEndRef = useRef(null);
  const chatScrollRef = useRef(null);
  const chatContentRef = useRef(null);
  const composerRef = useRef(null);
  const messageRefs = useRef(new Map());
  const typingRef = useRef(null);
  const lastTailIdRef = useRef(null);
  const pendingHistoryHeightRef = useRef(null);
  // Whether this conversation has already been placed at its latest message.
  // Until it has, the list must not animate anywhere: it should simply be
  // rendered at the bottom, the way every messenger opens a chat.
  const initialScrollDoneRef = useRef(false);
  // Until when the two corrections that keep this conversation pinned to its
  // newest message must stand down, because the reader asked to be somewhere
  // else — a pinned message, a search hit, a file in «Матеріали».
  //
  // Both of them used to win. Jumping closes the side panel, the conversation
  // re-flows into the freed width, the resize observer fires and sends the
  // scroller back to the bottom while the jump is still animating — so from the
  // bottom of a channel, clicking a pinned message did nothing at all. Scrolling
  // up first "fixed" it only because `isScrolledUp` is the observer's own
  // stand-down flag, which is exactly the symptom that was reported.
  const holdScrollUntilRef = useRef(0);
  const isHoldingScroll = () => Date.now() < holdScrollUntilRef.current;
  // Notification links open the exact conversation instead of dropping the
  // user on #general.
  useEffect(() => {
    const dmUserId = searchParams.get('dm');
    const channelId = searchParams.get('channel');
    const threadId = searchParams.get('thread');
    if (dmUserId && dmUserId !== myUid) {
      queueMicrotask(() => openChannel({ id: dmUserId, type: 'dm' }));
    } else if (channelId) {
      queueMicrotask(() => openChannel({ id: channelId, type: 'channel' }));
    }
    // «Відповів у гілці» has to land in that thread. Opening the channel and
    // leaving the reader to find the message the reply belongs to is the same
    // as not telling them.
    if (threadId) queueMicrotask(() => openThread(threadId));
  }, [myUid, openThread, searchParams]);

  // Presence
  useEffect(() => {
    if (!activeOrgId) return;
    const q = query(collection(db, 'organizations', activeOrgId, 'presence'));
    const unsub = onSnapshot(q, snap => {
      const map = {};
      snap.forEach(d => {
        const presence = d.data();
        const lastSeen = presence.lastSeen?.toMillis?.() ?? 0;
        // Fresh lastSeen is authoritative. A boolean written by another tab
        // can become stale when one tab closes while another remains open.
        map[d.id] = lastSeen;
      });
      setPresenceMap(map);
    }, err => {
      reportLoadError('[ChatPage] presence', err);
    });
    return () => unsub();
  }, [activeOrgId]);

  // Scroll handling
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const handler = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setIsScrolledUp(!atBottom);
      if (atBottom) setUnreadBadge(0);
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, []);

  // Auto-scroll to bottom on new messages.
  //
  // `useLayoutEffect`, not `useEffect`: this runs before the browser paints, so
  // the first frame of a conversation is already at its newest message. It used
  // to run after the paint and then animate — you saw the top of the history for
  // a moment and watched the list scroll itself down, which is not how a
  // messenger opens a chat.
  //
  // Growing the history window prepends older messages: that is neither new
  // activity (no unread badge) nor a reason to jump — the previous reading
  // position is restored by compensating for the added height.
  useLayoutEffect(() => {
    const count = messages.length;
    const tailId = messages[count - 1]?.id ?? null;
    const previousTailId = lastTailIdRef.current;
    const hasNewTail = tailId !== null && tailId !== previousTailId;
    lastTailIdRef.current = tailId;

    const scrollElement = chatScrollRef.current;
    const heightBeforeRender = pendingHistoryHeightRef.current;
    if (heightBeforeRender !== null) {
      pendingHistoryHeightRef.current = null;
      if (scrollElement) {
        scrollElement.scrollTop += scrollElement.scrollHeight - heightBeforeRender;
      }
      queueMicrotask(() => setLastMsgCount(count));
      return;
    }

    // Landing in a conversation is a placement, not a movement. Smooth is only
    // ever right for a message that arrives while you are already reading the
    // bottom of one you have been sitting in.
    const isInitialPlacement = !initialScrollDoneRef.current;
    if (!isScrolledUp && !isHoldingScroll()) {
      if (scrollElement && count > 0) {
        scrollElement.scrollTo({
          top: scrollElement.scrollHeight,
          behavior: isInitialPlacement || count <= 1 ? 'instant' : 'smooth',
        });
        initialScrollDoneRef.current = true;
      }
    } else if (hasNewTail && previousTailId !== null && count > lastMsgCount && lastMsgCount > 0) {
      queueMicrotask(() => setUnreadBadge(v => v + (count - lastMsgCount)));
    }
    queueMicrotask(() => setLastMsgCount(count));
  }, [messages]); // eslint-disable-line

  const handleLoadOlderMessages = () => {
    pendingHistoryHeightRef.current = chatScrollRef.current?.scrollHeight ?? null;
    loadOlderMessages();
  };

  // Keep the last message visible when the conversation's own height changes
  // under it: a growing composer, an attachment preview, and — the one that
  // used to leave you a few hundred pixels short — images inside the messages
  // finishing their decode after the list was already placed. While you are
  // reading the bottom, the bottom is where you stay.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (isScrolledUp || isHoldingScroll()) return;
      requestAnimationFrame(() => {
        if (isHoldingScroll()) return;
        const scrollElement = chatScrollRef.current;
        scrollElement?.scrollTo({ top: scrollElement.scrollHeight, behavior: 'instant' });
      });
    });
    if (composerRef.current) observer.observe(composerRef.current);
    // The scroller itself has a fixed box, so observing it reports nothing; the
    // messages inside it are what grow.
    if (chatContentRef.current) observer.observe(chatContentRef.current);
    return () => observer.disconnect();
  }, [isScrolledUp, messages.length]);

  // Mark as read when switching channel, and hand the new conversation back to
  // the layout effect above to place.
  //
  // There used to be a `setTimeout(…, 100)` here that called `scrollIntoView`
  // as well — a second correction racing the first, a tenth of a second after
  // the paint. Between the two, opening a channel showed the history moving.
  // Clearing the flag is enough: the next render places the list at the bottom
  // before it is ever painted.
  useEffect(() => {
    markAsRead(getRoomId());
    lastTailIdRef.current = null;
    pendingHistoryHeightRef.current = null;
    initialScrollDoneRef.current = false;
    queueMicrotask(() => {
      setIsScrolledUp(false);
      setUnreadBadge(0);
      setLastMsgCount(0);
    });
  }, [activeChannel.id, activeChannel.type]); // eslint-disable-line

  // Messages received while the conversation is already open are read
  // immediately; they must not reappear as a phantom sidebar badge.
  useEffect(() => {
    if (!messages.length || document.visibilityState !== 'visible') return;
    markAsRead(getRoomId());
  }, [messages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // A notification exists to bring somebody to a conversation. Standing in that
  // conversation, the record has already done its whole job — so it is marked
  // read rather than left in the bell as a badge for something on screen. The
  // task chat does the same thing for a task.
  //
  // This used to reach direct messages only, because a `chat_message` record
  // named its conversation nowhere but inside its link: a channel's records went
  // on counting while their channel was open. They carry `channelId` now, and
  // `notificationConversationId` reads the link for the ones written before it.
  useEffect(() => {
    if (!activeChannel.id || document.visibilityState !== 'visible' || !markNotificationRead) return;
    const unreadForConversation = notifications.filter(notification => (
      !notification.read
      && notification.organizationId === activeOrgId
      && (notification.type === 'chat_message' || notification.type === 'mentioned')
      && (
        notificationConversationId(notification) === activeChannel.id
        // A direct message from before the field existed, whose link named the
        // sender and whose sender is exactly what this pane calls the room.
        // `!issueId` for the same reason the presence rule has it: a task chat
        // also writes `chat_message` records, and they belong to the task.
        || (activeChannel.type === 'dm' && notification.type === 'chat_message' && !notification.issueId && notification.actorId === activeChannel.id)
      )
    ));
    if (unreadForConversation.length === 0) return;
    Promise.allSettled(unreadForConversation.map(notification => markNotificationRead(notification.id)));
  }, [activeChannel.id, activeChannel.type, activeOrgId, markNotificationRead, notifications]);

  // The open conversation, published for the live notification popup: the same
  // rule the read-marking above already follows, said once more where the popup
  // can hear it. A card announcing the message you are watching arrive is noise,
  // and it lands on top of the conversation it describes.
  useEffect(() => {
    if (!activeChannel.id) return undefined;
    const conversation = { kind: activeChannel.type === 'dm' ? 'dm' : 'channel', id: activeChannel.id };
    setVisibleConversation(conversation);
    return () => clearVisibleConversation(conversation);
  }, [activeChannel.id, activeChannel.type, clearVisibleConversation, setVisibleConversation]);

  // DMs list
  const unreadDMNotifications = useMemo(() => {
    const counts = new Map();
    notifications.forEach(notification => {
      if (
        notification.type !== 'chat_message'
        || notification.read
        || notification.organizationId !== activeOrgId
        || !notification.actorId
        // A reply inside a task is a `chat_message` from that person too, and it
        // belongs to the task, not to a direct conversation with them.
        || notification.issueId
      ) return;
      counts.set(notification.actorId, (counts.get(notification.actorId) || 0) + 1);
    });
    return counts;
  }, [activeOrgId, notifications]);

  // Chat presence is the live organization-scoped source. Membership profiles
  // are fetched separately and their `lastActive` snapshot can remain stale for
  // the whole session, which used to make even the signed-in user look offline
  // inside a mention hover card.
  const membersWithPresence = useMemo(() => members.map(member => {
    const id = member.id || member.uid;
    const hasPresence = Object.prototype.hasOwnProperty.call(presenceMap, id);
    const lastActive = id === myUid
      ? now
      : (hasPresence ? presenceMap[id] : member.lastActive);
    const positionName = positions.find(position => position.id === member.positionId)?.label;

    return {
      ...member,
      lastActive,
      online: id === myUid || Boolean(
        lastActive && now - new Date(lastActive).getTime() < 2 * 60 * 1000
      ),
      ...(positionName ? { positionName } : {}),
    };
  }), [members, myUid, now, positions, presenceMap]);

  const dms = useMemo(() => {
    const activeDMSet = new Set(activeDMs);
    if (activeChannel.type === 'dm') activeDMSet.add(activeChannel.id);
    return membersWithPresence
    .filter(m => (m.uid || m.id) !== myUid)
    .map(m => {
      const id = m.uid || m.id;
      return {
        id,
        name: m.name || m.email,
        online: m.online,
        lastActive: m.lastActive,
        avatar: m.avatar,
        isActive: activeDMSet.has(id),
        statusEmoji: m.statusEmoji,
        statusText: m.statusText,
        unreadCount: Math.max(
          unreadDMNotifications.get(id) || 0,
          channelUnreadCount(
            dmChannels.find(channel => channel.id === directMessageRoomId(myUid, id)),
            readState[directMessageRoomId(myUid, id)],
            myUid,
          ),
        ),
      };
    })
    .sort((a, b) => {
      if (a.online !== b.online) return b.online ? 1 : -1;
      if (a.isActive !== b.isActive) return b.isActive ? 1 : -1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [activeDMs, activeChannel.id, activeChannel.type, dmChannels, membersWithPresence, myUid, readState, unreadDMNotifications]);

  const isActive = (id) => activeChannel.id === id;
  const activeThreadParent = activeThreadId ? messages.find(m => m.id === activeThreadId) : null;
  const currentChannel = channels.find(c => c.id === activeChannel.id);
  const mentionMembers = useMemo(() => {
    if (activeChannel.type === 'dm') {
      return membersWithPresence.filter(member => (member.id || member.uid) === activeChannel.id);
    }
    if (currentChannel?.members?.length) {
      return membersWithPresence.filter(member => currentChannel.members.includes(member.id || member.uid));
    }
    return membersWithPresence;
  }, [activeChannel.id, activeChannel.type, currentChannel, membersWithPresence]);

  // Sync online users to global header
  const onlineUsersForHeader = useMemo(() => dms
      .filter(u => u.online)
      .map(u => ({
        id: u.id,
        name: u.name,
        avatar: u.avatar,
        statusText: u.statusText,
        statusEmoji: u.statusEmoji,
      })), [dms]);
  useEffect(() => {
    setChatOnlineUsers(onlineUsersForHeader);
  }, [onlineUsersForHeader, setChatOnlineUsers]);

  const handlePin = async (msgId, pin) => {
    if (!activeOrgId || !getRoomId()) return;
    try {
      await updateDoc(doc(db, 'organizations', activeOrgId, 'channels', getRoomId(), 'messages', msgId), {
        isPinned: pin
      });
      showToast(pin ? 'Повідомлення закріплено' : 'Знято з закріплення');
    } catch (e) {
      console.error(e);
      showToast('Не вдалося змінити закріплення', 'error');
    }
  };

  const handleReaction = async (msgId, emoji, hasReacted) => {
    try {
      await toggleReaction(msgId, emoji, hasReacted);
    } catch {
      showToast('Не вдалося змінити реакцію', 'error');
    }
  };

  const handleEditMessage = async (msgId, text) => {
    try {
      await editMessage(msgId, text);
    } catch {
      showToast('Не вдалося відредагувати повідомлення', 'error');
    }
  };

  const handleDeleteMessage = async (msgId) => {
    try {
      await deleteMessage(msgId);
    } catch {
      showToast('Не вдалося видалити повідомлення', 'error');
    }
  };

  const handleDeleteReply = async (replyId) => {
    try {
      await deleteReply(activeThreadId, replyId);
    } catch {
      showToast('Не вдалося видалити відповідь', 'error');
    }
  };

  const resetChannelDraft = () => {
    setNewChannelName('');
    setNewChannelNameError('');
    setNewChannelDescription('');
    setNewChannelMemberIds([]);
  };

  const closeCreateChannelDialog = () => {
    if (isSubmittingChannel) return;
    setIsCreatingChannel(false);
    resetChannelDraft();
  };

  const handleCreateChannel = async (event) => {
    event.preventDefault();
    if (isSubmittingChannel) return;
    if (!newChannelName.trim()) {
      setNewChannelNameError('Вкажіть назву каналу');
      return;
    }
    setNewChannelNameError('');

    setIsSubmittingChannel(true);
    try {
      const id = await createChannel(newChannelName.trim(), {
        description: newChannelDescription.trim(),
        members: [myUid, ...newChannelMemberIds].filter(Boolean),
      });
      setIsCreatingChannel(false);
      resetChannelDraft();
      openChannel({ id, type: 'channel' });
      showToast('Канал створено');
    } catch (channelError) {
      // createChannel now reports *why* it refused (duplicate name, unusable
      // slug, denied write) instead of silently returning null.
      showToast(channelError.message || 'Помилка при створенні каналу', 'error');
    } finally {
      setIsSubmittingChannel(false);
    }
  };

  const channelMemberOptions = useMemo(() => members
    .filter(member => (member.id || member.uid) !== myUid)
    .map(member => ({
      value: member.id || member.uid,
      label: member.name || member.displayName || member.email || 'Учасник',
      user: member,
    })), [members, myUid]);

  const handleSendMessage = async (text, attachments, issueMentions) => {
    clearTimeout(typingRef.current);
    setTyping(false);
    try {
      await sendMessage(text, attachments, issueMentions);
      if (activeChannel.type === 'channel') {
        const mentionedUserIds = extractMentionedUserIds(text, mentionMembers, myUid);
        if (mentionedUserIds.length) {
          void sendNotification({
              userIds: mentionedUserIds,
              type: 'mentioned',
              title: `${currentUser?.name || 'Колега'} згадав вас у чаті`,
              body: text.trim().slice(0, 500),
              link: `/chat?channel=${encodeURIComponent(activeChannel.id)}`,
              channelId: activeChannel.id,
              organizationId: activeOrgId,
              dedupeKey: `channel_mention_${activeChannel.id}_${Date.now()}`,
            }).catch(notificationError => {
            console.error('[workspace-chat] Mention notification failed:', notificationError);
            showToast('Повідомлення надіслано, але сповіщення про згадку не доставлено', 'error');
            });
        }
      }
    } catch (error) {
      showToast(
        error?.code === 'permission-denied'
          ? 'Немає дозволу на надсилання в цей чат'
          : 'Не вдалося надіслати повідомлення',
        'error',
      );
      throw error;
    }
  };

  // A reply in a thread used to be invisible from outside it: nothing was
  // notified, nothing on the message said it had happened, and the reader had
  // to already be looking at that thread to know. Somebody answering a question
  // you asked three messages ago simply never reached you.
  //
  // Everyone the thread already belongs to is told: whoever wrote the message,
  // and whoever has answered it before. That list is read off the replies this
  // pane already has open, so telling them costs nothing at all.
  const handleSendThread = async (text, attachments, issueMentions) => {
    await sendThreadMessage(text, attachments, issueMentions);
    const parent = activeThreadParent;
    if (!parent) return;
    const followers = [...new Set([
      parent.senderId,
      ...threadMessages.map(reply => reply.senderId),
    ])].filter(userId => userId && userId !== myUid);
    const mentioned = extractMentionedUserIds(text, mentionMembers, myUid);
    const link = `/chat?${activeChannel.type === 'dm'
      ? `dm=${encodeURIComponent(activeChannel.id)}`
      : `channel=${encodeURIComponent(activeChannel.id)}`}&thread=${encodeURIComponent(activeThreadId)}`;

    // A mention is a stronger thing than a reply, so somebody named in a reply
    // hears about the mention and not twice about the same message.
    const replyOnly = followers.filter(userId => !mentioned.includes(userId));
    const announce = [
      replyOnly.length && {
        userIds: replyOnly,
        type: 'chat_message',
        title: `${currentUser?.name || 'Колега'} відповів у гілці`,
        body: text.trim().slice(0, 500) || 'Надіслано вкладення',
        dedupeKey: `thread_reply_${activeThreadId}_${Date.now()}`,
      },
      mentioned.length && {
        userIds: mentioned,
        type: 'mentioned',
        title: `${currentUser?.name || 'Колега'} згадав вас у гілці`,
        body: text.trim().slice(0, 500),
        dedupeKey: `thread_mention_${activeThreadId}_${Date.now()}`,
      },
    ].filter(Boolean);

    for (const notification of announce) {
      void sendNotification({ ...notification, link, channelId: activeChannel.id, organizationId: activeOrgId })
        .catch(notificationError => {
          console.error('[workspace-chat] Thread notification failed:', notificationError);
        });
    }
  };

  const handleMainTyping = () => {
    setTyping(true);
    clearTimeout(typingRef.current);
    typingRef.current = setTimeout(() => setTyping(false), 2000);
  };

  // Display messages (filtered by search)
  const displayMessages = chatSearch.trim()
    ? messages.filter(message => messageMatchesChatSearch(message, chatSearch))
    : messages;
  const normalizedChatSearch = chatSearch.trim().toLowerCase();
  const localChatResultCount = displayMessages.length
    + channels.filter(channel => (
      channel.status !== 'archived'
      && channel.name?.toLowerCase().includes(normalizedChatSearch)
      && (!channel.members?.length || channel.members.includes(myUid))
    )).length
    + dms.filter(user => user.name?.toLowerCase().includes(normalizedChatSearch)).length;
  usePublishLocalSearchResults(chatSearch, localChatResultCount);

  // Stale flags (crashed tab, hard reload) are discarded by TTL rather than
  // leaving "X друкує…" on screen forever. The clearing write normally arrives
  // via snapshot; this ticker only covers the case where it never comes.
  const typingFlagCount = activeChannelData?.typing?.length || 0;
  useEffect(() => {
    if (!typingFlagCount) return undefined;
    const timer = setInterval(() => setTypingNow(Date.now()), 2000);
    return () => clearInterval(timer);
  }, [typingFlagCount]);

  const typingUsers = useMemo(
    () => activeTypingUserIds(activeChannelData, { now: typingNow, exclude: myUid })
      .map(uid => members.find(m => (m.id || m.uid) === uid)?.name || 'Хтось'),
    [activeChannelData, members, myUid, typingNow],
  );

  // What this reader has already seen of each thread in this room, so a message
  // can say how many of its replies are new rather than only how many it has.
  const roomId = getRoomId();
  const seenReplies = useMemo(
    () => readState[roomId]?.threads || {},
    [readState, roomId],
  );

  const handleOpenThread = (msgId) => {
    setShowChannelInfo(false);
    openThread(msgId);
  };

  // Opening a thread is reading it, and so is a reply arriving while it is
  // open — otherwise a pane you are looking at keeps announcing «1 нова».
  useEffect(() => {
    if (!activeThreadId || !activeThreadParent) return;
    const seen = seenReplies[activeThreadId] || 0;
    const total = Math.max(threadMessages.length, Number(activeThreadParent.replyCount || 0));
    if (total > seen) void markThreadRead(activeThreadId, total);
  }, [activeThreadId, activeThreadParent, markThreadRead, seenReplies, threadMessages.length]);

  const handleOpenChannelInfo = (tab = 'info') => {
    setChannelInfoTab(tab);
    setShowChannelInfo(true);
    closeThread();
  };

  // The channel document is written from here, not from the panel: the panel is
  // a kit component and knows what a channel looks like, not where it is kept.
  // Each of these resolves to `true` when the write went through, which is what
  // the panel uses to decide whether to leave edit mode.
  const writeChannel = async (patch, failureMessage) => {
    try {
      await setDoc(
        doc(db, 'organizations', activeOrgId, 'channels', activeChannel.id),
        patch,
        { merge: true },
      );
      return true;
    } catch (error) {
      console.error(error);
      showToast(failureMessage, 'error');
      return false;
    }
  };

  const channelMemberIds = () => {
    const current = activeChannelData?.members || channels.find(c => c.id === activeChannel.id)?.members || [];
    return current.length > 0 ? [...current] : activeMembers(members).map(m => m.id || m.uid);
  };

  const handleSaveChannelDescription = description =>
    writeChannel({ description }, 'Не вдалося оновити опис каналу');

  const handleAddChannelMember = (uid) => {
    const list = channelMemberIds();
    if (!list.includes(uid)) list.push(uid);
    return writeChannel({ members: list }, 'Не вдалося додати учасника');
  };

  const handleAddAllChannelMembers = () =>
    writeChannel({ members: members.map(m => m.id || m.uid) }, 'Не вдалося додати учасників');

  const handleRemoveChannelMember = (uid) => {
    const updated = channelMemberIds().filter(id => id !== uid);
    if (updated.length === 0) {
      showToast('У каналі має залишитися хоча б один учасник', 'error');
      return Promise.resolve(false);
    }
    return writeChannel({ members: updated }, 'Не вдалося видалити учасника');
  };

  const handleJumpToMessage = (messageId) => {
    setChatSearch('');
    setShowChannelInfo(false);
    // Long enough to outlast the smooth scroll and the re-flow that closing the
    // panel causes, short enough that a message arriving afterwards still
    // brings a reader sitting at the bottom along with it.
    holdScrollUntilRef.current = Date.now() + 1200;
    // Clearing the search re-renders the list, so the row may not exist in this
    // frame — the message was filtered out of it a moment ago. Wait for it
    // rather than scrolling to nothing, which is the other half of why this
    // only ever worked on the second try.
    let attemptsLeft = 10;
    const land = () => {
      const element = messageRefs.current.get(messageId);
      if (!element) {
        if (attemptsLeft-- > 0) requestAnimationFrame(land);
        return;
      }
      setIsScrolledUp(true);
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      element.animate(
        [
          { backgroundColor: 'rgba(31, 31, 31, 0.12)' },
          { backgroundColor: 'transparent' },
        ],
        { duration: 1200, easing: 'ease-out' },
      );
    };
    requestAnimationFrame(land);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {viewerAttachment && (
        <AttachmentViewer
          attachment={viewerAttachment}
          onClose={() => setViewerAttachment(null)}
        />
      )}
      <Dialog
        isOpen={isCreatingChannel}
        onClose={closeCreateChannelDialog}
        title="Новий канал"
        size="md"
        footer={(
          <>
            <Button
              style="secondary"
              size="md"
              onClick={closeCreateChannelDialog}
              disabled={isSubmittingChannel}
            >
              Скасувати
            </Button>
            <Button
              type="submit"
              form="create-channel-form"
              size="md"
              loading={isSubmittingChannel}
            >
              Створити канал
            </Button>
          </>
        )}
      >
        <form id="create-channel-form" noValidate onSubmit={handleCreateChannel} className="flex flex-col gap-5">
          <FormGroup label="Назва каналу" required error={newChannelNameError}>
            <Input
              id="new-channel-name"
              autoFocus
              value={newChannelName}
              onChange={event => {
                setNewChannelName(event.target.value);
                if (newChannelNameError) setNewChannelNameError('');
              }}
              placeholder="наприклад, дизайн-команда"
              maxLength={80}
              error={Boolean(newChannelNameError)}
            />
          </FormGroup>

          <div className="flex flex-col gap-[6px]">
            <Label htmlFor="new-channel-description">Опис</Label>
            <Textarea
              id="new-channel-description"
              value={newChannelDescription}
              onChange={event => setNewChannelDescription(event.target.value)}
              placeholder="Про що цей канал?"
              rows={3}
              maxLength={240}
            />
          </div>

          <div className="flex flex-col gap-[6px]">
            <Label>Учасники</Label>
            <MultiSelect
              value={newChannelMemberIds}
              onChange={setNewChannelMemberIds}
              options={channelMemberOptions}
              placeholder="Додати учасників"
              searchPlaceholder="Знайти учасника..."
              triggerIcon={UserPlus}
              dropdownClassName="w-full max-w-none"
            />
            <p className="text-[11px] leading-4 text-muted">
              Ви будете додані автоматично. Інші учасники не додаються, доки ви їх не виберете.
            </p>
          </div>
        </form>
      </Dialog>
      {/* Two-zone layout — the shared workspace shell, in its chat context. */}
      <SidebarLayout
        context="chat"
        mobilePane={mobilePane === 'chat' ? 'content' : 'sidebar'}
        sidebar={
          <ChannelRail
            activeId={activeChannel.id}
            onSelect={item => openChannel({ id: item.id, type: item.kind })}
            groups={[
              {
                id: 'channels',
                label: 'Канали',
                action: isAdminOrOwner ? (
                  <Button
                    onClick={() => { resetChannelDraft(); setIsCreatingChannel(true); }}
                    style="ghost"
                    size="icon-xs"
                    icon={Plus}
                    className="hover:!bg-white"
                    title="Новий канал"
                  />
                ) : null,
                items: channels
                  .filter(c => {
                    if (c.status === 'archived') return false;
                    if (!c.name?.toLowerCase().includes(chatSearch.toLowerCase())) return false;
                    if (c.members && c.members.length > 0) return c.members.includes(myUid);
                    return true;
                  })
                  .map(c => ({
                    id: c.id,
                    kind: 'channel',
                    name: c.name,
                    unreadCount: channelUnreadCount(c, readState[c.id], myUid),
                  })),
              },
              {
                id: 'dms',
                label: 'Особисті',
                items: dms
                  .filter(u => u.name?.toLowerCase().includes(chatSearch.toLowerCase()))
                  .map(u => ({
                    id: u.id,
                    kind: 'dm',
                    name: u.name,
                    user: { name: u.name, avatar: u.avatar },
                    online: u.online,
                    statusEmoji: u.statusEmoji,
                    statusText: u.statusText,
                    unreadCount: u.unreadCount,
                  })),
              },
            ]}
          />
        }
      >

        {/* RIGHT: Chat + optional sidebar — mobile: shown only when a chat is open */}
        <div className={`${mobilePane === 'list' ? 'hidden' : 'flex'} md:flex flex-1 gap-3 min-w-0 overflow-hidden`}>

          {/* Main chat area */}
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-canvas">

            {/* Chat header */}
            <ChatConversationHeader
              type={activeChannel.type}
              title={activeChannel.type === 'channel'
                ? (channels.find(c => c.id === activeChannel.id)?.name || activeChannel.id)
                : (dms.find(d => d.id === activeChannel.id)?.name || 'Особисті')}
              subtitle={activeChannel.type === 'dm'
                ? (() => {
                  const directMember = dms.find(d => d.id === activeChannel.id);
                  return formatLastSeenUk(directMember?.lastActive, {
                    now,
                    online: directMember?.online,
                  });
                })()
                : (activeChannelData?.description || currentChannel?.description || '')}
              statusEmoji={activeChannel.type === 'dm' ? dms.find(d => d.id === activeChannel.id)?.statusEmoji : null}
              statusTitle={dms.find(d => d.id === activeChannel.id)?.statusText}
              user={dms.find(d => d.id === activeChannel.id)}
              online={Boolean(dms.find(d => d.id === activeChannel.id)?.online)}
              pinnedCount={activeChannel.type === 'channel' ? messages.filter(m => m.isPinned).length : 0}
              onOpenPinned={() => handleOpenChannelInfo('pinned')}
              infoLabel={activeChannel.type === 'dm' ? 'Про користувача' : 'Про канал'}
              infoActive={showChannelInfo}
              onToggleInfo={() => {
                if (activeChannel.type === 'dm') {
                  router.push(`/chat?dm=${encodeURIComponent(activeChannel.id)}&member=${encodeURIComponent(activeChannel.id)}`);
                  return;
                }
                if (showChannelInfo) {
                  setShowChannelInfo(false);
                } else {
                  handleOpenChannelInfo('info');
                }
              }}
              onBack={requestPaneClose}
            />

            {/* Search Results Banner */}
            {chatSearch.trim() && (
              <ChatSearchBanner
                query={chatSearch}
                count={displayMessages.length}
                onClear={() => setChatSearch('')}
              />
            )}

            {/* Messages list */}
            <ChatMessageList
              scrollRef={chatScrollRef}
              contentRef={chatContentRef}
              endRef={messagesEndRef}
              registerMessageRef={(id, element) => {
                if (element) messageRefs.current.set(id, element);
                else messageRefs.current.delete(id);
              }}
              messages={displayMessages}
              loading={loading}
              searchTerm={chatSearch}
              hasMore={hasMoreMessages}
              onLoadMore={handleLoadOlderMessages}
              typingUsers={typingUsers}
              unreadCount={isScrolledUp ? unreadBadge : 0}
              onJumpToLatest={() => {
                chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
                setUnreadBadge(0);
              }}
              myUid={myUid}
              members={membersWithPresence}
              onReact={handleReaction}
              onEdit={handleEditMessage}
              onDelete={handleDeleteMessage}
              onThread={handleOpenThread}
              seenReplies={seenReplies}
              onPin={handlePin}
              onOpenAttachment={setViewerAttachment}
              canModerate={canModerateRoom}
            />

            {/* Input */}
            <ChatComposerDock ref={composerRef} scrollRef={chatScrollRef} className="qt-nav-dock">
              <MessageInput
                onSend={handleSendMessage}
                onTyping={handleMainTyping}
                onError={message => showToast(message, 'error')}
                placeholder={activeChannel.type === 'channel'
                  ? `Написати в #${channels.find(c => c.id === activeChannel.id)?.name || 'general'}...`
                  : 'Написати повідомлення...'}
                members={mentionMembers}
                projects={projects}
              />
            </ChatComposerDock>
          </div>

          {/* Thread sidebar */}
          {activeThreadId && activeThreadParent && (
            <ThreadSidebar
              parentMsg={activeThreadParent}
              replies={threadMessages}
              myUid={myUid}
              members={mentionMembers}
              projects={projects}
              onSend={handleSendThread}
              onDeleteReply={handleDeleteReply}
              onOpenAttachment={setViewerAttachment}
              onError={message => showToast(message, 'error')}
              onClose={closeThread}
              loading={loading}
              canModerate={canModerateRoom}
            />
          )}

          {/* Channel Info sidebar */}
          {showChannelInfo && activeChannel.type === 'channel' && (
            <ChannelInfoPanel
              key={activeChannel.id}
              channel={{
                id: activeChannel.id,
                ...(activeChannelData || channels.find(c => c.id === activeChannel.id) || { name: activeChannel.id, type: 'public', description: activeChannel.id === 'general' ? 'Загальний канал для всієї команди' : '', members: [] })
              }}
              members={members}
              messages={messages}
              activeTab={channelInfoTab}
              onTabChange={setChannelInfoTab}
              onOpenAttachment={setViewerAttachment}
              onJumpToMessage={handleJumpToMessage}
              onClose={() => setShowChannelInfo(false)}
              isAdminOrOwner={isAdminOrOwner}
              onSaveDescription={handleSaveChannelDescription}
              onAddMember={handleAddChannelMember}
              onAddAllMembers={handleAddAllChannelMembers}
              onRemoveMember={handleRemoveChannelMember}
            />
          )}
        </div>
      </SidebarLayout>
    </div>
  );
}
