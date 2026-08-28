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
import { storedPlanLimit } from '@/lib/utils/plans.mjs';

const INTERNAL_ROLES = new Set(['owner', 'admin', 'member']);
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

      const activeMemberships = membershipsSnap.docs.map(document => ({
        ref: document.ref,
        ...document.data(),
      }));
      const removedStaff = activeMemberships.filter(membership => (
        INTERNAL_ROLES.has(membership.role) && !incomingUserIds.has(membership.userId)
      ));
      const removedIds = removedStaff.map(member => member.userId);
      const retainedClientIds = activeMemberships
        .filter(membership => !INTERNAL_ROLES.has(membership.role))
        .map(membership => membership.userId);
      const projectsToClean = removedIds.length
        ? projectsSnap.docs.filter(document => (
            (document.data().team || []).some(uid => removedIds.includes(uid))
          ))
        : [];
      const estimatedWrites = 1 + staff.length * 4 + removedStaff.length * 2 + projectsToClean.length;
      if (estimatedWrites > MAX_TRANSACTION_WRITES) {
        throw Object.assign(new Error('Provisioning snapshot is too large'), { code: 'SNAPSHOT_TOO_LARGE' });
      }

      const now = FieldValue.serverTimestamp();
      const plan = currentOrganization.plan || 'pro';
      transaction.set(organizationRef, {
        id: organizationId,
        name: payload.organization.name,
        logo: payload.organization.logo,
        ownerId: owner.qTicketUserId,
        memberUids: [...new Set([...retainedClientIds, ...incomingUserIds])],
        plan,
        limits: currentOrganization.limits || {
          maxProjects: storedPlanLimit(plan, 'projects'),
          maxMembers: storedPlanLimit(plan, 'members'),
        },
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
        const membershipId = `${organizationId}_${member.qTicketUserId}`;
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
        transaction.set(db.collection('orgMemberships').doc(membershipId), {
          id: membershipId,
          orgId: organizationId,
          userId: member.qTicketUserId,
          role: member.role,
          managedBy: 'quickteam',
          joinedAt: now,
          updatedAt: now,
        }, { merge: true });
        transaction.delete(db.collection('orgMembershipArchive').doc(membershipId));
      }

      for (const membership of removedStaff) {
        const membershipId = `${organizationId}_${membership.userId}`;
        transaction.set(db.collection('orgMembershipArchive').doc(membershipId), {
          ...membership,
          id: membershipId,
          orgId: organizationId,
          userId: membership.userId,
          managedBy: 'quickteam',
          deactivatedAt: now,
        });
        transaction.delete(membership.ref);
      }
      for (const project of projectsToClean) {
        transaction.update(project.ref, {
          team: FieldValue.arrayRemove(...removedIds),
          updatedAt: now,
        });
      }
      return { status: 'applied', revision: payload.revision };
    });

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
