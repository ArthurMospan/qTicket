import 'server-only';

export const OAUTH_CUSTOM_TOKEN_COOKIE = 'qt_oauth_custom_token';
export const OAUTH_CUSTOM_TOKEN_MAX_AGE_SECONDS = 2 * 60;

export function getOauthTokenCookieOptions(maxAge = OAUTH_CUSTOM_TOKEN_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}
