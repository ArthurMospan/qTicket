'use client';
import { KpiCard } from '@/components/ui';
import { MessageCircleReply, Clock, Users, Target } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function ProgressSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="KPI Cards" description="Живі KpiCard з черги звернень — ті самі чотири, що на «Огляді»." fullWidth>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full">
          <KpiCard label="Усі звернення" value="89 / 124" sub="71% прогресу" icon={Target} trend={12} />
          <KpiCard label="Чекають на нас" value="14" sub="клієнт написав останнім" icon={MessageCircleReply} trend={-5} />
          <KpiCard label="У роботі" value="23" sub="по 4 клієнтах" icon={Clock} />
          <KpiCard label="Команда" value="8" sub="учасників зі зверненнями" icon={Users} />
        </div>
      </PreviewBlock>
    </div>
  );
}
