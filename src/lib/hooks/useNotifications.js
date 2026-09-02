'use client';

// src/lib/hooks/useNotifications.js
// Real-time notifications. Detects truly NEW docs and delivers them through
// channels the user controls in Налаштування → Сповіщення
// (users/{uid}/settings/notifications): sound, in-app popup and opt-in email.
// Also exposes list actions for the notification center.
//
// One rule about the conversation on screen, kept in one place. The server
// writes every record unread — it cannot see anybody's screen — and this hook
// is the one reader that can. So a record about the conversation in front of
// the reader is neither announced nor left unread: it is stamped read the
// instant it arrives, before anything draws it. Until this lived here, two
// places each kept a piece of that rule — the popup asked one question, the
// incident page marked two types read — and the counter lit up in the gap
// between the record landing and the page noticing it.
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  collection, query, where, orderBy, limit, onSnapshot, updateDoc, deleteDoc,
  doc, getDocs, writeBatch,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { CHANNEL_DEFAULTS } from '@/lib/utils/notificationChannels.mjs';
import { notificationGroupKey } from '@/lib/utils/notificationGrouping.mjs';
import { settleRecordsOnScreen } from '@/lib/utils/notificationPresence.mjs';
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

// Позначити прочитаними одразу кілька записів — одним пакетом на кожні чотириста,
// а не по запиту на запис.
async function markManyRead(ids) {
  for (let index = 0; index < ids.length; index += WRITE_BATCH_LIMIT) {
    const batch = writeBatch(db);
    ids.slice(index, index + WRITE_BATCH_LIMIT).forEach(id => {
      batch.update(doc(db, 'notifications', id), { read: true });
    });
    await batch.commit();
  }
}

// Re-exported for callers that already import it from here. The definition
// lives with the delivery rules in lib/utils/notificationChannels.mjs, which the
// settings page and both server senders read too.
export { CHANNEL_DEFAULTS };

