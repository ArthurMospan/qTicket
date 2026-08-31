'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  DetailSection,
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
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  CircleDotDashed,
  Inbox,
  MessageCircleReply,
  Plus,
  UsersRound,
} from 'lucide-react';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useOrganizationIssues } from '@/lib/hooks/useOrganizationIssues';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { can, isClientRole } from '@/lib/utils/can';
import { INCIDENT_TERMS_TABLE } from '@/lib/content/incidentTerms.mjs';
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

/**
 * «Огляд» — one screen that knows who is looking.
 *
 * It used to be support's screen and nothing else: a client who reached the
 * address was redirected off it, and their own front door opened their space
 * instead. That made the product's first screen a thing only half its users
 * had, and it made the obvious second answer — a separate customer dashboard —
 * the only way to give them one. Two screens counting the same records is how
 * «У роботі» came to mean two different numbers once already.
 *
 * So the counters, the reads and the shell are one, and what differs is what
 * the reader is entitled to. Support sees the whole desk: five tiles, every
 * client's queue, who owes what and which requests have nobody on them. A
 * customer sees their own three: what is open, what is standing on them, and
 * what is finished — and the button to open a new request, which is the one
 * control that exists here for them and deliberately not for support.
 *
 * Three things the customer's half never draws, and they are the reason it is a
 * branch rather than a filtered copy: who is assigned (routing is how the desk
 * organises itself, not a fact about their request), the list of clients (there
 * is one and it is theirs), and any resolution date — a date a customer can
 * read is a promised resolution time, and qTicket promises none.
 */
