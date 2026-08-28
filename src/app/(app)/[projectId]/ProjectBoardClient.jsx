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
  PriorityBadge,
  Select,
  StatusPill,
  Surface,
  TaskIdentity,
  UserAvatar,
} from '@/components/ui';
import {
  ArrowRight,
  CheckCircle2,
  CircleDotDashed,
  Inbox,
  Plus,
  Settings2,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import BoardConfigModal from '@/components/workspace/BoardConfigModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import InviteMemberDialog from '@/components/InviteMemberDialog';
import { useAppContext } from '@/lib/context/AppContext';
import { useIssues } from '@/lib/hooks/useIssues';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { can, isClientRole } from '@/lib/utils/can';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { timestampMillis } from '@/lib/utils/issueReadState.mjs';
import { activeMembers, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { PROJECT_OVER_PLAN_LIMIT } from '@/lib/utils/projectAccess.mjs';
import { statusCategoryOf } from '@/lib/utils/statusCategories.mjs';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import { archiveProject, deleteProject, restoreProject } from '@/lib/services/projects';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import useWorkspaceStore from '@/store/useWorkspaceStore';

const PROJECT_TABS = [
  { id: 'incidents', label: 'Інциденти' },
  { id: 'people', label: 'Люди' },
  { id: 'settings', label: 'Налаштування' },
];

const SCOPE_OPTIONS = [
  { value: 'open', label: 'Відкриті' },
  { value: 'all', label: 'Усі інциденти' },
  { value: 'resolved', label: 'Вирішені' },
];

function assigneeIdsOf(issue) {
  if (Array.isArray(issue?.assigneeIds)) return issue.assigneeIds.filter(Boolean);
  if (Array.isArray(issue?.assignees)) return issue.assignees.filter(Boolean);
  return issue?.assigneeId ? [issue.assigneeId] : [];
}

function formatUpdatedAt(value) {
  const millis = timestampMillis(value);
  if (!millis) return 'дату не вказано';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
}

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
    issues,
    loading: issuesLoading,
    error: issuesError,
    createIssue,
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
  const [showComposer, setShowComposer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showClientInvite, setShowClientInvite] = useState(false);

  useEffect(() => {
    if (resourceOrganizationId && resourceOrganizationId !== activeOrgId) {
      switchOrg(resourceOrganizationId);
    }
  }, [activeOrgId, resourceOrganizationId, switchOrg]);

  // External users have the focused «Мої звернення» portal at `/`. This route
  // is the tenant's customer-administration surface and must never expose it.
  useEffect(() => {
    if (clientViewer) router.replace('/');
  }, [clientViewer, router]);

  const memberById = useMemo(
    () => new Map((members || []).map(member => [member.id || member.uid, member])),
    [members],
  );
  const statusById = useMemo(
    () => new Map((statuses || []).map(status => [status.id, status])),
    [statuses],
  );
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

  const categorizedIssues = useMemo(() => (issues || []).map(issue => ({
    issue,
    category: statusCategoryOf(issue.columnId || issue.status, statuses),
  })), [issues, statuses]);
  const metrics = useMemo(() => {
    const open = categorizedIssues.filter(item => item.category !== 'done');
    return {
      open: open.length,
      new: open.filter(item => item.category === 'backlog' || item.category === 'todo').length,
      active: open.filter(item => item.category === 'in-progress' || item.category === 'review').length,
      resolved: categorizedIssues.filter(item => item.category === 'done').length,
      unassigned: open.filter(item => assigneeIdsOf(item.issue).length === 0).length,
    };
  }, [categorizedIssues]);
  const visibleIssues = useMemo(() => categorizedIssues
    .filter(({ issue, category }) => {
      if (scope === 'open' && category === 'done') return false;
      if (scope === 'resolved' && category !== 'done') return false;
      const assignees = assigneeIdsOf(issue);
      if (assigneeFilter === 'unassigned' && assignees.length > 0) return false;
      if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned' && !assignees.includes(assigneeFilter)) return false;
      return priorityFilter === 'all' || (issue.priority || NO_PRIORITY_ID) === priorityFilter;
    })
    .map(item => item.issue)
    .sort((left, right) => (
      timestampMillis(right.updatedAt || right.createdAt)
      - timestampMillis(left.updatedAt || left.createdAt)
    )), [assigneeFilter, categorizedIssues, priorityFilter, scope]);

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
    showToast('Інцидент створено');
    return { ...created, projectId };
  }, [actor, createIssue, projectId, showToast]);

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
  const isReadOnly = isArchived || project?.overPlanLimit === true;
  const tabs = PROJECT_TABS.map(tab => ({
    ...tab,
    count: tab.id === 'incidents'
      ? visibleIssues.length
      : tab.id === 'people'
        ? projectMembers.length
        : 0,
  }));

  if (clientViewer) return null;

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
            title="Клієнтський простір не знайдено"
            description="Його видалено або у вас більше немає доступу."
            action="До клієнтів"
            onAction={() => router.replace('/clients')}
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
                {canManageProject && (
                  <Button
                    onClick={() => setShowSettings(true)}
                    icon={Settings2}
                    size="icon-lg"
                    style="secondary"
                    title="Налаштування клієнта"
                    aria-label="Налаштування клієнта"
                  />
                )}
                {!isReadOnly && (
                  <Button
                    onClick={() => setShowComposer(true)}
                    icon={Plus}
                    size="lg"
                    style="primary"
                    color="dark"
                    collapseAt="sm"
                  >
                    Створити інцидент
                  </Button>
                )}
              </div>
            )}
            filters={activeTab === 'incidents' ? (
              <FilterBar>
                <Select
                  filterRole="status"
                  ariaLabel="Стан інцидентів"
                  variant="ghost"
                  value={scope}
                  onChange={setScope}
                  options={SCOPE_OPTIONS}
                />
                <Select
                  filterRole="member"
                  ariaLabel="Фільтр за виконавцем"
                  variant="ghost"
                  value={assigneeFilter}
                  onChange={setAssigneeFilter}
                  options={[
                    { value: 'all', label: 'Усі виконавці' },
                    { value: 'unassigned', label: 'Без виконавця' },
                    ...supportAssigneeOptions,
                  ]}
                />
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
              {(isArchived || project.overPlanLimit === true) && (
                <Alert
                  variant={isArchived ? 'info' : 'warning'}
                  title={isArchived ? 'Клієнтський простір в архіві' : 'Режим тільки для читання'}
                  description={isArchived
                    ? 'Історія та інциденти доступні, але нові звернення тут не створюються.'
                    : PROJECT_OVER_PLAN_LIMIT}
                />
              )}

              {activeTab === 'incidents' && (
                <>
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KpiCard icon={Inbox} value={metrics.open} label="Відкриті" sub={`${metrics.unassigned} без виконавця`} />
                    <KpiCard icon={Plus} value={metrics.new} label="Нові" sub="очікують першої реакції" />
                    <KpiCard icon={CircleDotDashed} value={metrics.active} label="У роботі" sub="разом із перевіркою" />
                    <KpiCard icon={CheckCircle2} value={metrics.resolved} label="Вирішені" sub="у цьому просторі" />
                  </div>

                  <Surface preset="panel" padding="md">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="ui-type-section-title text-ink">Інциденти клієнта</h2>
                        <p className="mt-1 text-[12px] text-muted">
                          Окрема черга цього клієнта. Загальна черга підтримки залишається у розділі «Інциденти».
                        </p>
                      </div>
                      <Pill tone={metrics.open ? 'info' : 'success'} size="sm" shape="badge">
                        {metrics.open ? `${metrics.open} відкритих` : 'Усе вирішено'}
                      </Pill>
                    </div>

                    {visibleIssues.length === 0 ? (
                      <EmptyState
                        icon={Inbox}
                        title={issues.length === 0 ? 'Інцидентів ще немає' : 'За цими фільтрами нічого немає'}
                        description={issues.length === 0
                          ? 'Створіть перший інцидент від імені підтримки або запросіть адміністратора клієнта.'
                          : 'Змініть стан, виконавця або пріоритет у фільтрах.'}
                        action={!isReadOnly && issues.length === 0 ? 'Створити інцидент' : null}
                        onAction={!isReadOnly && issues.length === 0 ? () => setShowComposer(true) : null}
                        density="compact"
                        surface="card"
                      />
                    ) : (
                      <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                        {visibleIssues.map(issue => {
                          const status = statusById.get(issue.columnId || issue.status);
                          const category = statusCategoryOf(issue.columnId || issue.status, statuses);
                          const assigneeId = assigneeIdsOf(issue)[0];
                          const assignee = assigneeId ? memberById.get(assigneeId) : null;
                          return (
                            <ListRow
                              key={issue.id}
                              density="roomy"
                              onClick={() => {
                                const href = issuePath(issue, project);
                                if (href) router.push(href);
                              }}
                              className="flex items-center gap-3"
                            >
                              <div className="min-w-0 flex-1">
                                <TaskIdentity issue={issue} project={project} done={category === 'done'} />
                                <p className="mt-1 truncate text-[13px] font-bold text-ink">
                                  {issue.title || 'Інцидент без назви'}
                                </p>
                                <p className="mt-1 text-[11px] text-faint">
                                  Оновлено {formatUpdatedAt(issue.updatedAt || issue.createdAt)}
                                </p>
                              </div>
                              <div className="hidden shrink-0 items-center gap-2 md:flex">
                                <PriorityBadge priority={issue.priority} priorities={priorities} />
                                <StatusPill label={status?.label || 'Без статусу'} color={status?.color} />
                              </div>
                              {assignee ? (
                                <UserAvatar user={assignee} size="sm" tooltip />
                              ) : (
                                <Pill tone="warning" size="sm" shape="badge">Без виконавця</Pill>
                              )}
                              <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
                            </ListRow>
                          );
                        })}
                      </Card>
                    )}
                  </Surface>
                </>
              )}

              {activeTab === 'people' && (
                <div className="grid items-start gap-[20px] xl:grid-cols-2">
                  <Surface preset="panel" padding="md">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="ui-type-section-title text-ink">Команда клієнта</h2>
                        <p className="mt-1 text-[12px] text-muted">
                          Зовнішні користувачі бачать тільки цей простір і його інциденти.
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
          canInvite={can(orgRole, 'manage:team')}
          onArchive={handleArchiveProject}
          onUnarchive={handleRestoreProject}
          onDelete={handleDeleteProject}
          onClose={() => setShowSettings(false)}
        />
      )}

      <CreateTaskModal
        isOpen={showComposer}
        onClose={() => setShowComposer(false)}
        onSubmit={handleCreateIssue}
        stages={project?.stages || []}
        teamMembers={supportMembers}
        projectContext={{
          id: project.id,
          name: project.name,
          hiddenColumns: project.hiddenColumns || [],
        }}
        entity="incident"
      />

      <InviteMemberDialog
        isOpen={showClientInvite}
        onClose={() => setShowClientInvite(false)}
        inviteMember={inviteMember}
        projects={[project]}
        projectIds={[project.id]}
        clientAdminMode
      />
    </>
  );
}
