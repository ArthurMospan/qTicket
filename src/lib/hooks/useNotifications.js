'use client';

// src/lib/hooks/useNotifications.js
// Real-time notifications. Detects truly NEW docs and delivers them through
// channels the user controls in Налаштування → Сповіщення
// (users/{uid}/settings/notifications): sound, in-app popup and opt-in email.
// Also exposes list actions for the notification center.
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, where, orderBy, limit, onSnapshot, updateDoc, deleteDoc,
  doc, getDocs, writeBatch,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { CHANNEL_DEFAULTS } from '@/lib/utils/notificationChannels.mjs';
import { notificationGroupKey } from '@/lib/utils/notificationGrouping.mjs';
import { invalidateOrganizationUnreadCounts } from '@/lib/hooks/useOrganizationUnreadCounts';

// Live window kept in memory for the notification centre.
const PAGE_SIZE = 50;
// Firestore caps a batched write at 500 operations.
const WRITE_BATCH_LIMIT = 400;

// Скільки одна розмова мовчить після власного дзвіночка, і скільки мовчать усі
// разом.
//
// Дзвінок казав «у цій розмові щось нове». Восьме повідомлення за пів хвилини
// не каже нічого, чого не сказало перше, — а звучало воно рівно так само гучно,
// тож жвава розмова перетворювалась на кулемет. Так не робить жоден месенджер:
// звук позначає початок серії, а не кожен її елемент.
//
// Два вікна, бо це два різні надокучання. Одне — та сама розмова, що триває.
// Друге — кілька різних розмов, які збіглися в одну секунду.
const CHIME_CONVERSATION_MS = 10_000;
const CHIME_MIN_GAP_MS = 1_500;

// Soft two-tone chime via WebAudio — no external audio asset needed
function playChime() {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const note = (freq, at, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.09, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.05);
    };
    const schedule = () => {
      note(880, 0, 0.3);        // A5
      note(1174.66, 0.1, 0.35); // D6
      setTimeout(() => { ctx.close().catch(() => {}); }, 900);
    };
    if (ctx.state === 'suspended') {
      ctx.resume().then(schedule).catch(() => ctx.close().catch(() => {}));
    } else {
      schedule();
    }
  } catch { /* audio not available — silently skip */ }
}

// Re-exported for callers that already import it from here. The definition
// lives with the delivery rules in lib/utils/notificationChannels.mjs, which the
// settings page and both server senders read too.
export { CHANNEL_DEFAULTS };

