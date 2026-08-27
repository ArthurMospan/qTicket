'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Dialog from './Dialog';
import Button from './Button';
import { Input } from './Input';

// ─── UI Kit: Confirm Dialog ──────────────────────────────────────────────────
// Промісна заміна нативних confirm()/prompt().
//
// const confirm = useConfirm();
//
// if (!(await confirm({ title: 'Видалити спринт?', danger: true }))) return;
//
// const typed = await confirm({
//   title: 'Видалення організації',
//   message: 'Введіть DELETE для повного видалення',
//   input: { placeholder: 'DELETE' },
// });                      // → рядок або null (скасовано)

const ConfirmContext = createContext(null);

/**
 * Hosts the one confirm dialog the app uses, and hands `useConfirm()` to
 * everything under it — a promise-returning replacement for native
 * `confirm()`/`prompt()`. Mounted once, near the root.
 *
 * @param {React.ReactNode} props.children The tree that may call `useConfirm()`.
 */
export function ConfirmProvider({ children }) {
  const [request, setRequest] = useState(null);
  const [inputValue, setInputValue] = useState('');
  const resolverRef = useRef(null);

  const confirm = useCallback(opts => {
    return new Promise(resolve => {
      resolverRef.current = resolve;
      const nextRequest = typeof opts === 'string' ? { title: opts } : opts;
      setInputValue(nextRequest?.input?.defaultValue ?? '');
      setRequest(nextRequest);
    });
  }, []);

  const settle = result => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(result);
  };

  const {
    title = 'Підтвердіть дію',
    message,
    confirmText = 'Підтвердити',
    cancelText = 'Скасувати',
    danger = false,
    input = null,
  } = request || {};

  const handleCancel = () => settle(input ? null : false);
  const handleConfirm = () => settle(input ? inputValue : true);

  // A confirm with neither a message nor an input still needs its form in the
  // DOM for the footer's submit button, but the form is empty — and the dialog
  // pads its body regardless, which rendered as a blank white strip between the
  // title and the buttons. Collapse the padding instead of shipping that gap.
  const hasBody = Boolean(message) || Boolean(input);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        isOpen={!!request}
        onClose={handleCancel}
        title={title}
        size="sm"
        presentation="dialog"
        bodyPadding={hasBody ? 'default' : 'horizontal'}
        footer={
          <>
            <Button style="secondary" size="md" onClick={handleCancel}>{cancelText}</Button>
            <Button
              type="submit"
              form="confirm-dialog-form"
              style="primary"
              color={danger ? 'red' : 'dark'}
              size="md"
              autoFocus={!input}
            >
              {confirmText}
            </Button>
          </>
        }
      >
        <form
          id="confirm-dialog-form"
          onSubmit={e => { e.preventDefault(); handleConfirm(); }}
          className="flex flex-col gap-[16px]"
        >
          {message && (
            <p className="text-[13px] text-ink-soft leading-relaxed whitespace-pre-line">{message}</p>
          )}
          {input && (
            <Input
              autoFocus
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              placeholder={input.placeholder || ''}
              type={input.type || 'text'}
              min={input.min}
              max={input.max}
              step={input.step}
              suffix={input.suffix}
            />
          )}
        </form>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used within <ConfirmProvider>');
  return confirm;
}

export default ConfirmProvider;
