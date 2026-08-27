'use client';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button';
import { useModalFocus } from '@/lib/hooks/useModalFocus';
import { useOverlayHistory } from '@/lib/hooks/useOverlayHistory';

// ─── UI Kit: Dialog — the one shared modal shell ─────────────────────────────
// Every modal in the app should render through this component so header
// (title + close button) and footer (action bar) always look the same.
// `size`/`className` are the only things meant to vary per-modal — see
// CLAUDE.md UI Kit policy: content differs, chrome doesn't.
//
// const [open, setOpen] = useState(false);
// <Dialog isOpen={open} onClose={() => setOpen(false)} title="Новий спринт"
//   footer={<>
//     <Button style="secondary" size="md" onClick={() => setOpen(false)}>Скасувати</Button>
//     <Button style="primary" size="md" onClick={handleSave}>Зберегти</Button>
//   </>}>
//   ...form fields...
// </Dialog>

/**
 * The kit's modal. Every dialog in the product is this component — the shell,
 * the overlay, the focus trap and the escape key all live here, so no screen
 * builds its own.
 *
 * @param {boolean} props.isOpen Whether it is on screen. The dialog renders nothing when false.
 * @param {() => void} props.onClose Closes it: the ×, the overlay and Escape all call this.
 * @param {string} props.title Headline.
 * @param {string} props.ariaLabel Name for a dialog that deliberately has no headline — the palette is one, its own search field says what it is.
 * @param {string} props.description Sentence under the headline.
 * @param {React.ReactNode} props.children Body.
 * @param {React.ReactNode} props.footer Actions along the bottom.
 * @param {React.ReactNode} props.headerAction A control in the top-right, beside the close button.
 * @param {string} props.size Width token.
 * @param {'default'|'spacious'|'responsive'|'invite'|'horizontal'|'sticky-head'|'flush'} props.bodyPadding Inner spacing of the body.
 * @param {'dialog'|'eyebrow'} props.titleContext Type scale of the headline.
 * @param {'dialog'|'sheet'} props.presentation Centred dialog, or a sheet from the edge.
 * @param {boolean} props.showCloseButton Whether the × is drawn.
 * @param {string} props.bodyClassName Placement of the body only.
 * @param {string} props.className Placement of the shell only.
 * @param {boolean} props.isDirty Whether closing should confirm unsaved changes.
 * @param {string} props.closeConfirmation Confirmation shown for an unsaved draft.
 */
