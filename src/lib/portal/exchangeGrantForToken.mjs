/**
 * Pure server-side relay: grant -> qt /api/oauth/session -> custom token.
 * No `server-only` import so it is testable under plain `node --test`; the
 * route wrapper (Task 3) is what pulls in the admin SDK.
 */
export async function exchangeGrantForToken({
  qtPlusUrl, clientId, clientSecret, refreshToken, fetchImpl = globalThis.fetch,
}) {
  if (!qtPlusUrl || !clientSecret) return { ok: false, code: 'not_configured' };

  let res;
  try {
    res = await fetchImpl(new URL('/api/oauth/session', qtPlusUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, refreshToken }),
    });
  } catch (error) {
    console.error('[qtplus] session exchange request failed:', error.message);
    return { ok: false, code: 'upstream' };
  }

  if (res.status === 400) {
    const body = await res.json().catch(() => ({}));
    if (body.code === 'invalid_grant') return { ok: false, code: 'grant_invalid' };
    return { ok: false, code: 'upstream' };
  }
  if (!res.ok) {
    console.error('[qtplus] session exchange failed:', res.status);
    return { ok: false, code: 'upstream' };
  }

  const { customToken, qtUserId, email } = await res.json().catch(() => ({}));
  if (!customToken) return { ok: false, code: 'upstream' };
  return { ok: true, customToken, qtUserId, email: email || null };
}