export function useNotifications(userId, {
  activeOrganizationId,
  onNew,
  // Чи взагалі оголошувати цей запис — одна відповідь на всі канали оголошення
  // одразу. Раніше «не турбувати за розмову, яку я зараз читаю» знало лише
  // спливаюче вікно: перевірка жила в `onNew`, а дзвіночок стояв рядком вище й
  // до неї не доходив. Тому картки не було, а звук був — саме те, що чути на
  // сторінці завдання, поки в його чаті хтось пише.
  //
  // Запис у дзвоник це не скасовує: дзвоник — журнал, і в ньому подія має
  // лишитись. Мовчить тільки те, що перебиває.
  shouldAnnounce,
} = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const seenIds = useRef(new Set());
  const isFirstLoad = useRef(true);
  const prefsRef = useRef(CHANNEL_DEFAULTS);
  const activeOrganizationIdRef = useRef(activeOrganizationId);
  // Через ref, а не через залежності: підписка на сповіщення не має
  // перебудовуватись щоразу, коли читач перемкнув панель.
  const onNewRef = useRef(onNew);
  const shouldAnnounceRef = useRef(shouldAnnounce);
  // Коли востаннє дзвеніло взагалі, і коли — по кожній розмові окремо.
  const lastChimeAtRef = useRef(0);
  const conversationChimeAtRef = useRef(new Map());

  useEffect(() => {
    activeOrganizationIdRef.current = activeOrganizationId;
  }, [activeOrganizationId]);

  useEffect(() => {
    onNewRef.current = onNew;
    shouldAnnounceRef.current = shouldAnnounce;
  }, [onNew, shouldAnnounce]);

  // Live-follow the user's channel preferences so toggles apply instantly
  useEffect(() => {
    if (!userId) return;
    const unsub = onSnapshot(doc(db, 'users', userId, 'settings', 'notifications'), snap => {
      prefsRef.current = { ...CHANNEL_DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
    }, () => {});
    return () => unsub();
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    // A subscription identity is account + organization. Historical documents
    // in a newly selected scope populate the centre; they are not "new" events
    // and must not replay fifty old popups or sounds after a switch.
    seenIds.current = new Set();
    isFirstLoad.current = true;
    queueMicrotask(() => setLoading(true));
    // Scoped to the active organization. A user-only query let notifications
    // from other organizations consume the page limit and inflate the badge
    // for an organization the user is not even looking at.
    const q = activeOrganizationId
      ? query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        where('organizationId', '==', activeOrganizationId),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      )
      : query(
        collection(db, 'notifications'),
        where('userId', '==', userId),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE),
      );
    // Живе всередині ефекту, бо читає самі лише refs: додавати його в
    // залежності означало б ризикувати перебудовою підписки.
    const chimeAllowed = notification => {
      const now = Date.now();
      if (now - lastChimeAtRef.current < CHIME_MIN_GAP_MS) return false;
      const key = notificationGroupKey(notification);
      if (key) {
        const seen = conversationChimeAtRef.current;
        if (now - (seen.get(key) || 0) < CHIME_CONVERSATION_MS) return false;
        // Прибирання на місці: мапа не має рости на кожну розмову, яку людина
        // бачила за сесію.
        for (const [staleKey, at] of seen) {
          if (now - at >= CHIME_CONVERSATION_MS) seen.delete(staleKey);
        }
        seen.set(key, now);
      }
      lastChimeAtRef.current = now;
      return true;
    };
    const unsub = onSnapshot(q, snap => {
      const docs = snap.docs.map(d => ({
        ...d.data(),
        id: d.id,
      }))
        // `inapp: false` marks a document written purely as the cross-channel
        // dedupe claim for someone who wanted this event by email or Telegram
        // only. Filtered here rather than in the query: adding it as a `where`
        // would need a composite index and would hide every document written
        // before the field existed.
        .filter(n => n.inapp !== false)
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      if (isFirstLoad.current) {
        // On first load: just populate seenIds, don't fire popups
        isFirstLoad.current = false;
        docs.forEach(d => seenIds.current.add(d.id));
      } else {
        // On subsequent updates: detect new docs
        docs.forEach(n => {
          if (!seenIds.current.has(n.id)) {
            seenIds.current.add(n.id);
            if (n.organizationId !== activeOrganizationIdRef.current) return;
            // 0. Чи є про що оголошувати. Стоїть перед звуком, а не між звуком
            //    і карткою: подія, яку читач бачить на екрані просто зараз, не
            //    має ні дзвеніти, ні спливати.
            const announce = shouldAnnounceRef.current;
            if (typeof announce === 'function' && !announce(n)) return;
            const prefs = prefsRef.current;
            // 1. Sound chime — раз на серію, а не раз на повідомлення.
            if (prefs.sound !== false && n.type !== 'emergency' && chimeAllowed(n)) playChime();
            // 2. In-app popup callback (goes to store)
            if (prefs.popup !== false && onNewRef.current) onNewRef.current(n);
          }
        });
      }
      setNotifications(docs);
      setUnreadCount(docs.filter(n => !n.read).length);
      setLoading(false);
      invalidateOrganizationUnreadCounts();
    }, () => setLoading(false));
    return () => unsub();
    // `onNew` and `shouldAnnounce` are read through refs on purpose: the
    // subscription's identity is account + organization, and nothing else may
    // tear it down and rebuild it.
  }, [userId, activeOrganizationId]);

  // "Mark all read" / "clear read" used to operate on the loaded page only, so
  // with more unread items than the page size the button appeared to do
  // nothing for the rest. Both now walk every matching document in batches.
  const applyToAllMatching = useCallback(async (organizationId, matches, mutate) => {
    if (!userId) return;
    const constraints = [where('userId', '==', userId)];
    if (organizationId) constraints.push(where('organizationId', '==', organizationId));
    const snapshot = await getDocs(query(collection(db, 'notifications'), ...constraints));
    const targets = snapshot.docs.filter(matches);
    for (let index = 0; index < targets.length; index += WRITE_BATCH_LIMIT) {
      const batch = writeBatch(db);
      targets.slice(index, index + WRITE_BATCH_LIMIT).forEach(item => mutate(batch, item.ref));
      await batch.commit();
    }
  }, [userId]);

  const markAllRead = useCallback(async (organizationId = null) => {
    await applyToAllMatching(
      organizationId,
      item => item.data().read !== true,
      (batch, ref) => batch.update(ref, { read: true }),
    );
    invalidateOrganizationUnreadCounts();
  }, [applyToAllMatching]);

  const markRead = useCallback(async id => {
    await updateDoc(doc(db, 'notifications', id), {
      read: true
    });
    invalidateOrganizationUnreadCounts();
  }, []);

  const markUnread = useCallback(async id => {
    await updateDoc(doc(db, 'notifications', id), {
      read: false
    });
    invalidateOrganizationUnreadCounts();
  }, []);

  const removeNotification = useCallback(async id => {
    await deleteDoc(doc(db, 'notifications', id));
    invalidateOrganizationUnreadCounts();
  }, []);

  // Delete everything already read — keeps the center tidy
  const clearRead = useCallback(async (organizationId = null) => {
    await applyToAllMatching(
      organizationId,
      item => item.data().read === true,
      (batch, ref) => batch.delete(ref),
    );
    invalidateOrganizationUnreadCounts();
  }, [applyToAllMatching]);

  const markProjectRead = useCallback(async (projectId, organizationId = null) => {
    await applyToAllMatching(
      organizationId,
      item => item.data().read !== true && item.data().projectId === projectId,
      (batch, ref) => batch.update(ref, { read: true }),
    );
    invalidateOrganizationUnreadCounts();
  }, [applyToAllMatching]);

  return {
    notifications,
    unreadCount,
    loading,
    markAllRead,
    markRead,
    markUnread,
    removeNotification,
    clearRead,
    markProjectRead,
  };
}

// ── Send notification(s) to users ───────────────────────────────────

// Recipient preferences, actor identity, membership and email delivery are
// resolved server-side; callers never need access to another user's profile.
export async function sendNotification({
  userIds = [],
  type,
  title,
  body,
  link = '',
  issueId = '',
  projectId = '',
  organizationId = '',
  // Яку саме розмову це стосується. Маршрут читає це поле, чат передає його при
  // кожному виклику — а сюди воно доходило й тут зупинялося: підпис його не
  // приймав, тіло запиту його не несло. Тож у базу запис лягав без розмови, і
  // єдиним місцем, де вона взагалі згадувалась, лишалося посилання. Розбір
  // посилання рятував канали й не рятував нічого іншого.
  channelId = '',
  dedupeKey = '',
}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch('/api/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ userIds, type, title, body, link, issueId, projectId, organizationId, channelId, dedupeKey }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to send notification');
  return result;
}
