'use client';
// src/app/workspace/my/page.js — My Tasks: Global Kanban Board & Sprints
import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import { useAllMyTasks } from '@/lib/hooks/useAllMyTasks';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useSprints } from '@/lib/hooks/useSprints';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import AgileBoard from '@/components/workspace/AgileBoard';
import CreateTaskModal from '@/components/CreateTaskModal';
import { Alert, PageHeader, StatusTransitionPicker, StatusVisibilityPicker, TaskListView } from '@/components/ui';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import { Plus, Settings2, List, Kanban } from 'lucide-react';
import { Select, MultiSelect } from '@/components/ui/Select';
import Tabs from '@/components/ui/Tabs';
import LoadingSpinner from '@/components/ui/Feedback/LoadingSpinner';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Layout/Card';
import Surface from '@/components/ui/Surface';
import FilterBar from '@/components/ui/FilterBar';
import Dialog from '@/components/ui/Dialog';
import { createIssueViaApi, notifyIssueAssigned } from '@/lib/services/issues';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import {
  availableStatusesInCategory,
  resolveCategoryStatusId,
  statusCategoryLabel,
  statusCategoryOf,
} from '@/lib/utils/statusCategories.mjs';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { useBulkIssueActions } from '@/lib/hooks/useBulkIssueActions';
import { can, canWhileRoleLoads } from '@/lib/utils/can';
import { useViewState } from '@/lib/hooks/useViewState';
import { MY_TASKS_VIEW_SCHEMA } from '@/lib/utils/viewState.mjs';
import { useIsMobile } from '@/lib/hooks/useIsMobile';



function filterTasks(tasks, filters, sprintMap) {
  const { projects, priority, type, sprint } = filters;

  return tasks.filter(t => {
    if (projects && projects.length > 0 && !projects.includes(t.projectId)) return false;
    if (priority !== 'all' && (t.priority || NO_PRIORITY_ID) !== priority) return false;
    if (type !== 'all' && t.type !== type) return false;
    if (sprint !== 'all') {
      if (sprint === 'none') {
        if (t.sprintId) return false;
      } else if (sprint === 'active') {
        const s = sprintMap[t.sprintId];
        if (!s || s.status !== 'active') return false;
      } else {
        if (t.sprintId !== sprint) return false;
      }
    }
    return true;
  });
}

