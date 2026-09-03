'use client';
import React from 'react';
import Button from '../Button';

/**
 * The vertical menu inside a `SidebarLayout` rail — settings sections, team
 * views. Page-level navigation is the workspace sidebar; this is navigation
 * within one page.
 *
 * @param {{id: string, label: string, icon?: React.ComponentType}[]} props.items The entries, in order.
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

  // Below md the rail *is* the screen, and it is the element that scrolls: the
  // shell around it is height-locked (`SidebarLayout` gives the pane
  // `overflow-hidden` and the rail column a fixed height), so the page cannot
  // scroll on the rail's behalf and its last entries sat behind the floating tab
  // bar. It therefore ends with the bar's footprint, exactly as MemberRail
  // already does. Inside a dialog globals.css zeroes that tail, so this is safe
  // wherever the rail is embedded, and above md the class matches no rule at all.
  return (
    <aside className={`qt-nav-scroll flex-1 overflow-y-auto custom-scrollbar px-[16px] py-[32px] ${className}`}>
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
