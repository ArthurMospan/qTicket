'use client';

// ─── UI Kit: Data Table ──────────────────────────────────────────────────────
// Rows of figures, on the one screen that is made of them.
//
// Analytics carried three tables and each was written from scratch. «По
// проєктах» ruled its header with #f0f0f0 and its body with #f8f8f8; «Навантаження
// по виконавцях» used --color-line for both; the team overview was not a table
// at all but a six-column CSS grid duplicated in two places, one of which
// declared its column widths twice. Their header labels were 10px bold caps in
// two of the three and something else in the third, their cells were 12px and
// 13px, and each carried its own mobile fallback — one a card grid, one nothing.
//
// One table. It is a real <table>, so a screen reader gets a table; below the
// breakpoint each row folds into a labelled stack, because a six-column grid on
// a phone is a horizontal scrollbar nobody finds.
//
// That stack assumed every value was a short figure. A cell holding a task
// title was 296px wide in a 124px track and drew straight across the column
// beside it, while its own label truncated to nothing — which is why the team
// table read as text on top of text. A value that is not a figure says so with
// `wide` and gets the row to itself; the figures keep the two-column pairing
// they were designed for, and nothing is allowed to overrun its track.

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Surface from '@/components/ui/Surface';

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' };

// The chrome is the task table's, and deliberately so. Two tables in one
// product that look like two products is the complaint this answers: the grid
// on a project's «Таблиця» sits in a bordered panel with a canvas header band
// and 36px rows, while this one drew hairlines straight onto the card with
// nothing around it and rows a third taller. The behaviour stays different —
// that is the part `TaskTableView` was built for — but a row of figures is now
// read at the same weight in both places.
const HEADER_CELL = 'h-9 bg-canvas px-[10px] shadow-[inset_0_-1px_0_var(--color-line)]';
const BODY_CELL = 'px-[10px] py-0 align-middle';

// Two kinds of row, and they were both 36px. A row of figures is 36px because
// that is a line of text with air around it. A row that carries a person — a
// face, a name and what they were doing three days ago — is two lines and a
// picture, and forcing that into 36px is what put a 40px avatar inside a 36px
// row: the avatar won, the row grew anyway, and the result looked like a
// mistake because it was one.
const DENSITIES = {
  compact: 'h-9',
  comfortable: 'h-[52px]',
};

// One rhythm, three tracks. The four tables using this component had written
// eight different widths between them — 88, 90, 92, 96, 100, 110, 112, 150 —
// so «Прострочено» was 112px wide on one analytics tab and 100px on the next,
// and no two columns of figures lined up down the screen. A column says what
// kind of thing it holds and the table decides how much room that takes, which
// is the only way the beat can be the same everywhere.
//
// `figure` is sized for «Прострочено», the longest heading any of them has: a
// track that fits the widest label is the one that lets every other figure sit
// in the same column of air instead of each finding its own.
const TRACKS = {
  figure: '116px',
  meter: '184px',
  chip: '144px',
};

// A figure column is right-aligned unless it says otherwise — a column of
// numbers is read down its last digit, and having to remember to say so at
// every call site is how one of them ended up left-aligned.
const DEFAULT_ALIGN = { figure: 'right', chip: 'right', meter: 'left' };

// The type of a column of figures belongs to the table, not to each cell.
// Every call site used to spell `ui-type-figure` on a span of its own and pick
// its own colour while doing it — ink here, muted there, for facts of exactly
// the same kind. The cell carries the type; the call site is left with the one
// thing that is its own business, which is whether a number means trouble.
const FIGURE_TYPE = 'ui-type-figure';

/**
 * @typedef {object} DataTableColumn
 * @property {string} id
 * @property {string} header Column label. Also the row label in the stacked layout.
 * @property {(row: object) => React.ReactNode} cell What to draw.
 * @property {'left'|'right'|'center'} align Which edge the value sits on. Defaults from `size`: figures and chips go right.
 * @property {boolean} lead The identifying column: it leads the stacked card and never gets a label there.
 * @property {'figure'|'meter'|'chip'} size What kind of thing the column holds, which is what decides its track. A column with no `size` is the flexible one that holds the name.
 * @property {boolean} wide Its value is not a short figure — a title, a bar, a pill. In the stacked layout it takes the row to itself with the label above it, instead of being squeezed into half a phone. A `meter` or `chip` column is wide by definition and does not have to say so.
 */

/**
 * A table of figures with a stacked layout below the breakpoint.
 *
 * @param {DataTableColumn[]} props.columns What the table has.
 * @param {object[]} props.rows What it shows.
 * @param {(row: object) => string} props.rowKey Stable key per row.
 * @param {(row: object) => string} props.rowHref Makes the whole row a link, which is what a row in analytics almost always wants to be. The identifying cell is a real link; the rest of the row follows it on click.
 * @param {'compact'|'comfortable'} props.density Row height. `compact` is a row of figures; `comfortable` is a row carrying a face and two lines of text.
 * @param {string} props.emptyText Shown instead of an empty table.
 * @param {string} props.className Placement in the parent only.
 */
