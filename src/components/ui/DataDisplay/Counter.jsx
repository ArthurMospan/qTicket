'use client';
import React from 'react';

/**
 * The number on a bell, a tab or a rail item — and, as `variant="dot"`, the
 * same signal with the number left out.
 *
 * @param {number|string} props.value Printed for `variant="count"`; ignored by the dot.
 * @param {'count'|'dot'} props.variant Whether the badge carries a number or only says "there is something here".
 * @param {'info'|'danger'|'muted'|'success'} props.status Meaning, not decoration: `info` is neutral and takes the surface's opposite.
 * @param {'xs'|'sm'|'md'|'lg'} props.size `xs` (12px) is the one that fits on a bell icon; `sm` overflows there.
 * @param {'solid'|'subtle'|'inverse-outline'|'sidebar'} props.appearance Fill
 *   weight. `sidebar` is the one a navigation rail wants: it paints itself from
 *   the sidebar's own two colours, so it stays legible on the dark theme, the
 *   light theme and any brand colour an organization picks — none of which
 *   `dark` can answer, because `dark` is a boolean somebody has to set and the
 *   brand is not.
 * @param {boolean} props.dark High-contrast variant for the dark sidebar.
 * @param {string} props.className Placement in the parent only.
 */
export default function Counter({
  value,
  variant = 'count', // count, dot
  status = 'info',   // info, danger, muted, success
  size = 'md',       // sm, md, lg
  appearance = 'solid', // solid, subtle
  dark = false,      // dark theme support (high contrast on dark surfaces)
  className = '',
}) {
  if (variant === 'dot') {
    const dotSizes = {
      sm: 'w-[6px] h-[6px]',
      md: 'w-[8px] h-[8px]',
      lg: 'w-[10px] h-[10px]',
    };

    // QUI-134. `info` is the neutral "there is something here" dot — it carries
    // no semantic colour of its own, so it takes the surface's opposite: white
    // on a dark sidebar, ink on a light one. It used to be indigo with an indigo
    // glow, a brand colour the product uses nowhere else. `danger`, `success`
    // and `muted` do mean something, so they keep their hues.
    const dotColors = dark ? {
      info: 'bg-white shadow-[0_0_8px_rgba(255,255,255,0.45)]',
      danger: 'bg-danger-on-dark shadow-[0_0_8px_rgba(248,113,113,0.5)]',
      success: 'bg-success-on-dark shadow-[0_0_8px_rgba(74,222,128,0.5)]',
      muted: 'bg-muted-on-dark',
    } : {
      info: 'bg-ink',
      danger: 'bg-danger-solid',
      success: 'bg-success-solid',
      muted: 'bg-muted',
    };

    // Той самий аргумент, що вже стоїть під `appearance="sidebar"` нижче: рейка
    // фарбується організацією, а `computeSidebarTheme` гарантує 4.5:1 між
    // `--sb-text` і `--sb-bg` на будь-якому фоні, який можна обрати. Тому крапка
    // на рейці бере ту саму пару, а не булеве `dark`, яке хтось має обчислити —
    // і яке нижня панель, наприклад, не обчислює взагалі.
    const dotStyle = appearance === 'sidebar'
      ? 'bg-[var(--sb-text,var(--color-ink))]'
      : dotColors[status];

    return (
      <span
        className={`inline-block rounded-full shrink-0 ${dotSizes[size]} ${dotStyle} ${className}`}
      />
    );
  }

  // Count variant
  const outerSizes = {
    xs: 'min-w-[12px] h-[12px] px-[2px] text-[8px] font-bold',
    sm: 'min-w-[16px] h-[16px] px-[4px] text-[9px] font-bold',
    md: 'min-w-[20px] h-[20px] px-[6px] text-[10px] font-bold',
    lg: 'min-w-[24px] h-[24px] px-[8px] text-[11px] font-bold',
  };

  // `--sb-text` and `--sb-bg` are the sidebar's own pair, and
  // `computeSidebarTheme` guarantees 4.5:1 between them on every background an
  // organization can choose — so inverting them here is legible by
  // construction. Outside a rail the variables are unset and the fallbacks make
  // it the ordinary ink counter.
  const statusStyles = appearance === 'sidebar'
    ? 'bg-[var(--sb-text,var(--color-ink))] text-[var(--sb-bg,var(--color-surface))]'
    : appearance === 'subtle'
      ? 'bg-white/60 text-muted'
      // Кільце, а не рамка — і різниця тут не косметична.
      //
      // `border-[3px]` при `box-sizing: border-box` з'їдає шість пікселів із
      // двадцяти, а разом із `px-[6px]` на вміст лишається два: цифра не
      // вміщається, розпирає бейдж у ширину, і замість кола виходить овал —
      // «сплюснутий», не такий, як усі інші лічильники продукту. Внутрішнє
      // кільце малює рівно те саме, але не входить у коробку, тож бейдж
      // лишається колом з тими самими двадцятьма пікселями.
      : appearance === 'inverse-outline'
        ? 'ring-[3px] ring-inset ring-ink bg-white text-ink'
        : dark
          ? 'bg-white text-ink'
          : 'bg-ink text-white';

  // Format value (e.g. 99+)
  const displayValue = typeof value === 'number' && value > 99 ? '99+' : value;

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full tabular-nums ${outerSizes[size]} ${statusStyles} ${className}`}
    >
      {displayValue}
    </span>
  );
}
