import { FieldValue } from 'firebase-admin/firestore';
import 'server-only';

import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { getAdminAuth, getAdminDb } from '@/lib/server/firebaseAdmin';
import { deliverEmail, emailConfigured } from '@/lib/server/email';

export const EMAIL_OTP_TTL_SECONDS = 10 * 60;
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMAIL_RE.test(email) ? email : '';
}

export function createEmailOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function getOtpSecret() {
  return process.env.AUTH_OTP_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    'quickteam-dev-auth-secret';
}

export function hashEmailOtp(email, code) {
  return createHmac('sha256', getOtpSecret())
    .update(`${email}:${code}`)
    .digest('hex');
}

export function safeCompareHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function getEmailOtpRef(email) {
  const id = createHash('sha256').update(email).digest('hex');
  return getAdminDb().collection('authEmailOtps').doc(id);
}

export async function sendEmailOtp(email, code) {
  const debugPayload = process.env.NODE_ENV !== 'production' ? { debugCode: code } : {};

  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[auth-email] OTP for ${email}: ${code}`);
      return debugPayload;
    }
    throw new Error('Email delivery is not configured');
  }

  const delivered = await deliverEmail({
    to: email,
    subject: 'qTicket login code',
    html: `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f1f1f;line-height:1.5">
        <h1 style="font-size:20px;margin:0 0 12px">qTicket login code</h1>
        <p style="margin:0 0 16px">Use this code to sign in or create your qTicket account.</p>
        <div style="font-size:28px;font-weight:800;letter-spacing:8px;padding:16px 20px;background:#f4f4f5;border-radius:12px;display:inline-block">${code}</div>
        <p style="margin:16px 0 0;color:#71717a;font-size:13px">The code expires in 10 minutes.</p>
      </div>
    `,
  });

  if (!delivered) {
    throw new Error('Email provider rejected request');
  }

  return debugPayload;
}

export async function upsertEmailAuthUser(email) {
  const auth = getAdminAuth();
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    if (userRecord.disabled) {
      const error = new Error('Account is disabled');
      error.status = 403;
      throw error;
    }
    if (!userRecord.emailVerified) {
      userRecord = await auth.updateUser(userRecord.uid, { emailVerified: true });
    }
  } catch (error) {
    if (error.status === 403) throw error;
    if (error.code !== 'auth/user-not-found') throw error;
    userRecord = await auth.createUser({
      email,
      emailVerified: true,
      displayName: email.split('@')[0],
    });
  }

  const userRef = getAdminDb().collection('users').doc(userRecord.uid);
  const userSnap = await userRef.get();
  const nowIso = new Date().toISOString();
  const baseProfile = {
    id: userRecord.uid,
    email,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (!userSnap.exists) {
    baseProfile.name = userRecord.displayName || email.split('@')[0];
    // Empty rather than a third-party placeholder — UserAvatar falls back to
    // initials, and no uid leaves the platform.
    baseProfile.avatar = userRecord.photoURL || '';
    baseProfile.role = 'user';
    baseProfile.createdAt = nowIso;
    baseProfile.lastActive = nowIso;
  }
  await userRef.set(baseProfile, { merge: true });

  return userRecord;
}
