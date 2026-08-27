'use client';

import { auth } from '@/lib/firebase';
import { createResponseError } from '@/lib/utils/errors';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

const memberCache = new Map();
const CACHE_MS = 10_000;
const STALE_CACHE_MS = 24 * 60 * 60 * 1000;

function memberUrl(organizationId, memberId) {
  return `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(memberId)}`;
}

function persistentCacheKey(cacheKey) {
  return `quickteam:members:${cacheKey}`;
}

function readPersistentMembers(cacheKey) {
  if (typeof window === 'undefined') return null;
  try {
    const cached = JSON.parse(window.localStorage.getItem(persistentCacheKey(cacheKey)) || 'null');
    if (!cached || !Array.isArray(cached.members) || Date.now() - cached.createdAt > STALE_CACHE_MS) return null;
    return cached.members;
  } catch {
    return null;
  }
}

function writePersistentMembers(cacheKey, members) {
  if (typeof window === 'undefined') return;
  try {
    const publicMembers = members.map(({ hourlyRate, ...member }) => member);
    window.localStorage.setItem(persistentCacheKey(cacheKey), JSON.stringify({
      createdAt: Date.now(),
      members: publicMembers,
    }));
  } catch {
    // Storage can be unavailable in privacy mode; the in-memory cache still works.
  }
}

export async function fetchOrganizationMembers(
  organizationId,
  { force = false, cacheScope = '' } = {},
) {
  if (!organizationId) return [];
  await auth.authStateReady?.();
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Authentication required');
  // The directory is role-filtered: owner/admin responses include billing
  // rates, member responses do not. A role change in the same browser must not
  // be allowed to fall back to a privileged persistent response.
  const cacheKey = `${organizationId}_${currentUser.uid}_${cacheScope || 'default'}`;
  const cached = memberCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.createdAt < CACHE_MS) return cached.promise;

  const requestMembers = async forceRefresh => {
    const token = await currentUser.getIdToken(forceRefresh);
    return fetch(`/api/organizations/${encodeURIComponent(organizationId)}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  };

  const promise = requestMembers(false)
    .then(response => (response.status === 401 ? requestMembers(true) : response))
    .then(async response => {
      const result = await response.json();
      if (!response.ok) throw createResponseError(response, result, 'Failed to load organization members');
      const members = result.members || [];
      writePersistentMembers(cacheKey, members);
      return members;
    })
    .catch(error => {
      memberCache.delete(cacheKey);
      const staleMembers = readPersistentMembers(cacheKey);
      if (staleMembers) return staleMembers;
      throw error;
    });
  memberCache.set(cacheKey, { createdAt: Date.now(), promise });
  return promise;
}

export function invalidateOrganizationMembers(organizationId) {
  for (const key of memberCache.keys()) {
    if (key.startsWith(`${organizationId}_`)) memberCache.delete(key);
  }
}

export async function fetchMemberRemovalImpact(organizationId, memberId) {
  return authenticatedRequest(
    memberUrl(organizationId, memberId),
    { cache: 'no-store' },
    'Не вдалося перевірити доступ учасника',
  );
}

export async function updateOrganizationMember(organizationId, memberId, update) {
  const result = await authenticatedRequest(
    memberUrl(organizationId, memberId),
    { method: 'PATCH', body: JSON.stringify(update) },
    'Не вдалося оновити учасника',
  );
  invalidateOrganizationMembers(organizationId);
  return result;
}

/**
 * Closes someone's access without touching their work. The same call serves
 * «Забрати доступ» and «Вийти з організації» — the server tells the two apart
 * by whether the id is the caller's own.
 */
export async function deactivateOrganizationMember(organizationId, memberId) {
  const result = await authenticatedRequest(
    memberUrl(organizationId, memberId),
    { method: 'DELETE' },
    'Не вдалося забрати доступ',
  );
  invalidateOrganizationMembers(organizationId);
  return result;
}

/** Gives an archived seat back: same role, same position, same projects. */
export async function reactivateOrganizationMember(organizationId, memberId) {
  const result = await authenticatedRequest(
    memberUrl(organizationId, memberId),
    { method: 'PATCH', body: JSON.stringify({ action: 'reactivate' }) },
    'Не вдалося повернути доступ',
  );
  invalidateOrganizationMembers(organizationId);
  return result;
}
