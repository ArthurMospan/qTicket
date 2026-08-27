import 'server-only';

import { NextResponse } from 'next/server';
import { firestoreDocumentData } from '@/lib/utils/firestoreDocument.mjs';
import {
  DEFAULT_PLAN,
  capabilityAvailability,
  capabilityById,
  normalizePlan,
  planAllows,
  planLimit,
  planName,
  planLimitRefusal,
  planUsagePeriod,
  projectsOverPlanLimit,
} from '@/lib/utils/plans.mjs';

// Where a ceiling becomes a refusal.
//
// The price list said «10 учасників» for months and nothing counted them. Three
// of the registry's ceilings now have a route that says no, and all three say
// no through this file, so a plan cannot be enforced in one place and forgotten
// in another — and cannot be worded differently either, because the sentence
// comes from the registry rather than from the route.
//
// ── The counter on the organization, and what it is not ─────────────────
//
// Every refusal here counts for real at the moment of the write: the project
// transaction counts projects, the invitation counts memberships, the AI route
// reads its own tally inside a transaction. `usage` on the organization
// document is written alongside as a **display cache** — it is what lets a
// button look refused before it is pressed and a strip appear on a screen that
// has loaded nothing but the organization. Nothing is decided from it. A client
// that wrote a smaller number into it would change what it sees and nothing
// about what it is allowed to do.

/** The plan a workspace is on, from a document snapshot or a fresh read. */
export function organizationPlan(snapshot) {
  return normalizePlan(snapshot?.exists ? snapshot.data().plan : DEFAULT_PLAN);
}

/**
 * How many people hold a seat right now.
 *
 * Membership is the existence of `orgMemberships/{orgId}_{uid}`: deactivating
 * somebody moves that document to the archive rather than flagging it, so
 * counting the collection is counting the active team with nothing to filter.
 * `count()` is an aggregation — one read per thousand documents, not one per
 * member — which matters on a plan with a daily read budget.
 */
export async function countActiveMembers(db, organizationId) {
  const snapshot = await db.collection('orgMemberships')
    .where('orgId', '==', organizationId)
    .count()
    .get();
  return snapshot.data().count;
}

/**
 * Writes the display cache, and only when it has actually moved.
 *
 * A write on every request would be a write per page view on a product whose
 * free tier is metered in writes. Never throws: the number on a badge is not
 * worth failing an invitation over.
 */
export async function recordPlanUsage(db, organizationId, patch) {
  try {
    const reference = db.collection('organizations').doc(organizationId);
    const snapshot = await reference.get();
    if (!snapshot.exists) return;
    const current = snapshot.data().usage || {};
    const changed = Object.entries(patch).some(([key, value]) => current[key] !== value);
    if (!changed) return;
    await reference.set({ usage: { ...current, ...patch } }, { merge: true });
  } catch (error) {
    console.error('[planLimits] usage cache write failed', { organizationId, error });
  }
}

/**
 * The 403 a route sends when a ceiling is in the way, or `null` to carry on.
 *
 * The body carries the machine-readable parts as well as the sentence, so the
 * screen that receives it can open the upgrade dialog on the right ceiling
 * instead of parsing Ukrainian out of an error string.
 */
export function planLimitRefusalResponse(plan, key, used) {
  const ceiling = planLimit(plan, key);
  if (used < ceiling) return null;
  return NextResponse.json({
    error: planLimitRefusal(plan, key, used),
    planLimit: { id: key, plan: normalizePlan(plan), ceiling: Number.isFinite(ceiling) ? ceiling : null, used },
  }, { status: 403 });
}

/**
 * The 403 a route sends when the plan does not include the capability at all,
 * or `null` to carry on.
 *
 * A capability is not a ceiling: nothing filled up, the plan simply does not
 * have it. That matters most *after* a downgrade, which is where these were
 * missing — a screen the plan no longer opens was hidden, and the route behind
 * it kept answering. An API key issued on Lite went on letting a caller in on
 * Free; a Telegram bot went on posting; an import went on running. Nothing is
 * deleted for it: the key, the bot and the logo all stay where they are and
 * start working again the moment the plan does.
 *
 * The sentence comes from the registry, like every other refusal here, so the
 * price list and the door cannot describe the same feature differently.
 */
