'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  KpiCard,
  ListRow,
  LoadingSpinner,
  PageHeader,
  Pill,
  PriorityBadge,
  StatusPill,
  Surface,
  TaskIdentity,
  UserAvatar,
} from '@/components/ui';
import {
  AlertTriangle,
  ArrowRight,
  CircleDotDashed,
  Inbox,
  Plus,
  UsersRound,
} from 'lucide-react';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useOrganizationIssues } from '@/lib/hooks/useOrganizationIssues';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { isClientRole } from '@/lib/utils/can';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { statusCategoryOf } from '@/lib/utils/statusCategories.mjs';
import { assigneeIdsOf, categorizeIssues, incidentQueueMetrics } from '@/lib/utils/incidentQueueMetrics.mjs';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';

function timestampMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUpdatedAt(value) {
  const millis = timestampMillis(value);
  if (!millis) return 'дата не вказана';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
}

export default function SupportOverviewPage() {
  const router = useRouter();
  const {
    activeOrgId,
    orgRole,
    projects,
    projectsLoading,
    projectsError,
  } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  const activeProjects = useMemo(
    () => (projects || []).filter(project => project.status !== 'archived'),
    [projects],
  );
  const projectIds = useMemo(
    () => activeProjects.map(project => project.id).filter(Boolean),
    [activeProjects],
  );
  const projectById = useMemo(
    () => new Map(activeProjects.map(project => [project.id, project])),
    [activeProjects],
  );
  const {
    issues,
    loading: issuesLoading,
    error: issuesError,
  } = useOrganizationIssues(activeOrgId, projectIds);
  const {
    members,
    loading: membersLoading,
    error: membersError,
  } = useOrganization();
  const {
    statuses,
    priorities,
    loading: workflowLoading,
    error: workflowError,
  } = useWorkflowConfig();

  useEffect(() => {
    if (orgRole && clientViewer) router.replace('/');
  }, [clientViewer, orgRole, router]);

  const memberById = useMemo(
    () => new Map((members || []).map(member => [member.id || member.uid, member])),
    [members],
  );
  const statusById = useMemo(
    () => new Map((statuses || []).map(status => [status.id, status])),
    [statuses],
  );
  const categorizedIssues = useMemo(
    () => categorizeIssues(issues, statuses),
    [issues, statuses],
  );
  // The same counters, from the same rules, as the ones over a single
  // customer's queue. «У роботі» used to mean two different things on the two
  // screens — see `incidentQueueMetrics`.
  const metrics = useMemo(() => incidentQueueMetrics(categorizedIssues), [categorizedIssues]);
  const openIssues = useMemo(
    () => categorizedIssues.filter(entry => entry.category !== 'done'),
    [categorizedIssues],
  );
  const recentIssues = useMemo(
    () => [...(issues || [])]
      .sort((left, right) => timestampMillis(right.updatedAt || right.createdAt)
        - timestampMillis(left.updatedAt || left.createdAt))
      .slice(0, 8),
    [issues],
  );
  const projectSummary = useMemo(() => activeProjects
    .map(project => {
      const projectOpen = openIssues.filter(item => item.issue.projectId === project.id);
      return {
        project,
        open: projectOpen.length,
        unassigned: projectOpen.filter(item => assigneeIdsOf(item.issue).length === 0).length,
      };
    })
    .sort((left, right) => right.open - left.open || left.project.name.localeCompare(right.project.name, 'uk-UA'))
    .slice(0, 6), [activeProjects, openIssues]);

  if (clientViewer) return null;

  const loading = projectsLoading || issuesLoading || membersLoading || workflowLoading;
  const loadError = projectsError || issuesError || membersError || workflowError;
  const failure = loadError
    ? workspaceDataFailureCopy(loadError, isQuotaRefused())
    : null;

  return (
    <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
      <div className="workspace-page-layout min-h-full pb-[120px]">
        <PageHeader
          title="Огляд підтримки"
          actions={(
            <Button
              onClick={() => router.push('/my?new=1')}
              icon={Plus}
              size="lg"
              style="primary"
              color="dark"
              collapseAt="sm"
              title="Створити інцидент"
            >
              Створити інцидент
            </Button>
          )}
        />

        {loading ? (
          <div role="status" aria-busy="true" className="flex min-h-[420px] items-center justify-center">
            <LoadingSpinner size="md" label="Завантажуємо чергу підтримки…" />
          </div>
        ) : loadError ? (
          <div className="mx-auto flex min-h-[420px] max-w-[520px] flex-col justify-center gap-3">
            <Alert
              variant="error"
              title={failure.title}
              description={failure.description}
            />
            <Button onClick={() => window.location.reload()} style="secondary" size="md">
              Спробувати ще раз
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-[20px]">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard
                icon={Inbox}
                value={metrics.open}
                label="Відкриті інциденти"
                sub={`у ${activeProjects.length} клієнтських просторах`}
              />
              <KpiCard
                icon={AlertTriangle}
                value={metrics.new}
                label="Нові"
                sub="ще не взяті в роботу"
              />
              <KpiCard
                icon={CircleDotDashed}
                value={metrics.active}
                label="У роботі"
                sub={`${metrics.review} очікують відповіді`}
              />
              <KpiCard
                icon={UsersRound}
                value={metrics.unassigned}
                label="Без виконавця"
                sub={metrics.unassigned ? 'потребують розподілу' : 'чергу розподілено'}
              />
            </div>

            <div className="grid items-start gap-[20px] xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <Surface preset="panel" padding="md">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="ui-type-section-title text-ink">Нещодавно оновлені</h2>
                    <p className="mt-1 text-[12px] text-muted">Останні зміни в інцидентах усіх доступних клієнтів.</p>
                  </div>
                  <Button onClick={() => router.push('/my')} style="secondary" size="md" icon={ArrowRight}>
                    Вся черга
                  </Button>
                </div>

                {recentIssues.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="Інцидентів ще немає"
                    description="Створіть перший інцидент або запросіть клієнта до підготовленого для нього простору."
                    action="Створити інцидент"
                    onAction={() => router.push('/my?new=1')}
                    density="compact"
                    surface="card"
                  />
                ) : (
                  <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                    {recentIssues.map(issue => {
                      const project = projectById.get(issue.projectId);
                      const status = statusById.get(issue.columnId || issue.status);
                      const category = statusCategoryOf(issue.columnId || issue.status, statuses);
                      const assigneeId = assigneeIdsOf(issue)[0];
                      const assignee = assigneeId ? memberById.get(assigneeId) : null;
                      return (
                        <ListRow
                          key={issue.id}
                          density="roomy"
                          onClick={() => {
                            const href = issuePath(issue, project || issue.projectId);
                            if (href) router.push(href);
                          }}
                          className="flex items-center gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <TaskIdentity
                              issue={issue}
                              project={project}
                              projectName={project?.name}
                              showProjectName
                              done={category === 'done'}
                            />
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

              <Surface preset="panel" padding="md">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="ui-type-section-title text-ink">Клієнти</h2>
                    <p className="mt-1 text-[12px] text-muted">Відкриті інциденти за просторами.</p>
                  </div>
                  <Button onClick={() => router.push('/clients')} style="secondary" size="md" icon={ArrowRight}>
                    Усі
                  </Button>
                </div>

                {projectSummary.length === 0 ? (
                  <EmptyState
                    icon={UsersRound}
                    title="Клієнтів ще немає"
                    description="Створіть окремий простір для першого клієнта."
                    action="Додати клієнта"
                    onAction={() => router.push('/clients?new=1')}
                    density="compact"
                    surface="card"
                  />
                ) : (
                  <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                    {projectSummary.map(({ project, open, unassigned }) => (
                      <ListRow
                        key={project.id}
                        density="roomy"
                        onClick={() => router.push(`/${encodeURIComponent(project.id)}`)}
                        className="flex items-center gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-bold text-ink">{project.name}</p>
                          <p className="mt-1 text-[11px] text-muted">
                            {open} відкритих · {unassigned} без виконавця
                          </p>
                        </div>
                        <Pill tone={open ? 'info' : 'success'} size="sm" shape="badge">
                          {open || 'Усе вирішено'}
                        </Pill>
                        <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
                      </ListRow>
                    ))}
                  </Card>
                )}
              </Surface>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
