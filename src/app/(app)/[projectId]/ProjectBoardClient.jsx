'use client';
// src/app/workspace/[projectId]/page.js
// Project page: Board | Backlog | Аналітика
// Portal tab — shown only when project.visibility === 'shared' (synced to QT)
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext }  from '@/lib/context/AppContext';
import { useIssues }     from '@/lib/hooks/useIssues';
import { useSprints }    from '@/lib/hooks/useSprints';
import { useTeamMembers } from '@/lib/hooks/useTeamMembers';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { issueDisplayParticipants } from '@/lib/utils/issueParticipants.mjs';
import useWorkspaceStore  from '@/store/useWorkspaceStore';
import AgileBoard    from '@/components/workspace/AgileBoard';
import BoardConfigModal from '@/components/workspace/BoardConfigModal';
import AnalyticsTab  from '@/components/workspace/AnalyticsTab';
import { PageHeader, Pill, TaskListView, TaskTableView, Tabs } from '@/components/ui';
import CreateTaskModal from '@/components/CreateTaskModal';
import LoadingSpinner from '@/components/ui/Feedback/LoadingSpinner';
import { LayoutGrid, BarChart2, Plus, Settings2, List, Plug, Kanban, Table2 } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import FilterBar from '@/components/ui/FilterBar';
import Link from 'next/link';
import { can, canWhileRoleLoads, isClientRole } from '@/lib/utils/can';
import { planAllows } from '@/lib/utils/plans.mjs';
import { PROJECT_OVER_PLAN_LIMIT } from '@/lib/utils/projectAccess.mjs';
import { useQtPlusEnabled } from '@/lib/hooks/useQtPlusEnabled';
import QtPlusProjectTab from '@/components/workspace/QtPlusProjectTab';
import { archiveProject, deleteProject, restoreProject } from '@/lib/services/projects';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { useBulkIssueActions } from '@/lib/hooks/useBulkIssueActions';
import { useViewState } from '@/lib/hooks/useViewState';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { BOARD_VIEW_SCHEMA } from '@/lib/utils/viewState.mjs';
import { serializeTaskTableColumns, visibleTaskTableColumns } from '@/lib/utils/taskTable.mjs';

const PROJECT_TABS = [
  { id: 'board',      label: 'Дошка',     icon: LayoutGrid },
  { id: 'analytics',  label: 'Аналітика', icon: BarChart2  },
];

// One switcher, three readings of the same tasks. It is not a filter — nothing
// is hidden by choosing one — which is why it sits outside `FilterBar`.
//
// A desktop control. It used to be mirrored into the header's mobile slot so a
// phone could still reach the list; below md there is now only the board, so
// the mirror would offer two ways to a screen that no longer exists.
const BOARD_VIEW_TABS = [
  { id: 'kanban', icon: Kanban, title: 'Дошка', ariaLabel: 'Дошка' },
  { id: 'list', icon: List, title: 'Список', ariaLabel: 'Список' },
  { id: 'table', icon: Table2, title: 'Таблиця', ariaLabel: 'Таблиця' },
];
const QTPLUS_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_QTPLUS_URL);

