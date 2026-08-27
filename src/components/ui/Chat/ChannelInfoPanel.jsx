'use client';

import React, { useState } from 'react';
import { Hash, Info, Paperclip, Pin, Plus, Search, UserPlus, X } from 'lucide-react';
import IconAction from '../IconAction';
import TextAction from '../TextAction';
import UserAvatar from '../DataDisplay/UserAvatar';
import { ChatAttachmentList } from './ChatAttachmentList';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import {
  chatAttachmentNames,
  collectChatAttachments,
  isChatMediaAttachment,
} from '@/lib/utils/chatAttachments.mjs';

// ─── UI Kit: Channel Info Panel ──────────────────────────────────────────────
// The right-hand pane of a chat channel: description, members, pinned messages
// and every file the channel has ever carried.
//
// Thirteen of the product's hand-written controls lived in here — a third of the
// whole chat surface — and none of them could be seen anywhere but in a real
// channel with real members. That is what made the panel drift: its «Зберегти»
// was a different size from the one two hundred lines above it in the same
// file, and nothing could ever have noticed.
//
// Moved verbatim from src/app/(app)/chat/page.js, with one boundary drawn: the
// four Firestore writes stayed on the page and arrive here as callbacks. A kit
// component describes a channel; it does not know where channels are stored.
// Each callback resolves to `true` when the write succeeded, which is what the
// panel needs to decide whether to leave edit mode.

const TABS = [
  ['info', 'Про канал'],
  ['pinned', 'Закріплені'],
  ['materials', 'Матеріали'],
];

const MATERIAL_FILTERS = [
  ['all', 'Усі'],
  ['media', 'Медіа'],
  ['files', 'Файли'],
];

/**
 * The panel beside a conversation: its description, its members, and everything
 * ever attached to it, on three tabs.
 *
 * @param {object} props.channel The conversation.
 * @param {object[]} props.members Its participants.
 * @param {object[]} props.messages Its messages, which the attachments tab reads.
 * @param {string} props.activeTab Which tab is open.
 * @param {(tab: string) => void} props.onTabChange Switches tabs.
 * @param {boolean} props.isAdminOrOwner Whether the reader may change membership or the description.
 * @param {(member) => void} props.onAddMember Adds one person.
 * @param {() => void} props.onAddAllMembers Adds everybody in the workspace.
 * @param {(member) => void} props.onRemoveMember Removes one person.
 * @param {(text: string) => void} props.onSaveDescription Saves the edited description.
 * @param {(message) => void} props.onJumpToMessage Scrolls the conversation to that message.
 * @param {(attachment) => void} props.onOpenAttachment Opens an attachment in the viewer.
 * @param {() => void} props.onClose Closes the panel.
 */
