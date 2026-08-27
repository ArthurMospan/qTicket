'use client';
import React, { Children, Fragment, isValidElement, useState } from 'react';
import { createPortal } from 'react-dom';
import { Filter } from 'lucide-react';
import Tabs from '../Tabs';
import Button from '../Button';
import Dialog from '../Dialog';
import Counter from '../DataDisplay/Counter';
import FilterBar, { countActiveFilters } from '../FilterBar';

// ─── UI Kit: PageHeader Component ────────────────────────────────────────────
// Standard page header used across ALL workspace pages.
//
// Typography rule: main title is ALWAYS 24px (text-2xl), font-bold.
// Spacing rule: pt-0 from top (from the workspace header below), mb-[24px]
//
// One layout: a standalone page title row with an optional tabs row below.

/**
 * The block at the top of a screen: title, tabs, filters and actions, in the
 * one arrangement every page uses. It declares no variants — the second layout
 * it once had went out with the route that was its only caller.
 *
 * @param {string} props.title Page title.
 * @param {{id: string, label: string}[]} props.tabs Tabs under the title.
 * @param {string} props.activeTab Id of the current tab.
 * @param {(id: string) => void} props.onTabChange Switches tabs.
 * @param {React.ReactNode} props.filters The `FilterBar` row.
 * @param {React.ReactNode} props.actions Controls on the right.
 * @param {React.ReactNode} props.mobileActions What replaces them at mobile width.
 * @param {string} props.className Placement in the parent only.
 */
