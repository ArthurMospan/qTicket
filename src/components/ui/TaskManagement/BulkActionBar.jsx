'use client';

import { useState } from 'react';
import {
  Ban,
  CalendarDays,
  CircleDot,
  Clock3,
  Copy,
  Flag,
  Archive,
  MoreHorizontal,
  Shapes,
  Tags,
  Trash2,
  Users,
  X,
  Zap,
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
 * @param {object[]} props.sprintOptions Active or planned sprint destinations.
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
  sprintOptions = [],
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
      title: `Дедлайн для ${count} інцидентів`,
      message: 'Оберіть дату, яку буде встановлено для всіх вибраних інцидентів.',
      confirmText: 'Встановити',
      input: { type: 'date' },
    });
    if (value) await apply('deadline', value);
  };

  const askEstimate = async () => {
    const value = await confirm({
      title: `Оцінка для ${count} інцидентів`,
      message: 'Вкажіть оцінку в хвилинах від 0 до 525600.',
      confirmText: 'Встановити',
      input: { type: 'number', min: 0, max: 525600, step: 1, placeholder: '60', suffix: 'хв' },
    });
    if (value !== null && value !== '') await apply('estimate', Number(value));
  };

  const askArchive = async () => {
    const accepted = await confirm({
      title: `Архівувати ${count} інцидентів?`,
      message: 'Інциденти зникнуть з дошки, списків і підрахунку відкритої роботи. У звітах, таймшиті та рахунках вони лишаються — записаний час і далі рахується як зроблена робота. Лежатимуть в «Архіві» без строку, повернути можна будь-коли.',
      confirmText: 'Архівувати',
    });
    if (accepted) await apply('archive');
  };

  const askCancel = async () => {
    const accepted = await confirm({
      title: `Скасувати ${count} інцидентів?`,
      message: 'Скасування означає, що цієї роботи не буде. Інциденти зникнуть не лише з дошки й списків, а й з усього обліку: з прогресу, зі звітів, з навантаження, з рахунків і з дедлайнів. Лежатимуть в «Архіві» → «Скасовані» без строку, повернути можна будь-коли. Якщо робота відбулася — архівуйте, тоді вона лишиться у звітах.',
      confirmText: 'Так, скасувати',
      // See IssueDetail: «Скасувати» is the dismiss label on every dialog, and
      // here it is also the action, so the two buttons would have read the same.
      cancelText: 'Ні, лишити',
    });
    if (accepted) await apply('cancel');
  };

  const askDelete = async () => {
    const accepted = await confirm({
      title: `Видалити ${count} інцидентів?`,
      message: 'Інциденти потраплять у «Нещодавно видалене» і за кілька днів зникнуть назавжди. Залежності або дочірні інциденти можуть заблокувати окремі елементи.',
      confirmText: 'Видалити',
      danger: true,
    });
    if (accepted) await apply('delete');
  };

  // Geometry only. The chip's colours belong to the dark bar and are set in
  // `globals.css` beside the bar itself, so one change reaches every picker.
  const triggerClass = 'ui-bulk-actions__trigger !w-auto px-[10px] rounded-[10px] text-[12px]';
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
      aria-label={`Дії з вибраними інцидентами: ${count}`}
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
        ariaLabel="Змінити статус вибраних інцидентів"
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
        ariaLabel="Змінити відповідальних вибраних інцидентів"
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
        ariaLabel="Змінити пріоритет вибраних інцидентів"
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
          ariaLabel="Змінити мітки вибраних інцидентів"
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
          ariaLabel="Змінити тип вибраних інцидентів"
          buttonClassName={triggerClass}
        />
      )}
      {sprintOptions.length > 0 && (
        <Select
          value=""
          onChange={value => (value === '__backlog__'
            ? apply('backlog')
            : apply('sprint', value))}
          options={[{ value: '__backlog__', label: 'Без спринта' }, ...sprintOptions]}
          placeholder="Спринт"
          triggerIcon={Zap}
          className="ui-bulk-actions__control"
          compact
          size="sm"
          disabled={busy}
          ariaLabel="Перемістити вибрані інциденти у спринт"
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
          { label: 'Встановити дедлайн', icon: CalendarDays, onClick: askDeadline },
          { label: 'Очистити дедлайн', icon: CalendarDays, onClick: () => apply('deadline-clear') },
          { label: 'Встановити оцінку', icon: Clock3, onClick: askEstimate },
          { label: 'Очистити оцінку', icon: Clock3, onClick: () => apply('estimate-clear') },
          { isDivider: true },
          { label: `Дублювати (${count})`, icon: Copy, onClick: () => apply('duplicate') },
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
      <Button
        style="ghost"
        size="icon-sm"
        icon={X}
        onClick={onClear}
        disabled={busy}
        aria-label="Зняти вибір"
        title="Зняти вибір"
        className="!text-white hover:!bg-white/15"
      />
    </div>
  );
}
