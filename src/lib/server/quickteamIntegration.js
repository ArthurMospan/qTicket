import 'server-only';

import { FieldValue, Timestamp, getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  QUICKTEAM_SIGNATURE_WINDOW_SECONDS,
  quickTeamIdentityId,
  quickTeamNonceId,
  quickTeamStaffUid,
  verifyQuickTeamRequest,
} from '@/lib/integrations/quickteamContract.mjs';

const MAX_SIGNED_BODY_BYTES = 256 * 1024;

function authUserPatch(member, includeEmail) {
  return {
    ...(includeEmail ? { email: member.email, emailVerified: true } : {}),
    displayName: member.name,
    ...(member.avatar && /^https:\/\//i.test(member.avatar) ? { photoURL: member.avatar } : {}),
    disabled: false,
  };
}

/**
 * Verify a signed QuickTeam request and return its parsed body.
 *
 * `recordNonce` is on for everything that changes something here — a replayed
 * provisioning snapshot or launch mint must be refused, and the nonce document
 * is what refuses it. A read-only endpoint passes `false` deliberately: the
 * unread badge is asked on every rail mount, a nonce costs a transaction with a
 * write in it, and writes are the tighter of the two free-tier budgets. What a
 * replay of a read buys an attacker who already holds the signed bytes is the
 * number they already had. The signature and the five-minute window still
 * apply, so this is not an unsigned door.
 */
export async function readSignedQuickTeamRequest(request, { recordNonce = true } = {}) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_SIGNED_BODY_BYTES) {
    return { error: 'Payload too large', status: 413, code: 'payload_too_large' };
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_SIGNED_BODY_BYTES) {
    return { error: 'Payload too large', status: 413, code: 'payload_too_large' };
  }

  const timestamp = request.headers.get('x-qt-timestamp') || '';
  const nonce = request.headers.get('x-qt-nonce') || '';
  const signature = request.headers.get('x-qt-signature') || '';
  const verification = verifyQuickTeamRequest({
    secret: process.env.QUICKTEAM_QTICKET_SHARED_SECRET,
    timestamp,
    nonce,
    signature,
    body: rawBody,
  });
  if (!verification.ok) {
    const configuration = verification.code === 'configuration';
    return {
      error: configuration ? 'QuickTeam integration is not configured' : 'Invalid integration signature',
      status: configuration ? 503 : 401,
      code: verification.code,
    };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { error: 'Invalid JSON', status: 400, code: 'invalid_json' };
  }

  if (!recordNonce) return { body };

  const db = getAdminDb();
  const nonceRef = db.collection('integrationNonces').doc(quickTeamNonceId(nonce));
  try {
    await db.runTransaction(async transaction => {
      const existing = await transaction.get(nonceRef);
      if (existing.exists) throw Object.assign(new Error('Replay'), { code: 'REPLAY' });
      transaction.create(nonceRef, {
        provider: 'quickteam',
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(
          (verification.timestamp + QUICKTEAM_SIGNATURE_WINDOW_SECONDS * 2) * 1000,
        ),
      });
    });
  } catch (error) {
    if (error?.code === 'REPLAY') {
      return { error: 'Integration request was already used', status: 409, code: 'replay' };
    }
    throw error;
  }

  return { body };
}

async function findOrCreateAuthUser(member, knownUid = '') {
  const auth = getAdminAuth();
  let user = null;
  if (knownUid) {
    user = await auth.getUser(knownUid).catch(error => {
      if (error?.code === 'auth/user-not-found') return null;
      throw error;
    });
  }
  if (!user) {
    user = await auth.getUserByEmail(member.email).catch(error => {
      if (error?.code === 'auth/user-not-found') return null;
      throw error;
    });
  }
  if (!user) {
    const uid = quickTeamStaffUid(member.sourceUserId);
    try {
      user = await auth.createUser({ uid, ...authUserPatch(member, true) });
    } catch (error) {
      if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error?.code)) throw error;
      user = error.code === 'auth/email-already-exists'
        ? await auth.getUserByEmail(member.email)
        : await auth.getUser(uid);
    }
  }
  return auth.updateUser(user.uid, authUserPatch(member, user.email === member.email));
}

export async function resolveQuickTeamStaff(staff) {
  const db = getAdminDb();
  return Promise.all(staff.map(async member => {
    const identityRef = db.collection('quickTeamIdentities').doc(
      quickTeamIdentityId(member.sourceUserId),
    );
    const identity = await identityRef.get();
    const authUser = await findOrCreateAuthUser(member, identity.data()?.qTicketUserId || '');
    return {
      ...member,
      qTicketUserId: authUser.uid,
      identityRef,
      identityExists: identity.exists,
    };
  }));
}
