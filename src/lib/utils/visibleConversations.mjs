// src/lib/utils/visibleConversations.mjs
// Which conversations are open in front of the reader, as a stack.
//
// One slot was enough while one pane at a time could show a conversation. It
// is not: an incident opens as a window over another screen, and closing that
// window used to leave the slot empty — whatever conversation was underneath
// was still on screen, the system no longer knew it, and the next message in it
// rang and drew a card over the very conversation it described. The topmost
// entry is what the reader is looking at; closing it reveals the one below.
//
// Pure: the store applies these, and the tests exercise them without React.

const same = (a, b) => Boolean(a && b) && a.kind === b.kind && a.id === b.id;

/**
 * @param {unknown} value
 * @returns {boolean} Whether this names a conversation at all.
 */
export function isVisibleConversation(value) {
  return Boolean(value && typeof value === 'object' && value.kind && value.id);
}

/**
 * A pane started showing a conversation. It goes on top; if it was already
 * somewhere in the stack it moves to the top once, and if it is already the top
 * nothing changes — the same array comes back, so nothing downstream re-runs.
 *
 * @param {{kind: string, id: string}[]} stack
 * @param {{kind: string, id: string}} conversation
 * @returns {{kind: string, id: string}[]}
 */
export function pushVisibleConversation(stack, conversation) {
  if (!isVisibleConversation(conversation)) return stack;
  if (stack.length && same(stack[stack.length - 1], conversation)) return stack;
  const rest = stack.filter(entry => !same(entry, conversation));
  return [...rest, { kind: conversation.kind, id: conversation.id }];
}

/**
 * A pane stopped showing a conversation. Only that entry leaves; whatever it
 * was covering is on screen again. Removing what was never there is a no-op
 * that returns the same array.
 *
 * @param {{kind: string, id: string}[]} stack
 * @param {{kind: string, id: string}} conversation
 * @returns {{kind: string, id: string}[]}
 */
export function removeVisibleConversation(stack, conversation) {
  if (!isVisibleConversation(conversation)) return stack;
  const next = stack.filter(entry => !same(entry, conversation));
  return next.length === stack.length ? stack : next;
}

/**
 * @param {{kind: string, id: string}[]} stack
 * @returns {{kind: string, id: string}|null} What the reader is looking at.
 */
export function topVisibleConversation(stack) {
  return stack.length ? stack[stack.length - 1] : null;
}
