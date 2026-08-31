'use client';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

const CONTEXT_GRIDS = {
  // A grid reserves its columns whether or not anything arrives to fill them,
  // so the count here is a promise about what the strip actually carries. This
  // one used to promise five cells plus a 92px «Деталі» column — a shape
  // inherited from the task manager, where the sixth field was an estimate and
  // the seventh a sprint. Those fields are gone; the columns stayed. The screen
  // handed it three children and the customer's screen handed it one, so the
  // strip drew a status pill at the far left of a grey bar and four empty
  // columns after it, and «Деталі» sat stranded in the middle of the row
  // instead of in the column reserved for it at the end.
  //
  // Five columns is now the truth: status, type, priority, assignees, due date.
  // «Деталі» exists below `sm`, where only the first two fit and the rest have
  // to live behind something — on a wider screen there is no overflow left for
  // it to hold, and a popover whose job is done is a control that opens onto a
  // repeat of what is already on screen.
  //
  // The 44px width on a phone is deliberate and stays: at 32×28, which is what
  // the condensed header left it, «Деталі» was under every touch-target
  // guideline there is and the one control people reported missing with a thumb.
  // Six cells for an agent: status, type, priority, support's assignees, the
  // customer's assignees, the resolution date. The fifth used to be a section
  // under the description — «хто у клієнта відповідає» is an attribute of the
  // request, and it read as an afterthought parked below the body text while
  // the strip above it had a column to spare.
  //
  // Six do not fit between `sm` and `lg`, so that range carries the four an
  // agent touches most and «Деталі» holds the other two. Below `sm` it is two
  // and the button, exactly as before.
  task: 'grid w-full grid-cols-[repeat(2,minmax(0,1fr))_44px] items-center gap-1.5 overflow-visible sm:grid-cols-[repeat(4,minmax(0,1fr))_44px] lg:grid-cols-[repeat(6,minmax(0,1fr))] [&>*]:min-w-0',
  // The customer's copy of it: the same cells in the same order, without the
  // one that is the desk's own — the resolution date, which is a promised time
  // the moment a customer can read it. Five, so the overflow follows the same
  // rule as the agent's.
  clientTask: 'grid w-full grid-cols-[repeat(2,minmax(0,1fr))_44px] items-center gap-1.5 overflow-visible sm:grid-cols-[repeat(4,minmax(0,1fr))_44px] lg:grid-cols-[repeat(5,minmax(0,1fr))] [&>*]:min-w-0',
};

/**
 * The strip's shared geometry.
 *
 * `readOnly` is for a reader who cannot change any of it — an external customer
 * looking at their own request. The cell keeps the same rhythm and loses the
 * three things that promise an edit: the pointer, the hover tint and `flex-1`.
 * The first two were a lie (the cell answered a click with nothing), and the
 * third is what stretches a cell to fill a grid column — right for a row of
 * controls that must line up, wrong for a handful of facts, which should take
 * the width of the words in them and stop.
 */
export function getTaskAttributeChrome({ condensed = false, readOnly = false } = {}) {
  return {
    attributeItemClass: readOnly
      ? `flex min-w-0 flex-col items-start rounded-[10px] px-2 transition-[padding,gap] duration-200 ${condensed ? 'gap-0 py-1' : 'gap-[4px] py-1.5'}`
      : `flex min-w-0 flex-1 cursor-pointer flex-col rounded-[10px] px-2 transition-[padding,gap,background-color] duration-200 hover:bg-line ${condensed ? 'gap-0 py-1' : 'gap-[4px] py-1.5'}`,
    attributeLabelClass: `block h-[14px] overflow-hidden text-[10px] font-bold leading-[14px] uppercase tracking-wider text-muted transition-[height,max-height,opacity] duration-200 ${condensed ? 'h-0 max-h-0 opacity-0' : 'max-h-[14px] opacity-100'}`,
    compactSelectClass: 'h-[22px] w-full justify-start gap-1 rounded-[10px] bg-transparent px-0 text-[13px] font-medium leading-[22px]',
    compactInputClass: 'm-0 h-[22px] w-full cursor-pointer rounded-[10px] bg-transparent p-0 text-[13px] font-medium leading-[22px] text-ink outline-none placeholder:font-medium placeholder:text-faint placeholder:opacity-100',
    // `max-sm:h-[44px]`: the condensed strip halves this control's height, which
    // is fine under a mouse and not fine under a thumb. A phone keeps the full
    // target whether or not the header has condensed.
    detailsButtonClass: `flex w-full items-center justify-center gap-1.5 rounded-[10px] px-2 text-[11px] font-bold transition-[height,background-color,color] duration-200 hover:bg-line hover:text-ink max-sm:h-[44px] ${condensed ? 'h-[28px]' : 'h-[42px]'}`,
  };
}

