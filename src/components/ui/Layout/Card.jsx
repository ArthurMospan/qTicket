'use client';

/**
 * A bounded block of content. `Card` is `Surface` with the four presets a card
 * can take; reach for `Surface` when the block is a region of a page rather
 * than an object in a list.
 *
 * @param {'bordered'|'bordered-compact'|'borderless'|'canvas'|'elevated'} props.preset Which surface it draws. Wins over `variant`.
 * @param {'white'|'gray'} props.variant Legacy shorthand kept for existing call sites; `gray` means `preset="canvas"`.
 * @param {'none'|'sm'|'md'|'lg'} props.padding Inner spacing token.
 * @param {boolean} props.interactive Adds the pointer and the hover an openable
 *   row gets everywhere in the product — the same tint and halo `TaskRow` uses,
 *   so an integration and a task answer the cursor identically. It used to
 *   darken its border too, which no list row does.
 * @param {() => void} props.onClick Click handler.
 * @param {string} props.className Placement in the parent only.
 */
export default function Card({
  children,
  variant = 'white',
  preset,
  padding = 'md',
  interactive = false,
  onClick,
  className = '',
}) {
  const presetMap = {
    bordered: 'bordered-card',
    // The same card at the inset radius, for cards that sit in a grid of their
    // own rather than on a page: the QuickTeam+ material tiles are 12px, and a
    // 16px one among them reads as a different kind of object.
    'bordered-compact': 'compact-bordered-card',
    borderless: 'card',
    canvas: 'panel',
    elevated: 'elevated-card',
  };
  const resolvedPreset = preset || (variant === 'gray' ? 'canvas' : 'bordered');

  // A card that does something when clicked is a control, and a `div` with an
  // onClick is not one: no focus, no Enter, invisible to a screen reader. When
  // there is a handler the element is a real button, stripped of the chrome a
  // button brings so the surface still draws itself.
  const Element = onClick ? 'button' : 'div';

  return (
    <Element
      data-ui-surface={presetMap[resolvedPreset] ?? 'bordered-card'}
      data-ui-padding={padding}
      type={onClick ? 'button' : undefined}
      className={`
        ui-surface
        ${onClick ? 'block w-full text-left' : ''}
        ${interactive ? 'cursor-pointer hover:bg-canvas hover:ring-4 hover:ring-line transition-all duration-200' : ''}
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </Element>
  );
}
