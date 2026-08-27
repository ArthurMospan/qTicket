import { NextResponse } from 'next/server';
import { authorizeOrgRequest, FieldValue, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { resyncProjectsOverPlanLimit } from '@/lib/server/planLimits';
import {
  DEFAULT_PLAN,
  FREE_WORKSPACE,
  freeWorkspaceElsewhere,
  normalizePlan,
  storedPlanLimit,
} from '@/lib/utils/plans.mjs';

export async function PATCH(request, context) {
  try {
    const { organizationId } = await context.params;
    const authorization = await authorizeOrgRequest(request, organizationId, ['owner']);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });

    const body = await readJsonBody(request);
    const { action, targetUserId } = body;

    // ── Changing the plan ────────────────────────────────────────────────
    //
    // A server route rather than one field written from the browser, for the
    // reason the field itself is the smallest part of: moving down a plan has
    // to decide which projects the new ceiling no longer has room for, and mark
    // them, in the same write that changes the plan. A client that changed the
    // plan and then marked the projects would leave a window where the two
    // disagreed — and a client that simply did not mark them would leave a
    // workspace over its ceiling with nothing anywhere saying so.
    //
    // Nothing is deleted, here or downstream. A project past the ceiling goes
    // read-only and comes back untouched the moment the plan does.
    if (action === 'set-plan') {
      const plan = normalizePlan(body.plan);
      const db = getAdminDb();

      // Один безкоштовний робочий простір на акаунт — і це рахунок, тож
      // тримати його може лише маршрут: `firestore.rules` бачить один документ
      // і не вміє рахувати, скільки їх уже є.
      //
      // Створення це вже питало, а перемикання — ні, тож правило трималося на
      // одному маршруті й обходилося у два кроки: створити другу організацію на
      // платному тарифі й одразу перемкнути її на Free. Читаємо за власником і
      // рахуємо тут — акаунт має кілька організацій, а запит по одному полю не
      // потребує складеного індексу.
      if (plan === DEFAULT_PLAN) {
        const owned = await db.collection('organizations')
          .where('ownerId', '==', authorization.user.uid)
          .get();
        const taken = freeWorkspaceElsewhere(
          owned.docs.map(document => ({ id: document.id, plan: document.data().plan })),
          organizationId,
        );
        if (taken) {
          return NextResponse.json({
            error: FREE_WORKSPACE.switchRefusal,
            code: 'FREE_WORKSPACE_TAKEN',
          }, { status: 403 });
        }
      }

      await db.collection('organizations').doc(organizationId).update({
        plan,
        // The ceilings the organization document carries are the registry's,
        // never a ternary — the same rule onboarding follows.
        limits: {
          maxProjects: storedPlanLimit(plan, 'projects'),
          maxMembers: storedPlanLimit(plan, 'members'),
        },
        updatedAt: FieldValue.serverTimestamp(),
      });
      // Which projects the new ceiling has no room for is the same question
      // archiving one asks, so it is the same helper — the plan is not the only
      // side of that comparison that moves.
      const readOnlyProjectIds = await resyncProjectsOverPlanLimit(db, organizationId, plan);

      return NextResponse.json({ plan, readOnlyProjectIds });
    }

    if (action !== 'transfer-ownership' || typeof targetUserId !== 'string' || !targetUserId) {
      return NextResponse.json({ error: 'Invalid ownership transfer' }, { status: 400 });
    }
    if (targetUserId === authorization.user.uid) {
      return NextResponse.json({ error: 'Target user is already the owner' }, { status: 400 });
    }

    const db = getAdminDb();
    const orgRef = db.collection('organizations').doc(organizationId);
    const currentRef = db.collection('orgMemberships').doc(`${organizationId}_${authorization.user.uid}`);
    const targetRef = db.collection('orgMemberships').doc(`${organizationId}_${targetUserId}`);
    await db.runTransaction(async transaction => {
      const [orgSnap, currentSnap, targetSnap] = await Promise.all([
        transaction.get(orgRef), transaction.get(currentRef), transaction.get(targetRef),
      ]);
      if (!orgSnap.exists || !currentSnap.exists || !targetSnap.exists) throw new Error('NOT_FOUND');
      if (orgSnap.data().ownerId !== authorization.user.uid || currentSnap.data().role !== 'owner') throw new Error('FORBIDDEN');
      if (targetSnap.data().orgId !== organizationId || targetSnap.data().userId !== targetUserId) throw new Error('FORBIDDEN');
      if (targetSnap.data().removalPending === true) throw new Error('MEMBER_REMOVAL_PENDING');

      const now = FieldValue.serverTimestamp();
      transaction.update(currentRef, { role: 'admin', updatedAt: now });
      transaction.update(targetRef, { role: 'owner', updatedAt: now });
      transaction.update(orgRef, {
        ownerId: targetUserId,
        memberDirectoryVersion: FieldValue.increment(1),
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error.message === 'NOT_FOUND') return NextResponse.json({ error: 'Organization member not found' }, { status: 404 });
    if (error.message === 'FORBIDDEN') return NextResponse.json({ error: 'Ownership changed; reload and try again' }, { status: 409 });
    if (error.message === 'MEMBER_REMOVAL_PENDING') return NextResponse.json({ error: 'This member is being removed' }, { status: 409 });
    return routeErrorResponse(error, { context: 'organization-transfer', fallbackMessage: 'Failed to transfer ownership' });
  }
}
