import React from 'react';

/**
 * The kit's loading placeholder. One block, in a named shape.
 *
 * It carries no dimensions of its own: `preset`, `width` and `tone` all resolve
 * in `globals.css`, so a screen cannot hold its own copy of what a loading line
 * looks like — which is exactly how the old hand-written `bg-canvas` rectangles
 * ended up invisible on white panels and near-invisible on the sidebar.
 *
 * Hidden from assistive technology on purpose. A skeleton is scaffolding, and
 * the screen that renders it announces «Завантаження…» once, in words.
 *
 * @param {'caption'|'text'|'title'|'heading'|'control'|'field'|'avatar'|'icon'|'logo'|'card'|'tile'|'chart'|'panel'} props.preset What the arriving content is; decides height and radius.
 * @param {'full'|'wide'|'half'|'short'} props.width Share of the line it occupies. Ignored by the square presets.
 * @param {'default'|'sidebar'} props.tone Which surface it sits on; `sidebar` follows the sidebar's theme.
 * @param {string} props.className Placement in the parent only — never its own size.
 * @param {object} props.style Animation delay only, so a row of blocks does not sweep as one slab.
 */
export function Skeleton({
  preset = 'text',
  width = 'full',
  tone = 'default',
  className = '',
  style,
}) {
  return (
    <span
      aria-hidden="true"
      data-ui-skeleton-preset={preset}
      data-ui-skeleton-width={width}
      data-ui-skeleton-tone={tone}
      style={style}
      className={`ui-skeleton ${className}`}
    />
  );
}

export default Skeleton;
