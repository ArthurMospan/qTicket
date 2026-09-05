'use client';
// src/lib/context/OrgContext.js
// Multi-org context: loads ALL organizations the current user belongs to,
// keeps the active org choice inside this tab, and provides switchOrg().
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, query, where, getDocs, getDocsFromServer,
  doc, onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { claimActivityHeartbeat } from '@/lib/utils/activity';
import { reportLoadError } from '@/lib/utils/errors';
import { hasActiveQuickTeamEntitlement } from '@/lib/utils/quickTeamManaged.mjs';
import {
  buildOrganizationList,
  createMembershipSnapshotGate,
  organizationMembershipSignature,
  parseOrganizationDirectory,
} from '@/lib/utils/organizationList.mjs';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';
import {
  organizationLoadErrorKind,
  organizationLoadRetryDelay,
  shouldRetryOrganizationLoad,
} from '@/lib/utils/organizationLoadErrors.mjs';
import { firestoreDocumentData } from '@/lib/utils/firestoreDocument.mjs';

const TAB_STORAGE_KEY = 'qt_active_org_id';
// The workspace this account last worked in on this browser, shared by every
// tab and read exactly once per tab: to give a tab that has never chosen a
// workspace somewhere to start.
//
// A tab owns its selection, and that is worth keeping — two workspaces open
// side by side is the whole point of it. But a *new* tab starts with an empty
// `sessionStorage`, and with nothing to prefer it fell through to
// `organizations[0]`: the first membership the query returns, which is the same
// workspace every time. So typing the address into a new tab silently moved you
// out of the workspace you had been in a minute earlier, and no click of yours
// had asked for it. The choice used to live in `localStorage`, which is why
// this only started happening when each tab got its own.
//
// Kept per account, so two people signing in on one browser do not inherit each
// other's last workspace. A membership is still what decides whether the
// remembered id may be applied at all.
const LAST_ORG_STORAGE_PREFIX = 'qt_last_org_id:';
const ORG_LOAD_RETRY_LIMIT = 3;
// How often returning to the tab may re-verify the organization directory.
// See `refreshOnFocus` below for why this is a repair path and not a refresh.
const DIRECTORY_RECHECK_MS = 30 * 60 * 1000;
// Скільки часу відмови вважаються однією подією.
//
// Не обмеження частоти: коли доступ до організації зникає, відмовляють усі
// слухачі одразу, і перевіряти довідник треба один раз на цю пачку. Далі
// перевірка вільна — цей шлях узагалі відкривається лише на справжній відмові
// в правах, а вона нечаста.
const REFUSAL_REVALIDATION_WINDOW_MS = 5 * 1000;
const OrgContext = createContext(null);

function lastOrganizationKey(accountId) {
  return accountId ? `${LAST_ORG_STORAGE_PREFIX}${accountId}` : null;
}

// Hand a tab that has never chosen a workspace the one this account was last
// working in. It is written into the tab's own storage, so from that moment it
// is this tab's choice like any other: switching workspaces in another tab
// leaves it alone, and so does this function on every later load.
function adoptLastOrganization(accountId) {
  if (typeof window === 'undefined') return;
  const lastKey = lastOrganizationKey(accountId);
  if (!lastKey) return;
  try {
    if (sessionStorage.getItem(TAB_STORAGE_KEY)) return;
    const lastUsed = localStorage.getItem(lastKey);
    if (lastUsed) sessionStorage.setItem(TAB_STORAGE_KEY, lastUsed);
  } catch { /* storage may be disabled */ }
}

function persistTabOrganization(orgId, accountId) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(TAB_STORAGE_KEY, orgId);
  const lastKey = lastOrganizationKey(accountId);
  if (lastKey) localStorage.setItem(lastKey, orgId);
  // Stop legacy versions in another tab from reviving the shared selection.
  localStorage.removeItem(TAB_STORAGE_KEY);
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const scoped = withNotificationOrganization(current, orgId);
  if (scoped && scoped !== current) window.history.replaceState(null, '', scoped);
}