export default function ProjectBoardClient({ projectId, resourceOrganizationId }) {
  const {
    projects,
    projectsLoading,
    currentUser,
    activeOrg,
    activeOrgId,
    orgRole,
    switchOrg,
  } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  const canEditIncidents = can(orgRole, 'edit:issue');
  const resourceContextReady = !resourceOrganizationId || activeOrgId === resourceOrganizationId;
  const scopedProjectId = resourceContextReady ? projectId : null;
  const {
    issues: sourceIssues,
    issueLinks,
    loading: issuesLoading,
    createIssue,
    updateIssue,
    moveIssue,
  } = useIssues(scopedProjectId);
  const {
    sprints,
    loading: sprintsLoading,
    startSprint,
    completeSprint,
  } = useSprints({ enabled: Boolean(orgRole) && !clientViewer });
  const loading = issuesLoading || sprintsLoading;
  const router      = useRouter();
  const showToast   = useWorkspaceStore(s => s.showToast);
  const activeTimer = useWorkspaceStore(s => s.activeTimer);
  const openIssueQuickView = useWorkspaceStore(s => s.openIssueQuickView);
  const projectSearch = useWorkspaceStore(s => s.projectSearch);
  const resolveBulkStatusId = useCallback((issue, value) => (
    value?.mode === 'status' ? value.id : null
  ), []);
  const { issues, applyBulkAction, bulkProgress } = useBulkIssueActions({
    issues: sourceIssues,
    organizationId: activeOrgId,
    showToast,
    resolveStatusId: resolveBulkStatusId,
  });

  const project  = projects?.find(p => p.id === projectId);
  // The project's team, plus anyone actually standing on one of these tasks.
  //
  // The team alone is who may be *given* work here. It is not who is *on* the
  // work: a task assigned before somebody left the team — or, until the server
  // started refusing it, assigned to somebody who was never on it — still
  // carries their name, and a card that resolves faces from the team dropped
  // them without a word. A face is a record of who is on a task; a picker is a
  // question about who may be handed one. The union answers both, which is the
  // same rule the task screen has always used for its own assignee list.
  const teamUids = useMemo(() => {
    const uids = new Set(Array.isArray(project?.team) ? project.team : []);
    for (const issue of sourceIssues || []) {
      for (const participant of issueDisplayParticipants(issue)) uids.add(participant.id);
    }
    return [...uids];
  }, [project, sourceIssues]);
  const { members } = useTeamMembers(teamUids);
  const { members: organizationMembers } = useOrganization();
  const { labels, priorities, types } = useWorkflowConfig();

  // Portal tab visible only when project is shared (synced to QT)
  const isShared = project?.visibility === 'shared';
  const isArchived = project?.status === 'archived';

  const [activeTab, setActiveTab] = useState('board');
  // Board filters and the kanban/list choice live in the address, so this board
  // can be bookmarked, sent to somebody, and stepped back out of.
  const [boardViewState, setBoardViewState] = useViewState(BOARD_VIEW_SCHEMA, {
    storageKey: `qt:view:${resourceOrganizationId || activeOrgId}:board:${projectId}`,
    ready: resourceContextReady,
  });
  const {
    view: boardView,
    sprint: boardSprintFilter,
    assignee: boardAssigneeFilter,
    priority: boardPriorityFilter,
    type: boardTypeFilter,
    sort: tableSort,
    dir: tableSortDirection,
    cols: tableColumns,
  } = boardViewState;
  const setBoardView = useCallback(value => setBoardViewState({ view: value }), [setBoardViewState]);
  // Below md there is one view, so there is one switcher entry, so there is no
  // switcher: the list and the table are both built around a track a phone does
  // not have — the table scrolls sideways behind a pinned column, and the list
  // is a board without the one thing a board is for.
  //
  // Read, never written. Somebody who chose «Таблиця» on a laptop and then
  // opened the project on a phone would otherwise have that choice quietly
  // overwritten with `kanban` by the very screen that cannot show it, and find
  // the board waiting for them when they got back to the laptop.
  const isMobile = useIsMobile();
  const effectiveBoardView = isMobile === true ? 'kanban' : boardView;
  const setTableSort = useCallback(next => setBoardViewState(next), [setBoardViewState]);
  const visibleTableColumnIds = useMemo(
    () => visibleTaskTableColumns(tableColumns).map(column => column.id),
    [tableColumns],
  );
  const toggleTableColumn = useCallback(columnId => {
    const current = new Set(visibleTableColumnIds);
    if (current.has(columnId)) current.delete(columnId);
    else current.add(columnId);
    setBoardViewState({ cols: serializeTaskTableColumns([...current]) });
  }, [setBoardViewState, visibleTableColumnIds]);
  const [analyticsPriorityFilter, setAnalyticsPriorityFilter] = useState('all');
  const [analyticsTypeFilter, setAnalyticsTypeFilter] = useState('all');

  const canManageQtPlus = can(orgRole, 'edit:project_settings');
  const { enabled: qtEnabled } = useQtPlusEnabled(canManageQtPlus ? project?.organizationId : null);
  const qtplusLinked = Boolean(project?.qtplusLink?.projectId);
  // «Портал для клієнтів» is a paid line on the price list, so a workspace on
  // Free does not get the tab — not even on a project linked before the plan
  // changed. The link itself is untouched; it comes back with the plan.
  const portalAllowed = planAllows(activeOrg?.plan, 'portal');
  const showQtPlusTab = QTPLUS_CONFIGURED && portalAllowed
    && ((canManageQtPlus && qtEnabled) || qtplusLinked);
  const tabs = useMemo(() => {
    if (clientViewer) return [];
    return showQtPlusTab
      ? [...PROJECT_TABS, { id: 'qtplus', label: 'QuickTeam+', icon: Plug }]
      : PROJECT_TABS;
  }, [clientViewer, showQtPlusTab]);

  useEffect(() => {
    if (resourceOrganizationId && resourceOrganizationId !== activeOrgId) {
      switchOrg(resourceOrganizationId);
    }
  }, [activeOrgId, resourceOrganizationId, switchOrg]);

  // If the qtplus tab was active and just became hidden (e.g. unlinked), fall back.
  useEffect(() => {
    if (activeTab === 'qtplus' && !showQtPlusTab) {
      queueMicrotask(() => setActiveTab('board'));
    }
  }, [activeTab, showQtPlusTab]);

  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);

  const activeSprints = sprints.filter(s => s.status === 'active');
  const boardIssues = issues.filter(i => {
    const normalizedSearch = projectSearch.trim().toLowerCase();
    if (normalizedSearch && ![i.issueKey, i.title, i.description]
      .some(value => String(value || '').toLowerCase().includes(normalizedSearch))) return false;
    // Sprint
    if (boardSprintFilter !== 'all') {
      if (boardSprintFilter === 'active') {
        if (activeSprints.length > 0 && !activeSprints.some(s => s.id === i.sprintId)) return false;
      } else {
        if (i.sprintId !== boardSprintFilter) return false;
      }
    }
    // Assignee
    if (boardAssigneeFilter !== 'all') {
      if (!i.assigneeIds || !i.assigneeIds.includes(boardAssigneeFilter)) return false;
    }
    // Priority
    if (boardPriorityFilter !== 'all' && (i.priority || NO_PRIORITY_ID) !== boardPriorityFilter) return false;
    // Type
    if (boardTypeFilter !== 'all' && i.type !== boardTypeFilter) return false;

    return true;
  });
  const selectionScopeKey = [
    projectId,
    projectSearch,
    boardSprintFilter,
    boardAssigneeFilter,
    boardPriorityFilter,
    boardTypeFilter,
  ].join('|');
  usePublishLocalSearchResults(projectSearch, boardIssues.length);

  const actor = {
    userId:   currentUser?.id   || currentUser?.uid,
    userName: currentUser?.name || '',
  };

  const handleAddIssue = useCallback(async (columnId, title) => {
    try {
      const data = { title, columnId };

      await createIssue(data, actor);
      showToast('Інцидент додано');
    } catch (err) {
      showToast('Помилка: ' + err.message, 'error');
    }
  }, [createIssue, showToast]); // eslint-disable-line

  // Archiving or deleting the project you are standing in has to leave it —
  // the projects list does not, because it stays on the list either way.
  const handleArchiveProject = useCallback(async (id) => {
    try {
      await archiveProject(id);
      showToast('Проєкт архівовано', 'success');
      router.push('/');
      return true;
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося архівувати проєкт'), 'error');
      return false;
    }
  }, [router, showToast]);

  const handleRestoreProject = useCallback(async (id) => {
    try {
      await restoreProject(id);
      showToast('Проєкт розархівовано');
      return true;
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося розархівувати проєкт'), 'error');
      return false;
    }
  }, [showToast]);

  const handleDeleteProject = useCallback(async (id) => {
    await deleteProject(id);
    showToast('Проєкт видалено');
    router.push('/');
  }, [router, showToast]);

  const handleCreateFullIssue = useCallback(async (formData) => {
    const created = await createIssue(clientViewer
      ? {
          title: formData.title,
          description: formData.description || '',
        }
      : {
          title: formData.title,
          description: formData.description || '',
          columnId: formData.status || 'backlog',
          priority: formData.priority || NO_PRIORITY_ID,
          type: formData.type || 'task',
          assigneeIds: formData.assignees || [],
          labelIds: formData.labelIds || [],
          dueDate: formData.dueDate,
          estimateMinutes: formData.estimateMinutes || 0,
          sprintId: formData.sprintId || null,
          addAssigneesToProjectTeam: formData.addAssigneesToProjectTeam === true,
        }, actor);
    showToast('Інцидент створено');
    return { ...created, projectId };
  }, [clientViewer, createIssue, showToast]); // eslint-disable-line

  const handleMoveIssue = useCallback(async (issueId, newColumnId, position, updateFields = null) => {
    // Both writes are kicked off synchronously so each paints its optimistic
    // result before the first await. Awaiting them in sequence also chained two
    // full round-trips onto a swimlane drop, which is what made the card sit
    // there for about a second before settling.
    const move = moveIssue(issueId, newColumnId, position, actor);
    const fields = updateFields
      ? updateIssue(issueId, updateFields, actor)
      : Promise.resolve();

    const results = await Promise.allSettled([move, fields]);
    const failed = results.find(r => r.status === 'rejected');
    if (failed) {
      showToast(`Помилка переміщення. Відновлено попередній стан: ${failed.reason?.message || failed.reason}`, 'error');
    }
  }, [moveIssue, updateIssue, showToast]); // eslint-disable-line

  const handleBulkUpdate = useCallback(async (action, value, selectedIssues) => {
    await applyBulkAction(action, value, selectedIssues);
  }, [applyBulkAction]);

  // One cell of the table, saved. `updateIssue` already owns the optimistic
  // overlay and the rollback, including the status route — so a cell edit and a
  // drag on the board take exactly the same path to Firestore.
  const handleUpdateIssue = useCallback(async (issueId, patch) => {
    try {
      await updateIssue(issueId, patch, actor);
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося зберегти зміну'), 'error');
    }
  }, [updateIssue, showToast]); // eslint-disable-line

  // The kanban and the table both fill the screen and scroll inside themselves:
  // the table's header row and its identity column are pinned to its own scroll
  // container, and a page that scrolled instead would leave both behind.
  const isBoard = activeTab === 'board' && (effectiveBoardView === 'kanban' || effectiveBoardView === 'table');
  const isQtPlusWorkspace = activeTab === 'qtplus' && showQtPlusTab;

  if (!resourceContextReady || projectsLoading) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-[320px] flex-1 items-center justify-center">
        <LoadingSpinner size="md" />
        <span className="sr-only">Завантаження проєкту…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[320px] flex-1 items-center justify-center p-6">
        <div data-ui-surface="local" className="w-full max-w-[420px] rounded-[20px] border border-line bg-white p-6 text-center shadow-sm">
          <h1 className="ui-type-section-title mb-2 text-ink">Проєкт не знайдено</h1>
          <p className="mb-5 text-[13px] text-muted">
            Проєкт видалено або у вас більше немає до нього доступу.
          </p>
          <Button onClick={() => router.replace('/')} size="lg" composition="workspace-guard">
            На головну
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 h-full bg-transparent ${
      isBoard
        ? 'overflow-hidden'
        : isQtPlusWorkspace
          ? 'qt-nav-scroll overflow-y-auto overflow-x-hidden custom-scrollbar lg:overflow-hidden'
          : 'qt-nav-scroll overflow-y-auto overflow-x-hidden custom-scrollbar'
    }`}>
      <div className={`workspace-page-layout ${
        isBoard
          ? 'h-full pb-0'
          : isQtPlusWorkspace
            ? 'min-h-full pb-[120px] lg:h-full lg:min-h-0 lg:pb-0'
            : 'min-h-full pb-[120px]'
      }`}>

      {/* ── PageHeader ── */}
      <PageHeader
        title={
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 truncate">{project?.name}</span>
            {isArchived && <Pill tone="neutral" size="lg" shape="badge" uppercase>В архіві</Pill>}
            {/* The plan's ceiling no longer has room for this project. Said
                beside its name, where «В архіві» is said, because it is the same
                kind of fact: the project is here, it opens, and nothing new goes
                into it. The routes refuse the writes; this is so nobody finds
                that out by being refused. */}
            {project?.overPlanLimit === true && (
              <Pill tone="warning" size="lg" shape="badge" uppercase title={PROJECT_OVER_PLAN_LIMIT}>
                Тільки читання
              </Pill>
            )}
          </div>
        }
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        actions={
          <>
            {!clientViewer && isShared && (
              <Link
                href={`/${projectId}/portal`}
                className={`relative flex items-center justify-center gap-[6px] w-[36px] h-[36px] p-0 sm:w-auto sm:h-auto sm:px-[14px] sm:py-[7px] rounded-[10px] text-[12px] font-semibold transition-all whitespace-nowrap bg-canvas text-muted hover:text-ink hover:bg-ink/8`}
                title="QuickTeam+"
              >
                <ChatIcon size={13} />
                <span className="hidden sm:inline">QuickTeam+</span>
                {project?.hasUnreadPortal && (
                  <span className="absolute -top-[3px] -right-[3px] w-[10px] h-[10px] rounded-full bg-danger-solid border-2 border-white" />
                )}
              </Link>
            )}
            {!isArchived && can(orgRole, 'edit:project_settings') && (
              <Button
                onClick={() => setShowConfigModal(true)}
                icon={Settings2}
                size="icon-lg"
                style="secondary"
                title="Налаштування проєкту"
                aria-label="Налаштування проєкту"
              />
            )}
            {!isArchived && (
              <Button
                onClick={() => setShowCreateTaskModal(true)}
                style="primary"
                size="lg"
                icon={Plus}
                collapseAt="sm"
                title="Створити інцидент"
              >
                Створити інцидент
              </Button>
            )}
          </>
        }
        filters={
          activeTab === 'board' ? (
            <>
              <FilterBar>
                <Select
                  filterRole="sprint"
                  ariaLabel="Фільтр за спринтом"
                  value={boardSprintFilter}
                  onChange={value => setBoardViewState({ sprint: value })}
                  options={[
                    { value: 'all', label: 'Всі спринти' },
                    { value: 'active', label: 'Активний спринт' },
                    ...sprints.map(s => ({ value: s.id, label: s.name }))
                  ]}
                  variant="ghost"
                />
                <Select
                  filterRole="member"
                  ariaLabel="Фільтр за виконавцем"
                  value={boardAssigneeFilter}
                  onChange={value => setBoardViewState({ assignee: value })}
                  options={[
                    { value: 'all', label: 'Всі виконавці' },
                    ...members.map(m => ({ value: m.id || m.uid, label: m.name || m.email, user: m }))
                  ]}
                  variant="ghost"
                />
                <Select
                  filterRole="priority"
                  ariaLabel="Фільтр за пріоритетом"
                  value={boardPriorityFilter}
                  onChange={value => setBoardViewState({ priority: value })}
                  options={[
                    { value: 'all', label: 'Всі пріоритети' },
                    ...prioritySelectOptions(priorities),
                  ]}
                  variant="ghost"
                />
                <Select
                  filterRole="type"
                  ariaLabel="Фільтр за типом інциденту"
                  value={boardTypeFilter}
                  onChange={value => setBoardViewState({ type: value })}
                  options={[
                    { value: 'all', label: 'Всі типи' },
                    ...types.map(taskTypeSelectOption),
                  ]}
                  variant="ghost"
                />
              </FilterBar>
              <div className="ml-auto flex items-center gap-2 max-md:hidden">
                <Tabs
                  tabs={BOARD_VIEW_TABS}
                  activeTab={boardView}
                  onTabChange={setBoardView}
                />
              </div>
            </>
          ) : activeTab === 'analytics' ? (
            <FilterBar>
              <Select
                filterRole="priority"
                variant="ghost"
                value={analyticsPriorityFilter}
                onChange={setAnalyticsPriorityFilter}
                options={[
                  { value: 'all', label: 'Всі пріоритети' },
                  ...prioritySelectOptions(priorities),
                ]}
              />
              <Select
                filterRole="type"
                variant="ghost"
                value={analyticsTypeFilter}
                onChange={setAnalyticsTypeFilter}
                options={[
                  { value: 'all', label: 'Всі типи' },
                  ...types.map(taskTypeSelectOption),
                ]}
              />
            </FilterBar>
          ) : null
        }
      />

      {/* ── Tab content ── */}
      {activeTab === 'board' && (
        // Only spin while there is genuinely nothing to show. Swapping a
        // populated board for the spinner unmounts it, and it comes back
        // through a blank frame — so any brief `loading` blip read as the
        // board reloading itself.
        loading && boardIssues.length === 0 ? (
          <div role="status" aria-busy="true" className="flex min-h-[320px] flex-1 items-center justify-center">
            <LoadingSpinner size="md" />
            <span className="sr-only">Завантаження…</span>
          </div>
        ) : effectiveBoardView === 'kanban' ? (
          <div className="flex-1 min-h-[500px] flex flex-col">
            <AgileBoard
              issues={boardIssues}
              allIssues={issues}
              members={members}
              projectId={projectId}
              project={project}
              activeTimerIssueId={activeTimer?.issueId}
              onAddIssue={handleAddIssue}
              onMoveIssue={canEditIncidents ? handleMoveIssue : undefined}
              onBulkUpdate={canEditIncidents ? handleBulkUpdate : undefined}
              issueLinks={issueLinks}
              sprints={sprints}
              isArchived={isArchived}
              readOnly={!canEditIncidents}
              canArchive={canWhileRoleLoads(orgRole, 'delete:issue')}
              selectionScopeKey={selectionScopeKey}
            />
          </div>
        ) : effectiveBoardView === 'table' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <TaskTableView
              issues={boardIssues}
              allIssues={issues}
              issueLinks={issueLinks}
              members={members}
              labels={labels}
              sprints={sprints}
              projectId={projectId}
              columns={tableColumns}
              sort={tableSort}
              dir={tableSortDirection}
              onSortChange={setTableSort}
              onColumnsChange={toggleTableColumn}
              onOpenIssue={openIssueQuickView}
              activeTimerIssueId={activeTimer?.issueId}
              // An archived project is read-only, and so is a role without
              // `edit:issue`. Hidden UI is not the guard — the server route and
              // the rules are — but a cell that opens and then refuses is worse
              // than one that does not open.
              onUpdateIssue={isArchived || !canWhileRoleLoads(orgRole, 'edit:issue') ? undefined : handleUpdateIssue}
              onBulkUpdate={canEditIncidents ? handleBulkUpdate : undefined}
              bulkProgress={bulkProgress}
              canArchive={canWhileRoleLoads(orgRole, 'delete:issue')}
              selectionScopeKey={selectionScopeKey}
              emptyTitle="Інцидентів не знайдено"
              emptyDescription="Змініть фільтри або створіть новий інцидент."
            />
          </div>
        ) : (
          <TaskListView
            issues={boardIssues}
            allIssues={issues}
            issueLinks={issueLinks}
            members={members}
            labels={labels}
            sprints={sprints}
            projectId={projectId}
            projectName={project?.name}
            hiddenGroupIds={project?.hiddenColumns || []}
            activeTimerIssueId={activeTimer?.issueId}
            onBulkUpdate={canEditIncidents ? handleBulkUpdate : undefined}
            bulkProgress={bulkProgress}
            canArchive={canWhileRoleLoads(orgRole, 'delete:issue')}
            selectionScopeKey={selectionScopeKey}
            emptyTitle="Інцидентів не знайдено"
            emptyDescription="Змініть фільтри або створіть новий інцидент."
          />
        )
      )}


      {showConfigModal && project && (
        // The kebab on the projects list opened this same dialog with archive,
        // delete and invites; opening it from inside the project left all three
        // out, so the same "Налаштування проєкту" showed two different things
        // depending on where you clicked. One dialog, one set of capabilities.
        <BoardConfigModal
          project={project}
          issues={issues}
          organizationMembers={organizationMembers}
          canManageTeam={can(orgRole, 'manage:team')}
          canInvite={can(orgRole, 'manage:team')}
          onArchive={handleArchiveProject}
          onUnarchive={handleRestoreProject}
          onDelete={handleDeleteProject}
          onClose={() => setShowConfigModal(false)}
        />
      )}

      <CreateTaskModal
        isOpen={showCreateTaskModal}
        onClose={() => setShowCreateTaskModal(false)}
        onSubmit={handleCreateFullIssue}
        stages={project?.stages || []}
        teamMembers={members}
        projectContext={project ? {
          id: project.id,
          name: project.name,
          hiddenColumns: project.hiddenColumns || [],
        } : null}
        sprints={sprints}
        entity="incident"
        clientMode={clientViewer}
      />
      {activeTab === 'analytics' && (
        <AnalyticsTab
          issues={issues}
          members={members}
          project={project}
          projectId={projectId}
          issueLinks={issueLinks}
          priorityFilter={analyticsPriorityFilter}
          typeFilter={analyticsTypeFilter}
        />
      )}

      {activeTab === 'qtplus' && showQtPlusTab && (
        <QtPlusProjectTab
          project={project}
          orgRole={orgRole}
          currentUser={currentUser}
          allProjects={projects}
        />
      )}
      </div>
    </div>
  );
}
