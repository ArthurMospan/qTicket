import { NextResponse } from 'next/server';
import { getOneBRedirectUri } from '@/lib/utils/oneb';
import { getSafeAuthRedirect } from '@/lib/utils/authRedirect';
import {
  buildOneBState,
  createStateNonce,
  getStateCookieOptions,
  OAUTH_STATE_COOKIE,
} from '@/lib/server/oauthState.mjs';

const ONEB_AUTHORIZE_URL = 'https://account.oneb.app/oauth/authorize';

const DEFAULT_REDIRECT = {
  link: '/settings?section=auth-methods',
  login: '/',
};

function redirectWithError(origin, mode, error) {
  const target = new URL(mode === 'link' ? '/settings' : '/login', origin);
  if (mode === 'link') {
    target.searchParams.set('section', 'auth-methods');
    target.searchParams.set('authError', error);
  } else {
    target.searchParams.set('error', error);
  }
  return NextResponse.redirect(target);
}

/**
 * Entry point for the OneB authorization-code flow.
 *
 * This exists on the server rather than in the page because the flow needs a
 * CSRF nonce that the browser cannot read or forge: the nonce goes out in an
 * httpOnly cookie and, in parallel, inside `state`. /oauth2/result then refuses
 * any callback where the two disagree. Building the authorize URL in client
 * code cannot set that cookie, which is why the nonce it used to generate was
 * decorative and the callback was forgeable.
 */
export async function GET(request) {
  const { searchParams, origin } = request.nextUrl;
  const mode = searchParams.get('mode') === 'link' ? 'link' : 'login';
  const redirectTo = getSafeAuthRedirect(searchParams.get('r'), DEFAULT_REDIRECT[mode]);

  const clientId = process.env.NEXT_PUBLIC_ONEB_CLIENT_ID;
  if (!clientId || clientId === 'dummy_client_id') {
    console.error('[OneB] NEXT_PUBLIC_ONEB_CLIENT_ID is not configured');
    return redirectWithError(origin, mode, 'oneb_no_client_id');
  }

  const nonce = createStateNonce();
  const authorizeUrl = new URL(ONEB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', getOneBRedirectUri(origin));
  authorizeUrl.searchParams.set('state', buildOneBState({ mode, redirectTo, nonce }));

  const scopes = process.env.NEXT_PUBLIC_ONEB_SCOPES;
  if (scopes) authorizeUrl.searchParams.set('scope', scopes);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, getStateCookieOptions());
  return response;
}
