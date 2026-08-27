'use client';
import { useState } from 'react';
import Tabs from '@/components/ui/Tabs';
import { Segmented } from '@/components/ui';
import { List, Table as TableIcon, Kanban } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function TabsSection() {
  const [a1, setA1] = useState('board');
  const [a3, setA3] = useState('kanban');
  const [period, setPeriod] = useState(30);
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Підкреслені вкладки (variant=&quot;underline&quot;)"
        component="Tabs"
        description="Друга форма тієї самої смуги. raised — плитка, що стоїть у рядку фільтрів і вирівнюється з інпутами на 36px. underline — широкий степер угорі етапу: він заповнює контейнер, тож вкладки розтягуються, а обрану позначає риска під нею, а не піднята плитка. Риска читається як «ви тут у послідовності», плитка — як «це увімкнено». Заблокована вкладка гасне до 40% і не приймає клік."
        filePath="src/components/ui/Tabs.jsx"
        fullWidth
      >
        <div className="w-full max-w-[560px]">
          <Tabs
            variant="underline"
            activeTab="design"
            onTabChange={() => {}}
            tabs={[
              { id: 'brief', label: 'Бриф' },
              { id: 'design', label: 'Дизайн' },
              { id: 'build', label: 'Розробка', disabled: true, title: 'Етап ще не розпочато' },
            ]}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock title="Standard Tabs — 36px" description="Pill wrapper bg-[#f4f4f5], active tab bg-white shadow-sm.">
        <Tabs tabs={[{ id: 'board', label: 'Дошка' }, { id: 'backlog', label: 'Беклог', count: 3 }, { id: 'sprints', label: 'Спринти' }]} activeTab={a1} onTabChange={setA1} />
      </PreviewBlock>

      <PreviewBlock title="With Icons" description="Tab icon size 14px.">
        <Tabs
          tabs={[
            { id: 'kanban', label: 'Kanban', icon: Kanban },
            { id: 'list', label: 'Список', icon: List },
            { id: 'table', label: 'Таблиця', icon: TableIcon },
          ]}
          activeTab={a3}
          onTabChange={setA3}
        />
      </PreviewBlock>

      <PreviewBlock title="Segmented Switcher" component="Segmented" description="Компактний взаємовиключний перемикач, який продукт використовує всередині FilterBar для періодів і режимів.">
        <div className="rounded-[10px] bg-canvas p-[2px]">
          <Segmented
            value={period}
            onChange={setPeriod}
            options={[7, 14, 30, 90].map(days => ({ value: days, label: `${days}д` }))}
          />
        </div>
      </PreviewBlock>
    </div>
  );
}
