import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authenticateRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  acceptedInviteLinkRole,
  hashInviteToken,
  inviteLinkUsable,
  inviteTokenLooksWellFormed,
} from '@/lib/server/inviteLinks.mjs';
import { seedChatReadState } from '@/lib/server/chatReadState';
import { MEMBERSHIP_ARCHIVE } from '@/lib/utils/orgMembership.mjs';
import { hasActiveQuickTeamEntitlement } from '@/lib/utils/quickTeamManaged.mjs';

// Accepting a client invite link.
//
// The token is looked up by hash and the seat is read out of the stored
// document — nothing in the request body can influence the role, the project
// or the organization. `acceptedInviteLinkRole` refuses anything that is not a
// client role even when the document says otherwise, which is the last of the
// three places an internal seat is refused (the other two are the create route
// and `firestore.rules`).
//
// Consuming a use happens inside the transaction with the check that there is
// one left, so two people opening the last use at the same moment cannot both
// pass it. Expired, revoked, exhausted and unknown all fail identically.

const INVALID = () => NextResponse.json(
  { error: 'Посилання недійсне або протерміноване' },
  { status: 404 },
);

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
    if (!inviteTokenLooksWellFormed(token)) return INVALID();

    const db = getAdminDb();
    const snapshot = await db.collection('invitations')
      .where('tokenHash', '==', hashInviteToken(token))
      .limit(1)
      .get();
    if (snapshot.empty) return INVALID();
    const inviteReference = snapshot.docs[0].ref;

    const result = await db.runTransaction(async transaction => {
      const inviteSnapshot = await transaction.get(inviteReference);
      if (!inviteSnapshot.exists) return { error: true };
      const invitation = inviteSnapshot.data();
      if (!inviteLinkUsable(invitation)) return { error: true };

      let role;
      try {
        role = acceptedInviteLinkRole(invitation.role);
      } catch {
        return { error: true };
      }

      const { organizationId, projectId } = invitation;
      const membershipId = `${organizationId}_${uid}`;
      const organizationReference = db.collection('organizations').doc(organizationId);
      const projectReference = db.collection('projects').doc(projectId);
      const membershipReference = db.collection('orgMemberships').doc(membershipId);
      const archiveReference = db.collection(MEMBERSHIP_ARCHIVE).doc(membershipId);
      const [
        organizationSnapshot,
        projectSnapshot,
        membershipSnapshot,
        archiveSnapshot,
      ] = await Promise.all([
        transaction.get(organizationReference),
        transaction.get(projectReference),
        transaction.get(membershipReference),
        transaction.get(archiveReference),
      ]);

      if (
        !organizationSnapshot.exists
        || !hasActiveQuickTeamEntitlement(organizationSnapshot.data())
      ) {
        return { error: true };
      }
      if (
        !projectSnapshot.exists
        || projectSnapshot.data().organizationId !== organizationId
      ) {
        return { error: true };
      }

      // Somebody who is already seated is simply let in. Re-opening the link
      // in a second tab must not spend one of its uses, and a link must never
      // rewrite a seat that already exists — that is how a support agent who
      // clicked a client link would have lost their own role.
      if (membershipSnapshot.exists) {
        return { organizationId, projectId, alreadyMember: true };
      }

      // A client who was removed and now walks back in through a link consumes
      // their archived seat rather than sitting down beside it: two records for
      // one person list them in the directory twice, once active and once gone.
      if (archiveSnapshot.exists) transaction.delete(archiveReference);

      transaction.set(membershipReference, {
        id: membershipId,
        orgId: organizationId,
        userId: uid,
        role,
        joinedAt: FieldValue.serverTimestamp(),
        invitedBy: invitation.invitedBy || null,
        joinedVia: 'invite-link',
      });
      // The client space the link is fixed to is the whole of this person's
      // access: `orgMemberships` plus `project.team`, and nothing else.
      transaction.update(projectReference, {
        team: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(organizationReference, {
        memberDirectoryVersion: FieldValue.increment(1),
      });
      transaction.update(inviteReference, {
        usedCount: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp(),
        lastUsedBy: uid,
      });
      return { organizationId, projectId, alreadyMember: false };
    });

    if (result.error) return INVALID();

    // Місце в кімнаті видається разом із курсором прочитаного — так само, як у
    // /api/invitations/accept. Хто вже був учасником, свої курсори має, і
    // перезаписувати їх означало б стерти непрочитане людині, яка просто
    // відкрила посилання вдруге.
    if (!result.alreadyMember) {
      await seedChatReadState(db, result.organizationId, uid);
    }

    return NextResponse.json({
      organizationId: result.organizationId,
      projectId: result.projectId,
      alreadyMember: result.alreadyMember,
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'Invitation link accept', fallbackMessage: 'Internal Server Error' });
  }
}
