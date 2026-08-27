'use client';

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

// The frame a task and a calendar event are both drawn in.
//
// They are the same screen — a title, the strip of attributes under it, a stack
// of sections, and on a task a conversation beside it — and they had become two
// screens that merely resembled each other. The differences were never
// decisions; they were the residue of the two files being written months apart:
//
//   • the task reserved the fixed header's 56px *above* its scroll container
//     and the event reserved it *on* the container. Padding on a scroller is
//     inside the scrollport, so the event's `sticky top-0` title parked itself
//     underneath the fixed header rather than below it. That is the "зовсім
//     інший ефект" you feel the moment you scroll either page;
//   • at ≥1024px the task stopped the page scrolling and scrolled its left
//     column instead, which is a second scroll model for the same gesture.
//
// One model now, the event page's: the page scrolls, the title sticks under the
// header, and the conversation rail is `position: sticky` at the height the
// scrollport leaves it — so it holds still and scrolls itself, which is what
// the two columns were trying to do all along.
export const CONTEXTS = {
  // A task: the reading column plus its conversation rail. It fills the page
  // gutter and nothing more — a task is two columns of live controls, not a
  // measure of prose, and capping it at 1520px parked a second, much wider
  // margin outside the standard 32px gutter on any monitor past that.
  // The room under the page is `--ui-detail-bottom` in `.ui-detail-shell`, not
  // a class here: the rail's height is measured from it too, and the two cannot
  // be allowed to disagree.
  task: {
    measure: '',
    columns: 'lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]',
    hasAside: true,
  },
  // A calendar event: one reading column, so it keeps a measure.
  event: {
    measure: 'max-w-[1120px]',
    columns: '',
    hasAside: false,
  },
};

/**
 * The scroll container, measure, sticky title and optional rail that a task and
 * a calendar event share. Everything that used to differ between the two pages
 * lives in `CONTEXTS` and in `.ui-detail-shell` — not at either call site.
 *
 * @param {'task'|'event'} props.context Which detail page: how wide the measure is, and whether there is a rail.
 * @param {boolean} props.standalone A real page under the fixed header. `false` is the dialog, which owns its own chrome and height.
 * @param {React.ReactNode} props.header The title and its actions. Made sticky here.
 * @param {React.ReactNode} props.attributes The attribute strip, given the fade that hides content sliding under the title.
 * @param {boolean} props.scrolled The content has left the top — the same flag the strip condenses on, so the fade and the strip cannot disagree.
 * @param {React.ReactNode} props.aside The rail beside the content — the task's conversation.
 * @param {React.ReactNode} props.lead A full-width row above the scroller, outside the measure: the mobile pane switch.
 * @param {'content'|'aside'} props.mobilePane Which column is on screen below 1024px. Ignored above it, where both are.
 * @param {(scrolled: boolean) => void} props.onScrolledChange Fires when the content leaves the top.
 * @param {string} props.className Placement in the parent only.
 */
