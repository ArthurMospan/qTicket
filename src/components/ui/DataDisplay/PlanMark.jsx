'use client';

import React from 'react';
import IconAction from '@/components/ui/IconAction';
import { PlanCrownIcon } from '@/lib/design/icons';
import useWorkspaceStore from '@/store/useWorkspaceStore';

/**
 * A gold crown beside something this plan does not reach.
 *
 * It belongs next to the control, not on the price list. A price list already
 * says what a plan has by listing it; the useful place for this mark is the
 * moment somebody reaches for a switch and finds it will not move — that is
 * where «чому» is being asked, and a greyed control with no reason beside it is
 * indistinguishable from a broken one.
 *
 * Two things changed about it, and both were the same mistake. It was a small
 * black star, which meant the mark for «you cannot do this» was the mark every
 * other product on earth uses for «I like this», drawn in the same ink as
 * everything around it so that nothing drew the eye to the one place an answer
 * was needed. And it was not clickable, so the answer stopped at a tooltip:
 * the reader learned the name of a plan and was left to go and find it.
 *
 * Now it opens the dialog, on the ceiling that was actually in the way.
 *
 * @param {string} props.label Why the control will not move — the tooltip and the accessible name.
 * @param {string} props.limitId Which ceiling, when it is one of `PLAN_LIMITS`.
 * @param {string} props.capabilityId Which capability, when it is one of `PLAN_CAPABILITIES`.
 * @param {'micro'|'xs'|'sm'} props.size Box size; `micro` is the inline mark beside a label.
 * @param {string} props.className Placement in the parent only.
 */
export default function PlanMark({
  label,
  limitId = '',
  capabilityId = '',
  size = 'micro',
  className = '',
}) {
  const openPlanUpgrade = useWorkspaceStore(state => state.openPlanUpgrade);
  if (!label) return null;
  return (
    <IconAction
      label={label}
      icon={PlanCrownIcon}
      size={size}
      appearance="plan"
      shape="circle"
      tooltip
      onClick={() => openPlanUpgrade({ limitId, capabilityId, reason: label })}
      className={className}
    />
  );
}