export function planCapabilityRefusalResponse(plan, capabilityId) {
  if (planAllows(plan, capabilityId)) return null;
  const capability = capabilityById(capabilityId);
  const availability = capabilityAvailability(capabilityId);
  return NextResponse.json({
    error: [
      `${capability?.label || 'Ця можливість'} недоступна на тарифі ${planName(plan)}.`,
      availability && `Доступно ${availability}.`,
      'Дані збережені — усе вмикається назад разом із тарифом.',
    ].filter(Boolean).join(' '),
    planCapability: { id: capabilityId, plan: normalizePlan(plan) },
  }, { status: 403 });
}

/**
 * The same refusal for a route that has an organization id and no plan in hand.
 *
 * One extra read, on actions nobody performs twice a minute — minting an API
 * key, connecting a bot, starting an import, issuing an invoice. A route that
 * already holds the organization snapshot asks `planCapabilityRefusalResponse`
 * directly and reads nothing.
 */
export async function refuseWithoutCapability(db, organizationId, capabilityId) {
  const snapshot = await db.collection('organizations').doc(organizationId).get();
  return planCapabilityRefusalResponse(organizationPlan(snapshot), capabilityId);
}

/**
 * Re-decides which projects the plan's ceiling has no room for, and marks them.
 *
 * Not only when the plan changes. The ceiling is a comparison between a number
 * and a list, and both sides move: switching to Free with twelve projects marks
 * nine of them read-only, and then archiving one of the three that stayed makes
 * room — for one of the nine, which nothing would have noticed. A project left
 * read-only after its place was freed is the product enforcing a ceiling that is
 * no longer there.
 *
 * So it runs wherever the active set changes: the plan switch, an archive, a
 * restore, a deletion. Only the documents whose answer moved are written, so the
 * usual case — nothing over the ceiling, nothing to change — costs one query and
 * no writes at all.
 *
 * @returns {string[]} The ids that are read-only afterwards.
 */
export async function resyncProjectsOverPlanLimit(db, organizationId, plan) {
  const snapshot = await db.collection('projects')
    .where('organizationId', '==', organizationId)
    .where('status', '==', 'active')
    .get();
  const overLimit = new Set(projectsOverPlanLimit(plan, snapshot.docs.map(firestoreDocumentData)));

  const changed = snapshot.docs.filter(
    document => Boolean(document.data().overPlanLimit) !== overLimit.has(document.id),
  );
  if (changed.length) {
    const batch = db.batch();
    for (const document of changed) {
      batch.update(document.ref, { overPlanLimit: overLimit.has(document.id) });
    }
    await batch.commit();
  }
  return [...overLimit];
}

/**
 * Takes one call off this month's allowance, or refuses.
 *
 * Two steps rather than one, on purpose. `reserve` reads the tally before the
 * model is called, so a workspace at its ceiling never reaches Gemini at all;
 * `commit` increments inside a transaction, and only after an analysis actually
 * came back, so a request the provider dropped does not spend somebody's month.
 * The gap between them can let two simultaneous calls both pass at the last
 * unit, which is a better failure than charging for an answer nobody got.
 */
export async function reserveAiCall(db, organizationId, timeZone) {
  const period = planUsagePeriod(new Date(), timeZone);
  const snapshot = await db.collection('organizations').doc(organizationId).get();
  const plan = organizationPlan(snapshot);
  const usage = snapshot.exists ? snapshot.data().usage || {} : {};
  const used = usage.aiCallsPeriod === period && typeof usage.aiCalls === 'number' ? usage.aiCalls : 0;
  // The tally and the plan, not the verdict. The route asks
  // `planLimitRefusalResponse` itself, naming the ceiling where it refuses —
  // which is what `tests/plans.test.mjs` holds every `enforced: true` to, and
  // what stops a flag being flipped on a file that only looks like it counts.
  return { plan, period, used };
}

export async function commitAiCall(db, organizationId, period) {
  try {
    const reference = db.collection('organizations').doc(organizationId);
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) return;
      const usage = snapshot.data().usage || {};
      const carried = usage.aiCallsPeriod === period && typeof usage.aiCalls === 'number' ? usage.aiCalls : 0;
      transaction.set(reference, {
        usage: { ...usage, aiCalls: carried + 1, aiCallsPeriod: period },
      }, { merge: true });
    });
  } catch (error) {
    // An analysis that was delivered must not be turned into an error because
    // the tally could not be written. It undercounts; it never loses work.
    console.error('[planLimits] ai call tally failed', { organizationId, error });
  }
}
