import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authenticateRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  DEFAULT_PLAN,
  FREE_WORKSPACE,
  normalizePlan,
  storedPlanLimit,
} from '@/lib/utils/plans.mjs';
import { normalizeTimeZone } from '@/lib/utils/timeZone.mjs';

const GET_ALL_CHUNK = 100;
const DIRECTORY_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Vary: 'Authorization',
};

/**
 * Server-authoritative organization directory for the signed-in account.
 *
 * The workspace normally receives this through Firestore's live client query.
 * This route is the independent recovery path for a browser whose persistent
 * Firestore cache or network state is stuck: the caller supplies no user or
 * organization id, so the verified token is the only scope it can read.
 */
export async function GET(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const uid = authorization.user.uid;
    const db = getAdminDb();
    const membershipSnapshot = await db.collection('orgMemberships')
      .where('userId', '==', uid)
      .get();
    const memberships = membershipSnapshot.docs
      .map(document => document.data())
      .filter(membership => membership.userId === uid && membership.orgId)
      .map(membership => ({ orgId: membership.orgId, role: membership.role || null }));
    const organizationIds = [...new Set(memberships.map(membership => membership.orgId))];

    const chunks = [];
    for (let index = 0; index < organizationIds.length; index += GET_ALL_CHUNK) {
      chunks.push(organizationIds.slice(index, index + GET_ALL_CHUNK));
    }
    const documentChunks = await Promise.all(chunks.map(ids => db.getAll(
      ...ids.map(id => db.collection('organizations').doc(id)),
    )));
    const organizations = documentChunks
      .flat()
      .filter(document => document.exists)
      .map(document => ({ ...document.data(), id: document.id }));

    return NextResponse.json(
      { memberships, organizations },
      { headers: DIRECTORY_RESPONSE_HEADERS },
    );
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'organization-directory',
      fallbackMessage: 'Не вдалося перевірити список організацій',
    });
  }
}

/**
 * Creating an organization, and the one rule a Firestore rule cannot hold.
 *
 * «One free workspace per account» is a count of documents somebody owns, and
 * rules cannot count: `allow create` could only ever check that the new
 * document names its author as owner, which every second, third and tenth free
 * workspace does too. So onboarding used to write the organization straight from
 * the browser and the rule was the screen — a greyed-out card, and nothing
 * behind it.
 *
 * Both documents are written here instead, in one batch: the organization and
 * the owner's seat. `firestore.rules` refuses `create` on both, which also
 * closes the membership bootstrap that only existed to let this flow write its
 * own first seat.
 *
 * Onboarding an organization that already exists is a different thing and stays
 * where it was: it is an update by its owner, which the rules have always been
 * able to check on their own.
 */
export async function POST(request) {
  try {
    const authorization = await authenticateRequest(request);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const uid = authorization.user.uid;
    if (!(await enforceRateLimit('organization-create', uid, 5, 3600))) {
      return NextResponse.json({ error: 'Забагато спроб створити організацію' }, { status: 429 });
    }

    const body = await readJsonBody(request);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 160) {
      return NextResponse.json({ error: 'Некоректна назва організації' }, { status: 400 });
    }
    const plan = normalizePlan(body?.plan);
    const logo = typeof body?.logo === 'string' ? body.logo.trim().slice(0, 2000) : '';
    const timezone = normalizeTimeZone(body?.timezone);

    const db = getAdminDb();

    // Read by owner alone and counted here rather than asked of Firestore as a
    // second equality filter: an account has a handful of organizations, and a
    // one-field query needs no composite index to deploy alongside it.
    if (plan === DEFAULT_PLAN) {
      const owned = await db.collection('organizations').where('ownerId', '==', uid).get();
      const freeAlready = owned.docs.some(document => normalizePlan(document.data().plan) === DEFAULT_PLAN);
      if (freeAlready) {
        return NextResponse.json({
          error: FREE_WORKSPACE.refusal,
          code: 'FREE_WORKSPACE_TAKEN',
        }, { status: 403 });
      }
    }

    const organizationId = `org_${uid.slice(0, 8)}_${Date.now()}`;
    const membershipId = `${organizationId}_${uid}`;
    const batch = db.batch();
    batch.set(db.collection('organizations').doc(organizationId), {
      id: organizationId,
      name,
      logo,
      ownerId: uid,
      memberUids: [uid],
      members: [{ uid, role: 'owner', email: authorization.user.email || '' }],
      plan,
      timezone,
      // The ceilings come from the registry, never from a ternary at a call
      // site — that is what once handed Lite the unlimited copy of a ceiling
      // the price list sets at twenty.
      limits: {
        maxProjects: storedPlanLimit(plan, 'projects'),
        maxMembers: storedPlanLimit(plan, 'members'),
      },
      onboarded: true,
      onboardedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('orgMemberships').doc(membershipId), {
      id: membershipId,
      orgId: organizationId,
      userId: uid,
      role: 'owner',
      joinedAt: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return NextResponse.json({ organizationId });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'organization-create',
      fallbackMessage: 'Не вдалося створити організацію',
    });
  }
}
