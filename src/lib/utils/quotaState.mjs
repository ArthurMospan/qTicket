// src/lib/utils/quotaState.mjs
// Whether this browser has just been refused by Firestore's daily free quota,
// and the words to say about it.
//
// The workspace already recognised `resource-exhausted` in three places and did
// nothing visible with it: the organization card called it «QuickTeam
// тимчасово недоступний», the render boundary called it «Дані не вдалося
// відрендерити», and a read that stalled before either of them showed a spinner
// with no end. All three are wrong about the same event, and the last one is
// wrong in the way that matters — a reader watching a spinner has no reason to
// stop watching it.
//
// A quota refusal is not a bug and not a network problem. It is a known
// condition of the plan the product runs on, it lasts until a known time, and
// the data is untouched. That is three facts a person can act on, so the app
// says them.
//
// The flag is remembered rather than passed, because the read that was refused
// is usually not the one whose failure reaches a screen: a listener is denied,
// a hook publishes empty, and something downstream throws about a missing
// field. `reportLoadError` is the one funnel every load failure already goes
// through, so it is where the fact is recorded.

// Deliberately importing nothing from `errors.js`, which imports this: whether
// an error *is* a quota refusal is that module's judgement, and asking it back
// for the answer would make the two files a cycle. The caller decides; this
// file only remembers.

// Long enough to still be true while somebody reloads and tries again, short
// enough that yesterday's exhaustion is not still being announced today.
const QUOTA_MEMORY_MS = 10 * 60 * 1000;

let refusedAt = 0;

export function noteQuotaRefusal() {
  refusedAt = Date.now();
}

export function isQuotaRefused() {
  return refusedAt > 0 && Date.now() - refusedAt < QUOTA_MEMORY_MS;
}

/** Test seam. Production never needs to forget on demand. */
export function clearQuotaRefusal() {
  refusedAt = 0;
}

// Spark resets its daily counters at midnight Pacific, which is 10:00 in Kyiv
// on both sides of daylight saving — Kyiv and Los Angeles shift within days of
// each other, so the ten-hour gap holds all year.
export const QUOTA_RESET_LOCAL_TIME = '10:00';

export const QUOTA_FAILURE_COPY = Object.freeze({
  title: 'Вичерпано денний ліміт бази даних',
  description: 'QuickTeam працює на безкоштовному плані Firebase — 50 000 читань на добу, '
    + `і сьогоднішні вже витрачені. Лічильник обнуляється о ${QUOTA_RESET_LOCAL_TIME} за Києвом. `
    + 'Дані на місці й нічого не втрачено — їх просто зараз не можна прочитати.',
  action: 'Спробувати ще раз',
});
