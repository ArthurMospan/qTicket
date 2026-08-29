'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FilterBar,
  KpiCard,
  ListRow,
  LoadingSpinner,
  PageHeader,
  Pill,
  Select,
  Surface,
  Tabs,
  TaskListView,
  UserAvatar,
} from '@/components/ui';
import {
  ArrowRight,
  CheckCircle2,
  CircleDotDashed,
  Inbox,
  Kanban,
  List,
  Plus,
  Settings2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import AgileBoard from '@/components/workspace/AgileBoard';
import BoardConfigModal from '@/components/workspace/BoardConfigModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import InviteMemberDialog from '@/components/InviteMemberDialog';
import { useAppContext } from '@/lib/context/AppContext';
import { useIssues } from '@/lib/hooks/useIssues';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useBulkIssueActions } from '@/lib/hooks/useBulkIssueActions';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { canWhileRoleLoads, can, isClientRole } from '@/lib/utils/can';
import { INCIDENT_TERMS_TABLE } from '@/lib/content/incidentTerms.mjs';
import { timestampMillis } from '@/lib/utils/issueReadState.mjs';
import { activeMembers, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { assigneeIdsOf, categorizeIssues, incidentQueueMetrics } from '@/lib/utils/incidentQueueMetrics.mjs';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import { archiveProject, deleteProject, restoreProject } from '@/lib/services/projects';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import useWorkspaceStore from '@/store/useWorkspaceStore';

const PROJECT_TABS = [
  { id: 'incidents', label: 'Звернення' },
  { id: 'people', label: 'Люди' },
  { id: 'settings', label: 'Налаштування' },
];

const SCOPE_OPTIONS = [
  { value: 'open', label: 'Відкриті' },
  { value: 'all', label: 'Усі звернення' },
  { value: 'resolved', label: 'Вирішені' },
];

function MemberList({ members, emptyTitle, emptyDescription, onOpen }) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={UsersRound}
        title={emptyTitle}
        description={emptyDescription}
        density="compact"
        surface="card"
      />
    );
  }

  return (
    <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
      {members.map(member => {
        const memberId = member.id || member.uid;
        return (
          <ListRow
            key={memberId}
            density="roomy"
            onClick={() => onOpen(memberId)}
            className="flex items-center gap-3"
          >
            <UserAvatar user={member} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-ink">
                {member.name || member.displayName || member.email || 'Учасник'}
              </p>
              <p className="mt-1 truncate text-[11px] text-muted">
                {member.email || 'Email не вказано'}
              </p>
            </div>
            <Pill tone="neutral" size="sm" shape="badge">
              {organizationRoleLabel(member.role)}
            </Pill>
            <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
          </ListRow>
        );
      })}
    </Card>
  );
}

