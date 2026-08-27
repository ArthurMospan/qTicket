import { createHash } from 'crypto';

// Shared between the invite-link create and accept routes: Firestore stores
// only this hash, never the raw token (route files must not export helpers).
export function hashInviteToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}
