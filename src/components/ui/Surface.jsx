'use client';

// ─── UI Kit: Surface Component ────────────────────────────────────────────────
// Architecture rule:
//   Content area  → always white (#ffffff)
//   Logical block → Surface panel (gray #f4f4f5, rounded-[16px])
//   White card    → Surface card  (white, rounded-[16px], no border, no shadow)
//   Nested block  → Surface inset (dark gray #f0f0f0, rounded-[12px])
//
// Border radius rule for surfaces: Panel/Card is 16px (rounded-[16px]), Inset is 12px (rounded-[12px]).
// If Card is nested inside Panel, apply !rounded-[12px] to satisfy concentric nesting.

export const PRESETS = {
  // Gray surface — separates logical blocks in a white content area
  panel: 'panel',
  // White card surface — lifts content cleanly
  card: 'card',
  // Inset surface — for nested elements within a surface
  inset: 'inset',
  // Nested white cards use the smaller concentric radius.
  'nested-card': 'nested-card',
  'nested-panel': 'nested-panel',
  // Billing and other data-heavy panels need an explicit boundary.
  'bordered-panel': 'bordered-panel',
  'bordered-card': 'bordered-card',
  'compact-bordered-card': 'compact-bordered-card',
  'compact-bordered-panel': 'compact-bordered-panel',
  popover: 'popover',
};

/**
 * The kit's background block: every grey panel, white card and inset in the
 * product is this component. It renders no geometry of its own — the preset and
 * the padding token resolve in `globals.css` under `data-ui-surface` and
 * `data-ui-padding`, which is what makes one change there reach every screen.
 *
 * @param {string} props.preset Which named surface to draw. Wins over `variant`.
 * @param {'panel'|'card'|'inset'} props.variant Legacy shorthand kept for existing call sites.
 * @param {'none'|'xs'|'sm'|'md'|'lg'|'xl'|'xxl'} props.padding Inner spacing token.
 * @param {string} props.composition Named size contract for a specific place, resolved in globals.css.
 * @param {string} props.className Placement in the parent only — never its own radius, padding or background.
 */
export default function Surface({
  variant   = 'panel',   // 'panel' | 'card' | 'inset'
  preset,
  padding   = 'md',      // 'none' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl'
  composition,           // named size contract, resolved in globals.css
  className = '',
  children,
  ...props
}) {
  const semanticPreset = PRESETS[preset || variant] ?? PRESETS.panel;

  return (
    // Решта пропсів іде на елемент — як у решти компонентів кіта.
    //
    // Цей був винятком, і мовчазним: `onClick`, `role`, `tabIndex` і `title`
    // просто зникали дорогою. Рядок історії рахунків отримав обробник кліку й
    // не отримав нічого — він виглядав натисним і не робив нічого, а помилки
    // ніде не було, бо ніхто нічого не ламав: пропси нікуди не передавались.
    <div
      {...props}
      data-ui-surface={semanticPreset}
      data-ui-padding={padding}
      data-ui-composition={composition}
      className={`ui-surface ${className}`}
    >
      {children}
    </div>
  );
}
