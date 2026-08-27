'use client';

// ─── UI Kit: Export Menu ─────────────────────────────────────────────────────
// «Винести ці цифри назовні», in one control, on every screen that has figures.
//
// Three formats, because they answer three different questions: a spreadsheet
// goes to whoever will keep working with the numbers, a CSV goes into whatever
// system will read them next, and a printed page goes to whoever needs it on
// paper or as a PDF. They are one menu rather than three buttons because the
// choice is a detail of the same action.
//
// It is not a component with a new look: a Button opens a ContextMenu, both
// straight from the kit. What it adds is that a screen never has to know how a
// file is written, and that a blocked popup or a failed write is reported the
// same way everywhere instead of looking like a button that did nothing.

import { useState } from 'react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import Button from './Button';
import ContextMenu from './ContextMenu';
import { exportDocument } from '@/lib/utils/exportFile';
import useWorkspaceStore from '@/store/useWorkspaceStore';

const FORMATS = [
  { id: 'xlsx', label: 'Excel (.xlsx)', icon: FileSpreadsheet },
  { id: 'csv', label: 'CSV', icon: FileText },
  { id: 'pdf', label: 'PDF (через друк)', icon: Printer },
];

/**
 * @param {() => object} props.build Makes the export document. Called on the
 *   click, never on render: a timesheet of several thousand rows should not be
 *   assembled by a screen nobody is exporting.
 * @param {string} props.label Trigger text.
 * @param {boolean} props.disabled Greys out the trigger and every format in the menu.
 * @param {string} props.disabledReason Why, shown on the disabled trigger.
 * @param {'sm'|'md'|'lg'} props.size Passed straight to the Button.
 * @param {('xlsx'|'csv'|'pdf')[]} props.formats Which of the three to offer. A
 *   screen that already prints a designed page of its own — the invoice — keeps
 *   that button and leaves `pdf` out rather than shipping two paths to a PDF,
 *   one of which is plainer.
 * @param {string} props.className Placement in the parent only.
 */
export default function ExportMenu({
  build,
  label = 'Експорт',
  disabled = false,
  disabledReason = '',
  size = 'lg',
  formats = ['xlsx', 'csv', 'pdf'],
  className = '',
}) {
  const showToast = useWorkspaceStore(state => state.showToast);
  const [busy, setBusy] = useState(false);

  const run = async format => {
    if (busy) return;
    setBusy(true);
    try {
      const document_ = build?.();
      // The screen registers what it is showing; while it is still loading, or
      // while it is showing nothing, there is no document to write.
      if (!document_) {
        showToast('Немає даних для експорту', 'error');
        return;
      }
      const outcome = await exportDocument(document_, format);
      if (outcome === 'blocked') {
        showToast('Дозвольте спливаючі вікна, щоб зберегти PDF', 'error');
      } else {
        showToast('Файл збережено');
      }
    } catch (error) {
      console.error('[ExportMenu]', error);
      showToast('Не вдалося сформувати файл', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ContextMenu
      className={className}
      trigger={(
        <Button
          style="secondary"
          size={size}
          icon={Download}
          loading={busy}
          disabled={disabled}
          title={disabled ? disabledReason : 'Зберегти те, що на екрані, у файл'}
        >
          {label}
        </Button>
      )}
      items={FORMATS.filter(format => formats.includes(format.id)).map(format => ({
        label: format.label,
        icon: format.icon,
        disabled,
        disabledReason,
        onClick: () => run(format.id),
      }))}
    />
  );
}
