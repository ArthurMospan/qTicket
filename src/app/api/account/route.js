// Deleting your own account.
//
// Until now the product had no way to do this at all: the help centre told
// people to email support, which is not an answer for the one action a person
// is unconditionally entitled to take about their own data.
//
// What this route will and will not do, and why:
//
//   • It closes access the way «remove member» does: the membership is archived
//     under `orgMembershipArchive` and the person is dropped from every
//     `project.team`. Nothing else about their work is touched.
//   • It deletes the private user document and its settings, then the Firebase
//     Auth user, which is what actually ends the account.
//   • It refuses while the person owns an organization somebody else is still
//     in, and names those organizations so the message is actionable.
//
// This route used to strip the account's id out of `assigneeIds` and
// `watcherIds` on every task in every organization, and to delete the
// membership rather than archive it. AGENTS.md forbids exactly that — «never
// edit assigneeIds, watcherIds, comments or time logs to "clean up" after a
// person. That is the record of what happened, and rewriting it is how a
// workspace loses its own history» — and the administrator's own removal path
// has always obeyed it, reading those two lists to report an impact and never
// writing them. The two paths disagreed, and this was the one that was wrong.
//
// What that cost was visible on screen. The member directory deliberately keeps
// deactivated people, so a task they were assigned and an hour they logged
// still render their name. A self-deleted account left neither an active
// membership nor an archived one, so `TimeLogRow` fell through to «Невідомий» —
// on a timesheet that becomes an invoice.
//
// The profile itself is still deleted in full: a person deleting their account
// is entitled to have their name, email, phone and photograph gone, and none of
// it is kept here. What remains is the shape of the record — this seat existed,
// held this role, was on these projects — and the directory renders it as
// «Видалений акаунт», which is both true and readable.

import { NextResponse } from 'next/server';
import {
  authenticateRequest,
  enforceRateLimit,
  FieldValue,
  getAdminAuth,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import {
  MEMBERSHIP_ARCHIVE,
  membershipId,
} from '@/lib/utils/orgMembership.mjs';

const USER_SUBCOLLECTIONS = ['settings', 'private'];

function accountError(status, message, details = {}) {
  const error = new Error(message);
  error.accountMutation = { status, message, details };
  return error;
}

async function membershipsOf(db, uid) {
  const snapshot = await db.collection('orgMemberships')
    .where('userId', '==', uid)
    .get();
  return snapshot.docs.map(document => ({ ref: document.ref, ...document.data() }));
}

async function organizationNames(db, organizationIds) {
  if (organizationIds.length === 0) return [];
  const documents = await db.getAll(
    ...organizationIds.map(id => db.collection('organizations').doc(id)),
  );
  return documents.map((document, index) => (
    document.exists ? (document.data().name || organizationIds[index]) : organizationIds[index]
  ));
}

/** What deleting this account would touch, so the confirmation can say it. */
async function deletionImpact(db, uid) {
  const memberships = await membershipsOf(db, uid);
  const ownedIds = memberships.filter(item => item.role === 'owner').map(item => item.orgId);
  const [ownedOrganizations, projects, assignedIssues] = await Promise.all([
    organizationNames(db, ownedIds),
    db.collection('projects').where('team', 'array-contains', uid).get(),
    db.collection('issues').where('assigneeIds', 'array-contains', uid).get(),
  ]);
  return {
    memberships,
    ownedOrganizations,
    organizationCount: memberships.length,
    projectCount: projects.size,
    assignedIssueCount: assignedIssues.size,
  };
}

export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const db = getAdminDb();
    const impact = await deletionImpact(db, authorization.user.uid);
    return NextResponse.json({
      canDelete: impact.ownedOrganizations.length === 0,
      ownedOrganizations: impact.ownedOrganizations,
      organizationCount: impact.organizationCount,
      projectCount: impact.projectCount,
      assignedIssueCount: impact.assignedIssueCount,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'account-deletion-impact',
      fallbackMessage: 'Не вдалося перевірити обліковий запис',
    });
  }
}

