'use client';
// src/lib/context/AppContext.js
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAuth }         from '@/lib/hooks/useAuth';
import { useProjects }     from '@/lib/hooks/useProjects';
import { acceptPendingInvitation } from '@/lib/hooks/useOrganization';
import { OrgProvider, useOrg } from '@/lib/context/OrgContext';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { claimActivityHeartbeat } from '@/lib/utils/activity';
import useWorkspaceStore from '@/store/useWorkspaceStore';

const AppContext = createContext(null);
const INVITATION_CHECK_TTL = 5 * 60 * 1000;
const PRESENCE_HEARTBEAT_MS = 60_000;

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
  const { projects, loading: projectsLoading, error: projectsError } = useProjects(userId, activeOrgId, orgRole);
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

  // Update presence
  useEffect(() => {
    if (!userId || !activeOrgId) return;
    const presenceRef = doc(db, 'organizations', activeOrgId, 'presence', userId);
    const updatePresence = async () => {
      if (!claimActivityHeartbeat(`presence:${activeOrgId}:${userId}`, PRESENCE_HEARTBEAT_MS)) return;
      try {
        await setDoc(presenceRef, {
          online: true,
          lastSeen: serverTimestamp(),
        }, { merge: true });
      } catch {}
    };
    updatePresence();
    const intervalId = setInterval(updatePresence, PRESENCE_HEARTBEAT_MS);
    document.addEventListener('visibilitychange', updatePresence);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', updatePresence);
    };
  }, [activeOrgId, userId]);

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
      allOrgs: [],
      orgRoles: {},
      switchOrg: () => {},
      setActiveOrgId: () => {},
      invitationChecked: false,
    };
  }
  return ctx;
};
