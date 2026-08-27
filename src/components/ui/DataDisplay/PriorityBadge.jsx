'use client';

import PriorityIcon from './PriorityIcon';
import Pill from './Pill';
import { priorityPresentation } from '@/lib/utils/priorities.mjs';

/**
 * Priority mark plus its configured name. Geometry is shared; colour and label
 * come from the organization's ordered workflow priorities.
 *
 * @param {object|string} props.priority Priority item or id.
 * @param {object[]} props.priorities Ordered workflow priorities.
 * @param {string} props.className Placement in the parent only.
 */
export default function PriorityBadge({ priority = 'none', priorities = [], className = '' }) {
  const config = priorityPresentation(priority, priorities);
  const textColor = config.isNoPriority ? '#737373' : config.color;

  return (
    <Pill
      color={textColor}
      colorAlpha={config.isNoPriority ? '12' : '14'}
      size="lg"
      shape="badge"
      weight="medium"
      className={`backdrop-blur-[2px] ${className}`.trim()}
    >
      <PriorityIcon priority={config} priorities={priorities} />
      {config.label}
    </Pill>
  );
}
