import { NextResponse } from 'next/server';
import {
  getOauthTokenCookieOptions,
  OAUTH_CUSTOM_TOKEN_COOKIE,
} from '@/lib/server/oauthTokenCookie';

function clearTokenCookie(response) {
  response.cookies.set(OAUTH_CUSTOM_TOKEN_COOKIE, '', getOauthTokenCookieOptions(0));
  return response;
}

export async function GET(request) {
  const token = request.cookies.get(OAUTH_CUSTOM_TOKEN_COOKIE)?.value || '';
  if (!token) {
    return clearTokenCookie(
      NextResponse.json({ error: 'No pending OAuth token' }, { status: 404 })
    );
  }

  return clearTokenCookie(NextResponse.json({ customToken: token }));
}
