'use client';
import { useEffect, useRef } from 'react';
import { Lock } from 'lucide-react';
import { Tabs } from '@/components/ui';
import { canAccessStage, stageStatusMeta } from '@/lib/portal/qtplusStageModel.mjs';

const TONE_DOT = { muted: 'bg-faint', active: 'bg-ink', done: 'bg-success-solid' };

export default function StageStepper({ stages, activeId, onSelect }) {
  const scrollRef = useRef(null);

  // Автоскрол до активного кроку. Раніше тут був ref на кожну кнопку; тепер
  // смугу малює кітовий Tabs, тож активний елемент шукається за тим, чим він і
  // є для доступності — `aria-selected`. Ефект нічого не сетить, лише скролить.
  useEffect(() => {
    const box = scrollRef.current;
    const el = box?.querySelector('[role="tab"][aria-selected="true"]');
    if (!el || !box) return;
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [activeId]);

  const tabs = stages.map((stage) => {
    const meta = stageStatusMeta(stage.status);
    const accessible = canAccessStage(stage);
    return {
      id: stage.id,
      disabled: !accessible,
      title: accessible ? meta.label : 'Етап ще не розпочато',
      label: (
        <>
          <span className={`h-[6px] w-[6px] shrink-0 rounded-full ${TONE_DOT[meta.tone] || 'bg-faint'}`} />
          {stage.label || 'Без назви'}
          {!accessible && <Lock size={11} className="shrink-0" />}
        </>
      ),
    };
  });

  return (
    // Смуга рисує `Tabs` — своєю ж лінією знизу. Тут її дублювала друга
    // `border-b`, і активний етап підкреслювався ПОВЕРХ двох ліній замість
    // однієї. Обгортка тепер відповідає лише за горизонтальний скрол.
    <div ref={scrollRef} className="w-full overflow-x-auto">
      <Tabs variant="underline" tabs={tabs} activeTab={activeId} onTabChange={onSelect} />
    </div>
  );
}
