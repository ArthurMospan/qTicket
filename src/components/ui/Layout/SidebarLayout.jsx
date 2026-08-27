'use client';
import React from 'react';

// The two-pane workspace shell: a canvas-coloured rail beside a white pane.
//
// Three screens are built on this and only one of them used to say so. Settings
// called this component; Chat and Team each hand-wrote the same shell, which is
// how they drifted — Chat spelled the gutter `gap-3` and Settings `gap: '12px'`
// (the same 12px, twice), and the two screens that sit under the fixed 56px
// header each remembered that offset on their own. A layout is a kit decision
// like any other, so the differences are named here instead of being retyped.
//
// `wrapsContent` is the white pane the shell draws for you. Chat supplies its
// own panes — a conversation and a thread rail, side by side — so it opts out
// and its children become direct flex siblings of the rail.
export const CONTEXTS = {
  // Owns the full viewport; nothing is fixed above it.
  settings: {
    shell: 'flex-1 h-full overflow-hidden bg-white p-[12px] flex',
    wrapsContent: true,
  },
  // Sits under the fixed WorkspaceHeader, so the shell reserves its height.
  // Team's right pane is a `Surface preset="panel"`, not the plain white pane,
  // so it renders its own — the shell owns the rail and the gutter only.
  team: {
    shell: 'flex w-full h-full overflow-hidden bg-white p-[12px] pt-[56px]',
    wrapsContent: false,
  },
  // The white behind the panes used to be painted by the chat page's own
  // wrapper, so two of the three contexts declared their background here and
  // the third declared it at the call site — the exact split this component was
  // made to end. The wrapper held nothing but the shell and had the same box,
  // so the paint simply moved here.
  chat: {
    shell: 'flex-1 flex overflow-hidden bg-white p-[12px] pt-[56px]',
    wrapsContent: false,
  },
};

// What every rail inside this shell insets its content by. Two of the three
// rails already agreed on it and the third did not, which is what made the
// content jump when you moved between Чат and Команда.
export const RAIL_INSET = 'px-[16px] py-[32px]';

/**
 * The rail-plus-content frame that Settings, Team and Chat all sit in. The
 * gutter, the rail width and the 56px allowance under the fixed header live in
 * `CONTEXTS` and nowhere else — before this component the three screens each
 * remembered those numbers separately, and had already drifted apart.
 *
 * @param {React.ReactNode} props.sidebar The rail.
 * @param {React.ReactNode} props.children The content beside it.
 * @param {'settings'|'team'|'chat'} props.context Which frame: who owns the height, and whether a fixed header sits above.
 * @param {number|string} props.sidebarWidth Rail width, where the context allows it to differ.
 * @param {number|string} props.gap Gutter between rail and content.
 * @param {boolean} props.hasBorder Draws the divider between the two panes.
 * @param {'sidebar'|'content'} props.mobilePane Which pane is on screen at mobile width.
 * @param {string} props.className Placement in the parent only.
 */
export function SidebarLayout({
  sidebar,
  children,
  context = 'settings',
  className = '',
  sidebarWidth = '280px',
  gap = '12px',
  hasBorder = true,
  // Mobile single-pane mode: 'sidebar' shows only the nav, 'content' only the
  // main area (with the caller rendering its own back control). md+ ignores it.
  mobilePane = 'sidebar',
}) {
  const { shell, wrapsContent } = CONTEXTS[context] || CONTEXTS.settings;

  return (
    <div className={`${shell} ${className}`}>
      <div className="flex-1 flex overflow-hidden" style={{ gap }}>
        {/* Sidebar container */}
        <div
          className={`${mobilePane === 'content' ? 'hidden' : 'flex'} md:flex bg-canvas rounded-[16px] flex-col overflow-hidden shrink-0 w-full md:w-[var(--sbw)]`}
          style={{ '--sbw': sidebarWidth }}
        >
          {sidebar}
        </div>

        {/* Main Content container */}
        {wrapsContent ? (
          <div className={`${mobilePane === 'sidebar' ? 'hidden' : 'flex'} md:flex flex-1 bg-white flex-col overflow-hidden relative rounded-[16px] ${hasBorder ? 'border border-line' : ''}`}>
            {children}
          </div>
        ) : children}
      </div>
    </div>
  );
}

export default SidebarLayout;
