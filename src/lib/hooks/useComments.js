'use client';

// src/lib/hooks/useComments.js — Internal comments for an issue (subcollection)
import { useState, useEffect, useCallback } from 'react';
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
export function useComments(issueId, windowSize = COMMENT_WINDOW) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  useEffect(() => {
    if (!issueId) {
      queueMicrotask(() => setLoading(false));
      return undefined;
    }
    const conversationQuery = query(
      collection(db, 'issues', issueId, 'comments'),
      orderBy('createdAt', 'desc'),
      limit(windowSize),
    );
    const unsub = onSnapshot(conversationQuery, snap => {
      // Newest first out of the query, oldest first into the conversation.
      setComments(snap.docs.map(liveDocumentData).reverse());
      setHasMore(snap.size >= windowSize);
      setLoading(false);
    }, err => {
      reportLoadError('[useComments]', err);
      setLoading(false);
    });
    return () => unsub();
  }, [issueId, windowSize]);

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
    const commentRef = doc(collection(db, 'issues', issueId, 'comments'));
    const issueRef = doc(db, 'issues', issueId);
    const authorId = user.uid || user.id || null;
    const existingCount = await getCountFromServer(collection(db, 'issues', issueId, 'comments'));
    await runTransaction(db, async transaction => {
      const issueSnap = await transaction.get(issueRef);
      if (!issueSnap.exists()) throw new Error('Issue not found');
      transaction.set(commentRef, {
        authorId,
        authorName: user.name || user.displayName || user.email?.split('@')[0] || 'Невідомо',
        authorAvatar: user.avatar || user.photoURL || null,
        text: text?.trim() || '',
        attachments,
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
    if (options.projectId && projectActivityStampIsStale(options.projectAt)) {
      updateDoc(doc(db, 'projects', options.projectId), { updatedAt: serverTimestamp() })
        .catch(error => reportLoadError('[useComments] project activity stamp', error));
    }
    return commentRef.id;
  }, []);

  const updateComment = useCallback(async (commentId, text) => {
    if (!issueId || !commentId || !text?.trim()) return;
    await updateDoc(doc(db, 'issues', issueId, 'comments', commentId), {
      text: text.trim(),
      editedAt: serverTimestamp(),
    });
  }, [issueId]);

  const deleteComment = useCallback(async (commentId, attachments = []) => {
    if (!issueId || !commentId) return;
    const commentRef = doc(db, 'issues', issueId, 'comments', commentId);
    const issueRef = doc(db, 'issues', issueId);
    await runTransaction(db, async transaction => {
      const issueSnap = await transaction.get(issueRef);
      transaction.delete(commentRef);
      if (issueSnap.exists()) {
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
