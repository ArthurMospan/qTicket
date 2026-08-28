'use client';

// src/lib/hooks/useComments.js — Public replies and staff-only notes for an incident
import { useState, useEffect, useCallback, useMemo } from 'react';
import { arrayUnion, collection, deleteField, doc, getCountFromServer, limit, onSnapshot, orderBy, query, increment, runTransaction, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reportLoadError } from '@/lib/utils/errors';
import { liveDocumentData } from '@/lib/utils/firestoreDocument.mjs';
import { deleteFileFromCloudinary } from '@/lib/services/fileUpload';
// How much of a conversation opens with the task. The same reasoning as a chat
// channel: the newest page is what a reader arrives for, and the rest is loaded
// when they ask for it — a task discussed for a year must not cost its whole
// year every time somebody opens it.
// Як довго штамп активності проєкту вважається свіжим.
//
// Картку проєкту піднімає `project.updatedAt`, і питання, на яке вона
// відповідає, — «коли тут востаннє щось відбувалося». Хвилина туди-сюди на це
// питання не впливає, а один запис на кожну репліку в чаті впливає на щоденну
// стелю записів безкоштовного плану. Вікно перетворює сплеск розмови на один
// запис.
const PROJECT_ACTIVITY_STAMP_WINDOW_MS = 5 * 60 * 1000;

function projectActivityStampIsStale(stampedAt) {
  if (!stampedAt) return true;
  const millis = typeof stampedAt?.toMillis === 'function'
    ? stampedAt.toMillis()
    : typeof stampedAt?.seconds === 'number'
      ? stampedAt.seconds * 1000
      : Date.parse(stampedAt);
  if (!Number.isFinite(millis)) return true;
  return Date.now() - millis > PROJECT_ACTIVITY_STAMP_WINDOW_MS;
}

export const COMMENT_WINDOW = 60;

/**
 * The task's comments, oldest first — which is how they are read — over a
 * window of the newest ones, which is how they are fetched.
 *
 * @param {string} issueId The task.
 * @param {number} windowSize How many of the newest comments to subscribe to.
 */
