'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Select, MultiSelect } from '@/components/ui/Select';
import Tabs from '@/components/ui/Tabs';
import FilterBar from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui';
import { Check, Plus, Settings2, List, Kanban } from 'lucide-react';
import { PreviewBlock } from '../preview';
import { DEFAULT_PRIORITIES } from '@/lib/hooks/useWorkflowConfig';
import { prioritySelectOptions } from '@/lib/utils/priorities.mjs';

const PRIORITY_FILTER_OPTIONS = [
  { value: 'all', label: 'Всі пріоритети' },
  ...prioritySelectOptions(DEFAULT_PRIORITIES),
];

export default function PageHeadersSection() {
  const [tab1, setTab1] = useState('kanban');
  const [tab2, setTab2] = useState('active');
  const [priority, setPriority] = useState('all');
  const [project, setProject] = useState([]);

  return (
    <div className="flex flex-col gap-[32px]">
      {/* Варіант 1: Повний (Заголовок + Дії + Таби + Фільтри + Switcher) */}
      <PreviewBlock title="1) Повний варіант (Full PageHeader)" description="Містить заголовок, кнопки дій, вкладки сторінки, фільтри та перемикач вигляду (як на сторінці «Звернення»). На екранах вужче 768px рядок фільтрів ховається: замість нього — іконка з лічильником активних фільтрів, яка відкриває їх у модалці (звузьте вікно, щоб перевірити). Шторка не відтворює десктопний рядок, а читає його: фільтри стають стосом, усе з `max-md:hidden` лишається схованим, а те, що не фільтр, стає рядком на всю ширину внизу." filePath="src/components/ui/Layout/PageHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[24px] overflow-hidden bg-white p-[24px] w-full">
          <PageHeader
            title="Звернення"
            actions={
              <div className="flex gap-2">
                <Button onClick={() => alert('Налаштування')} icon={Settings2} size="icon-lg" style="secondary" title="Налаштування" />
                <Button onClick={() => alert('Створити')} icon={Plus} size="lg" style="primary" color="dark" collapseAt="sm">Створити звернення</Button>
              </div>
            }
            filters={
              <div className="flex items-center justify-between w-full">
                <FilterBar>
                  <MultiSelect
                    filterRole="project"
                    variant="ghost"
                    value={project}
                    onChange={setProject}
                    options={[
                      { value: 'p1', label: 'QuickTeam Website' },
                      { value: 'p2', label: 'Mobile Application' }
                    ]}
                    placeholder="Всі клієнти"
                    searchPlaceholder="Пошук проєкту..."
                  />
                  <Select
                    filterRole="type"
                    variant="ghost"
                    value={priority}
                    onChange={setPriority}
                    options={PRIORITY_FILTER_OPTIONS}
                  />
                </FilterBar>

                <div className="ml-auto max-md:hidden">
                  <Tabs
                    tabs={[
                      { id: 'kanban', icon: Kanban },
                      { id: 'list', icon: List }
                    ]}
                    activeTab={tab1}
                    onTabChange={setTab1}
                  />
                </div>

                {/* Дія, а не фільтр: нижче md вона їде у шторку фільтрів і
                    стає рядком на всю ширину під ними. */}
                <Button
                  onClick={() => alert('Налаштування колонок')}
                  icon={Settings2}
                  size="lg"
                  style="secondary"
                  className="md:hidden"
                >
                  Налаштування колонок
                </Button>
              </div>
            }
          />
        </div>
      </PreviewBlock>

      {/* Варіант 2: Заголовок + Дії (Без табів, без фільтрів) */}
      <PreviewBlock title="2) Тільки заголовок та дії" description="Простий заголовок з кнопкою дії. Використовується на сторінках налаштувань або деталей." filePath="src/components/ui/Layout/PageHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[24px] overflow-hidden bg-white p-[24px] w-full">
          <PageHeader
            title="Профіль учасника"
            actions={
              <Button onClick={() => alert('Зберегти')} style="primary" color="dark" size="lg" icon={Check} collapseAt="sm">Зберегти профіль</Button>
            }
          />
        </div>
      </PreviewBlock>

      {/* Варіант 3: Заголовок + Фільтри (Без табів, без дій) */}
      <PreviewBlock title="3) Заголовок + Фільтри" description="Шапка з фільтрами, але без дій чи перемикачів вкладок." filePath="src/components/ui/Layout/PageHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[24px] overflow-hidden bg-white p-[24px] w-full">
          <PageHeader
            title="Аналітика завантаження"
            filters={
              <FilterBar>
                <Select
                  variant="ghost"
                  value={priority}
                  onChange={setPriority}
                  options={PRIORITY_FILTER_OPTIONS}
                  />
                </FilterBar>
              }
            />
          </div>
        </PreviewBlock>

        {/* Варіант 4: Заголовок + Таби + Дії (Без фільтрів, без перемикача) */}
        <PreviewBlock title="4) Заголовок + Вкладки + Дії" description="Використовується на сторінках зі списками без розгорнутої фільтрації (наприклад, список клієнтів)." filePath="src/components/ui/Layout/PageHeader.jsx" fullWidth>
          <div className="border border-[#f0f0f0] rounded-[24px] overflow-hidden bg-white p-[24px] w-full">
            <PageHeader
              title="Проєкти"
              tabs={[
                { id: 'active', label: 'Активні' },
                { id: 'archived', label: 'Архівні' }
              ]}
              activeTab={tab2}
              onTabChange={setTab2}
              actions={
                <Button onClick={() => alert('Створити проєкт')} style="primary" color="dark" size="lg" icon={Plus} collapseAt="sm">Новий проєкт</Button>
              }
            />
          </div>
        </PreviewBlock>

      </div>
  );
}