export default function OverviewPage() {
  const router = useRouter();
  const {
    activeOrgId,
    orgRole,
    projects,
    projectsLoading,
    projectsError,
  } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  const canCreateClient = can(orgRole, 'create:project');
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
  // A client holds exactly one space, and every address on their half of this
  // screen leads into it — the list, the rows, and the composer.
  const clientSpace = activeProjects[0] || null;
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

  const memberById = useMemo(
    () => new Map((members || []).map(member => [member.id || member.uid, member])),
    [members],
  );
  // Who «ми» are, for «Чекають на нас» and for its mirror «Чекають на вас». The
  // roster is already on this screen — support draws the assignee faces from it
  // — so knowing whose word was last in a request costs no extra read for
  // either reader.
  const supportUserIds = useMemo(
    () => new Set((members || [])
      .filter(member => !isClientRole(member.role))
      .map(member => member.id || member.uid)
      .filter(Boolean)),
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
  const metrics = useMemo(
    () => incidentQueueMetrics(categorizedIssues, { supportUserIds }),
    [categorizedIssues, supportUserIds],
  );
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

  const loading = projectsLoading || issuesLoading || membersLoading || workflowLoading;
  const loadError = projectsError || issuesError || membersError || workflowError;
  const failure = loadError
    ? workspaceDataFailureCopy(loadError, isQuotaRefused())
    : null;
  const loadingLabel = clientViewer
    ? 'Завантажуємо ваші звернення…'
    : 'Завантажуємо чергу підтримки…';

  return (
    <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
      <div className="workspace-page-layout min-h-full pb-[120px]">
        {/* «Створити звернення» belongs to the customer's half and only to it.
            Only a client opens a request — support receives it, works it and
            closes it — so the front door of the support side has nothing to
            create, and the same header on the same screen carries the control
            for the one reader who may use it. */}
        <PageHeader
          title={clientViewer ? 'Огляд' : 'Огляд підтримки'}
          actions={clientViewer && clientSpace ? (
            <Button
              onClick={() => router.push(`/${encodeURIComponent(clientSpace.id)}?new=1`)}
              icon={Plus}
              size="lg"
              style="primary"
              color="dark"
              collapseAt="sm"
            >
              {INCIDENT_TERMS_TABLE.composerSubmit}
            </Button>
          ) : null}
        />

        {loading ? (
          <div role="status" aria-busy="true" className="flex min-h-[420px] items-center justify-center">
            <LoadingSpinner size="md" label={loadingLabel} />
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
        ) : clientViewer ? (
          <div className="flex flex-col gap-[20px]">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <KpiCard
                icon={Inbox}
                value={metrics.open}
                label="Відкриті"
                sub={metrics.open ? 'ще в роботі' : 'усе вирішено'}
              />
              {/* The mirror of support's «Чекають на нас», read from this side
                  of the same conversation: we answered last, so the next word
                  is theirs. Computed by `incidentQueueMetrics`, not here — the
                  tile a customer reads and the tile the desk reads have to be
                  the same fact seen from two chairs, not two formulas. */}
              <KpiCard
                icon={MessageCircleReply}
                value={metrics.waitingOnClient}
                label="Чекають на вас"
                sub={metrics.waitingOnClient ? 'підтримка відповіла останньою' : 'нових відповідей немає'}
              />
              <KpiCard
                icon={CircleCheck}
                value={metrics.resolved}
                label="Вирішені"
                sub="за весь час"
              />
            </div>

            <Surface preset="panel" padding="md">
              <DetailSection
                density="panel"
                title="Останні оновлення"
                description="Ваші звернення, у яких щось змінилося найпізніше."
                action={clientSpace ? (
                  <Button
                    onClick={() => router.push(`/${encodeURIComponent(clientSpace.id)}`)}
                    style="secondary"
                    size="md"
                    icon={ArrowRight}
                  >
                    Усі звернення
                  </Button>
                ) : null}
              >
                {recentIssues.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="Звернень ще немає"
                    description="Опишіть проблему — підтримка побачить її одразу."
                    action={clientSpace ? INCIDENT_TERMS_TABLE.composerSubmit : undefined}
                    onAction={clientSpace
                      ? () => router.push(`/${encodeURIComponent(clientSpace.id)}?new=1`)
                      : undefined}
                    density="compact"
                    surface="card"
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    {/* The kit's row, with the assignee column absent rather
                        than empty. `showAssignee={false}` is what drops it —
                        see `TaskRow`: an empty column still tells the customer
                        that a routing decision exists. */}
                    {recentIssues.map(issue => (
                      <TaskRow
                        key={issue.id}
                        issue={issue}
                        issues={issues}
                        projectId={issue.projectId}
                        projectName={projectById.get(issue.projectId)?.name}
                        showAssignee={false}
                        onClick={() => {
                          const href = issuePath(issue, projectById.get(issue.projectId) || issue.projectId);
                          if (href) router.push(href);
                        }}
                      />
                    ))}
                  </div>
                )}
              </DetailSection>
            </Surface>
          </div>
        ) : (
          <div className="flex flex-col gap-[20px]">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <KpiCard
                icon={Inbox}
                value={metrics.open}
                label="Відкриті звернення"
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
              {/* The one figure a status board cannot give you. «У роботі» says
                  what we are doing; this says what we owe — the customer wrote
                  last and nobody here has answered since. It leads to the same
                  set it counts: the queue, filtered by the same predicate. */}
              <KpiCard
                icon={MessageCircleReply}
                value={metrics.waitingOnUs}
                label="Чекають на нас"
                sub={metrics.waitingOnUs ? 'клієнт написав останнім' : 'усім відповіли'}
                onClick={() => router.push('/my?waiting=us')}
              />
              {/* «Відповідальний», not support's own shorter word for the seat.
                  This screen is shared with the customer now, and a word kept
                  one branch away from the person it is hidden from is a word
                  the product has already leaked twice by moving the branch. */}
              <KpiCard
                icon={UsersRound}
                value={metrics.unassigned}
                label="Без відповідального"
                sub={metrics.unassigned ? 'потребують розподілу' : 'чергу розподілено'}
              />
            </div>

            <div className="grid items-start gap-[20px] xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.8fr)]">
              <Surface preset="panel" padding="md">
                <DetailSection
                  density="panel"
                  title="Нещодавно оновлені"
                  description="Останні зміни у зверненнях усіх доступних клієнтів."
                  action={(
                    <Button onClick={() => router.push('/my')} style="secondary" size="md" icon={ArrowRight}>
                      Вся черга
                    </Button>
                  )}
                >
                {recentIssues.length === 0 ? (
                  <EmptyState
                    icon={Inbox}
                    title="Звернень ще немає"
                    description="Запросіть клієнта до підготовленого для нього простору — звернення відкриває він."
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
                              {issue.title || 'Звернення без назви'}
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
                            <Pill tone="warning" size="sm" shape="badge">Без відповідального</Pill>
                          )}
                          <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
                        </ListRow>
                      );
                    })}
                  </Card>
                )}
                </DetailSection>
              </Surface>

              <Surface preset="panel" padding="md">
                <DetailSection
                  density="panel"
                  title="Клієнти"
                  description="Відкриті звернення за просторами."
                  action={(
                    <Button onClick={() => router.push('/clients')} style="secondary" size="md" icon={ArrowRight}>
                      Усі
                    </Button>
                  )}
                >
                {projectSummary.length === 0 ? (
                  <EmptyState
                    icon={UsersRound}
                    title="Клієнтів ще немає"
                    description={canCreateClient
                      ? 'Створіть окремий простір для першого клієнта.'
                      : 'Простір для клієнта створює адміністратор підтримки.'}
                    // Only offered to somebody who may actually take it. This
                    // sent every internal role to `/clients?new=1`, and a member
                    // does not hold `create:project` — the address opened the
                    // dialog anyway and the server refused what it submitted.
                    action={canCreateClient ? 'Додати клієнта' : undefined}
                    onAction={canCreateClient ? () => router.push('/clients?new=1') : undefined}
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
                            {open} відкритих · {unassigned} без відповідального
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
                </DetailSection>
              </Surface>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