export function OrgProvider({ user, children }) {
  const [allOrgs,     setAllOrgs]     = useState([]);    // all orgs user belongs to
  // The role this user holds in each of them, keyed by organization id.
  //
  // `orgRole` answers only for the active organization, so the switcher — which
  // draws every organization at once — had nowhere to ask and read the legacy
  // `members` array denormalized onto the organization document instead. That
  // array stopped being maintained: OneB has three members in `orgMemberships`
  // and one entry there, so the lookup missed and fell through to «member»,
  // and the owner of a workspace was shown as a plain participant in it.
  // Access is `orgMemberships` and nothing else (AGENTS.md); so is the label.
  const [orgRoles,    setOrgRoles]    = useState({});
  const [activeOrgId, setActiveOrgId] = useState(null);
  const [activeOrg,   setActiveOrg]   = useState(null);
  const [orgRole,     setOrgRole]     = useState(null);  // role inside the active org
  const [orgLoading,  setOrgLoading]  = useState(true);
  const [orgError,    setOrgError]    = useState(null);
  const [noOrg,       setNoOrg]       = useState(false); // true → show onboarding prompt
  // A browser snapshot is useful for a fast provisional list, but only the
  // authenticated directory route can prove that an organization is absent.
  // Guards use this bit before turning a missing provisional entry into an
  // access-denied screen.
  const [orgDirectoryVerified, setOrgDirectoryVerified] = useState(false);
  // Перепитати довідник — з ефекту, який його не будує.
  //
  // `refreshOrganizationDirectory` живе в замиканні ефекту нижче, а звертається
  // до нього слухач активної організації, який стоїть в іншому ефекті. Ref —
  // єдиний спосіб дати другому доступ до першого, не перебудовуючи підписку на
  // членства щоразу.
  const revalidateDirectoryRef = useRef(null);
  // Відмови приходять пачкою — організація, членство, і все, що на них
  // зав'язане. Перепитувати довідник треба один раз на пачку, а не на кожен
  // слухач. Вікно коротке: це не обмеження частоти, а склеювання сплеску.
  const lastDirectoryRevalidationRef = useRef(0);

  const accountId = user?.id || user?.uid || null;

  // ── Apply an org as active (Internal helper) ─────────────────────────
  const applyOrg = useCallback((orgData, role) => {
    // The list listener already read the membership and published its role.
    // Reading the same document again here used the cache-preferred `getDoc`,
    // which could turn a role we had just verified into null in the one browser
    // whose cache did not contain that membership.
    persistTabOrganization(orgData.id, accountId);
    setActiveOrgId(orgData.id);
    setActiveOrg(orgData);
    setOrgRole(role ?? null);
    setNoOrg(false);
    setOrgError(null);
    setOrgLoading(false);
  }, [accountId]);

  // ── Load all orgs when user changes ─────────────────────────────────────
  useEffect(() => {
    if (!user) {
      queueMicrotask(() => {
        setAllOrgs([]);
        setOrgRoles({});
        setActiveOrgId(null);
        setActiveOrg(null);
        setOrgRole(null);
        setOrgLoading(false);
        setNoOrg(false);
        setOrgError(null);
        setOrgDirectoryVerified(false);
      });
      return;
    }

    const uid = user.id || user.uid;

    // Before anything is read: a tab with no workspace of its own starts in the
    // one this account left off in, rather than in whichever workspace the
    // membership query happens to return first.
    adoptLastOrganization(uid);

    queueMicrotask(() => setOrgDirectoryVerified(false));

    let cancelled = false;
    let retryAttempt = 0;
    let retryTimer = null;
    let unsubscribe = () => {};
    // The browser listener is a provisional, cache-backed view. The Admin SDK
    // directory is the verified view. Both reads are asynchronous, so their
    // publication order must preserve that source hierarchy rather than merely
    // trusting whichever callback happened to finish last.
    //
    // Firestore often emits the listener first from IndexedDB and then after a
    // remote sync. Those snapshots do not have to agree, and the remote-marked
    // one still shares the browser SDK's persistent target state. Neither is
    // allowed to overrule the independent directory response.
    //
    // A browser snapshot may publish as a fast provisional answer, but it can
    // never supersede the verified directory. Sequence alone is not enough: an
    // old callback can start after verification and would otherwise become
    // "newer" merely by arriving later.
    const membershipSnapshotGate = createMembershipSnapshotGate();
    let hasVerifiedDirectory = false;
    // True while the screen is held on the loader because the browser cache is
    // short of the workspace this tab actually carries, waiting for the server
    // directory to settle it.
    let awaitingVerifiedSelection = false;
    let directoryRequest = 0;
    let directoryRetryAttempt = 0;
    let directoryRetryTimer = null;
    let directoryAbortController = null;
    let lastLiveMembershipSignature = null;
    // The list this listener last put on screen. A workspace whose organization
    // document a read failed to return keeps the name it already had instead of
    // going blank while the document is fetched again.
    let publishedOrgs = [];
    const membershipsQuery = query(
      collection(db, 'orgMemberships'),
      where('userId', '==', uid)
    );

    const readOrganizationsById = async (orgIds, fromServer) => {
      const chunks = [];
      for (let i = 0; i < orgIds.length; i += 30) chunks.push(orgIds.slice(i, i + 30));
      const snapshots = await Promise.all(chunks.map(ids => {
        const request = query(collection(db, 'organizations'), where('__name__', 'in', ids));
        return fromServer ? getDocsFromServer(request) : getDocs(request);
      }));
      return snapshots.flatMap(orgSnap => orgSnap.docs.map(d => firestoreDocumentData(d)));
    };

    // `getDocs` answers from the local cache whenever the SDK believes it is
    // offline, and a cache that never held one of these documents answers short
    // rather than failing — there is no error to catch and nothing to retry. A
    // membership is proof the workspace is there, so a smaller answer than the
    // memberships describe is asked again, of the server this time. If that is
    // unreachable the entry survives anyway, marked pending by the builder.
    const readOrganizationDocuments = async (orgIds) => {
      let documents = [];
      try {
        documents = await readOrganizationsById(orgIds, false);
      } catch {
        // The membership still proves the entry. The server-specific read below
        // gets one more chance to decorate it; failing that, it remains pending.
      }
      const found = new Set(documents.map(document => document.id));
      const missing = orgIds.filter(orgId => !found.has(orgId));
      if (missing.length === 0) return documents;
      try {
        return documents.concat(await readOrganizationsById(missing, true));
      } catch {
        return documents;
      }
    };

    const applyMembershipDocuments = async (
      memberships,
      authoritative,
      suppliedOrganizationDocuments = null,
    ) => {
      // Once a server answer has started, no cache-only answer may shorten it,
      // even if the cache callback itself happens to arrive later.
      const snapshotTicket = membershipSnapshotGate.begin(authoritative);
      if (!snapshotTicket) return;
      const current = () => !cancelled && snapshotTicket.isCurrent();
      try {
        const orgIds = [...new Set(memberships.map(membership => membership.orgId).filter(Boolean))];
        const documents = suppliedOrganizationDocuments
          ?? (orgIds.length > 0 ? await readOrganizationDocuments(orgIds) : []);

        // `authoritative` is the directory route's answer, and it reads through
        // the Admin SDK — so on that pass a membership with no organization
        // behind it is not a workspace rather than a short read.
        const { organizations, roles } = buildOrganizationList(
          memberships,
          documents,
          publishedOrgs,
          { verified: authoritative },
        );

        if (!current()) return;
        if (authoritative) {
          hasVerifiedDirectory = true;
          setOrgDirectoryVerified(true);
        }
        publishedOrgs = organizations;
        setOrgError(null);
        setAllOrgs(organizations);
        setOrgRoles(roles);

        // Nobody has a workspace only when nobody has a membership. It used to
        // be the organization documents that decided this, so a read that came
        // back empty sent a person who owns two workspaces to «створіть
        // організацію».
        if (organizations.length === 0) {
          // An empty cache proves only that this browser has never cached a
          // membership. Redirecting from that answer creates a fake "new
          // organization" flow for an existing owner. Only the server may say
          // that the account genuinely has no workspace.
          if (!authoritative) {
            setNoOrg(false);
            setOrgLoading(true);
            return;
          }
          setNoOrg(true);
          setActiveOrgId(null);
          setActiveOrg(null);
          setOrgRole(null);
          setOrgLoading(false);
          return;
        }

        // The address is an explicit navigation intent (notification, copied
        // link, or switcher choice). It outranks the tab's last workspace.
        // Only when the address is unscoped may sessionStorage decide.
        const requested = typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('org')
          : null;
        const stored = typeof window !== 'undefined' ? sessionStorage.getItem(TAB_STORAGE_KEY) : null;
        const requestedOrganization = requested && organizations.find(o => o.id === requested);
        const storedOrganization = stored && organizations.find(o => o.id === stored);
        const preferred = requestedOrganization || (!requested ? storedOrganization : null);
        // A short cache may know about some other workspace but not the one the
        // tab explicitly carries. Falling back here paints the wrong workspace
        // and lets the route guard accuse the requested one of being forbidden.
        // Keep resolving until the server directory either restores that exact
        // membership or authoritatively says it is gone.
        const explicitOrganizationId = requested || stored;
        if (!authoritative && explicitOrganizationId && !preferred) {
          awaitingVerifiedSelection = true;
          setNoOrg(false);
          setOrgLoading(true);
          return;
        }
        const chosen = preferred || storedOrganization || organizations[0];

        // Apply org (bypassing members array logic)
        awaitingVerifiedSelection = false;
        setActiveOrgId(chosen.id);
        setActiveOrg(chosen);
        setOrgRole(roles[chosen.id] ?? null);
        setNoOrg(false);
        setOrgLoading(false);
        // A partial cache must not replace a stored choice it did not know
        // about. The forced server read can then restore that exact workspace,
        // rather than merely put it back somewhere in the switcher.
        // If a verified directory says the URL's organization is not a
        // membership, leave that URL untouched for the route guard to render
        // the real denial. Rewriting it to a fallback organization would turn
        // a broken/deauthorized link into a silent wrong-workspace navigation.
        if (!requested || requestedOrganization) persistTabOrganization(chosen.id, uid);
        retryAttempt = 0;
      } catch (err) {
        handleLoadError('[OrgContext] organizations', err);
      }
    };

    const applyMembershipSnapshot = memSnap => {
      const memberships = memSnap.docs.map(document => document.data());

      // Even a snapshot marked `fromCache: false` still travels through the
      // browser SDK, its persistent target state and its existing listener. It
      // can complete without an error while that local target is incomplete, so
      // it is a useful fast/live hint but never the authority that may shorten
      // the directory.
      //
      // A changed live snapshot asks the independent Admin SDK route to verify
      // the directory. The snapshot itself remains provisional; after the
      // first verified directory the gate refuses every browser-only result.
      if (!memSnap.metadata?.fromCache) {
        const signature = organizationMembershipSignature(memberships);
        if (signature !== lastLiveMembershipSignature) {
          lastLiveMembershipSignature = signature;
          if (hasVerifiedDirectory) {
            directoryRetryAttempt = 0;
            refreshOrganizationDirectory();
          }
        }
      }

      return applyMembershipDocuments(memberships, false);
    };

    const handleLoadError = (scope, err) => {
      reportLoadError(scope, err);
      unsubscribe();
      unsubscribe = () => {};
      if (retryTimer) window.clearTimeout(retryTimer);
      if (!cancelled && shouldRetryOrganizationLoad(err) && retryAttempt < ORG_LOAD_RETRY_LIMIT) {
        retryAttempt += 1;
        setOrgError(null);
        setOrgLoading(true);
        // Repeating a rejected read with the credential that was rejected only
        // gets it rejected again. A denial straight after a sign-in is a token
        // that belongs to the previous session, so the retry is handed a fresh
        // one before it goes back out.
        if (organizationLoadErrorKind(err) === 'permission-denied') {
          auth.currentUser?.getIdToken(true).catch(() => {});
        }
        retryTimer = window.setTimeout(subscribe, organizationLoadRetryDelay(retryAttempt));
        return;
      }
      setOrgError(err);
      setOrgLoading(false);
    };

    const refreshOrganizationDirectory = async () => {
      const request = ++directoryRequest;
      if (directoryRetryTimer) {
        window.clearTimeout(directoryRetryTimer);
        directoryRetryTimer = null;
      }
      directoryAbortController?.abort();
      const controller = new AbortController();
      directoryAbortController = controller;
      try {
        // The Admin SDK route is deliberately the primary read, not a fallback
        // after `getDocsFromServer`. The browser SDK can return a successful but
        // short query from a poisoned persistent target; waiting for it to throw
        // meant this recovery route was never called in exactly the browser it
        // existed to repair.
        const directory = await authenticatedRequest(
          '/api/organizations',
          { cache: 'no-store', signal: controller.signal },
          'Не вдалося перевірити список організацій',
        );
        if (cancelled || request !== directoryRequest) return;
        const verified = parseOrganizationDirectory(directory);
        directoryRetryAttempt = 0;
        await applyMembershipDocuments(
          verified.memberships,
          true,
          verified.organizations,
        );
      } catch (err) {
        if (cancelled || request !== directoryRequest) return;
        reportLoadError('[OrgContext] memberships server refresh', err);
        if (
          (
            shouldRetryOrganizationLoad(err)
            || Number(err?.status) >= 500
          )
          && directoryRetryAttempt < ORG_LOAD_RETRY_LIMIT
        ) {
          directoryRetryAttempt += 1;
          directoryRetryTimer = window.setTimeout(
            refreshOrganizationDirectory,
            organizationLoadRetryDelay(directoryRetryAttempt),
          );
          return;
        }
        // A cache-only empty list is not permission to create a replacement
        // organization. If the server cannot verify it after retries, show the
        // recoverable load error instead of silently claiming there is no org.
        //
        // The same is true of a tab held on the loader waiting for a workspace
        // the cache is short of: that wait is worth it only while a verified
        // answer is still on its way. Once it is not, the screen says so and
        // offers a retry, rather than spinning on a loader nothing will end.
        if (!hasVerifiedDirectory && (publishedOrgs.length === 0 || awaitingVerifiedSelection)) {
          setOrgError(err);
          setOrgLoading(false);
        }
      }
    };

    const subscribe = () => {
      if (cancelled) return;
      unsubscribe();
      unsubscribe = onSnapshot(
        membershipsQuery,
        { includeMetadataChanges: true },
        applyMembershipSnapshot,
        err => handleLoadError('[OrgContext] memberships', err),
      );
    };

    subscribe();
    refreshOrganizationDirectory();
    // Coming back to the tab is not news about the membership list — it is a
    // guess that something might have changed while nobody was looking. The
    // live listener above already asks for a verified directory the moment the
    // membership signature actually moves, and the organization document has
    // its own listener, so this is purely a repair path for a browser whose
    // Firestore cache is stuck.
    //
    // Left unthrottled it was the single most-executed query in the product:
    // every alt-tab, in every open tab, ran `orgMemberships where userId ==`
    // on the server — four hundred executions in one evening for an answer
    // that had not changed once. The claim is shared through localStorage, so
    // four tabs make one request between them, not four.
    const refreshOnFocus = () => {
      if (!claimActivityHeartbeat(`org-directory:${uid}`, DIRECTORY_RECHECK_MS)) return;
      directoryRetryAttempt = 0;
      refreshOrganizationDirectory();
    };
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('online', refreshOnFocus);
    revalidateDirectoryRef.current = () => {
      directoryRetryAttempt = 0;
      refreshOrganizationDirectory();
    };
    return () => {
      revalidateDirectoryRef.current = null;
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (directoryRetryTimer) window.clearTimeout(directoryRetryTimer);
      directoryAbortController?.abort();
      directoryRequest += 1;
      window.removeEventListener('focus', refreshOnFocus);
      window.removeEventListener('online', refreshOnFocus);
      unsubscribe();
    };
  }, [user?.id, applyOrg]); // eslint-disable-line

  // ── Org switcher: called from UI ─────────────────────────────────────────
  const switchOrg = useCallback((orgId) => {
    const target = allOrgs.find(o => o.id === orgId);
    if (!target || !user) return;
    // Set loading briefly so project data refreshes cleanly
    setOrgLoading(true);
    applyOrg(target, orgRoles[orgId]);
  }, [allOrgs, orgRoles, user, applyOrg]);

  // ── Live-sync the active org document and membership ──────────────────
  useEffect(() => {
    if (!activeOrgId) return;

    // Відмова тут — це запитання до довідника, а не рядок у консолі.
    //
    // Обидва ці слухачі мовчки ковтали `permission-denied` під коментарем
    // «expected during logout». Під час виходу це справді так. Але той самий
    // обробник спрацьовує, коли в QuickTeam вимикають доповнення поки вкладка
    // відкрита: entitlement лежить на документі організації, а не на членстві,
    // тож жодна підписка на членства не змінюється й ніщо не перезапитує
    // довідник. Організація лишалась обраною, лишалась у перемикачі, а кожен
    // екран продовжував питати й отримувати відмову — і показував «Немає
    // доступу до цих даних. Сесія могла завершитися», тимчасом як сесія була
    // ціла, а вимкнули доповнення.
    //
    // Слухач, який це помічає першим, дивиться саме на той документ, чий
    // entitlement усе вирішує. Тож він більше не мовчить: він просить
    // `/api/organizations` перевірити довідник Admin SDK. Відповідь
    // авторитетна й веде себе сама — `buildOrganizationList` викидає
    // організацію, яку продукт відмовляється відкривати, і людина опиняється
    // там, де правда: без цього робочого простору, а не перед карткою про
    // зіпсовану сесію.
    //
    // Якщо ж довідник підтвердить, що простір на місці, нічого не зміниться —
    // і відмова справді була тим, чим її вважали: миттю під час виходу.
    const handleActiveOrganizationRefusal = (scope, err) => {
      if (organizationLoadErrorKind(err) !== 'permission-denied') {
        console.warn(`${scope} error:`, err.message);
        return;
      }
      console.warn(`${scope} refused; re-verifying the directory:`, err.message);
      const now = Date.now();
      if (now - lastDirectoryRevalidationRef.current < REFUSAL_REVALIDATION_WINDOW_MS) return;
      lastDirectoryRevalidationRef.current = now;
      revalidateDirectoryRef.current?.();
    };

    // Sync organization data
    const unsubOrg = onSnapshot(doc(db, 'organizations', activeOrgId), (snap) => {
      if (snap.exists()) {
        const data = firestoreDocumentData(snap);
        setActiveOrg(data);
        setAllOrgs(prev => {
          const exists = prev.find(o => o.id === snap.id);
          if (exists) {
            return prev.map(o => o.id === snap.id ? data : o);
          }
          // The same rule the list is built by, applied to the one entry that
          // does not come from it. Appending unconditionally would let a live
          // snapshot put back a workspace the switcher had just stopped
          // offering — a filter is only worth as much as its narrowest way in.
          return hasActiveQuickTeamEntitlement(data) ? [...prev, data] : prev;
        });
      }
    }, (err) => {
      handleActiveOrganizationRefusal('[OrgContext] org sync', err);
    });

    // Sync role from orgMemberships
    const uid = user?.id || user?.uid;
    let unsubMem = () => {};
    if (uid) {
      unsubMem = onSnapshot(doc(db, 'orgMemberships', `${activeOrgId}_${uid}`), (snap) => {
        if (snap.exists()) setOrgRole(snap.data().role);
        else if (!snap.metadata.fromCache) setOrgRole(null);
      }, (err) => {
        handleActiveOrganizationRefusal('[OrgContext] membership sync', err);
      });
    }

    return () => { unsubOrg(); unsubMem(); };
  }, [activeOrgId, user?.id, user?.uid]);

  return (
    <OrgContext.Provider value={{
      allOrgs, orgRoles, activeOrgId, activeOrg, orgRole,
      orgLoading, orgError, noOrg, orgDirectoryVerified,
      setActiveOrgId, switchOrg,
    }}>
      {children}
    </OrgContext.Provider>
  );
}

export const useOrg = () => {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used inside OrgProvider');
  return ctx;
};
