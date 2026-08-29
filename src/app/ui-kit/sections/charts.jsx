'use client';
import { AlertTriangle, BarChart2, TrendingDown } from 'lucide-react';
import { KpiCard, Sparkline } from '@/components/ui';
import { PreviewBlock } from '../preview';

// What is left of the reporting vocabulary after qTicket stopped reporting:
// the headline figure a screen opens with, and the glyph that shows the shape
// of the week behind it. The bars, meters and tables that only ever drew
// analytics went with the screens that drew them.
export default function ChartsSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Показник"
        description="Заголовна цифра екрана: значення, що воно рахує, як змінилось і якої форми була ця зміна. Цифра — пропорційні знаки, не табличні: у tabular кожна цифра завширшки з нуль, і на цьому кеглі «121» виглядає розтягнутим. Сірий чіп іконки не темізується — коли кожна картка обирала власний відтінок, ряд із чотирьох читався як чотири незв’язані віджети."
        filePath="src/components/ui/DataDisplay/KpiCard.jsx"
        component="KpiCard"
        fullWidth
      >
        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard icon={BarChart2} value="18 / 46" label="Звернення в роботі" sub="39% виконано" />
          <KpiCard
            icon={TrendingDown}
            value={18}
            label="Закрито за 30 днів"
            trend={24}
            series={[2, 5, 3, 7, 4, 6, 9, 8, 11, 9, 14, 18]}
            sub="проти попереднього періоду"
          />
          <KpiCard icon={AlertTriangle} value={3} label="Прострочено" sub="потребують уваги" />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Спарклайн"
        description="Форма нещодавньої історії, розміром зі слово. Без осей, підписів і тултипа — це гліф, а не графік: значення несе цифра над ним, а деталі — графік, на який картка веде."
        filePath="src/components/ui/Charts/Sparkline.jsx"
        component="Sparkline"
      >
        <div className="flex items-center gap-4">
          <Sparkline values={[2, 5, 3, 7, 4, 6, 9, 8, 11, 9, 14, 18]} />
          <Sparkline values={[18, 14, 15, 9, 11, 8, 9, 6, 4, 3, 5, 2]} />
        </div>
      </PreviewBlock>

    </div>
  );
}
