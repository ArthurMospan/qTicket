'use client';
import { PreviewBlock } from '../preview';

export default function TypographySection() {
  const types = [
    { tag: 'display', label: 'Display Title', size: '32px', weight: '700', cls: 'ui-type-display-title text-ink', note: 'Organization switcher hero' },
    { tag: 'metric', label: 'Metric Title', size: '28px', weight: '900', cls: 'ui-type-metric-title text-ink', note: 'Billing and large project card' },
    { tag: 'page', label: 'Page Title', size: '24px', weight: '700', cls: 'ui-type-page-title text-ink', note: 'Workspace primary title' },
    { tag: 'detail', label: 'Detail Title', size: '20px', weight: '700', cls: 'ui-type-detail-title text-ink', note: 'Detail and settings title' },
    { tag: 'section', label: 'Section Title', size: '18px', weight: '700', cls: 'ui-type-section-title text-ink', note: 'Section and sheet title' },
    { tag: 'feature', label: 'Feature Title', size: '17px', weight: '700', cls: 'ui-type-feature-title text-ink', note: 'Feature card title' },
    { tag: 'dialog', label: 'Dialog Title', size: '16px', weight: '700', cls: 'ui-type-dialog-title text-ink', note: 'Dialog chrome' },
    { tag: 'compact', label: 'Compact Title', size: '15px', weight: '700', cls: 'ui-type-compact-title text-ink', note: 'Dense panel title' },
    { tag: 'card', label: 'Card Title', size: '14px', weight: '700', cls: 'ui-type-card-title text-ink', note: 'Cards and detail sections' },
    { tag: 'item', label: 'Item Title', size: '12px', weight: '700', cls: 'ui-type-item-title text-ink', note: 'Rows and small groups' },
    { tag: 'micro', label: 'Micro Title', size: '11px', weight: '700', cls: 'ui-type-micro-title text-ink', note: 'Dense data panels' },
    { tag: 'eyebrow', label: 'Eyebrow', size: '11px', weight: '700', cls: 'ui-type-eyebrow', note: 'Uppercase section marker' },
  ];
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Named typography contexts" description="Ці semantic classes є живим джерелом typography для authenticated workspace і /ui-kit." fullWidth>
        <div className="flex flex-col gap-[20px]">
          {types.map(t => (
            <div key={t.tag} className="flex items-baseline gap-[24px] border-b border-[#f0f0f0] pb-[16px] last:border-0">
              <div className="w-[72px] shrink-0">
                <span className="text-[10px] font-mono font-bold text-[#9a9a9a] bg-[#f4f4f5] px-[8px] py-[3px] rounded-[6px]">{t.tag}</span>
              </div>
              <div className="flex-1">
                <div className={t.cls}>{t.label} — Швидка команда</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[11px] font-mono text-[#9a9a9a]">{t.size} / w{t.weight}</div>
                <div className="text-[10px] text-[#cfcfcf] mt-[2px] max-w-[180px]">{t.note}</div>
              </div>
            </div>
          ))}
        </div>
      </PreviewBlock>
    </div>
  );
}
