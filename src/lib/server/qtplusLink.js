import { FieldValue } from 'firebase-admin/firestore';
import 'server-only';

import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { seal, open } from '@/lib/server/secretBox.mjs';

export const QTPLUS_CLIENT_ID = 'quickteam-workspace';

// users/{uid}/private/qtplus — denied to every client by the rules, including
// the account's own owner. The sealed refresh token lives here and nowhere else.
function linkRef(uid) {
  return getAdminDb().collection('users').doc(uid).collection('private').doc('qtplus');
}

export async function getSessionUid(request) {
  const sessionCookie = request.cookies.get('qt_session')?.value;
  if (!sessionCookie) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** Deliberately never returns the token: nothing user-facing has a use for it. */
export async function readLink(uid) {
  const snap = await linkRef(uid).get();
  if (!snap.exists) return null;

  const data = snap.data();
  return {
    qtUserId: data.qtUserId,
    email: data.email || null,
    connectedAt: data.connectedAt?.toDate?.()?.toISOString() || null,
  };
}

export async function writeLink(uid, { qtUserId, email, refreshToken }) {
  await linkRef(uid).set({
    qtUserId,
    email: email || null,
    clientId: QTPLUS_CLIENT_ID,
    refreshTokenBox: seal(refreshToken),
    connectedAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Server-only: opens the sealed refresh token for relaying to QT+. Returns the
 * plaintext token or null. Deliberately separate from readLink, which never
 * exposes the token to anything user-facing.
 */
export async function readSealedRefreshToken(uid) {
  const snap = await linkRef(uid).get();
  if (!snap.exists) return null;
  try {
    return open(snap.data().refreshTokenBox);
  } catch (error) {
    console.error('[qtplus] could not open sealed token:', error.message);
    return null;
  }
}

/** Returns the token once so the caller can revoke it in QT+, then drops the doc. */
export async function deleteLink(uid) {
  const snap = await linkRef(uid).get();
  if (!snap.exists) return null;

  let refreshToken = null;
  try {
    refreshToken = open(snap.data().refreshTokenBox);
  } catch (error) {
    // An unopenable box (rotated key, corrupt data) must not strand the user
    // with a link they cannot remove. Drop it anyway; the grant is then
    // orphaned in QT+ and can only be revoked from there.
    console.error('[qtplus] could not open sealed token while disconnecting:', error.message);
  }

  await linkRef(uid).delete();
  return { refreshToken };
}
