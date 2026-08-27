import { NextResponse } from 'next/server';
import { authenticateRequest, getAdminAuth } from '@/lib/server/firebaseAdmin';

const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

export async function POST(request) {
  const authorization = await authenticateRequest(request);
  if (authorization.error) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const idToken = request.headers.get('authorization').slice('Bearer '.length).trim();
  const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
  });
  const response = NextResponse.json({ success: true });
  response.cookies.set('qt_session', sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('qt_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
