'use client';

import { Hash } from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';

/**
 * The #issue autocomplete sheet used by workspace-chat composers.
 *
 * @param {object[]} props.issues Search results with issueKey/title/projectId.
 * @param {object[]} props.projects Visible projects, used only for their names.
 * @param {(issue: object) => void} props.onSelect Inserts the selected key.
 * @param {boolean} props.loading Whether the server search is in flight.
 * @param {string} props.className Placement in the composer.
 */
export default function IssueMentionMenu({
  issues = [],
  projects = [],
  onSelect,
  loading = false,
  className = '',
}) {
  if (!loading && issues.length === 0) return null;

  return (
    <div className={`max-h-[240px] overflow-y-auto overflow-x-hidden rounded-2xl border border-line bg-white shadow-xl [clip-path:inset(0_round_1rem)] ${className}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-white/95 px-4 py-2 backdrop-blur">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-muted">
          <Hash size={12} /> Згадати завдання
        </span>
        {loading ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-ink" />
        ) : (
          <span className="text-[10px] text-faint">{issues.length} знайдено</span>
        )}
      </div>
      {issues.slice(0, 8).map(issue => {
        const projectName = projects.find(project => project.id === issue.projectId)?.name;
        return (
          <button
            key={issue.id}
            type="button"
            onMouseDown={event => {
              event.preventDefault();
              onSelect?.(issue);
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-canvas focus-visible:bg-canvas focus-visible:outline-none"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-line bg-canvas text-muted">
              <TaskIcon size={15} />
            </span>
            <span className="min-w-0 flex-1">
              {/* The id in the kit's own monospace, the way it is set on a card
                  and in a table. It used to be an accent pill — the one place in
                  the product where magenta meant «this is a task». */}
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] font-bold text-muted">{issue.issueKey}</span>
                {projectName ? <span className="truncate text-[10px] text-faint">{projectName}</span> : null}
              </span>
              <span className="mt-0.5 block truncate text-[12px] font-semibold text-ink">
                {issue.title || 'Без назви'}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
