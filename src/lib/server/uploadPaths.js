import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';

// The pure path rules live in a plain module so they can be unit-tested;
// re-exported here so server routes have a single import.
export {
  UPLOAD_ROOT,
  isSafeStoragePath,
  isSafeUploadFolder,
  isOrganizationChatStoragePath,
  isOrganizationChatUploadFolder,
  organizationIdFromPath,
} from '@/lib/utils/uploadPaths.mjs';

// Membership check that does not require the caller to name the organization:
// it is read out of the path they are acting on, so they can never widen their
// own scope by passing a different organizationId.
export async function callerBelongsToPathOrganization(uid, organizationId) {
  if (!uid || !organizationId) return false;
  const snapshot = await getAdminDb()
    .collection('orgMemberships').doc(`${organizationId}_${uid}`).get();
  if (!snapshot.exists) return false;
  const membership = snapshot.data();
  return membership.orgId === organizationId && membership.userId === uid;
}
