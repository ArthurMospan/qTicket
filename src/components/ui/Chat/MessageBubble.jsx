'use client';

// The chat message row: avatar, author, body, attachments, reactions and the
// hover actions. It lived inside src/app/(app)/chat/page.js, which meant the
// single most-repeated visual unit in the product had no representation in the
// kit at all — /ui-kit could only ever show an empty grey box where the
// conversation goes. Moved verbatim; the page passes exactly the props it did.

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Edit2, Pin, Smile, Trash2 } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import dynamic from 'next/dynamic';
import Button from '@/components/ui/Button';
import IconAction from '@/components/ui/IconAction';
import Pill from '@/components/ui/DataDisplay/Pill';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import MessageContent from '@/components/workspace/MessageContent';
import { ChatAttachmentList } from './ChatAttachmentList';
import { useFloatingOverlay } from '@/lib/hooks/useFloatingOverlay';
import { plural } from '@/lib/utils/plural.mjs';

// Loaded when somebody opens it, not when the page does.
//
// emoji-picker-react carries its own emoji data and is the largest dependency
// in the bundle; imported at the top it shipped to everyone who opened a chat,
// and through MessageBubble to everyone who opened a task. It appears behind a
// click on a face, which is exactly what a dynamic import is for — the pattern
// pdfjs-dist and write-excel-file already use here.
const EmojiPicker = dynamic(() => import('emoji-picker-react'), { ssr: false });

// ─── Message Bubble ─────────────────────────────────────────────────────────
/**
 * One message: the author header when it starts a run, the text, its
 * attachments, its reactions, and the actions that appear on hover.
 *
 * @param {object} props.msg The message.
 * @param {object} props.prevMsg The one above it; consecutive messages from the same author share one avatar header.
 * @param {string} props.myUid The signed-in user, which decides which side the bubble sits on and what may be edited.
 * @param {object[]} props.members Participants, for names and avatars.
 * @param {(msg, emoji) => void} props.onReact Adds or removes a reaction.
 * @param {(msg) => void} props.onEdit Opens it for editing.
 * @param {(msg) => void} props.onDelete Deletes it.
 * @param {(msg) => void} props.onThread Opens its thread.
 * @param {(msg) => void} props.onPin Pins or unpins it.
 * @param {(attachment) => void} props.onOpenAttachment Opens an attachment in the viewer.
 * @param {boolean} props.canModerate The reader is an owner/admin of a group channel and may remove someone else's message. Never true in a direct room.
 * @param {boolean} props.isThread Inside a thread pane: no thread action, tighter layout.
 * @param {number} props.seenReplyCount How many of this message's replies this reader has already seen.
 * @param {string} props.searchTerm Current query; matches are highlighted in the text.
 */
