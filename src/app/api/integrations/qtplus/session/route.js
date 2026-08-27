import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { readSealedRefreshToken, QTPLUS_CLIENT_ID } from '@/lib/server/qtplusLink';
import { exchangeGrantForToken } from '@/lib/portal/exchangeGrantForToken.mjs';

export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const refreshToken = await readSealedRefreshToken(authorization.user.uid);
    if (!refreshToken) {
      return NextResponse.json({ code: 'not_connected' }, { status: 404 });
    }

    const result = await exchangeGrantForToken({
      qtPlusUrl: process.env.NEXT_PUBLIC_QTPLUS_URL,
      clientId: QTPLUS_CLIENT_ID,
      clientSecret: process.env.QTPLUS_CLIENT_SECRET,
      refreshToken,
    });

    if (result.ok) return NextResponse.json({ customToken: result.customToken });
    if (result.code === 'grant_invalid') {
      // The stored link no longer maps to a live grant — the user must reconnect.
      return NextResponse.json({ code: 'grant_invalid' }, { status: 409 });
    }
    return NextResponse.json({ code: 'upstream' }, { status: 502 });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'QuickTeam+ session',
      fallbackMessage: 'Internal Server Error',
    });
  }
}
