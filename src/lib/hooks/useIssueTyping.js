'use client';

// src/lib/hooks/useIssueTyping.js — «друкує…» for a task's chat.
//
// The mechanism is the workspace chat's, unchanged: a `typing` array of uids
// and a `typingAt` map of heartbeats beside it, read back through
// `activeTypingUserIds` so a crashed tab cannot leave somebody typing forever.
// Only the document differs.
//
// It is a document of its own — `issues/{issueId}/presence/typing` — rather
// than two fields on the task. The task itself is subscribed to by every board,
// every list and every card that shows it, so a heartbeat written there every
// three seconds would cost each of those a read; here it costs one read to the
// people who have the chat open, which is exactly who the indicator is for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { TYPING_REFRESH_MS } from '@/lib/utils/workspaceChat.mjs';

/**
 * Who is typing in this task's chat, and how to say that you are.
 *
 * @param {string} issueId The task.
 * @param {object} options
 * @param {string} options.userId The signed-in user, whose own flag is written here.
 * @param {boolean} options.active Whether the chat is actually on screen; nothing is subscribed or written while it is not.
 * @returns {{typingState: {typing?: string[], typingAt?: Record<string, number>}|null, setTyping: (isTyping: boolean) => void}}
 */
export function useIssueTyping(issueId, { userId, active = true } = {}) {
  // Carried with the task it came from, so opening another one reads as «nobody
  // is typing» during the render that opens it rather than briefly showing the
  // previous task's answer.
  const [received, setReceived] = useState(null);
  const typingState = received?.issueId === issueId ? received.data : null;
  const isTypingRef = useRef(false);
  const heartbeatRef = useRef(null);

  useEffect(() => {
    if (!issueId || !active) return undefined;
    // One document, so one read per change. Failures are silent on purpose: a
    // typing indicator is the last thing that should surface an error banner.
    const unsubscribe = onSnapshot(
      // Spelled out rather than hidden behind a helper: what a listener reads is
      // the first thing anybody auditing this file needs to see, and one
      // document is the whole answer here.
      doc(db, 'issues', issueId, 'presence', 'typing'),
      snapshot => setReceived({ issueId, data: snapshot.exists() ? snapshot.data() : null }),
      () => setReceived({ issueId, data: null }),
    );
    return () => unsubscribe();
  }, [active, issueId]);

  const write = useCallback(isTyping => {
    if (!issueId || !userId) return Promise.resolve();
    return setDoc(doc(db, 'issues', issueId, 'presence', 'typing'), {
      typing: isTyping ? arrayUnion(userId) : arrayRemove(userId),
      typingAt: { [userId]: isTyping ? Date.now() : 0 },
    }, { merge: true });
  }, [issueId, userId]);

  const setTyping = useCallback(isTyping => {
    if (!issueId || !userId) return;
    if (isTypingRef.current === isTyping) return;
    isTypingRef.current = isTyping;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    write(isTyping).catch(() => { isTypingRef.current = !isTyping; });
    if (!isTyping) return;
    // Refreshed while the flag stands, so a reader can treat an old stamp as a
    // tab that went away rather than as somebody typing a very long message.
    heartbeatRef.current = setInterval(() => {
      if (!isTypingRef.current) return;
      write(true).catch(() => {});
    }, TYPING_REFRESH_MS);
  }, [issueId, userId, write]);

  // Leaving the task, closing the pane or losing the tab clears the flag, so
  // «друкує…» does not outlive the person typing.
  useEffect(() => {
    if (!issueId || !userId) return undefined;
    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (!isTypingRef.current) return;
      isTypingRef.current = false;
      write(false).catch(() => {});
    };
  }, [issueId, userId, write]);

  return { typingState, setTyping };
}
