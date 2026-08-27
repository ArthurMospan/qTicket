'use client';

import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

/**
 * What deleting this account would touch, and whether it is allowed at all.
 * An owner cannot delete themselves while they own a workspace nobody else can
 * administer, so the answer carries the organization names for the message.
 */
export async function fetchAccountDeletionImpact() {
  return authenticatedRequest(
    '/api/account',
    { cache: 'no-store' },
    'Не вдалося перевірити обліковий запис',
  );
}

/** Irreversible. The caller is expected to have confirmed it in words. */
export async function deleteAccount() {
  return authenticatedRequest(
    '/api/account',
    { method: 'DELETE' },
    'Не вдалося видалити обліковий запис',
  );
}
