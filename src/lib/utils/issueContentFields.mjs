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
