import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  normalizeQuickTeamProvision,
  quickTeamIdentityId,
  quickTeamOrganizationId,
  quickTeamPortalBranding,
} from '@/lib/integrations/quickteamContract.mjs';
import {
  readSignedQuickTeamRequest,
  resolveQuickTeamStaff,
} from '@/lib/server/quickteamIntegration';
import { restoreProjectAccess } from '@/lib/server/orgMembership';
import { quickTeamSnapshotOpensOrganization } from '@/lib/utils/quickTeamManaged.mjs';
import {
  clientSeatCollisions,
  MEMBERSHIP_ARCHIVE,
  MEMBERSHIP_COLLECTION,
  membershipId,
  quickTeamSeatChanges,
} from '@/lib/utils/orgMembership.mjs';
import { isClientRole } from '@/lib/utils/can';

const MAX_TRANSACTION_WRITES = 450;

// Which qTicket account each incoming staff member would land on, asked without
// touching one.
//
// `resolveQuickTeamStaff` answers the same question by creating and rewriting
// Firebase Auth accounts, which is too late to refuse anything — see
// `clientSeatCollisions`. So the seat is checked first, in reads only, along
// the same two steps that resolution takes: the identity map if this person has
// been provisioned before, otherwise the verified email. Somebody with neither
// is new here and can collide with nothing.
async function resolveExistingSeatCandidates(db, staff) {
  return Promise.all(staff.map(async member => {
    const identity = await db.collection('quickTeamIdentities')
      .doc(quickTeamIdentityId(member.sourceUserId))
      .get();
    const mapped = identity.data()?.qTicketUserId || '';
    if (mapped) return { ...member, userId: mapped };
    const byEmail = await db.collection('users')
      .where('email', '==', member.email)
      .limit(1)
      .get();
    return { ...member, userId: byEmail.empty ? '' : byEmail.docs[0].id };
  }));
}

