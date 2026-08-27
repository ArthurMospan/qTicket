'use client';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import { IconAction, Card, ListRow, PlanCards } from '@/components/ui';
import { useState } from 'react';
import { Edit2, Trash2, Settings, X, Zap, MoreVertical } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function SurfacesSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Панельна ієрархія (Layout Surfaces)" component="Surface" description="Головні будівельні блоки для контент-зони. Дотримуються правил вкладеності: сіра підкладка (Level 1) -> вкладені білі картки або сірі інсети (Level 2)." fullWidth>

        {/* Level 1: Gray Main Panel */}
        <Surface preset="panel" padding="lg" className="w-full">
          <div className="mb-[16px]">
            <span className="text-[10px] font-bold text-[#9a9a9a] uppercase tracking-wider bg-white border border-[#e9e9e9] px-[8px] py-[3px] rounded-[6px]">
              Level 1: Main Panel (#f4f4f5, rounded-[16px])
            </span>
            <p className="text-[12px] text-[#9a9a9a] mt-[8px]">Основна сіра контент-зона для розмежування логічних секцій або колонок.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
            {/* Level 2: White Card Surface */}
            <Surface preset="nested-card" padding="lg">
              <span className="text-[10px] font-bold text-[#6366f1] uppercase tracking-wider bg-[#6366f1]/8 border border-[#6366f1]/15 px-[8px] py-[3px] rounded-[6px]">
                Level 2: White Card (rounded-[12px])
              </span>
              <p className="text-[13px] text-[#1f1f1f] font-semibold mt-[12px]">Біла плаваюча картка</p>
              <p className="text-[12px] text-[#9a9a9a] mt-[4px]">Без рамки та без тіней. Чиста біла поверхня для розміщення окремих завдань, деталей або списків.</p>
            </Surface>

            <Surface preset="card" padding="md" className="flex flex-col">
              <span className="text-[10px] font-bold text-muted uppercase tracking-wider">
                Team page card (rounded-[16px])
              </span>
              <p className="mt-[12px] text-[13px] font-semibold text-ink">Біла продуктова поверхня</p>
              <p className="mt-[4px] text-[12px] text-muted">Другий реально використаний Surface-варіант.</p>
            </Surface>
          </div>

        </Surface>
      </PreviewBlock>

      <PreviewBlock title="Card variants" component="Card" description="Живий Card, який використовується на сторінках аналітики, налаштувань, інтеграцій та порталу." fullWidth>
        <div className="grid w-full grid-cols-1 gap-[16px] md:grid-cols-2">
          <Card preset="bordered" padding="lg">
            <p className="text-[13px] font-bold text-ink">White card</p>
            <p className="mt-[4px] text-[12px] text-muted">Стандартна продуктова картка з border-line.</p>
          </Card>
          <Card preset="borderless" padding="lg">
            <p className="text-[13px] font-bold text-ink">Borderless white card</p>
            <p className="mt-[4px] text-[12px] text-muted">Найпоширеніший фактичний варіант у Settings та Analytics.</p>
          </Card>
          <Card preset="bordered-compact" padding="none">
            <p className="px-[16px] pt-[16px] text-[13px] font-bold text-ink">Bordered compact (rounded-[12px])</p>
            <p className="px-[16px] pb-[16px] pt-[4px] text-[12px] text-muted">Той самий бордер на меншому радіусі — для карток, що стоять сіткою серед собі подібних, як матеріали QuickTeam+.</p>
          </Card>
          <Card preset="bordered" padding="lg" interactive onClick={() => {}}>
            <p className="text-[13px] font-bold text-ink">Interactive card</p>
            <p className="mt-[4px] text-[12px] text-muted">З onClick картка стає справжньою кнопкою — фокус, Enter, доступне ім’я — і додає ховер.</p>
          </Card>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Рядок списку"
        component="ListRow"
        description="Рядок у списку з роздільниками: без рамки, без радіуса, без заливки в спокої. Роздільники малює список, рядок малює лише те, що стається під курсором. Розкладка лишається на місці виклику — один із двох це flex зі стрілкою в кінці, другий сітка на шість колонок; кіт володіє тим, що рядок списку це справжня кнопка з однією шкалою висоти й одним наведенням."
        filePath="src/components/ui/Layout/ListRow.jsx"
        fullWidth
      >
        <div className="w-full max-w-[420px] overflow-hidden rounded-[12px] border border-line bg-white">
          <div className="divide-y divide-[#f0f0f0]">
            <ListRow density="compact" className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">QT-104 · Зворотний звʼязок</span>
              <span className="font-mono text-[10px] text-faint">compact</span>
            </ListRow>
            <ListRow density="compact" className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-ink">QT-118 · Експорт у CSV</span>
              <span className="font-mono text-[10px] text-faint">compact</span>
            </ListRow>
            <ListRow density="roomy" className="flex items-center justify-between">
              <span className="text-[13px] font-bold text-ink">Артур Моспан</span>
              <span className="font-mono text-[10px] text-faint">roomy</span>
            </ListRow>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Outline danger — Profile emergency call" description="Єдиний фактичний outline-варіант на сайті." filePath="src/components/profile/ProfileView.jsx">
        <Button
          style="outline"
          color="red"
          size="lg"
          icon={Zap}
          className="!bg-red-50 hover:!bg-red-100 !border !border-[#ef4444]"
        >
          Виклик
        </Button>
      </PreviewBlock>

      <PreviewBlock
        title="IconAction — neutral compact actions" component="IconAction"
        description="Живе semantic family для close/edit/more/download та інших нейтральних icon-actions. Geometry і appearance названі, тому product та /ui-kit використовують один контракт."
        filePath="src/components/ui/IconAction.jsx"
        fullWidth
      >
        <div className="flex flex-wrap items-center gap-3">
          <IconAction label="Редагувати" icon={Edit2} size="xs" appearance="quiet" />
          <IconAction label="Налаштування" icon={Settings} size="sm" appearance="soft" />
          <IconAction label="Більше" icon={MoreVertical} size="md" appearance="surface" />
          <IconAction label="Закрити" icon={X} size="md" appearance="surface-plain" />
          <IconAction label="Видалити" icon={Trash2} size="sm" appearance="surface-danger" />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="PlanCards — прайслист" component="PlanCards"
        description="Один прайслист на весь продукт: його показує і онбординг, і «Тарифний план» у налаштуваннях. Плани — дані з plans.mjs, картка нічого про них не вирішує. Смуги картки вирівняні через grid-rows-subgrid, тому ціни й кнопки стоять на одній лінії незалежно від довжини тексту."
        filePath="src/components/ui/DataDisplay/PlanCards.jsx"
        fullWidth
      >
        <PlanCardsPreview />
      </PreviewBlock>
    </div>
  );
}

// Стан вибору живе тут, бо прайслист сам його не тримає: екран каже, який тариф
// уже обрано, і що робити, коли натиснули інший.
function PlanCardsPreview() {
  const [plan, setPlan] = useState('lite');
  return (
    <PlanCards activePlanId={plan} activeLabel="Обрано" onChoose={setPlan} />
  );
}
