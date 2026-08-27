import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  getOauthTokenCookieOptions,
  OAUTH_CUSTOM_TOKEN_COOKIE,
} from '@/lib/server/oauthTokenCookie';
import { getSafeAuthRedirect } from '@/lib/utils/authRedirect';
import { normalizeEmail } from '@/lib/server/emailOtp';
import { getOneBRedirectUri } from '@/lib/utils/oneb';
import {
  getStateCookieOptions,
  OAUTH_STATE_COOKIE,
  verifyOneBState,
} from '@/lib/server/oauthState.mjs';

const ONEB_API_URI = (process.env.ONEB_API_URI || 'https://account.oneb.app/s/').replace(/\/?$/, '/');
const ONEB_SYNTHETIC_EMAIL_DOMAIN = 'oneb.quickteam.app';

function redirectWithError(origin, error) {
  const loginUrl = new URL('/login', origin);
  loginUrl.searchParams.set('error', error);
  return NextResponse.redirect(loginUrl);
}

function redirectSettingsWithError(origin, error) {
  const settingsUrl = new URL('/settings', origin);
  settingsUrl.searchParams.set('section', 'auth-methods');
  settingsUrl.searchParams.set('authError', error);
  return NextResponse.redirect(settingsUrl);
}

function onebHash(accountId) {
  return createHash('sha256').update(String(accountId)).digest('hex');
}

function onebUid(accountId) {
  return `oneb_${onebHash(accountId).slice(0, 48)}`;
}

function syntheticOneBEmail(accountId) {
  return `oneb_${onebHash(accountId).slice(0, 32)}@${ONEB_SYNTHETIC_EMAIL_DOMAIN}`;
}

function isSyntheticOneBEmail(email) {
  return typeof email === 'string' && email.endsWith(`@${ONEB_SYNTHETIC_EMAIL_DOMAIN}`);
}

async function getOrCreateOneBUser(profile, resolvedEmail) {
  const auth = getAdminAuth();
  const db = getAdminDb();
  const displayName = profile.name || profile.alias || 'OneB User';
  const photoURL = normalizeUrl(profile.photoUrl);

  const onebProfileSnap = await db.collection('users')
    .where('onebId', '==', profile.accountId)
    .limit(1)
    .get();
  if (!onebProfileSnap.empty) {
    const uid = onebProfileSnap.docs[0].id;
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
      userRecord = await auth.createUser({
        uid,
        email: resolvedEmail,
        emailVerified: true,
        displayName,
        ...(photoURL ? { photoURL } : {}),
      });
    }
    return updateOneBUser(userRecord, profile, resolvedEmail, displayName, photoURL);
  }

  const normalizedRealEmail = normalizeEmail(profile.email);
  if (normalizedRealEmail) {
    try {
      const userRecord = await auth.getUserByEmail(normalizedRealEmail);
      if (userRecord.disabled) throw new Error('Firebase user is disabled');
      return updateOneBUser(userRecord, profile, normalizedRealEmail, displayName, photoURL);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }
  }

  const uid = onebUid(profile.accountId);
  try {
    const userRecord = await auth.getUser(uid);
    if (userRecord.disabled) throw new Error('Firebase user is disabled');
    return updateOneBUser(userRecord, profile, resolvedEmail, displayName, photoURL);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
  }

  const created = await auth.createUser({
    uid,
    email: resolvedEmail,
    emailVerified: true,
    displayName,
    ...(photoURL ? { photoURL } : {}),
  });
  return updateOneBUser(created, profile, resolvedEmail, displayName, photoURL);
}

