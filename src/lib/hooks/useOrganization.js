'use client';

// src/lib/hooks/useOrganization.js
// Organization = one workspace in the multi-organization membership model.
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import {
  fetchMemberRemovalImpact,
  fetchOrganizationMembers,
  deactivateOrganizationMember,
  reactivateOrganizationMember,
  updateOrganizationMember,
} from '@/lib/services/members';
import { claimActivityHeartbeat } from '@/lib/utils/activity';
import { reportLoadError } from '@/lib/utils/errors';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { firestoreDocumentData } from '@/lib/utils/firestoreDocument.mjs';

// How often returning to the tab may re-read the member directory.
const MEMBER_RECHECK_MS = 30 * 60 * 1000;

const ORGANIZATION_SERVER_SNAPSHOT = Object.freeze({
  org: null,
  members: [],
  loading: true,
  error: null,
});

const EMPTY_ORGANIZATION_SNAPSHOT = Object.freeze({
  ...ORGANIZATION_SERVER_SNAPSHOT,
  loading: false,
});

const organizationStores = new Map();

function createOrganizationStore(organizationId, viewerScope) {
  let snapshot = ORGANIZATION_SERVER_SNAPSHOT;
  let unsubscribeOrg = null;
  let unsubscribeMembers = null;
  let stopTimer = null;
  let requestVersion = 0;
  let memberDirectoryVersion;
  let ownMembershipInitialized = false;
  let focusListener = null;
  const listeners = new Set();

  const emit = next => {
    snapshot = next;
    listeners.forEach(listener => listener());
  };

  const refresh = async () => {
    const version = ++requestVersion;
    try {
      const members = await fetchOrganizationMembers(organizationId, {
        force: true,
        cacheScope: viewerScope,
      });
      if (version === requestVersion) {
        emit({ ...snapshot, members, loading: false, error: null });
      }
    } catch (error) {
      if (version !== requestVersion) return;
      reportLoadError('[useOrganization] member profiles', error);
      // A failed refresh is not proof that the directory became empty. Keep
      // the last verified list visible and publish the failure separately.
      emit({ ...snapshot, loading: false, error });
    }
  };

  const start = () => {
    if (unsubscribeOrg || unsubscribeMembers) return;
    refresh();

    unsubscribeOrg = onSnapshot(doc(db, 'organizations', organizationId), orgSnap => {
      if (!orgSnap.exists()) {
        emit({ org: null, members: [], loading: false, error: null });
        return;
      }
      const nextOrg = firestoreDocumentData(orgSnap);
      const nextDirectoryVersion = Number(nextOrg.memberDirectoryVersion) || 0;
      if (
        memberDirectoryVersion !== undefined
        && memberDirectoryVersion !== nextDirectoryVersion
      ) refresh();
      memberDirectoryVersion = nextDirectoryVersion;
      emit({ ...snapshot, org: nextOrg, error: null });
    }, error => {
      reportLoadError('[useOrganization] organization', error);
      emit({ ...snapshot, loading: false, error });
    });

    const uid = auth.currentUser?.uid;
    unsubscribeMembers = uid
      ? onSnapshot(doc(db, 'orgMemberships', `${organizationId}_${uid}`), () => {
        // The initial membership snapshot describes the same state as the
        // refresh start() already launched. Only later changes invalidate the
        // directory; otherwise every reload spends two identical API reads.
        if (ownMembershipInitialized) refresh();
        ownMembershipInitialized = true;
      }, error => {
        reportLoadError('[useOrganization] own membership', error);
      })
      : () => {};
    // Same repair path, same throttle, same reason as the organization
    // directory in `OrgContext`. The member list is invalidated by two live
    // signals already — `memberDirectoryVersion` on the organization document
    // and this account's own membership — and every write that changes it
    // refreshes explicitly. What was left was a forced read of
    // `orgMemberships where orgId ==` on every alt-tab in every open tab,
    // which is roughly two hundred executions in an evening for an unchanged
    // answer. The claim is shared through localStorage across tabs.
    focusListener = () => {
      if (!claimActivityHeartbeat(`org-members:${organizationId}`, MEMBER_RECHECK_MS)) return;
      refresh();
    };
    window.addEventListener('focus', focusListener);
  };

  const subscribe = listener => {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = null;
    }
    listeners.add(listener);
    start();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        stopTimer = setTimeout(() => {
          requestVersion += 1;
          unsubscribeOrg?.();
          unsubscribeMembers?.();
          if (focusListener) window.removeEventListener('focus', focusListener);
          unsubscribeOrg = null;
          unsubscribeMembers = null;
          focusListener = null;
          memberDirectoryVersion = undefined;
          ownMembershipInitialized = false;
          stopTimer = null;
        }, 1000);
      }
    };
  };

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => ORGANIZATION_SERVER_SNAPSHOT,
    refresh,
  };
}

