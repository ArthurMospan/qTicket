'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  collection, query, orderBy, onSnapshot, addDoc, deleteDoc,
  setDoc, doc, serverTimestamp, arrayUnion, writeBatch,
} from 'firebase/firestore';
import { getPortalDb } from '@/lib/portal/firebase';
import { unreadMessages } from '@/lib/portal/qtplusChatView.mjs';

/**
 * Real-time чат проєкту QuickTeam+ (Фаза 4b), читання І ЗАПИС у портальну БД.
 *
 * УВАГА — свідомий відступ від read-only решти інтеграції: цей хук ПИШЕ в портал
 * (надсилання повідомлень, typing, readBy, видалення своїх). Портальні правила це
 * прямо дозволяють (qt/firestore.rules): messages create — член команди І
 * senderId == auth.uid; update — член команди; delete — член команди І свій;
 * typing write — свій документ. Тому read-only гейт, що забороняє записи у файлах
 * з getPortalDb, має ВИНЯТОК саме тут (як qtplusProjectLink для воркспейс-БД).
 */

const TYPING_TTL_MS = 5000;

export function usePortalChat(qtProjectId, portalUser) {
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const uid = portalUser?.uid || null;

  // ── Повідомлення (real-time) ─────────────────────────────────────
  useEffect(() => {
    if (!qtProjectId || !uid) return undefined;
    const db = getPortalDb();
    if (!db) return undefined;

    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { setMessages(null); setError(null); } });

    const q = query(collection(db, 'projects', qtProjectId, 'messages'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      if (cancelled) return;
      setMessages(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      setError(null);
    }, (err) => {
      if (cancelled) return;
      if (err.code !== 'permission-denied') console.error('[qtplus] chat read failed:', err.message);
      setError(err.code === 'permission-denied' ? 'no_access' : 'read_failed');
    });

    return () => { cancelled = true; unsub(); };
  }, [qtProjectId, uid]);

  // ── Typing (real-time) ───────────────────────────────────────────
  useEffect(() => {
    if (!qtProjectId || !uid) return undefined;
    const db = getPortalDb();
    if (!db) return undefined;

    let cancelled = false;
    const unsub = onSnapshot(collection(db, 'projects', qtProjectId, 'typing'), (snap) => {
      if (cancelled) return;
      const now = Date.now();
      const list = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (d.id !== uid && data.isTyping && data.timestamp && now - data.timestamp < TYPING_TTL_MS) {
          list.push({ id: d.id, name: data.userName || 'Учасник' });
        }
      });
      setTypingUsers(list);
    }, () => { /* typing read errors are non-fatal */ });

    return () => { cancelled = true; unsub(); };
  }, [qtProjectId, uid]);

  // ── Надіслати повідомлення ───────────────────────────────────────
  const sendMessage = useCallback(async (text, senderName, avatarUrl) => {
    const body = (text || '').trim();
    if (!qtProjectId || !uid || !body) return;
    const db = getPortalDb();
    if (!db) return;
    await addDoc(collection(db, 'projects', qtProjectId, 'messages'), {
      senderId: uid, // правила порталу вимагають senderId == auth.uid
      role: 'user',
      text: body,
      senderName: senderName || 'Учасник',
      avatarUrl: avatarUrl || null,
      createdAt: serverTimestamp(),
      readBy: [uid],
    });
  }, [qtProjectId, uid]);

  // ── Статус набору тексту (best-effort) ───────────────────────────
  const setTyping = useCallback(async (isTyping, userName) => {
    if (!qtProjectId || !uid) return;
    const db = getPortalDb();
    if (!db) return;
    try {
      await setDoc(doc(db, 'projects', qtProjectId, 'typing', uid), {
        isTyping: Boolean(isTyping),
        userName: userName || 'Учасник',
        timestamp: Date.now(),
      });
    } catch { /* typing — необовʼязкове, помилку ковтаємо */ }
  }, [qtProjectId, uid]);

  // ── Позначити чужі непрочитані прочитаними ────────────────────────
  const markAllRead = useCallback(async (msgs) => {
    if (!qtProjectId || !uid) return;
    const db = getPortalDb();
    if (!db) return;
    const unread = unreadMessages(msgs, uid);
    if (!unread.length) return;
    try {
      const batch = writeBatch(db);
      unread.forEach((m) => batch.update(doc(db, 'projects', qtProjectId, 'messages', m.id), { readBy: arrayUnion(uid) }));
      await batch.commit();
    } catch { /* best-effort, не блокуємо перегляд */ }
  }, [qtProjectId, uid]);

  // ── Видалити СВОЄ повідомлення (правила порталу дозволяють лише своє) ──
  const deleteMessage = useCallback(async (messageId) => {
    if (!qtProjectId || !messageId) return;
    const db = getPortalDb();
    if (!db) return;
    try {
      await deleteDoc(doc(db, 'projects', qtProjectId, 'messages', messageId));
    } catch (e) {
      console.error('[qtplus] delete message failed:', e.message);
    }
  }, [qtProjectId]);

  const loading = Boolean(qtProjectId && uid) && messages === null && error === null;
  return { messages: messages || [], loading, error, typingUsers, sendMessage, setTyping, markAllRead, deleteMessage };
}
