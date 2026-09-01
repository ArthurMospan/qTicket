'use client';
// src/app/workspace/my/page.js — qTicket's cross-client incident queue
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import { useAllMyTasks } from '@/lib/hooks/useAllMyTasks';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import AgileBoard from '@/components/workspace/AgileBoard';
import { Alert, PageHeader, StatusTransitionPicker, StatusVisibilityPicker, TaskListView } from '@/components/ui';
import { isUnresolvedAccessError, workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import { Settings2, List, Kanban } from 'lucide-react';
import { Select, MultiSelect } from '@/components/ui/Select';
import Tabs from '@/components/ui/Tabs';
import LoadingSpinner from '@/components/ui/Feedback/LoadingSpinner';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Layout/Card';
import Surface from '@/components/ui/Surface';
import FilterBar from '@/components/ui/FilterBar';
import Dialog from '@/components/ui/Dialog';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import {
  categorizeIssues,
  waitingOnClientIssues,
  waitingOnUsIssues,
} from '@/lib/utils/incidentQueueMetrics.mjs';
import {
  availableStatusesInCategory,
  resolveCategoryStatusId,
  statusCategoryLabel,
  statusCategoryOf,
} from '@/lib/utils/statusCategories.mjs';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { useBulkIssueActions } from '@/lib/hooks/useBulkIssueActions';
import { can, canWhileRoleLoads, isClientRole } from '@/lib/utils/can';
import { useViewState } from '@/lib/hooks/useViewState';
import { INCIDENT_QUEUE_VIEW_SCHEMA } from '@/lib/utils/viewState.mjs';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { timestampMillis } from '@/lib/utils/issueReadState.mjs';



// `waitingOnUsIds` and `waitingOnClientIds` are the sets «Чекають на нас» and
// «Чекають на клієнта» count, resolved once by `waitingOnUsIssues` and
// `waitingOnClientIssues` and handed in — the tile on the overview and this
// filter are then literally the same predicate, not two readings of one
// sentence.
function filterTasks(tasks, filters, waitingOnUsIds, waitingOnClientIds) {
  const { projects, assigned, waiting, priority, type, period } = filters;
  const periodDays = period === '7days' ? 7 : period === '30days' ? 30 : 0;
  const cutoff = periodDays ? Date.now() - periodDays * 24 * 60 * 60 * 1000 : 0;

  return tasks.filter(t => {
    if (projects && projects.length > 0 && !projects.includes(t.projectId)) return false;
    if (assigned === 'unassigned' && (t.assigneeIds || []).length > 0) return false;
    if (assigned !== 'all' && assigned !== 'unassigned' && !(t.assigneeIds || []).includes(assigned)) return false;
    if (waiting === 'us' && !waitingOnUsIds.has(t.id)) return false;
    if (waiting === 'client' && !waitingOnClientIds.has(t.id)) return false;
    if (priority !== 'all' && (t.priority || NO_PRIORITY_ID) !== priority) return false;
    if (type !== 'all' && t.type !== type) return false;
    if (cutoff && timestampMillis(t.createdAt) < cutoff) return false;
    return true;
  });
}

export default function IncidentQueuePage() {
  const { currentUser, projects, activeOrgId, orgRole, orgDirectoryVerified } = useAppContext();
  const { members } = useOrganization();
  const { labels, types, priorities, statuses, categoryColumns } = useWorkflowConfig();
  const uid = currentUser?.uid || currentUser?.id;
  const clientViewer = isClientRole(orgRole);
  // Who «ми» are, for «Чекають на нас» — the same roster this screen already
  // draws the assignee filter from, so the question costs no extra read.
  const supportUserIds = useMemo(
    () => new Set((members || [])
      .filter(member => !isClientRole(member.role))
      .map(member => member.id || member.uid)
      .filter(Boolean)),
    [members],
  );
  const hiddenCategoriesStorageKey = `qt:incident-queue:hidden-categories:${uid || 'anonymous'}:${activeOrgId || 'none'}`;
  const {
    tasks: sourceTasks,
    allIssues,
    issueLinks,
    loading,
    error: tasksError,
    moveTask,
    moveTaskToCategory,
    compareTaskCards,
  } = useAllMyTasks(uid, { includeAll: true });
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

  // Filters and the kanban/list choice live in the address. `assigned` is used
  // for the queue because `assignee` already prefills the incident composer.
  const [filters, setFilters] = useViewState(INCIDENT_QUEUE_VIEW_SCHEMA, {
    storageKey: `qt:view:${activeOrgId}:incident-queue`,
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
  // There is no composer on this screen and no `?new=1` to open one. Only a
  // client opens a request; this is the queue support receives it in.
  const router = useRouter();
  useEffect(() => {
    if (orgRole && clientViewer) router.replace('/');
  }, [clientViewer, orgRole, router]);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
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
        `Не вдалося перемістити звернення — зміни не збережено${err?.message ? `: ${err.message}` : ''}`,
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

  // Resolved from the queue already in memory — the same call the «Чекають на
  // нас» tile on the overview counts, so the tile and this list are one set.
  const categorizedTasks = useMemo(
    () => categorizeIssues(tasks, statuses),
    [statuses, tasks],
  );
  const waitingOnUsIds = useMemo(
    () => new Set(
      waitingOnUsIssues(categorizedTasks, supportUserIds).map(issue => issue.id),
    ),
    [categorizedTasks, supportUserIds],
  );
  // The other half of the same question. A queue has two ways of standing
  // still and the screen could only name one of them.
  const waitingOnClientIds = useMemo(
    () => new Set(
      waitingOnClientIssues(categorizedTasks, supportUserIds).map(issue => issue.id),
    ),
    [categorizedTasks, supportUserIds],
  );

  const normalizedSearch = myTaskSearch.trim().toLowerCase();
  const filtered = filterTasks(tasks, filters, waitingOnUsIds, waitingOnClientIds).filter(t => {
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
    filters.assigned,
    filters.waiting,
    filters.priority,
    filters.type,
    filters.period,
    hiddenCategories.join(','),
  ].join('|');
  usePublishLocalSearchResults(myTaskSearch, filtered.length);


  // Одне питання на три екрани: відмова в доступі, вичерпана квота й обрив
  // мережі — це три різні речі, і всі три казали «перевірте зʼєднання».
  // Ще не відмова — ще не вирішилось. Див. `isUnresolvedAccessError`.
  const resolvingAccess = isUnresolvedAccessError(tasksError, orgDirectoryVerified);
  const dataFailure = tasksError && !resolvingAccess
    ? workspaceDataFailureCopy(tasksError, isQuotaRefused())
    : null;
  if (clientViewer) return null;
  return (
    <div className={`flex-1 h-full bg-transparent ${viewMode === 'kanban' ? 'overflow-hidden' : 'qt-nav-scroll overflow-y-auto overflow-x-hidden hide-scrollbar'}`}>
      <div className={`workspace-page-layout ${viewMode === 'kanban' ? 'h-full pb-0' : 'min-h-full pb-[120px]'}`}>
        <PageHeader
          title="Звернення"
          filters={
            <div className="flex items-center justify-between w-full">
              <FilterBar>
                <MultiSelect
                  variant="ghost"
                  value={filters.projects}
                onChange={(val) => setFilters({ projects: val })}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="Усі проєкти"
                searchPlaceholder="Пошук проєкту..."
                filterRole="project"
              />
              {/* There is no status filter on this screen, on either view.
                  On the board the columns *are* the statuses and which of them
                  stand there is «Налаштування колонок», one control to the
                  right; in the list the status is on every row and the list is
                  grouped by category. So the control could only ever repeat
                  what the reader is already looking at — and «Усі статуси»,
                  its own neutral value, was the widest thing in the row saying
                  nothing at all. What a status genuinely cannot answer is who
                  owes the next word, and that is the control below. */}
              {/* Who owes the next word. A status cannot answer it — a request
                  can stand in «У роботі» all week with the client's question
                  unanswered — so it is a slice of the queue of its own, and the
                  address «Чекають на нас» on the overview leads to.
                  Its neutral value used to read «Будь-яка черга», which named
                  a thing this product does not have: there is one queue, and
                  «черга» here meant «whose turn it is». The three options say
                  that outright now, and the third one — «Чекають на клієнта» —
                  is the half the screen could not ask for at all, though
                  `waitingOnClientIssues` had computed it for the customer's
                  own overview all along. */}
              <Select
                filterRole="status"
                ariaLabel="Чия черга відповідати"
                variant="ghost"
                value={filters.waiting}
                onChange={(val) => setFilters({ waiting: val })}
                options={[
                  { value: 'all', label: 'Усі звернення' },
                  { value: 'us', label: 'Чекають на нас' },
                  { value: 'client', label: 'Чекають на клієнта' },
                ]}
              />
              <Select
                filterRole="member"
                variant="ghost"
                value={filters.assigned}
                onChange={(val) => setFilters({ assigned: val })}
                options={[
                  { value: 'all', label: 'Усі виконавці' },
                  { value: 'unassigned', label: 'Без виконавця' },
                  ...members
                    .filter(member => !isClientRole(member.role))
                    .map(member => ({
                      value: member.id || member.uid,
                      label: member.name || member.email || 'Учасник',
                      user: member,
                    })),
                ]}
              />
              <Select
                filterRole="priority"
                variant="ghost"
                value={filters.priority}
                onChange={(val) => setFilters({ priority: val })}
                options={[
                  { value: 'all', label: 'Усі пріоритети' },
                  ...prioritySelectOptions(priorities),
                ]}
              />
              <Select
                filterRole="type"
                variant="ghost"
                value={filters.type}
                onChange={(val) => setFilters({ type: val })}
                options={[
                  { value: 'all', label: 'Усі типи' },
                  ...types.map(taskTypeSelectOption),
                ]}
              />
              <Select
                filterRole="date"
                variant="ghost"
                value={filters.period}
                onChange={(val) => setFilters({ period: val })}
                options={[
                  { value: 'all', label: 'За весь час' },
                  { value: '7days', label: 'Створені за 7 днів' },
                  { value: '30days', label: 'Створені за 30 днів' },
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
        {loading || resolvingAccess ? (
          <div role="status" aria-busy="true" className="flex min-h-[320px] flex-1 items-center justify-center">
            <LoadingSpinner size="md" />
            <span className="sr-only">Завантаження…</span>
          </div>
        ) : dataFailure ? (
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
              showProjectName
              groupBy="category"
              compareIssueCards={compareTaskCards}
              hiddenColumns={hiddenCategories}
              showHiddenLane
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
              Ці колонки — категорії статусів, спільні для всіх клієнтів: скільки б
              статусів не було в налаштуваннях, кожне звернення належить рівно до
              однієї категорії. На дошці та у режимі «Списком» звернення прихованих
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
          busy={Boolean(pendingStatusMove.busy)}
          onSelect={selectPendingStatus}
          onClose={() => setPendingStatusMove(null)}
        />
      ) : null}
    </div>
  );
}