export function useComments(issueId, windowSize = COMMENT_WINDOW, { includeInternal = false } = {}) {
  const [publicComments, setPublicComments] = useState([]);
  const [publicLoading, setPublicLoading] = useState(true);
  const [hasMorePublic, setHasMorePublic] = useState(false);
  const [internalNotes, setInternalNotes] = useState([]);
  const [internalLoading, setInternalLoading] = useState(includeInternal);
  const [hasMoreInternal, setHasMoreInternal] = useState(false);
  useEffect(() => {
    if (!issueId) {
      queueMicrotask(() => setPublicLoading(false));
      return undefined;
    }
    const conversationQuery = query(
      collection(db, 'issues', issueId, 'comments'),
      orderBy('createdAt', 'desc'),
      limit(windowSize),
    );
    const unsub = onSnapshot(conversationQuery, snap => {
      // Newest first out of the query, oldest first into the conversation.
      setPublicComments(snap.docs.map(item => ({
        ...liveDocumentData(item),
        visibility: 'public',
      })).reverse());
      setHasMorePublic(snap.size >= windowSize);
      setPublicLoading(false);
    }, err => {
      reportLoadError('[useComments]', err);
      setPublicLoading(false);
    });
    return () => unsub();
  }, [issueId, windowSize]);

  // Internal notes are a separate collection, not public comments carrying a
  // visibility flag. Firestore cannot hide individual fields or safely filter
  // legacy documents that predate such a flag, so collection separation is the
  // actual client/staff security boundary. A client never starts this query.
  useEffect(() => {
    if (!issueId || !includeInternal) {
      queueMicrotask(() => {
        setInternalNotes([]);
        setHasMoreInternal(false);
        setInternalLoading(false);
      });
      return undefined;
    }
    // Keep the loading transition out of the effect body: the subscription is
    // the external system this effect synchronizes with, and React's lint rule
    // deliberately rejects a synchronous render cascade here.
    queueMicrotask(() => setInternalLoading(true));
    const notesQuery = query(
      collection(db, 'issues', issueId, 'internalNotes'),
      orderBy('createdAt', 'desc'),
      limit(windowSize),
    );
    const unsub = onSnapshot(notesQuery, snap => {
      setInternalNotes(snap.docs.map(item => ({
        ...liveDocumentData(item),
        visibility: 'internal',
      })).reverse());
      setHasMoreInternal(snap.size >= windowSize);
      setInternalLoading(false);
    }, err => {
      reportLoadError('[useComments] internal notes', err);
      setInternalLoading(false);
    });
    return () => unsub();
  }, [includeInternal, issueId, windowSize]);

  const comments = useMemo(() => [...publicComments, ...internalNotes].sort(
    (left, right) => {
      const leftAt = left.createdAt?.toMillis?.() || left.createdAt?.seconds * 1000 || 0;
      const rightAt = right.createdAt?.toMillis?.() || right.createdAt?.seconds * 1000 || 0;
      return leftAt - rightAt;
    },
  ), [internalNotes, publicComments]);
  const loading = publicLoading || (includeInternal && internalLoading);
  const hasMore = hasMorePublic || (includeInternal && hasMoreInternal);

  // -------------------------------------------------------------------------
  // addComment
  // user: { uid, displayName, photoURL }
  //
  // Returns the id of the comment it wrote. The id is decided here, before the
  // write leaves the browser, which is what lets a screen draw the message
  // immediately and know which document in the next snapshot is the same one.
  // -------------------------------------------------------------------------
  const addComment = useCallback(async (issueId, text, user = {}, attachments = [], replyTo = null, options = {}) => {
    if (!text?.trim() && attachments.length === 0) throw new Error('Comment cannot be empty');
    const visibility = options.visibility === 'internal' ? 'internal' : 'public';
    const collectionName = visibility === 'internal' ? 'internalNotes' : 'comments';
    const commentRef = doc(collection(db, 'issues', issueId, collectionName));
    const issueRef = doc(db, 'issues', issueId);
    const authorId = user.uid || user.id || null;
    const existingCount = visibility === 'public'
      ? await getCountFromServer(collection(db, 'issues', issueId, 'comments'))
      : null;
    await runTransaction(db, async transaction => {
      const issueSnap = await transaction.get(issueRef);
      if (!issueSnap.exists()) throw new Error('Issue not found');
      transaction.set(commentRef, {
        authorId,
        authorName: user.name || user.displayName || user.email?.split('@')[0] || 'Невідомо',
        authorAvatar: user.avatar || user.photoURL || null,
        text: text?.trim() || '',
        attachments,
        visibility,
        // What the composer already resolved about the tasks this comment
        // names, so drawing them later costs nothing. See `collectIssueMentions`.
        issueMentions: Array.isArray(options.issueMentions) ? options.issueMentions : [],
        // The sender has read their own message — read receipts compare readBy
        // against everyone except the sender. Nothing else reads this array to
        // decide what is unread; that is the per-issue cursor's job.
        readBy: authorId ? [authorId] : [],
        replyTo: replyTo ? {
          id: replyTo.id,
          authorName: replyTo.authorName || '',
          text: replyTo.text || '',
        } : null,
        createdAt: serverTimestamp()
      });
      if (visibility === 'public') {
        transaction.update(issueRef, {
          commentCount: typeof issueSnap.data().commentCount === 'number'
            ? increment(1)
            : existingCount.data().count + 1,
          updatedAt: serverTimestamp(),
          lastActivityType: 'comment',
          lastActivityAt: serverTimestamp(),
          lastActivityActorId: authorId,
          lastActivityActorName: user.name || user.displayName || user.email?.split('@')[0] || 'Невідомо',
          lastActivityActorAvatar: user.avatar || user.photoURL || null,
          lastActivityText: text?.trim().slice(0, 240) || 'Вкладення',
          lastCommentAt: serverTimestamp(),
          lastCommentAuthorId: authorId,
          lastCommentMentionIds: options.mentionedUserIds || [],
          lastCommentReadBy: authorId ? [authorId] : [],
          // One tally per person, so a card can say "you were named three times"
          // instead of only "you were named in the last message" — which is all
          // `lastCommentMentionIds` can ever say, and the next message erases it.
          // Cleared for a reader in `markCommentsRead` below.
          ...Object.fromEntries(
            [...new Set(options.mentionedUserIds || [])]
              .filter(userId => userId && userId !== authorId)
              .map(userId => [`unreadMentions.${userId}`, increment(1)]),
          ),
        });
      }
    });
    // Розмова в задачі — це подія проєкту.
    //
    // Головний екран ставить першу картку великою і сортує проєкти за
    // `project.updatedAt`. Створення задачі, зміна статусу, архівування — усе це
    // пише документ проєкту (лічильники веде та сама операція), тож проєкт
    // піднімається. Коментар не чіпав нічого, окрім задачі, — і проєкт, у якому
    // щойно відбулася вся розмова, лишався там, де стояв учора.
    //
    // Один запис на повідомлення, і рівно те поле, яке правила дозволяють
    // учаснику організації торкнутися саме так: `hasOnly(['updatedAt'])`. Поза
    // транзакцією і без `await` — стрічка задачі не має чекати на порядок
    // карток, а невдача тут не робить надіслане повідомлення ненадісланим.
    //
    // І не частіше, ніж раз на кілька хвилин на проєкт. Порядок карток на
    // головному екрані — це «коли тут востаннє щось відбувалося», а не «о котрій
    // саме»: жвава розмова на сорок повідомлень і одна позначка дають ту саму
    // картку на тому самому місці. Свіжість штампа звіряється з копією проєкту,
    // яка вже лежить у памʼяті екрана, тож перевірка не коштує жодного читання —
    // а запис із неї виходить один на проєкт на вікно замість одного на репліку.
    if (visibility === 'public' && options.projectId && projectActivityStampIsStale(options.projectAt)) {
      updateDoc(doc(db, 'projects', options.projectId), { updatedAt: serverTimestamp() })
        .catch(error => reportLoadError('[useComments] project activity stamp', error));
    }
    return commentRef.id;
  }, []);

  const updateComment = useCallback(async (commentId, text, visibility = 'public') => {
    if (!issueId || !commentId || !text?.trim()) return;
    const collectionName = visibility === 'internal' ? 'internalNotes' : 'comments';
    await updateDoc(doc(db, 'issues', issueId, collectionName, commentId), {
      text: text.trim(),
      editedAt: serverTimestamp(),
    });
  }, [issueId]);

  const deleteComment = useCallback(async (commentId, attachments = [], visibility = 'public') => {
    if (!issueId || !commentId) return;
    const collectionName = visibility === 'internal' ? 'internalNotes' : 'comments';
    const commentRef = doc(db, 'issues', issueId, collectionName, commentId);
    const issueRef = doc(db, 'issues', issueId);
    await runTransaction(db, async transaction => {
      const issueSnap = await transaction.get(issueRef);
      transaction.delete(commentRef);
      if (visibility === 'public' && issueSnap.exists()) {
        transaction.update(issueRef, {
          commentCount: Math.max(0, (issueSnap.data().commentCount || 0) - 1),
          updatedAt: serverTimestamp(),
        });
      }
    });
    // Purge the message's files from Cloudinary so storage doesn't accumulate
    // orphans. Best-effort and after the doc is gone — a storage hiccup must
    // not resurrect a deleted message.
    await Promise.allSettled(
      (attachments || [])
        .filter(attachment => attachment?.storagePath)
        .map(attachment => deleteFileFromCloudinary(attachment.storagePath, attachment.resourceType))
    );
  }, [issueId]);

  // Read receipts, and only read receipts. Callers pass the few messages that
  // actually need a mark — `receiptMarkIds` picks the newest one from each other
  // author, and the receipt for everything older is read back out of it. Whether
  // a message is *unread* is answered by the per-issue cursor instead, so a
  // fifty-message conversation costs a couple of writes rather than fifty.
  //
  // Best-effort: a rules or permission hiccup must never break the chat.
  //
  // `readAt` records when, per reader, beside the array that records whether.
  // The ticks under a sent message could only ever say «прочитано», which is
  // the half of the question a sender is not asking. Written under the reader's
  // own id, so the two fields cannot disagree about who has read what.
  const markCommentsRead = useCallback(async (commentIds, userId) => {
    if (!issueId || !userId || !commentIds?.length) return;
    try {
      const batch = writeBatch(db);
      commentIds.slice(0, 400).forEach(commentId => {
        batch.update(doc(db, 'issues', issueId, 'comments', commentId), {
          readBy: arrayUnion(userId),
          [`readAt.${userId}`]: serverTimestamp(),
        });
      });
      batch.update(doc(db, 'issues', issueId), {
        lastCommentReadBy: arrayUnion(userId),
        // Reading the chat is what answers a mention, so the tally goes rather
        // than resetting to zero — an absent key costs nothing to store and
        // reads the same as a zero everywhere it is counted.
        [`unreadMentions.${userId}`]: deleteField(),
      });
      await batch.commit();
    } catch (error) {
      reportLoadError('[useComments] markRead', error);
    }
  }, [issueId]);

  return {
    comments,
    loading,
    hasMore,
    addComment,
    updateComment,
    deleteComment,
    markCommentsRead,
  };
}
