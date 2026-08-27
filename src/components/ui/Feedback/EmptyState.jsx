'use client';
import React from 'react';
import { Button } from '../Button';

const CONTEXTS = {
  default: '',
  page: 'min-h-[328px]',
  inset: 'min-h-[280px]',
  flexible: 'flex-1',
  centered: 'm-auto',
};

const DENSITIES = {
  comfortable: 'px-6 py-16',
  compact: 'px-3 py-8',
};

const SURFACES = {
  transparent: '',
  card: 'rounded-[12px] bg-white',
};

/**
 * What a list shows when it has nothing in it: a glyph, a sentence, and the
 * action that would fill it. The four contexts differ only in how much room the
 * hole is allowed to take, which is why no call site sets its own height.
 *
 * @param {React.ComponentType} props.icon lucide glyph in the round chip.
 * @param {string} props.title One line saying what is missing.
 * @param {string} props.description One sentence saying why, or what to do.
 * @param {string} props.action Label of the primary button; without it no button is drawn.
 * @param {() => void} props.onAction Handler for that button.
 * @param {'default'|'page'|'inset'|'flexible'|'centered'} props.context How much of the screen the empty area owns.
 * @param {'comfortable'|'compact'} props.density Vertical breathing room.
 * @param {'transparent'|'card'} props.surface Whether it draws its own card behind the text.
 * @param {string} props.className Placement in the parent only.
 */
export function EmptyState({
  icon: IconComponent,
  title,
  description,
  action,
  onAction,
  children,
  context = 'default',
  density = 'comfortable',
  surface = 'transparent',
  className = '',
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${CONTEXTS[context] ?? CONTEXTS.default} ${DENSITIES[density] ?? DENSITIES.comfortable} ${SURFACES[surface] ?? SURFACES.transparent} ${className}`}>
      {/* Premium Circular Icon Wrapper */}
      {IconComponent && (
        <div className="w-[64px] h-[64px] bg-canvas rounded-full flex items-center justify-center mb-[18px] text-faint">
          <IconComponent size={32} />
        </div>
      )}

      {/* Title */}
      {title && (
        <h4 className="text-[16px] font-bold text-ink mb-[6px]">
          {title}
        </h4>
      )}

      {/* Description */}
      {description && (
        <p className="text-muted text-[13px] max-w-[280px] px-4 leading-relaxed">
          {description}
        </p>
      )}

      {/* Action Button */}
      {action && onAction && (
        <div className="mt-5">
          <Button
            style="secondary"
            size="md"
            onClick={onAction}
          >
            {action}
          </Button>
        </div>
      )}

      {children && <div className="mt-5 w-full">{children}</div>}
    </div>
  );
}

export default EmptyState;