const emptyOrganizationStore = {
  subscribe: () => () => {},
  getSnapshot: () => EMPTY_ORGANIZATION_SNAPSHOT,
  getServerSnapshot: () => EMPTY_ORGANIZATION_SNAPSHOT,
};

function getOrganizationStore(organizationId, viewerScope) {
  if (!organizationId || !viewerScope) return emptyOrganizationStore;
  const key = `${organizationId}:${viewerScope}`;
  if (!organizationStores.has(key)) {
    organizationStores.set(key, createOrganizationStore(organizationId, viewerScope));
  }
  return organizationStores.get(key);
}

export function useOrganization() {
  const { activeOrgId, currentUser, orgRole } = useAppContext();
  const viewerId = currentUser?.uid || currentUser?.id || '';
  const viewerScope = viewerId ? `${viewerId}:${orgRole || 'pending'}` : '';
  const store = useMemo(
    () => getOrganizationStore(activeOrgId, viewerScope),
    [activeOrgId, viewerScope],
  );
  const { org, members, loading, error } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  // Invite by email
  // `projectIds` scopes the invitation to projects the invitee joins the moment
  // they accept, so inviting from the project form does not need a second trip
  // through project settings once the person shows up in the organization.
  const inviteMember = useCallback(async (email, invitedBy, role = 'member', projectIds = []) => {
    if (!activeOrgId || !auth.currentUser) throw new Error('Authentication required');
    const token = await auth.currentUser.getIdToken();
    const response = await fetch('/api/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, organizationId: activeOrgId, role, invitedBy, projectIds }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не вдалося запросити користувача');
    return result;
  }, [activeOrgId]);

  // Change role
  const changeMemberRole = useCallback(async (uid, newRole) => {
    if (!activeOrgId) return;
    await updateOrganizationMember(activeOrgId, uid, { action: 'role', role: newRole });
    await store.refresh();
  }, [activeOrgId, store]);

  // Change hourly rate
  const setMemberRate = useCallback(async (uid, rate) => {
    if (!activeOrgId) return;
    await updateOrganizationMember(activeOrgId, uid, {
      action: 'rate',
      hourlyRate: Number(rate),
    });
    await store.refresh();
  }, [activeOrgId, store]);

  // Change position
  const setMemberPosition = useCallback(async (uid, positionId) => {
    if (!activeOrgId) return;
    await updateOrganizationMember(activeOrgId, uid, {
      action: 'position',
      positionId: positionId || '',
    });
    await store.refresh();
  }, [activeOrgId, store]);

  const getMemberRemovalImpact = useCallback(async uid => {
    if (!activeOrgId) return { projectCount: 0, assignedIssueCount: 0, watchedIssueCount: 0 };
    return fetchMemberRemovalImpact(activeOrgId, uid);
  }, [activeOrgId]);

  // Close someone's access. Their tasks, comments and logged time stay exactly
  // where they are — see `src/lib/utils/orgMembership.mjs`.
  const deactivateMember = useCallback(async uid => {
    if (!activeOrgId) return;
    const result = await deactivateOrganizationMember(activeOrgId, uid);
    await store.refresh();
    return result;
  }, [activeOrgId, store]);

  const reactivateMember = useCallback(async uid => {
    if (!activeOrgId) return;
    const result = await reactivateOrganizationMember(activeOrgId, uid);
    await store.refresh();
    return result;
  }, [activeOrgId, store]);
  return {
    org,
    members,
    loading,
    error,
    inviteMember,
    changeMemberRole,
    setMemberRate,
    setMemberPosition,
    getMemberRemovalImpact,
    deactivateMember,
    reactivateMember,
  };
}

// Called when a user signs in — checks if they have a pending invitation
// across all organizations in the multi-org environment.
export async function acceptPendingInvitation(uid, email) {
  try {
    if (!uid || !email || !auth.currentUser) return false;
    const result = await authenticatedRequest('/api/invitations/accept', {
      method: 'POST',
    }, 'Не вдалося прийняти запрошення');
    return result.accepted > 0;
  } catch (err) {
    // This is a best-effort check after sign-in. A missing/expired session is
    // already handled by the auth flow and must not surface as a console error.
    if (err?.status !== 401) reportLoadError('[acceptPendingInvitation]', err);
    return false;
  }
}
