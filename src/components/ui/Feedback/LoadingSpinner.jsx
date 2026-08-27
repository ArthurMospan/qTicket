import React from 'react';
import { colors, sizing, typography, transitions } from '@/lib/design/tokens';

const sizes = {
  sm: {
    container: '20px',
    strokeWidth: 2,
    fontSize: typography.sizes.xs.size,
  },
  md: {
    container: '32px',
    strokeWidth: 2.5,
    fontSize: typography.sizes.sm.size,
  },
  lg: {
    container: '48px',
    strokeWidth: 3,
    fontSize: typography.sizes.body.size,
  },
};

/**
 * The kit's only spinner. Use it where the wait has no shape yet; where the
 * shape is known, an `EmptyState` or skeleton row says more.
 *
 * @param {'sm'|'md'|'lg'} props.size Diameter and stroke, from one scale.
 * @param {string} props.label Text under the ring; also what a screen reader announces.
 * @param {string} props.className Placement in the parent only.
 */
export function LoadingSpinner({
  size = 'md',
  label,
  className = '',
}) {
  const config = sizes[size] || sizes.md;
  const containerSize = parseInt(config.container);
  const radius = containerSize / 2 - config.strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
      {/* Spinning SVG Circle */}
      <svg
        width={config.container}
        height={config.container}
        viewBox={`0 0 ${containerSize} ${containerSize}`}
        className="animate-spin"
        style={{
          transitionDuration: transitions.default,
        }}
      >
        {/* Background circle (light) */}
        <circle
          cx={containerSize / 2}
          cy={containerSize / 2}
          r={radius}
          fill="none"
          stroke={colors.border.primary}
          strokeWidth={config.strokeWidth}
          opacity="0.3"
        />

        {/* Animated circle (dark) */}
        <circle
          cx={containerSize / 2}
          cy={containerSize / 2}
          r={radius}
          fill="none"
          stroke={colors.dark}
          strokeWidth={config.strokeWidth}
          strokeDasharray={circumference * 0.25}
          strokeDashoffset={0}
          strokeLinecap="round"
        />
      </svg>

      {/* Optional Label */}
      {label && (
        <p
          className="text-center font-medium"
          style={{
            color: colors.text.muted,
            fontSize: config.fontSize,
            fontWeight: typography.sizes.sm.weight,
          }}
        >
          {label}
        </p>
      )}
    </div>
  );
}

export default LoadingSpinner;
