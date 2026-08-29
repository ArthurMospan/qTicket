'use client';

import { useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { ArrowUp } from 'lucide-react';

// One composer, because the product has one conversation.
//
// There were three shells here — the workspace messenger's, the incident
// timeline's, and a bare fallback — and the first and third had already
// outlived their callers. A border *and* a focus shadow used to draw two
// concentric outlines around the same box; what survived that repair, and what
// the incident conversation wears, is a single ring that thickens.
const COMPOSER = {
  shell: 'overflow-hidden rounded-[24px] bg-white ring-1 ring-black/[0.04] transition-all hover:ring-black/10 focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)]',
  textarea: 'custom-scrollbar min-h-[36px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-[14px] leading-5 text-ink outline-none placeholder:text-muted',
};

const ROUND_SEND_CLASS = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-transform hover:scale-105 disabled:bg-faint disabled:hover:scale-100';

// How tall the field may grow before it starts scrolling instead. It used to be
// a table here, one number per shell; it is read off the field's own
// `max-height` now — the same number, written where the rest of the field's
// geometry already is, and in the only form that can differ between a phone and
// a desk, because a media query cannot reach a constant in a module.
const FALLBACK_MAX_HEIGHT = 120;

// What the field tells the platform about itself, so the on-screen keyboard
// arrives as a keyboard rather than as a filling assistant.
//
// iOS draws an AutoFill row above the keys — «Паролі», «Карти», sometimes an
// address — whenever it believes the focused field is one it could fill, and it
// decides that from the field's own attributes plus whatever password managers
// claim about it. A message composer can be filled from nothing, so it says so:
// `autocomplete="off"`, a name that reads as prose rather than as a credential,
// and the four opt-out attributes 1Password, LastPass, Dashlane and Bitwarden
// each look for. What stays is ordinary typing help — capitalisation,
// correction, spelling — because this is a field for sentences.
//
// The predictive-text strip itself (three suggested words) belongs to the
// system keyboard, not to the page; no web attribute removes it.
const COMPOSER_INPUT_ATTRS = {
  name: 'message',
  autoComplete: 'off',
  autoCorrect: 'on',
  autoCapitalize: 'sentences',
  spellCheck: true,
  enterKeyHint: 'send',
  'data-1p-ignore': '',
  'data-lpignore': 'true',
  'data-form-type': 'other',
  'data-bwignore': '',
};

const Spinner = ({ className = '' }) => (
  <span className={`h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white ${className}`} />
);

/**
 * The message input itself: the field, its growth behaviour and its send
 * button. Three chats each kept a copy of all three and the copies had drifted,
 * which is why the geometry moved here; two of those chats are now deleted and
 * the geometry stayed.
 *
 * @param {string} props.value Draft text.
 * @param {(value: string) => void} props.onChange Fires with the new draft.
 * @param {() => void} props.onSubmit Sends it.
 * @param {string} props.placeholder Text shown while empty.
 * @param {number} props.rows Initial visible rows before it grows.
 * @param {boolean} props.disabled Unavailable: the field and the send button are both blocked.
 * @param {boolean} props.sending In flight: the send button shows the wait.
 * @param {boolean} props.canSubmit Whether sending is currently allowed at all.
 * @param {React.ReactNode} props.leading Controls before the field — the attach button.
 * @param {React.ReactNode} props.attachments Pending attachments, drawn above the field.
 * @param {string} props.sendAriaLabel Accessible name for the icon-only send button.
 * @param {React.Ref} props.textareaRef Ref to the textarea, for mention menus and focus handling.
 * @param {React.CSSProperties} props.textareaStyle Inline style for the textarea, for measured heights.
 * @param {(event) => void} props.onKeyDown Key handler; this is where mention navigation hooks in.
 * @param {(event) => void} props.onBlur Blur handler.
 * @param {(event) => void} props.onClick Click handler on the field.
 * @param {string} props.textareaClassName Placement of the textarea only.
 */
export default function ChatComposerCore({
  textareaRef,
  value,
  onChange,
  onKeyDown,
  onClick,
  onBlur,
  placeholder,
  disabled = false,
  rows = 1,
  textareaStyle,
  textareaClassName = '',
  attachments,
  leading,
  onSubmit,
  canSubmit = Boolean(value?.trim()),
  sending = false,
  sendAriaLabel = 'Надіслати',
}) {
  const sendDisabled = !canSubmit || sending || disabled;

  // The field grows with what is in it — measured here, from `value`, rather
  // than in each caller's `onChange`. Doing it on the event meant it only ever
  // grew for text somebody typed: opening a long message for editing put a
  // whole paragraph into a two-line box that had to be scrolled, because
  // nothing about that assignment was an input event. Same for a draft
  // restored, a mention inserted by the picker, or text pasted by script.
  const innerRef = useRef(null);
  const setTextareaRef = useCallback(node => { innerRef.current = node; }, []);
  useImperativeHandle(textareaRef, () => innerRef.current, []);
  useLayoutEffect(() => {
    const field = innerRef.current;
    if (!field) return;
    const declared = Number.parseFloat(window.getComputedStyle(field).maxHeight);
    const max = Number.isFinite(declared) ? declared : FALLBACK_MAX_HEIGHT;
    field.style.height = 'auto';
    field.style.overflowY = 'hidden';
    // An empty field is one row, and it is the browser that knows how tall one
    // row is. Chrome counts the wrapped placeholder in `scrollHeight`, so an
    // empty composer measured itself against its own placeholder — on a desk
    // that line fits and nothing showed, on a phone it wraps and the composer
    // opened two rows tall around no text at all.
    if (!field.value) return;
    field.style.height = `${Math.min(field.scrollHeight, max)}px`;
    field.style.overflowY = field.scrollHeight > max ? 'auto' : 'hidden';
  }, [value]);

  const textarea = (
    <textarea
      {...COMPOSER_INPUT_ATTRS}
      ref={setTextareaRef}
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onClick={onClick}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      style={textareaStyle}
      className={`${COMPOSER.textarea} ${textareaClassName}`.trim()}
    />
  );

  return (
    <div className={COMPOSER.shell}>
      {attachments}
      <div className="flex min-h-[44px] items-end gap-0 p-1">
        {leading}
        {textarea}
        <button
          type="button"
          onClick={onSubmit}
          disabled={sendDisabled}
          aria-label={sendAriaLabel}
          className={ROUND_SEND_CLASS}
        >
          {sending ? <Spinner /> : <ArrowUp size={16} />}
        </button>
      </div>
    </div>
  );
}
