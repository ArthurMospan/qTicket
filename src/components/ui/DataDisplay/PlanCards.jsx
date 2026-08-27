'use client';

import React from 'react';
import { Check, Infinity as InfinityIcon } from 'lucide-react';
import { PlanCrownIcon } from '@/lib/design/icons';
import Card from '@/components/ui/Layout/Card';
import Button from '@/components/ui/Button';
import Pill from '@/components/ui/DataDisplay/Pill';
import {
  PLANS,
  planAddedCapabilities,
  planCtaLabel,
  planInheritanceLabel,
  planLimitRows,
} from '@/lib/utils/plans.mjs';

/**
 * The price list. One of them, and only one.
 *
 * There used to be two, and they disagreed about the product: onboarding drew
 * three hand-built cards at $0/$9/$19 with four invented bullet points each and
 * a different accent colour per plan, while the settings screen drew the
 * registry. A person met the first on the day they signed up and the second the
 * first time they went looking for the bill, and nothing kept the two in step —
 * the prices had already drifted apart from what the product charges.
 *
 * So the price list is a component and the plans are data. Both screens pass
 * the same three things: which plan is already chosen, what to call it on its
 * own button, and what to do when another one is picked.
 *
 * ── Why the columns line up ──────────────────────────────────────────────
 *
 * `grid-rows-subgrid`. The card is not a stack of blocks that happen to be the
 * same height; it is five bands — name, price, ceilings, button, what the plan
 * adds — and every band is one row of the outer grid, so its height is the
 * tallest of the three across the row. That is what puts the three prices on
 * one line and the three buttons on another, whatever any card holds. A column
 * of stacked blocks cannot do it: a tagline that wraps to two lines in one card
 * pushes that card's price down and nothing else's, which is the drift that was
 * there before — every card correct on its own and the row a staircase.
 *
 * Below `lg` there is one column and nothing to align, so the card is a plain
 * flex stack.
 *
 * @param {string} props.activePlanId The plan already in force, or already picked.
 * @param {string} props.activeLabel What its own button says — «Це ваш тариф», «Обрано».
 * @param {(planId: string) => void} props.onChoose Fires with the plan whose button was pressed.
 * @param {string} props.busyPlanId The plan being switched to right now; its button spins.
 * @param {string[]} props.lockedPlanIds Plans this screen may not choose — the second free workspace on one account.
 * @param {string} props.lockedLabel What a locked plan's button says instead of its own label.
 * @param {string} props.className Placement in the parent only.
 */