export async function DELETE(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const uid = authorization.user.uid;

    // Irreversible and cheap to trigger by accident from a script; three
    // attempts an hour is plenty for a person who means it.
    const allowed = await enforceRateLimit('account-delete', uid, 3, 3600);
    if (!allowed) {
      return NextResponse.json({
        error: 'Забагато спроб. Спробуйте за годину',
        code: 'RATE_LIMITED',
      }, { status: 429 });
    }

    const db = getAdminDb();
    const auth = getAdminAuth();
    const memberships = await membershipsOf(db, uid);
    const ownedIds = memberships.filter(item => item.role === 'owner').map(item => item.orgId);

    // Owning an organization used to block this outright, and organization
    // deletion is disabled by a guardrail of its own — so the owner of a
    // workspace could never delete their account at all, by any route. Two
    // reasonable refusals meeting to make one inescapable state.
    //
    // The reason for the refusal is other people: a workspace with members,
    // data and billing and nobody able to administer it. That reason does not
    // exist for a workspace of one. So a sole owner may leave, and the
    // organization is stamped `ownerlessAt` rather than deleted — building the
    // cascade is somebody's decision, not a side effect of somebody leaving.
    const blockedOwnerIds = [];
    const soleOwnerIds = [];
    for (const organizationId of ownedIds) {
      const others = await db.collection('orgMemberships')
        .where('orgId', '==', organizationId)
        .limit(2)
        .get();
      const someoneElseIsHere = others.docs.some(document => document.data().userId !== uid);
      (someoneElseIsHere ? blockedOwnerIds : soleOwnerIds).push(organizationId);
    }
    if (blockedOwnerIds.length > 0) {
      throw accountError(
        409,
        'Ви власник організації, у якій є інші учасники. Передайте права власника, щоб видалити акаунт',
        { code: 'OWNS_ORGANIZATION', organizations: await organizationNames(db, blockedOwnerIds) },
      );
    }

    // Close access, and only access. `project.team` is what grants a member
    // their projects and the membership document is what every rule reads, so
    // both go. `assigneeIds`, `watcherIds`, comments and logged time stay
    // exactly as they are: they say what happened, and this is a person
    // leaving, not that work being undone.
    for (const membership of memberships) {
      const organizationId = membership.orgId;
      const orgRef = db.collection('organizations').doc(organizationId);
      const projects = await db.collection('projects')
        .where('organizationId', '==', organizationId)
        .where('team', 'array-contains', uid)
        .get();

      const archiveRef = db.collection(MEMBERSHIP_ARCHIVE).doc(membershipId(organizationId, uid));
      await db.runTransaction(async transaction => {
        // The same archive shape the administrator's removal writes, so the
        // member directory lists this seat without needing to know which of the
        // two closed it — plus the one fact that separates them.
        transaction.set(archiveRef, {
          id: membershipId(organizationId, uid),
          orgId: organizationId,
          userId: uid,
          role: membership.role,
          positionId: membership.positionId || '',
          joinedAt: membership.joinedAt || null,
          invitedBy: membership.invitedBy || null,
          projectIds: projects.docs.map(document => document.id),
          reason: 'account-deleted',
          // Reactivation reads the archive to put somebody back on their
          // projects. There is nobody to put back here, and an invitation to
          // this address would create a different account — so the flag is what
          // stops a restore from resurrecting a seat with no person in it.
          accountDeleted: true,
          deactivatedAt: FieldValue.serverTimestamp(),
        });
        transaction.delete(membership.ref);
        transaction.update(orgRef, { memberDirectoryVersion: FieldValue.increment(1) });
      });

      // Outside the transaction: an organization may hold more projects than
      // one transaction may touch, and the membership is already gone, so a
      // project left in the list grants nothing on its own.
      if (projects.size > 0) {
        const writer = db.bulkWriter();
        for (const project of projects.docs) {
          writer.update(project.ref, {
            team: FieldValue.arrayRemove(uid),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        await writer.close();
      }

      // Payroll is personal data and no part of the record of the work.
      await db.collection('organizations').doc(organizationId)
        .collection('memberRates').doc(uid).delete().catch(() => {});
    }

    // A workspace of one, now of none. Marked rather than deleted: the cascade
    // that would remove its Firestore data and its uploaded files is deliberate
    // open work (docs/ROADMAP.md), and inventing half of one here would be the
    // riskiest possible place to start it.
    if (soleOwnerIds.length > 0) {
      const writer = db.bulkWriter();
      for (const organizationId of soleOwnerIds) {
        writer.update(db.collection('organizations').doc(organizationId), {
          ownerlessAt: FieldValue.serverTimestamp(),
          ownerlessReason: 'owner-account-deleted',
        });
      }
      await writer.close();
    }

    // The profile itself, in full. Nothing personal is kept — the archive above
    // holds a role and a project list, and the directory renders the missing
    // profile as «Видалений акаунт».
    const userRef = db.collection('users').doc(uid);
    for (const name of USER_SUBCOLLECTIONS) {
      await db.recursiveDelete(userRef.collection(name)).catch(() => {});
    }
    await userRef.delete().catch(() => {});

    // Last, because it is the only step that cannot be retried by the same
    // caller: once the auth user is gone there is no token left to send.
    // Deleting the user also ends every session it had, which is why the
    // revokeRefreshTokens call that used to follow this line did nothing —
    // it threw user-not-found into an empty catch on every single run.
    await auth.deleteUser(uid);

    return NextResponse.json({
      success: true,
      organizationCount: memberships.length,
    });
  } catch (error) {
    if (error?.accountMutation) {
      return NextResponse.json({
        error: error.accountMutation.message,
        ...error.accountMutation.details,
      }, { status: error.accountMutation.status });
    }
    return routeErrorResponse(error, {
      context: 'account-delete',
      fallbackMessage: 'Не вдалося видалити обліковий запис',
    });
  }
}
