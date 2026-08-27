'use client';
import { ListChecks, Check } from 'lucide-react';

/** READ-ONLY. Пункти не клікаються: toggle = запис у портал = наступний зріз. */
export default function ChecklistCard({ view }) {
  const { items, checkedItems, done, total, percent } = view.checklist;

  return (
    <div data-ui-surface="local" className="rounded-[12px] border border-line bg-surface flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-line">
        <div className="w-7 h-7 rounded-[8px] bg-canvas flex items-center justify-center shrink-0">
          <ListChecks size={14} className="text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink font-medium truncate">{view.title}</p>
          <p className="text-[11px] text-muted">{done}/{total} виконано</p>
        </div>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2">
        <div className="h-[4px] bg-canvas rounded-full overflow-hidden">
          <div className="h-full bg-ink rounded-full" style={{ width: `${percent}%` }} />
        </div>
        <ul className="flex flex-col gap-1.5">
          {items.map((item, i) => {
            const checked = checkedItems.includes(i);
            const text = typeof item === 'string' ? item : item?.text || '';
            return (
              <li key={`${i}-${text}`} className="flex items-center gap-2 text-[12px]">
                <span className={`w-[15px] h-[15px] rounded-[4px] border flex items-center justify-center shrink-0 ${checked ? 'bg-ink border-ink' : 'border-line'}`}>
                  {checked && <Check size={10} className="text-white" strokeWidth={3} />}
                </span>
                <span className={checked ? 'text-muted line-through' : 'text-ink'}>{text}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
