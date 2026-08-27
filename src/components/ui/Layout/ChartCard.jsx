'use client';

// ─── UI Kit: Chart Card ──────────────────────────────────────────────────────
// One block of analytics: a white card, the page's heading, and whatever
// measures the thing the heading names.
//
// It was written three times — once on the workspace analytics screen, once in
// the project's analytics tab, once in the workload tab — as three copies of
// the same four lines. Copies drift: two of them never learnt `action`, and the
// count beside a title ended up spelled as `meta` in one file and as a `Pill`
// in the next, so «По проєктах · 2 проєкти» sat directly above «Прострочені 3».
// The count is `count` here and there is nowhere else to put it.
//
// `TaskListCard` is the same shape with the list already decided; this one
// holds a chart, a table, or anything else the block is made of.

import React from 'react';
import Card from '@/components/ui/Layout/Card';
import DetailSection from '@/components/ui/Layout/DetailSection';

/**
 * A titled block of an analytics screen.
 *
 * @param {React.ComponentType} props.icon The block's glyph.
 * @param {string} props.title What the block measures.
 * @param {number} props.count How many things it is about — drawn as the same pill every count in the product is.
 * @param {React.ReactNode} props.meta A quiet clause after the title: a period, a total, a budget. Never a count.
 * @param {React.ReactNode} props.action A control belonging to the heading.
 * @param {React.ReactNode} props.children The chart, table or list itself.
 * @param {string} props.className Placement in the parent only.
 */
export default function ChartCard({ icon, title, count, meta, action, children, className = '' }) {
  return (
    <Card preset="borderless" padding="lg" className={className}>
      <DetailSection icon={icon} title={title} count={count} meta={meta} action={action}>
        {children}
      </DetailSection>
    </Card>
  );
}
