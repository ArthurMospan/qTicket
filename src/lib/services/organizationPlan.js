'use client';

import { auth } from '@/lib/firebase';
import { normalizePlan } from '@/lib/utils/plans.mjs';

/**
 * Switching plans, with nothing to pay yet — and everything a switch implies.
 *
 * Two screens do it — the settings section and the dialog the crown opens — so
 * it lives here rather than in whichever of them was written first.
 *
 * It used to be one field written straight from the browser. It cannot be:
 * moving down a plan has to decide which projects the new ceiling no longer has
 * room for and mark them read-only in the same write, and `plan` has joined
 * `apiKeys` among the fields firestore.rules refuses from a client. What comes
 * back is the plan and the projects that went quiet.
 */
export async function switchOrganizationPlan(organizationId, plan) {
  const next = normalizePlan(plan);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'set-plan', plan: next }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Не вдалося змінити тариф');
  return result.plan || next;
}
