'use client';

// The rail's ceiling notice, wired to the workspace it is about.
//
// The kit component is told what to say; this decides whether there is anything
// to say at all. `usePlanLimits` costs no read of its own — the projects are
// already subscribed and the rest is a field on the organization document — so a
// notice that is almost never shown is almost never paid for.
//
// Nothing to dismiss here, and that is the point of having moved it. The strip
// this replaces hung over the page and had to be closeable, which meant a
// «приховати на тиждень» that quietly hid a wall somebody was still walking into.
// A row at the foot of the rail interrupts nothing, so it can simply stay for as
// long as the ceiling does.

import { PlanLimitRail } from '@/components/ui';
import { usePlanLimits } from '@/lib/hooks/usePlanLimits';
import useWorkspaceStore from '@/store/useWorkspaceStore';

export default function WorkspacePlanLimitRail({ collapsed = false }) {
  const { notices } = usePlanLimits();
  const openPlanUpgrade = useWorkspaceStore(state => state.openPlanUpgrade);

  // One row, not three. A workspace that has filled up in every direction at
  // once would otherwise stack a wall of them at the bottom of the rail; the
  // first ceiling leads and the rest are a count beside it.
  const [leading, ...rest] = notices;
  if (!leading) return null;

  return (
    <div className={`shrink-0 pb-[10px] ${collapsed ? 'px-[10px]' : 'px-[12px]'}`}>
      <PlanLimitRail
        notice={leading}
        extra={rest.length}
        collapsed={collapsed}
        onOpen={() => openPlanUpgrade({ limitId: leading.id })}
      />
    </div>
  );
}
