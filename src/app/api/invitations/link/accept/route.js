import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authenticateRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { hashInviteToken } from '@/lib/server/inviteLinks';
import {
  countActiveMembers,
  organizationPlan,
  planLimitRefusalResponse,
} from '@/lib/server/planLimits';
import { restoreProjectAccess } from '@/lib/server/orgMembership';
import { seedChatReadState } from '@/lib/server/chatReadState';
import { MEMBERSHIP_ARCHIVE } from '@/lib/utils/orgMembership.mjs';

// Accepting an invite link. The token is looked up by hash; the joiner gets
// exactly the role the admin fixed at creation — nothing in the request body
// can influence it. Expired/revoked/exhausted links are rejected the same way
// so a probing attacker learns nothing about which links exist.

const INVALID = () => NextResponse.json({ error: 'Посилання недійсне або протерміноване' }, { status: 404 });

export async function POST(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const { uid } = authorization.user;
    if (!(await enforceRateLimit('invitation-link-accept', uid, 10, 3600))) {
      return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
    }

    const { token } = await readJsonBody(request);
    if (typeof token !== 'string' || token.length < 20 || token.length > 128) return INVALID();

    const db = getAdminDb();
    const snap = await db.collection('invitations')
      .where('tokenHash', '==', hashInviteToken(token))
      .limit(1)
      .get();
    if (snap.empty) return INVALID();

    const inviteRef = snap.docs[0].ref;

    // A seat is a seat however somebody arrives in it. The route that *sends*
    // an invitation has counted the ceiling since the ceiling existed, and this
    // one — the link somebody clicks — had never asked: a workspace that went
    // back to Free with a live link kept letting people in past its plan for as
    // long as the link had uses left. Somebody already on the team is not a new
    // seat, so re-using a link is not refused for a workspace that is full of
    // people including them.
    const inviteOrganizationId = typeof snap.docs[0].data().organizationId === 'string'
      ? snap.docs[0].data().organizationId
      : '';
    if (inviteOrganizationId) {
      const membershipSnap = await db.collection('orgMemberships')
        .doc(`${inviteOrganizationId}_${uid}`)
        .get();
      if (!membershipSnap.exists) {
        const [organizationSnap, seatsTaken] = await Promise.all([
          db.collection('organizations').doc(inviteOrganizationId).get(),
          countActiveMembers(db, inviteOrganizationId),
        ]);
        const refusal = planLimitRefusalResponse(
          organizationPlan(organizationSnap),
          'members',
          seatsTaken,
        );
        if (refusal) return refusal;
      }
    }

    // Transaction: two users clicking the last remaining use at the same time
    // must not both pass the maxUses check.
    const result = await db.runTransaction(async tx => {
      const inviteSnap = await tx.get(inviteRef);
      if (!inviteSnap.exists) return { error: true };
      const invite = inviteSnap.data();
      if (invite.type !== 'link' || invite.status !== 'pending') return { error: true };
      if (invite.expiresAt && invite.expiresAt.toMillis() < Date.now()) return { error: true };
      if ((invite.usedCount || 0) >= (invite.maxUses || 1)) return { error: true };

      const organizationId = invite.organizationId;
      if (!organizationId) return { error: true };

      const membershipId = `${organizationId}_${uid}`;
      const membershipRef = db.collection('orgMemberships').doc(membershipId);
      const archiveRef = db.collection(MEMBERSHIP_ARCHIVE).doc(membershipId);
      const [membershipSnap, archiveSnap] = await Promise.all([
        tx.get(membershipRef),
        tx.get(archiveRef),
      ]);
      if (membershipSnap.exists) {
        return { organizationId, invitedBy: invite.invitedBy || '', alreadyMember: true };
      }

      // Someone who was deactivated and now walks back in through a link must
      // consume their archived seat, not sit down beside it: two records for
      // one person would list them in the directory twice, once as active and
      // once as gone.
      const archived = archiveSnap.exists ? archiveSnap.data() : null;
      if (archived) tx.delete(archiveRef);

      tx.set(membershipRef, {
        id: membershipId,
        orgId: organizationId,
        userId: uid,
        role: invite.role === 'admin' ? 'admin' : 'member',
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: invite.invitedBy || null,
        joinedVia: 'invite-link',
      });
      tx.set(db.collection('organizations').doc(organizationId)
        .collection('memberRates').doc(uid), {
        userId: uid,
        hourlyRate: 0,
        updatedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.update(db.collection('organizations').doc(organizationId), {
        memberDirectoryVersion: FieldValue.increment(1),
      });
      tx.update(inviteRef, {
        usedCount: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp(),
        lastUsedBy: uid,
      });
      return {
        organizationId,
        invitedBy: invite.invitedBy || '',
        restoredProjectIds: Array.isArray(archived?.projectIds) ? archived.projectIds : [],
      };
    });

    if (result.error) return INVALID();

    // Місце в кімнаті видається разом із курсором прочитаного. Хто вже був
    // учасником, свої курсори має — і перезаписувати їх означало б стерти
    // непрочитане людині, яка просто повторно відкрила посилання.
    if (!result.alreadyMember) {
      await seedChatReadState(db, result.organizationId, uid);
    }

    if (result.restoredProjectIds?.length) {
      await restoreProjectAccess({
        organizationId: result.organizationId,
        userId: uid,
        projectIds: result.restoredProjectIds,
      });
    }

    // Хто запросив і куди — це те, що бачить людина на екрані «вітаємо».
    // Раніше поверталася сама назва, тож сторінка могла лише повідомити факт;
    // логотип організації та обличчя запрошувача перетворюють його на впізнання.
    // Два читання за одне приєднання — не той обсяг, за який варто торгуватися.
    const [orgSnap, inviterSnap] = await Promise.all([
      db.collection('organizations').doc(result.organizationId).get(),
      result.invitedBy
        ? db.collection('users').doc(result.invitedBy).get()
        : Promise.resolve(null),
    ]);
    const organization = orgSnap.exists ? orgSnap.data() : {};
    const inviter = inviterSnap?.exists ? inviterSnap.data() : null;
    return NextResponse.json({
      organizationId: result.organizationId,
      organizationName: organization.name || '',
      organizationLogo: organization.logo || organization.logoUrl || '',
      invitedBy: inviter
        ? {
            name: inviter.name || inviter.displayName || inviter.email || '',
            avatar: inviter.avatar || inviter.photoURL || '',
          }
        : null,
      alreadyMember: Boolean(result.alreadyMember),
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'Invitation link accept', fallbackMessage: 'Internal Server Error' });
  }
}
