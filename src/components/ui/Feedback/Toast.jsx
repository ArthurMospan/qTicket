'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, X, AlertCircle, AlertTriangle, Info, Loader2 } from 'lucide-react';
import { GLOBAL_NOTIFICATION_Z_INDEX } from '@/lib/utils/overlayLayers.mjs';

/**
 * Transient feedback that something happened, floating above the page and
 * closing itself. Anything the reader has to act on is an `Alert`, which stays.
 *
 * @param {'info'|'success'|'error'|'warning'|'loading'} props.variant Colour, icon and meaning.
 * @param {string} props.message What happened.
 * @param {string} props.action Label of the single inline action (usually "Скасувати").
 * @param {() => void} props.onAction Handler for that action.
 * @param {number} props.autoClose Milliseconds before it closes itself; 0 keeps it until dismissed.
 * @param {() => void} props.onClose Fires when it closes, by timer or by the ×.
 * @param {() => void} props.onReport Offers to send this failure to the people who
 *   can fix it. Only a failure has one, and it is deliberately the quietest
 *   thing in the toast: an offer, not an instruction.
 */
export function Toast({
  variant = 'info', // success, error, warning, info, loading
  message,
  action,
  onAction,
  autoClose = 3000,
  onClose,
  onReport,
}) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (autoClose && variant !== 'loading') {
      const timer = setTimeout(() => {
        setIsVisible(false);
        onClose?.();
      }, autoClose);
      return () => clearTimeout(timer);
    }
  }, [autoClose, variant, onClose]);

  if (!isVisible) return null;

  const isError = variant === 'error' || variant === 'danger';
  const isWarning = variant === 'warning';
  const isLoading = variant === 'loading';
  const isSuccess = variant === 'success';

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-qt-global-notification-layer
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      // Full width, centred by the flex box — not `left-1/2` with a transform.
      // A shrink-to-fit fixed box anchored at the halfway mark can only be as
      // wide as the half of the screen it starts on, so on a phone «1 хв
      // зафіксовано» plus its × was over budget at 195px and the × wrapped onto
      // a line of its own. The layer now spans the viewport and the toast sizes
      // to its own content up to the ceiling below.
      className="ui-toast-layer pointer-events-none fixed bottom-6 left-0 right-0 flex flex-col items-center"
      style={{ zIndex: GLOBAL_NOTIFICATION_Z_INDEX }}
    >
      <div
        // Wrapping, and a ceiling. A failure toast carries a message, an undo
        // and an offer to report it — on a 360px screen that is wider than the
        // screen, and a single non-wrapping row simply hung off the edge.
        className="ui-toast flex max-w-[calc(100vw-24px)] flex-wrap items-center gap-x-3 gap-y-2 bg-ink text-white px-5 py-3 rounded-[12px] shadow-xl text-[13px] font-medium pointer-events-auto transition-all"
      >
        {isSuccess && <CheckCircle size={15} className="text-green-400 shrink-0" />}
        {isError && <AlertCircle size={15} className="text-red-400 shrink-0" />}
        {isWarning && <AlertTriangle size={15} className="text-yellow-400 shrink-0" />}
        {!isSuccess && !isError && !isWarning && !isLoading && <Info size={15} className="text-blue-400 shrink-0" />}
        {isLoading && <Loader2 size={15} className="text-blue-400 shrink-0 animate-spin" />}

        <span>{message}</span>

        {action && onAction && (
          <button
            onClick={() => {
              onAction();
              setIsVisible(false);
              onClose?.();
            }}
            className="text-blue-400 hover:text-blue-300 font-bold ml-2 text-[11px] transition-colors"
          >
            {action}
          </button>
        )}

        {isError && onReport && (
          <button
            type="button"
            onClick={() => {
              onReport();
              setIsVisible(false);
              onClose?.();
            }}
            className="ml-2 shrink-0 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            Повідомити про помилку
          </button>
        )}

        <button
          onClick={() => {
            setIsVisible(false);
            onClose?.();
          }}
          aria-label="Закрити сповіщення"
          className="text-white/40 hover:text-white/80 ml-1 transition-colors"
        >
          <X size={13} />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default Toast;