export default function ChannelInfoPanel({
  channel,
  members = [],
  messages = [],
  activeTab,
  onTabChange,
  onOpenAttachment,
  onJumpToMessage,
  onClose,
  isAdminOrOwner,
  onSaveDescription,
  onAddMember,
  onAddAllMembers,
  onRemoveMember,
}) {
  const [description, setDescription] = useState(channel?.description || '');
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');
  const [materialFilter, setMaterialFilter] = useState('all');

  const channelMembers = channel?.members || [];
  const pinnedMessages = messages.filter(message => message.isPinned);
  const attachments = collectChatAttachments(messages);
  const visibleAttachments = attachments.filter(attachment => {
    if (materialFilter === 'media' && !isChatMediaAttachment(attachment)) return false;
    if (materialFilter === 'files' && isChatMediaAttachment(attachment)) return false;
    const queryValue = materialSearch.trim().toLocaleLowerCase('uk-UA');
    if (!queryValue) return true;
    return `${attachment.name || ''} ${attachment.senderName || ''}`
      .toLocaleLowerCase('uk-UA')
      .includes(queryValue);
  });

  // Calculate who is in and who is out
  const membersInChannel = members.filter(m => {
    const id = m.id || m.uid;
    // If channel.members array is empty/doesn't exist, treat everyone as a member
    if (!channelMembers || channelMembers.length === 0) return true;
    return channelMembers.includes(id);
  });

  // Only someone who still has access can be added to a channel; a colleague
  // who was deactivated stays visible in the list above if they were in it.
  const membersOutChannel = activeMembers(members).filter(m => {
    const id = m.id || m.uid;
    if (!channelMembers || channelMembers.length === 0) return false;
    return !channelMembers.includes(id);
  });

  const tabLabel = (tabId, label) => {
    if (tabId === 'pinned') return `${label}${pinnedMessages.length ? ` · ${pinnedMessages.length}` : ''}`;
    if (tabId === 'materials') return `${label}${attachments.length ? ` · ${attachments.length}` : ''}`;
    return label;
  };

  const saveDescription = async () => {
    if (await onSaveDescription?.(description.trim())) setIsEditingDesc(false);
  };

  const addAllMembers = async () => {
    if (await onAddAllMembers?.()) setShowAddMembers(false);
  };

  return (
    // A pane that fills the screen is `position: fixed`, and a fixed box is laid
    // out against the layout viewport — which the keyboard covers rather than
    // shortens. The app shell subtracts the overlap from its own height and this
    // pane is not inside that box, so it subtracts it too; otherwise its
    // composer sits under the keys with nothing able to scroll to it.
    <div data-ui-overlay="responsive-pane" className="fixed inset-0 z-50 max-md:bottom-[var(--qt-keyboard-inset,0px)] md:static md:z-auto md:w-[360px] md:rounded-[16px] shrink-0 bg-canvas flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-[56px] shrink-0 border-b border-line/70">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-muted" />
          <h3 className="ui-type-card-title text-ink">Про канал</h3>
        </div>
        <IconAction
          onClick={onClose}
          icon={X}
          label="Закрити інформацію про канал"
          appearance="quiet"
          composition="chat-panel-action"
        />
      </div>

      <div className="flex shrink-0 gap-1 border-b border-line/70 px-3 py-2">
        {TABS.map(([tabId, label]) => (
          <button
            key={tabId}
            type="button"
            onClick={() => onTabChange(tabId)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
              activeTab === tabId ? 'bg-white text-ink' : 'text-muted hover:bg-white/60 hover:text-ink'
            }`}
          >
            {tabLabel(tabId, label)}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-6">
        {activeTab === 'info' && (
          <>
            {/* Basic Info */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <Hash size={18} className="text-ink shrink-0" />
                <h4 className="ui-type-dialog-title text-ink truncate">
                  {channel.name}
                </h4>
              </div>

              <div data-ui-surface="local" className="mt-2 bg-white rounded-2xl p-4 border border-line/70">
                <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">Опис</p>
                {isEditingDesc ? (
                  <div className="flex flex-col gap-2 mt-1">
                    <textarea
                      value={description}
                      onChange={e => setDescription(e.target.value)}
                      className="w-full bg-white border border-ink/20 focus:border-ink rounded-xl p-2.5 text-[13px] outline-none resize-none transition-colors"
                      rows={2}
                    />
                    <div className="flex justify-end gap-2">
                      <TextAction tone="muted" onClick={() => setIsEditingDesc(false)}>Скасувати</TextAction>
                      <TextAction onClick={saveDescription}>Зберегти</TextAction>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start gap-4">
                    <p className="text-[13px] text-ink leading-relaxed">
                      {channel.description || <span className="italic text-placeholder">Опис відсутній</span>}
                    </p>
                    {isAdminOrOwner && (
                      <TextAction tone="muted" onClick={() => setIsEditingDesc(true)}>Редагувати</TextAction>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Members List */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-bold text-muted uppercase tracking-widest">
                  Учасники ({membersInChannel.length})
                </span>
                {isAdminOrOwner && (
                  <TextAction size="sm" icon={UserPlus} onClick={() => setShowAddMembers(v => !v)}>
                    Додати
                  </TextAction>
                )}
              </div>

              {showAddMembers && (
                <div data-ui-surface="local" className="mb-4 bg-white rounded-2xl p-3 border border-line/70 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={addAllMembers}
                    className="w-full text-center py-2 bg-ink hover:bg-ink-hover text-white rounded-xl text-[12px] font-semibold transition-colors"
                  >
                    Додати всіх учасників
                  </button>
                  {membersOutChannel.length > 0 && (
                    <div className="border-t border-line pt-2 max-h-[140px] overflow-y-auto custom-scrollbar flex flex-col gap-1">
                      {membersOutChannel.map(m => (
                        <button
                          key={m.id || m.uid}
                          type="button"
                          onClick={() => onAddMember?.(m.id || m.uid)}
                          className="w-full flex items-center justify-between text-left px-2 py-1.5 hover:bg-canvas rounded-lg transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <UserAvatar user={{ name: m.name, avatar: m.avatar }} size="chat-inline" />
                            <span className="text-[12px] font-medium text-ink">{m.name || m.email}</span>
                          </div>
                          <Plus size={14} className="text-muted" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div data-ui-surface="local" className="bg-white rounded-2xl border border-line/70 p-3 max-h-[300px] overflow-y-auto custom-scrollbar flex flex-col gap-2">
                {membersInChannel.map(m => (
                  <div key={m.id || m.uid} className="flex items-center justify-between py-0.5 group/m">
                    <div className="flex items-center gap-2">
                      <UserAvatar user={{ name: m.name, avatar: m.avatar }} size="sm" />
                      <span className="text-[13px] font-medium text-ink truncate max-w-[180px]">{m.name || m.email}</span>
                    </div>
                    {isAdminOrOwner && channelMembers.length > 0 && (
                      <TextAction
                        tone="danger"
                        size="sm"
                        onClick={() => onRemoveMember?.(m.id || m.uid)}
                        className="opacity-0 group-hover/m:opacity-100"
                      >
                        Видалити
                      </TextAction>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {activeTab === 'pinned' && (
          <div className="flex flex-col gap-2">
            {pinnedMessages.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <Pin size={28} className="mb-3 text-faint" />
                <p className="text-[13px] font-semibold text-muted">Немає закріплених повідомлень</p>
              </div>
            ) : pinnedMessages.map(message => {
              const text = String(message.text || '').trim();
              const fileNames = chatAttachmentNames(message.attachments);
              return (
                <button
                  key={message.id}
                  type="button"
                  onClick={() => onJumpToMessage(message.id)}
                  className="rounded-xl border border-line/70 bg-white p-3 text-left transition-colors hover:border-faint"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-semibold text-muted">{message.user}</span>
                    <span className="shrink-0 text-[10px] text-faint">{message.time}</span>
                  </div>
                  {(text || !fileNames) && (
                    <p className="line-clamp-3 text-[12px] leading-5 text-ink">{text || 'Повідомлення'}</p>
                  )}
                  {/* The files by name. A pinned file is pinned *because* of
                      which file it is, and this line used to say «Вкладення». */}
                  {fileNames && (
                    <span className={`flex items-center gap-1 text-[11px] text-muted ${text ? 'mt-1' : ''}`}>
                      <Paperclip size={11} className="shrink-0" />
                      <span className="truncate">{fileNames}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {activeTab === 'materials' && (
          <div className="flex flex-col gap-3">
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={materialSearch}
                onChange={event => setMaterialSearch(event.target.value)}
                placeholder="Пошук матеріалів..."
                className="w-full rounded-xl border border-line bg-white py-2 pl-9 pr-3 text-[12px] text-ink outline-none transition-colors hover:border-faint focus:border-faint"
              />
            </label>
            <div className="flex gap-1">
              {MATERIAL_FILTERS.map(([filterId, label]) => (
                <button
                  key={filterId}
                  type="button"
                  onClick={() => setMaterialFilter(filterId)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors ${
                    materialFilter === filterId ? 'bg-ink text-white' : 'bg-white text-muted hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {visibleAttachments.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <Paperclip size={28} className="mb-3 text-faint" />
                <p className="text-[13px] font-semibold text-muted">
                  {materialSearch ? 'Матеріали не знайдено' : 'У чаті ще немає матеріалів'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleAttachments.map(attachment => (
                  <div key={attachment.chatAttachmentKey} data-ui-surface="local" className="rounded-xl border border-line/70 bg-white p-2">
                    <ChatAttachmentList
                      attachments={[attachment]}
                      context="panel"
                      onOpen={onOpenAttachment}
                    />
                    <TextAction
                      tone="muted"
                      size="xs"
                      onClick={() => onJumpToMessage(attachment.messageId)}
                      className="mt-1 w-full px-1"
                    >
                      <span className="min-w-0 truncate">
                        {attachment.senderName || 'Учасник'} · перейти до повідомлення
                      </span>
                    </TextAction>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