export default function PlanCards({
  activePlanId,
  activeLabel = 'Це ваш тариф',
  onChoose,
  busyPlanId = '',
  lockedPlanIds = [],
  lockedLabel = 'Недоступно',
  className = '',
}) {
  const busy = Boolean(busyPlanId);

  return (
    <div
      // A tighter gutter than the rest of the product uses, on purpose: three
      // cards in a 760px reading column had 184px of text inside each once the
      // gutters and the padding were taken out, and «Активні проєкти … 10» does
      // not fit that. The gutter and the padding are the only two places that
      // width can come from without moving the column itself.
      className={`grid gap-x-3 gap-y-4 lg:grid-cols-3 lg:grid-rows-[auto_auto_auto_auto_auto] lg:gap-y-0 ${className}`}
    >
      {PLANS.map(plan => {
        const isActive = plan.id === activePlanId;
        const isLocked = lockedPlanIds.includes(plan.id);
        const added = planAddedCapabilities(plan.id);
        return (
          <Card
            key={plan.id}
            preset="bordered"
            padding="none"
            className={`flex flex-col overflow-hidden lg:grid lg:grid-rows-subgrid lg:row-span-5 ${
              isActive ? 'border-ink' : ''
            }`}
          >
            {/* Name and badge on one line, the tagline on its own underneath.
                They used to share a flex row with the badge, which meant the
                badge stole width from the tagline for the tagline's whole
                height — so the one card that carries a badge was also the one
                whose sentence was squeezed into a column two words wide.

                The badge is black. It is the only mark the most popular plan
                gets: a card in a second colour tells somebody which one we
                would like them to buy, not which one fits. */}
            <div className="flex flex-col px-5 pt-6 pb-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="ui-type-detail-title text-ink">{plan.name}</h3>
                {plan.recommended && <Pill size="md" tone="dark">Популярний</Pill>}
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">{plan.tagline}</p>
            </div>

            <p className="flex items-baseline gap-2 px-5 pb-5">
              <span className="text-[34px] font-black leading-none tracking-tight text-ink">
                {plan.priceLabel}
              </span>
              <span className="text-[13px] font-medium text-muted">{plan.currencyLabel}</span>
            </p>

            {/* The ceilings. Label left, figure right, so the three cards read
                as one table across the row.

                Both halves are ink. The labels used to be `text-muted` while
                the list of features below was ink, which put the quietest type
                on the card on the three lines somebody actually compares
                across it and the loudest on the lines that are the same in
                every column. */}
            <ul className="flex flex-col gap-[10px] px-5 pb-5">
              {planLimitRows(plan.id).map(limit => (
                // Centred, not baselined. Both halves are one line of the same
                // size, so for a figure the two are the same row; for the plan
                // with no ceiling the right-hand side is a glyph, which has no
                // baseline to sit on.
                <li key={limit.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className={`min-w-0 ${limit.absent ? 'text-faint' : 'text-ink'}`}>
                    {limit.label}
                  </span>
                  <span className={`flex shrink-0 items-center font-bold tabular-nums ${limit.absent ? 'text-faint' : 'text-ink'}`}>
                    {/* «Безліміт» is eight characters standing where every
                        other card has one or two digits — the widest thing on
                        the card, on the row somebody compares across it. */}
                    {limit.unlimited
                      ? <InfinityIcon size={18} strokeWidth={2.75} aria-label="Безліміт" />
                      : limit.value}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex flex-col gap-2 px-5 pb-6">
              {/* Every plan you are not on gets the same black button.
                  Giving one of the three a filled button and the other two a
                  grey one is the card telling somebody which plan we would
                  like them to buy — and the two grey ones then read as the
                  lesser options rather than as the other options. The one plan
                  that looks different is the one you are on, and it is a flat
                  grey block: nothing to press, and nothing shouting about it.
                  It used to be a 2px outline, which drew a heavier frame around
                  the current plan than the card itself has.

                  The label follows the direction of travel. «Почати» is what
                  Free says to a new account; said to somebody on Pro it is
                  nonsense, so a cheaper plan asks to be moved to by name. */}
              <Button
                onClick={() => onChoose?.(plan.id)}
                style={isActive ? 'secondary' : 'primary'}
                size="lg"
                icon={isLocked ? PlanCrownIcon : undefined}
                disabled={isActive || isLocked || busy}
                loading={busyPlanId === plan.id}
                className="w-full"
              >
                {isLocked ? lockedLabel : isActive ? activeLabel : planCtaLabel(plan.id, activePlanId)}
              </Button>
              <p className="text-center text-[11px] leading-relaxed text-faint">{plan.ctaNote}</p>
            </div>

            {/* Only what this plan adds. The heading says where the rest of it
                came from. The tick is the product's own ink: a green one is a
                colour the workspace uses to mean «done», spent here on «this
                line is in this plan», which it is not. */}
            <div className="flex flex-col gap-3 border-t border-line px-5 py-5">
              <p className="ui-type-eyebrow">{planInheritanceLabel(plan.id)}</p>
              <ul className="flex flex-col gap-[10px]">
                {added.map(capability => (
                  <li key={capability.id} className="flex gap-2">
                    <Check size={14} className="mt-[3px] shrink-0 text-ink-soft" />
                    <span className="min-w-0 text-[13px] leading-snug text-ink-soft">{capability.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
