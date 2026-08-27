'use client';
// src/components/WorkspaceHeader.jsx — Smart contextual header with 5 modes
import { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useAppContext }    from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useSearch } from '@/lib/hooks/useSearch';
import useWorkspaceStore    from '@/store/useWorkspaceStore';
import UserAvatar           from '@/components/ui/DataDisplay/UserAvatar';
import UserStatusSetter     from '@/components/UserStatusSetter';
import SearchModal          from '@/components/SearchModal';
import TopHeader            from '@/components/ui/Layout/TopHeader';
import UserMenu             from '@/components/ui/Layout/UserMenu';
import NotificationBell     from '@/components/ui/Layout/NotificationBell';
import NotificationCard     from '@/components/ui/Layout/NotificationCard';
import Segmented            from '@/components/ui/Segmented';
import {
  Bell, Search, CakeSlice, Check, CheckCheck, GitPullRequest, Zap,
  UserCheck, AlertCircle, AtSign, CalendarClock, Settings, Trash2, Mail,
  ChevronRight, X, Hash, ArrowLeft,
} from 'lucide-react';
import { CalendarIcon, ChatIcon } from '@/lib/design/icons';
import Button from '@/components/ui/Button';
import IconAction from '@/components/ui/IconAction';
import { Counter, Dialog, Pill, ResponseChoice, TextAction } from '@/components/ui';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useRouter, usePathname } from 'next/navigation';
import { groupNotifications } from '@/lib/utils/notificationGrouping.mjs';
import { notificationDestinationWithOrganization, notificationOpenLabel } from '@/lib/utils/notificationNavigation.mjs';
import { GLOBAL_NOTIFICATION_Z_INDEX } from '@/lib/utils/overlayLayers.mjs';
import { useFloatingOverlay } from '@/lib/hooks/useFloatingOverlay';
import { auth, db } from '@/lib/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { reportLoadError } from '@/lib/utils/errors';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';
import {
  countWorkspaceSearchMatches,
  createProjectSearchScope,
} from '@/lib/utils/searchScope.mjs';

// Icon and colour only. Every entry used to carry a `label` as well, drawn in
// caps above the notification card's title — where it repeated, in the
// product's own vocabulary, what the title already said in a sentence. The
// type is now said by the card's button, which names the destination.
const TYPE_CFG = {
  assigned:       { icon: UserCheck,      color: '#6366f1' },
  commented:      { icon: ChatIcon,       color: '#0891b2' },
  status_changed: { icon: GitPullRequest, color: '#10b981' },
  mentioned:      { icon: AtSign,         color: '#f97316' },
  deadline:       { icon: CalendarClock,  color: '#d97706' },
  chat_message:   { icon: ChatIcon,       color: '#525252' },
  alert:          { icon: AlertCircle,    color: '#dc2626' },
  emergency:      { icon: Zap,            color: '#dc2626' },
  calendar_invite:{ icon: CalendarClock,  color: '#2563eb' },
  calendar_changed:{ icon: CalendarIcon,  color: '#525252' },
  calendar_reminder:{ icon: CalendarClock, color: '#111827' },
  birthday:       { icon: CakeSlice,      color: '#db2777' },
  test:           { icon: Bell,           color: '#6366f1' },
};

function timeAgo(ts) {
  if (!ts) return '';
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - date.getTime();
  if (diff < 60000) return 'Щойно';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} хв тому`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} год тому`;
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

// Day bucket for the notification list (Сьогодні / Вчора / Раніше)
function dayGroupLabel(ts) {
  if (!ts) return 'Раніше';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  if (d >= today) return 'Сьогодні';
  if (d >= yesterday) return 'Вчора';
  return 'Раніше';
}

