'use client';

import { auth } from '@/lib/firebase';

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
