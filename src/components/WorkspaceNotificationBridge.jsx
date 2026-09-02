'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { useNotifications } from '@/lib/hooks/useNotifications';
import { useOrganizationUnreadCounts } from '@/lib/hooks/useOrganizationUnreadCounts';
import { isConversationOnScreen } from '@/lib/utils/notificationPresence.mjs';
import {
  emergencyRecordsToAlarm,
  readAlarmedIds,
  rememberAlarmed,
  writeAlarmedIds,
} from '@/lib/utils/emergencyAlarm.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';

// Synthesised locally instead of streamed from assets.mixkit.co. Pulling an
// alarm sound off a third-party CDN meant the emergency alert silently failed
// whenever that host was blocked, offline or slow — exactly the moments the
// alert matters most — and disclosed usage to an unrelated service.
function playEmergencyAlarm() {
  if (typeof window === 'undefined') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = () => {
      // Two-tone descending siren, twice.
      [0, 0.55].forEach(offset => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, ctx.currentTime + offset);
        osc.frequency.exponentialRampToValueAtTime(560, ctx.currentTime + offset + 0.42);
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.14, ctx.currentTime + offset + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + offset);
        osc.stop(ctx.currentTime + offset + 0.5);
      });
      window.setTimeout(() => { ctx.close().catch(() => {}); }, 1400);
    };
    if (ctx.state === 'suspended') ctx.resume().then(play).catch(() => ctx.close().catch(() => {}));
    else play();
  } catch { /* audio unavailable — the visual alert still fires */ }
}