// The strip's own overflow control — "Деталі", the button that opens the
// less-frequently-changed fields. Its chrome was already kit-owned above, but
// the element carrying it was hand-written at the call site, so the one part
// anybody could get wrong — the pressed look — lived outside the kit.
/**
 * The strip's own overflow control — «Деталі», the button that opens the
 * less-frequently-changed fields. Its chrome was already kit-owned; the element
 * carrying it was not, so the one part anybody could get wrong — the pressed
 * look — lived outside the kit.
 *
 * @param {'details'|'cell'} props.variant Which shape: the strip's overflow control, or an attribute cell that opens a popover.
 * @param {boolean} props.condensed Scrolled state, matching the strip above it.
 * @param {boolean} props.active Whether the drawer is open; this is the pressed look. `details` only.
 * @param {React.ReactNode} props.children Label.
 * @param {string} props.className Placement in the parent only.
 */
export function AttributeTrigger({
  variant = 'details',
  condensed = false,
  active = false,
  className = '',
  children,
  ...props
}) {
  const { attributeItemClass, detailsButtonClass } = getTaskAttributeChrome({ condensed });

  // Two shapes, one component. `details` is the strip's own overflow control;
  // `cell` is an attribute cell that opens a popover — the calendar has two of
  // those, and they were hand-written buttons wearing `attributeItemClass`,
  // which meant the chrome came from the kit and the element did not.
  //
  // The pressed look belongs to `details` alone: a cell colours its own label
  // and value, so a blanket `text-muted` here would tint the value grey.
  const isCell = variant === 'cell';
  const chrome = isCell ? `${attributeItemClass} h-full w-full text-left` : detailsButtonClass;
  const tone = isCell ? '' : (active ? 'bg-white text-ink' : 'text-muted');

  return (
    <button
      type="button"
      className={`${chrome} ${className} ${tone}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * The attribute strip at the top of a task or a calendar event: status, dates,
 * assignee, and the "Деталі" drawer for the fields that change less often. Both
 * screens condense the same way on scroll, which is why the condensed geometry
 * is a prop of one component rather than two copies of a decision.
 *
 * @param {React.ReactNode} props.primaryChildren The always-visible attributes.
 * @param {React.ReactNode} props.secondaryChildren The attributes behind "Деталі".
 * @param {'task'|'clientTask'} props.context Which grid the strip uses.
 * @param {boolean} props.condensed Scrolled state: labels collapse and the rows tighten.
 * @param {boolean} props.compact Denser variant for narrow panes.
 * @param {boolean} props.singleRow Keeps everything on one row instead of wrapping.
 * @param {string} props.cardClassName Placement of the inner card only.
 * @param {React.CSSProperties} props.cardStyle Inline style for the inner card, for measured widths.
 * @param {string} props.primaryClassName Placement of the primary row only.
 * @param {string} props.className Placement in the parent only.
 */
export default function TaskAttributesPanel({
  primaryChildren,
  secondaryChildren,
  className = '',
  cardClassName = '',
  cardStyle,
  primaryClassName = '',
  context,
  singleRow = false,
  compact = false,
  condensed = false,
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={`relative overflow-visible w-full ${secondaryChildren ? 'mb-[24px]' : ''} ${className}`}>
      {/* Main card containing attributes */}
      <div
        className={`bg-canvas rounded-[14px] ${condensed ? 'px-2 py-1.5' : compact ? 'px-2.5 py-2' : 'px-4 py-3'} flex flex-col gap-3 relative z-10 ${cardClassName}`}
        style={cardStyle}
      >
        {/* Primary Row */}
        <div className={primaryClassName || CONTEXT_GRIDS[context] || (singleRow
          ? 'grid w-full grid-cols-[minmax(90px,1fr)_minmax(105px,1.15fr)_minmax(105px,1.1fr)_minmax(82px,.8fr)_minmax(72px,.7fr)_minmax(92px,.8fr)_minmax(128px,1.2fr)] items-center gap-2 overflow-x-auto overflow-y-hidden [scrollbar-width:none] lg:overflow-visible [&::-webkit-scrollbar]:hidden [&>*]:!min-w-0'
          : 'flex flex-wrap items-center gap-y-4 gap-x-6 overflow-visible')}>
          {primaryChildren}
        </div>

        {/* Collapsible Secondary Drawer */}
        {secondaryChildren && isExpanded && (
          <div className="flex flex-wrap items-center gap-y-4 gap-x-6 pt-3 border-t border-line overflow-visible animate-in slide-in-from-top-2 duration-200">
            {secondaryChildren}
          </div>
        )}
      </div>

      {/* Expand/Collapse Trigger Bar layered underneath */}
      {secondaryChildren && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="absolute left-0 right-0 bottom-[-16px] h-[28px] bg-line hover:bg-line-strong rounded-b-[16px] flex items-center justify-center text-ink-soft hover:text-ink transition-all cursor-pointer z-0"
        >
          {isExpanded ? <ChevronUp size={12} className="mt-[12px]" /> : <ChevronDown size={12} className="mt-[12px]" />}
        </button>
      )}
    </div>
  );
}
