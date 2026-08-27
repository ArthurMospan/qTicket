'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import IssueCard from '@/components/workspace/IssueCard';

/**
 * Chooses the exact project status after a card was dropped on a shared
 * category in «Мої завдання». The choices deliberately reuse the board-column
 * composition so this feels like finishing the drag, not learning a new UI.
 *
 * @param {boolean} props.isOpen Whether the dialog is visible.
 * @param {object} props.issue Task being moved.
 * @param {object} props.project Project that owns the task and its statuses.
 * @param {object[]} props.statuses Exact status columns available at the destination.
 * @param {string} props.categoryLabel Shared category selected on the personal board.
 * @param {object[]} props.issues Tasks available for parent/child context on the card.
 * @param {object[]} props.issueLinks Links used to show whether the task is blocked.
 * @param {object[]} props.members Organization members shown on the task card.
 * @param {object[]} props.labels Organization labels shown on the task card.
 * @param {object[]} props.sprints Organization sprints shown on the task card.
 * @param {(statusId: string) => void} props.onSelect Confirms the exact destination status.
 * @param {() => void} props.onClose Cancels the pending move.
 * @param {boolean} props.busy Whether the status update is being saved.
 */
export default function StatusTransitionPicker({
  isOpen,
  issue,
  project,
  statuses = [],
  categoryLabel = '',
  issues = [],
  issueLinks = [],
  members = [],
  labels = [],
  sprints = [],
  onSelect,
  onClose,
  busy = false,
}) {
  const radioGroupName = useId();
  const activeColumnRef = useRef(null);
  const [activeStatusId, setActiveStatusId] = useState(statuses[0]?.id || '');
  const reduceMotion = useReducedMotion();

  const activeStatus = statuses.find(status => status.id === activeStatusId) || statuses[0];
  const issueKey = issue?.issueKey || 'Інцидент';

  useEffect(() => {
    if (!isOpen || !activeStatusId) return undefined;
    const frame = requestAnimationFrame(() => {
      activeColumnRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeStatusId, isOpen, reduceMotion]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={busy ? undefined : onClose}
      presentation="dialog"
      titleContext="dialog"
      title={`Куди перемістити ${issueKey}?`}
      description={`У категорії «${categoryLabel}» кілька статусів — оберіть потрібний.`}
      size="lg"
      bodyPadding="flush"
      footer={(
        <>
          <Button style="secondary" size="md" disabled={busy} onClick={onClose}>
            Скасувати
          </Button>
          <Button
            style="primary"
            size="md"
            loading={busy}
            disabled={!activeStatus}
            onClick={() => activeStatus && onSelect?.(activeStatus.id)}
          >
            Перенести в «{activeStatus?.label || 'статус'}»
          </Button>
        </>
      )}
    >
      <div className="px-5 py-5 sm:px-6">
        <div
          className="hide-scrollbar flex snap-x gap-3 overflow-x-auto"
          role="radiogroup"
          aria-label="Статус призначення"
        >
          {statuses.map(status => {
            const active = status.id === activeStatus?.id;
            const color = status.color || '#9a9a9a';

            return (
              <label
                key={status.id}
                ref={active ? activeColumnRef : undefined}
                className={`flex w-[220px] shrink-0 snap-center sm:w-[224px] ${busy ? 'cursor-wait' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name={radioGroupName}
                  value={status.id}
                  checked={active}
                  disabled={busy}
                  onChange={() => setActiveStatusId(status.id)}
                  className="peer sr-only"
                />
                <div className={`group flex min-h-[280px] w-full flex-col overflow-hidden rounded-[16px] border-2 bg-canvas text-left transition-[background-color,border-color] peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-ink/30 peer-disabled:opacity-60 ${
                  active ? 'border-ink' : 'border-transparent hover:bg-line'
                }`}>
                  <span className="flex w-full items-center justify-between px-4 pb-3 pt-4">
                    <span className="flex min-w-0 items-center gap-[6px]">
                      <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ background: color }} />
                      <span className="ui-type-column-title truncate uppercase tracking-wide text-ink">
                        {status.label}
                      </span>
                    </span>
                    {active ? <Check size={14} className="shrink-0 text-ink" /> : null}
                  </span>

                  <span className="flex flex-1 flex-col p-[8px] pt-0">
                    {active ? (
                      <motion.div
                        layoutId="status-transition-task"
                        initial={reduceMotion ? false : { opacity: 0, y: 12, rotate: -1.5 }}
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 430, damping: 30 }}
                        className="block rounded-[16px] shadow-[0_4px_14px_rgba(0,0,0,0.08)]"
                      >
                        <IssueCard
                          issue={{ ...issue, columnId: status.id, status: status.id }}
                          issues={issues}
                          allIssues={issues}
                          issueLinks={issueLinks}
                          members={members}
                          labels={labels}
                          sprints={sprints}
                          projectId={issue?.projectId || project?.id}
                          projectName={project?.name}
                          showProjectName
                          interactive={false}
                          className="w-full"
                        />
                      </motion.div>
                    ) : null}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
