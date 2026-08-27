import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'crypto';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { hashInviteToken } from '@/lib/server/inviteLinks';

// Invite links: the raw token leaves the server exactly once (in this
// response) and is never stored — Firestore keeps only its SHA-256 hash, so
// neither a DB leak nor the client-readable invitations collection can be
// turned into a working link. The role is fixed at creation (member/admin
// only), the link expires, is capped in uses and is revocable by admins.

const MAX_EXPIRY_DAYS = 30;
const DEFAULT_EXPIRY_DAYS = 7;
const MAX_USES = 50;
const DEFAULT_USES = 25;

export async function POST(request) {
  try {
    const { organizationId, role, expiresInDays, maxUses } = await readJsonBody(request);
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin']);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    if (!(await enforceRateLimit('invitation-link', authorization.user.uid, 10, 3600))) {
      return NextResponse.json({ error: 'Too many invite links' }, { status: 429 });
    }

    const safeRole = role === 'admin' ? 'admin' : 'member';
    const days = Math.min(Math.max(Number(expiresInDays) || DEFAULT_EXPIRY_DAYS, 1), MAX_EXPIRY_DAYS);
    const uses = Math.min(Math.max(Number(maxUses) || DEFAULT_USES, 1), MAX_USES);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);

    const db = getAdminDb();
    await db.collection('invitations').add({
      type: 'link',
      tokenHash: hashInviteToken(token),
      organizationId,
      role: safeRole,
      status: 'pending',
      invitedBy: authorization.user.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      maxUses: uses,
      usedCount: 0,
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.json({
      url: `${baseUrl}/invite/${token}`,
      role: safeRole,
      expiresAt: expiresAt.toMillis(),
      maxUses: uses,
    }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, { context: 'Invitation link POST', fallbackMessage: 'Internal Server Error' });
  }
}
