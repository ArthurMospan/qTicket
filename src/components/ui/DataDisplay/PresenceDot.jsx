'use client';


const SIZES = {
  xs: 'h-[6px] w-[6px]',
  sm: 'h-[7px] w-[7px]',
  md: 'h-[8px] w-[8px]',
  lg: 'h-[10px] w-[10px]',
  hero: 'h-[14px] w-[14px]',
};

const COLLARS = {
  canvas: 'ring-2 ring-canvas',
  white: 'ring-2 ring-white',
};

/**
 * "This person is here right now", drawn on the corner of their avatar.
 *
 * There were four of these, one per screen, at 8px, 10px, 12px and 20px, with
 * three different collar treatments — so the same fact looked like a different
 * kind of signal depending on where you saw it, and on a profile it was a
 * 28px green disc sitting on the face. It is a status mark, not a badge: it
 * should register without being read.
 *
 * The size follows the avatar it sits on rather than being chosen per call
 * site, which is what let them drift apart in the first place. The collar is
 * the surface behind it, so the dot reads as sitting on the avatar rather than
 * floating over it.
 *
 * @param {'xs'|'sm'|'md'|'lg'|'hero'} props.size Matches the avatar's own size token.
 * @param {'canvas'|'white'} props.collar Which surface the avatar sits on.
 * @param {string} props.label Accessible name; the default says what it means.
 * @param {string} props.className Placement in the parent only.
 */
export default function PresenceDot({
  size = 'md',
  collar = 'canvas',
  label = 'Зараз онлайн',
  className = '',
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-ui-presence={size}
      className={`absolute bottom-0 right-0 shrink-0 rounded-full bg-success-solid ${
        SIZES[size] ?? SIZES.md
      } ${COLLARS[collar] ?? COLLARS.canvas} ${className}`}
    />
  );
}
