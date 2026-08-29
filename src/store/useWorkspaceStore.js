// src/store/useWorkspaceStore.js
import { create } from 'zustand';
import {
  notificationCountTitle,
  notificationGroupKey,
} from '@/lib/utils/notificationGrouping.mjs';

// How long one live notification card stands, and how many stand at once.
const LIVE_NOTIF_MS = 6000;
const LIVE_NOTIF_LIMIT = 3;

// Every card's own countdown, kept beside the state rather than in it: a timer
// handle is not something the screen draws. `remaining` is what is left of the
// six seconds, so a card can be stopped and started again — which is what a tab
// going into the background and coming back does to it.
//
// The store is a module singleton, and so is this.
const liveNotifTimers = new Map();

function stopLiveNotifTimer(id) {
  const entry = liveNotifTimers.get(id);
  if (!entry) return;
  if (entry.handle) clearTimeout(entry.handle);
  liveNotifTimers.delete(id);
}

function runLiveNotifTimer(id, expire) {
  const entry = liveNotifTimers.get(id);
  if (!entry || entry.handle) return;
  entry.startedAt = Date.now();
  entry.handle = setTimeout(() => expire(id), entry.remaining);
}

function holdLiveNotifTimer(id) {
  const entry = liveNotifTimers.get(id);
  if (!entry?.handle) return;
  clearTimeout(entry.handle);
  entry.handle = null;
  entry.remaining = Math.max(400, entry.remaining - (Date.now() - entry.startedAt));
}

