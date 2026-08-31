'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  DetailSection,
  DistributionBar,
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
  CircleCheck,
  CircleDotDashed,
  Inbox,
  Kanban,
  MessageCircleReply,
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
import { isOnProjectTeam } from '@/lib/utils/projectAccess.mjs';
import { INCIDENT_TERMS_TABLE } from '@/lib/content/incidentTerms.mjs';
import { timestampMillis } from '@/lib/utils/issueReadState.mjs';
import { activeMembers, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { plural } from '@/lib/utils/plural.mjs';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { assigneeIdsOf, categorizeIssues, incidentQueueMetrics } from '@/lib/utils/incidentQueueMetrics.mjs';
import { summarizeCycleTimes } from '@/lib/utils/velocityMetrics.mjs';
import { reliableCompletedAtMillis } from '@/lib/utils/completionDates.mjs';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import { archiveProject, deleteProject, restoreProject } from '@/lib/services/projects';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import useWorkspaceStore from '@/store/useWorkspaceStore';

// Two tabs, not three. «Налаштування» was a third one whose body was a
// read-only copy of the client card plus a button that opened the very dialog
// the gear in the header opens. A tab is a place; that one led nowhere the
// header did not already lead.
const PROJECT_TABS = [
  { id: 'incidents', label: 'Звернення' },
  { id: 'people', label: 'Учасники' },
  // A third tab, and it reverses a guardrail: «простір клієнта — це черга, а не
  // другий дашборд», written on 2026-08-29 when four KPI tiles were sitting on
  // top of the board saying what the board's own columns already said. That
  // reasoning holds for tiles *above a queue* and does not reach a tab of its
  // own — nobody opens «Аналітика» by accident, and the numbers there are about
  // this one customer, which is the question «Огляд» cannot answer because it
  // counts every customer at once. The owner asked for it on 2026-08-31.
  { id: 'analytics', label: 'Аналітика' },
];

// The period filter's cutoff, resolved outside the component.
//
// «Створені за 7 днів» is a window measured from now, so it has to read the
// clock — and a clock read during render is an impurity React's own lint rule
// refuses, because two renders of the same state would disagree. «Звернення»
// already had this shape for the same reason: its `filterTasks` is a module
// function and reads the clock there. One helper, both screens' behaviour.
function periodCutoff(period) {
  const days = period === '7days' ? 7 : period === '30days' ? 30 : 0;
  return days ? Date.now() - days * 24 * 60 * 60 * 1000 : 0;
}

const SCOPE_OPTIONS = [
  { value: 'open', label: 'Відкриті' },
  { value: 'all', label: 'Усі звернення' },
  { value: 'resolved', label: 'Вирішені' },
];

// `onOpen` is optional, and its absence is a decision rather than an oversight.
// A customer may now read this screen, and the support half of it is a list of
// names — not doors: a support profile carries the projects that person is on,
// which is every other customer of this desk. So the client's own colleagues
// open, and the agents answering them do not.
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
        const Row = onOpen ? ListRow : 'div';
        return (
          <Row
            key={memberId}
            {...(onOpen ? { density: 'roomy', onClick: () => onOpen(memberId) } : {})}
            className={onOpen ? 'flex items-center gap-3' : 'flex items-center gap-3 px-4 py-4 sm:px-5'}
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
          </Row>
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
    types,
    loading: workflowLoading,
    error: workflowError,
  } = useWorkflowConfig();

  const [activeTab, setActiveTab] = useState('incidents');
  const [scope, setScope] = useState('open');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
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
  // Who «ми» are, for «Чекають на нас» — the same roster the assignee filter
  // is already drawn from, so the question costs no extra read.
  const supportUserIds = useMemo(
    () => new Set((members || [])
      .filter(member => !isClientRole(member.role))
      .map(member => member.id || member.uid)
      .filter(Boolean)),
    [members],
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
  const visibleIssues = useMemo(() => {
    const query = workspaceSearch.trim().toLocaleLowerCase('uk-UA');
    const cutoff = periodCutoff(periodFilter);
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
        // Type and period are offered to both readers. A client already reads
        // the type on the card and on the request itself, so filtering by it
        // tells them nothing the screen was not showing — unlike the assignee
        // above, which is the one filter whose very existence is a fact about
        // how the desk is organised.
        if (typeFilter !== 'all' && issue.type !== typeFilter) return false;
        if (cutoff && timestampMillis(issue.createdAt) < cutoff) return false;
        if (!query) return true;
        return [issue.issueKey, issue.title, issue.description]
          .some(value => String(value || '').toLocaleLowerCase('uk-UA').includes(query));
      })
      .map(item => item.issue)
      .sort((left, right) => (
        timestampMillis(right.updatedAt || right.createdAt)
        - timestampMillis(left.updatedAt || left.createdAt)
      ));
  }, [assigneeFilter, categorizedIssues, clientViewer, periodFilter, priorityFilter, scope, typeFilter, workspaceSearch]);
  usePublishLocalSearchResults(workspaceSearch, visibleIssues.length);

  // One customer's numbers, derived from the requests this screen already has.
  //
  // «Огляд» answers «як ідуть справи» across every customer at once, which is
  // the wrong shape for «як ідуть справи в цього». Nothing here is a second
  // read: the same `issues` array feeds the board, the list and this.
  const analytics = useMemo(() => {
    const metrics = incidentQueueMetrics(categorizedIssues, { supportUserIds });
    const cycle = summarizeCycleTimes(issues, reliableCompletedAtMillis);
    const bucketise = (source, keyOf) => {
      const counts = new Map();
      for (const issue of issues) {
        const key = keyOf(issue);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      return source
        .map(item => ({
          id: item.id,
          label: item.label,
          color: item.color,
          value: counts.get(item.id) || 0,
        }))
        .filter(item => item.value > 0);
    };
    return {
      metrics,
      cycle,
      byStatus: bucketise(statuses || [], issue => issue.columnId || issue.status),
      byType: bucketise(types || [], issue => issue.type),
      byPriority: bucketise(priorities || [], issue => issue.priority || NO_PRIORITY_ID),
    };
  }, [categorizedIssues, issues, priorities, statuses, supportUserIds, types]);

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
      // The customer's own answerable people. Never `assigneeIds`: support's
      // queue is routed by support, and the server keeps the two apart too.
      clientAssigneeIds: formData.clientAssignees || [],
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
      showToast('Проєкт архівовано', 'success');
      router.push('/clients');
      return true;
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося архівувати проєкт'), 'error');
      return false;
    }
  }, [router, showToast]);

  const handleRestoreProject = useCallback(async id => {
    try {
      await restoreProject(id);
      showToast('Проєкт відновлено');
      return true;
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося відновити проєкт'), 'error');
      return false;
    }
  }, [showToast]);

  const handleDeleteProject = useCallback(async id => {
    await deleteProject(id);
    showToast('Проєкт видалено');
    router.push('/clients');
  }, [router, showToast]);

  // «Команда клієнта» opens a person where they can actually be found. The rows
  // used to go to `/team?member=…`, and `/team` is the support roster — it
  // filters every client role out — so the id it was asked for was never in the
  // list and the screen selected whoever happened to be first instead. The
  // profile overlay the layout already mounts answers for any member of the
  // organization, which is what `HoverCard` uses everywhere else. Widening the
  // roster to hold customers was the other way to make that link true, and that
  // is a boundary, not a bug.
  const openClientProfile = useCallback(memberId => {
    const params = new URLSearchParams(window.location.search);
    params.set('member', memberId);
    router.push(`${window.location.pathname}?${params.toString()}`);
  }, [router]);

  const loading = !resourceContextReady
    || projectsLoading
    || issuesLoading
    || membersLoading
    || workflowLoading;
  const loadError = projectsError || issuesError || membersError || workflowError;
  const failure = loadError ? workspaceDataFailureCopy(loadError, isQuotaRefused()) : null;
  // Why this board looked nothing like the one on «Звернення», which is the
  // same component with the same cards. That screen gives kanban the viewport:
  // the page stops scrolling and the columns scroll inside themselves, which is
  // what makes a pipeline readable. Here the board was dropped into an ordinary
  // scrolling page with `min-h-[500px]`, so the columns ended wherever the
  // tallest one ended, the whole page scrolled instead of the columns, and the
  // header slid away with it. Same branch as `/my` now, and only for the case
  // it is about: a list scrolls, an empty state scrolls, a failure scrolls.
  const boardFillsScreen = activeTab === 'incidents'
    && viewMode === 'kanban'
    && !loadError
    && visibleIssues.length > 0;
  const canManageProject = can(orgRole, 'edit:project_settings');
  const canInviteClient = can(orgRole, 'manage:team');
  // A client administrator invites a colleague into the project they are
  // looking at. `/team` carries the same control while they hold exactly one
  // project; with several, «в який?» is a question that rail has nowhere to
  // ask, and this screen answers it by being open.
  const canInviteEmployee = orgRole === 'client_admin'
    && can(orgRole, 'invite:client_member')
    && isOnProjectTeam(project, currentUser?.uid || currentUser?.id);
  const isArchived = project?.status === 'archived';
  const isReadOnly = isArchived;
  // Only a client opens a request. Support receives it, works it and closes it —
  // an agent filing a customer's request on their behalf is how a support desk
  // stops being able to say who asked for what. The composer is therefore the
  // one action on this screen that belongs to the client and not to staff.
  const canOpenIncident = clientViewer && !isReadOnly;
  // Both tabs, both readers. «Учасники» was staff-only on the reasoning that a
  // customer's space is administered *about* them rather than *by* them — true
  // of the gear in the header, and not true of the roster: the people on this
  // space are their own colleagues and the agents answering them, and a
  // customer asking «хто цим займається з нашого боку» had nowhere to look.
  // What stays withheld is one step finer and unchanged: which agent holds a
  // particular request. A desk that will not say who works here is not
  // protecting its routing, it is hiding.
  const tabs = PROJECT_TABS
    .map(tab => ({
      ...tab,
      // A count where one means something. «Аналітика» is not a list, and a
      // number beside it would be a number about nothing.
      count: tab.id === 'incidents'
        ? visibleIssues.length
        : tab.id === 'people' ? projectMembers.length : undefined,
    }));

  if (loading) {
    return (
      <div role="status" aria-busy="true" className="flex min-h-[420px] flex-1 items-center justify-center">
        <LoadingSpinner size="md" label="Завантажуємо проєкт…" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-[420px] flex-1 items-center justify-center p-6">
        <Surface preset="panel" padding="lg" className="w-full max-w-[460px]">
          <EmptyState
            icon={Inbox}
            title="Проєкт не знайдено"
            description="Його видалено або у вас більше немає доступу."
            action={clientViewer ? null : 'До проєктів'}
            onAction={clientViewer ? null : () => router.replace('/clients')}
            context="page"
          />
        </Surface>
      </div>
    );
  }

  return (
    <>
      <div className={`flex-1 h-full bg-transparent ${boardFillsScreen
        ? 'overflow-hidden'
        : 'qt-nav-scroll overflow-y-auto overflow-x-hidden custom-scrollbar'}`}>
        <div className={`workspace-page-layout ${boardFillsScreen ? 'h-full pb-0' : 'min-h-full pb-[120px]'}`}>
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
                    title="Налаштування проєкту"
                    aria-label="Налаштування проєкту"
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
              </div>
            )}
            filters={activeTab === 'incidents' ? (
              <div className="flex w-full items-center justify-between">
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
                <Select
                  filterRole="type"
                  ariaLabel="Фільтр за типом"
                  variant="ghost"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { value: 'all', label: 'Усі типи' },
                    ...(types || []).map(taskTypeSelectOption),
                  ]}
                />
                <Select
                  filterRole="date"
                  ariaLabel="Фільтр за періодом створення"
                  variant="ghost"
                  value={periodFilter}
                  onChange={setPeriodFilter}
                  options={[
                    { value: 'all', label: 'За весь час' },
                    { value: '7days', label: 'Створені за 7 днів' },
                    { value: '30days', label: 'Створені за 30 днів' },
                  ]}
                />
              </FilterBar>

              {/* Opposite the filters, which is where «Звернення» puts it and
                  where this screen did not: it sat up in the header beside
                  «Створити звернення», so one product had its board/list
                  switcher in two different places depending on which board you
                  were looking at. Desktop only — below md there is no list, and
                  the board is the view built for a narrow screen. */}
              <div className="ml-auto flex items-center gap-2 max-md:hidden">
                <Tabs
                  tabs={[
                    { id: 'kanban', icon: Kanban, title: 'Дошка', ariaLabel: 'Дошка' },
                    { id: 'list', icon: List, title: 'Список', ariaLabel: 'Список' },
                  ]}
                  activeTab={viewMode}
                  onTabChange={setViewMode}
                />
              </div>
              </div>
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
            <div className={`flex flex-col gap-[20px] ${boardFillsScreen ? 'min-h-0 flex-1' : ''}`}>
              {isArchived && (
                <Alert
                  variant="info"
                  title="Проєкт в архіві"
                  description="Історія та листування доступні, але нові звернення тут не створюються."
                />
              )}

              {activeTab === 'incidents' && (
                <>
                  {/* No counters above the board. A client space is one
                      customer's queue, and the board already says where every
                      request in it stands — the four tiles that used to be here
                      were «Огляд» drawn a second time, one client wide. */}
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
                        members={clientViewer ? clientMembers : members}
                        showAssignee
                        assigneeSource={clientViewer ? 'client' : 'support'}
                        projects={[project]}
                        projectId={project.id}
                        project={project}
                        readOnly={clientViewer}
                        isArchived={isArchived}
                        onMoveIssue={clientViewer ? undefined : handleMoveIssue}
                        onBulkUpdate={clientViewer ? undefined : handleBulkUpdate}
                        canArchive={!clientViewer && canWhileRoleLoads(orgRole, 'delete:issue')}
                        selectionScopeKey={`${project.id}|${scope}|${assigneeFilter}|${priorityFilter}|${typeFilter}|${periodFilter}`}
                      />
                    </div>
                  ) : (
                    <TaskListView
                      issues={visibleIssues}
                      allIssues={issues}
                      members={clientViewer ? clientMembers : members}
                      showAssignee
                      assigneeSource={clientViewer ? 'client' : 'support'}
                      projects={[project]}
                      projectId={project.id}
                      projectName={project.name}
                      onBulkUpdate={clientViewer ? undefined : handleBulkUpdate}
                      bulkProgress={clientViewer ? null : bulkProgress}
                      canArchive={!clientViewer && canWhileRoleLoads(orgRole, 'delete:issue')}
                      selectionScopeKey={`${project.id}|${scope}|${assigneeFilter}|${priorityFilter}|${typeFilter}|${periodFilter}`}
                      emptyTitle="Звернень не знайдено"
                      emptyDescription="Змініть стан або пріоритет у фільтрах."
                    />
                  )}
                </>
              )}

              {activeTab === 'analytics' && (
                <div className="flex flex-col gap-[20px]">
                  <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <KpiCard icon={Inbox} value={analytics.metrics.open} label="Відкриті" sub="ще в роботі" />
                    <KpiCard icon={CircleCheck} value={analytics.metrics.resolved} label="Вирішені" sub="за весь час" />
                    {/* The mirror of the overview's pair, read from whichever
                        side of the desk is looking. A customer is never told
                        what the desk owes *other* customers, and never told
                        which agent owes it. */}
                    <KpiCard
                      icon={MessageCircleReply}
                      value={clientViewer ? analytics.metrics.waitingOnClient : analytics.metrics.waitingOnUs}
                      label={clientViewer ? 'Чекають на вас' : 'Чекають на нас'}
                      sub={clientViewer ? 'підтримка відповіла останньою' : 'клієнт написав останнім'}
                    />
                    {/* Measured, never promised. This is how long requests have
                        actually taken; it is not a target, and qTicket has no
                        SLA to compare it against — the owner rejected those
                        outright, and a median that quietly becomes a promise is
                        how one grows back. `sampleSize` is on the card because
                        a median of two requests is not a fact about a desk. */}
                    <KpiCard
                      icon={CircleDotDashed}
                      value={analytics.cycle.medianDays === null ? '—' : `${analytics.cycle.medianDays} д`}
                      label="Медіанний час до вирішення"
                      sub={analytics.cycle.sampleSize
                        ? `за ${analytics.cycle.sampleSize} ${plural(analytics.cycle.sampleSize, ['зверненням', 'зверненнями', 'зверненнями'])}`
                        : 'ще нема вирішених'}
                    />
                  </div>

                  <div className="grid items-start gap-[20px] xl:grid-cols-3">
                    <Surface preset="panel" padding="md">
                      <DetailSection density="panel" title="За статусом" description="Де зараз стоять звернення цього проєкту.">
                        <DistributionBar items={analytics.byStatus} emptyLabel="Звернень ще немає" />
                      </DetailSection>
                    </Surface>
                    <Surface preset="panel" padding="md">
                      <DetailSection density="panel" title="За типом" description="Про що звертаються найчастіше.">
                        <DistributionBar items={analytics.byType} emptyLabel="Звернень ще немає" />
                      </DetailSection>
                    </Surface>
                    <Surface preset="panel" padding="md">
                      <DetailSection density="panel" title="За пріоритетом" description="Наскільки терміновими їх позначили.">
                        <DistributionBar items={analytics.byPriority} emptyLabel="Звернень ще немає" />
                      </DetailSection>
                    </Surface>
                  </div>
                </div>
              )}

              {activeTab === 'people' && (
                <div className="grid items-start gap-[20px] xl:grid-cols-2">
                  <Surface preset="panel" padding="md">
                    <DetailSection
                      density="panel"
                      title={clientViewer ? 'Ваші співробітники' : 'Команда клієнта'}
                      description={clientViewer
                        ? 'Люди з вашого боку, які бачать звернення цього проєкту.'
                        : 'Зовнішні користувачі бачать тільки цей проєкт і його звернення.'}
                      action={(canInviteClient || canInviteEmployee) ? (
                        <Button
                          onClick={() => setShowClientInvite(true)}
                          icon={UserPlus}
                          style="secondary"
                          size="md"
                          collapseAt="sm"
                        >
                          {canInviteClient ? 'Запросити клієнта' : 'Запросити співробітника'}
                        </Button>
                      ) : null}
                    >
                    <MemberList
                      members={clientMembers}
                      emptyTitle={clientViewer ? 'Тут поки лише ви' : 'Клієнта ще не запрошено'}
                      emptyDescription={clientViewer
                        ? 'Запросити колегу можна в розділі «Співробітники».'
                        : 'Додайте адміністратора клієнта. Після входу він зможе запросити своїх співробітників.'}
                      onOpen={openClientProfile}
                    />
                    </DetailSection>
                  </Surface>

                  <Surface preset="panel" padding="md">
                    <DetailSection
                      density="panel"
                      title="Команда підтримки"
                      description={clientViewer
                        ? 'Хто з боку підтримки веде цей проєкт.'
                        : 'Внутрішні працівники, закріплені за цим проєктом.'}
                    >
                    <MemberList
                      members={supportMembers}
                      emptyTitle="Підтримку ще не призначено"
                      emptyDescription={clientViewer
                        ? 'Щойно за вашим проєктом закріплять працівників, вони зʼявляться тут.'
                        : 'Додайте внутрішніх працівників у налаштуваннях проєкту.'}
                      // Names, not doors, for a customer: `/team` is the staff
                      // roster and the profile behind it lists the other
                      // customers that person works with.
                      onOpen={clientViewer
                        ? undefined
                        : memberId => router.push(`/team?member=${encodeURIComponent(memberId)}`)}
                    />
                    </DetailSection>
                  </Surface>
                </div>
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
          /* Their colleagues, not the support roster: the only people a client
             may name are the ones on their own side of this space. */
          teamMembers={clientMembers}
          projectContext={{
            id: project.id,
            name: project.name,
            hiddenColumns: project.hiddenColumns || [],
          }}
          clientMode
        />
      )}

      {/* One dialog, two grants, and which one is decided by who opened it —
          never by a control inside it. Staff seat a client administrator;
          that administrator adds their own colleagues. The role is fixed here,
          again in the invitation route, and a third time in `firestore.rules`. */}
      {(canInviteClient || canInviteEmployee) && (
        <InviteMemberDialog
          isOpen={showClientInvite}
          onClose={() => setShowClientInvite(false)}
          inviteMember={inviteMember}
          projectIds={[project.id]}
          spaceName={project.name}
          {...(canInviteClient ? { clientAdminMode: true } : { clientMode: true })}
        />
      )}
    </>
  );
}
