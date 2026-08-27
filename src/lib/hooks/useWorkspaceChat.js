'use client';

// src/lib/hooks/useWorkspaceChat.js
import { useState, useEffect, useRef, useCallback } from 'react';
import { collection, doc, query, orderBy, limit, onSnapshot, serverTimestamp, setDoc, where, deleteDoc, deleteField, updateDoc, getDoc, getDocs, arrayUnion, arrayRemove, increment, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { sendNotification } from '@/lib/hooks/useNotifications';
import {
  channelIdFromName,
  channelUnreadCount,
  isDirectRoomId,
  isVisibleChatChannel,
  TYPING_REFRESH_MS,
} from '@/lib/utils/workspaceChat.mjs';
import { deleteFileFromCloudinary } from '@/lib/services/fileUpload';

// A live listener over an entire channel history is unbounded, so only the most
// recent window is subscribed. Older messages load on demand via loadOlderMessages().
const MESSAGE_PAGE_SIZE = 60;

// Best-effort storage cleanup: the Firestore record is already gone, so a
// failed release must not surface as a failed delete.
async function releaseChatAttachments(attachments) {
  const targets = (Array.isArray(attachments) ? attachments : []).filter(item => item?.storagePath);
  if (!targets.length) return;
  await Promise.allSettled(
    targets.map(item => deleteFileFromCloudinary(
      item.storagePath,
      item.resourceType,
      item.deliveryType,
    )),
  );
}

function toChatMessage(document, accessContext = {}) {
  const item = document.data();
  const createdAt = typeof item.createdAt?.toDate === 'function' ? item.createdAt.toDate() : new Date();
  return {
    id: document.id,
    ...item,
    attachments: (item.attachments || []).map((attachment, attachmentIndex) => (
      attachment?.deliveryType === 'authenticated'
        ? {
          ...attachment,
          access: {
            ...accessContext,
            attachmentIndex,
          },
        }
        : attachment
    )),
    time: createdAt.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function useWorkspaceChat(channelId, channelType = 'channel', dmPartnerId = null) {
  const {
    currentUser,
    activeOrgId
  } = useAppContext();
  // Subscriptions key off the uid, never off the `currentUser` object: the
  // profile listener yields a new object whenever any field on the user
  // document changes, and that identity churn used to tear down every chat
  // listener below and re-read each collection from scratch.
  const currentUserId = currentUser?.id || currentUser?.uid || null;
  const [messages, setMessages] = useState([]);
  const [channels, setChannels] = useState([]);
  const [dmChannels, setDmChannels] = useState([]);
  const [activeChannelData, setActiveChannelData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [readState, setReadState] = useState({}); // { channelId: Timestamp }
  const [activeDMs, setActiveDMs] = useState([]); // [uid, ...]
  const [messageLimit, setMessageLimit] = useState(MESSAGE_PAGE_SIZE);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const typingStateRef = useRef(false);
  const typingTimerRef = useRef(null);

  // Thread state
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);

  useEffect(() => {
    typingStateRef.current = false;
    if (!channelId || !activeOrgId || !currentUserId) return undefined;
    const uid = currentUserId;
    const channelRef = doc(db, 'organizations', activeOrgId, 'channels', channelId);
    return () => {
      if (typingTimerRef.current) {
        clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      if (!typingStateRef.current) return;
      typingStateRef.current = false;
      void updateDoc(channelRef, {
        typing: arrayRemove(uid),
        [`typingAt.${uid}`]: 0,
      }).catch(() => {});
    };
  }, [activeOrgId, channelId, currentUserId]);

  // Fetch read state for all channels (per-user cursor tracking)
  useEffect(() => {
    if (!activeOrgId || !currentUserId) return;
    const uid = currentUserId;
    const qReadState = query(collection(db, 'organizations', activeOrgId, 'readState'), where('userId', '==', uid));
    const unsub = onSnapshot(qReadState, snap => {
      const state = {};
      snap.forEach(doc => {
        const data = doc.data();
        state[data.channelId] = {
          lastReadAt: data.lastReadAt,
          messageCount: Number(data.messageCount || 0),
          threads: data.threads && typeof data.threads === 'object' ? data.threads : {},
        };
      });
      setReadState(state);
    }, err => {
      reportLoadError('[useWorkspaceChat] read state', err);
    });
    return () => unsub();
  }, [activeOrgId, currentUserId]);

  // Fetch active DMs list for current user
  useEffect(() => {
    if (!activeOrgId || !currentUserId) return;
    const uid = currentUserId;
    const dmDocRef = doc(db, 'organizations', activeOrgId, 'activeDMs', uid);
    const unsub = onSnapshot(dmDocRef, snap => {
      if (snap.exists()) {
        setActiveDMs(snap.data().partners || []);
      } else {
        setActiveDMs([]);
      }
    }, err => {
      reportLoadError('[useWorkspaceChat] active DMs', err);
    });
    return () => unsub();
  }, [activeOrgId, currentUserId]);

  // Room documents are listable org-wide (see the note in firestore.rules), so
  // visibility is applied here through the shared isVisibleChatChannel rule —
  // the same predicate the unread badge uses, so the sidebar and the badge can
  // no longer disagree about which rooms a member is in.
  useEffect(() => {
    if (!activeOrgId || !currentUserId) return undefined;
    const uid = currentUserId;
    const channelsRef = collection(db, 'organizations', activeOrgId, 'channels');
    const unsubChannels = onSnapshot(query(channelsRef), snap => {
      const allChannels = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      setDmChannels(allChannels.filter(channel => isVisibleChatChannel(channel, uid) && isDirectRoomId(channel.id)));

      const visible = allChannels.filter(channel =>
        !isDirectRoomId(channel.id) && isVisibleChatChannel(channel, uid));
      // `general` is the one room every member may create on first use, so it
      // is always offered even before the document exists. Nothing else is
      // fabricated: a member cannot create other rooms, so offering them only
      // produced a permission error on the first message.
      if (!visible.some(channel => channel.id === 'general')) {
        visible.unshift({ id: 'general', name: 'general', type: 'public' });
      }
      visible.sort((a, b) => {
        const aTime = a.lastMessageAt?.toMillis?.() ?? 0;
        const bTime = b.lastMessageAt?.toMillis?.() ?? 0;
        if (bTime !== aTime) return bTime - aTime;
        return (a.name || '').localeCompare(b.name || '');
      });
      setChannels(visible);
    }, err => {
      reportLoadError('[useWorkspaceChat] channels', err);
    });
    return () => unsubChannels();
  }, [activeOrgId, currentUserId]);

  // Fetch messages for the active channel. Only the most recent window is
  // subscribed — an unbounded listener re-reads the entire history of a busy
  // channel on every open. loadOlderMessages() widens it on demand.
  useEffect(() => {
    queueMicrotask(() => {
      setMessageLimit(MESSAGE_PAGE_SIZE);
      setHasMoreMessages(false);
    });
  }, [channelId, activeOrgId]);

  useEffect(() => {
    if (!channelId || !activeOrgId) {
      queueMicrotask(() => setMessages([]));
      return undefined;
    }
    queueMicrotask(() => setLoading(true));
    const messagesRef = collection(db, 'organizations', activeOrgId, 'channels', channelId, 'messages');
    const q = query(messagesRef, orderBy('createdAt', 'desc'), limit(messageLimit));
    const unsub = onSnapshot(q, snap => {
      // Newest-first on the wire so the limit keeps the *latest* window;
      // reversed here because the UI renders oldest-first.
      const data = snap.docs.map(message => toChatMessage(message, {
        organizationId: activeOrgId,
        channelId,
        messageId: message.id,
      })).reverse();
      setMessages(data);
      setHasMoreMessages(snap.size >= messageLimit);
      setLoading(false);
    }, err => {
      reportLoadError('[useWorkspaceChat] messages', err);
      setLoading(false);
    });
    return () => unsub();
  }, [channelId, activeOrgId, messageLimit]);

  // Fetch thread messages
  useEffect(() => {
    if (!activeThreadId || !channelId || !activeOrgId) {
      queueMicrotask(() => setThreadMessages([]));
      return;
    }
    const q = query(collection(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', activeThreadId, 'replies'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setThreadMessages(snap.docs.map(reply => toChatMessage(reply, {
        organizationId: activeOrgId,
        channelId,
        messageId: activeThreadId,
        replyId: reply.id,
      })));
    }, err => {
      reportLoadError('[useWorkspaceChat] thread replies', err);
    });
    return () => unsub();
  }, [activeThreadId, channelId, activeOrgId]);

  // Fetch active channel data (for typing indicators)
  useEffect(() => {
    if (!channelId || !activeOrgId) {
      queueMicrotask(() => setActiveChannelData(null));
      return;
    }
    const channelRef = doc(db, 'organizations', activeOrgId, 'channels', channelId);
    const unsub = onSnapshot(channelRef, snap => {
      if (snap.exists()) {
        setActiveChannelData(snap.data());
      } else {
        setActiveChannelData(null);
      }
    }, err => {
      reportLoadError('[useWorkspaceChat] active channel', err);
    });
    return () => unsub();
  }, [channelId, activeOrgId]);
  // `issueMentions` is what the composer already resolved: `[{key, id, title}]`.
  // Stored on the message so a `#QT-12` capsule can be drawn without asking the
  // server anything, for as long as that message exists.
  const sendMessage = async (text, attachments = [], issueMentions = []) => {
    if (!text.trim() && attachments.length === 0 || !currentUser || !channelId) return;
    try {
      const uid = currentUser.id || currentUser.uid;
      const channelRef = doc(db, 'organizations', activeOrgId, 'channels', channelId);
      const messagesRef = collection(channelRef, 'messages');
      const messageRef = doc(messagesRef);
      const batch = writeBatch(db);
      const channelMetadata = {
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: uid,
        messageCount: increment(1),
      };
      if (channelType === 'dm') {
        channelMetadata.name = 'DM';
        channelMetadata.type = 'dm';
        // No lastMessageText/lastMessageSender here. Firestore cannot gate a
        // collection listing per document (the {channelId} wildcard is unbound
        // on queries), so every org member can enumerate the room documents —
        // a preview stored here would be readable message content. Only the
        // unread counters live on the document; the text stays under
        // messages/, which IS gated by room membership.
        //
        // `participants` is deliberately NOT written: membership is already
        // provable from the room id, nothing reads the field, and writing it
        // would be rejected by the currently deployed rules — which would break
        // DM sending for the whole window between shipping this client and
        // deploying the new rules.
        //
        // Rooms created before this change still carry a preview written by the
        // old client. Removing it here purges that history as conversations
        // continue, instead of leaving old message text org-readable forever.
        channelMetadata.lastMessageText = deleteField();
        channelMetadata.lastMessageSender = deleteField();
      } else {
        channelMetadata.lastMessageText = text.trim().slice(0, 80);
        channelMetadata.lastMessageSender = currentUser.name || 'Користувач';
        if (channelId === 'general') {
          channelMetadata.name = 'general';
          channelMetadata.type = 'public';
        }
      }
      batch.set(channelRef, channelMetadata, { merge: true });
      batch.set(messageRef, {
        text: text.trim(),
        attachments: attachments,
        issueMentions: Array.isArray(issueMentions) ? issueMentions : [],
        senderId: uid,
        user: currentUser.name || 'Користувач',
        avatar: currentUser.avatar || null,
        createdAt: serverTimestamp(),
        readBy: [uid]
      });
      batch.set(doc(db, 'organizations', activeOrgId, 'readState', `${uid}_${channelId}`), {
        lastReadAt: serverTimestamp(),
        channelId,
        userId: uid,
      }, { merge: true });
      await batch.commit();

      // The current Firestore rules allow the sender to add themselves only to
      // the recipient's active-DM document. Keep this best-effort so a sidebar
      // bookkeeping failure can never cancel an already-sent message.
      if (channelType === 'dm') {
        if (dmPartnerId) {
          void (async () => {
            try {
            const recipientDMRef = doc(db, 'organizations', activeOrgId, 'activeDMs', dmPartnerId);
            await setDoc(recipientDMRef, {
              partners: arrayUnion(uid)
            }, {
              merge: true
            });
          } catch (activeDMError) {
            console.error('[workspace-chat] Failed to update recipient DM list:', activeDMError);
          }

          // Notification delivery is intentionally independent from Firestore
          // sidebar state, otherwise one denied write suppresses the alert.
          try {
            await sendNotification({
              userIds: [dmPartnerId],
              type: 'chat_message',
              title: currentUser.name || 'Нове приватне повідомлення',
              body: text.trim() || 'Надіслано вкладення',
              link: `/chat?dm=${encodeURIComponent(uid)}`,
              // The conversation as the recipient's screen names it: a direct
              // room is the person on the other side of it, which from there is
              // the sender.
              channelId: uid,
              organizationId: activeOrgId,
              dedupeKey: `chat_${messageRef.id}`,
            });
          } catch (notificationError) {
            console.error('[workspace-chat] DM notification failed:', notificationError);
          }
          })();
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
      throw error;
    }
  };
  // Firestore does not cascade, so replies under a deleted message would stay
  // forever and unreachable. Uploaded files are released too — otherwise every
  // deleted attachment keeps costing storage.
  const deleteMessage = async msgId => {
    if (!channelId || !activeOrgId) return;
    try {
      const msgRef = doc(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', msgId);
      const snapshot = await getDoc(msgRef);
      const attachments = snapshot.exists() ? snapshot.data().attachments || [] : [];

      const replies = await getDocs(collection(msgRef, 'replies'));
      const replyAttachments = replies.docs.flatMap(reply => reply.data().attachments || []);

      const batch = writeBatch(db);
      replies.docs.forEach(reply => batch.delete(reply.ref));
      batch.delete(msgRef);
      await batch.commit();

      await releaseChatAttachments([...attachments, ...replyAttachments]);
    } catch (e) {
      console.error('Error deleting message:', e);
      throw e;
    }
  };
  const editMessage = async (msgId, newText) => {
    if (!channelId || !activeOrgId || !newText.trim()) return;
    try {
      const msgRef = doc(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', msgId);
      await updateDoc(msgRef, {
        text: newText.trim(),
        isEdited: true,
        updatedAt: serverTimestamp()
      });
    } catch (e) {
      console.error('Error editing message:', e);
      throw e;
    }
  };
  const toggleReaction = async (msgId, emoji, hasReacted = false) => {
    if (!channelId || !activeOrgId || !currentUser) return;
    const uid = currentUser.id || currentUser.uid;
    try {
      const msgRef = doc(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', msgId);

      // Use atomic arrayUnion/arrayRemove to avoid race conditions
      const update = {};
      update[`reactions.${emoji}`] = hasReacted ? arrayRemove(uid) : arrayUnion(uid);
      await updateDoc(msgRef, update);
    } catch (e) {
      console.error('Error toggling reaction:', e);
      throw e;
    }
  };
  const createChannel = async (name, options = {}) => {
    if (!name.trim() || !activeOrgId) throw new Error('Вкажіть назву каналу');
    const safeId = channelIdFromName(name);
    // A slug that survives sanitising is required: `/` is illegal in a document
    // id and `_` is reserved for DM room ids, so a name made only of those
    // characters has no usable id.
    if (!safeId) throw new Error('Назва каналу має містити літери або цифри');

    const channelRef = doc(db, 'organizations', activeOrgId, 'channels', safeId);
    // Plain `setDoc` here silently replaced an existing room, wiping its
    // description, members and message counters. Refuse instead.
    const existing = await getDoc(channelRef);
    if (existing.exists()) throw new Error('Канал з такою назвою вже існує');

    await setDoc(channelRef, {
      name: name.trim().toLowerCase(),
      type: 'public',
      description: options.description || '',
      members: Array.isArray(options.members) ? [...new Set(options.members.filter(Boolean))] : [],
      createdAt: serverTimestamp(),
    });
    return safeId;
  };
  // The flag carries a heartbeat timestamp and is refreshed while typing, so a
  // reader can discard it after TYPING_TTL_MS (both live in workspaceChat.mjs,
  // beside the reader that applies them). Without that, a crashed tab leaves
  // "X is typing…" on screen permanently.
  const setTyping = async isTyping => {
    if (!channelId || !activeOrgId || !currentUser) return;
    if (typingStateRef.current === isTyping) return;
    typingStateRef.current = isTyping;
    const uid = currentUser.id || currentUser.uid;
    const channelRef = doc(db, 'organizations', activeOrgId, 'channels', channelId);
    const write = () => setDoc(channelRef, {
      typing: isTyping ? arrayUnion(uid) : arrayRemove(uid),
      typingAt: { [uid]: isTyping ? Date.now() : 0 },
    }, { merge: true });

    if (typingTimerRef.current) {
      clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }
    try {
      await write();
      if (isTyping) {
        typingTimerRef.current = setInterval(() => {
          if (!typingStateRef.current) return;
          void write().catch(() => {});
        }, TYPING_REFRESH_MS);
      }
    } catch {
      typingStateRef.current = !isTyping;
    }
  };
  const sendThreadMessage = async (text, attachments = [], issueMentions = []) => {
    if (!text.trim() && attachments.length === 0 || !currentUser || !channelId || !activeThreadId) return;
    try {
      const parentRef = doc(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', activeThreadId);
      const replyRef = doc(collection(parentRef, 'replies'));
      const batch = writeBatch(db);
      batch.set(replyRef, {
        text: text.trim(),
        attachments: attachments,
        issueMentions: Array.isArray(issueMentions) ? issueMentions : [],
        senderId: currentUser.id || currentUser.uid,
        user: currentUser.name || 'Користувач',
        avatar: currentUser.avatar || null,
        createdAt: serverTimestamp()
      });
      batch.update(parentRef, {
        replyCount: increment(1)
      });
      await batch.commit();
    } catch (e) {
      console.error(e);
      throw e;
    }
  };
  // What of a thread this reader has already seen, kept on the read-state
  // document they already have for the channel — so a thread costs no document
  // and no listener of its own, and «5 відповідей» can say how many of them are
  // new instead of just how many there are.
  //
  // It is deliberately not `messageCount` on the channel: a reply is not a
  // message in the room, and marking the room unread for it would be cleared by
  // walking into the room without ever opening the thread. Slack keeps the two
  // apart for the same reason.
  const markThreadRead = async (parentMsgId, replyCount) => {
    if (!currentUser || !activeOrgId || !channelId || !parentMsgId) return;
    const uid = currentUser.id || currentUser.uid;
    try {
      await setDoc(doc(db, 'organizations', activeOrgId, 'readState', `${uid}_${channelId}`), {
        channelId,
        userId: uid,
        threads: { [parentMsgId]: Number(replyCount) || 0 },
      }, { merge: true });
    } catch (e) {
      console.error('Error marking thread as read:', e);
    }
  };
  const markAsRead = async cId => {
    if (!currentUser || !activeOrgId || !cId) return;
    const uid = currentUser.id || currentUser.uid;
    try {
      const channelSnapshot = await getDoc(doc(db, 'organizations', activeOrgId, 'channels', cId));
      await setDoc(doc(db, 'organizations', activeOrgId, 'readState', `${uid}_${cId}`), {
        lastReadAt: serverTimestamp(),
        channelId: cId,
        userId: uid,
        messageCount: Number(channelSnapshot.data()?.messageCount || 0),
      }, {
        merge: true
      });
    } catch (e) {
      console.error('Error marking as read:', e);
    }
  };
  const deleteReply = async (parentMsgId, replyId) => {
    if (!channelId || !activeOrgId || !parentMsgId || !replyId) return;
    try {
      const replyRef = doc(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', parentMsgId, 'replies', replyId);
      const parentRef = doc(db, 'organizations', activeOrgId, 'channels', channelId, 'messages', parentMsgId);
      const replySnapshot = await getDoc(replyRef);
      const attachments = replySnapshot.exists() ? replySnapshot.data().attachments || [] : [];
      const batch = writeBatch(db);
      batch.delete(replyRef);
      batch.update(parentRef, {
        replyCount: increment(-1)
      });
      await batch.commit();
      await releaseChatAttachments(attachments);
    } catch (e) {
      console.error('Error deleting reply:', e);
      throw e;
    }
  };
  // Stable across renders, and deliberately so: a caller reads these in an
  // effect's dependency list. A fresh function every render there re-runs the
  // effect on every render, which is how the chat page used to spin forever the
  // moment its URL carried a conversation to open — see the `dm`/`channel`
  // /`thread` effect on the chat page.
  const openThread = useCallback(msgId => setActiveThreadId(msgId), []);
  const closeThread = useCallback(() => setActiveThreadId(null), []);
  const loadOlderMessages = useCallback(
    () => setMessageLimit(current => current + MESSAGE_PAGE_SIZE),
    [],
  );

  // Compute unread count for a channel
  const getUnreadCount = cId => {
    const channel = [...channels, ...dmChannels].find(item => item.id === cId);
    return channelUnreadCount(channel, readState[cId], currentUser?.id || currentUser?.uid);
  };
  return {
    channels,
    dmChannels,
    messages,
    loading,
    activeChannelData,
    activeThreadId,
    threadMessages,
    readState,
    activeDMs,
    hasMoreMessages,
    loadOlderMessages,
    sendMessage,
    deleteMessage,
    editMessage,
    toggleReaction,
    createChannel,
    setTyping,
    openThread,
    closeThread,
    sendThreadMessage,
    markThreadRead,
    markAsRead,
    deleteReply,
    getUnreadCount
  };
}
