'use client';
import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { AttributeTrigger, DatePicker, Popover, PriorityIcon, StatusPill, TaskAttributesPanel, TypeBadge, getTaskAttributeChrome } from '@/components/ui';
import { DEFAULT_STATUSES, DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import { taskTypeIcon, taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { Settings2 } from 'lucide-react';
import { PreviewBlock } from '../preview';
import { priorityPresentation, prioritySelectOptions } from '@/lib/utils/priorities.mjs';

export default function TaskAttributesSection() {
  const [statusVal, setStatusVal] = useState('todo');
  const [memberVal, setMemberVal] = useState('1');
  const [dueDate, setDueDate] = useState('2026-08-07');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('feature');

  const statusOpts = DEFAULT_STATUSES.map(s => ({ value: s.id, label: s.label, dotColor: s.color }));

  const memberOpts = [
    { value: '', label: 'Не призначено' },
    { value: '1', label: 'Артур Моспан' },
    { value: '2', label: 'Олена Коваль' },
    { value: '3', label: 'Дмитро Петренко' }
  ];
  const {
    attributeItemClass,
    attributeLabelClass,
    compactInputClass,
    compactSelectClass,
  } = getTaskAttributeChrome();
  const { attributeItemClass: readOnlyItemClass } = getTaskAttributeChrome({ readOnly: true });
  const clientPriority = priorityPresentation('high', DEFAULT_PRIORITIES);

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Task Attributes Panel — Issue Detail"
        description="Точний primary strip зі сторінки звернення: ті самі compact/singleRow props, grid, поля та Details popover."
        filePath="src/components/workspace/IssueDetail.jsx"
        fullWidth
      >
        <div className="relative isolate -mx-2 px-2">
          <TaskAttributesPanel
            singleRow
            context="task"
            compact
            cardClassName="transition-[background-color,padding] duration-200"
            primaryChildren={
              <>
                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Статус</span>
                  <Select compact value={statusVal} onChange={setStatusVal} options={statusOpts} buttonClassName={compactSelectClass} />
                </div>

                <div className={`max-sm:hidden ${attributeItemClass}`}>
                  <span className={attributeLabelClass}>Тип</span>
                  <Select compact value={type} onChange={setType} options={DEFAULT_TYPES.map(taskTypeSelectOption)} buttonClassName={compactSelectClass} />
                </div>

                <div className={`max-sm:hidden ${attributeItemClass}`}>
                  <span className={attributeLabelClass}>Пріоритет</span>
                  <Select compact value={priority} onChange={setPriority} options={prioritySelectOptions(DEFAULT_PRIORITIES)} buttonClassName={compactSelectClass} />
                </div>

                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Відповідальні</span>
                  <Select compact value={memberVal} onChange={setMemberVal} options={memberOpts} buttonClassName={compactSelectClass} />
                </div>

                <div className={`max-sm:hidden ${attributeItemClass}`}>
                  <span className={attributeLabelClass}>Термін вирішення</span>
                  <DatePicker
                    compact
                    hideIcon
                    inputClassName={compactInputClass}
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="Без терміну"
                  />
                </div>

                <Popover
                  position="bottom"
                  hideCloseIcon
                  className="flex h-full items-center sm:hidden"
                  // Same as the product: without it the wrapper shrinks to the
                  // glyph and «Деталі» becomes a 14px target inside its column —
                  // and without the centring the button it stretched around sits
                  // at the top of it, ten pixels above the row it shares.
                  triggerClassName="flex h-full w-full items-center justify-center"
                  trigger={(
                    <AttributeTrigger
                      className="max-sm:px-0"
                      aria-label="Деталі звернення"
                      title="Пріоритет і тип"
                    >
                      <Settings2 size={14} />
                      <span className="max-sm:hidden">Деталі</span>
                    </AttributeTrigger>
                  )}
                >
                  <div className="flex w-[248px] max-w-full flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Термін вирішення</span>
                      <DatePicker compact value={dueDate} onChange={setDueDate} placeholder="Без терміну" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Пріоритет</span>
                      <Select value={priority} onChange={setPriority} options={prioritySelectOptions(DEFAULT_PRIORITIES)} buttonClassName="h-[36px] w-full rounded-[10px] bg-canvas px-3 text-[13px] font-medium" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Тип</span>
                      <Select value={type} onChange={setType} options={DEFAULT_TYPES.map(taskTypeSelectOption)} buttonClassName="h-[36px] w-full rounded-[10px] bg-canvas px-3 text-[13px] font-medium" />
                    </div>
                  </div>
                </Popover>
              </>
            }
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Task Attributes Panel — очима клієнта"
        description="Той самий компонент без сітки та без редагування: три факти замість пʼяти контролів. readOnly знімає курсор, ховер і flex-1, тож клітинки беруть ширину своїх слів, а не по колонці кожна."
        filePath="src/components/workspace/IssueDetail.jsx"
        fullWidth
      >
        <div className="relative isolate -mx-2 px-2">
          <TaskAttributesPanel
            compact
            primaryChildren={
              <>
                <div className={readOnlyItemClass}>
                  <span className={attributeLabelClass}>Статус</span>
                  <StatusPill label="У роботі" color={DEFAULT_STATUSES.find(item => item.id === 'in-progress')?.color} />
                </div>

                <div className={readOnlyItemClass}>
                  <span className={attributeLabelClass}>Тип</span>
                  <TypeBadge label="Помилка" color={DEFAULT_TYPES.find(item => item.id === 'bug')?.color} icon={taskTypeIcon(DEFAULT_TYPES.find(item => item.id === 'bug'))} />
                </div>

                <div className={readOnlyItemClass}>
                  <span className={attributeLabelClass}>Пріоритет</span>
                  <span className="flex items-center gap-1.5 text-[13px] font-medium leading-[22px] text-ink">
                    <PriorityIcon priority={clientPriority} size="sm" />
                    {clientPriority.label}
                  </span>
                </div>
              </>
            }
          />
        </div>
      </PreviewBlock>

    </div>
  );
}
