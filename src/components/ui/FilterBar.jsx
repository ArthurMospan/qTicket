import React, { Children, cloneElement, isValidElement } from 'react';

// ─── UI Kit: FilterBar Component ──────────────────────────────────────────────
// A unified container for filter controls (Select, MultiSelect).
// Renders a soft gray background area that groups the filters visually.
//
// The `stacked` context is what PageHeader uses when it moves the same controls
// into the mobile filters dialog.

const WIDTHS = {
  default: {
    type: 'w-[136px]',
    date: 'w-[136px]',
    member: 'w-[148px]',
    project: 'w-[200px]',
    sort: 'w-[180px]',
    priority: 'w-[148px]',
    sprint: 'w-[148px]',
    status: 'w-[148px]',
  },
  detail: {
    type: 'w-[136px]',
    date: 'w-[136px]',
    member: 'w-[148px]',
    project: 'w-[210px]',
    sort: 'w-[180px]',
    priority: 'w-[148px]',
    sprint: 'w-[148px]',
    status: 'w-[148px]',
  },
  // Project cards already set the horizontal rhythm. Their filters size to the
  // selected label instead of reserving three unrelated fixed columns.
  projects: {
    type: 'w-max max-w-full',
    date: 'w-max max-w-full',
    member: 'w-max max-w-full',
    project: 'w-max max-w-full',
    sort: 'w-max max-w-full',
    priority: 'w-max max-w-full',
    sprint: 'w-max max-w-full',
    status: 'w-max max-w-full',
  },
  // Stacked inside the mobile dialog: every control spans the full width.
  stacked: {
    type: 'w-full',
    date: 'w-full',
    member: 'w-full',
    project: 'w-full',
    sort: 'w-full',
    priority: 'w-full',
    sprint: 'w-full',
    status: 'w-full',
  },
};

export function getFilterControlWidth(role, context = 'default') {
  if (!role) return '';
  return WIDTHS[context]?.[role] ?? WIDTHS.default[role] ?? '';
}

// A filter counts as active when it is not on its neutral value: 'all' for a
// single Select, an empty array for a MultiSelect. PageHeader badges the mobile
// filters button with this count.
//
// Sorting is not filtering. A sort control always holds a real value — «Останні
// оновлення» is as much a choice as any other — so counting it meant the
// projects screen opened with «Фільтри (1)» before anyone had touched a thing,
// and the badge stopped meaning "something here is hiding rows from you".
const UNCOUNTED_ROLES = new Set(['sort']);

export function countActiveFilters(node) {
  let count = 0;
  const walk = children => Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (!child.props.filterRole) {
      if (child.props.children) walk(child.props.children);
      return;
    }
    if (UNCOUNTED_ROLES.has(child.props.filterRole)) return;
    const { value } = child.props;
    if (Array.isArray(value)) {
      if (value.length > 0) count += 1;
    } else if (value !== undefined && value !== 'all' && value !== '') {
      count += 1;
    }
  });
  walk(node);
  return count;
}

/**
 * The row of filters under a page header. It owns the widths: a control inside
 * it declares its `filterRole` and the bar decides how wide that role is, so
 * the same filter is the same width on every screen.
 *
 * @param {React.ReactNode} props.children The filter controls.
 * @param {'default'|'detail'|'projects'|'stacked'} props.context Width scale for the host layout.
 * @param {string} props.className Placement in the parent only.
 */
export default function FilterBar({ children, context = 'default', className = '' }) {
  const controls = Children.map(children, child => {
    if (!isValidElement(child) || !child.props.filterRole) return child;
    return cloneElement(child, {
      filterContext: child.props.filterContext || context,
    });
  });

  if (context === 'stacked') {
    return <div className={`flex flex-col gap-[12px] ${className}`}>{controls}</div>;
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 ${context === 'detail' ? 'bg-white' : 'bg-canvas'} rounded-[10px] p-[4px] min-h-[36px] w-max max-w-full ${className}`}>
      {controls}
    </div>
  );
}

// Static marker rather than `type.name`, which minification rewrites: PageHeader
// uses it to find the bar inside an arbitrary filters slot.
FilterBar.isFilterBar = true;
