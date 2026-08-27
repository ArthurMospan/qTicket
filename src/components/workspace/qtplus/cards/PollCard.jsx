'use client';
import { BarChart3 } from 'lucide-react';

/** READ-ONLY. Голосувати не можна: vote = запис у портал = наступний зріз. */
export default function PollCard({ view }) {
  const { total, results } = view.poll;

  return (
    <div data-ui-surface="local" className="rounded-[12px] border border-line bg-surface flex flex-col overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 border-b border-line">
        <div className="w-7 h-7 rounded-[8px] bg-canvas flex items-center justify-center shrink-0">
          <BarChart3 size={14} className="text-muted" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-ink font-medium truncate">{view.title}</p>
          <p className="text-[11px] text-muted">{total} {total === 1 ? 'голос' : total >= 2 && total <= 4 ? 'голоси' : 'голосів'}</p>
        </div>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2">
        {results.map((r, i) => (
          <div key={`${i}-${r.option}`} className="text-[12px]">
            <div className="flex justify-between gap-2">
              <span className="text-ink truncate">{r.option}</span>
              <span className="text-muted shrink-0">{r.percent}%</span>
            </div>
            <div className="mt-[3px] h-[4px] rounded-full bg-canvas overflow-hidden">
              <div className="h-full bg-ink rounded-full" style={{ width: `${r.percent}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
