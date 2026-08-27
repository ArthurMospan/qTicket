'use client';

import { useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { ArrowUp, Send } from 'lucide-react';

const VARIANTS = {
  workspace: {
    // A border *and* a focus shadow drew two concentric outlines around the
    // same box. The task-page composer below already solved this with one ring
    // that thickens; the workspace chat now wears exactly that, keeping only
    // its own corner radius and textarea geometry.
    // The mobile variants are appended, never woven in: `kit-usage.test.mjs`
    // holds the desktop geometry of all three shells as a literal substring, so
    // the phone's corner radius has to sit after it rather than inside it.
    shell: 'overflow-hidden rounded-2xl bg-white ring-1 ring-black/[0.04] transition-all hover:ring-black/10 focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)] max-md:rounded-[22px]',
    // Below md the field shares its line with the controls, so it stops being a
    // full-width block and becomes the part of the row that stretches. It also
    // stops growing at 120px rather than 200: a composer half the height of the
    // screen is not a composer, it is a page with a conversation behind it.
    textarea: 'w-full px-4 py-3.5 text-[14px] text-ink placeholder-placeholder bg-transparent outline-none resize-none max-h-[200px] leading-relaxed max-md:w-auto max-md:min-w-0 max-md:flex-1 max-md:max-h-[120px] max-md:px-2 max-md:py-[7px] max-md:text-[15px]',
  },
  timeline: {
    shell: 'overflow-hidden rounded-[24px] bg-white ring-1 ring-black/[0.04] transition-all hover:ring-black/10 focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)]',
    textarea: 'custom-scrollbar min-h-[36px] max-h-[120px] flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-[14px] leading-5 text-ink outline-none placeholder:text-muted',
  },
  qtplus: {
    shell: 'flex min-h-[44px] items-end gap-1 rounded-[24px] bg-white p-1 ring-1 ring-black/[0.04] transition-all focus-within:ring-4 focus-within:ring-black/10 focus-within:shadow-[0_12px_40px_rgb(0,0,0,0.08)]',
    textarea: 'max-h-[120px] min-h-[36px] flex-1 resize-none bg-transparent px-3 py-2 text-[14px] leading-5 text-ink outline-none placeholder:text-muted disabled:opacity-50',
  },
};

const ROUND_SEND_CLASS = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-white transition-transform hover:scale-105 disabled:bg-faint disabled:hover:scale-100';

// How tall the field may grow before it starts scrolling instead. It used to be
// a table here, one number per variant; it is read off the field's own
// `max-height` now — the same number, written where the rest of the field's
// geometry already is, and in the only form that can differ between a phone and
// a desk, because a media query cannot reach a constant in a module.
const FALLBACK_MAX_HEIGHT = 200;

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
 * The message input itself, shared by all three chats — workspace, timeline and
 * QuickTeam+. Each of them had its own copy of the ring, the growth behaviour
 * and the send button; the three had already drifted, so the geometry lives
 * here and the caller picks a `variant` rather than restating it.
 *
 * @param {string} props.value Draft text.
 * @param {(value: string) => void} props.onChange Fires with the new draft.
 * @param {() => void} props.onSubmit Sends it.
 * @param {'workspace'|'timeline'|'qtplus'} props.variant Which chat this is; changes the frame, not the behaviour.
 * @param {string} props.placeholder Text shown while empty.
 * @param {number} props.rows Initial visible rows before it grows.
 * @param {boolean} props.disabled Unavailable: the field and the send button are both blocked.
 * @param {boolean} props.sending In flight: the send button shows the wait.
 * @param {boolean} props.canSubmit Whether sending is currently allowed at all.
 * @param {React.ReactNode} props.leading Controls before the field — the attach button.
 * @param {React.ReactNode} props.toolbar Controls under the field.
 * @param {React.ReactNode} props.attachments Pending attachments, drawn above the field.
 * @param {string} props.sendLabel Visible label on the send button, where it has one.
 * @param {string} props.sendAriaLabel Accessible name for the icon-only send button.
 * @param {React.Ref} props.textareaRef Ref to the textarea, for mention menus and focus handling.
 * @param {React.CSSProperties} props.textareaStyle Inline style for the textarea, for measured heights.
 * @param {(event) => void} props.onKeyDown Key handler; this is where mention navigation hooks in.
 * @param {(event) => void} props.onBlur Blur handler.
 * @param {(event) => void} props.onClick Click handler on the field.
 * @param {string} props.textareaClassName Placement of the textarea only.
 */
export default function ChatComposerCore({
  variant = 'workspace',
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
  toolbar,
  onSubmit,
  canSubmit = Boolean(value?.trim()),
  sending = false,
  sendLabel = 'Надіслати',
  sendAriaLabel = sendLabel,
}) {
  const composer = VARIANTS[variant] || VARIANTS.workspace;
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
    // empty composer measured itself against «Написати в #general...» — on a
    // desk that line fits and nothing showed, on a phone it wraps and the
    // composer opened two rows tall around no text at all.
    if (!field.value) return;
    field.style.height = `${Math.min(field.scrollHeight, max)}px`;
    field.style.overflowY = field.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, variant]);

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
      className={`${composer.textarea} ${textareaClassName}`.trim()}
    />
  );

  if (variant === 'workspace') {
    return (
      <div className={composer.shell}>
        {attachments}
        {/* Two shapes, one field.
            At md and up the composer is a block: a full-width field with a
            toolbar strip beneath it, ending in a labelled «Надіслати». On a
            phone that strip is a second row of chrome stacked above the
            keyboard, and the label is a word nobody reads — between the two, the
            field itself was left with about forty pixels of the screen. Below md
            the same three parts sit on one line: attach and emoji, the field,
            and a round send.
            `contents` is what lets that happen without a second copy of the
            textarea — the strip stops being a box and its children become items
            of the row. Duplicating the field the way a list row duplicates its
            layout is not open here: two DOM nodes would be fighting over one
            ref, one caret and one selection. */}
        <div className="max-md:flex max-md:items-end max-md:gap-1 max-md:p-1">
          {textarea}
          <div className="flex items-center justify-between border-t border-line px-3 pb-3 pt-2 max-md:contents">
            {/* One line of the field tall, on a phone: 15px text at
                `leading-relaxed` plus the field's 7px above and below — 38px.
                The row is bottom-aligned so that a field grown to several lines
                keeps its controls on the last one, and a 32px glyph hung from
                that bottom edge sits three pixels below the centre of a
                single-line field, which is the resting state and the one
                anybody looks at. Matching the line height makes «bottom» and
                «centre» the same place while the field is one line, and still
                hugs the bottom once it is not. */}
            <div className="flex items-center gap-1 max-md:order-first max-md:h-[38px]">{toolbar}</div>
            <button
              type="button"
              onClick={onSubmit}
              disabled={sendDisabled}
              aria-label={sendAriaLabel}
              className={`flex items-center gap-2 rounded-xl px-4 py-1.5 text-[13px] font-semibold transition-all max-md:h-[38px] max-md:w-[38px] max-md:shrink-0 max-md:justify-center max-md:gap-0 max-md:rounded-full max-md:px-0 max-md:py-0 ${
                sendDisabled
                  ? 'cursor-not-allowed bg-canvas text-placeholder'
                  : 'bg-ink text-white shadow-sm hover:bg-ink-hover active:scale-95'
              }`}
            >
              {sending ? <Spinner /> : <Send size={14} />}
              <span className="max-md:hidden">{sending ? 'Надсилання…' : sendLabel}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'timeline') {
    return (
      <div className={composer.shell}>
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

  return (
    <div className={composer.shell}>
      {textarea}
      <button
        type="button"
        onClick={onSubmit}
        disabled={sendDisabled}
        aria-label={sendAriaLabel}
        className={ROUND_SEND_CLASS}
      >
        <ArrowUp size={16} />
      </button>
    </div>
  );
}
