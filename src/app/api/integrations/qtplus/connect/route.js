import { NextResponse } from 'next/server';
import { getSessionUid, QTPLUS_CLIENT_ID } from '@/lib/server/qtplusLink';
import { getSafeAuthRedirect } from '@/lib/utils/authRedirect';
import {
  buildQtPlusState,
  createStateNonce,
  getStateCookieOptions,
  QTPLUS_STATE_COOKIE,
} from '@/lib/server/oauthState.mjs';

const SETTINGS = '/settings';

function settingsError(origin, error) {
  const url = new URL('/settings', origin);
  url.searchParams.set('qtplusError', error);
  return NextResponse.redirect(url);
}

/**
 * Starts the QuickTeam+ link.
 *
 * This lives on the server because the flow needs a CSRF nonce the browser can
 * neither read nor forge: it goes out in an httpOnly cookie and, in parallel,
 * inside `state`. The callback refuses any mismatch. Client code cannot set
 * that cookie — the same reason the OneB flow was forgeable until it moved here.
 */
export async function GET(request) {
  const { origin, searchParams } = request.nextUrl;

  const uid = await getSessionUid(request);
  if (!uid) return settingsError(origin, 'session');

  const qtPlusUrl = process.env.NEXT_PUBLIC_QTPLUS_URL;
  if (!qtPlusUrl) {
    console.error('[qtplus] NEXT_PUBLIC_QTPLUS_URL is not configured');
    return settingsError(origin, 'not_configured');
  }

  const redirectTo = getSafeAuthRedirect(searchParams.get('r'), SETTINGS);
  const nonce = createStateNonce();

  const authorizeUrl = new URL('/oauth/authorize', qtPlusUrl);
  authorizeUrl.searchParams.set('client_id', QTPLUS_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', `${origin}/api/integrations/qtplus/callback`);
  authorizeUrl.searchParams.set('state', buildQtPlusState({ redirectTo, nonce }));

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(QTPLUS_STATE_COOKIE, nonce, getStateCookieOptions());
  return response;
}