export default function ProjectBoardClient({ projectId, resourceOrganizationId }) {
  const router = useRouter();
  const showToast = useWorkspaceStore(state => state.showToast);
  const {
    projects,
    projectsLoading,
    projectsError,
    currentUser,
    activeOrgId,
    orgRole,
    switchOrg,
  } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  const resourceContextReady = !resourceOrganizationId || activeOrgId === resourceOrganizationId;
  const scopedProjectId = resourceContextReady ? projectId : null;
  const project = projects?.find(candidate => candidate.id === projectId);
  const {
    issues: storedIssues,
    loading: issuesLoading,
    error: issuesError,
    createIssue,
    moveIssue,
  } = useIssues(scopedProjectId, { includeLinks: false });
  const {
    members,
    loading: membersLoading,
    error: membersError,
    inviteMember,
  } = useOrganization();
  const {
    statuses,
    priorities,
    loading: workflowLoading,
    error: workflowError,
  } = useWorkflowConfig();

  const [activeTab, setActiveTab] = useState('incidents');
  const [scope, setScope] = useState('open');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  // The board is the first thing both audiences see. «Де воно зараз» is the
  // question this screen exists to answer, and a pipeline answers it at a
  // glance where a list answers it one row at a time.
  const [viewMode, setViewMode] = useState('kanban');
  const [showComposer, setShowComposer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showClientInvite, setShowClientInvite] = useState(false);
  const workspaceSearch = useWorkspaceStore(state => state.workspaceSearch);

  // The selection and its optimistic patches. A client never selects anything —
  // `onBulkUpdate` is simply not handed to the board or the list below — but the
  // hook is the one source of the issue array either way, so it is not a branch.
  const {
    issues,
    applyBulkAction,
    bulkProgress,
  } = useBulkIssueActions({
    issues: storedIssues,
    organizationId: activeOrgId,
    showToast,
  });

  useEffect(() => {
    if (resourceOrganizationId && resourceOrganizationId !== activeOrgId) {
      switchOrg(resourceOrganizationId);
    }
  }, [activeOrgId, resourceOrganizationId, switchOrg]);

  // `?new=1` — from Ctrl+K, or carried here by the redirect at `/` — opens the
  // composer once. Consumed immediately so a refresh never reopens it.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('new') !== '1') return;
    queueMicrotask(() => setShowComposer(true));
    params.delete('new');
    const query = params.toString();
    router.replace(`/${projectId}${query ? `?${query}` : ''}`, { scroll: false });
  }, [projectId, router]);

  const projectMembers = useMemo(() => {
    const roster = new Set(Array.isArray(project?.team) ? project.team : []);
    return activeMembers(members).filter(member => roster.has(member.id || member.uid));
  }, [members, project]);
  const clientMembers = useMemo(
    () => projectMembers.filter(member => isClientRole(member.role)),
    [projectMembers],
  );
  const supportMembers = useMemo(
    () => projectMembers.filter(member => !isClientRole(member.role)),
    [projectMembers],
  );
  const supportAssigneeOptions = useMemo(() => supportMembers.map(member => ({
    value: member.id || member.uid,
    label: member.name || member.displayName || member.email || 'Учасник',
    user: member,
  })), [supportMembers]);

  const categorizedIssues = useMemo(
    () => categorizeIssues(issues, statuses),
    [issues, statuses],
  );
  const metrics = useMemo(() => incidentQueueMetrics(categorizedIssues), [categorizedIssues]);
  const visibleIssues = useMemo(() => {
    const query = workspaceSearch.trim().toLocaleLowerCase('uk-UA');
    return categorizedIssues
      .filter(({ issue, category }) => {
        if (scope === 'open' && category === 'done') return false;
        if (scope === 'resolved' && category !== 'done') return false;
        // Who is working on it is internal routing, so the filter that asks the
        // question is not offered to a client — and the state it holds cannot
        // be allowed to narrow their list behind their back either.
        if (!clientViewer) {
          const assignees = assigneeIdsOf(issue);
          if (assigneeFilter === 'unassigned' && assignees.length > 0) return false;
          if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned' && !assignees.includes(assigneeFilter)) return false;
        }
        if (priorityFilter !== 'all' && (issue.priority || NO_PRIORITY_ID) !== priorityFilter) return false;
        if (!query) return true;
        return [issue.issueKey, issue.title, issue.description]
          .some(value => String(value || '').toLocaleLowerCase('uk-UA').includes(query));
      })
      .map(item => item.issue)
      .sort((left, right) => (
        timestampMillis(right.updatedAt || right.createdAt)
        - timestampMillis(left.updatedAt || left.createdAt)
      ));
  }, [assigneeFilter, categorizedIssues, clientViewer, priorityFilter, scope, workspaceSearch]);
  usePublishLocalSearchResults(workspaceSearch, visibleIssues.length);

  const actor = useMemo(() => ({
    userId: currentUser?.uid || currentUser?.id,
    userName: currentUser?.name || currentUser?.displayName || currentUser?.email || '',
  }), [currentUser]);

  const handleCreateIssue = useCallback(async formData => {
    const created = await createIssue({
      title: formData.title,
      description: formData.description || '',
      columnId: formData.status || 'backlog',
      priority: formData.priority || NO_PRIORITY_ID,
      type: formData.type || 'task',
      assigneeIds: formData.assignees || [],
      labelIds: formData.labelIds || [],
      dueDate: formData.dueDate || null,
      estimateMinutes: formData.estimateMinutes || 0,
      addAssigneesToProjectTeam: formData.addAssigneesToProjectTeam === true,
    }, actor);
    showToast(INCIDENT_TERMS_TABLE.created);
    return { ...created, projectId };
  }, [actor, createIssue, projectId, showToast]);

  // Dragging a card is a workflow decision, and the workflow is internal. The
  // client's board is the same board in `readOnly`, so this handler is never
  // reached from their side — the drag context refuses the drop before it.
  const handleMoveIssue = useCallback(
    (issueId, columnId, position) => moveIssue(issueId, columnId, position, actor),
    [actor, moveIssue],
  );

  const handleBulkUpdate = useCallback(
    (action, value, selectedIssues) => applyBulkAction(action, value, selectedIssues),
    [applyBulkAction],
  );

  const handleArchiveProject = useCallback(async id => {
    try {
      await archiveProject(id);
      showToast('Клієнтський простір архівовано', 'success');
      router.push('/clients');
      return true;
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося архівувати клієнтський простір'), 'error');
      return false;
    }
  }, [router, showToast]);

  const handleRestoreProject = useCallback(async id => {
    try {
      await restoreProject(id);
      showToast('Клієнтський простір відновлено');
      return true;
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося відновити клієнтський простір'), 'error');
      return false;
    }
  }, [showToast]);

  const handleDeleteProject = useCallback(async id => {
    await deleteProject(id);
    showToast('Клієнтський простір видалено');
    router.push('/clients');
  }, [router, showToast]);

  const loading = !resourceContextReady
    || projectsLoading
    || issuesLoading
    || membersLoading
    || workflowLoading;
  const loadError = projectsError || issuesError || membersError || workflowError;
  const failure = loadError ? workspaceDataFailureCopy(loadError, isQuotaRefused()) : null;
  const canManageProject = can(orgRole, 'edit:project_settings');
  const canInviteClient = can(orgRole, 'manage:team');
  const isArchived = project?.status === 'archived';
  const isReadOnly = isArchived;
  // Only a client opens a request. Support receives it, works it and closes it —
  // an agent filing a customer's request on their behalf is how a support desk
  // stops being able to say who asked for what. The composer is therefore the
  // one action on this screen that belongs to the client and not to staff.
  const canOpenIncident = clientViewer && !isReadOnly;
  // A client's space has one thing in it: their requests. Its team and its
  // settings are the tenant's administration of a customer, not the customer's
  // own screen — same component, fewer tabs.
  const tabs = (clientViewer ? PROJECT_TABS.filter(tab => tab.id === 'incidents') : PROJECT_TABS)
    .map(tab => ({
      ...tab,
      count: tab.id === 'incidents'
        ? visibleIssues.length
        : tab.id === 'people'
          ? projectMembers.length
          : 0,
    }));

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-[420px] flex-1 items-center justify-center">
        <LoadingSpinner size="md" label="Завантажуємо клієнтський простір…" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[420px] flex-1 items-center justify-center p-6">
        <Surface preset="panel" padding="lg" className="w-full max-w-[460px]">
          <EmptyState
            icon={Inbox}
            title="Простір не знайдено"
            description="Його видалено або у вас більше немає доступу."
            action={clientViewer ? null : 'До клієнтів'}
            onAction={clientViewer ? null : () => router.replace('/clients')}
            context="page"
          />
        </Surface>
      </div>
    );
  }

  return (
    <>
      <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
        <div className="workspace-page-layout min-h-full pb-[120px]">
          <PageHeader
            title={project.name}
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            actions={(
              <div className="flex items-center gap-2">
                {canManageProject && !clientViewer && (
                  <Button
                    onClick={() => setShowSettings(true)}
                    icon={Settings2}
                    size="icon-lg"
                    style="secondary"
                    title="Налаштування клієнта"
                    aria-label="Налаштування клієнта"
                  />
                )}
                {canOpenIncident && (
                  <Button
                    onClick={() => setShowComposer(true)}
                    icon={Plus}
                    size="lg"
                    style="primary"
                    color="dark"
                    collapseAt="sm"
                  >
                    {INCIDENT_TERMS_TABLE.composerSubmit}
                  </Button>
                )}
                {/* Desktop only: below md the board has nowhere to go and the
                    list is the only view. Same control for both readers. */}
                {activeTab === 'incidents' && (
                  <div className="max-md:hidden">
                    <Tabs
                      tabs={[
                        { id: 'kanban', icon: Kanban, title: 'Дошка', ariaLabel: 'Дошка' },
                        { id: 'list', icon: List, title: 'Список', ariaLabel: 'Список' },
                      ]}
                      activeTab={viewMode}
                      onTabChange={setViewMode}
                    />
                  </div>
                )}
              </div>
            )}
            filters={activeTab === 'incidents' ? (
              <FilterBar>
                <Select
                  filterRole="status"
                  ariaLabel="Стан звернень"
                  variant="ghost"
                  value={scope}
                  onChange={setScope}
                  options={SCOPE_OPTIONS}
                />
                {!clientViewer && (
                  <Select
                    filterRole="member"
                    ariaLabel="Фільтр за відповідальним"
                    variant="ghost"
                    value={assigneeFilter}
                    onChange={setAssigneeFilter}
                    options={[
                      { value: 'all', label: 'Усі відповідальні' },
                      { value: 'unassigned', label: 'Без відповідального' },
                      ...supportAssigneeOptions,
                    ]}
                  />
                )}
                <Select
                  filterRole="priority"
                  ariaLabel="Фільтр за пріоритетом"
                  variant="ghost"
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  options={[
                    { value: 'all', label: 'Усі пріоритети' },
                    ...prioritySelectOptions(priorities),
                  ]}
                />
              </FilterBar>
            ) : null}
          />

          {loadError ? (
            <div className="mx-auto flex min-h-[420px] max-w-[520px] flex-col justify-center gap-3">
              <Alert variant="error" title={failure.title} description={failure.description} />
              <Button onClick={() => window.location.reload()} style="secondary" size="md">
                Спробувати ще раз
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-[20px]">
              {isArchived && (
                <Alert
                  variant="info"
                  title="Простір в архіві"
                  description="Історія та листування доступні, але нові звернення тут не створюються."
                />
              )}

              {activeTab === 'incidents' && (
                <>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KpiCard
                      icon={Inbox}
                      value={metrics.open}
                      label="Відкриті"
                      // Who has not picked one up yet is a fact about the
                      // support queue, said to the people who staff it.
                      sub={clientViewer ? 'у цьому просторі' : `${metrics.unassigned} без відповідального`}
                    />
                    <KpiCard icon={Plus} value={metrics.new} label="Нові" sub="очікують першої реакції" />
                    <KpiCard icon={CircleDotDashed} value={metrics.active} label="У роботі" sub="разом із перевіркою" />
                    <KpiCard icon={CheckCircle2} value={metrics.resolved} label="Вирішені" sub="у цьому просторі" />
                  </div>

                  {visibleIssues.length === 0 ? (
                    <Surface preset="panel" padding="md">
                      <EmptyState
                        icon={Inbox}
                        title={issues.length === 0 ? 'Звернень ще немає' : 'За цими фільтрами нічого немає'}
                        description={issues.length === 0
                          ? clientViewer
                            ? 'Якщо виникла проблема або запитання, створіть звернення — команда підтримки відповість у ньому.'
                            : 'Клієнт ще не звертався. Запросіть його адміністратора, щоб він міг це зробити.'
                          : 'Змініть стан або пріоритет у фільтрах.'}
                        action={canOpenIncident && issues.length === 0 ? INCIDENT_TERMS_TABLE.composerSubmit : null}
                        onAction={canOpenIncident && issues.length === 0 ? () => setShowComposer(true) : null}
                        density="compact"
                        surface="card"
                      />
                    </Surface>
                  ) : viewMode === 'kanban' ? (
                    <div className="flex min-h-[500px] flex-1 flex-col">
                      {/* One board, two readers. A client gets it `readOnly` —
                          no drag, no selection — and with no `members`, because
                          who a request is routed to inside the support team is
                          not their business and the card draws an assignee only
                          from that list.
                          `showAssignee` finishes that job. An empty `members`
                          leaked no name, but the card still drew the slot the
                          names go in, and a slot reading «Без учасників» is
                          itself the announcement: it tells the customer a
                          routing decision exists and is empty. Absent, not
                          empty. */}
                      <AgileBoard
                        issues={visibleIssues}
                        allIssues={issues}
                        members={clientViewer ? [] : members}
                        showAssignee={!clientViewer}
                        projects={[project]}
                        projectId={project.id}
                        project={project}
                        readOnly={clientViewer}
                        isArchived={isArchived}
                        onMoveIssue={clientViewer ? undefined : handleMoveIssue}
                        onBulkUpdate={clientViewer ? undefined : handleBulkUpdate}
                        canArchive={!clientViewer && canWhileRoleLoads(orgRole, 'delete:issue')}
                        selectionScopeKey={`${project.id}|${scope}|${assigneeFilter}|${priorityFilter}`}
                      />
                    </div>
                  ) : (
                    <TaskListView
                      issues={visibleIssues}
                      allIssues={issues}
                      members={clientViewer ? [] : members}
                      showAssignee={!clientViewer}
                      projects={[project]}
                      projectId={project.id}
                      projectName={project.name}
                      onBulkUpdate={clientViewer ? undefined : handleBulkUpdate}
                      bulkProgress={clientViewer ? null : bulkProgress}
                      canArchive={!clientViewer && canWhileRoleLoads(orgRole, 'delete:issue')}
                      selectionScopeKey={`${project.id}|${scope}|${assigneeFilter}|${priorityFilter}`}
                      emptyTitle="Звернень не знайдено"
                      emptyDescription="Змініть стан або пріоритет у фільтрах."
                    />
                  )}
                </>
              )}

              {activeTab === 'people' && (
                <div className="grid items-start gap-[20px] xl:grid-cols-2">
                  <Surface preset="panel" padding="md">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="ui-type-section-title text-ink">Команда клієнта</h2>
                        <p className="mt-1 text-[12px] text-muted">
                          Зовнішні користувачі бачать тільки цей простір і його звернення.
                        </p>
                      </div>
                      {canInviteClient && (
                        <Button
                          onClick={() => setShowClientInvite(true)}
                          icon={UserPlus}
                          style="secondary"
                          size="md"
                          collapseAt="sm"
                        >
                          Запросити клієнта
                        </Button>
                      )}
                    </div>
                    <MemberList
                      members={clientMembers}
                      emptyTitle="Клієнта ще не запрошено"
                      emptyDescription="Додайте адміністратора клієнта. Після входу він зможе запросити своїх співробітників."
                      onOpen={memberId => router.push(`/team?member=${encodeURIComponent(memberId)}`)}
                    />
                  </Surface>

                  <Surface preset="panel" padding="md">
                    <div className="mb-4">
                      <h2 className="ui-type-section-title text-ink">Команда підтримки</h2>
                      <p className="mt-1 text-[12px] text-muted">
                        Внутрішні працівники, закріплені за цим клієнтським простором.
                      </p>
                    </div>
                    <MemberList
                      members={supportMembers}
                      emptyTitle="Підтримку ще не призначено"
                      emptyDescription="Додайте внутрішніх працівників у налаштуваннях клієнта."
                      onOpen={memberId => router.push(`/team?member=${encodeURIComponent(memberId)}`)}
                    />
                  </Surface>
                </div>
              )}

              {activeTab === 'settings' && (
                <Surface preset="panel" padding="lg">
                  <div className="flex flex-col gap-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="max-w-[680px]">
                        <h2 className="ui-type-section-title text-ink">Клієнтський простір</h2>
                        <p className="mt-2 text-[13px] leading-6 text-muted">
                          Тут зберігається контекст клієнта, його команда та всі звернення. Налаштування доступні тільки внутрішнім адміністраторам qTicket.
                        </p>
                      </div>
                      {canManageProject && (
                        <Button onClick={() => setShowSettings(true)} icon={Settings2} style="primary" size="md">
                          Редагувати
                        </Button>
                      )}
                    </div>

                    <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                      <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                        <p className="text-[12px] font-semibold text-muted">Назва клієнта</p>
                        <p className="text-[13px] font-semibold text-ink">{project.name}</p>
                      </div>
                      <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                        <p className="text-[12px] font-semibold text-muted">Контекст</p>
                        <p className="whitespace-pre-line text-[13px] leading-6 text-ink">
                          {project.description || 'Опис клієнта ще не додано.'}
                        </p>
                      </div>
                      <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                        <p className="text-[12px] font-semibold text-muted">Доступ</p>
                        <p className="text-[13px] text-ink">
                          {clientMembers.length} клієнтських · {supportMembers.length} внутрішніх користувачів
                        </p>
                      </div>
                      <div className="grid gap-1 px-5 py-4 sm:grid-cols-[180px_1fr] sm:gap-4">
                        <p className="text-[12px] font-semibold text-muted">Стан</p>
                        <div>
                          <Pill tone={isArchived ? 'neutral' : 'success'} size="sm" shape="badge">
                            {isArchived ? 'В архіві' : 'Активний'}
                          </Pill>
                        </div>
                      </div>
                    </Card>
                  </div>
                </Surface>
              )}
            </div>
          )}
        </div>
      </div>

      {showSettings && project && (
        <BoardConfigModal
          project={project}
          organizationMembers={members}
          canManageTeam={can(orgRole, 'manage:team')}
          onArchive={handleArchiveProject}
          onUnarchive={handleRestoreProject}
          onDelete={handleDeleteProject}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* The composer belongs to the client. `clientMode` is what makes it the
          two fields they need instead of the agent's form — it is passed here,
          not re-implemented. */}
      {canOpenIncident && (
        <CreateTaskModal
          isOpen={showComposer}
          onClose={() => setShowComposer(false)}
          onSubmit={handleCreateIssue}
          teamMembers={[]}
          projectContext={{
            id: project.id,
            name: project.name,
            hiddenColumns: project.hiddenColumns || [],
          }}
          clientMode
        />
      )}

      {!clientViewer && (
        <InviteMemberDialog
          isOpen={showClientInvite}
          onClose={() => setShowClientInvite(false)}
          inviteMember={inviteMember}
          projectIds={[project.id]}
          spaceName={project.name}
          clientAdminMode
        />
      )}
    </>
  );
}