export default function MyTasksPage() {
  const { currentUser, projects, activeOrgId, orgRole } = useAppContext();
  const { members } = useOrganization();
  const { labels, types, priorities, statuses, categoryColumns } = useWorkflowConfig();
  const uid = currentUser?.uid || currentUser?.id;
  const hiddenCategoriesStorageKey = `qt:my-tasks:hidden-categories:${uid || 'anonymous'}:${activeOrgId || 'none'}`;
  const {
    tasks: sourceTasks,
    allIssues,
    issueLinks,
    loading,
    error: tasksError,
    moveTask,
    moveTaskToCategory,
    compareTaskCards,
  } = useAllMyTasks(uid);
  const {
    sprints,
    loading: sprintsLoading,
    error: sprintsError,
  } = useSprints();
  const showToast = useWorkspaceStore(s => s.showToast);
  const resolveBulkStatusId = useCallback((issue, value) => {
    if (value?.mode !== 'category') return value?.id || null;
    const issueProject = (projects || []).find(project => project.id === issue.projectId);
    return resolveCategoryStatusId(value.id, statuses, {
      currentStatusId: issue.columnId || issue.status,
      hiddenStatusIds: issueProject?.hiddenColumns || [],
    });
  }, [projects, statuses]);
  const { issues: tasks, applyBulkAction, bulkProgress } = useBulkIssueActions({
    issues: sourceTasks,
    organizationId: activeOrgId,
    showToast,
    resolveStatusId: resolveBulkStatusId,
  });
  const myTaskSearch = useWorkspaceStore(s => s.myTaskSearch);

  // Filters and the kanban/list choice live in the address. `assignee` is not
  // one of them: this screen already carries that parameter for the composer.
  const [filters, setFilters] = useViewState(MY_TASKS_VIEW_SCHEMA, {
    storageKey: `qt:view:${activeOrgId}:my-tasks`,
  });
  const savedViewMode = filters.view;
  const setViewMode = useCallback(value => setFilters({ view: value }), [setFilters]);
  // Below md the switcher is gone and so is the list: a list of tasks is a
  // board with the columns taken out, and the board is the one of the two that
  // was built for a narrow screen.
  //
  // Read, never written. Somebody who chose «Список» on a laptop would
  // otherwise have that choice overwritten by a phone that cannot show it, and
  // come back to the laptop to find the board.
  const isMobile = useIsMobile();
  const viewMode = isMobile === true ? 'kanban' : savedViewMode;
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  // ?new=1 is how anything outside this page asks for the composer — today the
  // command palette. Derived rather than copied into state on mount: the URL is
  // already the state, and mirroring it means two sources that can disagree.
  const router = useRouter();
  const searchParams = useSearchParams();
  const composerRequestedByUrl = searchParams.get('new') === '1';
  // A member profile can ask for the composer with that member already on it.
  const requestedAssignee = searchParams.get('assignee') || '';
  const composerAssignees = useMemo(
    () => (requestedAssignee ? [requestedAssignee] : (uid ? [uid] : [])),
    [requestedAssignee, uid],
  );
  const composerOpen = showCreateTaskModal || composerRequestedByUrl;
  const closeComposer = () => {
    setShowCreateTaskModal(false);
    setCreateTaskCategory(null);
    if (!composerRequestedByUrl) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('new');
    next.delete('assignee');
    router.replace(next.size ? `/my?${next}` : '/my', { scroll: false });
  };
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [createTaskCategory, setCreateTaskCategory] = useState(null);
  const [pendingStatusMove, setPendingStatusMove] = useState(null);
  // This board's columns are the five shared status categories, so what a person
  // folds away here is a category too. Kept under its own key: the old value held
  // status ids, which mean nothing to these columns.
  const [hiddenCategories, setHiddenCategories] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return JSON.parse(localStorage.getItem(hiddenCategoriesStorageKey)) || []; } catch(e){}
    }
    return [];
  });

  const updateHiddenCategories = (next) => {
    // A board with every column folded away shows nothing but the «Приховані»
    // lane, and there is no control on it to get back — the picker is the only
    // way in, so the last visible column cannot be the one you fold.
    if (categoryColumns.length > 0 && next.length >= categoryColumns.length) {
      showToast('Хоча б одна колонка має лишатися видимою', 'error');
      return;
    }
    setHiddenCategories(next);
    localStorage.setItem(hiddenCategoriesStorageKey, JSON.stringify(next));
  };

  // A drop names a category, and the task takes a status of that category from
  // its own project — which is why no column of this board can be "missing" from
  // a project, and why the drop cannot be refused by settings the person
  // dropping the card may not even be able to see.
  const commitMove = async ({ issueId, categoryId, position }, statusId = null) => {
    try {
      const actor = {
        userId: uid,
        userName: currentUser?.name || '',
      };
      let result;
      if (statusId) {
        result = await moveTask(issueId, statusId, categoryId, position, actor);
      } else {
        result = await moveTaskToCategory(issueId, categoryId, position, actor);
      }
      if (result?.statusChanged) {
        const selectedStatus = statuses.find(status => status.id === result.statusId)?.label;
        showToast(selectedStatus ? `Перенесено в «${selectedStatus}»` : 'Статус оновлено');
      }
      return true;
    } catch (err) {
      console.error(err);
      showToast(
        `Не вдалося перемістити інцидент — зміни не збережено${err?.message ? `: ${err.message}` : ''}`,
        'error',
      );
      return false;
    }
  };

  const handleMoveIssue = async (issueId, categoryId, position) => {
    const issue = tasks.find(item => item.id === issueId);
    const project = (projects || []).find(item => item.id === issue?.projectId);
    const currentStatusId = issue?.columnId || issue?.status || null;
    const movingAcrossCategories = statusCategoryOf(currentStatusId, statuses) !== categoryId;
    const candidates = availableStatusesInCategory(categoryId, statuses, {
      hiddenStatusIds: Array.isArray(project?.hiddenColumns) ? project.hiddenColumns : [],
    });

    if (issue && project && movingAcrossCategories && candidates.length > 1) {
      setPendingStatusMove({
        issueId,
        categoryId,
        position,
        issue,
        project,
        candidates,
        busy: false,
      });
      return;
    }

    await commitMove({ issueId, categoryId, position });
  };

  const selectPendingStatus = async statusId => {
    if (!pendingStatusMove || pendingStatusMove.busy) return;
    const move = pendingStatusMove;
    setPendingStatusMove(current => current ? { ...current, busy: true } : current);
    const saved = await commitMove(move, statusId);
    if (saved) setPendingStatusMove(null);
    else setPendingStatusMove(current => current ? { ...current, busy: false } : current);
  };

  const handleBulkUpdate = async (action, value, selectedIssues) => {
    await applyBulkAction(action, value, selectedIssues);
  };

  // Group sprints by status
  const sprintMap = (sprints || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {});

  const normalizedSearch = myTaskSearch.trim().toLowerCase();
  const filtered = filterTasks(tasks, filters, sprintMap).filter(t => {
    const p = projects.find(proj => proj.id === t.projectId);
    if (!p || p.status === 'archived') return false;
    if (!normalizedSearch) return true;
    return [t.issueKey, t.title, t.description, p.name]
      .some(value => String(value || '').toLowerCase().includes(normalizedSearch));
  });
  const selectionScopeKey = [
    activeOrgId,
    myTaskSearch,
    filters.projects.join(','),
    filters.priority,
    filters.type,
    filters.sprint,
    hiddenCategories.join(','),
  ].join('|');
  usePublishLocalSearchResults(myTaskSearch, filtered.length);


  // Одне питання на три екрани: відмова в доступі, вичерпана квота й обрив
  // мережі — це три різні речі, і всі три казали «перевірте зʼєднання».
  const dataFailure = workspaceDataFailureCopy(tasksError || sprintsError, isQuotaRefused());
  return (
    <div className={`flex-1 h-full bg-transparent ${viewMode === 'kanban' ? 'overflow-hidden' : 'qt-nav-scroll overflow-y-auto overflow-x-hidden hide-scrollbar'}`}>
      <div className={`workspace-page-layout ${viewMode === 'kanban' ? 'h-full pb-0' : 'min-h-full pb-[120px]'}`}>
        <PageHeader
          title="Мої інциденти"
          actions={
            <div className="flex gap-2">
              <Button
                onClick={() => { setCreateTaskCategory(null); setShowCreateTaskModal(true); }}
                icon={Plus}
                size="lg"
                style="primary"
                color="dark"
                collapseAt="sm"
                title="Створити інцидент"
              >
                Створити інцидент
              </Button>
            </div>
          }
          filters={
            <div className="flex items-center justify-between w-full">
              <FilterBar>
                <MultiSelect
                  variant="ghost"
                  value={filters.projects}
                onChange={(val) => setFilters({ projects: val })}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="Всі проєкти"
                searchPlaceholder="Пошук проєкту..."
                filterRole="project"
              />
              <Select
                filterRole="priority"
                variant="ghost"
                value={filters.priority}
                onChange={(val) => setFilters({ priority: val })}
                options={[
                  { value: 'all', label: 'Всі пріоритети' },
                  ...prioritySelectOptions(priorities),
                ]}
              />
              <Select
                filterRole="type"
                variant="ghost"
                value={filters.type}
                onChange={(val) => setFilters({ type: val })}
                options={[
                  { value: 'all', label: 'Всі типи' },
                  ...types.map(taskTypeSelectOption),
                ]}
              />
              <Select
                filterRole="sprint"
                variant="ghost"
                value={filters.sprint}
                onChange={(val) => setFilters({ sprint: val })}
                options={[
                  { value: 'all', label: 'Всі спринти' },
                  { value: 'active', label: 'Тільки активні' },
                  { value: 'none', label: 'Без спринта' },
                  ...(sprints || []).map(s => ({ value: s.id, label: s.name }))
                ]}
              />
            </FilterBar>

            {/* Десктопний хвіст рядка. Нижче md ця група не їде у шторку
                фільтрів: там вона висіла збоку, наполовину за екраном. */}
            <div className="flex items-center gap-2 ml-auto max-md:hidden">
              <Button
                onClick={() => setShowSettingsModal(true)}
                icon={Settings2}
                size="icon-lg"
                style="secondary"
                title="Налаштування видимості колонок"
              />
              {/* Тільки десктоп: нижче md вигляд один. */}
              <div className="max-md:hidden">
                <Tabs
                  tabs={[
                    { id: 'kanban', icon: Kanban, title: 'Дошка', ariaLabel: 'Дошка' },
                    { id: 'list', icon: List, title: 'Список', ariaLabel: 'Список' },
                  ]}
                  activeTab={savedViewMode}
                  onTabChange={setViewMode}
                />
              </div>
            </div>

            {/* Та сама дія на телефоні — на всю ширину під фільтрами у шторці,
                з підписом: іконка сама по собі там нічого не пояснювала. */}
            <Button
              onClick={() => setShowSettingsModal(true)}
              icon={Settings2}
              size="lg"
              style="secondary"
              className="md:hidden"
            >
              Налаштування колонок
            </Button>
          </div>
          }
        />

        {/* Main Content Area */}
        <div className={viewMode === 'kanban' ? 'flex min-h-0 flex-1 flex-col' : ''}>
        {loading || sprintsLoading ? (
          <div role="status" aria-busy="true" className="flex min-h-[320px] flex-1 items-center justify-center">
            <LoadingSpinner size="md" />
            <span className="sr-only">Завантаження…</span>
          </div>
        ) : tasksError || sprintsError ? (
          <div className="flex min-h-[320px] flex-1 items-center justify-center p-6">
            <div className="flex w-full max-w-[480px] flex-col gap-3">
              <Alert
                variant="error"
                title={dataFailure.title}
                description={dataFailure.description}
              />
              <Button onClick={() => window.location.reload()} style="secondary" size="sm">
                Спробувати ще раз
              </Button>
            </div>
          </div>
        ) : viewMode === 'kanban' ? (
          <div className="flex min-h-[500px] flex-1 flex-col">
            <AgileBoard
              issues={filtered}
              allIssues={allIssues}
              members={members}
              projects={projects}
              projectId="my"
              sprints={sprints}
              showProjectName
              groupBy="category"
              compareIssueCards={compareTaskCards}
              hiddenColumns={hiddenCategories}
              showHiddenLane
              onRequestAddIssue={categoryId => {
                setCreateTaskCategory(categoryId);
                setShowCreateTaskModal(true);
              }}
              onMoveIssue={handleMoveIssue}
              onBulkUpdate={handleBulkUpdate}
              canArchive={canWhileRoleLoads(orgRole, 'delete:issue')}
              issueLinks={issueLinks}
              selectionScopeKey={selectionScopeKey}
            />
          </div>
        ) : (
          <TaskListView
            issues={filtered}
            allIssues={allIssues}
            issueLinks={issueLinks}
            members={members}
            labels={labels}
            sprints={sprints}
            projects={projects}
            showProjectName
            groupBy="category"
            compareIssueCards={compareTaskCards}
            hiddenGroupIds={hiddenCategories}
            onBulkUpdate={handleBulkUpdate}
            bulkProgress={bulkProgress}
            canArchive={canWhileRoleLoads(orgRole, 'delete:issue')}
            selectionScopeKey={selectionScopeKey}
          />
        )}
        </div>
      </div>

      <CreateTaskModal
        isOpen={composerOpen}
        onClose={closeComposer}
        initialCategory={createTaskCategory}
        initialAssignees={composerAssignees}
        onSubmit={async (formData) => {
          if (!formData.projectId) {
            throw new Error('Будь ласка, оберіть проєкт');
          }
          const created = await createIssueViaApi({
            organizationId: activeOrgId,
            projectId: formData.projectId,
            data: {
              title: formData.title,
              description: formData.description || '',
              status: formData.status || 'backlog',
              priority: formData.priority || NO_PRIORITY_ID,
              type: formData.type || 'task',
              assigneeIds: formData.assignees || [],
              labelIds: formData.labelIds || [],
              dueDate: formData.dueDate || null,
              estimateMinutes: formData.estimateMinutes || 0,
              sprintId: formData.sprintId || null,
              reporterId: uid,
              addAssigneesToProjectTeam: formData.addAssigneesToProjectTeam === true,
            },
          });
          notifyIssueAssigned({
            issueId: created.id,
            title: formData.title,
            assigneeIds: formData.assignees || [],
            actorId: uid,
            actorName: currentUser?.name || '',
            projectId: formData.projectId,
            organizationId: activeOrgId,
          });

          showToast('Інцидент створено');
          return { ...created, projectId: formData.projectId };
        }}
        projects={projects}
        stages={[]}
        teamMembers={members}
        sprints={sprints}
      />

      {showSettingsModal && (
        <Dialog
          isOpen
          onClose={() => setShowSettingsModal(false)}
          title="Налаштування видимості колонок"
          titleContext="dialog"
          size="sm"
          presentation="sheet"
          bodyPadding="spacious"
          footer={(
            <Button
              style="primary"
              size="md"
              onClick={() => setShowSettingsModal(false)}
            >
              Готово
            </Button>
          )}
        >
          <div>
            <h3 className="ui-type-card-title mb-2 text-ink">Видимість колонок</h3>
            <p className="mb-4 text-[13px] text-muted">
              Ці колонки — категорії статусів, спільні для всіх проєктів: скільки б
              статусів не було в налаштуваннях, кожен інцидент належить рівно до
              однієї категорії. На дошці та у режимі «Списком» інциденти прихованих
              категорій збираються в окрему секцію «Приховані».
            </p>
            <StatusVisibilityPicker
              statuses={categoryColumns}
              hiddenStatusIds={hiddenCategories}
              onChange={updateHiddenCategories}
              backlogStatusId={null}
            />
          </div>
        </Dialog>
      )}

      {pendingStatusMove ? (
        <StatusTransitionPicker
          isOpen
          issue={pendingStatusMove.issue}
          project={pendingStatusMove.project}
          statuses={pendingStatusMove.candidates}
          categoryLabel={statusCategoryLabel(pendingStatusMove.categoryId)}
          issues={allIssues}
          issueLinks={issueLinks}
          members={members}
          labels={labels}
          sprints={sprints}
          busy={Boolean(pendingStatusMove.busy)}
          onSelect={selectPendingStatus}
          onClose={() => setPendingStatusMove(null)}
        />
      ) : null}
    </div>
  );
}
