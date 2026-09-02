// src/lib/utils/emergencyAlarm.mjs
// When the emergency siren sounds, and when it does not.
//
// An emergency call is the one notification that must interrupt: it sounds
// three times over six seconds, whatever is on screen. The siren says «right
// now» — and it kept saying it: for an unread record it played again on every
// page load, so a call from three days ago met every reload with a siren. Two
// rules bring it back to what it means.
//
//   1. Only a record younger than EMERGENCY_ALARM_WINDOW_MS sounds. An hour
//      later the call is history — the red record in the bell says so — and
//      history does not interrupt.
//   2. A record sounds once per browser. Which records have sounded is kept in
//      localStorage, so a reload does not repeat it. Another device may sound
//      on its own — the reader may not have heard the first one — which is why
//      this is a browser's memory and not the record's. The record could not
//      carry it anyway: a client may change nothing on it but `read`.
//
// Reading the record still stops the repeats; that is unchanged.
//
// Pure: the bridge decides with it, and the tests exercise it without a
// browser.

export const EMERGENCY_ALARM_WINDOW_MS = 10 * 60 * 1000;
export const EMERGENCY_ALARM_STORAGE_KEY = 'qt_emergency_alarmed';
// How many sounded ids a browser remembers. Emergencies are rare; fifty is
// months of them, and the list must not grow without bound.
export const EMERGENCY_ALARM_MEMORY = 50;

// A record without a time is not assumed old: swallowing a real emergency is
// the one mistake this module must not make.
function recordMillis(record, nowMs) {
  const at = record?.createdAt;
  if (typeof at?.toMillis === 'function') return at.toMillis();
  if (at instanceof Date) return at.getTime();
  if (typeof at === 'number') return at;
  return nowMs;
}

/**
 * @param {object[]} records The bell's records.
 * @param {{organizationId: string, alarmedIds?: Iterable<string>, nowMs?: number}} options
 * @returns {object[]} The unread emergency records of this organization that should sound now.
 */
export function emergencyRecordsToAlarm(records, { organizationId, alarmedIds, nowMs = Date.now() }) {
  const alarmed = new Set(alarmedIds || []);
  return (Array.isArray(records) ? records : []).filter(record => (
    Boolean(record && record.id)
    && record.type === 'emergency'
    && !record.read
    && record.organizationId === organizationId
    && !alarmed.has(record.id)
    && nowMs - recordMillis(record, nowMs) <= EMERGENCY_ALARM_WINDOW_MS
  ));
}

/**
 * The browser's memory of what has sounded: newest last, capped, no repeats.
 *
 * @param {Iterable<string>} alarmedIds What had sounded before.
 * @param {string[]} ids What sounded just now.
 * @returns {string[]}
 */
export function rememberAlarmed(alarmedIds, ids) {
  const sounded = Array.isArray(ids) ? ids : [];
  const kept = [...(alarmedIds || [])].filter(id => !sounded.includes(id));
  return kept.concat(sounded).slice(-EMERGENCY_ALARM_MEMORY);
}

/**
 * Read the memory back. Storage can be absent, blocked or hold garbage; each
 * of those is an empty memory, not an error.
 *
 * @param {{getItem?: Function}|null|undefined} storage `window.localStorage`, or nothing.
 * @returns {string[]}
 */
export function readAlarmedIds(storage) {
  try {
    const raw = storage?.getItem?.(EMERGENCY_ALARM_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * @param {{setItem?: Function}|null|undefined} storage `window.localStorage`, or nothing.
 * @param {string[]} ids
 */
export function writeAlarmedIds(storage, ids) {
  try {
    storage?.setItem?.(EMERGENCY_ALARM_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // A full or blocked storage forgets; the worst case is a repeated siren.
  }
}
