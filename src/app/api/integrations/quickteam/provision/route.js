import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  normalizeQuickTeamProvision,
  quickTeamOrganizationId,
} from '@/lib/integrations/quickteamContract.mjs';
import {
  readSignedQuickTeamRequest,
  resolveQuickTeamStaff,
} from '@/lib/server/quickteamIntegration';
import { restoreProjectAccess } from '@/lib/server/orgMembership';
import {
  MEMBERSHIP_ARCHIVE,
  MEMBERSHIP_COLLECTION,
  membershipId,
  quickTeamSeatChanges,
} from '@/lib/utils/orgMembership.mjs';

const MAX_TRANSACTION_WRITES = 450;

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
    const staff = await resolveQuickTeamStaff(payload.staff);
    const incomingUserIds = new Set(staff.map(member => member.qTicketUserId));
    const owner = staff.find(member => member.role === 'owner');
    const db = getAdminDb();
    const organizationRef = db.collection('organizations').doc(organizationId);

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
        portalBranding: {
          source: 'quickteam',
          name: payload.organization.name,
          logo: payload.organization.logo,
          sidebarTheme: payload.organization.sidebarTheme,
          sidebarColor: payload.organization.sidebarColor,
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
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error?.code === 'SNAPSHOT_TOO_LARGE') {
      return NextResponse.json({ error: error.message, code: 'snapshot_too_large' }, { status: 413 });
    }
    return routeErrorResponse(error, {
      context: 'quickteam-provision',
      fallbackMessage: 'Не вдалося синхронізувати qTicket з QuickTeam',
    });
  }
}