export function PageHeader({
  title,
  tabs       = [],
  activeTab,
  onTabChange,
  actions,
  // Mobile-only action buttons (e.g. an icon CTA that duplicates a desktop
  // filters-row button). Wrapper is md:hidden, so on desktop it contributes
  // neither DOM width nor flex gap.
  mobileActions,
  filters,
  className  = '',
}) {
  // Mobile-only: filters live in a dialog. Expanding them inline pushed the
  // page content off a phone screen — four fixed-width selects wrap onto three
  // rows and ate most of the viewport before a single task was visible.
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const activeFilterCount = countActiveFilters(filters);

  // Inside the dialog every control spans the full width instead of keeping its
  // desktop fixed width. The filters slot is an arbitrary tree (fragment, flex
  // wrapper, …), so find the bar wherever it sits.
  //
  // Reproducing that tree inside the sheet was the bug. It is authored as a
  // desktop *row* — `flex items-center justify-between`, with a trailing group
  // pushed out by `ml-auto` — and a row 358px wide does not fold on its own:
  // «Мої завдання» put its column-visibility button half off the right edge of
  // the sheet. So the sheet does not reproduce the row, it reads it. Every
  // filter bar comes through stacked, anything the row itself hides on a phone
  // stays hidden, and whatever is left is a control rather than a filter — it
  // goes full width under the filters, which is where a thumb can reach it.
  const sheetContent = node => {
    const bars = [];
    const controls = [];
    const walk = children => Children.forEach(children, child => {
      if (!isValidElement(child)) return;
      // `hidden` / `max-md:hidden` is the row saying this is desktop furniture:
      // a view switcher, a period stepper the screen re-renders under the
      // header. Note that `md:hidden` is the opposite claim and is kept.
      if (/(?:^|\s)(?:max-md:hidden|hidden)(?:\s|$)/.test(child.props?.className || '')) return;
      if (child.type?.isFilterBar) {
        bars.push(<FilterBar key={`bar-${bars.length}`} {...child.props} context="stacked" />);
        return;
      }
      // A plain element is layout, not a control: walk through it. A component
      // is the control itself.
      if ((child.type === Fragment || typeof child.type === 'string') && child.props?.children) {
        walk(child.props.children);
        return;
      }
      controls.push(child);
    });
    walk(node);
    return { bars, controls };
  };
  const { bars: stackedFilters, controls: sheetControls } = sheetContent(filters);

  // There used to be an `alt` variant here — a compact bar with the title on
  // the same line as the tabs. It had exactly one caller, the project portal at
  // `/[projectId]/portal`, and that route was unreachable: nothing in the
  // product linked to it, and its own tabs pointed back at the project. So the
  // second look this component offered had never been seen on a screen. Both
  // are gone; PageHeader has one variant, and it is the one people use.

  // ── Full page header with top spacing, sticky with premium blur + dynamic gradient layers ────────────────────────
  return (
    <div className={`sticky top-[56px] z-20 shrink-0 flex flex-col pt-[12px] pb-[12px] gap-[10px] full-bleed ${className}`}>

      {/* LAYER 1 (Bottom): Premium vertical fade mask (from solid white at top to transparent at bottom).
          Rounded corners only on md+ where the white panel itself is rounded — on mobile they'd leak content. */}
      <div className="absolute inset-0 z-[-2] bg-gradient-to-b from-white via-white/95 to-transparent pointer-events-none rounded-none md:rounded-t-[24px]" />

      {/* LAYER 2 (Top): Pure frosted backdrop-blur layer to smoothly dissolve scrolling text/images */}
      <div className="absolute inset-0 z-[-1] backdrop-blur-md bg-white/20 pointer-events-none" />

      {/* Row 1: Title + Actions — actions ALWAYS sit right of the title, on
          every width. They used to drop onto a second line below the title
          under 640px, which cost a phone a whole row of vertical space and put
          «Фільтри» and «Створити» somewhere no thumb expects them. Every action
          that ships here either collapses to a square at `sm` or already is
          one, so the row fits. */}
      <div className="flex w-full items-center justify-between gap-[10px] sm:gap-[12px] md:gap-[16px]">
        {/* A floor under the title, not `min-w-0`: with the actions on the same
            line a wide, non-collapsing action group could squeeze the h1 to
            nothing, and a screen with no name on it is worse than one whose
            buttons have to scroll. Which they now can — that is what the
            overflow on the actions row is for. */}
        <h1 className="min-w-[92px] flex-1 truncate text-[20px] font-bold tracking-tight text-ink sm:text-[24px]">
          {title}
        </h1>

        {/* The vertical padding is what keeps the filters badge whole. A box
            that scrolls on one axis clips on both — `overflow-x: auto` turns the
            visible y axis into `auto` too — so the counter pinned to the corner
            of the filters button had its top slice cut off by this row's own
            edge. The padding gives the badge somewhere to be; the matching
            negative margin means the row still occupies exactly the height it
            did before, on every width. */}
        <div className="flex min-w-0 items-center justify-end gap-[8px] overflow-x-auto hide-scrollbar py-[6px] -my-[6px]">
          {tabs?.length > 0 && (
            <div className="hidden md:block">
              <Tabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
            </div>
          )}
          {/* Mobile filters toggle — sits with the action buttons */}
          {filters && (
            <div className="relative md:hidden">
              <Button
                style={activeFilterCount > 0 ? 'primary' : 'secondary'}
                size="icon-lg"
                icon={Filter}
                onClick={() => setMobileFiltersOpen(true)}
                title="Фільтри"
                aria-label="Фільтри"
              />
              {activeFilterCount > 0 && (
                <Counter
                  value={activeFilterCount}
                  size="sm"
                  // Flush with the button's right edge rather than hanging past
                  // it: the badge on the last control in a scrolling row is the
                  // one thing that can give the row a few pixels of horizontal
                  // scroll with nothing in them.
                  className="pointer-events-none absolute right-0 -top-1"
                />
              )}
            </div>
          )}
          {mobileActions && (
            <div className="md:hidden flex items-center gap-[8px] shrink-0">
              {mobileActions}
            </div>
          )}
          {actions && (
            <div className="flex items-center gap-[8px] shrink-0">
              {actions}
            </div>
          )}
        </div>
      </div>

      {/* Row 1.5 (mobile only): tabs scroll edge-to-edge */}
      {tabs?.length > 0 && (
        <div className="md:hidden overflow-x-auto hide-scrollbar full-bleed">
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} className="w-max" />
        </div>
      )}

      {/* Row 2: Filters — desktop only; phones get the dialog below */}
      {filters && (
        <div className="hidden md:flex items-center gap-[12px] flex-wrap">
          <div className="flex items-center gap-[12px] flex-wrap flex-1 min-w-0">
            {filters}
          </div>
        </div>
      )}

      {/* Portaled to the body: this header is sticky and sits under blurred
          layers, which give `position: fixed` a containing block and would
          otherwise anchor the overlay to the header instead of the viewport. */}
      {filters && mobileFiltersOpen && typeof document !== 'undefined' && createPortal(
        <Dialog
          isOpen
          onClose={() => setMobileFiltersOpen(false)}
          title="Фільтри"
          size="sm"
          footer={(
            <Button style="primary" size="md" className="w-full" onClick={() => setMobileFiltersOpen(false)}>
              Готово
            </Button>
          )}
        >
          <div className="flex flex-col gap-[16px]">
            {stackedFilters}
            {sheetControls.length > 0 && (
              <div className="flex flex-col gap-[12px] [&>*]:w-full">
                {sheetControls}
              </div>
            )}
          </div>
        </Dialog>,
        document.body,
      )}
    </div>
  );
}

export default PageHeader;
