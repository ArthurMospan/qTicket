'use client';

import React from 'react';
import { Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import { PlanCrownIcon } from '@/lib/design/icons';
import { usePlanLimits } from '@/lib/hooks/usePlanLimits';
import { capabilityAvailability, capabilityById } from '@/lib/utils/plans.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';

/**
 * A whole screen the plan does not include, and what stands there instead.
 *
 * The crown is the mark for a control that will not move. This is for the case
 * one size up: not a switch inside a screen but the screen itself — «Інтеграції»,
 * «Перенесення даних», the invoice tab. Those were open on every plan while the
 * price list sold them, which is the failure this whole registry exists to stop,
 * and there was nowhere to put a 12px crown because there was no control to put
 * it beside.
 *
 * What it draws is deliberately not an advertisement. It names the thing, says
 * in one line what it does and which plans have it, and offers one button. A
 * blurred screenshot of the feature behind a paywall — the pattern that shows
 * what somebody is missing — makes the product look like it is taunting them,
 * and it is also a lie: the blurred pixels are of somebody else's data.
 *
 * The wording is the registry's, so a screen cannot describe a capability
 * differently from the price list that sells it.
 *
 * @param {string} props.capabilityId One of `PLAN_CAPABILITIES`.
 * @param {React.ReactNode} props.children What the plan is allowed to see.
 * @param {string} props.className Placement in the parent only.
 */
export default function PlanGate({ capabilityId, children, className = '' }) {
  const { allows } = usePlanLimits();
  const openPlanUpgrade = useWorkspaceStore(state => state.openPlanUpgrade);
  const capability = capabilityById(capabilityId);

  if (allows(capabilityId) || !capability) return children;

  const gains = Array.isArray(capability.gains) ? capability.gains : [];

  return (
    // Біла картка, як усе інше на екрані.
    //
    // Тут стояла суцільна фіолетова плашка на всю ширину — єдина кольорова
    // площина в налаштуваннях, і вона кричала «ти цього не купив» голосніше,
    // ніж говорила, що це взагалі таке. Корона лишається, але як мітка на
    // звичайній поверхні, а не як колір усього блоку: те саме, що продукт
    // робить із короною біля окремого контрола.
    <div
      data-ui-surface="bordered-card"
      className={`ui-surface flex flex-col items-center px-6 py-9 text-center ${className}`}
    >
      <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-[14px] bg-plan-soft">
        <PlanCrownIcon size={22} className="text-plan" aria-hidden />
      </span>
      <h3 className="ui-type-feature-title text-ink">{capability.label}</h3>
      {capability.detail ? (
        <p className="mt-2 max-w-[440px] text-[13px] leading-relaxed text-ink-soft">{capability.detail}</p>
      ) : null}

      {/* Що саме отримає людина, а не «ця можливість на іншому тарифі».
          Речення пишуться в реєстрі поруч із назвою можливості — там, де живе
          й сама назва, — тож екран не може описати її інакше, ніж прайс-лист,
          який її продає. Три рядки, і кожен про конкретну роботу. */}
      {gains.length > 0 && (
        <ul className="mt-6 flex w-full max-w-[440px] flex-col gap-[10px] text-left">
          {gains.map(gain => (
            <li key={gain} className="flex gap-2.5">
              <Check size={15} className="mt-[2px] shrink-0 text-plan" aria-hidden />
              <span className="min-w-0 text-[13px] leading-snug text-ink-soft">{gain}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-6 text-[13px] font-bold text-plan">
        Доступно {capabilityAvailability(capabilityId)}
      </p>
      <Button
        onClick={() => openPlanUpgrade({ capabilityId, reason: capability.label })}
        style="primary"
        size="lg"
        className="mt-3"
      >
        Тарифні плани
      </Button>
    </div>
  );
}
