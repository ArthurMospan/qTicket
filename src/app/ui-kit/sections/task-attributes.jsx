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
  const [clientMemberVal, setClientMemberVal] = useState('4');

  const statusOpts = DEFAULT_STATUSES.map(s => ({ value: s.id, label: s.label, dotColor: s.color }));

  const memberOpts = [
    { value: '', label: 'Не призначено' },
    { value: '1', label: 'Артур Моспан' },
    { value: '2', label: 'Олена Коваль' },
    { value: '3', label: 'Дмитро Петренко' }
  ];
  const clientMemberOpts = [
    { value: '', label: 'Нікого не призначено' },
    { value: '4', label: 'Ірина Бондар' },
    { value: '5', label: 'Сергій Ткач' },
  ];
  const {
    attributeItemClass,
    attributeLabelClass,
    compactInputClass,
    compactSelectClass,
  } = getTaskAttributeChrome();
  const { attributeItemClass: readOnlyItemClass } = getTaskAttributeChrome({ readOnly: true });

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Task Attributes Panel — Issue Detail"
        description="Точний primary strip зі сторінки звернення: та сама сітка, ті самі шість полів і той самий Details popover, який тримає ті з них, що не влізли."
        filePath="src/components/workspace/IssueDetail.jsx"
        fullWidth
      >
        <div className="relative isolate -mx-2 px-2">
          <TaskAttributesPanel
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

                <div className={`max-lg:hidden ${attributeItemClass}`}>
                  <span className={attributeLabelClass}>Від клієнта</span>
                  <Select compact value={clientMemberVal} onChange={setClientMemberVal} options={clientMemberOpts} buttonClassName={compactSelectClass} />
                </div>

                <div className={`max-lg:hidden ${attributeItemClass}`}>
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
                  className="flex h-full items-center lg:hidden"
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
                    <div className="flex flex-col gap-1.5 sm:hidden">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Пріоритет</span>
                      <Select value={priority} onChange={setPriority} options={prioritySelectOptions(DEFAULT_PRIORITIES)} buttonClassName="h-[36px] w-full rounded-[10px] bg-canvas px-3 text-[13px] font-medium" />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:hidden">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Тип</span>
                      <Select value={type} onChange={setType} options={DEFAULT_TYPES.map(taskTypeSelectOption)} buttonClassName="h-[36px] w-full rounded-[10px] bg-canvas px-3 text-[13px] font-medium" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Від клієнта</span>
                      <Select value={clientMemberVal} onChange={setClientMemberVal} options={clientMemberOpts} buttonClassName="h-[36px] w-full rounded-[10px] bg-canvas px-3 text-[13px] font-medium" />
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
        description="Та сама смуга, ті самі клітинки, той самий порядок. Різниця рівно одна: рухати звернення робочим процесом — робота підтримки, тож «Статус» тут читають (readOnly знімає курсор, ховер і flex-1), а решта лишається контролями, бо це зміст звернення. Без двох клітинок, що належать столу підтримки: власних виконавців і обіцяного терміну."
        filePath="src/components/workspace/IssueDetail.jsx"
        fullWidth
      >
        <div className="relative isolate -mx-2 px-2">
          <TaskAttributesPanel
            context="clientTask"
            compact
            primaryChildren={
              <>
                <div className={readOnlyItemClass}>
                  <span className={attributeLabelClass}>Статус</span>
                  <Select compact readOnly value="in-progress" options={statusOpts} buttonClassName={compactSelectClass} />
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
                  <Select compact value={clientMemberVal} onChange={setClientMemberVal} options={clientMemberOpts} buttonClassName={compactSelectClass} />
                </div>

                <Popover
                  position="bottom"
                  hideCloseIcon
                  className="flex h-full items-center sm:hidden"
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
