'use client';
import { KpiCard } from '@/components/ui';
import { Zap, Clock, Users, Target } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function ProgressSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="KPI Cards" description="Живі KpiCard з аналітики, velocity та workload." fullWidth>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          <KpiCard label="Всі завдання" value="89 / 124" sub="71% прогресу" icon={Target} trend={12} />
          <KpiCard label="Velocity (7д)" value="14" sub="завдань за тиждень" icon={Zap} trend={-5} />
          <KpiCard label="Зафіксовано часу" value="45г 30хв" sub="по 4 проєктах" icon={Clock} />
          <KpiCard label="Команда" value="8" sub="учасників із завданнями" icon={Users} />
        </div>
      </PreviewBlock>
    </div>
  );
}
