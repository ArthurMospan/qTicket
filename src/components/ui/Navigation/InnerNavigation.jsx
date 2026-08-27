'use client';
import React from 'react';
import Button from '../Button';
import Pill from '../DataDisplay/Pill';
import { PlanCrownIcon } from '@/lib/design/icons';

/**
 * The vertical menu inside a `SidebarLayout` rail — settings sections, team
 * views. Page-level navigation is the workspace sidebar; this is navigation
 * within one page.
 *
 * An entry may carry a `badge`: the one fact about that section worth knowing
 * before opening it — which plan the workspace is on, above all. It is drawn
 * beside the row rather than inside the button's label, because `Button` puts
 * its children in a single span and a trailing mark has to reach the right edge
 * on its own. `pointer-events-none` keeps the whole row one click target.
 *
 * `badgeAlert` says the badge is the one worth looking at — a plan with a
 * ceiling somebody will meet — and the kit decides what that looks like. The
 * caller used to pass the tone itself, which put a colour decision on a page.
 *
 * `locked` marks a section this plan does not include. It draws the crown in
 * the same corner, so a rail says which of its entries lead somewhere before
 * any of them is opened; what the click does is still the caller's decision.
 *
 * @param {{id: string, label: string, icon?: React.ComponentType, badge?: string, badgeAlert?: boolean, locked?: boolean}[]} props.items The entries, in order.
 * @param {string} props.activeId Id of the current entry.
 * @param {(id: string) => void} props.onChange Fires with the newly selected id.
 * @param {string} props.className Placement in the parent only.
 */
export function InnerNavigation({
  items = [],
  activeId,
  onChange,
  className = '',
}) {
  // Deduplicate and filter groups in original order of appearance
  const groups = items.reduce((acc, item) => {
    if (item.group && !acc.includes(item.group)) {
      acc.push(item.group);
    }
    return acc;
  }, []);

  return (
    <aside className={`flex-1 overflow-y-auto custom-scrollbar px-[16px] py-[32px] ${className}`}>
      {groups.map(group => (
        <div key={group} className="mb-[24px] last:mb-0">
          <p className="px-3 pb-[8px] text-[10px] font-bold text-muted uppercase tracking-widest">
            {group}
          </p>
          <div className="flex flex-col gap-[2px]">
            {items
              .filter(item => item.group === group)
              .map(item => {
                const Icon = item.icon;
                const active = activeId === item.id;
                return (
                  <div key={item.id} className="relative">
                    <Button
                      onClick={() => onChange?.(item.id)}
                      style="ghost"
                      color={item.danger ? 'red' : 'dark'}
                      size="md"
                      icon={Icon}
                      className={`w-full justify-start transition-colors ${
                        active
                          ? '!bg-line !text-ink !font-bold !border-transparent'
                          : item.danger
                          ? 'font-medium text-danger hover:bg-danger-soft'
                          : 'font-medium text-muted hover:bg-line/50 hover:text-ink'
                      }`}
                    >
                      {item.label}
                    </Button>
                    {item.badge && (
                      <Pill
                        size="sm"
                        tone={item.badgeAlert ? 'danger-strong' : 'dark'}
                        className="pointer-events-none absolute right-[10px] top-1/2 -translate-y-1/2"
                      >
                        {item.badge}
                      </Pill>
                    )}
                    {item.locked && !item.badge && (
                      <PlanCrownIcon
                        size={13}
                        aria-hidden
                        className="pointer-events-none absolute right-[12px] top-1/2 -translate-y-1/2 text-plan"
                      />
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </aside>
  );
}

export default InnerNavigation;