// Actor avatar with a small type badge, or a plain type icon when no actor
function NotifIcon({ n, size = 28 }) {
  const cfg  = TYPE_CFG[n.type] || TYPE_CFG.assigned;
  const Icon = cfg.icon;
  // The face, on its own. There used to be a type badge stuck to the corner of
  // it, and the badge could not do the job it was there for: twelve types share
  // far fewer glyphs — a comment and a chat message carry the same one, and a
  // deadline, an invitation and a reminder carry the same calendar — so the
  // only thing separating them was an 18px disc of colour, two of which are
  // near-identical darks. It answered «one of the calendar three», and stopped.
  // The type is said in words now, by the button that opens it.
  if (n.actorName || n.actorAvatar) {
    return (
      <div className="shrink-0 mt-[1px]">
        <UserAvatar user={{ name: n.actorName, avatar: n.actorAvatar }} size={size} />
      </div>
    );
  }
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-[1px]"
      style={{ background: cfg.color + '15' }}>
      <Icon size={13} style={{ color: cfg.color }} />
    </div>
  );
}

// ── Detect header mode from pathname ────────────────────────────────
function CalendarResponseActions({
  notification,
  response,
  responding,
  onRespond,
  surface = 'surface',
}) {
  return (
    <ResponseChoice
      size="sm"
      surface={surface}
      value={response}
      disabled={responding}
      onChange={(value, event) => onRespond(notification, value, event)}
      className="mt-2"
    />
  );
}

function useHeaderMode(pathname, projects, breadcrumbs = []) {
  const EXCLUDED = ['my', 'team', 'analytics', 'calendar', 'chat', 'settings', 'sprints'];

  if (!pathname) return { mode: 'default', project: null };

  // Explicitly check for breadcrumbs first to support any custom/nested page breadcrumbs
  if (breadcrumbs && breadcrumbs.length > 0) {
    const projectMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)(\/|$)/);
    let project = null;
    if (projectMatch && !EXCLUDED.includes(projectMatch[1])) {
      const projectId = projectMatch[1];
      project = projects?.find(p => p.id === projectId) || null;
    }
    return { mode: 'breadcrumbs', project };
  }

  if (pathname === '/') {
    return { mode: 'search', project: null, placeholder: 'Пошук...' };
  }
  if (pathname.startsWith('/my')) {
    return { mode: 'search', project: null, placeholder: 'Пошук по моїх завданнях...' };
  }
  if (pathname.startsWith('/team')) {
    return { mode: 'search', project: null, placeholder: 'Пошук по команді...' };
  }
  if (pathname.startsWith('/sprints')) {
    return { mode: 'search', project: null, placeholder: 'Пошук по спринтах і завданнях...' };
  }
  if (pathname.startsWith('/chat')) {
    return { mode: 'chat', project: null };
  }
  if (pathname.startsWith('/analytics')) {
    return { mode: 'search', project: null, placeholder: 'Пошук в аналітиці...' };
  }
  if (pathname.startsWith('/calendar')) {
    return { mode: 'search', project: null, placeholder: 'Пошук у календарі...' };
  }
  if (pathname.startsWith('/settings')) {
    return { mode: 'minimal', label: 'Налаштування' };
  }

  // Project pages
  const projectMatch = pathname.match(/^\/([a-zA-Z0-9_-]+)(\/|$)/);
  if (projectMatch && !EXCLUDED.includes(projectMatch[1])) {
    const projectId = projectMatch[1];
    const isIssuePage = pathname.includes('/issue/');
    const project = projects?.find(p => p.id === projectId) || null;

    if (isIssuePage) {
      return { mode: 'breadcrumbs', project };
    }
    return { mode: 'project', project };
  }

  return { mode: 'search', project: null };
}

