import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  InvalidJsonBodyError,
  readJsonBody,
  routeErrorResponse,
} from '@/lib/server/apiErrors';
import { getAdminAuth } from '@/lib/server/firebaseAdmin';
import {
  EMAIL_OTP_MAX_ATTEMPTS,
  getEmailOtpRef,
  hashEmailOtp,
  normalizeEmail,
  safeCompareHex,
  upsertEmailAuthUser,
} from '@/lib/server/emailOtp';

const EMAIL_LOGIN_ENABLED = process.env.EMAIL_LOGIN_ENABLED === 'true';

export async function POST(request) {
  try {
    if (!EMAIL_LOGIN_ENABLED) {
      return NextResponse.json({ error: 'Email login is temporarily disabled' }, { status: 503 });
    }

    const { email: rawEmail, token: rawToken } = await readJsonBody(request);
    const email = normalizeEmail(rawEmail);
    const token = typeof rawToken === 'string' ? rawToken.replace(/\D/g, '') : '';
    if (!email || token.length !== 6) {
      return NextResponse.json({ error: 'Valid email and code are required' }, { status: 400 });
    }

    const otpRef = getEmailOtpRef(email);
    const otpSnap = await otpRef.get();
    const otp = otpSnap.exists ? otpSnap.data() : null;
    const expiresAt = otp?.expiresAt?.toMillis?.() || 0;

    if (!otp || otp.email !== email || expiresAt <= Date.now()) {
      if (otpSnap.exists) await otpRef.delete();
      return NextResponse.json({ error: 'Login code expired' }, { status: 401 });
    }

    if ((otp.attempts || 0) >= EMAIL_OTP_MAX_ATTEMPTS) {
      await otpRef.delete();
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }

    const codeHash = hashEmailOtp(email, token);
    if (!safeCompareHex(codeHash, otp.codeHash)) {
      await otpRef.update({
        attempts: FieldValue.increment(1),
        lastAttemptAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ error: 'Invalid login code' }, { status: 401 });
    }

    const userRecord = await upsertEmailAuthUser(email);
    await otpRef.delete();

    const customToken = await getAdminAuth().createCustomToken(userRecord.uid, {
      auth_provider: 'email',
    });

    return NextResponse.json({ customToken });
  } catch (error) {
    if (error instanceof InvalidJsonBodyError) {
      return routeErrorResponse(error, {
        context: 'auth-email-verify',
        fallbackMessage: 'Failed to verify login code',
      });
    }
    console.error('[auth-email-verify] Failed:', error);
    const status = error.status || 500;
    return NextResponse.json({ error: status === 403 ? error.message : 'Failed to verify login code' }, { status });
  }
}
