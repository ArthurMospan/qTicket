'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import FilterBar from '@/components/ui/FilterBar';
import { PageHeader } from '@/components/ui';
import { Plus, Users } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function FiltersSection() {
  const [selectedMember, setSelectedMember] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortOption, setSortOption] = useState('updated');
  const memberOptions = [
    { value: 'all', label: 'Всі учасники', icon: Users },
    { value: 'u1', label: 'Артур Моспан', user: { id: 'u1', name: 'Артур Моспан' } },
    { value: 'u2', label: 'Олена Коваль', user: { id: 'u2', name: 'Олена Коваль' } },
  ];
  const dateOptions = [
    { value: 'all', label: 'За весь час' },
    { value: '7days', label: 'Створено за 7 днів' },
    { value: '30days', label: 'Створено за 30 днів' },
  ];
  const sortOptions = [
    { value: 'updated', label: 'Нещодавно оновлені' },
    { value: 'name', label: 'За назвою (А-Я)' },
    { value: 'progress-desc', label: 'Прогрес (за спаданням)' },
    { value: 'progress-asc', label: 'Прогрес (за зростанням)' },
  ];
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Filter Bar — Projects Page"
        description="Точний filter slot головної сторінки проєктів, а не довільна toolbar-композиція."
        filePath="src/app/(app)/page.js"
        fullWidth
      >
        <PageHeader
          title="Проєкти"
          actions={<Button style="primary" color="dark" size="lg" icon={Plus}>Новий проєкт</Button>}
          filters={(
            <FilterBar context="projects">
              <Select filterRole="member" options={memberOptions} value={selectedMember} onChange={setSelectedMember} variant="ghost" />
              <Select filterRole="date" options={dateOptions} value={dateFilter} onChange={setDateFilter} variant="ghost" />
              <Select filterRole="sort" options={sortOptions} value={sortOption} onChange={setSortOption} variant="ghost" />
            </FilterBar>
          )}
        />
      </PreviewBlock>
    </div>
  );
}
