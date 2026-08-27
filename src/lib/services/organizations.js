'use client';

import { auth } from '@/lib/firebase';

/**
 * Creates a workspace and the owner's seat in it.
 *
 * Both documents used to be written from the browser, which is why «one free
 * workspace per account» was a greyed-out card and nothing else: a Firestore
 * rule cannot count how many organizations somebody already owns.
 */
export async function createOrganization({ name, logo = '', plan, timezone }) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch('/api/organizations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, logo, plan, timezone }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не вдалося створити організацію');
  return result.organizationId;
}

export async function transferOrganizationOwnership(organizationId, targetUserId) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'transfer-ownership', targetUserId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to transfer ownership');
  return result;
}
