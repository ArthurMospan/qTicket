'use client';
import { useEffect, useState } from 'react';
import { usePortalStages } from '@/lib/portal/usePortalStages';
import { usePortalStageMaterials } from '@/lib/portal/usePortalStageMaterials';
import { stageProgress, defaultStageId, canAccessStage } from '@/lib/portal/qtplusStageModel.mjs';
import StageStepper from './StageStepper';
import MaterialGrid from './MaterialGrid';
import MediaLightbox from './MediaLightbox';

function Spinner() {
  return <div className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-ink" />;
}

function StageMaterials({ stageId, onOpen }) {
  const { materials, loading, error } = usePortalStageMaterials(stageId);

  if (loading) return <div className="py-4"><Spinner /></div>;
  if (error) {
    return (
      <p className="py-4 text-[13px] text-muted">
        {error === 'no_access'
          ? 'Немає доступу до матеріалів.'
          : 'Не вдалося завантажити матеріали. Спробуйте пізніше.'}
      </p>
    );
  }
  if (materials.length === 0) return <p className="py-4 text-[13px] text-muted">У цьому етапі ще немає матеріалів.</p>;
  return <MaterialGrid materials={materials} onOpen={onOpen} />;
}

/**
 * Етапи проєкту QuickTeam+ і матеріали обраного етапу.
 *
 * Шапка приходить згори, але малюється тут, бо тільки тут відомий прогрес: він
 * стоїть біля назви проєкту, а не окремим рядком під смугою етапів. Тому `header`
 * може бути функцією — їй передається готовий вузол прогресу.
 */
export default function QtPlusStagesView({ qtProjectId, header = null }) {
  const { stages, loading, error } = usePortalStages(qtProjectId);
  // undefined = ще не рахували; null = порахували, доступного етапу немає (усі todo)
  const [selectedId, setSelectedId] = useState(undefined);
  const [lightbox, setLightbox] = useState(null);

  // Рахуємо етап за замовчуванням, поки поточний вибір недійсний: на першому
  // завантаженні або якщо обраний етап зник із живого оновлення. Чинний вибір
  // користувача не чіпаємо — саме тому перевіряємо наявність етапу в списку, а
  // не окремий прапорець. queueMicrotask — синхронний setState у тілі ефекту тут
  // є помилкою лінта (react-hooks/set-state-in-effect), патерн з useProjects.js.
  useEffect(() => {
    if (!stages.length) return;
    if (selectedId && stages.some((s) => s.id === selectedId)) return;
    queueMicrotask(() => setSelectedId(defaultStageId(stages)));
  }, [stages, selectedId]);

  const hasStages = !loading && !error && stages.length > 0;
  const { done, total, percent } = hasStages ? stageProgress(stages) : { done: 0, total: 0, percent: 0 };
  const selected = hasStages ? stages.find((s) => s.id === selectedId) || null : null;

  const progress = hasStages ? (
    <span className="shrink-0 text-[12px] text-muted" title={`Завершено ${done} з ${total} етапів`}>
      Прогрес: {percent}% ({done}/{total})
    </span>
  ) : null;

  const headerNode = typeof header === 'function' ? header(progress) : header;

  let body;
  if (loading) {
    body = <div className="py-4"><Spinner /></div>;
  } else if (error) {
    body = (
      <p className="py-4 text-[13px] text-muted">
        {error === 'no_access'
          ? 'Немає доступу до цього проєкту QuickTeam+ вашим акаунтом.'
          : 'Не вдалося завантажити етапи. Спробуйте пізніше.'}
      </p>
    );
  } else if (stages.length === 0) {
    body = <p className="py-4 text-[13px] text-muted">Ще немає етапів.</p>;
  } else if (selectedId === undefined) {
    body = <div className="py-4"><Spinner /></div>;
  } else if (!selected) {
    body = <p className="py-4 text-[13px] text-muted">Роботу над проєктом ще не розпочато.</p>;
  } else if (!canAccessStage(selected)) {
    body = <p className="py-4 text-[13px] text-muted">Етап ще не розпочато.</p>;
  } else {
    body = <StageMaterials stageId={selected.id} onOpen={setLightbox} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {headerNode && <div className="px-4 pb-3 pt-4">{headerNode}</div>}
      {hasStages && <StageStepper stages={stages} activeId={selectedId} onSelect={setSelectedId} />}
      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">{body}</div>

      <MediaLightbox view={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