export function WorkspaceHeaderRight({ currentUser, signOut, mode }) {
  const router = useRouter();
  const { activeOrgId, allOrgs } = useAppContext();
  const liveNotifs = useWorkspaceStore(s => s.liveNotifs);
  const dismissLiveNotif = useWorkspaceStore(s => s.dismissLiveNotif);
  const clearLiveNotif = useWorkspaceStore(s => s.clearLiveNotif);
  const notifications = useWorkspaceStore(s => s.notifications);
  const notificationActions = useWorkspaceStore(s => s.notificationActions);
  const showToast = useWorkspaceStore(s => s.showToast);
  const markAllRead = notificationActions?.markAllRead;
  const markRead = notificationActions?.markRead;
  const markUnread = notificationActions?.markUnread;
  const removeNotification = notificationActions?.removeNotification;
  const clearRead = notificationActions?.clearRead;

  // A dropdown anchored to a 32px bell is a desktop idea. On a phone it opened
  // as a 380px card pinned under the top-right corner, with its own inner
  // scroller inside the page's — so the list was a letterbox you had to aim at,
  // and a tap anywhere near its edge dismissed it. Below md the same content is
  // the kit's sheet: full width, the page's own scroll, one obvious way out.
  const isMobile = useIsMobile();
  const [bellOpen, setBellOpen] = useState(false);
  const [notifFilter, setNotifFilter] = useState('all'); // 'all' | 'unread'
  const [userOpen, setUserOpen] = useState(false);
  const [calendarResponses, setCalendarResponses] = useState({});
  const [respondingNotificationId, setRespondingNotificationId] = useState('');
  const bellRef = useRef(null);
  const notificationPanelRef = useRef(null);
  const userRef = useRef(null);
  const notificationPanelPosition = useFloatingOverlay({
    open: bellOpen,
    anchorRef: bellRef,
    overlayRef: notificationPanelRef,
    preferredPlacement: 'bottom',
    align: 'end',
    gap: 8,
    padding: 8,
  });

  const scopedNotifications = notifications.filter(n => n.organizationId === activeOrgId);
  const unreadCount = scopedNotifications.filter(n => !n.read).length;
  const hasEmergency = scopedNotifications.some(n => n.type === 'emergency' && !n.read);
  const shownNotifications = notifFilter === 'unread'
    ? scopedNotifications.filter(n => !n.read)
    : scopedNotifications;
  const readCount = scopedNotifications.length - unreadCount;
  // Group by day, preserving the sorted order, and then collapse each day into
  // one row per conversation: three comments on one task are one line saying so,
  // not three identical lines pushing everything else out of the fifty the panel
  // holds. `groupNotifications` keeps a group at the position of its newest
  // record, so the day and the ordering are untouched.
  const notifGroups = [];
  shownNotifications.forEach(n => {
    const label = dayGroupLabel(n.createdAt);
    const last = notifGroups[notifGroups.length - 1];
    if (!last || last.label !== label) notifGroups.push({ label, items: [n] });
    else last.items.push(n);
  });
  const notifDays = notifGroups.map(group => ({
    label: group.label,
    rows: groupNotifications(group.items),
  }));

  useEffect(() => {
    const clickOut = e => {
      // The sheet is a modal with its own backdrop and its own escape hatch.
      // Click-away belongs to the anchored dropdown only — applied to the sheet
      // it closed on the first tap *inside* it, since the sheet is portalled
      // well outside the bell it hangs from.
      if (
        bellOpen
        && !isMobile
        && bellRef.current
        && !bellRef.current.contains(e.target)
        && !notificationPanelRef.current?.contains(e.target)
      ) setBellOpen(false);
      if (userOpen && userRef.current && !userRef.current.contains(e.target)) setUserOpen(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      if (bellOpen) {
        setBellOpen(false);
        bellRef.current?.querySelector('button')?.focus();
      }
      if (userOpen) setUserOpen(false);
    };
    document.addEventListener('mousedown', clickOut);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', clickOut);
      document.removeEventListener('keydown', escape);
    };
  }, [bellOpen, isMobile, userOpen]);

  // A row can stand for several records. Opening it answers all of them: they
  // are the same conversation, and the reader is now in it.
  const handleNotifClick = (row) => {
    const n = row.notification;
    if (n.organizationId && !allOrgs.some(org => org.id === n.organizationId)) {
      showToast('Ви більше не маєте доступу до організації цього сповіщення', 'error');
      return;
    }
    const link = notificationDestinationWithOrganization(n);
    if (!link) {
      showToast('Посилання у сповіщенні недійсне', 'error');
      return;
    }
    setBellOpen(false);
    clearLiveNotif();
    router.push(link);
    const unread = row.items.filter(item => !item.read);
    if (unread.length > 0) {
      Promise.allSettled(unread.map(item => markRead?.(item.id)))
        .then(results => {
          if (results.some(result => result.status === 'rejected')) {
            showToast('Не вдалося позначити сповіщення прочитаним', 'error');
          }
        });
    }
  };

  const handleMarkAllRead = () => {
    markAllRead?.(activeOrgId)
      .catch(() => showToast('Не вдалося оновити сповіщення', 'error'));
  };

  const handleCalendarResponse = async (notification, response, event) => {
    event?.stopPropagation();
    if (!notification.calendarEventId || respondingNotificationId) return;
    setRespondingNotificationId(notification.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Потрібно увійти знову');
      const result = await fetch(`/api/calendar/events/${encodeURIComponent(notification.calendarEventId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ response }),
      });
      const body = await result.json();
      if (!result.ok) throw new Error(body.error || 'Не вдалося зберегти відповідь');
      setCalendarResponses(previous => ({ ...previous, [notification.id]: response }));
      if (!notification.read) await markRead?.(notification.id);
      showToast(response === 'accepted' ? 'Участь підтверджено' : response === 'tentative' ? 'Відповідь «Можливо» збережено' : 'Відмову збережено', 'success');
    } catch (error) {
      showToast(error.message || 'Не вдалося відповісти на запрошення', 'error');
    } finally {
      setRespondingNotificationId('');
    }
  };

  const handleClearRead = () => {
    clearRead?.(activeOrgId)
      .catch(() => showToast('Не вдалося очистити сповіщення', 'error'));
  };

  // ── The centre's contents, drawn once ────────────────────────────────
  // Two shells wear them: the anchored dropdown on a desktop, the kit's sheet
  // on a phone. Only the shell differs, so only the shell is written twice.
  const notificationActionsRow = (
    <>
      {unreadCount > 0 && (
        <Button
          onClick={handleMarkAllRead}
          title="Позначити всі прочитаними"
          style="ghost"
          size="icon-sm"
          icon={CheckCheck}
          shape="compact"
          surface="canvas"
        />
      )}
      <Button
        onClick={() => {
          setBellOpen(false);
          navigateAfterOverlayClose(() => router.push('/settings?section=notifications'));
        }}
        title="Налаштування сповіщень"
        style="ghost"
        size="icon-sm"
        icon={Settings}
        shape="compact"
        surface="canvas"
      />
    </>
  );

  const notificationFilterRow = (
    <Segmented
      className="w-max"
      surface="canvas"
      value={notifFilter}
      onChange={setNotifFilter}
      options={[
        { value: 'all', label: 'Всі' },
        { value: 'unread', label: unreadCount > 0 ? `Непрочитані · ${unreadCount}` : 'Непрочитані' },
      ]}
    />
  );

  const notificationList = shownNotifications.length === 0 ? (
    <div className="flex flex-col items-center py-12">
      <Bell size={24} className="text-line mb-3" />
      <p className="text-[12px] text-faint">
        {notifFilter === 'unread' ? 'Все прочитано 👌' : 'Немає сповіщень'}
      </p>
    </div>
  ) : notifDays.map(group => (
    <div key={group.label}>
      <p className="px-4 pt-3 pb-1 text-[10px] font-bold text-faint uppercase tracking-wider">
        {group.label}
      </p>
      {group.rows.map(row => {
        const n = row.notification;
        return (
        <div key={row.id} onClick={() => handleNotifClick(row)}
          // The row carries its own dismiss button, so it is not
          // a `<button>` itself.
          role="button"
          tabIndex={0}
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handleNotifClick(row);
          }}
          className={`group relative w-full flex items-start gap-3 px-4 py-[10px] text-left cursor-pointer hover:bg-canvas transition-colors ${
            n.type === 'emergency' && !n.read ? 'bg-danger-soft' : !n.read ? 'bg-info-soft' : ''
          }`}>
          <NotifIcon n={n} />
          {/* The two row actions are pinned to the right edge — always visible
              on a phone, on hover on a desktop — so the text column reserves
              their width instead of running underneath them. */}
          <div className="flex-1 min-w-0 pr-[48px]">
            <p className={`text-[12px] leading-snug ${!n.read ? 'font-semibold text-ink' : 'text-ink'}`}>
              {row.title}
            </p>
            {n.body && <p className="text-[11px] text-muted mt-[2px] line-clamp-2">{n.body}</p>}
            {n.type === 'calendar_invite' && n.calendarEventId && (
              <CalendarResponseActions
                notification={n}
                response={calendarResponses[n.id]}
                responding={respondingNotificationId === n.id}
                onRespond={handleCalendarResponse}
              />
            )}
            <p className="text-[10px] text-faint mt-[3px] flex items-center gap-1">
              <span>{timeAgo(n.createdAt)}</span>
            </p>
          </div>
          {!n.read && (
            <span className="w-[6px] h-[6px] bg-ink rounded-full shrink-0 mt-2 group-hover:opacity-0 transition-opacity" />
          )}
          {/* Hover actions */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100">
            <IconAction
              label={n.read ? 'Позначити непрочитаним' : 'Позначити прочитаним'}
              onClick={e => {
                e.stopPropagation();
                // The whole row, not its newest record: a row that half changed
                // would split into two the moment it redrew.
                const action = n.read ? markUnread : markRead;
                Promise.allSettled(row.items.map(item => action?.(item.id)))
                  .then(results => {
                    if (results.some(result => result.status === 'rejected')) {
                      showToast('Не вдалося оновити сповіщення', 'error');
                    }
                  });
              }}
              icon={n.read ? Mail : Check}
              size="xs"
              appearance="surface"
            />
            <IconAction
              label="Видалити"
              onClick={e => {
                e.stopPropagation();
                Promise.allSettled(row.items.map(item => removeNotification?.(item.id)))
                  .then(results => {
                    if (results.some(result => result.status === 'rejected')) {
                      showToast('Не вдалося видалити сповіщення', 'error');
                    }
                  });
              }}
              icon={Trash2}
              size="xs"
              appearance="surface-danger"
            />
          </div>
        </div>
        );
      })}
    </div>
  ));

  const notificationFooter = scopedNotifications.length > 0 ? (
    <>
      <TextAction
        tone="danger-quiet"
        size="sm"
        onClick={handleClearRead}
        disabled={readCount === 0}
      >
        Очистити прочитані{readCount > 0 ? ` (${readCount})` : ''}
      </TextAction>
      <span className="text-[10px] text-faint">останні {scopedNotifications.length}</span>
    </>
  ) : null;

  return (
    <>
      <div className="ml-2 flex shrink-0 items-center gap-[6px] z-50 sm:ml-4">
        {/* ── Bell ──────────────────────── */}
        {mode !== 'chat' && (
          <div className="relative" ref={bellRef}>
            <NotificationBell
              unreadCount={unreadCount}
              hasEmergency={hasEmergency}
              open={bellOpen}
              onToggle={() => { setBellOpen(o => !o); setUserOpen(false); }}
            />

          {bellOpen && isMobile && (
            <Dialog
              isOpen
              onClose={() => setBellOpen(false)}
              title="Сповіщення"
              description={unreadCount > 0 ? `${unreadCount} нових` : null}
              size="sm"
              bodyPadding="flush"
              headerAction={notificationActionsRow}
              footer={notificationFooter ? (
                <div className="flex w-full items-center justify-between">{notificationFooter}</div>
              ) : null}
            >
              <div className="px-4 pt-[10px] pb-2">{notificationFilterRow}</div>
              {notificationList}
            </Dialog>
          )}

          {bellOpen && !isMobile && typeof document !== 'undefined' && createPortal(
            <div
              ref={notificationPanelRef}
              id="notification-center-panel"
              role="dialog"
              aria-label="Центр сповіщень"
              data-qt-global-notification-layer
              data-ui-surface="local" className="fixed w-[min(380px,calc(100vw-16px))] overflow-hidden rounded-[16px] border border-line bg-white shadow-[0_8px_40px_rgba(0,0,0,0.10)]"
              style={{
                top: notificationPanelPosition.top,
                left: notificationPanelPosition.left,
                visibility: notificationPanelPosition.ready ? 'visible' : 'hidden',
                zIndex: GLOBAL_NOTIFICATION_Z_INDEX,
              }}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-canvas">
                <div className="flex items-center gap-2">
                  <h3 className="ui-type-card-title text-ink">Сповіщення</h3>
                  {unreadCount > 0 && (
                    <Pill tone="ink-subtle" size="sm">{unreadCount} нових</Pill>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {notificationActionsRow}
                </div>
              </div>

              {/* Filter */}
              <div className="px-4 pt-[10px] pb-2">
                {notificationFilterRow}
              </div>

              {/* List */}
              <div className="max-h-[400px] overflow-y-auto">
                {notificationList}
              </div>

              {/* Footer */}
              {notificationFooter && (
                <div className="flex items-center justify-between px-4 py-[10px] border-t border-canvas bg-canvas">
                  {notificationFooter}
                </div>
              )}
            </div>,
            document.body,
          )}
        </div>
        )}

        {/* ── Status dot (Chat mode only) ── */}
        {mode === 'chat' && (
          <UserStatusSetter />
        )}

        {/* ── User avatar ───────────────── */}
        <div ref={userRef}>
          <UserMenu
            user={currentUser}
            open={userOpen}
            onToggle={() => { setUserOpen(o => !o); setBellOpen(false); }}
            onSettings={() => { router.push('/settings'); setUserOpen(false); }}
            onSignOut={() => signOut()}
          />
        </div>
      </div>

      {/* ─── Live notification cards ────────────────────────────────────
          A stack rather than a slot. The corner used to hold exactly one card,
          so a burst of notifications was one card and a flicker; up to three
          stand here now, oldest at the top, the newest one nearest the corner
          where the eye already is. The stack owns the placement — the card
          itself is just a card. */}
      {liveNotifs.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          data-qt-global-notification-layer
          className="fixed bottom-[72px] right-[12px] flex flex-col items-end gap-2 md:bottom-5 md:right-[24px]"
          style={{ zIndex: GLOBAL_NOTIFICATION_Z_INDEX }}
        >
          {liveNotifs.map(card => (
            <NotificationCard
              key={card.id}
              icon={<NotifIcon n={card} size={32} />}
              title={card.title}
              body={card.body}
              time={timeAgo(card.createdAt)}
              tone={card.type === 'emergency' ? 'emergency' : 'default'}
              actions={card.type === 'calendar_invite' && card.calendarEventId ? (
                <CalendarResponseActions
                  notification={card}
                  response={calendarResponses[card.id]}
                  responding={respondingNotificationId === card.id}
                  onRespond={handleCalendarResponse}
                  surface="canvas"
                />
              ) : null}
              openLabel={notificationOpenLabel(card)}
              onOpen={card.link ? () => handleNotifClick(card) : undefined}
              onDismiss={() => dismissLiveNotif(card.id)}
              style={{ animation: 'slideUpIn 0.3s cubic-bezier(0.16,1,0.3,1)' }}
            />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export default function WorkspaceHeader() {
  const { currentUser, signOut, projects, activeOrgId } = useAppContext();
  const { members: organizationMembers } = useOrganization();

  const breadcrumbs    = useWorkspaceStore(s => s.breadcrumbs);
  const chatSearch     = useWorkspaceStore(s => s.chatSearch);
  const setChatSearch  = useWorkspaceStore(s => s.setChatSearch);
  const teamSearch     = useWorkspaceStore(s => s.teamSearch);
  const setTeamSearch  = useWorkspaceStore(s => s.setTeamSearch);
  const workspaceSearch = useWorkspaceStore(s => s.workspaceSearch);
  const setWorkspaceSearch = useWorkspaceStore(s => s.setWorkspaceSearch);
  const myTaskSearch = useWorkspaceStore(s => s.myTaskSearch);
  const setMyTaskSearch = useWorkspaceStore(s => s.setMyTaskSearch);
  const projectSearchQuery = useWorkspaceStore(s => s.projectSearch);
  const setProjectSearchQuery = useWorkspaceStore(s => s.setProjectSearch);
  const sprintSearch = useWorkspaceStore(s => s.sprintSearch);
  const setSprintSearch = useWorkspaceStore(s => s.setSprintSearch);
  const analyticsSearch = useWorkspaceStore(s => s.analyticsSearch);
  const setAnalyticsSearch = useWorkspaceStore(s => s.setAnalyticsSearch);
  const calendarSearch = useWorkspaceStore(s => s.calendarSearch);
  const setCalendarSearch = useWorkspaceStore(s => s.setCalendarSearch);
  const chatOnlineUsers = useWorkspaceStore(s => s.chatOnlineUsers);
  const localSearchFeedback = useWorkspaceStore(s => s.localSearchFeedback);
  const openCommandPalette = useWorkspaceStore(s => s.openCommandPalette);

  const router   = useRouter();
  const pathname = usePathname();
  const { mode, project, placeholder, label } = useHeaderMode(pathname, projects, breadcrumbs);

  const [projectSearch,   setProjectSearch]   = useState(false); // inline search toggle for project mode
  const [globalQuery,     setGlobalQuery]     = useState('');
  const [showSearch,      setShowSearch]      = useState(false);

  const {
    results: searchResults,
    matches: searchMatches,
    loading: searchLoading,
    search,
    clear: clearSearch,
  } = useSearch();

  // A search belongs to the page where it was entered. Clear every contextual
  // query on navigation so text from Chat/Team/Analytics never leaks into the
  // next screen and silently filters unrelated content.
  useEffect(() => {
    queueMicrotask(() => {
      setProjectSearch(false);
      setProjectSearchQuery('');
      setChatSearch('');
      setTeamSearch('');
      setWorkspaceSearch('');
      setMyTaskSearch('');
      setSprintSearch('');
      setAnalyticsSearch('');
      setCalendarSearch('');
      setGlobalQuery('');
      setShowSearch(false);
    });
  }, [
    pathname,
    setAnalyticsSearch,
    setCalendarSearch,
    setChatSearch,
    setMyTaskSearch,
    setProjectSearchQuery,
    setSprintSearch,
    setTeamSearch,
    setWorkspaceSearch,
  ]);

  const contextualSearchValue = projectSearch
    ? projectSearchQuery
    : mode === 'chat'
      ? chatSearch
      : pathname.startsWith('/team')
        ? teamSearch
        : pathname.startsWith('/my')
          ? myTaskSearch
          : pathname.startsWith('/sprints')
            ? sprintSearch
            : pathname.startsWith('/analytics')
              ? analyticsSearch
              : pathname.startsWith('/calendar')
                ? calendarSearch
              : pathname === '/'
                ? workspaceSearch
                : globalQuery;

  const isContextualSearch = projectSearch
    || mode === 'chat'
    || pathname === '/'
    || pathname.startsWith('/team')
    || pathname.startsWith('/my')
    || pathname.startsWith('/sprints')
    || pathname.startsWith('/analytics')
    || pathname.startsWith('/calendar');
  const searchScope = useMemo(
    () => (projectSearch && project ? createProjectSearchScope(project) : null),
    [project, projectSearch],
  );
  const localResultCount = localSearchFeedback?.pathname === pathname
    && localSearchFeedback.query === contextualSearchValue
    ? localSearchFeedback.count
    : null;
  const outsideResultCount = countWorkspaceSearchMatches({
    issues: searchResults,
    matches: searchMatches,
  });

  // A broad search is a collection scan today. It is needed for the empty
  // local-state count, but not for the permanently visible "search everywhere"
  // row — clicking that row lets the palette perform its own request.
  useEffect(() => {
    if (!isContextualSearch) return;
    const term = contextualSearchValue.trim();
    if (term.length < 2 || localResultCount !== 0 || !activeOrgId) {
      clearSearch();
      return;
    }
    search(term, activeOrgId, searchScope);
  }, [
    activeOrgId,
    clearSearch,
    contextualSearchValue,
    isContextualSearch,
    localResultCount,
    search,
    searchScope,
  ]);

  return (
    <>
      <TopHeader
        mode={mode}
        hideBorder={true}
        searchValue={contextualSearchValue}
        searchPlaceholder={placeholder}
        onSearchChange={async (q) => {
          if (projectSearch) {
            setProjectSearchQuery(q);
          } else if (mode === 'chat') {
            setChatSearch(q);
          } else if (pathname.startsWith('/team')) {
            setTeamSearch(q);
          } else if (pathname.startsWith('/my')) {
            setMyTaskSearch(q);
          } else if (pathname.startsWith('/sprints')) {
            setSprintSearch(q);
          } else if (pathname.startsWith('/analytics')) {
            setAnalyticsSearch(q);
          } else if (pathname.startsWith('/calendar')) {
            setCalendarSearch(q);
          } else if (pathname === '/') {
            setWorkspaceSearch(q);
          } else {
            setGlobalQuery(q);
            if (q.trim() && activeOrgId) {
              setShowSearch(true);
              await search(q, activeOrgId);
            } else {
              setShowSearch(false);
            }
          }
        }}
        onSearchClear={() => {
          if (projectSearch) {
            setProjectSearchQuery('');
            setProjectSearch(false);
          } else if (mode === 'chat') {
            setChatSearch('');
          } else if (pathname.startsWith('/team')) {
            setTeamSearch('');
          } else if (pathname.startsWith('/my')) {
            setMyTaskSearch('');
          } else if (pathname.startsWith('/sprints')) {
            setSprintSearch('');
          } else if (pathname.startsWith('/analytics')) {
            setAnalyticsSearch('');
          } else if (pathname.startsWith('/calendar')) {
            setCalendarSearch('');
          } else if (pathname === '/') {
            setWorkspaceSearch('');
          } else {
            setGlobalQuery('');
            setShowSearch(false);
          }
        }}
        onSearchEscalate={(query) => openCommandPalette({ query, scope: searchScope })}
        searchLocalResultCount={localResultCount}
        searchOutsideResultCount={outsideResultCount}
        searchOutsideLoading={searchLoading}
        projectName={project?.name}
        projectSearchActive={projectSearch}
        onProjectSearchToggle={() => setProjectSearch(true)}
        breadcrumbs={breadcrumbs}
        onlineUsers={chatOnlineUsers}
        onOnlineUserClick={user => router.push(`/chat?dm=${encodeURIComponent(user.id || user.uid)}`)}
        rightContent={<WorkspaceHeaderRight currentUser={currentUser} signOut={signOut} mode={mode} />}
      />

      {/* ─── Search Modal ────────────────────────────────────────────── */}
      <SearchModal
        isOpen={showSearch}
        results={searchResults}
        loading={searchLoading}
        query={globalQuery}
        onClose={() => setShowSearch(false)}
        projects={projects}
      />
    </>
  );
}