// A card that arrives in a tab nobody is looking at waits there instead of
// burning its six seconds unseen — the whole point of the card is to be read.
function tabIsVisible() {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

const useWorkspaceStore = create((set, get) => ({

  // ── Quick view ────────────────────────────────────────────────────
  // An incident, read without leaving the screen that named it.
  //
  // The panel itself already existed — `IssueModal` over `IssueDetail` — and
  // exactly one screen opened it, while every other place that names an
  // incident navigated away and made you come back: the two lists on a
  // profile. Holding the choice here rather than in each of those
  // screens is what makes it one panel instead of six copies of the same state.
  //
  // Not in the address, unlike the profile overlay: this opens from an object
  // the screen already has in hand, and reconstructing an incident from an id
  // in a query string would mean a fresh read on every screen that can open one.
  // `Відкрити на повній сторінці` inside the panel is the shareable path.
  quickView: null, // { kind: 'issue', record }

  openIssueQuickView: issue => {
    if (issue?.id) set({ quickView: { kind: 'issue', record: issue } });
  },
  closeQuickView: () => set({ quickView: null }),

  // ── Toast ─────────────────────────────────────────────────────────
  toast: null,
  _toastTimer: null,
  showToast: (message, type = 'success', options = {}) => {
    // Date.now() collides when two toasts fire in the same millisecond, which
    // let the first one's timer dismiss the second. A counter cannot collide,
    // and the pending timer is cancelled so each toast gets its full duration.
    const id = (get()._toastSeq || 0) + 1;
    const previousTimer = get()._toastTimer;
    if (previousTimer) clearTimeout(previousTimer);
    // A confirmation is read at a glance and can go; a failure has to be read,
    // and often decided about — «повідомити про це?» — which nobody manages in
    // three and a half seconds. Same toast, two different jobs.
    const duration = options.duration
      || (type === 'error' ? 9000 : type === 'warning' ? 6000 : 3500);
    const timer = setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null, _toastTimer: null });
    }, duration);
    set({
      toast: {
        message,
        type,
        id,
        action: options.action,
        // What the reporter would send. The message alone is what the user was
        // shown; `detail` is what actually happened, and only a failure has one.
        detail: options.detail || null,
        context: options.context || '',
      },
      _toastSeq: id,
      _toastTimer: timer,
    });
  },
  clearToast: () => {
    const timer = get()._toastTimer;
    if (timer) clearTimeout(timer);
    set({ toast: null, _toastTimer: null });
  },

  // ── Live notification cards (real-time) ───────────────────────────
  //
  // A stack, not a slot. One card used to stand in for all of them: each
  // arrival replaced whatever was on screen and reset the six seconds, so three
  // comments in ten seconds were one card and two flashes. Up to
  // LIVE_NOTIF_LIMIT stand at once — oldest first, newest nearest the corner —
  // and each burns its own six seconds, paused while the tab is in the
  // background.
  // Одна розмова — одна картка, скільки б у ній не написали.
  //
  // Стек виправив «одна картка на все» і приніс протилежну крайність: жвава
  // розмова, у якій ти зараз не сидиш, займала весь стек собою — три однакові
  // «Х написав у завданні», що виштовхували одне одного, поки людина друкує.
  // Розмова, у якій щойно з'явилось восьме повідомлення, — це не вісім новин, а
  // одна новина з числом; так її вже показує дзвоник, і тим самим реченням.
  // Картка стоїть на місці, переписує на собі лічильник і починає свої шість
  // секунд наново з кожним повідомленням — тобто зникає через шість секунд
  // після останнього, а не після першого.
  liveNotifs: [],   // [{ id, groupKey, count, title, body, type, link }], oldest first
  showLiveNotif: (notif) => {
    if (!notif?.id) return;
    const expire = get().dismissLiveNotif;
    // Порожній ключ означає «ця подія не повторюється» — призначення, дедлайн,
    // подія календаря. Така картка групується сама з собою, тобто ні з чим.
    const conversationKey = notificationGroupKey(notif);
    const groupKey = conversationKey || `id:${notif.id}`;
    let supersededId = null;
    set(state => {
      const existing = state.liveNotifs.find(card => card.groupKey === groupKey);
      // The same notification twice is one card and not a second message: the
      // record is re-announced whenever the stream re-delivers it.
      const count = !existing ? 1 : existing.id === notif.id ? existing.count : existing.count + 1;
      if (existing && existing.id !== notif.id) supersededId = existing.id;
      const card = {
        ...notif,
        groupKey,
        count,
        title: conversationKey && count > 1
          ? notificationCountTitle(count, notif, conversationKey)
          : notif.title,
      };
      const kept = state.liveNotifs.filter(item => item.groupKey !== groupKey);
      const next = [...kept, card].slice(-LIVE_NOTIF_LIMIT);
      // A card pushed off the bottom of the stack takes its countdown with it.
      state.liveNotifs
        .filter(item => !next.some(candidate => candidate.id === item.id))
        .forEach(item => stopLiveNotifTimer(item.id));
      return { liveNotifs: next };
    });
    // Картка лишилась та сама, запис під нею — новіший, тож відлік старого
    // запису більше нічому не належить.
    if (supersededId) stopLiveNotifTimer(supersededId);
    stopLiveNotifTimer(notif.id);
    liveNotifTimers.set(notif.id, { handle: null, remaining: LIVE_NOTIF_MS, startedAt: 0 });
    if (tabIsVisible()) runLiveNotifTimer(notif.id, expire);
  },
  dismissLiveNotif: (id) => {
    stopLiveNotifTimer(id);
    set(state => ({ liveNotifs: state.liveNotifs.filter(card => card.id !== id) }));
  },
  // Nothing is counted down in a tab nobody is looking at; the reader comes back
  // to what arrived while they were away, not to an empty corner.
  holdLiveNotifs: () => {
    get().liveNotifs.forEach(card => holdLiveNotifTimer(card.id));
  },
  resumeLiveNotifs: () => {
    const expire = get().dismissLiveNotif;
    get().liveNotifs.forEach(card => runLiveNotifTimer(card.id, expire));
  },
  clearLiveNotif: () => {
    get().liveNotifs.forEach(card => stopLiveNotifTimer(card.id));
    set({ liveNotifs: [] });
  },

  // Which conversation the reader currently has in front of them, published by
  // whichever pane is showing it: `{ kind: 'issue', id }`. The live popup reads
  // it and stays down for a message that arrived on the very screen it would
  // have covered — announcing what somebody is already reading is noise, and on
  // an incident page it landed on top of the conversation itself.
  //
  // Cleared against the target that registered it, so a pane unmounting after
  // the next one has already registered does not wipe the newer answer.
  visibleConversation: null,
  setVisibleConversation: (conversation) => set({ visibleConversation: conversation }),
  clearVisibleConversation: (conversation) => set(state => (
    state.visibleConversation
    && state.visibleConversation.kind === conversation?.kind
    && state.visibleConversation.id === conversation?.id
      ? { visibleConversation: null }
      : {}
  )),

  // One shared notification stream for the whole workspace. This avoids
  // separate Firestore listeners in the header, sidebar and org switcher.
  notifications: [],
  notificationsLoading: true,
  notificationActions: null,
  setNotificationCenter: (notifications, loading, actions) => set({
    notifications,
    notificationsLoading: loading,
    notificationActions: actions,
  }),
  clearNotificationCenter: () => set({
    notifications: [],
    notificationsLoading: false,
    notificationActions: null,
  }),

  // Server-authoritative unread in-app totals for every membership org. The
  // live notification window above is intentionally active-org-only and must
  // never be reused as a cross-organization count.
  notificationUnreadByOrg: {},
  notificationUnreadByOrgLoading: true,
  notificationUnreadByOrgError: null,
  setNotificationUnreadByOrg: (counts, error = null) => set(state => ({
    notificationUnreadByOrg: counts ?? state.notificationUnreadByOrg,
    notificationUnreadByOrgLoading: false,
    notificationUnreadByOrgError: error,
  })),
  clearNotificationUnreadByOrg: () => set({
    notificationUnreadByOrg: {},
    notificationUnreadByOrgLoading: false,
    notificationUnreadByOrgError: null,
  }),

  // Per-issue read cursors are published once at the workspace boundary. Card
  // selectors read a single number from this map, so unchanged cards do not
  // subscribe to Firestore or rerender for another issue's cursor.
  issueReadState: {},
  // Whether that map is an answer yet. An empty map means two opposite things —
  // «this reader has opened nothing» and «the cursors have not arrived» — and a
  // task timeline that cannot tell them apart reads its whole history as
  // unread, draws its boundary at the day the task was created, and sends the
  // reader there. Nothing may judge what is new until this is true.
  issueReadStateLoaded: false,
  setIssueReadState: (readState) => set({ issueReadState: readState, issueReadStateLoaded: true }),
  resetIssueReadState: () => set({ issueReadState: {}, issueReadStateLoaded: false }),

  // ── Breadcrumbs (set by each page) ────────────────────────────────
  breadcrumbs: [],   // [{ label, href? }]
  setBreadcrumbs: (crumbs) => set({ breadcrumbs: crumbs }),

  // ── Team search (synced between header and team page) ─────────────
  teamSearch: '',
  setTeamSearch: (q) => set({ teamSearch: q }),

  // ── Page-context search ───────────────────────────────────────────
  workspaceSearch: '',
  setWorkspaceSearch: (q) => set({ workspaceSearch: q }),
  myTaskSearch: '',
  setMyTaskSearch: (q) => set({ myTaskSearch: q }),
  projectSearch: '',
  setProjectSearch: (q) => set({ projectSearch: q }),

  // Local pages publish only their final filtered count. The header uses it to
  // decide whether it needs the broader (and more expensive) search request.
  localSearchFeedback: null,
  setLocalSearchFeedback: (feedback) => set({ localSearchFeedback: feedback }),

  // One entry point for ⌘K and for escalation from a local search field. An id
  // makes two identical requests distinct, so a closed palette can be reopened
  // with the same query and scope.
  commandPaletteRequest: { id: 0, query: '', scope: null },
  openCommandPalette: ({ query = '', scope = null } = {}) => set(state => ({
    commandPaletteRequest: {
      id: state.commandPaletteRequest.id + 1,
      query: String(query || ''),
      scope,
    },
  })),

  // ── Localization ──────────────────────────────────────────────────
  localization: null,
  setLocalization: (loc) => set({ localization: loc }),

  // ── Sidebar theme live-preview (settings page → sidebar) ─────────
  sidebarPreview: null,  // { theme: 'dark'|'light'|'custom', color: '#hex' } | null
  setSidebarPreview: (preview) => set({ sidebarPreview: preview }),
  clearSidebarPreview: () => set({ sidebarPreview: null }),

  // UI state below the AppContext outlives React route trees. On an
  // organization switch that is useful for account-wide notifications, but
  // dangerous for records that belong to the workspace we just left. Clear
  // every organization-scoped surface as one transaction.
  resetOrganizationScope: () => {
    const toastTimer = get()._toastTimer;
    if (toastTimer) clearTimeout(toastTimer);
    get().liveNotifs.forEach(card => stopLiveNotifTimer(card.id));
    set({
      quickView: null,
      toast: null,
      _toastTimer: null,
      liveNotifs: [],
      visibleConversation: null,
      issueReadState: {},
      issueReadStateLoaded: false,
      breadcrumbs: [],
      teamSearch: '',
      workspaceSearch: '',
      myTaskSearch: '',
      projectSearch: '',
      localSearchFeedback: null,
      sidebarPreview: null,
    });
  },
}));

export default useWorkspaceStore;