export function useNotifications(userId, {
  activeOrganizationId,
  onNew,
  // Чи має читач зараз перед очима розмову, якої стосується запис. Одна
  // відповідь на все, що з цього випливає: такий запис не дзвенить, не спливає
  // карткою і не лежить непрочитаним — він гаситься тієї ж миті, як прийшов,
  // ще до того, як його щось намалює. Раніше «не турбувати за розмову, яку я
  // зараз читаю» знало лише спливаюче вікно, а гасила записи сама сторінка
  // звернення, за своїм списком типів і вже після того, як лічильник блимнув «+1».
  //
  // Запис у дзвоник це не скасовує: дзвоник — журнал, і в ньому подія має
  // лишитись. Прочитаною.
  readerIsWatching,
} = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // Чи повне вікно. Коли так, у дзвонику може бути непрочитане, якого вікно не
  // бачить, і число має брати сервер.
  const [windowFull, setWindowFull] = useState(false);
  const seenIds = useRef(new Set());
  const isFirstLoad = useRef(true);
  const prefsRef = useRef(CHANNEL_DEFAULTS);
  const activeOrganizationIdRef = useRef(activeOrganizationId);
  // Через ref, а не через залежності: підписка на сповіщення не має
  // перебудовуватись щоразу, коли читач перемкнув панель.
  const onNewRef = useRef(onNew);
  const readerIsWatchingRef = useRef(readerIsWatching);
  // Гасіння записів про розмову на екрані, як його бачить чинна підписка.
  // Міст кличе його, коли розмова перед читачем змінилась або вкладка повернулась.
  const settleVisibleRef = useRef(null);
  // Коли востаннє дзвеніло взагалі, і коли — по кожній розмові окремо.
  const lastChimeAtRef = useRef(0);
  const conversationChimeAtRef = useRef(new Map());

  useEffect(() => {
    activeOrganizationIdRef.current = activeOrganizationId;
  }, [activeOrganizationId]);

  useEffect(() => {
    onNewRef.current = onNew;
    readerIsWatchingRef.current = readerIsWatching;
  }, [onNew, readerIsWatching]);

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
    // Поточне вікно, щоб погасити записи про розмову, яку читач щойно відкрив,
    // не чекаючи наступного снапшоту.
    let currentDocs = [];
    // Записи, які вже пішли гаситись у базу. Відхилений запис повернеться
    // непрочитаним у наступному снапшоті — і без цієї мітки пішов би гаситись
    // знову, і так без кінця.
    const settledIds = new Set();
    // Усе, що нижче, живе всередині ефекту, бо читає самі лише refs і стани:
    // додавати його в залежності означало б ризикувати перебудовою підписки.
    const publish = (docs, full) => {
      currentDocs = docs;
      setNotifications(docs);
      setUnreadCount(docs.filter(n => !n.read).length);
      if (typeof full === 'boolean') setWindowFull(full);
    };
    // Гасить записи про розмову на екрані — і в пам'яті, і в базі. Повертає той
    // самий масив, якщо гасити нічого.
    const settleOnScreen = docs => {
      const watching = readerIsWatchingRef.current;
      if (typeof watching !== 'function') return docs;
      const { records, settledIds: ids } = settleRecordsOnScreen(
        docs,
        record => !settledIds.has(record.id) && watching(record),
      );
      if (ids.length) {
        ids.forEach(id => settledIds.add(id));
        markManyRead(ids)
          .then(() => invalidateOrganizationUnreadCounts())
          .catch(error => console.error('[useNotifications] settle on screen', error));
      }
      return records;
    };
    settleVisibleRef.current = () => {
      const settled = settleOnScreen(currentDocs);
      if (settled !== currentDocs) publish(settled);
    };
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
      const watching = readerIsWatchingRef.current;
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
            //    має ні дзвеніти, ні спливати — нижче вона ще й гаситься.
            if (typeof watching === 'function' && watching(n)) return;
            const prefs = prefsRef.current;
            // 1. Sound chime — раз на серію, а не раз на повідомлення.
            if (prefs.sound !== false && n.type !== 'emergency' && chimeAllowed(n)) playChime();
            // 2. In-app popup callback (goes to store)
            if (prefs.popup !== false && onNewRef.current) onNewRef.current(n);
          }
        });
      }
      // Що на екрані — прочитане, ще до того, як список намальовано. Тому
      // лічильник не блимає «+1» між приходом запису й тим, як сторінка його
      // помітить.
      publish(settleOnScreen(docs), snap.docs.length >= PAGE_SIZE);
      setLoading(false);
      invalidateOrganizationUnreadCounts();
    }, () => setLoading(false));
    return () => {
      settleVisibleRef.current = null;
      unsub();
    };
    // `onNew` and `readerIsWatching` are read through refs on purpose: the
    // subscription's identity is account + organization, and nothing else may
    // tear it down and rebuild it.
  }, [userId, activeOrganizationId]);

  // Розмова перед читачем змінилась або вкладка повернулась: записи про те, що
  // тепер на екрані, гаснуть так само, як гасне запис, що приходить у відкриту
  // розмову.
  const settleVisible = useCallback(() => {
    settleVisibleRef.current?.();
  }, []);

  // "Mark all read" / "clear read" used to operate on the loaded page only, so
  // with more unread items than the page size the button appeared to do
  // nothing for the rest. Both now walk every matching document in batches —
  // and only the matching ones: the query asks for the `read` value it is about
  // to change, on the index that already exists for it, instead of reading the
  // account's whole notification collection and filtering in the browser.
  const applyToAllMatching = useCallback(async (organizationId, read, mutate) => {
    if (!userId) return;
    const constraints = [where('userId', '==', userId), where('read', '==', read)];
    if (organizationId) constraints.push(where('organizationId', '==', organizationId));
    const snapshot = await getDocs(query(collection(db, 'notifications'), ...constraints));
    for (let index = 0; index < snapshot.docs.length; index += WRITE_BATCH_LIMIT) {
      const batch = writeBatch(db);
      snapshot.docs.slice(index, index + WRITE_BATCH_LIMIT).forEach(item => mutate(batch, item.ref));
      await batch.commit();
    }
  }, [userId]);

  const markAllRead = useCallback(async (organizationId = null) => {
    await applyToAllMatching(
      organizationId,
      false,
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
      true,
      (batch, ref) => batch.delete(ref),
    );
    invalidateOrganizationUnreadCounts();
  }, [applyToAllMatching]);

  return {
    notifications,
    unreadCount,
    windowFull,
    loading,
    settleVisible,
    markAllRead,
    markRead,
    markUnread,
    removeNotification,
    clearRead,
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
