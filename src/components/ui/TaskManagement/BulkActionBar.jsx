'use client';

import { useState } from 'react';
import {
  Ban,
  CalendarDays,
  CircleDot,
  Flag,
  Archive,
  MoreHorizontal,
  Shapes,
  Tags,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import Button from '@/components/ui/Button';
import ContextMenu from '@/components/ui/ContextMenu';
import { Select } from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/ConfirmProvider';

function encodedOptions(options, operations) {
  return operations.flatMap(operation => options.map(option => ({
    ...option,
    value: `${operation.id}:${option.value}`,
    label: `${operation.label}: ${option.label}`,
  })));
}

/**
 * Fixed toolbar for an active task selection. Common attributes stay visible;
 * less frequent and destructive operations live in its overflow menu.
 *
 * @param {object} props
 * @param {number} props.count Number of currently selected visible tasks.
 * @param {object[]} props.statusOptions Status or category destinations.
 * @param {object[]} props.memberOptions Organization members available for assignment.
 * @param {object[]} props.priorityOptions Configured priorities, including the explicit none option.
 * @param {object[]} props.labelOptions Configured task labels.
 * @param {object[]} props.typeOptions Creatable task types.
 * @param {boolean} props.canArchive Whether the current role may delete tasks. Archiving needs no permission beyond editing.
 * @param {string} props.archiveDisabledReason Explanation shown when deletion is unavailable.
 * @param {(action: string, value?: unknown) => Promise<unknown>} props.onApply Runs one registry action for the selection.
 * @param {{done: number, total: number}} props.progress How far the running operation has got, when the caller can tell.
 * @param {() => void} props.onClear Leaves selection mode.
 */
export default function BulkActionBar({
  count,
  progress = null,
  statusOptions = [],
  memberOptions = [],
  priorityOptions = [],
  labelOptions = [],
  typeOptions = [],
  canArchive = false,
  archiveDisabledReason = 'Видалення доступне owner або admin',
  onApply,
  onClear,
}) {
  const [busyAction, setBusyAction] = useState('');
  const confirm = useConfirm();

  if (!count) return null;

  // Running means either: this bar started the action, or the caller is still
  // reporting progress for one. Both are true at once in the workspace; the
  // second alone is what lets the catalogue draw the running state at all.
  const busy = Boolean(busyAction) || Boolean(progress);

  const apply = async (action, value) => {
    if (busy) return;
    setBusyAction(action);
    try {
      await onApply?.(action, value);
    } catch {
      // The data hook owns rollback and the user-facing error. Do not leak an
      // unhandled rejected click promise into the browser console.
    } finally {
      setBusyAction('');
    }
  };

  const applyEncoded = (value) => {
    if (!value) return;
    const separator = value.indexOf(':');
    const action = separator >= 0 ? value.slice(0, separator) : value;
    const id = separator >= 0 ? value.slice(separator + 1) : '';
    return apply(action, [id]);
  };

  const askDeadline = async () => {
    const value = await confirm({
      title: `Термін вирішення для ${count} звернень`,
      message: 'Оберіть дату вирішення для всіх вибраних звернень.',
      confirmText: 'Встановити',
      input: { type: 'date' },
    });
    if (value) await apply('deadline', value);
  };

  const askArchive = async () => {
    const accepted = await confirm({
      title: `Архівувати ${count} звернень?`,
      message: 'Звернення зникнуть з активної черги, але їхня історія, чат і файли залишаться в «Архіві». Повернути їх можна будь-коли.',
      confirmText: 'Архівувати',
    });
    if (accepted) await apply('archive');
  };

  const askCancel = async () => {
    const accepted = await confirm({
      title: `Скасувати ${count} звернень?`,
      message: 'Скасовані звернення зникнуть з активної черги й не рахуватимуться як вирішені. Історія звернень залишиться в «Архіві» → «Скасовані», а повернути їх можна будь-коли.',
      confirmText: 'Так, скасувати',
      // See IssueDetail: «Скасувати» is the dismiss label on every dialog, and
      // here it is also the action, so the two buttons would have read the same.
      cancelText: 'Ні, лишити',
    });
    if (accepted) await apply('cancel');
  };

  const askDelete = async () => {
    const accepted = await confirm({
      title: `Видалити ${count} звернень?`,
      message: 'Звернення потраплять у «Нещодавно видалене» і через 24 години зникнуть назавжди.',
      confirmText: 'Видалити',
      danger: true,
    });
    if (accepted) await apply('delete');
  };

  // Geometry only, and not width — that lives in `globals.css` beside the bar,
  // together with the chip's colours, so one change reaches every picker.
  // `!w-auto` used to be here as well. It said exactly what the rule in
  // `globals.css` already says (a picker is as wide as its label), and being
  // `!important` it was the one declaration the phone layout could not answer:
  // there the chip has to fill its share of the glyph row instead. Removing it
  // changes nothing above md: the stylesheet rule that gives a picker's trigger
  // its width is untouched, and it already said `auto`.
  const triggerClass = 'ui-bulk-actions__trigger px-[10px] rounded-[10px] text-[12px]';
  const assigneeActions = [
    { id: 'assignees-add', label: 'Додати' },
    { id: 'assignees-remove', label: 'Прибрати' },
    { id: 'assignees-replace', label: 'Замінити' },
  ];
  const labelActions = [
    { id: 'labels-add', label: 'Додати' },
    { id: 'labels-remove', label: 'Прибрати' },
  ];

  return (
    <div
      data-ui-composition="bulk-actions"
      className="ui-bulk-actions"
      role="toolbar"
      aria-label={`Дії з вибраними зверненнями: ${count}`}
    >
      {/* While an action runs the bar said nothing at all: every control simply
          went dead and stayed dead — for minutes on a large selection, with no
          way to tell a slow save from a broken one. The count is the natural
          place for that news, because it is already the sentence the bar is
          making about the selection. */}
      <strong className="ui-bulk-actions__count" aria-live="polite">
        {busy ? (
          <>
            <span className="ui-bulk-actions__spinner" aria-hidden="true" />
            {progress && progress.total
              ? `Виконуємо: ${progress.done} із ${progress.total}`
              : `Виконуємо для ${count}…`}
          </>
        ) : `Обрано: ${count}`}
      </strong>
      <span className="ui-bulk-actions__divider" aria-hidden="true" />
      {/* Below md the pickers are a row of the card on their own; everywhere
          else this box is `display: contents` (globals.css) and disappears, so
          they stay the same direct flex children of the bar. `role="none"`
          keeps the toolbar owning its widgets on the one screen where the box
          is real. */}
      <div className="ui-bulk-actions__rail" role="none">
        <Select
          value=""
          onChange={value => apply('status', value)}
          options={statusOptions}
          placeholder="Статус"
          triggerIcon={CircleDot}
          className="ui-bulk-actions__control"
          compact
          size="sm"
          disabled={busy}
          ariaLabel="Змінити статус вибраних звернень"
          buttonClassName={triggerClass}
        />
        <Select
          value=""
          onChange={value => (value === 'assignees-clear'
            ? apply('assignees-clear')
            : applyEncoded(value))}
          options={[
            ...encodedOptions(memberOptions, assigneeActions),
            { value: 'assignees-clear', label: 'Очистити відповідальних' },
          ]}
          placeholder="Відповідальні"
          triggerIcon={Users}
          className="ui-bulk-actions__control"
          compact
          size="sm"
          disabled={busy}
          ariaLabel="Змінити відповідальних вибраних звернень"
          buttonClassName={triggerClass}
        />
        <Select
          value=""
          onChange={value => (value === 'none'
            ? apply('priority-clear')
            : apply('priority', value))}
          options={priorityOptions}
          placeholder="Пріоритет"
          triggerIcon={Flag}
          className="ui-bulk-actions__control"
          compact
          size="sm"
          disabled={busy}
          ariaLabel="Змінити пріоритет вибраних звернень"
          buttonClassName={triggerClass}
        />
        {labelOptions.length > 0 && (
          <Select
            value=""
            onChange={value => (value === 'labels-clear'
              ? apply('labels-clear')
              : applyEncoded(value))}
            options={[
              ...encodedOptions(labelOptions, labelActions),
              { value: 'labels-clear', label: 'Очистити мітки' },
            ]}
            placeholder="Мітки"
            triggerIcon={Tags}
            className="ui-bulk-actions__control"
            compact
            size="sm"
            disabled={busy}
            ariaLabel="Змінити мітки вибраних звернень"
            buttonClassName={triggerClass}
          />
        )}
        {typeOptions.length > 0 && (
          <Select
            value=""
            onChange={value => apply('type', value)}
            options={typeOptions}
            placeholder="Тип"
            triggerIcon={Shapes}
            className="ui-bulk-actions__control"
            compact
            size="sm"
            disabled={busy}
            ariaLabel="Змінити тип вибраних звернень"
            buttonClassName={triggerClass}
          />
        )}
        <ContextMenu
          trigger={(
            <Button
              style="secondary"
              size="icon-sm"
              icon={MoreHorizontal}
              disabled={busy}
              aria-label="Інші масові дії"
              title="Інші масові дії"
              className="ui-bulk-actions__trigger"
            />
          )}
          items={[
            { label: 'Встановити термін вирішення', icon: CalendarDays, onClick: askDeadline },
            { label: 'Очистити термін вирішення', icon: CalendarDays, onClick: () => apply('deadline-clear') },
            { isDivider: true },
            { label: `Архівувати (${count})`, icon: Archive, onClick: askArchive },
            { label: `Скасувати (${count})`, icon: Ban, onClick: askCancel },
            {
              label: `Видалити (${count})`,
              icon: Trash2,
              onClick: askDelete,
              isDanger: true,
              disabled: !canArchive,
              disabledReason: canArchive ? '' : archiveDisabledReason,
            },
          ]}
        />
      </div>
      <Button
        style="ghost"
        size="icon-sm"
        icon={X}
        onClick={onClear}
        disabled={busy}
        aria-label="Зняти вибір"
        title="Зняти вибір"
        className="ui-bulk-actions__clear !text-white hover:!bg-white/15"
      />
    </div>
  );
}
