'use client';

// src/lib/hooks/useUnreadChatCount.js — number of chat channels with unread messages
// (channel.lastMessageAt is newer than the user's readState cursor — same rule as the chat sidebar)
import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import { reportLoadError } from '@/lib/utils/errors';
import { channelUnreadCount, isVisibleChatChannel } from '@/lib/utils/workspaceChat.mjs';

export function useUnreadChatCount({ enabled = true } = {}) {
  const { currentUser, activeOrgId } = useAppContext();
  // uid, not the object: a new `currentUser` identity (any write to the user
  // document produces one) used to re-subscribe and re-read the read cursors.
  const currentUserId = currentUser?.id || currentUser?.uid || null;
  const [channels, setChannels] = useState([]);
  const [readState, setReadState] = useState(null); // { channelId: lastReadAt Timestamp }

  useEffect(() => {
    if (!enabled || !activeOrgId || !currentUserId) {
      queueMicrotask(() => setReadState(null));
      return undefined;
    }
    const uid = currentUserId;
    const qReadState = query(collection(db, 'organizations', activeOrgId, 'readState'), where('userId', '==', uid));
    const unsub = onSnapshot(qReadState, snap => {
      const state = {};
      snap.forEach(d => {
        const data = d.data();
        state[data.channelId] = {
          lastReadAt: data.lastReadAt,
          messageCount: Number(data.messageCount || 0),
        };
      });
      setReadState(state);
    }, err => {
      reportLoadError('[useUnreadChatCount] read state', err);
    });
    return () => unsub();
  }, [activeOrgId, currentUserId, enabled]);

  useEffect(() => {
    if (!enabled || !activeOrgId) {
      queueMicrotask(() => setChannels([]));
      return undefined;
    }
    const qChannels = query(collection(db, 'organizations', activeOrgId, 'channels'));
    const unsub = onSnapshot(qChannels, snap => {
      setChannels(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    }, err => {
      reportLoadError('[useUnreadChatCount] channels', err);
    });
    return () => unsub();
  }, [activeOrgId, enabled]);

  return useMemo(() => {
    if (!readState || !currentUser) return 0;
    const uid = currentUser.id || currentUser.uid;
    return channels
      .filter(channel => isVisibleChatChannel(channel, uid))
      .reduce((total, channel) => total + channelUnreadCount(channel, readState[channel.id], uid), 0);
  }, [channels, currentUser, readState]);
}
