'use client';

import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

// The browser half of the client invite link. The raw token comes back exactly
// once, inside `url`; nothing stores it, so a link that is closed without being
// copied is gone and a new one has to be created.

export function createInviteLink({ organizationId, projectId, role }) {
  return authenticatedRequest(
    '/api/invitations/link',
    {
      method: 'POST',
      body: JSON.stringify({ organizationId, projectId, role }),
    },
    'Не вдалося створити посилання',
  );
}

export function revokeInviteLink({ organizationId, linkId }) {
  return authenticatedRequest(
    '/api/invitations/link',
    {
      method: 'DELETE',
      body: JSON.stringify({ organizationId, linkId }),
    },
    'Не вдалося відкликати посилання',
  );
}

// Unauthenticated on purpose: this is what the landing page asks before anyone
// has signed in, and holding the token is the whole authorization.
export async function readInviteLinkPreview(token) {
  const response = await fetch('/api/invitations/link/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Посилання недійсне або протерміноване');
  return result;
}

export function acceptInviteLink(token) {
  return authenticatedRequest(
    '/api/invitations/link/accept',
    {
      method: 'POST',
      body: JSON.stringify({ token }),
    },
    'Посилання недійсне або протерміноване',
  );
}