export default function WorkspaceNotificationBridge() {
  // Той самий шлюз і з тієї самої причини, що в `IssueReadStateBridge`: цей
  // міст теж стоїть вище за гвард маршруту.
  const { currentUser, subscribableOrgId: activeOrgId } = useAppContext();
  const userId = currentUser?.id || currentUser?.uid;
  // Which emergencies this browser has already sounded — read from
  // localStorage on first use, so a reload does not sound them again.
  const alarmedIdsRef = useRef(null);
  const emergencyTimers = useRef(new Map());
  const showLiveNotif = useWorkspaceStore(state => state.showLiveNotif);
  const clearLiveNotif = useWorkspaceStore(state => state.clearLiveNotif);
  const holdLiveNotifs = useWorkspaceStore(state => state.holdLiveNotifs);
  const resumeLiveNotifs = useWorkspaceStore(state => state.resumeLiveNotifs);
  const setNotificationCenter = useWorkspaceStore(state => state.setNotificationCenter);
  const clearNotificationCenter = useWorkspaceStore(state => state.clearNotificationCenter);
  // Read off the store rather than subscribed to: which conversation is open
  // matters only at the instant a notification arrives, and re-subscribing this
  // callback to it would rebuild the whole notification stream every time the
  // reader switched panes.
  //
  // «Читач це бачить» — це відкрита розмова І вкладка попереду. Розмова,
  // відкрита в тлі, не є побаченою: так само в Slack повідомлення з каналу, що
  // в тебе відкритий, доходить, поки вікно неактивне, і мовчить, щойно ти в
  // ньому. Раніше умови вкладки тут не було, тож повідомлення, що прийшло, поки
  // ти в іншій вкладці, тихо зникало разом із карткою.
  const readerIsWatching = useCallback(notification => (
    typeof document !== 'undefined'
    && document.visibilityState === 'visible'
    && isConversationOnScreen(notification, useWorkspaceStore.getState().visibleConversation)
  ), []);
  // Одна відповідь на все, що з неї випливає: такий запис не дзвенить, не
  // спливає карткою і не лежить непрочитаним. Доти перевірка стояла всередині
  // `onNew`, тобто після дзвіночка: картку вона знімала, звук — ні; а гасила
  // записи сама сторінка звернення, за своїм списком типів і вже після того, як
  // лічильник блимнув.
  const notificationCenter = useNotifications(userId, {
    activeOrganizationId: activeOrgId,
    onNew: showLiveNotif,
    readerIsWatching,
  });
  // Розмова перед читачем змінилась: записи про те, що тепер на екрані, гаснуть
  // так само, як гасне запис, що приходить у відкриту розмову. Підписка тут, а
  // не в `readerIsWatching`: той читає стор у момент приходу запису і не має
  // перебудовувати потік сповіщень на кожне перемикання панелі.
  const visibleConversation = useWorkspaceStore(state => state.visibleConversation);
  const { settleVisible } = notificationCenter;
  useEffect(() => {
    settleVisible();
  }, [settleVisible, visibleConversation]);
  // Одне число, одне джерело: непрочитані сповіщення організації, які цей хук
  // публікує в стор. Поруч із ним колись стояв другий підрахунок —
  // курсори прочитаного корпоративного чату — і `||`, що обирав між ними за
  // ознакою «яке з них не нуль». Чату більше немає, а з ним і питання, яке з
  // двох чисел показувати.
  useOrganizationUnreadCounts();

  useEffect(() => {
    clearLiveNotif();
  }, [activeOrgId, clearLiveNotif]);

  // Six seconds is six seconds of somebody looking. A card that arrived while
  // the tab was in another window used to spend them there and be gone before
  // the reader came back, which is the one case the card exists for.
  //
  // Coming back is also when the records about the conversation left open are
  // read: nothing is read in a tab nobody is looking at, so they waited.
  useEffect(() => {
    const syncVisibility = () => {
      if (document.visibilityState === 'visible') resumeLiveNotifs();
      else holdLiveNotifs();
      if (document.visibilityState === 'visible') settleVisible();
    };
    document.addEventListener('visibilitychange', syncVisibility);
    return () => document.removeEventListener('visibilitychange', syncVisibility);
  }, [holdLiveNotifs, resumeLiveNotifs, settleVisible]);

  const actions = useMemo(() => ({
    markAllRead: notificationCenter.markAllRead,
    markRead: notificationCenter.markRead,
    markUnread: notificationCenter.markUnread,
    removeNotification: notificationCenter.removeNotification,
    clearRead: notificationCenter.clearRead,
  }), [
    notificationCenter.markAllRead,
    notificationCenter.markRead,
    notificationCenter.markUnread,
    notificationCenter.removeNotification,
    notificationCenter.clearRead,
  ]);

  useEffect(() => {
    setNotificationCenter(
      notificationCenter.notifications,
      notificationCenter.loading,
      actions,
      notificationCenter.windowFull,
    );
  }, [
    actions,
    notificationCenter.loading,
    notificationCenter.notifications,
    notificationCenter.windowFull,
    setNotificationCenter,
  ]);

  useEffect(() => {
    for (const [id, timers] of emergencyTimers.current.entries()) {
      const remainsUnread = notificationCenter.notifications.some(item =>
        item.id === id
        && item.type === 'emergency'
        && !item.read
        && item.organizationId === activeOrgId);
      if (!remainsUnread) {
        timers.forEach(window.clearTimeout);
        emergencyTimers.current.delete(id);
      }
    }

    // Sounds for what is new to this browser and still fresh — not for every
    // unread emergency on every page load, which is what a memory that lived
    // only in a ref amounted to. The rules are in lib/utils/emergencyAlarm.mjs.
    if (alarmedIdsRef.current === null) {
      alarmedIdsRef.current = readAlarmedIds(typeof window !== 'undefined' ? window.localStorage : null);
    }
    const sounding = emergencyRecordsToAlarm(notificationCenter.notifications, {
      organizationId: activeOrgId,
      alarmedIds: alarmedIdsRef.current,
    });
    if (!sounding.length) return;
    alarmedIdsRef.current = rememberAlarmed(alarmedIdsRef.current, sounding.map(item => item.id));
    writeAlarmedIds(typeof window !== 'undefined' ? window.localStorage : null, alarmedIdsRef.current);
    sounding.forEach(notification => {
      playEmergencyAlarm();
      emergencyTimers.current.set(notification.id, [
        window.setTimeout(playEmergencyAlarm, 3000),
        window.setTimeout(playEmergencyAlarm, 6000),
      ]);
    });
  }, [activeOrgId, notificationCenter.notifications]);

  useEffect(() => {
    const timersByNotification = emergencyTimers.current;
    return () => {
      for (const timers of timersByNotification.values()) timers.forEach(window.clearTimeout);
      timersByNotification.clear();
    };
  }, []);

  useEffect(() => () => clearNotificationCenter(), [clearNotificationCenter, userId]);

  return null;
}
