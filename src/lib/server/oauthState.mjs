import { randomBytes, timingSafeEqual } from 'node:crypto';

// Single-use CSRF nonce for the OneB authorization-code flow.
//
// The flow starts at /api/auth/oneb/start, which mints a nonce, puts it in this
// httpOnly cookie AND inside the `state` it sends to OneB. OneB echoes `state`
// back to /oauth2/result, which requires the two to match. An attacker can hand
// a victim a `code` and a `state` of their choosing, but cannot write this
// cookie into the victim's browser, so their state can never match.
export const OAUTH_STATE_COOKIE = 'qt_oauth_state';

// Long enough for a human to finish OneB's consent screen, short enough that a
// leaked nonce is not a lasting credential.
export const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export function createStateNonce() {
  return randomBytes(32).toString('base64url');
}

export function getStateCookieOptions(maxAge = OAUTH_STATE_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Must stay 'lax': OneB sends the user back with a top-level GET from
    // another origin, and 'strict' would withhold the cookie on exactly that
    // request — the one place we need it.
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

export function buildOneBState({ mode, redirectTo, nonce }) {
  return JSON.stringify({ mode: mode === 'link' ? 'link' : 'login', r: redirectTo, n: nonce });
}

export function nonceMatches(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  if (!expected || !received) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  // timingSafeEqual throws on a length mismatch, so the lengths must be
  // compared first. Length is not a secret; the nonce is fixed-width anyway.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Shape-checks the `state` echoed back by OneB. Returns null for anything that
 * is not a well-formed state carrying a nonce.
 *
 * `redirectTo` comes back raw and unsanitised on purpose — the caller owns
 * redirect safety (getSafeAuthRedirect). Sanitising here would quietly turn a
 * hostile value into a plausible one behind the caller's back.
 */
export function parseOneBState(stateRaw) {
  if (typeof stateRaw !== 'string' || !stateRaw) return null;

  const candidates = [stateRaw];
  try {
    const decoded = decodeURIComponent(stateRaw);
    if (decoded !== stateRaw) candidates.push(decoded);
  } catch {
    // A malformed percent-encoding just means the raw form is all we have.
  }

  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    // A state without a nonce is unverifiable, and an unverifiable state is
    // exactly the attacker's payload. There is no lenient fallback here.
    if (typeof parsed.n !== 'string' || !parsed.n) continue;

    return {
      mode: parsed.mode === 'link' ? 'link' : 'login',
      redirectTo: parsed.r,
      nonce: parsed.n,
    };
  }
  return null;
}

/**
 * The whole CSRF decision for the OneB callback, in one place: the state must
 * parse, and its nonce must equal the one this browser was given at the start
 * of the flow. Returns null when the callback must be refused.
 */
export function verifyOneBState(stateRaw, cookieNonce) {
  const parsed = parseOneBState(stateRaw);
  if (!parsed) return null;
  if (!nonceMatches(cookieNonce, parsed.nonce)) return null;
  return parsed;
}
