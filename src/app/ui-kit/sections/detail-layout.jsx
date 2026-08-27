'use client';
import { Link2, MapPin, Paperclip, Users } from 'lucide-react';
import { AlignLeft } from 'lucide-react';
import { DetailLayout, DetailSection, Pill, UserAvatar } from '@/components/ui';
import { TaskIcon } from '@/lib/design/icons';
import { PreviewBlock } from '../preview';

// A task and a calendar event are the same page. They had stopped behaving like
// it, and every difference was an accident of the two files being written months
// apart rather than a decision anybody made:
//
//   • the task reserved the fixed header's 56px above its scroll container, the
//     event on it. Padding on a scroller sits inside the scrollport, so the
//     event's `sticky top-0` title parked itself *under* the fixed header;
//   • the task ran edge to edge, the event centred on 1120px;
//   • the task stopped the page scrolling above 1024px and scrolled its left
//     column instead — a second scroll model for the same gesture;
//   • the task kept its attribute strip pinned with the title, the event let it
//     scroll away, so the same row of controls behaved two ways;
//   • four spellings of two heading levels across the two pages.
//
// `DetailLayout` owns all of it now, and `CONTEXTS` is the whole list of what is
// still allowed to differ: how wide the measure is, and whether there is a rail.
export default function DetailLayoutSection() {
  const demoUser = { id: 'kit-arthur', name: 'Артур Моспан' };

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="DetailLayout context=&quot;event&quot;"
        description="Одна колонка на 1120px. Заголовок і смуга атрибутів липнуть до верху разом, під фіксованим хедером — не під ним самим, як було. Сторінка скролиться цілком."
        filePath="src/components/ui/Layout/DetailLayout.jsx"
        component="DetailLayout"
        fullWidth
      >
        <div className="h-[320px] overflow-hidden rounded-[12px] border border-line bg-white">
          <DetailLayout
            context="event"
            standalone={false}
            header={(
              <div className="pb-[12px] pt-[12px]">
                <h1 className="ui-type-page-title leading-tight tracking-tight text-ink">Планерка команди</h1>
                <p className="mt-1 text-[12px] font-medium text-muted">Організатор: Артур Моспан · створили сьогодні</p>
              </div>
            )}
            attributes={(
              <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-canvas px-3 py-2">
                <Pill tone="neutral" size="md">14:00–15:00</Pill>
                <Pill tone="neutral" size="md">Мітинг</Pill>
                <Pill tone="neutral" size="md">Уся команда</Pill>
              </div>
            )}
          >
            <DetailSection icon={AlignLeft} title="Опис">
              <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface text-[13px] leading-relaxed text-ink">
                Порядок денний, рішення й наступні кроки.
              </div>
            </DetailSection>
            <DetailSection icon={MapPin} title="Місце">
              <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface text-[13px] text-ink">
                Кімната 2
              </div>
            </DetailSection>
            <DetailSection icon={Users} title="Учасники" count={2}>
              <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface flex flex-wrap gap-2">
                <Pill tone="surface-ink" size="lg" weight="medium">
                  <UserAvatar user={demoUser} size="xs" />
                  <span className="font-semibold">Артур Моспан</span>
                </Pill>
              </div>
            </DetailSection>
          </DetailLayout>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="DetailLayout context=&quot;task&quot;"
        description="Та сама колонка плюс рейка розмови праворуч — 1520px разом, тобто текст задачі стоїть рівно там, де текст події. Рейка липка й заввишки як сам скролпорт, тому вона стоїть на місці й гортає себе, а не сторінку."
        filePath="src/components/ui/Layout/DetailLayout.jsx"
        component="DetailLayout"
        fullWidth
      >
        <div className="h-[320px] overflow-hidden rounded-[12px] border border-line bg-white">
          <DetailLayout
            context="task"
            standalone={false}
            header={(
              <div className="pb-[12px] pt-[12px]">
                <h1 className="ui-type-page-title leading-tight tracking-tight text-ink">Переробити онбординг</h1>
                <p className="mt-1 text-[12px] font-medium text-muted">Автор: Артур Моспан · оновили щойно</p>
              </div>
            )}
            attributes={(
              <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-canvas px-3 py-2">
                <Pill tone="neutral" size="md">У роботі</Pill>
                <Pill tone="neutral" size="md">Артур</Pill>
                <Pill tone="neutral" size="md">Спринт 12</Pill>
              </div>
            )}
            aside={(
              <div className="flex h-full flex-col items-center justify-center rounded-[16px] bg-canvas text-[11px] font-semibold text-muted">
                Чат задачі
              </div>
            )}
          >
            <DetailSection icon={AlignLeft} title="Опис">
              <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface flex flex-col gap-4">
                <p className="text-[13px] leading-relaxed text-ink">Перший екран лишаємо, другий переробляємо.</p>
                <DetailSection density="group" icon={Paperclip} title="Вкладення" count={2}>
                  <p className="text-[12px] text-muted">Список файлів</p>
                </DetailSection>
                <DetailSection density="group" icon={TaskIcon} title="Підзавдання" count={3} meta="1/3 · 2 ще в роботі">
                  <p className="text-[12px] text-muted">Рядки підзавдань</p>
                </DetailSection>
                <DetailSection density="group" icon={Link2} title="Зв’язки" count={1}>
                  <p className="text-[12px] text-muted">Рядки зв’язків</p>
                </DetailSection>
              </div>
            </DetailSection>
          </DetailLayout>
        </div>
      </PreviewBlock>
    </div>
  );
}
