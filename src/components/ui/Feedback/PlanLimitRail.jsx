'use client';

import React from 'react';
import { TriangleAlert } from 'lucide-react';

/**
 * A ceiling that has run out, said once, at the foot of the sidebar.
 *
 * ── Why it is not a strip across the top any more ────────────────────────
 *
 * It was: a band above the content panel, in the workspace shell. Everything
 * below it therefore moved down by its height whenever it appeared, and the two
 * screens that size themselves from the window rather than from their column —
 * a task and its conversation rail — were then taller than the room they had.
 * The rail dropped past the bottom edge and the floor under the reading column
 * floated up into the middle of it. A notice about the workspace does not get to
 * relayout every screen in it.
 *
 * The rail is where the workspace talks about itself: the organization, the
 * projects, the running timer. This is one more fact of that kind, and it costs
 * the page nothing.
 *
 * ── Two things it deliberately is not ───────────────────────────────────
 *
 * It is not violet and it carries no crown. The violet means «this is on
 * another plan» — a fact about the price list, which is what the crown marks
 * beside a control. This is a fact about *now*: something that was working has
 * filled up.
 *
 * It is also not shown for something the plan never had. A workspace on Free has
 * no AI audio tasks at all, and announcing that in the rail of a brand-new
 * empty workspace is not news — it is a line of the price list. `planLimitNotices`
 * filters those out; the crown on the control says it at the moment it matters.
 *
 * ── Colour, on a rail somebody else painted ─────────────────────────────
 *
 * Every value in it is mixed from `--sb-text`, so the wash, the outline and the
 * two type colours follow whatever the organization has painted its sidebar —
 * black, white, or a brand colour nobody here has seen. The one exception is the
 * glyph, which is the product's amber: it is a fill rather than text, the words
 * beside it carry the meaning, and it is what the eye finds in a column of
 * evenly quiet rows.
 *
 * @param {object} props.notice What ran out; from `planLimitNotice`.
 * @param {number} props.extra How many further ceilings are also full.
 * @param {boolean} props.collapsed The rail is a 64px strip of icons.
 * @param {() => void} props.onOpen Opens the price list on that ceiling.
 * @param {string} props.className Placement in the parent only.
 */
export default function PlanLimitRail({ notice, extra = 0, collapsed = false, onOpen, className = '' }) {
  if (!notice) return null;

  // The rail has room for the noun, not for the sentence. «Ліміт активних
  // проєктів вичерпано» is the sentence, and it is what the title attribute and
  // the screen reader get; the two lines say the same thing in the width there
  // actually is.
  const sentence = [notice.title, notice.reading && `(${notice.reading})`, extra > 0 && `Ще ${extra} стеля цього тарифу вичерпана.`]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={onOpen}
      title={sentence}
      aria-label={`${sentence} Відкрити тарифні плани.`}
      data-ui-rail-notice={collapsed ? 'collapsed' : 'expanded'}
      className={`ui-rail-notice ${className}`}
    >
      <TriangleAlert size={collapsed ? 16 : 14} className="ui-rail-notice__mark" aria-hidden />
      {!collapsed && (
        <span className="ui-rail-notice__body">
          <span className="ui-rail-notice__title">{notice.label}</span>
          <span className="ui-rail-notice__detail">
            {notice.reading ? `Вичерпано · ${notice.reading}` : 'Вичерпано'}
          </span>
        </span>
      )}
      {!collapsed && extra > 0 && <span className="ui-rail-notice__extra">+{extra}</span>}
    </button>
  );
}
