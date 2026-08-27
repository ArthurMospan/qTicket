'use client';

import React from 'react';
import Pill from '@/components/ui/DataDisplay/Pill';

// One titled block of a detail page, at either of the two levels such a page
// has: the block itself, and a list grouped inside it.
//
// There were four headings doing this across two pages that are supposed to
// look alike, and one page had two of them on the same panel. «Опис» on a task
// was a 14px h2 with a 12px gap; «Вкладення» and «Зв'язки», thirty pixels below
// it, were 12px h3s with a 13px icon; «Опис» on an event was a 14px h2 with a
// 14px icon and a 12px margin; «Місце» beside it used a different gap again. The
// two levels are real — «Опис» names the panel, «Вкладення» names a list inside
// it — but four spellings of two levels is not a hierarchy, it is a drift.
//
// The count is a `Pill` because a count is a `Pill` everywhere else in the
// product, and `meta` is the quiet clause some blocks need after it:
// "3/7 · 4 ще в роботі".

export const DENSITIES = {
  // Names a block of the page. Sits directly on the page background.
  section: { title: 'ui-type-card-title', icon: 14, gap: 'gap-3' },
  // Names a list inside a block that already has a heading.
  group: { title: 'ui-type-item-title', icon: 13, gap: 'gap-2.5' },
};

/**
 * A titled block of a task or a calendar event.
 *
 * @param {React.ComponentType} props.icon The block's glyph.
 * @param {string} props.title What the block is.
 * @param {number} props.count How many things are in it; drawn only when there are any.
 * @param {React.ReactNode} props.meta A quiet clause after the count — progress, a ratio, a warning.
 * @param {React.ReactNode} props.action A control belonging to the heading rather than to the content.
 * @param {React.ReactNode} props.back The way out of a drilled-in view. It leads the heading, because that is where a way back is looked for.
 * @param {'section'|'group'} props.density Which of the page's two heading levels this is.
 * @param {string} props.className Placement in the parent only.
 */
export default function DetailSection({
  icon: Icon,
  title,
  count,
  meta,
  action,
  back,
  density = 'section',
  children,
  className = '',
}) {
  const level = DENSITIES[density] || DENSITIES.section;
  const Heading = density === 'group' ? 'h3' : 'h2';

  return (
    <section className={`flex min-w-0 flex-col ${level.gap} ${className}`}>
      <div className="flex items-center gap-2">
        {/* Вихід веде заголовок, а не замикає рядок.
            «Усі знахідки» стояло `ml-auto` в дальньому правому кінці шапки —
            за тисячу з гаком пікселів від назви, найтихішим стилем на екрані, —
            і це був єдиний спосіб вийти зі списку однієї знахідки. Назад
            шукають ліворуч від заголовка, і продукт скрізь так і робить. */}
        {back}
        {Icon && <Icon size={level.icon} className="shrink-0 text-muted" />}
        <Heading className={`${level.title} text-ink`}>{title}</Heading>
        {count > 0 && <Pill tone="ink-subtle" size="sm">{count}</Pill>}
        {meta && <span className="text-[11px] font-medium text-muted">{meta}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}
