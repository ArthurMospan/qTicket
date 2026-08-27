'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import Card from '@/components/ui/Layout/Card';
import DetailSection from '@/components/ui/Layout/DetailSection';
import TextAction from '@/components/ui/TextAction';
import TaskRow from './TaskRow';
import useWorkspaceStore from '@/store/useWorkspaceStore';

// How much of a list a card shows before it asks. Not props: a card that could
// be told to show 5 here and 50 there is a decision back at the call sites,
// which is where every other inconsistency on these screens came from.
//
// Ten is what fits on a screen next to the block beside it. Twenty is the step
// after that, because somebody who asked for more is no longer skimming.
const INITIAL_ROWS = 10;
const MORE_ROWS = 20;

/**
 * A titled card holding a flat list of tasks — "Прострочені", "Поточний фокус",
 * "Нещодавно закриті". The rows are `TaskRow`, so a task looks and behaves the
 * same wherever it is listed: same key, badges, assignees, overdue marker, and
 * the same click through to the task.
 *
 * Analytics used to draw three different lists of tasks. Overview had TaskRows;
 * the team pages had a priority dot with a subtitle line; "нещодавно закриті"
 * had a title, a cycle time and a pill, and could not be clicked at all. Unlike
 * `TaskListView`, this one does not group by status: the caller has already
 * decided what the list is.
 *
 * @param {string} props.title Caption above the list.
 * @param {React.ComponentType} props.icon Leading glyph on the caption.
 * @param {string} props.iconClassName Colour for that glyph, where it carries meaning.
 * @param {number} props.count Shown next to the title; defaults to the number of tasks.
 * @param {object[]} props.issues The tasks to list.
 * @param {object[]} props.allIssues Every task in scope, for parents and blockers.
 * @param {object[]} props.members Workspace members, for avatars.
 * @param {object[]} props.labels Label definitions, for the chips.
 * @param {object[]} props.sprints Sprint definitions.
 * @param {object[]} props.projects Projects, for naming each row's project.
 * @param {object[]} props.issueLinks Relations, for the blocked marker.
 * @param {boolean} props.showProjectName Whether each row names its project — true on cross-project lists.
 * @param {string} props.emptyText Sentence shown when there is nothing to list.
 * @param {React.ReactNode} props.action Optional control on the right of the caption.
 * @param {React.ReactNode} props.back The way out of a drilled-in list; it leads the caption.
 * @param {string} props.className Placement in the parent only.
 */
export default function TaskListCard({
  title,
  icon: Icon,
  iconClassName = 'text-muted',
  count,
  issues = [],
  allIssues,
  members = [],
  labels = [],
  sprints = [],
  projects = [],
  issueLinks = [],
  showProjectName = true,
  emptyText = 'Інцидентів немає',
  action,
  back,
  className = '',
}) {
  const openIssueQuickView = useWorkspaceStore(state => state.openIssueQuickView);
  const total = typeof count === 'number' ? count : issues.length;

  // The card used to draw every row it was handed, on the reasoning that a
  // number you cannot get to the rows behind is worse than a long list. The
  // reasoning is right and the conclusion was not: a member's «Усі» is every
  // task they have ever been given, and a thousand of them is not a report —
  // it is a page nobody reaches the bottom of, built out of a thousand rows the
  // browser has to lay out before it can draw the block underneath.
  //
  // The answer is the same one the board reached: show a screenful, and keep a
  // way to the rest. The count beside the title is always the whole set, so the
  // number never disagrees with what is behind it.
  const [shown, setShown] = useState(INITIAL_ROWS);
  const visible = issues.slice(0, shown);
  const remaining = issues.length - visible.length;
  const expanded = shown > INITIAL_ROWS;

  return (
    <Card preset="borderless" padding="lg" className={className}>
      {/* The same heading every other block on the screen has. This card used to
          carry a fourth spelling of it — an eyebrow with the count in
          parentheses — which is why a page of these read as a page of
          unrelated widgets. */}
      <DetailSection
        icon={Icon}
        title={title}
        count={total}
        action={action ? <span className="ml-auto shrink-0">{action}</span> : null}
        back={back}
      >
        {issues.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-faint">{emptyText}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map(issue => {
              const project = projects.find(item => item.id === issue.projectId);
              return (
                <TaskRow
                  key={issue.id}
                  issue={issue}
                  issues={issues}
                  allIssues={allIssues}
                  issueLinks={issueLinks}
                  members={members}
                  labels={labels}
                  sprints={sprints}
                  projectId={issue.projectId}
                  projectName={project?.name}
                  showProjectName={showProjectName}
                  // A report is a place you read from, not a place you leave.
                  // Every list of tasks in analytics and on a profile is this
                  // card, so one handler here covers all of them.
                  onClick={() => openIssueQuickView(issue)}
                />
              );
            })}

            {(remaining > 0 || expanded) && (
              <div className="mt-1 flex justify-center border-t border-[color:var(--color-chart-grid)] pt-2">
                {remaining > 0 ? (
                  <TextAction
                    tone="muted"
                    icon={ChevronDown}
                    onClick={() => setShown(value => value + MORE_ROWS)}
                  >
                    Показати ще {Math.min(MORE_ROWS, remaining)}
                  </TextAction>
                ) : (
                  <TextAction
                    tone="muted"
                    icon={ChevronUp}
                    onClick={() => setShown(INITIAL_ROWS)}
                  >
                    Згорнути
                  </TextAction>
                )}
              </div>
            )}
          </div>
        )}
      </DetailSection>
    </Card>
  );
}
