// «Коли це сталося», in the form a feed reads best.
//
// A list of events is scanned, not studied: the useful answer at the top of it
// is «щойно» and «2 год тому», and only once something is old enough to stop
// being relative does a date beat a duration. «Огляд» printed an absolute
// «02 вер, 14:30» on every row instead — a stamp you have to subtract today's
// date from to learn the one thing you wanted — while the project card two
// screens away printed the duration. One question, two answers.
//
// Deliberately not `Intl.RelativeTimeFormat`: it produces «2 години тому» with
// the noun spelled out, and these chips are 10–11px at the end of a row that
// has already truncated its sentence.

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * How long ago, in the words a feed row uses.
 *
 * @param {*} value A Firestore Timestamp, a Date, or anything `new Date()` reads.
 * @param {number} options.now The instant to measure from — passed in so a
 *   render is a pure function of its props and a test does not have to wait.
 * @returns {string} «щойно», «12 хв тому», «5 год тому», or a short date.
 */
export function relativeTimeLabel(value, { now = Date.now() } = {}) {
  const date = toDate(value);
  if (!date) return '';
  const elapsed = now - date.getTime();
  // A clock a few seconds ahead of the server is not the future.
  if (elapsed < MINUTE) return 'щойно';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} хв тому`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} год тому`;
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}
