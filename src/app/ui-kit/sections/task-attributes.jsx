'use client';
import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { AttributeTrigger, DatePicker, Popover, TaskAttributesPanel, getTaskAttributeChrome } from '@/components/ui';
import { DEFAULT_STATUSES, DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { Settings2 } from 'lucide-react';
import { PreviewBlock } from '../preview';
import { prioritySelectOptions } from '@/lib/utils/priorities.mjs';

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

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Task Attributes Panel — Issue Detail"
        description="Точний primary strip зі сторінки інциденту: ті самі compact/singleRow props, grid, поля та Details popover."
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

                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Виконавець</span>
                  <Select compact value={memberVal} onChange={setMemberVal} options={memberOpts} buttonClassName={compactSelectClass} />
                </div>

                <div className={`max-sm:hidden ${attributeItemClass}`}>
                  <span className={attributeLabelClass}>Дедлайн</span>
                  <DatePicker
                    compact
                    hideIcon
                    inputClassName={compactInputClass}
                    value={dueDate}
                    onChange={setDueDate}
                    placeholder="Без дедлайну"
                  />
                </div>

                <Popover
                  position="bottom"
                  hideCloseIcon
                  className="flex h-full items-center"
                  // Same as the product: without it the wrapper shrinks to the
                  // glyph and «Деталі» becomes a 14px target inside its column —
                  // and without the centring the button it stretched around sits
                  // at the top of it, ten pixels above the row it shares.
                  triggerClassName="flex h-full w-full items-center justify-center"
                  trigger={(
                    <AttributeTrigger
                      className="max-sm:px-0"
                      aria-label="Деталі завдання"
                      title="Пріоритет і тип"
                    >
                      <Settings2 size={14} />
                      <span className="max-sm:hidden">Деталі</span>
                    </AttributeTrigger>
                  )}
                >
                  <div className="flex w-[248px] max-w-full flex-col gap-4">
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

    </div>
  );
}
