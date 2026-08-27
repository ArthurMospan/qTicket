'use client';
import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import Button from '@/components/ui/Button';
import Pill from '@/components/ui/DataDisplay/Pill';
import { ListRow } from '@/components/ui';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';

export default function SearchModal({ isOpen, results, loading, query, onClose, projects }) {
  const router = useRouter();
  const { types } = useWorkflowConfig();

  // Add click-outside listener to close the dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e) => {
      // If clicking inside the search input or the dropdown itself, do nothing
      // We assume the dropdown has id="search-dropdown" and input is elsewhere
      const isDropdown = e.target.closest('#search-dropdown');
      const isInput = e.target.closest('input[type="text"]');
      if (!isDropdown && !isInput) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleResultClick = issue => {
    const project = projects?.find(candidate => candidate.id === issue.projectId);
    router.push(issuePath(issue, project || issue.projectId));
    onClose();
  };

  return (
    <div id="search-dropdown" className="absolute top-[calc(100%+8px)] left-[8px] right-[8px] sm:left-[16px] sm:right-auto z-50 flex items-start">
      <div data-ui-surface="local" className="bg-white rounded-[16px] shadow-[0_8px_40px_rgba(0,0,0,0.12)] border border-line w-full sm:w-[480px] max-h-[480px] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-line shrink-0 bg-canvas">
          <div>
            <h2 className="ui-type-item-title text-ink">Результати пошуку</h2>
            {query && <p className="text-[11px] text-muted mt-[2px]">Запит: «{query}»</p>}
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-[28px] h-[28px] border-[3px] border-line border-t-ink rounded-full animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-[24px] text-center">
              <div className="text-[48px] mb-[12px]">🔍</div>
              <p className="text-[14px] font-bold text-ink">
                {query ? 'Нічого не знайдено' : 'Почніть вводити для пошуку'}
              </p>
              <p className="text-[12px] text-muted mt-[4px]">
                {query
                  ? `За запитом "${query}" результатів не знайдено`
                  : 'Шукайте по ID, назві або описанню завдання'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {results.map(issue => {
                const type = types.find(item => item.id === issue.type)
                  || types.find(item => item.id === 'task')
                  || { id: issue.type || 'task', color: '#9a9a9a' };
                const TypeIcon = taskTypeIcon(type);
                const project = projects?.find(p => p.id === issue.projectId);

                return (
                  <ListRow
                    key={issue.id}
                    density="compact"
                    onClick={() => handleResultClick(issue)}
                    className="flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-4">
                      {/* Left: Type Icon */}
                      <div data-ui-surface="local" className="w-5 h-5 flex items-center justify-center rounded-[6px] shrink-0 bg-white border border-line shadow-sm">
                        <TypeIcon size={12} style={{ color: type.color }} />
                      </div>

                      {/* Content: ID + Title */}
                      <div className="flex items-baseline gap-2 min-w-0 flex-1">
                        <code className="text-[11px] font-semibold text-muted shrink-0">
                          {issue.issueKey || 'Без ID'}
                        </code>
                        {/* The row is a `ListRow` and fills to `canvas` under
                            the pointer. An underline on the title as well is
                            the same fact said twice. */}
                        <span className="text-[13px] font-semibold text-ink truncate transition-colors">
                          {issue.title}
                        </span>
                      </div>
                    </div>

                    {/* Right: Project badge + Assignees */}
                    <div className="flex items-center gap-3 shrink-0">
                      {issue.assigneeIds?.length > 0 && (
                        <div className="flex -space-x-1">
                          {issue.assigneeIds.slice(0, 2).map(uid => (
                            <div
                              key={uid}
                              className="w-[18px] h-[18px] rounded-full bg-line ring-2 ring-white flex items-center justify-center text-[7px] font-bold text-muted"
                            >
                              {uid.slice(0, 1).toUpperCase()}
                            </div>
                          ))}
                        </div>
                      )}
                      {project && (
                        <Pill tone="neutral" size="sm" weight="medium">
                          {project.name}
                        </Pill>
                      )}
                    </div>
                  </ListRow>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
