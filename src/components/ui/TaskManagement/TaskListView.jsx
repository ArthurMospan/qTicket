'use client';

import { useState } from 'react';
import { CheckSquare, ChevronDown, ChevronRight, ChevronUp, MoreVertical } from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import Button from '@/components/ui/Button';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { entryStatusId } from '@/lib/utils/statusCategories.mjs';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import Counter from '@/components/ui/DataDisplay/Counter';
import EmptyState from '@/components/ui/Feedback/EmptyState';
import Surface from '@/components/ui/Surface';
import TextAction from '@/components/ui/TextAction';
import TaskRow from './TaskRow';
import ContextMenu from '@/components/ui/ContextMenu';
import BulkActionBar from './BulkActionBar';
import { prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { useIssueSelection } from '@/lib/hooks/useIssueSelection';
import { compareIssues } from '@/lib/utils/optimistic.mjs';
import { assignableMembersFor } from '@/lib/utils/assignableMembers.mjs';

// How much of one section this view draws before it asks. The board answers the
// same question by virtualizing — a column keeps a viewport of cards in the DOM
// and every task stays inside the scroll range — but a section here is a block
// in a stacked page, not a scroller of its own, so there is no viewport to
// window against. It pages instead, the way `TaskListCard` does.
//
// Without a limit «Звернення» laid out every task a person has ever been
// given, in one go, each row scanning the whole set for its parent and its
// links. The count beside a section heading is always the whole section, so the
// number never disagrees with what is behind it.
const INITIAL_ROWS = 25;
const MORE_ROWS = 25;

/**
 * The list view of a board: tasks grouped by status — or, on a list that spans
 * projects, by the five shared status categories — with hidden groups folded into
 * one «Приховані» group at the end.
 *
 * @param {object[]} props.issues The tasks to show.
 * @param {object[]} props.allIssues Every task in scope, for resolving parents and links.
 * @param {object[]} props.members Workspace members, for avatars.
 * @param {object[]} props.labels Label definitions, for the chips.
 * @param {object[]} props.projects Projects, needed when the list spans more than one.
 * @param {object[]} props.issueLinks Relations between tasks.
 * @param {(a: object, b: object) => number} props.compareIssueCards Row order inside a section; the same comparator the board uses, so both views of one list agree on where a new task belongs.
 * @param {'status'|'category'} props.groupBy What a section is: one status, or one status category.
 * @param {string[]} props.hiddenGroupIds Groups folded into «Приховані» — status ids, or category ids under `groupBy="category"`.
 * @param {string} props.projectId Current project.
 * @param {string} props.projectName Its name, for the per-row project chip.
 * @param {boolean} props.showProjectName Whether each row names its project — true only on cross-project lists.
 * @param {boolean} props.showAssignee Whether the rows carry an assignee column at all. See `TaskRow`.
 * @param {'support'|'client'} props.assigneeSource Whose answer to «хто цим займається» the rows draw: support's routing, or the customer's own people. See `TaskRow`.
 * @param {(action: string, value: unknown, issues: object[]) => Promise<unknown>} props.onBulkUpdate Applies one bulk action to the selected rows.
 * @param {{done: number, total: number}} props.bulkProgress How far the running bulk action has got, for the toolbar to report.
 * @param {boolean} props.canArchive Whether the current role may archive selected tasks.
 * @param {string} props.selectionScopeKey Clears selection when a route or filter scope changes.
 * @param {string} props.emptyTitle Headline of the empty state.
 * @param {string} props.emptyDescription Sentence under it.
 */
export default function TaskListView({
  issues = [],
  allIssues = issues,
  issueLinks = [],
  members = [],
  labels = [],
  projects = [],
  projectId,
  projectName,
  showProjectName = false,
  showAssignee = true,
  assigneeSource = 'support',
  groupBy = 'status',
  compareIssueCards = compareIssues,
  hiddenGroupIds = [],
  onBulkUpdate,
  bulkProgress = null,
  canArchive = false,
  selectionScopeKey = '',
  emptyTitle = 'Звернень не знайдено',
  emptyDescription = 'Змініть фільтри або створіть нове звернення.',
}) {
  const { statuses, categoryColumns, statusCategoryById, priorities, types } = useWorkflowConfig();
  const [collapsedSections, setCollapsedSections] = useState([]);
  // Keyed by the scope, not reset by an effect: changing project, filter or
  // grouping makes this a different list, and a row budget carried across from
  // the previous one is a number about tasks that are no longer here.
  const [paging, setPaging] = useState({ scope: '', shown: {} });
  const toggleSection = sectionId => setCollapsedSections(current => (
    current.includes(sectionId)
      ? current.filter(id => id !== sectionId)
      : [...current, sectionId]
  ));
  const byCategory = groupBy === 'category';
  const entryStatus = entryStatusId(statuses);
  const statusIdForIssue = issue => issue.columnId || issue.status || entryStatus;
  // A section is a status, or — across projects, where one project's statuses
  // are not the other's — the category every task of every project has.
  const groups = byCategory ? categoryColumns : statuses;
  const groupIdForIssue = issue => (byCategory
    ? statusCategoryById.get(statusIdForIssue(issue)) || ''
    : statusIdForIssue(issue));
  // A section that gathers several statuses cannot name the status of its rows,
  // so the rows name it themselves — the same rule the board's cards follow.
  const multiStatusGroupIds = new Set();
  if (byCategory) {
    const counts = new Map();
    for (const category of statusCategoryById.values()) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    for (const [category, count] of counts) {
      if (count > 1) multiStatusGroupIds.add(category);
    }
  }
  // The list and the board are two views of one arrangement, so they sort the
  // same way. Without this the list kept whatever order the query happened to
  // return — on «Звернення» that was due date ascending, which put every
  // freshly created task at the very bottom.
  const sortSection = sectionIssues => [...sectionIssues].sort(compareIssueCards);
  const visibleSections = groups
    .filter(group => !hiddenGroupIds.includes(group.id))
    .map(group => ({
      ...group,
      showStatusName: multiStatusGroupIds.has(group.id),
      issues: sortSection(issues.filter(issue => groupIdForIssue(issue) === group.id)),
    }));
  const hiddenIssues = sortSection(issues.filter(issue => hiddenGroupIds.includes(groupIdForIssue(issue))));
  const sections = [
    ...visibleSections,
    ...(hiddenIssues.length > 0 ? [{
      id: '__hidden__',
      label: 'Приховані',
      color: 'var(--color-muted)',
      // This one always mixes statuses, whatever the grouping is.
      showStatusName: byCategory,
      issues: hiddenIssues,
    }] : []),
  ].filter(section => section.issues.length > 0);
  const selectionOrder = sections.flatMap(section => section.issues.map(issue => issue.id));
  const pagingScope = selectionScopeKey || `${projectId || 'cross-project'}:${groupBy}`;
  const rowsShownIn = sectionId => (
    paging.scope === pagingScope ? paging.shown[sectionId] : undefined
  ) ?? INITIAL_ROWS;
  const setRowsShownIn = (sectionId, rows) => setPaging(current => ({
    scope: pagingScope,
    shown: {
      ...(current.scope === pagingScope ? current.shown : {}),
      [sectionId]: rows,
    },
  }));
  const {
    active: selectionActive,
    activeSelectedIds: activeSelectedIssueIds,
    selectedIssues,
    toggle: toggleIssueSelection,
    toggleScope: toggleIssueScope,
    clear: clearSelection,
  } = useIssueSelection({
    issues,
    order: selectionOrder,
    scopeKey: selectionScopeKey || `${projectId || 'cross-project'}:${groupBy}`,
  });
  const toggleSectionSelection = sectionIssues => toggleIssueScope(
    sectionIssues.map(issue => issue.id),
  );
  const applyBulkAction = (action, value) => onBulkUpdate?.(
    action,
    action === 'status' ? { mode: byCategory ? 'category' : 'status', id: value } : value,
    selectedIssues,
  );

  if (issues.length === 0) {
    return (
      <Surface preset="panel" padding="md" className="w-full">
        <EmptyState
          icon={TaskIcon}
          title={emptyTitle}
          description={emptyDescription}
          context="page"
          surface="card"
        />
      </Surface>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {sections.map(section => {
        const isCollapsed = collapsedSections.includes(section.id);
        const shown = rowsShownIn(section.id);
        const drawnIssues = section.issues.slice(0, shown);
        const remaining = section.issues.length - drawnIssues.length;
        return (
          <Surface key={section.id} preset="panel" padding="lg" className="w-full">
            {/* No rule under the heading — the panel edge already separates the
                sections, and the collapse control mirrors the board column. */}
            <div
              className={`flex cursor-pointer select-none items-center gap-2 ${isCollapsed ? '' : 'mb-4'}`}
              onClick={() => toggleSection(section.id)}
              // A collapse control, so it says so and answers the keys a button
              // answers. Not a `<button>`: the section heading lives inside it,
              // and a heading is not something to bury in a control's label.
              role="button"
              tabIndex={0}
              aria-expanded={!isCollapsed}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                toggleSection(section.id);
              }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: section.color }} />
              <h3 className="ui-type-column-title uppercase tracking-wide text-ink">{section.label}</h3>
              <Counter value={section.issues.length} size="sm" appearance="subtle" className="ml-1" />
              {onBulkUpdate && section.id !== '__hidden__' && (
                <ContextMenu
                  className="ml-auto"
                  trigger={(
                    <Button
                      style="ghost"
                      size="icon-xs"
                      icon={MoreVertical}
                      composition="section-kebab"
                      className="hover:!bg-white"
                      aria-label={`Дії зі списком ${section.label}`}
                      title="Дії зі списком"
                    />
                  )}
                  items={[{
                    label: section.issues.every(issue => activeSelectedIssueIds.has(issue.id))
                      ? 'Зняти вибір у списку'
                      : 'Вибрати всі у списку',
                    icon: CheckSquare,
                    onClick: () => toggleSectionSelection(section.issues),
                  }]}
                />
              )}
              <Button
                style="ghost"
                size="icon-xs"
                icon={isCollapsed ? ChevronRight : ChevronDown}
                className={`${onBulkUpdate && section.id !== '__hidden__' ? '' : 'ml-auto'} hover:!bg-white`}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? 'Розгорнути' : 'Згорнути'}
                aria-label={`${isCollapsed ? 'Розгорнути' : 'Згорнути'} ${section.label}`}
              />
            </div>

            {!isCollapsed && (
            <div className="flex flex-col gap-2">
              {drawnIssues.map(issue => {
                const resolvedProject = projects.find(project => project.id === issue.projectId);
                const resolvedProjectId = issue.projectId || projectId;
                const resolvedProjectName = resolvedProject?.name || projectName;

                return (
                  <TaskRow
                    key={issue.id}
                    issue={issue}
                    issues={allIssues}
                    issueLinks={issueLinks}
                    members={members}
                    labels={labels}
                    projectId={resolvedProjectId}
                    projectName={resolvedProjectName}
                    showProjectName={showProjectName}
                    showStatusName={section.showStatusName}
                    showAssignee={showAssignee}
                    assigneeSource={assigneeSource}
                    selected={activeSelectedIssueIds.has(issue.id)}
                    selectionActive={selectionActive}
                    onSelect={onBulkUpdate ? toggleIssueSelection : undefined}
                  />
                );
              })}

              {(remaining > 0 || shown > INITIAL_ROWS) && (
                <div className="mt-1 flex justify-center border-t border-line pt-2">
                  {remaining > 0 ? (
                    <TextAction
                      tone="muted"
                      icon={ChevronDown}
                      onClick={() => setRowsShownIn(section.id, shown + MORE_ROWS)}
                    >
                      Показати ще {Math.min(MORE_ROWS, remaining)}
                    </TextAction>
                  ) : (
                    <TextAction
                      tone="muted"
                      icon={ChevronUp}
                      onClick={() => setRowsShownIn(section.id, INITIAL_ROWS)}
                    >
                      Згорнути
                    </TextAction>
                  )}
                </div>
              )}
            </div>
            )}
          </Surface>
        );
      })}
      <BulkActionBar
        count={onBulkUpdate ? activeSelectedIssueIds.size : 0}
        progress={bulkProgress}
        statusOptions={groups.map(group => ({
          value: group.id,
          label: group.label,
          dotColor: group.color,
        }))}
        /* Who this selection may be given to, not who exists — see
           `assignableMembersFor`. */
        memberOptions={assignableMembersFor({ members, issues: selectedIssues, projects }).map(member => ({
          value: member.id || member.uid,
          label: member.name || member.email || 'Учасник',
          user: member,
        }))}
        priorityOptions={prioritySelectOptions(priorities)}
        labelOptions={labels.map(label => ({ value: label.id, label: label.label, dotColor: label.color }))}
        typeOptions={types.filter(type => type.id !== 'epic').map(taskTypeSelectOption)}
        canArchive={canArchive}
        onApply={applyBulkAction}
        onClear={clearSelection}
      />
    </div>
  );
}