export async function POST(request) {
  try {
    const signed = await readSignedQuickTeamRequest(request);
    if (signed.error) {
      return NextResponse.json(
        { error: signed.error, code: signed.code },
        { status: signed.status },
      );
    }
    const normalized = normalizeQuickTeamProvision(signed.body);
    if (normalized.error) {
      return NextResponse.json({ error: 'Invalid provisioning payload', code: normalized.error }, { status: 400 });
    }

    const payload = normalized.data;
    const organizationId = quickTeamOrganizationId(payload.sourceOrganizationId);
    const db = getAdminDb();
    const organizationRef = db.collection('organizations').doc(organizationId);

    // Refused before the staff are resolved, because resolving them is not a
    // read: it creates Firebase Auth accounts and rewrites the name, email and
    // avatar of every account it finds. An organization that never bought the
    // add-on must not cost anybody an identity here. The transaction below asks
    // the same question again of the document it is about to write — that one is
    // the authority, and this one is only ever allowed to refuse.
    const existingOrganization = await organizationRef.get();
    if (!quickTeamSnapshotOpensOrganization({
      organizationExists: existingOrganization.exists,
      entitlement: payload.entitlement,
    })) {
      return NextResponse.json({
        organizationId,
        status: 'skipped',
        revision: Number(existingOrganization.data()?.quickTeam?.revision || 0),
      }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    // A customer's seat is not free for the desk to take. Read before the
    // staff are resolved, for the same reason the entitlement is: resolution
    // rewrites Firebase Auth accounts, and by then the answer would have cost
    // this person their identity. The transaction asks again below, of the
    // documents it is about to write.
    const membershipsBefore = await db.collection(MEMBERSHIP_COLLECTION)
      .where('orgId', '==', organizationId)
      .get();
    const conflicts = clientSeatCollisions({
      candidates: await resolveExistingSeatCandidates(db, payload.staff),
      memberships: membershipsBefore.docs.map(document => document.data()),
    });
    // Every other conflict costs that one seat. The owner's costs the snapshot:
    // there is exactly one, the organization document names them, and an
    // organization whose owner is a customer of itself is not a state to write
    // half of.
    if (conflicts.some(conflict => conflict.requestedRole === 'owner')) {
      return NextResponse.json({
        organizationId,
        error: 'Власник у знімку вже є клієнтом цієї організації в qTicket',
        code: 'client_seat_conflict',
        conflicts,
      }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const blockedSourceIds = new Set(conflicts.map(conflict => conflict.sourceUserId));
    const staff = await resolveQuickTeamStaff(
      payload.staff.filter(member => !blockedSourceIds.has(member.sourceUserId)),
    );
    const incomingUserIds = new Set(staff.map(member => member.qTicketUserId));
    const owner = staff.find(member => member.role === 'owner');

    const result = await db.runTransaction(async transaction => {
      const organizationSnap = await transaction.get(organizationRef);
      const membershipsSnap = await transaction.get(
        db.collection('orgMemberships').where('orgId', '==', organizationId),
      );
      const projectsSnap = await transaction.get(
        db.collection('projects').where('organizationId', '==', organizationId),
      );
      const currentOrganization = organizationSnap.exists ? organizationSnap.data() : {};
      const currentRevision = Number(currentOrganization?.quickTeam?.revision || 0);
      if (currentRevision >= payload.revision) {
        return { status: 'unchanged', revision: currentRevision };
      }
      // An organization QuickTeam never sold qTicket to is not a workspace that
      // happens to be switched off. It has no place here at all, and the seats
      // this loop is about to write are what would give it one for good.
      if (!quickTeamSnapshotOpensOrganization({
        organizationExists: organizationSnap.exists,
        entitlement: payload.entitlement,
      })) {
        return { status: 'skipped', revision: currentRevision };
      }

      // The archived seats of people this snapshot names. Somebody here may be
      // returning, and their seat is the only surviving record of the client
      // spaces they worked on — `project.team` was cleared when they left. Read
      // before any write: a transaction may not read after it has written.
      const archiveRefs = staff.map(member => db.collection(MEMBERSHIP_ARCHIVE)
        .doc(membershipId(organizationId, member.qTicketUserId)));
      const archiveSnaps = archiveRefs.length ? await transaction.getAll(...archiveRefs) : [];

      const membershipRefs = new Map(membershipsSnap.docs.map(
        document => [document.data().userId, document.ref],
      ));
      // The authority on whose seat this is. The pre-flight above read the same
      // collection a moment earlier and is only ever allowed to refuse; this
      // reads the documents the transaction is about to overwrite, so a seat
      // that became a customer's in between is still not taken.
      const blockedUserIds = new Set(membershipsSnap.docs
        .filter(document => isClientRole(document.data().role))
        .map(document => document.data().userId));
      if (blockedUserIds.has(owner.qTicketUserId)) {
        throw Object.assign(new Error('Owner seat belongs to a client'), { code: 'CLIENT_SEAT_CONFLICT' });
      }
      const changes = quickTeamSeatChanges({
        incomingUserIds: [...incomingUserIds],
        memberships: membershipsSnap.docs.map(document => document.data()),
        projects: projectsSnap.docs.map(document => ({
          id: document.id,
          team: document.data().team || [],
        })),
        // A seat is read back only for the person whose document it is: the
        // archive is server-only, but a restore that trusts a field over the
        // document id is a restore that can be pointed at somebody else.
        archives: archiveSnaps
          .map((snapshot, index) => (snapshot.exists ? snapshot.data() : null))
          .filter((archived, index) => (
            archived
            && archived.orgId === organizationId
            && archived.userId === staff[index].qTicketUserId
          )),
      });
      const returningSeats = new Map(changes.returning.map(seat => [seat.userId, seat.seat]));
      const removedIds = changes.departing.map(seat => seat.userId);
      const cleanedProjectIds = new Set(changes.projectIds);
      const projectsToClean = projectsSnap.docs.filter(document => cleanedProjectIds.has(document.id));
      const estimatedWrites = 1 + staff.length * 4 + changes.departing.length * 2 + projectsToClean.length;
      if (estimatedWrites > MAX_TRANSACTION_WRITES) {
        throw Object.assign(new Error('Provisioning snapshot is too large'), { code: 'SNAPSHOT_TOO_LARGE' });
      }

      const now = FieldValue.serverTimestamp();
      transaction.set(organizationRef, {
        id: organizationId,
        name: payload.organization.name,
        logo: payload.organization.logo,
        ownerId: owner.qTicketUserId,
        timezone: payload.organization.timezone,
        onboarded: true,
        // Two brands, and they were the same value twice.
        //
        // `name`/`logo` above are the organization — what the staff shell says
        // over the queue. `portalBranding` is what a customer sees on their own
        // portal, and the fields have always been separate here while being fed
        // one value, so a company could not name its desk anything but itself.
        // The snapshot may now carry `organization.portal`; when it does not,
        // this falls back to the organization and nothing changes.
        portalBranding: {
          source: 'quickteam',
          ...quickTeamPortalBranding(payload.organization),
        },
        quickTeam: {
          sourceOrganizationId: payload.sourceOrganizationId,
          revision: payload.revision,
          entitlement: payload.entitlement,
          syncedAt: now,
        },
        ...(organizationSnap.exists ? {} : { createdAt: now, onboardedAt: now }),
        updatedAt: now,
      }, { merge: true });

      for (const member of staff) {
        if (blockedUserIds.has(member.qTicketUserId)) continue;
        const seatId = membershipId(organizationId, member.qTicketUserId);
        transaction.set(member.identityRef, {
          provider: 'quickteam',
          sourceUserId: member.sourceUserId,
          qTicketUserId: member.qTicketUserId,
          updatedAt: now,
          ...(member.identityExists ? {} : { createdAt: now }),
        }, { merge: true });
        transaction.set(db.collection('users').doc(member.qTicketUserId), {
          id: member.qTicketUserId,
          name: member.name,
          email: member.email,
          avatar: member.avatar,
          identitySource: 'quickteam',
          updatedAt: now,
        }, { merge: true });
        // Somebody returning is reactivated, not met as a stranger: the seat
        // keeps the day they joined, their position and who invited them, the
        // same state reactivateMembership restores from the team screen. The
        // client spaces on that seat are given back after the transaction.
        const seat = returningSeats.get(member.qTicketUserId);
        transaction.set(db.collection(MEMBERSHIP_COLLECTION).doc(seatId), {
          id: seatId,
          orgId: organizationId,
          userId: member.qTicketUserId,
          role: member.role,
          managedBy: 'quickteam',
          joinedAt: seat?.joinedAt || now,
          ...(seat
            ? {
              positionId: seat.positionId || '',
              invitedBy: seat.invitedBy || null,
              reactivatedAt: now,
            }
            : {}),
          updatedAt: now,
        }, { merge: true });
        // The archive is consumed by a restore, never by an arrival.
        transaction.delete(db.collection(MEMBERSHIP_ARCHIVE).doc(seatId));
      }

      for (const seat of changes.departing) {
        const archivedId = membershipId(organizationId, seat.userId);
        transaction.set(db.collection(MEMBERSHIP_ARCHIVE).doc(archivedId), {
          ...seat,
          id: archivedId,
          orgId: organizationId,
          managedBy: 'quickteam',
          reason: 'quickteam-removed',
          deactivatedAt: now,
        });
        transaction.delete(membershipRefs.get(seat.userId));
      }
      for (const project of projectsToClean) {
        transaction.update(project.ref, {
          team: FieldValue.arrayRemove(...removedIds),
          updatedAt: now,
        });
      }
      return {
        status: 'applied',
        revision: payload.revision,
        restored: changes.returning.map(({ userId, projectIds }) => ({ userId, projectIds })),
      };
    });

    // Outside the transaction, like every other restore path: an organization
    // may hold more client spaces than one transaction may touch, and a project
    // an archived seat names may have been deleted since.
    for (const seat of result.restored || []) {
      await restoreProjectAccess({
        organizationId,
        userId: seat.userId,
        projectIds: seat.projectIds,
      });
    }

    return NextResponse.json({
      organizationId,
      status: result.status,
      revision: result.revision,
      // Named on every answer, not only the one that skipped them: a snapshot
      // QuickTeam sends twice is `unchanged` the second time, and the reason a
      // colleague never got a qTicket seat must not go out with the first
      // response nobody read.
      ...(conflicts.length ? { conflicts } : {}),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error?.code === 'CLIENT_SEAT_CONFLICT') {
      return NextResponse.json({
        error: 'Власник у знімку вже є клієнтом цієї організації в qTicket',
        code: 'client_seat_conflict',
      }, { status: 409 });
    }
    if (error?.code === 'SNAPSHOT_TOO_LARGE') {
      return NextResponse.json({ error: error.message, code: 'snapshot_too_large' }, { status: 413 });
    }
    return routeErrorResponse(error, {
      context: 'quickteam-provision',
      fallbackMessage: 'Не вдалося синхронізувати qTicket з QuickTeam',
    });
  }
}
