'use client';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import { IconAction, Card, DetailSection, ListRow } from '@/components/ui';
import { ArrowRight, Edit2, Trash2, Settings, X, Zap, MoreVertical } from 'lucide-react';
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
              <p className="text-[12px] text-[#9a9a9a] mt-[4px]">Без рамки та без тіней. Чиста біла поверхня для розміщення окремих звернень, деталей або списків.</p>
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
        description="Дві форми, бо в продукті справді дві. `divided` — рядок усередині однієї білої картки, розділювачі малює список, а рядок лише те, що стається під курсором: результат пошуку, канал підтримки, тобто те, що читається як один блок. `card` — рядок як власна плитка з рамкою, радіусом і кільцем при наведенні: те саме, що вже малюють `TaskRow` й `ActivityRow`, і потрібне там, де сам рядок є об’єктом — «Учасники» проєкту, «Проєкти» на «Огляді». Без onClick рядок інертний: не кнопка, не в табі, без ховера."
        filePath="src/components/ui/Layout/ListRow.jsx"
        fullWidth
      >
        <div className="flex w-full flex-col gap-[20px] sm:flex-row">
          <div className="w-full max-w-[420px] overflow-hidden rounded-[12px] border border-line bg-white">
            <div className="divide-y divide-[#f0f0f0]">
              <ListRow density="compact" onClick={() => {}} className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">QT-104 · Зворотний звʼязок</span>
                <span className="font-mono text-[10px] text-faint">divided · compact</span>
              </ListRow>
              <ListRow density="compact" onClick={() => {}} className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">QT-118 · Експорт у CSV</span>
                <span className="font-mono text-[10px] text-faint">divided · compact</span>
              </ListRow>
              <ListRow density="roomy" className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink">Артур Моспан</span>
                <span className="font-mono text-[10px] text-faint">divided · інертний</span>
              </ListRow>
            </div>
          </div>

          {/* On the grey panel these are read on, because a white tile with a
              hairline edge on white says nothing. */}
          <Surface preset="panel" padding="md" className="w-full max-w-[420px]">
            <div className="flex flex-col gap-2">
              <ListRow shape="card" density="roomy" onClick={() => {}} className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink">Acme Corp</span>
                <span className="font-mono text-[10px] text-faint">card · roomy</span>
              </ListRow>
              <ListRow shape="card" density="roomy" onClick={() => {}} className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink">Northwind</span>
                <span className="font-mono text-[10px] text-faint">card · roomy</span>
              </ListRow>
              <ListRow shape="card" density="compact" className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-ink">Артур Моспан</span>
                <span className="font-mono text-[10px] text-faint">card · інертний</span>
              </ListRow>
            </div>
          </Surface>
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
        title="DetailSection density=panel — шапка панелі"
        component="DetailSection"
        description="Заголовок панелі: назва, рядок під нею і єдина дія праворуч. Саме цей блок «Огляд» і проєкт писали руками чотири рази — тепер це третя щільність того самого компонента, поряд із section та group."
        filePath="src/components/ui/Layout/DetailSection.jsx"
        fullWidth
      >
        <div className="grid w-full gap-4 xl:grid-cols-2">
          <Surface preset="panel" padding="md">
            <DetailSection
              density="panel"
              title="Нещодавно оновлені"
              description="Останні зміни у зверненнях усіх доступних клієнтів."
              action={<Button style="secondary" size="md" icon={ArrowRight}>Вся черга</Button>}
            >
              <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                <ListRow density="roomy" className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Не приходить лист про оплату</span>
                  <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
                </ListRow>
                <ListRow density="roomy" className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Помилка 500 у звіті за березень</span>
                  <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
                </ListRow>
              </Card>
            </DetailSection>
          </Surface>

          {/* Без дії та без опису — та сама щільність, коли панель нічого не
              пояснює й нічого не пропонує зробити. */}
          <Surface preset="panel" padding="md">
            <DetailSection
              density="panel"
              title="Команда підтримки"
              description="Внутрішні працівники, закріплені за цим проєктом."
            >
              <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                <ListRow density="roomy" className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Олена Коваль</span>
                </ListRow>
                <ListRow density="roomy" className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-ink">Дмитро Петренко</span>
                </ListRow>
              </Card>
            </DetailSection>
          </Surface>
        </div>
      </PreviewBlock>

    </div>
  );
}
