'use client';
import { colors as designColors, sizing, spacing } from '@/lib/design/tokens';
import { PreviewBlock, TokenChip } from '../preview';

export default function TokensSection() {
  const colors = [
    { label: 'Dark (Primary)', value: designColors.dark },
    { label: 'Pill Dark (hover)', value: designColors.hover.dark },
    { label: 'Canvas / Element', value: designColors.light },
    { label: 'Surface', value: designColors.surface },
    { label: 'Border', value: designColors.border.primary },
    { label: 'Border Secondary', value: designColors.border.secondary },
    { label: 'Border Light', value: designColors.border.light },
    { label: 'Text Muted', value: designColors.text.muted },
    { label: 'Text Inactive', value: designColors.text.inactive },
    { label: 'Success', value: designColors.status.success },
    { label: 'Warning', value: designColors.status.warning },
    { label: 'Danger', value: designColors.status.danger },
    { label: 'Info / Indigo', value: designColors.status.info },
    { label: 'Cyan', value: designColors.status.cyan },
    { label: 'Orange', value: designColors.status.error },
    { label: 'Purple', value: designColors.status.purple },
  ];
  const sizes = [
    { label: 'Button lg (CTA, default)', value: sizing.button.lg },
    { label: 'Button md (action)', value: sizing.button.md },
    { label: 'Button sm (compact)', value: sizing.button.sm },
    { label: 'Input sm', value: sizing.input.sm },
    { label: 'Input md', value: sizing.input.md },
    { label: 'Input lg / Select / Tabs', value: sizing.input.lg },
    { label: 'L0: Global / Modal radius', value: `${sizing.radius.max} (rounded-[24px])` },
    { label: 'L1: Panel / Card radius', value: `${sizing.radius.full} (rounded-[16px])` },
    { label: 'L2: Inset Surface radius', value: `${sizing.radius.xl} (rounded-[12px])` },
    { label: 'L2.5: Button / Input radius', value: `${sizing.radius.lg} (rounded-[10px])` },
    { label: 'L3: Small accent radius', value: `${sizing.radius.md} (rounded-[8px])` },
    { label: 'L4: Badge / Tag radius', value: '6px (rounded-[6px])' },
    { label: 'Page horizontal padding', value: spacing.pagePadding },
    { label: 'Page title → content gap', value: spacing.sectionGap },
    { label: 'Max content width', value: '1400px' },
    { label: 'Sidebar width', value: '220px' },
  ];
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Color Palette" description="Живі значення з /src/lib/design/tokens.js; зміна джерела автоматично оновлює цю таблицю." fullWidth>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-[8px]">
          {colors.map(t => <TokenChip key={t.label} {...t} isColor />)}
        </div>
      </PreviewBlock>
      <PreviewBlock title="Sizing & Spacing" description="Strict rules — never use arbitrary values outside these." fullWidth>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-[8px]">
          {sizes.map(t => <TokenChip key={t.label} {...t} />)}
        </div>
      </PreviewBlock>
      <div className="bg-[#f4f4f5] rounded-[16px] p-6 border border-[#e9e9e9]/50 flex flex-col gap-3">
        <h4 className="text-[14px] font-bold text-[#1f1f1f]">Принцип концентричних кутів (Concentric Corners Rule)</h4>
        <p className="text-[12px] text-[#9a9a9a] leading-relaxed">
          Для збереження геометричної гармонії та уникнення візуального спотворення кутів, внутрішні скруглення деталей мають бути меншими за зовнішні скруглення їх контейнерів відповідно до формули:
          <span className="block font-mono bg-[#f0f0f0] rounded-[6px] px-3 py-1.5 text-[11px] text-[#1f1f1f] mt-1.5 w-fit">R_inner = R_outer - Padding</span>
        </p>
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-bold text-[#1f1f1f] w-[140px]">L0 (Глобальний) [24px]</span>
            <span className="text-[#9a9a9a]">Основний робочий екран, overlay діалогові модалки</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-bold text-[#1f1f1f] w-[140px]">L1 (Панелі/Картки) [16px]</span>
            <span className="text-[#9a9a9a]">Головні сірі панелі, білі плаваючі картки</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-bold text-[#1f1f1f] w-[140px]">L2 (Вкладені) [12px]</span>
            <span className="text-[#9a9a9a]">Внутрішні інсет-панелі, випадаючі списки dropdown</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-bold text-[#1f1f1f] w-[140px]">L2.5 (Форми) [10px]</span>
            <span className="text-[#9a9a9a]">Кнопки (всіх розмірів), текстові поля (input, textarea)</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-bold text-[#1f1f1f] w-[140px]">L3 (Акценти) [8px]</span>
            <span className="text-[#9a9a9a]">Елементи всередині кнопок, фільтри, дрібні кнопки</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-bold text-[#1f1f1f] w-[140px]">L4 (Деталі) [6px]</span>
            <span className="text-[#9a9a9a]">StatusBadge, PriorityBadge, Tag-чіпи, Counter-каунтери</span>
          </div>
        </div>
      </div>
    </div>
  );
}
