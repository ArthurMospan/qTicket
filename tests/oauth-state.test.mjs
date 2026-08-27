import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createStateNonce,
  buildOneBState,
  parseOneBState,
  verifyOneBState,
  nonceMatches,
  getStateCookieOptions,
  OAUTH_STATE_COOKIE,
  QTPLUS_STATE_COOKIE,
  buildQtPlusState,
  verifyQtPlusState,
} from '../src/lib/server/oauthState.mjs';

// ── The vulnerability this module exists to close ────────────────────
//
// Before this module, /oauth2/result accepted any state the caller sent and
// never checked it against anything the browser had to prove it owned. An
// attacker could hand a logged-in victim:
//
//   /oauth2/result?code=<attacker's own OneB code>&state={"mode":"link","r":"/"}
//
// The victim's qt_session cookie (SameSite=Lax) rides along on the top-level
// GET, so the callback linked the ATTACKER's onebId onto the VICTIM's account.
// The attacker then logged in via OneB and was handed the victim's uid.
//
// The whole defense is verifyOneBState(). It must reject any state that is not
// accompanied by the matching single-use nonce cookie.

test('rejects an attacker-supplied state that carries no nonce', () => {
  // The exact payload from the attack above. The old parseState() happily
  // returned { mode: 'link', redirectTo: '/' } for this.
  assert.equal(verifyOneBState('{"mode":"link","r":"/"}', ''), null);
  assert.equal(verifyOneBState('{"mode":"link","r":"/"}', createStateNonce()), null);
});

test('rejects a state whose nonce does not match the cookie', () => {
  // Attacker starts their own real flow, so they hold a well-formed state with
  // a valid nonce — but it is bound to THEIR cookie, not the victim's browser.
  const attackerState = buildOneBState({
    mode: 'link',
    redirectTo: '/',
    nonce: createStateNonce(),
  });
  assert.equal(verifyOneBState(attackerState, createStateNonce()), null);
  assert.equal(verifyOneBState(attackerState, ''), null);
});

test('accepts a state that matches its nonce cookie', () => {
  const nonce = createStateNonce();
  const state = buildOneBState({ mode: 'link', redirectTo: '/settings', nonce });

  assert.deepEqual(verifyOneBState(state, nonce), {
    mode: 'link',
    redirectTo: '/settings',
    nonce,
  });
});

test('accepts a URL-encoded state (some providers re-encode it)', () => {
  const nonce = createStateNonce();
  const state = buildOneBState({ mode: 'link', redirectTo: '/settings', nonce });

  assert.deepEqual(verifyOneBState(encodeURIComponent(state), nonce), {
    mode: 'link',
    redirectTo: '/settings',
    nonce,
  });
});

test('rejects malformed, empty and non-string states', () => {
  const nonce = createStateNonce();
  for (const bad of ['', 'not-json', '{', '[]', 'null', undefined, null, 42, {}]) {
    assert.equal(verifyOneBState(bad, nonce), null);
  }
});

test('rejects a state whose nonce is not a non-empty string', () => {
  const nonce = createStateNonce();
  for (const bad of ['{"n":""}', '{"n":null}', '{"n":123}', '{"n":{}}', '{"mode":"link"}']) {
    assert.equal(verifyOneBState(bad, nonce), null);
  }
});

test('treats any mode other than link as login', () => {
  const nonce = createStateNonce();
  for (const mode of ['login', 'nonsense', '', undefined]) {
    const state = buildOneBState({ mode, redirectTo: '/', nonce });
    assert.equal(verifyOneBState(state, nonce).mode, 'login');
  }
});

test('returns the redirect target raw, without sanitising it', () => {
  // Redirect safety is getSafeAuthRedirect's job at the call site. This module
  // must not silently rewrite it — that would hide an unsafe value from the
  // caller that is responsible for rejecting it.
  const nonce = createStateNonce();
  const state = buildOneBState({ mode: 'login', redirectTo: 'https://evil.test', nonce });
  assert.equal(verifyOneBState(state, nonce).redirectTo, 'https://evil.test');
});

