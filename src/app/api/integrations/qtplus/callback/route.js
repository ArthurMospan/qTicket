import { NextResponse } from 'next/server';
import { getSessionUid, writeLink, QTPLUS_CLIENT_ID } from '@/lib/server/qtplusLink';
import { getSafeAuthRedirect } from '@/lib/utils/authRedirect';
import {
  getStateCookieOptions,
  QTPLUS_STATE_COOKIE,
  verifyQtPlusState,
} from '@/lib/server/oauthState.mjs';

// There is no dedicated QuickTeam+ settings section any more — connecting is
// done from the project that needs it. Errors still land in Settings, where the
// `qtplusError` handler raises the toast, but on the default section.
function settingsUrl(origin, params) {
  const url = new URL('/settings', origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request) {
  const response = await handleCallback(request);
  // Single use, cleared on every outcome including failures: a captured
  // callback URL must be dead on arrival the second time.
  response.cookies.set(QTPLUS_STATE_COOKIE, '', getStateCookieOptions(0));
  return response;
}

async function handleCallback(request) {
  const { origin, searchParams } = request.nextUrl;

  try {
    // Refuse anything we cannot tie to a flow this browser started, before
    // touching the code or the session.
    const state = verifyQtPlusState(
      searchParams.get('state') || '',
      request.cookies.get(QTPLUS_STATE_COOKIE)?.value || ''
    );
    if (!state) {
      console.warn('[qtplus] rejected callback: state did not match the nonce cookie');
      return settingsUrl(origin, { qtplusError: 'state' });
    }

    const code = searchParams.get('code');
    if (!code) return settingsUrl(origin, { qtplusError: 'no_code' });

    const uid = await getSessionUid(request);
    if (!uid) return settingsUrl(origin, { qtplusError: 'session' });

    const qtPlusUrl = process.env.NEXT_PUBLIC_QTPLUS_URL;
    const clientSecret = process.env.QTPLUS_CLIENT_SECRET;
    if (!qtPlusUrl || !clientSecret) {
      console.error('[qtplus] NEXT_PUBLIC_QTPLUS_URL or QTPLUS_CLIENT_SECRET is not configured');
      return settingsUrl(origin, { qtplusError: 'not_configured' });
    }

    // Server-to-server: the client secret never goes near the browser.
    const tokenRes = await fetch(new URL('/api/oauth/token', qtPlusUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        clientId: QTPLUS_CLIENT_ID,
        clientSecret,
        redirectUri: `${origin}/api/integrations/qtplus/callback`,
      }),
    });

    if (!tokenRes.ok) {
      console.error('[qtplus] token exchange failed:', tokenRes.status, await tokenRes.text());
      return settingsUrl(origin, { qtplusError: 'exchange' });
    }

    const { qtUserId, email, refreshToken } = await tokenRes.json();
    if (!qtUserId || !refreshToken) {
      console.error('[qtplus] token response missing qtUserId or refreshToken');
      return settingsUrl(origin, { qtplusError: 'exchange' });
    }

    await writeLink(uid, { qtUserId, email, refreshToken });

    const target = new URL(getSafeAuthRedirect(state.redirectTo, '/settings'), origin);
    target.searchParams.set('qtplus', 'connected');
    return NextResponse.redirect(target);
  } catch (error) {
    console.error('[qtplus] callback failed:', error);
    return settingsUrl(origin, { qtplusError: 'unexpected' });
  }
}