export default function Dialog({
  isOpen,
  onClose,
  title,
  ariaLabel,
  description,
  headerAction,
  children,
  footer,
  className = '',
  bodyClassName = '',
  size = 'md', // sm, md, lg, xl
  showCloseButton = true,
  presentation = 'sheet', // sheet | dialog
  titleContext = 'section', // section | dialog
  bodyPadding = 'default', // default | spacious | responsive | invite | horizontal | flush
  isDirty = false,
  closeConfirmation,
}) {
  const titleId = useId();
  const requestClose = useOverlayHistory({ isOpen, onClose, isDirty, closeConfirmation });
  const dialogRef = useModalFocus({ isOpen, onClose: requestClose });
  // A click is only a click-away when the press *started* on the backdrop.
  // Without this, selecting text inside the dialog and releasing the mouse
  // outside it fires `click` on the nearest common ancestor — the backdrop —
  // and the dialog closed mid-edit. That is what discarded a set of AI drafts
  // in the audio tab: the panel is nothing but long text fields, so dragging a
  // selection past the edge of the sheet is the normal way to use it.
  const pressStartedOnBackdrop = useRef(false);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'sm:w-[440px]',
    status: 'sm:w-[340px]',
    md: 'sm:w-[560px]',
    lg: 'sm:w-[min(760px,92vw)]',
  };
  const isSheet = presentation === 'sheet';
  const titleClass = titleContext === 'dialog'
    ? 'ui-type-dialog-title'
    : titleContext === 'eyebrow'
      ? 'ui-type-eyebrow'
      : 'ui-type-section-title';
  const bodyPaddingClass = {
    default: 'px-5 py-5 sm:px-6',
    spacious: 'p-5 sm:p-6',
    responsive: 'p-5 sm:p-6',
    invite: 'px-5 py-5 sm:px-7',
    horizontal: 'px-6 py-0',
    // For a body whose first child is `sticky top-0`. A scroll container's own
    // top padding is inside the scrollport, so scrolled content passes through
    // it and shows above anything pinned there; a sticky field that tried to
    // cover it with a negative margin instead sat 20px over the first row and
    // clipped it permanently. The body gives the padding up and the pinned
    // child owns it — the only arrangement where nothing is cut at rest and
    // nothing shows above the field while the list moves.
    'sticky-head': 'px-5 pb-5 pt-0 sm:px-6',
    flush: 'p-0',
  }[bodyPadding] || 'px-6 py-5';

  if (typeof document === 'undefined') return null;

  // Rendered into the body, like every other overlay in the kit — the menu, the
  // select, the popover, the date picker, the toast. Dialog was the one that
  // stayed where it was written, and `z-50` only ever means "above" inside the
  // stacking context it is written in. The workspace header lives in a `z-30`
  // layer, so every dialog opened from it — notifications, the status sheet,
  // the profile — was pinned below the `z-40` mobile tab bar and had its last
  // rows covered by it. PageHeader had already worked around this by portalling
  // its own filters dialog by hand; now it does not have to.
  return createPortal(
    <div
      // The click-away. It is the same element that centres the dialog, so it
      // cannot be hidden from the accessibility tree — that would hide the
      // dialog with it. It stays a plain container with a shortcut on it:
      // everything it does is also done by the close button and by Escape, and
      // making it focusable would put a nameless stop in front of every dialog
      // in the product.
      className={`fixed inset-0 z-50 flex bg-black/40 backdrop-blur-sm ${
        isSheet
          ? 'items-end justify-end sm:items-stretch'
          : 'items-end justify-center p-0 sm:items-center sm:p-4'
      }`}
      onPointerDown={event => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={event => {
        const startedOutside = pressStartedOnBackdrop.current;
        pressStartedOnBackdrop.current = false;
        if (startedOutside && event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        className={`
          bg-white shadow-[0_25px_70px_rgba(0,0,0,0.18)]
          w-full flex flex-col overflow-hidden
          pb-[env(safe-area-inset-bottom)] sm:pb-0
          ${isSheet
            ? 'max-h-[94dvh] rounded-t-[24px] sm:h-full sm:max-h-none sm:rounded-none'
            // dvh, not vh. A phone anchors this variant to the bottom edge, and
            // `vh` is measured against the *large* viewport — the one with the
            // browser's toolbars hidden. So 92vh was routinely taller than the
            // screen actually showing, and the overflow went off the top: the
            // Довідковий центр opened with no header and no × to close it, and
            // «Ваш статус» lost the row you type a status into. On a desktop
            // the two units are the same number, so nothing there moves.
            : 'max-h-[92dvh] rounded-t-[24px] sm:max-h-[90dvh] sm:rounded-[24px]'}
          ${sizeClasses[size]}
          ${className}
        `}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        {title && (
          <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-line shrink-0 sm:px-6">
            <div className="min-w-0">
              <h2 id={titleId} className={`${titleClass} text-ink`}>{title}</h2>
              {description ? (
                <p className="mt-0.5 text-[11px] font-medium text-muted">{description}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAction}
              {showCloseButton && (
                <Button style="secondary" size="icon-sm" icon={X} onClick={requestClose} aria-label="Закрити" />
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className={`${bodyPaddingClass} overflow-y-auto flex-1 ${bodyClassName}`}>
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="ui-dialog-footer flex shrink-0 flex-wrap justify-end gap-3 border-t border-line bg-canvas px-5 py-4 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