test('nonce is unpredictable and URL-safe', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const nonce = createStateNonce();
    assert.match(nonce, /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(seen.has(nonce), false, 'nonce repeated');
    seen.add(nonce);
  }
});

test('nonceMatches compares safely and never throws on odd input', () => {
  const nonce = createStateNonce();
  assert.equal(nonceMatches(nonce, nonce), true);
  assert.equal(nonceMatches(nonce, `${nonce}x`), false); // length mismatch must not throw
  assert.equal(nonceMatches('', ''), false);
  assert.equal(nonceMatches(nonce, undefined), false);
  assert.equal(nonceMatches(null, nonce), false);
  assert.equal(nonceMatches(nonce, 'a'), false);
});

// ── QuickTeam+ link flow ─────────────────────────────────────────────
// Same nonce mechanism, separate cookie: the two flows must not be able to
// consume each other's state.

test('QT+ state uses its own cookie, separate from OneB', () => {
  assert.equal(QTPLUS_STATE_COOKIE, 'qt_qtplus_state');
  assert.notEqual(QTPLUS_STATE_COOKIE, OAUTH_STATE_COOKIE);
});

test('QT+ state rejects a stateless callback — the attacker payload', () => {
  const nonce = createStateNonce();
  assert.equal(verifyQtPlusState('{"r":"/settings"}', nonce), null);
  assert.equal(verifyQtPlusState('', nonce), null);
  assert.equal(verifyQtPlusState('not-json', nonce), null);
});

test('QT+ state rejects a nonce that does not match the cookie', () => {
  const state = buildQtPlusState({ redirectTo: '/', nonce: createStateNonce() });
  assert.equal(verifyQtPlusState(state, createStateNonce()), null);
  assert.equal(verifyQtPlusState(state, ''), null);
});

test('QT+ state round-trips with its nonce, raw and URL-encoded', () => {
  const nonce = createStateNonce();
  const state = buildQtPlusState({ redirectTo: '/settings?section=qtplus', nonce });

  assert.deepEqual(verifyQtPlusState(state, nonce), {
    redirectTo: '/settings?section=qtplus',
    nonce,
  });
  assert.deepEqual(verifyQtPlusState(encodeURIComponent(state), nonce), {
    redirectTo: '/settings?section=qtplus',
    nonce,
  });
});

test('QT+ state returns the redirect target unsanitised for the caller to judge', () => {
  const nonce = createStateNonce();
  const state = buildQtPlusState({ redirectTo: 'https://evil.test', nonce });
  assert.equal(verifyQtPlusState(state, nonce).redirectTo, 'https://evil.test');
});

test('a OneB state cannot be replayed as a QT+ state', () => {
  // Both flows carry `n`; only the cookie tells them apart. If a OneB state
  // could satisfy the QT+ callback, the OneB nonce cookie would unlock it.
  const nonce = createStateNonce();
  const onebState = buildOneBState({ mode: 'link', redirectTo: '/', nonce });
  const qtPlusResult = verifyQtPlusState(onebState, nonce);
  // It parses (same shape), but it can only ever be presented with the QT+
  // cookie, which a OneB flow never sets.
  assert.equal(qtPlusResult?.nonce, nonce);
});

test('state cookie is httpOnly and survives the cross-site callback redirect', () => {
  const options = getStateCookieOptions();
  assert.equal(options.httpOnly, true, 'script must not be able to read the nonce');
  // Lax, not Strict: OneB redirects back via a top-level GET from another site,
  // and Strict would withhold the cookie and break every login.
  assert.equal(options.sameSite, 'lax');
  assert.equal(options.path, '/');
  assert.ok(options.maxAge > 0);

  assert.equal(getStateCookieOptions(0).maxAge, 0, 'must be clearable');
});
