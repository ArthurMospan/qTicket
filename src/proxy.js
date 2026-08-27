// src/proxy.js — server-side gate for development-only UI reference pages.
//
// Workspace authentication is intentionally resolved by Firebase on the
// client. Gating /workspace here creates a race when Firebase persistence is
// valid but the server session cookie has not been refreshed yet. API routes
// and Firestore rules remain the authoritative data-access boundary.
import { NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const isDevelopmentReferencePage =
    process.env.NODE_ENV === 'development'
    && pathname === '/ui-kit';

  // The internal reference page must remain usable while the product auth flow
  // is being developed or repaired. Production still requires a session.
  //
  // There used to be three of these. `/ui-diff` catalogued duplicate patterns
  // and `/ui-audit` listed the markup that bypasses the kit — both were reports
  // wearing a catalogue's clothes, and having three pages meant no single one
  // answered "what can I build with?". The audit still runs (`npm run kit:audit`)
  // and still fails the build; it just no longer has a screen nobody could read.
  if (isDevelopmentReferencePage) return NextResponse.next();

  const sessionCookie = request.cookies.get('qt_session')?.value;
  let hasSession = false;
  if (sessionCookie) {
    try {
      await getAdminAuth().verifySessionCookie(sessionCookie, true);
      hasSession = true;
    } catch {
      hasSession = false;
    }
  }

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    const response = NextResponse.redirect(loginUrl);
    if (sessionCookie) response.cookies.delete('qt_session');
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/ui-kit'],
};
