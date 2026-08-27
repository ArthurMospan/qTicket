import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  InvalidJsonBodyError,
  readJsonBody,
  routeErrorResponse,
} from '@/lib/server/apiErrors';
import { enforceRateLimit } from '@/lib/server/firebaseAdmin';
import {
  createEmailOtp,
  EMAIL_OTP_TTL_SECONDS,
  getEmailOtpRef,
  hashEmailOtp,
  normalizeEmail,
  sendEmailOtp,
} from '@/lib/server/emailOtp';

const EMAIL_LOGIN_ENABLED = process.env.EMAIL_LOGIN_ENABLED === 'true';

export async function POST(request) {
  try {
    if (!EMAIL_LOGIN_ENABLED) {
      return NextResponse.json({ error: 'Email login is temporarily disabled' }, { status: 503 });
    }

    const { email: rawEmail } = await readJsonBody(request);
    const email = normalizeEmail(rawEmail);
    if (!email) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const [emailAllowed, ipAllowed] = await Promise.all([
      enforceRateLimit('auth-email-start-email', email, 5, 15 * 60),
      enforceRateLimit('auth-email-start-ip', ip, 20, 15 * 60),
    ]);
    if (!emailAllowed || !ipAllowed) {
      return NextResponse.json({ error: 'Too many login code requests' }, { status: 429 });
    }

    const code = createEmailOtp();
    await getEmailOtpRef(email).set({
      email,
      codeHash: hashEmailOtp(email, code),
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + EMAIL_OTP_TTL_SECONDS * 1000),
    });

    const delivery = await sendEmailOtp(email, code);
    return NextResponse.json({
      success: true,
      expiresIn: EMAIL_OTP_TTL_SECONDS,
      ...delivery,
    });
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      return routeErrorResponse(error, {
        context: 'auth-email-start',
        fallbackMessage: 'Failed to send login code',
      });
    }
    console.error('[auth-email-start] Failed:', error);
    return NextResponse.json({ error: 'Failed to send login code' }, { status: 500 });
  }
}
