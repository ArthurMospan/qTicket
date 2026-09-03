import 'server-only';

import {
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  getFirestore,
} from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { isRejectedIdTokenError } from '@/lib/utils/firebaseAuthError.mjs';
import { hasActiveQuickTeamEntitlement, isQuickTeamManagedOrganization } from '@/lib/utils/quickTeamManaged.mjs';

function getAdminApp() {
  if (getApps().length) return getApp();

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID is not configured');

  // Missing credentials used to be entirely silent: the app initialised without
  // them and the first Firestore call failed instead, deep inside some route,
  // with a message about credentials that reads like a rules problem — an hour
  // of looking in the wrong file. Say it here, where the cause is, and say which
  // half is missing.
  //
  // Said rather than thrown, deliberately. Throwing would be the better error
  // and the worse failure: this runs on every server request, so a deployment
  // whose variables were named slightly differently would go from degraded to
  // completely down, and the emulator legitimately needs no credentials at all.
  // A line in the log costs nothing and is enough to find this in one search.
  if (!process.env.FIRESTORE_EMULATOR_HOST && !(clientEmail && privateKey)) {
    console.error('[firebase-admin] No service-account credentials configured', {
      hasClientEmail: Boolean(clientEmail),
      hasPrivateKey: Boolean(privateKey),
      projectId,
      note: 'Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY. Every Admin SDK call will fail without them.',
    });
  }

  const options = { projectId };
  if (clientEmail && privateKey) {
    options.credential = cert({ projectId, clientEmail, privateKey });
  }

  return initializeApp(options);
}

export function getAdminAuth() {
  return getAuth(getAdminApp());
}

export function getAdminDb() {
  return getFirestore(getAdminApp());
}

export async function authenticateRequest(request) {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    console.error('[auth] Missing bearer token', {
      hasAuthorizationHeader: Boolean(authorization),
      scheme: authorization.split(' ', 1)[0] || '',
    });
    return { error: 'Unauthorized', status: 401 };
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    console.error('[auth] Empty bearer token');
    return { error: 'Unauthorized', status: 401 };
  }

  try {
    return { user: await getAdminAuth().verifyIdToken(token, true) };
  } catch (error) {
    const firebaseCode = error?.code || '';
    const tokenWasRejected = isRejectedIdTokenError(error);
    // Never log the bearer token. The Firebase error code is enough to tell an
    // actually expired/revoked session from an Admin SDK credential or project
    // mismatch, which otherwise collapses into the same user-facing 401.
    console.error('[auth] Firebase ID token rejected', {
      code: firebaseCode || 'unknown',
      name: error?.name || error?.constructor?.name || 'Error',
      message: typeof error?.message === 'string'
        ? error.message.slice(0, 240)
        : '',
      causeCode: error?.cause?.code || '',
      expectedProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    });
    if (tokenWasRejected) {
      return {
        error: 'Invalid or expired token',
        status: 401,
        code: firebaseCode,
      };
    }
    return {
      error: 'Authentication service is temporarily unavailable',
      status: 503,
      code: 'AUTH_SERVICE_UNAVAILABLE',
    };
  }
}

// `identity` is an `authenticateRequest` result a route has already obtained.
// A route that must read a document to learn which organization to authorize
// against verifies the token *before* that read — otherwise the read is made
// on behalf of nobody, at any rate an anonymous caller likes, against a project
// on a daily read cap — and passing the result here means the token is
// verified once, not twice.
export async function authorizeOrgRequest(request, organizationId, allowedRoles = [], { identity } = {}) {
  const authResult = identity?.user ? identity : await authenticateRequest(request);
  if (authResult.error) return authResult;
  if (!organizationId) return { error: 'Organization is required', status: 400 };

  const db = getAdminDb();
  const membershipId = `${organizationId}_${authResult.user.uid}`;
  const [membershipSnap, organizationSnap] = await Promise.all([
    db.collection('orgMemberships').doc(membershipId).get(),
    db.collection('organizations').doc(organizationId).get(),
  ]);
  if (!membershipSnap.exists) return { error: 'Forbidden', status: 403 };
  if (!organizationSnap.exists || !isQuickTeamManagedOrganization(organizationSnap.data())) {
    return { error: 'Організацію qTicket не підключено через QuickTeam', status: 403, code: 'QTICKET_NOT_PROVISIONED' };
  }
  if (!hasActiveQuickTeamEntitlement(organizationSnap.data())) {
    return { error: 'qTicket не активовано для цієї організації', status: 403, code: 'QTICKET_INACTIVE' };
  }

  const membership = membershipSnap.data();
  if (
    membership.orgId !== organizationId ||
    membership.userId !== authResult.user.uid ||
    (allowedRoles.length > 0 && !allowedRoles.includes(membership.role))
  ) {
    return { error: 'Forbidden', status: 403 };
  }

  return { user: authResult.user, membership, organization: organizationSnap.data() || null };
}

export async function enforceRateLimit(scope, subject, limit, windowSeconds) {
  const id = `${scope}_${createHash('sha256').update(String(subject)).digest('hex').slice(0, 32)}`;
  const ref = getAdminDb().collection('serverRateLimits').doc(id);
  const now = Date.now();
  return getAdminDb().runTransaction(async transaction => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? snap.data() : null;
    const resetAt = data?.resetAt?.toMillis?.() ?? 0;
    if (!data || resetAt <= now) {
      transaction.set(ref, {
        count: 1,
        resetAt: Timestamp.fromMillis(now + windowSeconds * 1000),
      });
      return true;
    }
    if ((data.count || 0) >= limit) return false;
    transaction.update(ref, { count: FieldValue.increment(1) });
    return true;
  });
}

export { FieldPath, FieldValue, Timestamp };
