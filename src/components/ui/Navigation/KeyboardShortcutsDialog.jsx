'use client';

import Dialog from '../Dialog';
import { useApplePlatform } from '@/lib/hooks/useApplePlatform';
import { SHORTCUT_GROUPS } from '@/lib/content/shortcuts.mjs';

// ─── UI Kit: KeyboardShortcutsDialog ─────────────────────────────────────────
// The app had shortcuts and no way to find out about them, which makes a
// shortcut a secret rather than a feature. One list, opened from «?» in the
// sidebar, next to the help centre — where somebody looking for help looks.
// QUI-103 took the "?" *key* away, because a printable character cannot be a
// global shortcut without eating the character; the button is not a keystroke.

export { SHORTCUT_GROUPS };

function Key({ children }) {
  return (
    <kbd className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-[6px] border border-line bg-canvas px-[6px] text-[11px] font-semibold text-ink">
      {children}
    </kbd>
  );
}

/**
 * The keyboard cheat sheet.
 *
 * @param {boolean} props.isOpen Whether it is on screen.
 * @param {() => void} props.onClose Closes it.
 */
export default function KeyboardShortcutsDialog({ isOpen, onClose }) {
  // Every item that differs between keyboards has carried an `alt` since this
  // list was written, and the list rendered `keys` regardless — so a Windows
  // machine was told to press a key it does not have.
  const apple = useApplePlatform();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Гарячі клавіші"
      description="Перші дві групи працюють будь-де, решта — там, де написано."
      size="md"
      presentation="dialog"
    >
      <div className="flex flex-col gap-[18px]">
        {SHORTCUT_GROUPS.map(group => (
          <div key={group.label}>
            <p className="ui-type-eyebrow pb-[8px] uppercase tracking-wider text-faint">
              {group.label}
            </p>
            <div className="flex flex-col gap-[8px]">
              {group.items.map(item => (
                <div key={`${item.label}-${item.keys.join('+')}`} className="flex items-center justify-between gap-[16px]">
                  <span className="text-[13px] text-ink">{item.label}</span>
                  <span className="flex shrink-0 items-center gap-[4px]">
                    {(apple ? item.keys : item.alt || item.keys).map(key => <Key key={key}>{key}</Key>)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