async function findOneBLinkedUid(accountId) {
  const snap = await getAdminDb().collection('users')
    .where('onebId', '==', accountId)
    .where('onebConnected', '==', true)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

async function getSessionUser(request) {
  const sessionCookie = request.cookies.get('qt_session')?.value;
  if (!sessionCookie) return null;
  try {
    const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
    return await getAdminAuth().getUser(decoded.uid);
  } catch {
    return null;
  }
}

async function updateOneBUser(userRecord, profile, resolvedEmail, displayName, photoURL, options = {}) {
  const auth = getAdminAuth();
  const update = {
    emailVerified: true,
  };
  const nextDisplayName = options.preserveProfile && userRecord.displayName
    ? userRecord.displayName
    : displayName;
  if (nextDisplayName) update.displayName = nextDisplayName;
  if (photoURL && !(options.preserveProfile && userRecord.photoURL)) update.photoURL = photoURL;
  if (
    (!options.preserveEmail || !userRecord.email) &&
    resolvedEmail &&
    userRecord.email !== resolvedEmail &&
    (!userRecord.email || !isSyntheticOneBEmail(resolvedEmail))
  ) {
    update.email = resolvedEmail;
  }

  let nextUserRecord = userRecord;
  try {
    nextUserRecord = await auth.updateUser(userRecord.uid, update);
  } catch (error) {
    if (error.code !== 'auth/email-already-exists') throw error;
    delete update.email;
    nextUserRecord = await auth.updateUser(userRecord.uid, update);
  }

  await auth.setCustomUserClaims(nextUserRecord.uid, {
    ...(nextUserRecord.customClaims || {}),
    oneb_id: profile.accountId,
    oneb_connected: true,
  });

  const userRef = getAdminDb().collection('users').doc(nextUserRecord.uid);
  const userSnap = await userRef.get();
  const existingProfile = userSnap.exists ? userSnap.data() : {};
  const nowIso = new Date().toISOString();
  const profileData = {
    id: nextUserRecord.uid,
    name: options.preserveProfile && existingProfile.name ? existingProfile.name : displayName,
    email: nextUserRecord.email || resolvedEmail,
    // Empty rather than a third-party placeholder: storing an i.pravatar.cc URL
    // on the profile leaked the uid off-platform and made avatars depend on an
    // unrelated service. UserAvatar renders initials when this is empty.
    avatar: options.preserveProfile && existingProfile.avatar
      ? existingProfile.avatar
      : (photoURL || nextUserRecord.photoURL || ''),
    photoURL: options.preserveProfile && existingProfile.photoURL
      ? existingProfile.photoURL
      : (photoURL || nextUserRecord.photoURL || null),
    onebId: profile.accountId,
    onebConnected: true,
    onebAlias: profile.alias ?? null,
    onebWorkspace: profile.workspace ?? null,
    onebWorkspaceId: profile.tenantId ?? null,
    authProvider: 'oneb',
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!userSnap.exists) {
    profileData.role = 'user';
    profileData.createdAt = nowIso;
    profileData.lastActive = nowIso;
  }
  await userRef.set(profileData, { merge: true });

  return nextUserRecord;
}

function normalizeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function GET(request) {
  const response = await handleOneBCallback(request);
  // The nonce is single use. Clearing it on every outcome — including failures
  // and the 500 path — stops a captured callback URL from being replayed.
  response.cookies.set(OAUTH_STATE_COOKIE, '', getStateCookieOptions(0));
  return response;
}

async function handleOneBCallback(request) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');

  if (!code) return redirectWithError(origin, 'oneb_no_code');

  // Refuse any callback we cannot tie to a flow this browser actually started.
  // Without this, an attacker's `code` + hand-written `state` rode in on the
  // victim's session cookie and linked the attacker's OneB identity onto the
  // victim's account — a full account takeover from one click.
  const state = verifyOneBState(
    searchParams.get('state') || '',
    request.cookies.get(OAUTH_STATE_COOKIE)?.value || ''
  );
  if (!state) {
    console.warn('[OneB] Rejected callback: state did not match the nonce cookie');
    return redirectWithError(origin, 'oneb_state');
  }

  const { mode } = state;
  const redirectTo = getSafeAuthRedirect(state.redirectTo, '/');

  const clientId = process.env.NEXT_PUBLIC_ONEB_CLIENT_ID;
  const clientSecret = process.env.ONEB_CLIENT_SECRET;
  const redirectUri = getOneBRedirectUri(origin);

  if (!clientId || clientId === 'dummy_client_id') {
    console.error('[OneB] NEXT_PUBLIC_ONEB_CLIENT_ID is not configured');
    return redirectWithError(origin, 'oneb_no_client_id');
  }
  if (!clientSecret) {
    console.error('[OneB] ONEB_CLIENT_SECRET is not configured');
    return redirectWithError(origin, 'oneb_no_client_secret');
  }

  try {
    const tokenRes = await fetch(`${ONEB_API_URI}token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[OneB] Token exchange failed:', await tokenRes.text());
      return redirectWithError(origin, 'oneb_token');
    }

    const tokenData = await tokenRes.json();
    const profileRes = await fetch(`${ONEB_API_URI}auth/v1/user-details`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      console.error('[OneB] Profile fetch failed:', await profileRes.text());
      return redirectWithError(origin, 'oneb_profile');
    }

    const profile = await profileRes.json();
    if (!profile.accountId) {
      return redirectWithError(origin, 'oneb_no_account');
    }

    const resolvedEmail = normalizeEmail(profile.email) || syntheticOneBEmail(profile.accountId);
    if (mode === 'link') {
      const sessionUser = await getSessionUser(request);
      if (!sessionUser) return redirectSettingsWithError(origin, 'oneb_session');

      const linkedUid = await findOneBLinkedUid(profile.accountId);
      if (linkedUid && linkedUid !== sessionUser.uid) {
        return redirectSettingsWithError(origin, 'oneb_already_linked');
      }

      await updateOneBUser(
        sessionUser,
        profile,
        sessionUser.email || resolvedEmail,
        profile.name || profile.alias || sessionUser.displayName || 'OneB User',
        normalizeUrl(profile.photoUrl),
        { preserveEmail: true, preserveProfile: true }
      );
      const settingsUrl = new URL(redirectTo, origin);
      settingsUrl.searchParams.set('section', 'auth-methods');
      settingsUrl.searchParams.set('auth', 'oneb_connected');
      return NextResponse.redirect(settingsUrl);
    }

    const userRecord = await getOrCreateOneBUser(profile, resolvedEmail);
    const customToken = await getAdminAuth().createCustomToken(userRecord.uid, {
      auth_provider: 'oneb',
    });

    const loginUrl = new URL('/login', origin);
    loginUrl.searchParams.set('oneb', 'success');
    loginUrl.searchParams.set('next', redirectTo);
    const response = NextResponse.redirect(loginUrl);
    response.cookies.set(
      OAUTH_CUSTOM_TOKEN_COOKIE,
      customToken,
      getOauthTokenCookieOptions()
    );
    return response;
  } catch (error) {
    console.error('[OneB] Unexpected error:', error);
    return redirectWithError(origin, 'oneb_unexpected');
  }
}
