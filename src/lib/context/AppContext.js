'use client';
// src/lib/context/AppContext.js
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth }         from '@/lib/hooks/useAuth';
import { useProjects }     from '@/lib/hooks/useProjects';
import { acceptPendingInvitation } from '@/lib/hooks/useOrganization';
import { OrgProvider, useOrg } from '@/lib/context/OrgContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';

const AppContext = createContext(null);
const INVITATION_CHECK_TTL = 5 * 60 * 1000;

// ─── Inner provider (has access to OrgContext) ────────────────────────────
function AppProviderInner({
  user,
  authLoading,
  signInWithGoogle,
  signInWithGitHub,
  signInWithEmail,
  signInWithAuthToken,
  signOut,
  children,
}) {
  const { allOrgs, orgRoles, activeOrgId, activeOrg, orgRole, orgLoading, orgError, noOrg, orgDirectoryVerified, switchOrg, setActiveOrgId } = useOrg();
  const userId = authLoading ? undefined : (user?.id || user?.uid || null);
  const invitationUid = user?.id || user?.uid;
  const invitationEmail = user?.email;
  // Жодна підписка не йде в організацію, про яку ще не відомо, чи вона взагалі
  // робочий простір цього акаунта.
  //
  // Це причина «Немає доступу до цих даних», яку правили чотири рази й щоразу
  // не там. Довідник організацій приходить двічі: спершу з кешу браузера,
  // потім із `/api/organizations` через Admin SDK. На кешовому проході запис,
  // документа якого браузер прочитати не може, лишається `pending` і лишається
  // обраним — `buildOrganizationList` робить це навмисно, щоб короткий читок не
  // видалив живий простір із перемикача. Але поки він обраний, кожен слухач,
  // прив'язаний до `activeOrgId`, б'ється в `firestore.rules`, де все —
  // організація, проєкти, налаштування, стан прочитаного — стоїть за
  // `organizationEntitlementActive(orgId)`, і жодне з цього не читається.
  //
  // `WorkspaceOrganizationRouteGuard` уже тримає екрани саме через це:
  // `if (orgLoading || !orgDirectoryVerified) return <LoadingScreen/>`. Але він
  // тримає лише те, що всередині нього, а підписки живуть вище — тут і в двох
  // мостах у layout. Тобто гвард закриває вікно для очей і лишає його
  // відчиненим для мережі.
  //
  // Попередні виправлення вчили екрани мовчати про відмову (`isUnresolvedAccessError`).
  // Це лікувало реакцію: відмови й далі генерувалися, просто їх ковтали — і
  // кожен новий слухач мусив вивчити той самий трюк, інакше картка поверталась.
  // Один шлюз замість N: підписуємось лише туди, де вже відомо, що можна.
  const subscribableOrgId = orgDirectoryVerified ? activeOrgId : '';
  const { projects, loading: projectsLoading, error: projectsError } = useProjects(userId, subscribableOrgId, orgRole);
  const resetOrganizationScope = useWorkspaceStore(state => state.resetOrganizationScope);
  const previousOrganizationId = useRef(undefined);

  // React-local screens are remounted by the workspace layout's organization
  // key. Zustand deliberately lives above that tree, so clear its org-scoped
  // records before the browser paints the newly selected workspace.
  useLayoutEffect(() => {
    if (previousOrganizationId.current !== activeOrgId) {
      resetOrganizationScope();
      previousOrganizationId.current = activeOrgId;
    }
  }, [activeOrgId, resetOrganizationScope]);

  useEffect(() => {
    if (user?.localization) {
      // Static import rather than require(): CommonJS interop inside a client
      // module depends on bundler behaviour and is not guaranteed to resolve.
      useWorkspaceStore.getState().setLocalization(user.localization);
    }
  }, [user?.localization]);

  // When user signs in: accept pending invitations. `invitationChecked` gates
  // the onboarding redirect so a freshly-invited user (whose membership is being
  // created by /api/invitations/accept) is never bounced to "create an org"
  // during that race — see WorkspaceLayout.
  const [invitationChecked, setInvitationChecked] = useState(false);
  useEffect(() => {
    if (!invitationUid) { queueMicrotask(() => setInvitationChecked(false)); return; }

    let cancelled = false;
    const done = () => { if (!cancelled) setInvitationChecked(true); };
    (async () => {
      const uid = invitationUid;
      const email = invitationEmail;
      if (!uid || !email) { done(); return; }

      const storageKey = `qt:invitation-check:${uid}`;
      try {
        const lastCheck = Number(window.localStorage.getItem(storageKey) || 0);
        if (Date.now() - lastCheck < INVITATION_CHECK_TTL) { done(); return; }
        window.localStorage.setItem(storageKey, String(Date.now()));
        await acceptPendingInvitation(uid, email);
      } catch (err) {
        window.localStorage.removeItem(storageKey);
        console.error('[AppContext] init error:', err);
      } finally {
        done();
      }
    })();
    return () => { cancelled = true; };
  }, [invitationEmail, invitationUid]);

  const value = {
    authLoading,
    projectsLoading,
    projectsError,
    orgLoading,
    orgError,
    signInWithGoogle,
    signInWithGitHub,
    signInWithEmail,
    signInWithAuthToken,
    signOut,
    currentUser: user,
    projects,
    // Org-related
    activeOrgId,
    // Та сама організація, але тільки після того, як довідник підтвердив, що
    // вона взагалі робочий простір цього акаунта. Усе, що відкриває слухача на
    // Firestore, бере цю, а не `activeOrgId`: підписка на непідтверджену
    // організацію — це гарантована відмова в правах, а не гонка, якій можна не
    // пощастити. `activeOrgId` лишається для того, що не читає даних:
    // перемикача, гварда маршруту, ключа ремонтування.
    subscribableOrgId,
    activeOrg,
    orgRole,
    noOrg,
    orgDirectoryVerified,
    allOrgs,
    orgRoles,
    switchOrg,
    setActiveOrgId,
    invitationChecked,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

// ─── Outer provider: sets up auth, wraps OrgProvider ─────────────────────
export function AppProvider({ children }) {
  const {
    user,
    loading: authLoading,
    signInWithGoogle,
    signInWithGitHub,
    signInWithEmail,
    signInWithAuthToken,
    signOut,
  } = useAuth();

  return (
    <OrgProvider user={user}>
      <AppProviderInner
        user={user}
        authLoading={authLoading}
        signInWithGoogle={signInWithGoogle}
        signInWithGitHub={signInWithGitHub}
        signInWithEmail={signInWithEmail}
        signInWithAuthToken={signInWithAuthToken}
        signOut={signOut}
      >
        {children}
      </AppProviderInner>
    </OrgProvider>
  );
}

export const useAppContext = () => {
  const ctx = useContext(AppContext);
  // During SSG prerender, AppProvider is not present — return safe defaults
  if (!ctx) {
    return {
      authLoading: true,
      projectsLoading: true,
      projectsError: null,
      orgLoading: true,
      orgError: null,
      signInWithGoogle: async () => {},
      signInWithGitHub: async () => {},
      signInWithEmail: async () => {},
      signInWithAuthToken: async () => {},
      signOut: async () => {},
      currentUser: null,
      projects: [],
      activeOrgId: null,
      activeOrg: null,
      orgRole: null,
      noOrg: false,
      orgDirectoryVerified: false,
      subscribableOrgId: '',
      allOrgs: [],
      orgRoles: {},
      switchOrg: () => {},
      setActiveOrgId: () => {},
      invitationChecked: false,
    };
  }
  return ctx;
};
