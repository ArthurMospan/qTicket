'use client';

// One price list for the whole workspace, wherever a ceiling was met.
//
// Mounted beside the quick-view host and for the same reason: the alternative
// is every screen that can meet a ceiling owning a piece of modal state, and
// there are as many of those as there are ceilings times the places they are
// reached from. `openPlanUpgrade({ limitId })` from anywhere — a crown, the
// strip, a 403 handler — and this decides what it says.

import { useState } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { PlanDowngradeDialog, PlanUpgradeDialog } from '@/components/ui';
import { usePlanLimits } from '@/lib/hooks/usePlanLimits';
import { switchOrganizationPlan } from '@/lib/services/organizationPlan';
import { capabilityAvailability, planDowngradeNotice, planName } from '@/lib/utils/plans.mjs';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import useWorkspaceStore from '@/store/useWorkspaceStore';

export default function WorkspacePlanUpgradeHost() {
  const { activeOrgId } = useAppContext();
  const { plan, notice, used } = usePlanLimits();
  // What a downgrade would take away, held between «I picked Free» and «yes,
  // really». `null` while nothing is being asked.
  const [downgrade, setDowngrade] = useState(null);
  const planUpgrade = useWorkspaceStore(state => state.planUpgrade);
  const closePlanUpgrade = useWorkspaceStore(state => state.closePlanUpgrade);
  const showToast = useWorkspaceStore(state => state.showToast);
  const [switchingTo, setSwitchingTo] = useState('');

  if (!planUpgrade) return null;

  // Three ways in, and each knows a different amount. A crown on a ceiling
  // names the ceiling, so the live state of it is what the dialog leads with —
  // «використано 3 з 3» is the part the price list cannot say. A crown on a
  // capability names no number, only which plans have it. Opened with neither,
  // it is simply the price list.
  const limitNotice = planUpgrade.limitId ? notice(planUpgrade.limitId) : null;
  const capabilityNotice = !limitNotice && planUpgrade.capabilityId
    ? {
        title: planUpgrade.reason || 'Доступно на іншому тарифі',
        hint: capabilityAvailability(planUpgrade.capabilityId)
          ? `Ця можливість — ${capabilityAvailability(planUpgrade.capabilityId)}.`
          : '',
      }
    : null;

  const applyPlan = async (nextPlan) => {
    setSwitchingTo(nextPlan);
    try {
      await switchOrganizationPlan(activeOrgId, nextPlan);
      showToast(`Тариф змінено на ${planName(nextPlan)}`);
      setDowngrade(null);
      closePlanUpgrade();
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося змінити тариф'), 'error');
    } finally {
      setSwitchingTo('');
    }
  };

  const choosePlan = (nextPlan) => {
    if (nextPlan === plan || switchingTo || !activeOrgId) return;
    // The same question the settings screen asks, from the same registry: a
    // dialog reached from a crown must not be a quieter way to lose a feature.
    const notice = planDowngradeNotice(plan, nextPlan, used);
    if (notice) {
      setDowngrade({ ...notice, planId: nextPlan });
      return;
    }
    applyPlan(nextPlan);
  };

  return (
    <>
      <PlanUpgradeDialog
        isOpen
        onClose={closePlanUpgrade}
        notice={limitNotice || capabilityNotice}
        currentPlanId={plan}
        onChoose={choosePlan}
        busyPlanId={switchingTo}
      />
      <PlanDowngradeDialog
        isOpen={Boolean(downgrade)}
        notice={downgrade}
        onStay={() => setDowngrade(null)}
        onConfirm={() => applyPlan(downgrade.planId)}
        busy={Boolean(switchingTo)}
      />
    </>
  );
}
