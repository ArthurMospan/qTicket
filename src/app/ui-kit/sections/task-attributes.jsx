'use client';
import { useState } from 'react';
import { Select } from '@/components/ui/Select';
import { AttributeTrigger, DatePicker, Popover, TaskAttributesPanel, getTaskAttributeChrome } from '@/components/ui';
import { DEFAULT_STATUSES, DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { CALENDAR_EVENT_TYPE_OPTIONS } from '@/components/workspace/calendar/CalendarEventDialog';
import { Settings2, Play, Users } from 'lucide-react';
import { PreviewBlock } from '../preview';
import { prioritySelectOptions } from '@/lib/utils/priorities.mjs';

export default function TaskAttributesSection() {
  const [statusVal, setStatusVal] = useState('todo');
  const [memberVal, setMemberVal] = useState('1');
  const [sprintVal, setSprintVal] = useState('sprint-12');
  const [dueDate, setDueDate] = useState('2026-08-07');
  const [priority, setPriority] = useState('medium');
  const [type, setType] = useState('feature');
  const [eventType, setEventType] = useState('meeting');
  const [eventProject, setEventProject] = useState('quickteam');

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
        description="Точний primary strip зі сторінки завдання: ті самі compact/singleRow props, grid, поля, кнопка таймера та Details popover."
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
                  <span className={attributeLabelClass}>Спринт</span>
                  <Select
                    compact
                    value={sprintVal}
                    onChange={setSprintVal}
                    options={[
                      { value: '', label: 'Без спринта' },
                      { value: 'sprint-12', label: 'Спринт 12' },
                    ]}
                    buttonClassName={compactSelectClass}
                  />
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

                <div className={`${attributeItemClass} max-sm:px-1.5`}>
                  <span className={attributeLabelClass}><span className="sm:hidden">Час</span><span className="max-sm:hidden">Трекінг часу</span></span>
                  <div className="flex h-[22px] min-w-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Запустити таймер"
                      title="Запустити таймер"
                      className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] bg-line leading-none text-ink transition-colors hover:bg-[#d9d9d9]"
                    >
                      <Play size={10} strokeWidth={0} className="block translate-x-[1px] fill-current" />
                    </button>
                    <button type="button" className="min-w-0 truncate text-[11px] font-bold text-ink">
                      1г 25хв <span className="font-medium text-muted max-sm:hidden"> / 3г</span>
                    </button>
                  </div>
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

      <PreviewBlock
        title="Task Attributes Panel — Calendar Event"
        description="Другий фактичний організм на тому самому TaskAttributesPanel: 7 колонок, event type/project/date, час, учасники, трекінг і details."
        filePath="src/components/workspace/calendar/CalendarEventPage.jsx"
        fullWidth
      >
        <div className="relative -mx-2 mt-[12px] px-2">
          <TaskAttributesPanel
            singleRow
            context="calendar"
            compact
            primaryChildren={(
              <>
                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Тип</span>
                  <Select
                    compact
                    value={eventType}
                    onChange={setEventType}
                    options={CALENDAR_EVENT_TYPE_OPTIONS}
                    buttonClassName={compactSelectClass}
                  />
                </div>
                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Проєкт</span>
                  <Select
                    compact
                    value={eventProject}
                    onChange={setEventProject}
                    options={[{ value: 'quickteam', label: 'QuickTeam' }, { value: '', label: 'Без проєкту' }]}
                    buttonClassName={compactSelectClass}
                  />
                </div>
                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Дата</span>
                  <DatePicker
                    compact
                    hideIcon
                    value={dueDate}
                    onChange={setDueDate}
                    inputClassName={compactInputClass}
                  />
                </div>
                <button type="button" className={`${attributeItemClass} h-full w-full text-left`}>
                  <span className={attributeLabelClass}>Час події</span>
                  <span className="flex h-[22px] items-center truncate text-[13px] font-medium text-ink">10:00–11:00</span>
                </button>
                <button type="button" className={`${attributeItemClass} h-full w-full text-left`}>
                  <span className={attributeLabelClass}>Учасники</span>
                  <span className="flex h-[22px] items-center truncate text-[13px] font-medium text-ink"><Users size={13} className="mr-1.5 shrink-0 text-muted" />3 учасники</span>
                </button>
                <div className={attributeItemClass}>
                  <span className={attributeLabelClass}>Трекінг часу</span>
                  <div className="flex h-[22px] min-w-0 items-center gap-1">
                    <button type="button" className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[6px] leading-none transition-colors bg-line text-ink hover:bg-[#d9d9d9]">
                      <Play size={10} strokeWidth={0} className="block translate-x-[1px] fill-current" />
                    </button>
                    <button type="button" className="min-w-0 truncate text-[11px] font-bold text-ink">45 хв</button>
                  </div>
                </div>
                <AttributeTrigger aria-label="Деталі події">
                  <Settings2 size={14} />
                  <span>Деталі</span>
                </AttributeTrigger>
              </>
            )}
          />
        </div>
      </PreviewBlock>

    </div>
  );
}
