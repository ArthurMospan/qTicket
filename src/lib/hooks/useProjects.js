'use client';

// src/lib/hooks/useProjects.js — Real-time projects for authenticated user
// Filters by organizationId for multi-tenancy.
//
// Access model (per-project membership):
//   - owner/admin  → see every project in the organization
//   - member       → see only projects whose `team` array contains their uid
//     (the same `project.team` edited in BoardConfigModal and seeded with the
//      creator at /api/projects). This mirrors the authoritative Firestore
//      rule, which is why the member query MUST carry `array-contains` — rules
//      are not filters, so a broad org-wide query would be permission-denied.
//
// Project visibility (client portal, orthogonal to team access):
//   - 'internal' → only visible in qt-workspace (team only)
//   - 'shared'   → visible in both qt (client portal) and qt-workspace
import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { reportLoadError } from '@/lib/utils/errors';
import { firestoreDocumentData } from '@/lib/utils/firestoreDocument.mjs';
export function useProjects(userId, activeOrgId, orgRole) {
  const [projects, setProjects] = useState([]);
  const [error, setError] = useState(null);
  const [loadedOrganizationId, setLoadedOrganizationId] = useState(null);
  // Start as loading=true so callers don't flash an empty state
  // while auth/org context is still resolving.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Undefined means auth is still resolving; keep the loading state so the
    // projects page does not briefly render an empty state.
    if (userId === undefined) {
      queueMicrotask(() => setLoading(true));
      return;
    }
    // Null means auth resolved without a user.
    if (userId === null) {
      queueMicrotask(() => {
        setProjects([]);
        setError(null);
        setLoadedOrganizationId(null);
        setLoading(false);
      });
      return;
    }
    if (!activeOrgId) {
      // userId exists but orgId not yet resolved — keep loading
      return;
    }
    // Project records belong to exactly one organization. Keeping the previous
    // organization's array visible while the new query is still resolving can
    // make an old project route switch the workspace straight back to the old
    // organization. Clear the old scope before subscribing to the new one.
    queueMicrotask(() => {
      setProjects([]);
      setError(null);
      setLoadedOrganizationId(null);
      setLoading(true);
    });
    // Privileged roles see all org projects; everyone else (including an
    // as-yet-unresolved role) gets the restrictive team-scoped query so we
    // never over-expose while orgRole is still loading.
    const isPrivileged = orgRole === 'owner' || orgRole === 'admin';
    const q = isPrivileged
      ? query(collection(db, 'projects'), where('organizationId', '==', activeOrgId))
      : query(
          collection(db, 'projects'),
          where('organizationId', '==', activeOrgId),
          where('team', 'array-contains', userId),
        );
    const unsub = onSnapshot(q, {
      includeMetadataChanges: true,
    }, snap => {
      // Do not turn an unresolved empty cache into an empty workspace. A real
      // empty result is only authoritative when it came from the server.
      if (snap.empty && snap.metadata.fromCache) {
        setError(null);
        setLoading(true);
        return;
      }
      const docs = snap.docs.map(d => firestoreDocumentData(
        d,
        { serverTimestamps: 'estimate' },
      ));
      docs.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeB - timeA;
      });
      setProjects(docs);
      setError(null);
      setLoadedOrganizationId(activeOrgId);
      setLoading(false);
    }, err => {
      reportLoadError('[useProjects]', err);
      setError(err);
      setLoadedOrganizationId(activeOrgId);
      setLoading(false);
    });
    return () => unsub();
  }, [userId, activeOrgId, orgRole]);
  const scopeMatches = Boolean(activeOrgId) && loadedOrganizationId === activeOrgId;
  return {
    projects: scopeMatches ? projects : [],
    loading: userId === null ? loading : (loading || !scopeMatches),
    error: scopeMatches ? error : null,
  };
}

// Helper to check if a project should be visible in qt-workspace.
// Everything the team owns is visible here; undefined visibility is treated as
// 'internal', so it still shows in the workspace.
export function isWorkspaceProject(project) {
  return !project.visibility || project.visibility === 'internal' || project.visibility === 'shared';
}

// Helper to check if a project should be visible in the client portal (qt).
// Only an explicit 'shared' visibility exposes a project to the client — an
// undefined/legacy value is treated as 'internal' (never leaked to the portal).
export function isClientProject(project) {
  return project.visibility === 'shared';
}
