'use client';

// ─── UI Kit: Description Placeholder ─────────────────────────────────────────
// What a task shows where its description would be: a line of italic hint text
// that is also the button which starts editing.
//
// Not a `TextAction`. That component is a colour and a hover on top of a size,
// and every size it has is semibold — this is 13px at normal weight, italic,
// and it fades faint→muted rather than toward ink. Encoding that as a fourth
// tone plus a fifth size would put two variants in the shared component for one
// caller, which is a hardcode wearing a variant's name. A look with one owner
// belongs to the component that owns it.

import React from 'react';

/**
 * What a task shows where its description would be: a line of italic hint text
 * that is also the button which starts editing.
 *
 * @param {React.ReactNode} props.children The hint.
 * @param {string} props.className Placement in the parent only.
 */
export default function DescriptionPlaceholder({ children, className = '', ...props }) {
  return (
    <button
      className={`text-[13px] text-faint italic hover:text-muted transition-colors text-left ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}