export default function DataTable({
  columns = [],
  rows = [],
  rowKey = row => row.id,
  rowHref,
  density = 'compact',
  emptyText = 'Немає даних',
  className = '',
}) {
  const router = useRouter();

  if (rows.length === 0) {
    return <p className={`py-6 text-center text-[12px] text-faint ${className}`}>{emptyText}</p>;
  }

  const leadColumn = columns.find(column => column.lead) || columns[0];
  const restColumns = columns.filter(column => column !== leadColumn);
  const trackOf = column => TRACKS[column.size];
  const alignOf = column => column.align || DEFAULT_ALIGN[column.size] || 'left';
  const typeOf = column => (column.size === 'figure' ? FIGURE_TYPE : '');
  const rowHeight = DENSITIES[density] || DENSITIES.compact;

  // A row that leads somewhere is clickable along its whole width. It used to
  // be clickable on the first cell only, so the way to open a person's analytics
  // was to find their name and hit that — which reads as a broken row, because
  // everything about the row says it is one thing.
  //
  // The identifying cell stays a real link, so the keyboard reaches it, the
  // middle button opens a tab and the context menu offers to copy the address.
  // The row handler is the shortcut on top of that, and it steps aside for
  // anything the reader actually aimed at.
  const followRow = href => event => {
    if (event.defaultPrevented) return;
    if (event.target.closest('a, button, input, select, textarea, [role="button"]')) return;
    router.push(href);
  };

  return (
    <div className={`min-w-0 ${className}`}>
      {/* ── Table ─────────────────────────────────────────────────────── */}
      <Surface preset="compact-bordered-card" padding="none" className="hidden min-w-0 overflow-hidden md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map(column => (
                <th
                  key={column.id}
                  scope="col"
                  style={trackOf(column) ? { width: trackOf(column) } : undefined}
                  className={`ui-type-eyebrow uppercase tracking-wide text-muted ${HEADER_CELL} ${ALIGN[alignOf(column)]}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  onClick={href ? followRow(href) : undefined}
                  className={`group border-b border-canvas transition-colors last:border-0 hover:bg-canvas ${
                    href ? 'cursor-pointer' : ''
                  }`}
                >
                  {columns.map(column => (
                    <td
                      key={column.id}
                      // A column of figures under a column of names: lining,
                      // tabular digits stand at cap height where a name is
                      // mostly x-height, so at equal weight the numbers read
                      // as the larger thing on the row. `column` steps them
                      // back to 500 and lets the name lead its own row.
                      data-ui-density={column.size === 'figure' ? 'column' : undefined}
                      className={`${rowHeight} ${BODY_CELL} ${typeOf(column)} ${ALIGN[alignOf(column)]}`}
                    >
                      {column === leadColumn && href ? (
                        // `Link`, not a bare anchor: a plain href reloaded the
                        // whole application to move between two analytics tabs.
                        // No underline: the row already fills under the pointer.
                        <Link href={href} className="block min-w-0">
                          {column.cell(row)}
                        </Link>
                      ) : column.cell(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Surface>

      {/* ── The same rows, stacked ────────────────────────────────────── */}
      <div className="flex flex-col gap-2 md:hidden">
        {rows.map(row => {
          const href = rowHref?.(row);
          const lead = (
            <div className="min-w-0 border-b border-[color:var(--color-chart-grid)] pb-2.5">
              {leadColumn.cell(row)}
            </div>
          );
          return (
            <div
              key={rowKey(row)}
              data-ui-surface="compact-bordered-card"
              data-ui-padding="sm"
              className="ui-surface flex min-w-0 flex-col gap-2.5"
            >
              {href ? <Link href={href} className="block min-w-0">{lead}</Link> : lead}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                {restColumns.map(column => ((column.wide || column.size === 'meter' || column.size === 'chip') ? (
                  <div key={column.id} className="col-span-2 flex min-w-0 flex-col gap-1">
                    <dt className="truncate text-[10px] font-semibold text-muted">{column.header}</dt>
                    <dd className="min-w-0">{column.cell(row)}</dd>
                  </div>
                ) : (
                  <div key={column.id} className="flex min-w-0 items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-[10px] font-semibold text-muted">{column.header}</dt>
                    <dd
                      data-ui-density={column.size === 'figure' ? 'column' : undefined}
                      className={`min-w-0 truncate text-right ${typeOf(column)}`}
                    >
                      {column.cell(row)}
                    </dd>
                  </div>
                )))}
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
