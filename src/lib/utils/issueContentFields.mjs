// src/lib/utils/issueContentFields.mjs
// What a звернення says, as opposed to how the desk is handling it.
//
// One list, read by the browser that sends the patch and by the route that
// authorizes it. The route is the enforcement — a browser can send anything —
// but both halves naming the same constant is what keeps a field from being
// offered on screen and refused on arrival.
//
// Everything absent from this list is support's handling of the request and
// stays behind `edit:issue`: status and columnId, `assigneeIds`, the
// resolution date, watchers, hierarchy, the archive and cancel stamps, the
// counters, and every identity field the rules already deny to everybody.
export const ISSUE_CONTENT_FIELDS = Object.freeze([
  'title',
  'description',
  'attachments',
  'type',
  'priority',
  'labelIds',
  // The customer's own routing: which of their people is answering. Support
  // may correct it, which is why it is here rather than in a client-only list.
  'clientAssigneeIds',
]);

/** Whether a patch touches only what both sides of the desk may write. */
export function isIssueContentPatch(patch) {
  const keys = Object.keys(patch || {});
  return keys.length > 0 && keys.every(key => ISSUE_CONTENT_FIELDS.includes(key));
}

/** The content keys of a patch, with everything else dropped. */
export function pickIssueContentFields(patch) {
  const picked = {};
  for (const field of ISSUE_CONTENT_FIELDS) {
    if (patch && patch[field] !== undefined) picked[field] = patch[field];
  }
  return picked;
}

// The desk's own two audited fields.
//
// `AUDITED_ISSUE_FIELDS` is the list of changes worth a line in a request's
// history, and `ISSUE_CONTENT_FIELDS` above covers all but these two. They were
// the gap: a client edits content through the server route, which writes the
// history — but support wrote **straight to Firestore**, so who was put on a
// request and when it was due changed with no line anywhere. Not in the
// customer's feed, which was the complaint, and not in `audit/` either, which
// is support's own record of its own work.
//
// So they go through the same door. Being here does not widen who may set
// them: the route asks for `edit:issue` the moment a patch names one, which no
// client role holds.
export const ISSUE_DESK_FIELDS = Object.freeze([
  'assigneeIds',
  'dueDate',
]);

/** The desk keys of a patch, with everything else dropped. */
export function pickIssueDeskFields(patch) {
  const picked = {};
  for (const field of ISSUE_DESK_FIELDS) {
    if (patch && patch[field] !== undefined) picked[field] = patch[field];
  }
  return picked;
}

/**
 * Whether a value survives being sent as JSON.
 *
 * The browser patches some fields with Firestore sentinels — `arrayUnion` on a
 * new attachment, `arrayRemove` on a watcher — and those are class instances
 * that `JSON.stringify` flattens to `{}`. A patch carrying one has to keep the
 * direct write; routing it would silently erase the field it meant to append
 * to. Everything a person actually edits — a name, a priority, a list of ids, a
 * date — is plain.
 */
function isPlainPatchValue(value) {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') return true;
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every(isPlainPatchValue);
  if (type === 'object') return Object.getPrototypeOf(value) === Object.prototype;
  return false;
}

/**
 * Whether this patch can go through `PATCH /api/issues/[issueId]` — the one
 * door that records what changed. Everything else keeps the browser's write.
 */
export function isRoutableIssuePatch(patch) {
  const keys = Object.keys(patch || {});
  if (keys.length === 0) return false;
  return keys.every(key => (
    (ISSUE_CONTENT_FIELDS.includes(key) || ISSUE_DESK_FIELDS.includes(key))
    && isPlainPatchValue(patch[key])
  ));
}