export default function MessageBubble({
  msg, prevMsg, myUid, members, onReact, onEdit, onDelete, onThread,
  onPin, onOpenAttachment, isThread = false, searchTerm = '', seenReplyCount = 0,
  canModerate = false,
}) {
  const unreadReplies = Math.max(0, Number(msg.replyCount || 0) - Number(seenReplyCount || 0));
  const [showActions, setShowActions] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.text || '');
  const editFieldRef = useRef(null);
  const rowRef = useRef(null);
  const emojiButtonRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const emojiPickerPosition = useFloatingOverlay({
    open: showEmoji,
    anchorRef: emojiButtonRef,
    overlayRef: emojiPickerRef,
    preferredPlacement: 'top',
    align: 'end',
  });
  const router = useRouter();
  const confirmDialog = useConfirm();

  const showHeader = !prevMsg
    || prevMsg.senderId !== msg.senderId
    || msg.isSystem
    || prevMsg.isSystem
    || ((msg.createdAt?.toMillis?.() ?? 0) - (prevMsg.createdAt?.toMillis?.() ?? 0) > 300000);

  const isMe = msg.senderId === myUid;
  // Editing belongs to the author alone — an edited message still carries their
  // name. Removing one that should not stand is what moderation is for, so the
  // delete action, and only that one, is also offered to owners and admins.
  const canDelete = isMe || canModerate;
  // An edit that changes nothing is not an edit, and an empty one is a delete
  // asked for in the wrong place; neither may be saved.
  const editChanged = editText.trim().length > 0 && editText.trim() !== (msg.text || '').trim();
  const commitEdit = () => {
    if (!editChanged) return;
    onEdit(msg.id, editText.trim());
    setEditing(false);
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditText(msg.text || '');
  };
  const senderMember = members?.find(member => (member.id || member.uid) === msg.senderId);

  // The field grows with what is in it, measured from the value rather than
  // from a keystroke: opening a long message for editing is an assignment, not
  // an input event, which is exactly how a paragraph ended up in a box two
  // lines tall that had to be scrolled.
  useEffect(() => {
    const field = editFieldRef.current;
    if (!editing || !field) return;
    field.style.height = 'auto';
    // `scrollHeight` is content plus padding; the box is `border-box`, so the
    // border has to be added back or the field is left one scroll-step short of
    // its own text — a permanent two-pixel scrollbar in a box that looks full.
    const border = field.offsetHeight - field.clientHeight;
    const wanted = field.scrollHeight + border;
    field.style.height = `${Math.min(wanted, 320)}px`;
    field.style.overflowY = wanted > 320 ? 'auto' : 'hidden';
  }, [editing, editText]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e) => {
      if (
        emojiPickerRef.current && !emojiPickerRef.current.contains(e.target) &&
        emojiButtonRef.current && !emojiButtonRef.current.contains(e.target)
      ) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmoji]);

  // A phone has no hover, and the whole of what a message can do lived behind
  // one: reacting, replying in a thread, pinning, editing, deleting. On touch
  // the row is tapped open instead — and tapped shut again by the next tap
  // anywhere else, which is the half a toggle needs to not accumulate. Only
  // touch pointers are listened for, so nothing about a mouse changes.
  useEffect(() => {
    if (!showActions || showEmoji) return undefined;
    const handler = (event) => {
      if (event.pointerType !== 'touch') return;
      if (rowRef.current?.contains(event.target)) return;
      setShowActions(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [showActions, showEmoji]);

  if (msg.isSystem) {
    return (
      <div className="flex justify-center my-3">
        <span className="text-[12px] text-muted bg-white px-3 py-1 rounded-full border border-line">
          {msg.text}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={rowRef}
      className={`relative flex gap-3 px-4 py-1 group hover:bg-black/[0.02] transition-colors rounded-xl -mx-2 max-md:gap-2 max-md:-mx-1 max-md:px-2 ${showHeader ? 'mt-4' : 'mt-0.5'}`}
      tabIndex={0}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { if (!showEmoji) setShowActions(false); }}
      onPointerUp={(event) => {
        // The tap that opens the actions, and the one that closes them again.
        // Anything already pressable inside the row — a mention, an avatar, an
        // attachment, a reaction — keeps its own tap.
        if (event.pointerType !== 'touch' || editing) return;
        if (event.target.closest?.('button, a, input, textarea, [role="button"]')) return;
        setShowActions(previous => !previous);
      }}
      onFocusCapture={() => setShowActions(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && !showEmoji) {
          setShowActions(false);
        }
      }}
    >
      {/* Avatar or time gutter */}
      <div className="w-9 shrink-0 flex justify-end items-start pt-0.5">
        {showHeader ? (
          senderMember ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                router.push(`?member=${msg.senderId}`);
              }}
              className="w-9 h-9 rounded-xl overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
              title="Переглянути профіль"
            >
              <UserAvatar user={{ name: msg.user, avatar: senderMember.avatar || msg.avatar }} size="chat-message" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-xl overflow-hidden">
              <UserAvatar user={{ name: msg.user, avatar: msg.avatar }} size="chat-message" />
            </div>
          )
        ) : (
          <span className={`text-[10px] text-muted leading-[1.8] pt-1 transition-opacity ${showActions ? 'opacity-100' : 'opacity-0'}`}>
            {msg.time}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {showHeader && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-semibold text-[14px] text-ink flex items-center gap-1">
              {msg.user}
              {senderMember?.statusEmoji && (
                <span className="cursor-help" title={senderMember.status || 'Статус користувача'}>
                  {senderMember.statusEmoji}
                </span>
              )}
            </span>
            <span className="text-[11px] text-muted">{msg.time}</span>
            {msg.isPinned && (
              <Pill size="sm">📌 Закріплено</Pill>
            )}
          </div>
        )}

        {editing ? (
          // Editing a message is writing a message, so it is the same thing to
          // do: a field that grows with what is in it and two real buttons.
          // What stood here was a fixed two-line box that a long message had to
          // be scrolled inside, and two words of underlined text where the
          // buttons should be — nothing said which of them was the safe one,
          // and «Скасувати» sat close enough to «Зберегти» to be hit instead.
          <div className="mt-1 flex flex-col gap-2">
            <textarea
              ref={editFieldRef}
              value={editText}
              onChange={e => setEditText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
              }}
              autoFocus
              rows={1}
              aria-label="Редагувати повідомлення"
              className="w-full resize-none rounded-xl border border-ink/20 bg-white p-3 text-[14px] leading-relaxed text-ink outline-none transition-colors focus:border-ink"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" style="primary" onClick={commitEdit} disabled={!editChanged}>
                Зберегти
              </Button>
              <Button size="sm" style="ghost" onClick={cancelEdit}>
                Скасувати
              </Button>
              <span className="text-[11px] text-muted">
                Enter — зберегти · Shift+Enter — новий рядок · Esc — скасувати
              </span>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[14px] text-ink leading-relaxed break-words">
              <MessageContent
                text={msg.text}
                members={members}
                searchTerm={searchTerm}
                issueMentions={msg.issueMentions}
              />
              {msg.isEdited && <span className="text-[11px] text-muted ml-1">(редаговано)</span>}
            </div>

            {/* Attachments */}
            <ChatAttachmentList
              attachments={msg.attachments}
              onOpen={onOpenAttachment}
            />

            {/* Reactions */}
            {msg.reactions && Object.keys(msg.reactions).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {Object.entries(msg.reactions).filter(([, users]) => users.length > 0).map(([emoji, users]) => {
                  const reacted = users.includes(myUid);
                  return (
                    <button
                      key={emoji}
                      onClick={() => onReact(msg.id, emoji, reacted)}
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[13px] border transition-all hover:scale-105 active:scale-95 ${
                        reacted
                          ? 'bg-canvas border-ink/20 text-ink'
                          : 'bg-white border-line text-ink hover:border-muted'
                      }`}
                    >
                      <span>{emoji}</span>
                      <span className="text-[11px] font-bold">{users.length}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Thread reply count. A thread with answers nobody here has read
                says so — «2 нові» — because the old line counted the thread's
                whole size and therefore looked exactly the same whether the
                reply had arrived a second ago or a week ago. */}
            {!isThread && msg.replyCount > 0 && (
              <button
                onClick={() => onThread(msg.id)}
                className={`mt-1.5 flex items-center gap-1.5 rounded-full px-2 py-0.5 -ml-2 text-[12px] font-semibold transition-colors ${
                  unreadReplies > 0
                    ? 'bg-ink text-white hover:bg-ink-hover'
                    : 'text-ink hover:underline'
                }`}
              >
                <ChatIcon size={12} />
                {/* «11 відповідь» and «5 нові» are what counting by hand
                    produces; the organization's own plural rule is a function. */}
                {msg.replyCount} {plural(msg.replyCount, ['відповідь', 'відповіді', 'відповідей'])}
                {unreadReplies > 0 && (
                  <span>· {unreadReplies} {plural(unreadReplies, ['нова', 'нові', 'нових'])}</span>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Action toolbar */}
      {(showActions || showEmoji) && !editing && (
        <div data-ui-surface="local" className="absolute right-4 -top-4 max-md:right-1 max-md:-top-3 bg-white border border-line rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex items-center p-1 gap-0.5 z-20">
          {/* Emoji */}
          <div className="relative">
            <IconAction
              buttonRef={emojiButtonRef}
              onClick={() => setShowEmoji(v => !v)}
              icon={Smile}
              label="Реакція"
              size="sm"
              appearance="soft"
              composition="chat-message-action"
            />
            {showEmoji && typeof document !== 'undefined' && createPortal(
              <div
                ref={emojiPickerRef}
                className="fixed z-[1000] max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-hidden rounded-2xl shadow-2xl"
                style={{
                  top: emojiPickerPosition.top,
                  left: emojiPickerPosition.left,
                  visibility: emojiPickerPosition.ready ? 'visible' : 'hidden',
                }}
              >
                <EmojiPicker
                  onEmojiClick={(d) => { onReact(msg.id, d.emoji); setShowEmoji(false); setShowActions(false); }}
                  autoFocusSearch={false}
                  skinTonesDisabled
                  width={300}
                  height={360}
                  emojiStyle="native"
                />
              </div>,
              document.body,
            )}
          </div>

          {/* Thread (only for main chat messages) */}
          {!isThread && (
            <Button
              onClick={() => onThread(msg.id)}
              style="ghost" size="icon-sm" composition="chat-message-action" icon={ChatIcon}
              title="Відповісти в гілку"
            />
          )}

          {/* Pin */}
          {!isThread && (
            <Button
              onClick={() => onPin(msg.id, !msg.isPinned)}
              style="ghost" size="icon-sm" composition="chat-message-action" icon={Pin}
              surface={msg.isPinned ? 'canvas' : 'default'}
              title={msg.isPinned ? 'Відкріпити' : 'Закріпити'}
            />
          )}

          {/* Edit (author only) and Delete (author, or a moderator) */}
          {canDelete && (
            <>
              <div className="w-px h-4 bg-line mx-0.5" />
              {isMe && (
                <Button
                  onClick={() => { setEditing(true); setEditText(msg.text); }}
                  style="ghost" size="icon-sm" icon={Edit2}
                  title="Редагувати"
                />
              )}
              <Button
                onClick={async () => {
                  const confirmed = await confirmDialog({
                    title: isMe ? 'Видалити повідомлення?' : 'Видалити повідомлення учасника?',
                    message: isMe ? undefined : 'Його не побачить ніхто в каналі. Скасувати не вийде.',
                    confirmText: 'Видалити',
                    danger: true,
                  });
                  if (confirmed) onDelete(msg.id);
                }}
                style="ghost" color="red" size="icon-sm" icon={Trash2}
                title={isMe ? 'Видалити' : 'Видалити як адміністратор'}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