export default function DetailLayout({
  context = 'event',
  standalone = true,
  header,
  attributes,
  scrolled = false,
  aside,
  lead,
  mobilePane = 'content',
  onScrolledChange,
  children,
  className = '',
}) {
  const { measure, columns, hasAside } = CONTEXTS[context] || CONTEXTS.event;
  const showsAside = Boolean(hasAside && aside);
  const asideOnly = mobilePane === 'aside';

  // Is there anything left below? The reading column ends against the same
  // white it is drawn on, so a section sliding out of view simply stopped
  // existing. The same edge the board draws on its two walls answers it here,
  // and like the board's it is lit only while something is genuinely hidden.
  const shellRef = useRef(null);
  const scrollerRef = useRef(null);
  const [moreBelow, setMoreBelow] = useState(false);

  const measureBelow = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const maxScroll = node.scrollHeight - node.clientHeight;
    // One pixel of slack: fractional layout heights leave a sub-pixel of scroll
    // at the far end, which would keep the edge lit for ever.
    const next = maxScroll > 1 && node.scrollTop < maxScroll - 1;
    setMoreBelow(current => (current === next ? current : next));

    // How tall the scrollport actually is, published for the rail beside the
    // column to size itself from.
    //
    // `.ui-detail-aside` used to work this out from the window: `100dvh` less a
    // written-down allowance for the fixed header and the shell's inset. That is
    // right only while nothing is ever placed above the content panel, and
    // something was — a strip announcing a spent plan ceiling, which moved the
    // whole panel down by its height. The rail was then taller than the column
    // it lives in, so its composer hung below the bottom edge and the reading
    // column's floor floated up into the middle of the page. A measurement
    // cannot be wrong about this the way an allowance can.
    const shell = shellRef.current;
    if (!shell) return;
    const measured = `${Math.round(node.clientHeight)}px`;
    // Written only when it moves: this runs inside a ResizeObserver, and a
    // write on every callback is a layout invalidation on every callback.
    if (shell.style.getPropertyValue('--ui-detail-scrollport') !== measured) {
      shell.style.setProperty('--ui-detail-scrollport', measured);
    }
  }, []);

  // Opening a section, switching the description to the editor or loading an
  // attachment all change the answer without the window moving, and only the
  // column itself knows. Both boxes are watched: the scrollport, which changes
  // with the window, and its content, which changes with the record.
  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return undefined;
    measureBelow();
    const observer = new ResizeObserver(measureBelow);
    observer.observe(node);
    if (node.firstElementChild) observer.observe(node.firstElementChild);
    return () => observer.disconnect();
  }, [measureBelow]);

  const handleScroll = useCallback((event) => {
    measureBelow();
    onScrolledChange?.(event.currentTarget.scrollTop > 4);
  }, [measureBelow, onScrolledChange]);

  return (
    <div
      ref={shellRef}
      className={`ui-detail-shell bg-transparent ${className}`}
      data-ui-context={context}
      data-ui-density={standalone ? 'standalone' : 'embedded'}
    >
      {lead}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        data-scrolled-below={moreBelow ? 'true' : 'false'}
        className="ui-detail-scroll page-gutter custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        <div
          className={`mx-auto grid w-full grid-cols-1 gap-[20px] ${measure} ${showsAside ? columns : ''} ${
            asideOnly ? 'min-h-0 flex-1' : ''
          }`}
        >
          <div
            className={`flex min-w-0 flex-col ${showsAside && asideOnly ? 'hidden lg:flex' : ''}`}
          >
            {/* The title *and* the strip hold the top of the column, so status,
                assignee and dates stay reachable while you read. That was the
                task's behaviour and not the event's: the event closed its sticky
                box before the strip, so the same row of controls was pinned on
                one page and scrolled away on the other.
                The title paints white because sections slide underneath it; the
                strip stays transparent so its own frosted fill can show, and the
                gradient below the title hides the seam between the two. */}
            <div className="sticky top-0 z-[30]">
              <div className="bg-white">{header}</div>
              {attributes && (
                <div className="relative isolate -mx-2 px-2">
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-x-2 top-0 z-[5] h-1/2 transition-opacity duration-200 ${
                      scrolled ? 'opacity-100' : 'opacity-0'
                    }`}
                    style={{
                      background: 'linear-gradient(to bottom, rgb(255,255,255) 0%, rgba(255,255,255,0.92) 34%, rgba(255,255,255,0) 100%)',
                    }}
                  />
                  {attributes}
                </div>
              )}
            </div>

            <div className="mt-[20px] flex min-w-0 flex-col gap-6">{children}</div>

            {/* The floor the column goes under, and the room at its end — one
                element, because the room used to be the scroller's padding and
                that put it below the floor, leaving content visible under the
                bottom edge. It belongs to the column, not to the scrollport, so
                it stops short of the rail instead of laying a gradient over the
                chat. */}
            <span aria-hidden className="scroll-shadow scroll-shadow--bottom" />
          </div>

          {showsAside && (
            <div className={`ui-detail-aside ${asideOnly ? 'block' : 'hidden'} lg:block`}>
              {aside}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
