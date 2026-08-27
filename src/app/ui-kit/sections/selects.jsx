'use client';
import { useState } from 'react';
import { Select, MultiSelect } from '@/components/ui/Select';
import FilterBar from '@/components/ui/FilterBar';
import { DEFAULT_STATUSES, DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import { PreviewBlock } from '../preview';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { MAX_CALENDAR_REMINDERS } from '@/lib/utils/calendarReminders.mjs';

export default function SelectsSection() {
  const [v1, setV1] = useState('');
  const [v2, setV2] = useState('');
  const [v3, setV3] = useState([]);
  const [v4, setV4] = useState('task');
  const [v5, setV5] = useState([]);
  const [limitedValues, setLimitedValues] = useState([5, 10, 15, 30, 60]);
  const [v6, setV6] = useState('in-progress');
  const [v7, setV7] = useState('');

  const statusOpts = DEFAULT_STATUSES.map(s => ({ value: s.id, label: s.label, dotColor: s.color }));
  const priorityOpts = prioritySelectOptions(DEFAULT_PRIORITIES);
  const typeOpts = DEFAULT_TYPES.map(taskTypeSelectOption);
  // `user` on every option so the previews show the avatar treatment the
  // product actually renders, not a bare list of names.
  const memberOpts = [
    { value: 'u1', label: 'Артур Моспан', user: { id: 'u1', name: 'Артур Моспан' } },
    { value: 'u2', label: 'Іван Петренко', user: { id: 'u2', name: 'Іван Петренко' } },
    { value: 'u3', label: 'Марина Коваль', user: { id: 'u3', name: 'Марина Коваль' } },
    { value: 'u4', label: 'Дмитро Сірко', user: { id: 'u4', name: 'Дмитро Сірко' } },
  ];

  // Номер попереду назви — так підпис завдання будує «Зафіксувати час», і саме
  // тому пошук по «142» знаходить QT-142.
  const issueOpts = [
    { value: 'i1', label: 'QT-142 Перерахувати підсумки табеля' },
    { value: 'i2', label: 'QT-143 Пошук у селекторі завдань' },
    { value: 'i3', label: 'QT-158 Шапка спринта на десктопі' },
    { value: 'i4', label: 'QT-160 Додати існуюче завдання у спринт' },
  ];

  return (
    <div className="flex flex-col gap-[40px]">
      {/* ─── Standard Selects ─── */}
      <PreviewBlock title="Standard Selects — sm / md / lg" component="Select" description="Named sizes збігаються з Input і Button: 28 / 32 / 36px. Ghost-фільтри мають окремий compact preset." fullWidth>
        <div className="flex flex-wrap items-center gap-[8px]">
          <Select size="sm" options={statusOpts} value={v1} onChange={setV1} placeholder="Small — 28px" className="w-[160px]" />
          <Select size="md" options={priorityOpts} value={v2} onChange={setV2} placeholder="Medium — 32px" className="w-[160px]" />
          <Select size="lg" options={statusOpts} value={v1} onChange={setV1} placeholder="Large — 36px" className="w-[180px]" />
        </div>
      </PreviewBlock>

      {/* ─── Ghost Select & MultiSelect ─── */}
      <PreviewBlock title="Ghost Select & MultiSelect" description="Безмежові селектори для панелей фільтрів (FilterBar). Висота: 28px (вбудована в FilterBar висотою 36px). Кольори: фон transparent (hover #ebebeb), текст #1f1f1f, маркер #9a9a9a. Скруглення: 8px. Активуються при наведенні, мають уніфікований шрифт (font-medium). Контекст context=&quot;stacked&quot; розтягує кожен контрол на всю ширину — його використовує PageHeader у мобільній модалці фільтрів." fullWidth>
        <FilterBar>
          <Select filterRole="type" options={typeOpts} value={v4} onChange={setV4} placeholder="Всі типи" variant="ghost" />
          <MultiSelect filterRole="member" options={memberOpts} value={v5} onChange={setV5} placeholder="Всі виконавці" searchPlaceholder="Шукати..." variant="ghost" />
        </FilterBar>
      </PreviewBlock>

      {/* ─── Inline Attribute Select ─── */}
      <PreviewBlock title="Inline Attribute Select" description="Ультракомпактний селектор для бічних панелей деталей та таблиць. Висота: 22px. Кольори: bg-transparent, текст #1f1f1f. Скруглення: 10px. Охоплює ховер-ефектом (#ebebeb) увесь стовпчик разом із заголовком. Атрибути з кількома значеннями (виконавці) використовують MultiSelect із compact + showSelectedAvatars — стек аватарів і «Ім’я +N» замість «Обрано (N)»." fullWidth>
        <div className="max-w-[200px] bg-[#f4f4f5] p-4 rounded-[12px]">
          <div className="hover:bg-[#ebebeb] p-2 -m-2 rounded-[10px] transition-colors flex flex-col gap-[4px] w-full cursor-pointer" onClick={e => { if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
            <span className="text-[10px] font-bold text-[#9a9a9a] uppercase tracking-wider">Статус</span>
            <Select
              value={v6}
              onChange={setV6}
              options={statusOpts}
              buttonClassName="h-[22px] w-full justify-start gap-1 rounded-[10px] bg-transparent px-0 text-[13px] font-medium leading-[22px]"
            />
          </div>
          <div className="mt-3 hover:bg-[#ebebeb] p-2 -m-2 rounded-[10px] transition-colors flex flex-col gap-[4px] w-full cursor-pointer" onClick={e => { if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
            <span className="text-[10px] font-bold text-[#9a9a9a] uppercase tracking-wider">Виконавці</span>
            <MultiSelect
              compact
              showSelectedAvatars
              value={v3}
              onChange={setV3}
              options={memberOpts}
              placeholder="Не призначено"
              searchPlaceholder="Знайти учасника..."
              buttonClassName="h-[22px] w-full justify-start gap-1 rounded-[10px] bg-transparent px-0 text-[13px] font-medium leading-[22px]"
              dropdownClassName="w-[260px]"
            />
          </div>
        </div>
      </PreviewBlock>

      {/* ─── Select with Search ─── */}
      <PreviewBlock title="Select with Search" component="Select" description="Той самий Select із пошуковим рядком над списком: searchable вмикає його, searchPlaceholder підписує. Для вибору з довгого списку, який неможливо переглянути очима — завдання проєкту в «Зафіксувати час». Пошук іде по підпису опції, тому підпис, що починається з номера, знаходиться і за номером, і за назвою. Порожній результат каже «Нічого не знайдено», клавіатура рухається тільки знайденими рядками." fullWidth>
        <div className="max-w-[300px]">
          <label className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[6px] block">Завдання</label>
          <Select
            searchable
            searchPlaceholder="Пошук за назвою або номером"
            options={issueOpts}
            value={v7}
            onChange={setV7}
            placeholder="Оберіть завдання..."
          />
        </div>
      </PreviewBlock>

      {/* ─── MultiSelect with Search ─── */}
      <PreviewBlock title="MultiSelect with Search" description="Множинний вибір із вбудованим пошуковим рядком. Висота: 36px. Кольори: фон #f4f4f5, чекбокси опцій #1f1f1f при виборі. Скруглення: 10px. Має вбудовану валідацію порожнього пошуку." fullWidth>
        <div className="max-w-[300px]">
          <label className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[6px] block">Виконавці</label>
          <MultiSelect options={memberOpts} value={v3} onChange={setV3} placeholder="Оберіть виконавців..." searchPlaceholder="Шукати учасника..." />
        </div>
      </PreviewBlock>

      <PreviewBlock title="MultiSelect — ліміт вибору" description="Після п’ятого вибору решта опцій недоступні, але кожне обране значення можна зняти." fullWidth>
        <div className="max-w-[300px]">
          <MultiSelect
            options={[
              { value: 5, label: 'За 5 хвилин' },
              { value: 10, label: 'За 10 хвилин' },
              { value: 15, label: 'За 15 хвилин' },
              { value: 30, label: 'За 30 хвилин' },
              { value: 60, label: 'За 1 годину' },
              { value: 120, label: 'За 2 години' },
            ]}
            value={limitedValues}
            onChange={setLimitedValues}
            maxSelected={MAX_CALENDAR_REMINDERS}
            placeholder="Додати нагадування"
            searchPlaceholder="Знайти інтервал..."
          />
        </div>
      </PreviewBlock>
    </div>
  );
}
