'use client';
import Button from '@/components/ui/Button';
import { Plus, Edit2, Trash2, Archive, Settings, ExternalLink } from 'lucide-react';
import { MediaPlayButton } from '@/components/ui';
import { PreviewBlock } from '../preview';

export default function ButtonsSection() {
  return (
    <div className="flex flex-col gap-[40px]">

      {/* ─── Primary Buttons ─── */}
      <PreviewBlock title="Primary Buttons" component="Button" description="Головні дії. Кольори: фон #1f1f1f (hover #303030), текст #ffffff. Небезпечна дія (danger, color=red): фон #ef4444. Скруглення (border-radius): 10px для всіх розмірів. Висота: Large 36px, Medium 32px, Small 28px." fullWidth>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#f0f0f0]">
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[240px]">Стан / Конфігурація</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[220px]">Large — 36px (lg)</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[220px]">Medium — 32px (md)</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider">Small — 28px (sm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f5]">
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Default (Текст)</td>
                <td className="py-4"><Button style="primary" size="lg">Зберегти</Button></td>
                <td className="py-4"><Button style="primary" size="md">Зберегти</Button></td>
                <td className="py-4"><Button style="primary" size="sm">Зберегти</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">З іконкою</td>
                <td className="py-4"><Button style="primary" size="lg" icon={Plus}>Новий проєкт</Button></td>
                <td className="py-4"><Button style="primary" size="md" icon={Plus}>Новий проєкт</Button></td>
                <td className="py-4"><Button style="primary" size="sm" icon={Plus}>Додати</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Завантаження (loading)</td>
                <td className="py-4"><Button style="primary" size="lg" loading>Збереження...</Button></td>
                <td className="py-4"><Button style="primary" size="md" loading>Збереження...</Button></td>
                <td className="py-4"><Button style="primary" size="sm" loading>Збереження...</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Вимкнено (disabled)</td>
                <td className="py-4"><Button style="primary" size="lg" disabled>Недоступно</Button></td>
                <td className="py-4"><Button style="primary" size="md" disabled>Недоступно</Button></td>
                <td className="py-4"><Button style="primary" size="sm" disabled>Недоступно</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Небезпечна дія (danger, color=red)</td>
                <td className="py-4"><Button style="primary" color="red" size="lg" icon={Trash2}>Видалити проєкт</Button></td>
                <td className="py-4"><Button style="primary" color="red" size="md" icon={Trash2}>Видалити</Button></td>
                <td className="py-4"><Button style="primary" color="red" size="sm" icon={Trash2}>Видалити</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </PreviewBlock>

      {/* ─── Secondary Buttons ─── */}
      <PreviewBlock title="Secondary Buttons" description="Другорядні дії. Кольори: фон #f5f5f5 (hover #ebebeb), текст #1f1f1f. Небезпечна дія (danger, color=red): фон #f5f5f5, текст #ef4444. Скруглення: 10px для всіх розмірів. Висота: Large 36px, Medium 32px, Small 28px." fullWidth>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#f0f0f0]">
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[240px]">Стан / Конфігурація</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[220px]">Large — 36px (lg)</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[220px]">Medium — 32px (md)</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider">Small — 28px (sm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f5]">
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Default (Текст)</td>
                <td className="py-4"><Button style="secondary" size="lg">Скасувати</Button></td>
                <td className="py-4"><Button style="secondary" size="md">Скасувати</Button></td>
                <td className="py-4"><Button style="secondary" size="sm">Скасувати</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">З іконкою</td>
                <td className="py-4"><Button style="secondary" size="lg" icon={Archive}>Архівувати</Button></td>
                <td className="py-4"><Button style="secondary" size="md" icon={Archive}>Архівувати</Button></td>
                <td className="py-4"><Button style="secondary" size="sm" icon={Plus}>Додати</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Завантаження (loading)</td>
                <td className="py-4"><Button style="secondary" size="lg" loading>Завантаження...</Button></td>
                <td className="py-4"><Button style="secondary" size="md" loading>Завантаження...</Button></td>
                <td className="py-4"><Button style="secondary" size="sm" loading>Завантаження...</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Вимкнено (disabled)</td>
                <td className="py-4"><Button style="secondary" size="lg" disabled>Недоступно</Button></td>
                <td className="py-4"><Button style="secondary" size="md" disabled>Недоступно</Button></td>
                <td className="py-4"><Button style="secondary" size="sm" disabled>Недоступно</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Небезпечна дія (danger, color=red)</td>
                <td className="py-4"><Button style="secondary" color="red" size="lg" icon={Trash2}>Видалити проєкт</Button></td>
                <td className="py-4"><Button style="secondary" color="red" size="md" icon={Trash2}>Видалити</Button></td>
                <td className="py-4"><Button style="secondary" color="red" size="sm" icon={Trash2}>Видалити</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </PreviewBlock>

      {/* ─── Ghost Buttons ─── */}
      <PreviewBlock title="Ghost Buttons" description="Безмежові прозорі дії. Кольори: фон transparent (hover #f0f0f0), текст #9a9a9a (hover #1f1f1f). Небезпечна дія (danger, color=red): текст #ef4444. Скруглення: 10px для всіх розмірів. Висота: Large 36px, Medium 32px, Small 28px." fullWidth>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#f0f0f0]">
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[240px]">Стан / Конфігурація</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[220px]">Large — 36px (lg)</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider w-[220px]">Medium — 32px (md)</th>
                <th className="pb-3 text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider">Small — 28px (sm)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f4f4f5]">
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Default (Текст)</td>
                <td className="py-4"><Button style="ghost" size="lg">Детальніше</Button></td>
                <td className="py-4"><Button style="ghost" size="md">Детальніше</Button></td>
                <td className="py-4"><Button style="ghost" size="sm">Детальніше</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">З іконкою</td>
                <td className="py-4"><Button style="ghost" size="lg" icon={ExternalLink}>Відкрити</Button></td>
                <td className="py-4"><Button style="ghost" size="md" icon={ExternalLink}>Відкрити</Button></td>
                <td className="py-4"><Button style="ghost" size="sm" icon={ExternalLink}>Відкрити</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Завантаження (loading)</td>
                <td className="py-4"><Button style="ghost" size="lg" loading>Завантаження...</Button></td>
                <td className="py-4"><Button style="ghost" size="md" loading>Завантаження...</Button></td>
                <td className="py-4"><Button style="ghost" size="sm" loading>Завантаження...</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Вимкнено (disabled)</td>
                <td className="py-4"><Button style="ghost" size="lg" disabled>Недоступно</Button></td>
                <td className="py-4"><Button style="ghost" size="md" disabled>Недоступно</Button></td>
                <td className="py-4"><Button style="ghost" size="sm" disabled>Недоступно</Button></td>
              </tr>
              <tr className="align-middle">
                <td className="py-4 text-[13px] font-semibold text-[#1f1f1f]">Небезпечна дія (danger, color=red)</td>
                <td className="py-4"><Button style="ghost" color="red" size="lg" icon={Trash2}>Видалити</Button></td>
                <td className="py-4"><Button style="ghost" color="red" size="md" icon={Trash2}>Видалити</Button></td>
                <td className="py-4"><Button style="ghost" color="red" size="sm" icon={Trash2}>Видалити</Button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </PreviewBlock>

      {/* ─── Icon-Only Buttons ─── */}
      <PreviewBlock
        title="Адаптивний подвійний підпис"
        description="IssueDetail тримає в children два span-и: короткий на мобільному, повний на десктопі. Це не те саме, що collapseAt — той ховає підпис цілком, а тут підпис саме змінюється. Затверджено як канон. Звузь вікно, щоб побачити перемикання."
        filePath="src/components/workspace/IssueDetail.jsx"
        fullWidth
      >
        <div className="flex flex-wrap items-center gap-[8px]">
          <Button aria-label="Додати підзавдання" style="secondary" size="sm" composition="inline-add-action" icon={Plus}>
            <span className="sm:hidden">Підзавдання</span><span className="hidden sm:inline">Додати підзавдання</span>
          </Button>
          <Button aria-label="Додати зв’язок" style="secondary" size="sm" composition="inline-add-action" icon={Plus}>
            <span className="sm:hidden">Зв’язок</span><span className="hidden sm:inline">Додати зв’язок</span>
          </Button>
          <Button aria-label="Додати мітку" style="secondary" size="sm" composition="inline-add-action" icon={Plus}>
            <span className="sm:hidden">Мітка</span><span className="hidden sm:inline">Додати мітку</span>
          </Button>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Icon-Only Buttons" description="Кнопки без тексту. Текст всередині приховано через sr-only для доступності. Скруглення: 10px для всіх розмірів. Розміри: Large 36×36px (icon-lg), Medium 32×32px (icon), Small 28×28px (icon-sm).">
        <div className="flex flex-col gap-[20px] w-full">
          <div>
            <h4 className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[8px]">Large — 36×36px (icon-lg)</h4>
            <div className="flex items-center gap-[8px]">
              <Button style="primary" size="icon-lg" icon={Plus}>Додати</Button>
              <Button style="secondary" size="icon-lg" icon={Edit2}>Редагувати</Button>
              <Button style="ghost" size="icon-lg" icon={Settings}>Налаштування</Button>
              <Button style="secondary" color="red" size="icon-lg" icon={Trash2}>Видалити</Button>
            </div>
          </div>
          <div>
            <h4 className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[8px]">Medium — 32×32px (icon)</h4>
            <div className="flex items-center gap-[8px]">
              <Button style="primary" size="icon" icon={Plus}>Додати</Button>
              <Button style="secondary" size="icon" icon={Edit2}>Редагувати</Button>
              <Button style="ghost" size="icon" icon={Settings}>Налаштування</Button>
              <Button style="secondary" color="red" size="icon" icon={Trash2}>Видалити</Button>
            </div>
          </div>
          <div>
            <h4 className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[8px]">Small — 28×28px (icon-sm)</h4>
            <div className="flex items-center gap-[8px]">
              <Button style="primary" size="icon-sm" icon={Plus}>Додати</Button>
              <Button style="secondary" size="icon-sm" icon={Edit2}>Редагувати</Button>
              <Button style="ghost" size="icon-sm" icon={Settings}>Налаштування</Button>
              <Button style="secondary" color="red" size="icon-sm" icon={Trash2}>Видалити</Button>
            </div>
          </div>
        </div>
      </PreviewBlock>
      <PreviewBlock
        title="Кнопка відтворення"
        component="MediaPlayButton"
        description="Play і pause аудіо-картки. Свідомо не IconAction: іконки тут залиті, а не контурні, і колір лишається ink на canvas замість muted. Порожній сірий трикутник не читається як «натисни, щоб послухати» — саме тому це окремий елемент, а не ще один розмір спільної іконкової шкали. Трикутник оптично не по центру власної коробки, тому play зсунутий на 2px праворуч, а pause ні."
        filePath="src/components/ui/MediaPlayButton.jsx"
      >
        <div className="flex items-end gap-[20px]">
          {[[false, false, 'play'], [true, false, 'pause'], [false, true, 'disabled']].map(([playing, disabled, role]) => (
            <div key={role} className="flex flex-col items-center gap-[6px]">
              <MediaPlayButton playing={playing} disabled={disabled} />
              <span className="text-[9px] text-[#cfcfcf]">{role}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>
    </div>
  );
}
