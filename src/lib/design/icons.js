// src/lib/design/icons.js
// The glyph the product uses for each of its own things.
//
// These three were chosen once and then copied into two dozen files by hand, so
// "change the calendar icon" meant finding every `CalendarDays` import and
// hoping none had been missed — and some had: the sidebar, the mobile bar, the
// command palette and the notification list did not always agree. An icon that
// means a feature is a product decision, and a product decision belongs in one
// place, the same way a control height does.
//
// Only the semantic ones live here. A tick that means "this succeeded" and a
// tick that means «Мої завдання» are different decisions that happen to look
// alike, so the first keeps its own icon at its own call site.
import { Calendar, CornerDownRight, Crown, MessageCircle, SquareCheckBig } from 'lucide-react';

/** «Мої завдання», a task, a task list. A tick in a rounded square. */
export const TaskIcon = SquareCheckBig;

/**
 * «Підзавдання для …» — this task hangs under that one. The arrow that turns
 * down and to the right, on every surface that states the relation.
 *
 * It is here for exactly the reason this file exists. The board card drew the
 * arrow and the task page drew `Layers`, so the same fact about the same task
 * had two glyphs depending on which screen you read it on. (The card's arrow
 * was itself once the literal character "↳", which has no consistent metrics —
 * it sits below the baseline in some fonts and above it in others — so this is
 * the second time this one relation has needed pinning down.)
 *
 * Not `TaskIcon`: that means "a task", and this means "under another task".
 * The «Підзавдання» section heading, which labels a list of them, keeps
 * `TaskIcon` — it is naming tasks, not the relation.
 */
export const ParentTaskIcon = CornerDownRight;

/** «Календар», a calendar event, a date range. The grid without its dots. */
export const CalendarIcon = Calendar;

/** «Чат», a message, a comment. The round bubble, not the square one. */
export const ChatIcon = MessageCircle;

/**
 * «Це є на іншому тарифі». Filled, because a crown outlined at fourteen pixels
 * is five hairlines and a gap — it reads as a scribble, not as an object. The
 * fill also lets one glyph carry the plan gold, which is the whole point of it
 * being a crown rather than a lock: a lock says «no», and this says «not yet,
 * and here is what it costs».
 *
 * It replaced a star. A star means «favourite» in every product anybody has
 * ever used, including this one, and pointing it at billing meant the only
 * mark for «you cannot do this» looked exactly like the mark for «I like this».
 */
export const PlanCrownIcon = ({ size = 14, ...props }) => (
  <Crown size={size} strokeWidth={1.75} fill="currentColor" {...props} />
);
