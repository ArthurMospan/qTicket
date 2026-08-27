'use client';
// src/app/workspace/analytics/page.js — Workspace-wide analytics + invoices (admin/owner only)
// Огляд = швидкий стан воркспейсу; Продуктивність = тренди; Табель = час;
// Команда = навантаження; Рахунок = клієнтські рахунки. Всі контроли табу (період,
// тиждень/місяць, учасник, навігація) живуть в ОДНОМУ FilterBar під табами.
import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import {
  BarChart2, AlertTriangle, Clock, Folders, Users, Zap, Target, Receipt,
  ChevronLeft, ChevronRight, Plus,
} from 'lucide-react';
import { useAnalyticsRollups } from '@/lib/hooks/useAnalyticsRollups';
import { useMinuteClock } from '@/lib/hooks/useMinuteClock';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkspaceAnalytics } from '@/lib/hooks/useWorkspaceAnalytics';
import { getCompletedAtMillis, useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import AttentionPanel from '@/components/workspace/AttentionPanel';
import BillingTab from '@/components/workspace/BillingTab';
import TimesheetTab from '@/components/workspace/TimesheetTab';
import WorkloadTab from '@/components/workspace/WorkloadTab';
import VelocityTab from '@/components/workspace/VelocityTab';
import {
  BarList, Button, ChartCard, DataTable, EmptyState, ExportMenu, KpiCard, LoadingSpinner,
  Meter, PageHeader, RefreshStamp, Segmented, Surface, TaskListCard,
} from '@/components/ui';
import { useLocalization } from '@/lib/hooks/useLocalization';
import { buildOverviewExport } from '@/lib/utils/analyticsExport.mjs';
import { Select, MultiSelect } from '@/components/ui/Select';
import FilterBar from '@/components/ui/FilterBar';
import { isDueDateOverdue } from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import { can } from '@/lib/utils/can';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { usePlanLimits } from '@/lib/hooks/usePlanLimits';
import { PlanCrownIcon } from '@/lib/design/icons';
import { planAllows } from '@/lib/utils/plans.mjs';
import { PlanGate } from '@/components/ui';
import { useCalendarEvents } from '@/lib/hooks/useCalendarEvents';
import { calendarEventOccurrenceKey } from '@/lib/utils/calendarEventNavigation.mjs';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import {
  effectiveTimeLogMillis,
  isCalendarEventTimeLog,
} from '@/lib/utils/timeLogDates.mjs';
import {
  filterTeamIssues,
  memberAnalyticsHref,
} from '@/lib/utils/teamAnalytics.mjs';
import {
  ANALYTICS_PERIOD_DAYS,
  dayRangeTimeLogWindow,
  periodDayRange,
  timesheetTimeLogWindow,
} from '@/lib/utils/analyticsWindow.mjs';
import {
  summarizeRawTimeLogs,
  summarizeRollups,
} from '@/lib/utils/analyticsRollups.mjs';
import { openBlockerIssues } from '@/lib/utils/issueExecution.mjs';
import {
  backlogStatusIds,
  inProgressStatusIds,
} from '@/lib/utils/statusCategories.mjs';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { priorityPresentation, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { plural } from '@/lib/utils/plural.mjs';
import {
  analyticsDateKey,
  analyticsDateParam,
  analyticsPeriodParam,
  analyticsTabParam,
  commaListParam,
  setSearchParam,
  timesheetModeParam,
} from '@/lib/utils/analyticsUrlState.mjs';

// ── Helpers ─────────────────────────────────────────────────────────
function fmtH(min) {
  if (!min) return '0г';
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}г ${m}хв` : `${h}г`) : `${m}хв`;
}

function FilterDivider() {
  return <span className="w-[1px] h-[16px] bg-line mx-[2px] shrink-0" />;
}

// ── ОГЛЯД: стан воркспейсу «на зараз» ────────────────────────────────
// Детальні графіки активності/трендів живуть у «Продуктивності»,
// а навантаження по людях — у «Команді»; тут їх свідомо немає.
function AnalyticsContent({
  projects,
  issues,
  issueReferenceIssues,
  issueLinks,
  // The period's hours already summed — from the daily totals when the screen's
  // filters are about days, from the logs themselves when they are about tasks.
  // Either way this component gets a figure and never a collection, because
  // «скільки часу за 30 днів» is a question the records should not have to be
  // opened to answer.
  periodTime,
  members,
  loading,
  now,
  period,
  onTabChange,
  onExportReady,
  selectedProjectIds = [],
}) {
  const { activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const { statuses, closedStatusIds, deliveredStatusIds } = useWorkflowConfig();
  // Closed answers "is there work left" — overdue, blockers, open counts.
  // Delivered answers "was anything produced" — completion, velocity. They are
  // the same set of statuses today and stay two questions, because a caller
  // that asks the wrong one is a bug nobody sees until the numbers are read.
  const closedSet = useMemo(() => new Set(closedStatusIds), [closedStatusIds]);
  const deliveredSet = useMemo(() => new Set(deliveredStatusIds), [deliveredStatusIds]);
  // Work still in the backlog is not expected to carry an estimate. That used to
  // be read as "the first status in the list", which is a position, not a
  // meaning — and it missed every other backlog column an org had added.
  const backlogSet = useMemo(() => new Set(backlogStatusIds(statuses)), [statuses]);
  // «У роботі» is a category, never the literal id 'in-progress': an org that
  // renamed or split that column used to report zero here.
  const inProgressSet = useMemo(() => new Set(inProgressStatusIds(statuses)), [statuses]);
  // The shape behind the headline figure. A tile that says "18 closed" and a
  // tile that says "18 closed, and it was 3 all of last week" are different
  // facts, and the row only ever showed the first.
  const closedTrend = useMemo(() => {
    const buckets = Math.min(Math.max(Math.round(period / 3), 6), 14);
    const span = (period * 86_400_000) / buckets;
    const start = now - period * 86_400_000;
    return Array.from({ length: buckets }, (_, index) => {
      const from = start + index * span;
      const to = from + span;
      return issues.filter(issue => {
        if (!deliveredSet.has(issue.columnId || issue.status)) return false;
        const at = getCompletedAtMillis(issue);
        return at >= from && at < to;
      }).length;
    });
  }, [deliveredSet, issues, now, period]);

  const stats = useMemo(() => {
    const periodAgo = now - period * 24 * 3600 * 1000;

    // Every finding keeps its tasks, not just its count. «Без виконавця 14»
    // used to be the end of the sentence: the number was computed from a filter
    // and the filter was thrown away, so the one screen that knew which
    // fourteen tasks they were had no way to show them.
    // `total` is read by one thing only — whether this screen has anything to
    // show at all. It stopped being a headline figure when the tiles were put
    // on one calendar: a completion rate over the whole life of a workspace
    // only ever climbs, and it was sitting next to two figures for the period.
    const total      = issues.length;
    const open       = issues.filter(i => !closedSet.has(i.columnId || i.status));
    const inProgress = issues.filter(i => inProgressSet.has(i.columnId || i.status)).length;
    const blockerPriority = open.filter(i => i.priority === 'blocker');
    const dependencyBlocked = open.filter(i => openBlockerIssues(
      i.id,
      issueReferenceIssues,
      issueLinks,
      closedSet,
    ).length > 0);

    const overdue = open.filter(i => isDueDateOverdue(i.dueDate, { now, timeZone }));

    const recentDone = issues.filter(i => {
      if (!deliveredSet.has(i.columnId || i.status)) return false;
      const t = getCompletedAtMillis(i);
      return t > periodAgo;
    }).length;

    const periodMin = periodTime.totalMinutes;

    const byProject = projects.map(p => {
      const pIssues  = issues.filter(i => i.projectId === p.id);
      const pDone    = pIssues.filter(i => deliveredSet.has(i.columnId || i.status)).length;
      const pOpen    = pIssues.filter(i => !closedSet.has(i.columnId || i.status)).length;
      const pOverdue = pIssues.filter(i => (
        isDueDateOverdue(i.dueDate, { now, timeZone })
        && !closedSet.has(i.columnId || i.status)
      )).length;
      const pMin = periodTime.minutesByProject[p.id] || 0;
      const pPct = pIssues.length > 0 ? Math.round((pDone / pIssues.length) * 100) : 0;
      return { p, total: pIssues.length, done: pDone, open: pOpen, overdue: pOverdue, minutes: pMin, pct: pPct };
    }).sort((a, b) => b.total - a.total);

    const byStatus = (statuses || []).map(({ id, label, color }) => ({
      id, label, color, count: issues.filter(i => i.columnId === id).length,
    })).filter(s => s.count > 0);

    const noAssignee  = open.filter(i => !i.assigneeIds?.length);
    const unestimated = open.filter(i => !i.estimateMinutes && !backlogSet.has(i.columnId || i.status));

    return {
      total, inProgress, blockerPriority, dependencyBlocked, overdue, recentDone, periodMin,
      byProject, byStatus, noAssignee, unestimated,
      open: open.length,
    };
  }, [
    closedSet,
    deliveredSet,
    backlogSet,
    inProgressSet,
    issueLinks,
    issueReferenceIssues,
    issues,
    now,
    timeZone,
    period,
    projects,
    statuses,
    periodTime,
  ]);

  // Where the period's time actually went. Four calendar tiles used to sit here
  // as a second KPI row — a dashboard of counts that answered nothing anybody
  // asks about a calendar. This is one question with one answer.
  //
  // Read above the early returns because the export is built from it, and the
  // export has to be registered by every render, not only the ones that draw a
  // chart.
  //
  // Two shares of one total used to be inferred from different sources:
  // «Завдання» was logged time, while calendar rows were scheduled duration.
  // A colour on a row of a chart is a claim that the row belongs to a
  // series the reader is meant to recognise elsewhere — a status, a task type.
  // These are two labelled slices of one figure, the label says which is
  // which, and the length says how much. Nothing here needs a second alphabet.
  const timeSplit = useMemo(() => [
    { id: 'tasks', label: 'Завдання', value: Math.round(periodTime.taskMinutes || 0) },
    { id: 'events', label: 'Події календаря', value: Math.round(periodTime.eventMinutes || 0) },
  ].filter(row => row.value > 0), [periodTime.eventMinutes, periodTime.taskMinutes]);

  // The file is this screen, so it is offered only once the screen has one.
  const buildExport = useCallback(() => buildOverviewExport({
    stats,
    timeSplit,
    period,
    projects,
    selectedProjectIds,
  }), [period, projects, selectedProjectIds, stats, timeSplit]);
  useEffect(() => {
    onExportReady?.(loading ? null : buildExport);
    return () => onExportReady?.(null);
  }, [buildExport, loading, onExportReady]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (stats.total === 0 && stats.periodMin === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center">
        <EmptyState
          icon={BarChart2}
          title="Даних ще немає"
          description="Аналітика з’явиться після створення завдань, подій або записів часу"
        />
      </div>
    );
  }

  // The workspace's attention list, ordered by how much each thing matters.
  // This was two stacks of `Alert` — a component built to interrupt — so five
  // findings arrived as five banners in four colours on the calmest screen in
  // the product. None of them interrupt anything; they are a reading.
  //
  // Each one now carries the tasks it counted. A finding that says «14» and
  // gives you nowhere to go is a decoration: the reader is told there is a
  // problem, told exactly how big it is, and left to go and rebuild the same
  // filter by hand on another screen.
  const signals = [
    stats.dependencyBlocked.length > 0 && {
      id: 'blocked',
      tone: 'critical',
      count: stats.dependencyBlocked.length,
      title: `${plural(stats.dependencyBlocked.length, ['Завдання заблоковане', 'Завдання заблоковані', 'Завдань заблоковано'])} залежностями`,
      description: 'Їх стримують незавершені задачі',
      issues: stats.dependencyBlocked,
    },
    stats.overdue.length > 0 && {
      id: 'overdue',
      tone: 'critical',
      count: stats.overdue.length,
      title: 'Прострочені завдання',
      description: 'Дедлайн минув, робота відкрита',
      issues: stats.overdue,
    },
    stats.blockerPriority.length > 0 && {
      id: 'blocker-priority',
      tone: 'warning',
      count: stats.blockerPriority.length,
      title: 'Критичний пріоритет',
      description: 'Потребують негайної уваги',
      issues: stats.blockerPriority,
    },
    stats.noAssignee.length > 0 && {
      id: 'no-assignee',
      tone: 'warning',
      count: stats.noAssignee.length,
      title: 'Без виконавця',
      description: 'Ніхто не відповідає за результат',
      issues: stats.noAssignee,
    },
    stats.unestimated.length > 0 && {
      id: 'unestimated',
      tone: 'info',
      count: stats.unestimated.length,
      title: 'Без оцінки',
      description: 'Поза беклогом, але без плану за часом',
      issues: stats.unestimated,
    },
  ].filter(Boolean);

  return (
    <div className="flex-1 overflow-y-auto bg-transparent">
      <div className="flex w-full flex-col gap-4 pb-16">

        {/* KPI ─────────────────────────────────────────────────────────
            Four tiles, and they used to be counted over three different
            calendars with only two of them saying so: «Задачі 344 / 372 ·
            92% виконано» was every task the workspace had ever had, sitting
            next to two figures for the last thirty days and one for right now.
            A completion rate over all of time only ever goes up, and next to a
            period it reads as though it belongs to that period.

            Now: two tiles are the state right now, two are the period, and
            each says which. What is open and what is late are the pair a
            morning starts with; what closed and what was logged are how the
            month is going. */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard icon={Target} label="Відкрито зараз"
            value={stats.open} sub={`${stats.inProgress} у роботі`} />
          <KpiCard icon={AlertTriangle} label="Прострочено зараз"
            value={stats.overdue.length} sub={stats.overdue.length > 0 ? 'потребують уваги' : 'усе вчасно'} />
          <KpiCard icon={Zap} label={`Закрито за ${period} ${plural(period, ['день', 'дні', 'днів'])}`} onClick={() => onTabChange('velocity')}
            value={stats.recentDone} series={closedTrend} sub="тренди — у Продуктивності" />
          <KpiCard icon={Clock} label={`Зафіксовано часу за ${period} ${plural(period, ['день', 'дні', 'днів'])}`} onClick={() => onTabChange('timesheet')}
            value={fmtH(stats.periodMin)} sub="деталі — у Табелі" />
        </div>

        {/* The most actionable block on the screen used to be the narrowest
            column of three, and every row in it was a dead end. It is the full
            width now, directly under the numbers it explains, and each finding
            opens onto the tasks it counted. */}
        <AttentionPanel
          signals={signals}
          allIssues={issueReferenceIssues}
          members={members}
          projects={projects}
          issueLinks={issueLinks}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard icon={BarChart2} title="По статусах">
            <BarList
              items={stats.byStatus.map(status => ({
                id: status.id,
                label: status.label,
                value: status.count,
                // The status owns this colour: it is configured per workspace
                // and is the same swatch on the board, in the list and here.
                color: status.color,
              }))}
              emptyText="Задач немає"
            />
          </ChartCard>

          <ChartCard
            icon={Clock}
            title={`Куди пішов час · ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
            meta={fmtH(stats.periodMin)}
          >
            {/* The footnote that used to close this card counted events still
                to come and notes in the calendar — two facts about the calendar,
                inside the one card on the screen about time already spent. It
                was the last piece of a row of calendar tiles that was removed
                for saying nothing anybody asks; it went the same way. */}
            <BarList
              scale="total"
              items={timeSplit}
              format={fmtH}
              emptyText="За період час не списували"
            />
          </ChartCard>
        </div>

        {/* The clause exists because the row does not read as one calendar:
            «Задач» and «Прогрес» are the whole life of a project, «Відкрито»
            and «Прострочено» are this minute, and «Час» is the period. A table
            that mixes three and labels one is a table that misleads politely. */}
        <ChartCard
          icon={Folders}
          title="По проєктах"
          count={stats.byProject.length}
          meta={`відкрито й прострочено — зараз, час — за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
        >
          {/* «Внутрішній / Клієнтський» is gone. Client collaboration lives in
              QuickTeam+, not in the internal workspace, so every project in this
              table was "Внутрішній" — a column that answered a question nobody
              could ask, left over from a model the product no longer has. */}
          <DataTable
            rows={stats.byProject}
            rowKey={row => row.p.id}
            rowHref={row => `/${row.p.id}`}
            emptyText="Проєктів немає"
            columns={[
              {
                id: 'project',
                header: 'Проєкт',
                lead: true,
                cell: row => <span className="block truncate text-[13px] font-semibold text-ink">{row.p.name}</span>,
              },
              { id: 'total', header: 'Задач', size: 'figure', cell: row => row.total },
              {
                id: 'progress',
                header: 'Прогрес',
                size: 'meter',
                // Along the row, not across it. Stacked, the reading sat on a
                // baseline nothing else in the row shared and the bar filled
                // 34 of the row's 36 pixels.
                cell: row => <Meter value={row.pct / 100} reading={`${row.pct}%`} layout="inline" height={6} />,
              },
              { id: 'open', header: 'Відкрито', size: 'figure', cell: row => row.open },
              {
                // The one figure on the row allowed to raise its voice: a
                // missed deadline is the only thing here that is not simply a
                // count of how the work stands.
                id: 'overdue',
                header: 'Прострочено',
                size: 'figure',
                cell: row => (row.overdue > 0
                  ? <span className="font-semibold text-danger">{row.overdue}</span>
                  : <span className="text-faint">—</span>),
              },
              { id: 'time', header: `Час · ${period}д`, size: 'figure', cell: row => fmtH(row.minutes) },
            ]}
          />
        </ChartCard>

        {stats.overdue.length > 0 && (
          <TaskListCard
            title="Прострочені"
            icon={AlertTriangle}
            issues={stats.overdue}
            allIssues={issueReferenceIssues}
            members={members}
            projects={projects}
          />
        )}
      </div>
    </div>
  );
}

// ── PAGE ─────────────────────────────────────────────────────────────
export default function WorkspaceAnalyticsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeOrg, projects = [], orgRole, currentUser } = useAppContext();
  const activeProjects = useMemo(
    () => projects.filter(project => project.status !== 'archived'),
    [projects],
  );
  // A stable identity for the project scope: the array is rebuilt on every
  // render, and the subscription keys off what is in it, not off which array it
  // is.
  const activeProjectIds = useMemo(
    () => activeProjects.map(project => project.id),
    [activeProjects],
  );
  const analyticsSearch = useWorkspaceStore(state => state.analyticsSearch);
  const [activeTab, setActiveTab] = useState('overview');

  // Through the matrix, not beside it: a hand-rolled role comparison is how the
  // documented permission and the shipped one drift apart.
  const canSeeBilling = can(orgRole, 'manage:finance');
  // «Виставлення рахунків і ставки» has been on the price list as paid since it
  // was written, and the tab was open on every plan. The role decides whether
  // the tab exists at all; the plan decides whether it opens.
  const { plan: orgPlan } = usePlanLimits();
  const invoicesAllowed = planAllows(orgPlan, 'invoices');
  const openPlanUpgrade = useWorkspaceStore(state => state.openPlanUpgrade);
  // Minutes are not money. Every record behind this table is already readable
  // by anyone on the project — the worklog is part of the task, exactly as in
  // Jira — so hiding the member selector never protected anything; it only made
  // the screen disagree with `firestore.rules`. What stays behind
  // `manage:finance` is money: rates, invoices and the «Рахунок» tab.
  const canSeeTeamTimesheet = true;

  const { members } = useOrganization();
  const { priorities, types } = useWorkflowConfig();

  // A date in the file follows the organization's timezone and the reader's own
  // date format. The two settings are separate on purpose: which day a record
  // belongs to is a fact about the workspace — it is how this screen already
  // buckets everything — while how that day is written is a preference of
  // whoever opens the file. Reading the day in the browser's zone instead would
  // move records across midnight and make the file disagree with the screen
  // above it.
  const { formatDate } = useLocalization();
  const exportTimeZone = organizationTimeZone(activeOrg);
  const formatExportDate = value => formatDate(value, { timeZone: exportTimeZone });

  // The active tab registers what it is currently showing, and the one button
  // in the header writes it out. A ref rather than state: the tab republishes
  // on every render, and a re-render of the page for that would be a loop.
  const exportBuilderRef = useRef(null);
  const registerExport = useCallback(builder => {
    exportBuilderRef.current = builder;
  }, []);
  const buildActiveExport = useCallback(() => exportBuilderRef.current?.() || null, []);
  const exportMenu = <ExportMenu build={buildActiveExport} />;

  // Shared filters (one FilterBar under the tabs; each tab adds its own controls)
  const [projectFilters, setProjectFilters] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [period, setPeriod] = useState(30);
  const [teamMemberFilter, setTeamMemberFilter] = useState('all');
  const [billingProjectId, setBillingProjectId] = useState('');
  const [urlReady, setUrlReady] = useState(false);

  // Табель state
  const selfUid = currentUser?.uid || currentUser?.id;
  const [tsMember, setTsMember] = useState(null); // null → default below
  const [tsMode, setTsMode] = useState('week');
  const [tsAnchor, setTsAnchor] = useState(() => new Date());
  const [tsLogOpen, setTsLogOpen] = useState(false);
  const effectiveTsMember = tsMember ?? (canSeeTeamTimesheet ? 'all' : selfUid);

  // The address is the durable copy of a report view: refresh, Back/Forward and
  // a pasted link must ask the same question. Read it first, then let state
  // changes replace the current URL; tab changes push a history entry below.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const projectsFromUrl = commaListParam(params.get('projects'));
    const nextAnchor = analyticsDateParam(params.get('anchor'), new Date());
    const legacyMember = params.get('teamMember');

    if (legacyMember) {
      router.replace(memberAnalyticsHref(legacyMember, {
        projectIds: projectsFromUrl,
        period: analyticsPeriodParam(params.get('period')),
      }));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setActiveTab(analyticsTabParam(params.get('tab'), { billing: canSeeBilling }));
      setProjectFilters(previous => (
        previous.join(',') === projectsFromUrl.join(',') ? previous : projectsFromUrl
      ));
      setAssigneeFilter(params.get('assignee') || 'all');
      setPriorityFilter(params.get('priority') || 'all');
      setTypeFilter(params.get('type') || 'all');
      setPeriod(analyticsPeriodParam(params.get('period')));
      // Читає тільки своє. Підхоплювати ще й `member` означало б відтворити ту
      // саму колізію з іншого боку: відкритий профіль перемикав би фільтр.
      setTsMember(params.get('timesheetMember') || null);
      setTsMode(timesheetModeParam(params.get('mode')));
      setTsAnchor(previous => (
        analyticsDateKey(previous) === analyticsDateKey(nextAnchor) ? previous : nextAnchor
      ));
      setBillingProjectId(params.get('billingProject') || '');
      useWorkspaceStore.setState({ analyticsSearch: params.get('q') || '' });
      setUrlReady(true);
    });
    return () => { cancelled = true; };
  }, [canSeeBilling, router, searchParams]);

  useEffect(() => {
    if (!urlReady || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSearchParam(params, 'tab', activeTab, 'overview');
    setSearchParam(params, 'projects', projectFilters);
    setSearchParam(params, 'assignee', assigneeFilter, 'all');
    setSearchParam(params, 'priority', priorityFilter, 'all');
    setSearchParam(params, 'type', typeFilter, 'all');
    setSearchParam(params, 'period', period, 30);
    setSearchParam(params, 'q', analyticsSearch.trim());
    params.delete('teamMember');
    if (activeTab === 'timesheet') {
      // `timesheetMember`, а не `member`.
      //
      // `?member=` в цьому продукті вже має власника: `ProfileModal` змонтована
      // в layout і відкривається від будь-якої адреси з цим параметром — так
      // працює «показати профіль» із чату й зі списку команди. Табель писав те
      // саме імʼя як свій фільтр, тож вибір учасника в селекторі відкривав
      // поверх екрана його профіль: один параметр, два власники.
      //
      // Дзеркальна половина була не кращою: перехід на будь-яку іншу вкладку
      // виконував `params.delete('member')` і зачиняв профіль, який людина
      // щойно відкрила зовсім з іншого місця.
      setSearchParam(params, 'timesheetMember', effectiveTsMember, 'all');
      setSearchParam(params, 'mode', tsMode, 'week');
      setSearchParam(params, 'anchor', analyticsDateKey(tsAnchor));
    } else {
      params.delete('timesheetMember');
      params.delete('mode');
      params.delete('anchor');
    }
    if (activeTab === 'billing') setSearchParam(params, 'billingProject', billingProjectId);
    else params.delete('billingProject');

    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(null, '', href);
    }
  }, [
    activeTab,
    analyticsSearch,
    assigneeFilter,
    billingProjectId,
    effectiveTsMember,
    pathname,
    period,
    priorityFilter,
    projectFilters,
    tsAnchor,
    tsMode,
    typeFilter,
    urlReady,
  ]);

  const changeActiveTab = useCallback(nextTab => {
    // The crown opens the price list rather than the tab: the tab would open on
    // a wall, and the click that reached it already knew.
    if (nextTab === 'billing' && !invoicesAllowed) {
      openPlanUpgrade({ capabilityId: 'invoices' });
      return;
    }
    const safeTab = analyticsTabParam(nextTab, { billing: canSeeBilling });
    setActiveTab(safeTab);
    if (!urlReady || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSearchParam(params, 'tab', safeTab, 'overview');
    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.pushState(null, '', href);
    }
  }, [canSeeBilling, invoicesAllowed, openPlanUpgrade, pathname, urlReady]);

  // Which stretch of time this screen is currently about — and therefore how
  // much of `timeLogs` it is allowed to read. «Табель» owns a week or a month
  // and pages through them; every other tab is the trailing period. Reading the
  // union of the two would mean that paging the timesheet back to March pulled
  // every log written since March, so the window follows the tab instead.
  const now = useMinuteClock();
  const periodRange = useMemo(
    () => periodDayRange(now, period, exportTimeZone),
    [exportTimeZone, now, period],
  );
  const timeLogWindow = useMemo(
    () => (activeTab === 'timesheet'
      ? timesheetTimeLogWindow(tsMode, tsAnchor)
      : dayRangeTimeLogWindow(periodRange)),
    [activeTab, periodRange, tsAnchor, tsMode],
  );

  // A day's total knows the project, the date and who logged the hour. It does
  // not know which task the hour was against, so it cannot answer «час на
  // задачах, призначених Анні», a search, or a filter by priority or type —
  // those are questions about tasks, not about days.
  //
  // So the aggregate is the fast path and the records are the exact one: with
  // no such filter on — which is how this screen is opened and how it is read
  // nearly all of the time — nothing reads a raw log at all. Turn one on and
  // the same period is read from the logs themselves, over exactly the same
  // days, because both bounds come from the one `periodRange`.
  const taskScopedTimeFilter = Boolean(analyticsSearch.trim())
    || assigneeFilter !== 'all'
    || priorityFilter !== 'all'
    || typeFilter !== 'all';
  // Exactly one of the two, on every tab. «Табель» is the records themselves —
  // a grid of who logged what against which task. «Команда» is figures per
  // person, and always the team table, because selecting somebody navigates to
  // their own page. «Огляд» is figures until a task-scoped filter makes it a
  // question the figures cannot answer. «Рахунок» reads neither: an invoice is
  // every unbilled hour ever recorded, not a period, and it has its own hook.
  const needsRawTimeLogs = urlReady && (activeTab === 'timesheet'
    || (activeTab === 'overview' && taskScopedTimeFilter));
  const needsSummedTime = urlReady && (activeTab === 'workload'
    || (activeTab === 'overview' && !taskScopedTimeFilter));

  // The period's hours, read as one small document per project per day.
  //
  // This is the whole point of the daily totals: «за 90 днів» across an active
  // team is thousands of time logs and at most ninety documents per project.
  // The tiles, «Куди пішов час», the time column of «По проєктах» and every
  // figure in the team table are sums over days, and days are what this reads.
  const {
    rollups,
    loading: rollupsLoading,
    refreshing: rollupsRefreshing,
    error: rollupsError,
    readAt,
    refresh: refreshRollups,
  } = useAnalyticsRollups(activeProjectIds, {
    dayRange: needsSummedTime ? periodRange : null,
  });

  const {
    issues,
    allIssues,
    timeLogs,
    issueLinks,
    loading,
    refreshing: recordsRefreshing,
    error: recordsError,
    readAt: recordsReadAt,
    refresh: refreshRecords,
  } = useWorkspaceAnalytics(activeProjectIds, {
    // «Рахунок» reads raw logs of its own project through `useProjectAllTimeLogs`
    // — an invoice is about every unbilled hour ever recorded, not about a
    // period — so this read has nothing to do while that tab is open.
    includeTimeLogs: needsRawTimeLogs,
    timeLogWindow,
    // A report is a reading, not a feed. Nobody drags a card on this screen or
    // types into it; the numbers are read, and a figure that rewrites itself
    // mid-sentence is a distraction that also keeps listeners open over the
    // largest collections in the product for as long as the tab is left up.
    live: false,
  });
  const calendarIsRequired = urlReady && (activeTab === 'timesheet'
    || activeTab === 'billing'
    || (activeTab === 'overview' && Boolean(analyticsSearch.trim())));
  const {
    events: calendarEvents,
    loading: calendarLoading,
    error: calendarError,
    refresh: refreshCalendar,
  } = useCalendarEvents({ enabled: calendarIsRequired });
  const analyticsReadError = recordsError
    || (needsSummedTime ? rollupsError : null)
    || (calendarIsRequired ? calendarError : null);

  // One reading, one timestamp: the oldest of the timestamped sources, because that
  // is the age of the least fresh number on screen.
  const readingTakenAt = useMemo(() => {
    const stamps = [recordsReadAt, readAt].filter(value => typeof value === 'number');
    return stamps.length ? Math.min(...stamps) : null;
  }, [readAt, recordsReadAt]);
  const refreshReading = useCallback(() => {
    refreshRecords();
    refreshRollups();
    refreshCalendar({ silent: true });
  }, [refreshCalendar, refreshRecords, refreshRollups]);
  // The stamp and the export button are the header's trailing pair: when this
  // was read, and a copy of what it says.
  const headerTrailing = (
    <span className="ml-auto flex items-center gap-[8px] max-md:hidden">
      <RefreshStamp
        at={readingTakenAt}
        loading={recordsRefreshing || rollupsRefreshing}
        onRefresh={refreshReading}
      />
      {exportMenu}
    </span>
  );

  const shiftAnchor = dir => {
    setTsAnchor(prev => {
      const d = new Date(prev);
      if (tsMode === 'week') d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  };
  // Фільтр, а не двері назовні.
  //
  // Він поводився як два різні контроли в одному: «Вся команда» звужувала
  // екран на місці, а конкретна людина викидала зі сторінки на окремий
  // маршрут із її обличчям, посадою й поштою в шапці — тобто на щось, що
  // читається як профіль. Поруч у тому самому рядку стоять фільтри проєктів і
  // періоду, і жоден із них нікуди не веде.
  //
  // Гірше було з адресою. Гілка «вся команда» дописувала `teamMember` у URL
  // через `replaceState`, а Next синхронізує це з `useSearchParams`, тож ефект,
  // який читає адресу, спрацьовував знову, бачив `teamMember` і виконував
  // редирект для старих посилань — на ту саму сторінку учасника. Звідси й
  // «повернувся назад, а мене знову кинуло в профіль»: у попередній адресі
  // параметр лишався, і вихід із неї був неможливий.
  //
  // Сторінка учасника нікуди не поділася: у неї ведуть рядки таблиць команди,
  // і саме там така навігація і має бути — рядок веде, фільтр фільтрує.
  const selectTeamMember = memberId => {
    setTeamMemberFilter(memberId);
    setAssigneeFilter(memberId);
  };

  const searchQuery = analyticsSearch.trim().toLocaleLowerCase('uk-UA');
  const searchMatchedProjectIds = useMemo(() => new Set(
    activeProjects
      .filter(project => `${project.name || ''} ${project.description || ''}`.toLocaleLowerCase('uk-UA').includes(searchQuery))
      .map(project => project.id)
  ), [activeProjects, searchQuery]);

  // Two readings of the same filter. The screens that count open work use the
  // working set; the timesheet and the invoice describe work already done, and
  // an archived task still has to say which task those hours were.
  const filterIssue = useCallback(i => {
      if (searchQuery) {
        const issueText = `${i.issueKey || ''} ${i.title || ''} ${i.description || ''}`.toLocaleLowerCase('uk-UA');
        if (!issueText.includes(searchQuery) && !searchMatchedProjectIds.has(i.projectId)) return false;
      }
      if (projectFilters.length > 0 && !projectFilters.includes(i.projectId)) return false;
      if (assigneeFilter !== 'all') {
        if (assigneeFilter === 'unassigned') {
          if (i.assigneeIds && i.assigneeIds.length > 0) return false;
        } else {
          if (!i.assigneeIds || !i.assigneeIds.includes(assigneeFilter)) return false;
        }
      }
      if (
        priorityFilter !== 'all'
        && priorityPresentation(i.priority, priorities).id !== priorityFilter
      ) return false;
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      return true;
  }, [searchQuery, searchMatchedProjectIds, projectFilters, assigneeFilter, priorities, priorityFilter, typeFilter]);
  const filteredIssues = useMemo(() => issues.filter(filterIssue), [issues, filterIssue]);
  // A time-log title is reference data, not a task result. Search, assignee,
  // priority and type filters may decide which figures are drawn; they must not
  // make the task behind an otherwise visible log disappear from the Tabular
  // view or a member's recent-time list.
  const projectScopedIssueReferences = useMemo(
    () => allIssues.filter(issue => (
      projectFilters.length === 0 || projectFilters.includes(issue.projectId)
    )),
    [allIssues, projectFilters],
  );
  usePublishLocalSearchResults(analyticsSearch, filteredIssues.length);

  const visibleProjects = useMemo(() => {
    const inSelectedProjects = project => (
      projectFilters.length === 0 || projectFilters.includes(project.id)
    );
    if (!searchQuery) return activeProjects.filter(inSelectedProjects);
    const issueProjectIds = new Set(filteredIssues.map(issue => issue.projectId));
    return activeProjects.filter(project => (
      inSelectedProjects(project)
      && (searchMatchedProjectIds.has(project.id) || issueProjectIds.has(project.id))
    ));
  }, [activeProjects, filteredIssues, projectFilters, searchMatchedProjectIds, searchQuery]);

  const filteredIssueIds = useMemo(() => new Set(filteredIssues.map(i => i.id)), [filteredIssues]);
  const calendarEventsByKey = useMemo(() => {
    const map = new Map();
    calendarEvents.forEach(event => {
      map.set(
        calendarEventOccurrenceKey(event.sourceEventId || event.id, event.startAt),
        event,
      );
    });
    return map;
  }, [calendarEvents]);

  const filteredTimeLogs = useMemo(() => {
    return timeLogs.filter(log => {
      if (projectFilters.length > 0 && !projectFilters.includes(log.projectId)) return false;
      if (isCalendarEventTimeLog(log)) {
        if (assigneeFilter === 'unassigned') return false;
        if (assigneeFilter !== 'all' && log.userId !== assigneeFilter) return false;
        if (priorityFilter !== 'all' || typeFilter !== 'all') return false;
        if (searchQuery) {
          const event = calendarEventsByKey.get(
            calendarEventOccurrenceKey(log.eventId, log.occurrenceStartAt),
          );
          const project = activeProjects.find(item => item.id === log.projectId);
          const eventText = `${event?.title || ''} ${event?.description || ''} ${event?.location || ''} ${project?.name || ''}`
            .toLocaleLowerCase('uk-UA');
          if (!eventText.includes(searchQuery)) return false;
        }
        return true;
      }
      if (searchQuery || assigneeFilter !== 'all' || priorityFilter !== 'all' || typeFilter !== 'all') {
        if (!filteredIssueIds.has(log.issueId)) return false;
      }
      return true;
    });
  }, [
    assigneeFilter,
    calendarEventsByKey,
    filteredIssueIds,
    priorityFilter,
    projectFilters,
    activeProjects,
    searchQuery,
    timeLogs,
    typeFilter,
  ]);

  // The period's hours, summed per project and per person, from the daily
  // totals. This is what «Команда» reads whatever the filters are: the member
  // filter there selects a person rather than a set of tasks, and a person is
  // a dimension the totals carry.
  const teamPeriodTime = useMemo(
    () => summarizeRollups(rollups, { projectIds: projectFilters }),
    [projectFilters, rollups],
  );

  // The period's hours, whichever way this screen is entitled to read them.
  // One shape either way, so «Огляд» never has to know which path it got.
  const periodTime = useMemo(() => {
    if (!taskScopedTimeFilter) {
      return {
        taskMinutes: teamPeriodTime.taskMinutes,
        eventMinutes: teamPeriodTime.eventMinutes,
        totalMinutes: teamPeriodTime.totalMinutes,
        minutesByProject: teamPeriodTime.minutesByProject,
        source: 'rollups',
      };
    }
    return { ...summarizeRawTimeLogs(filteredTimeLogs), source: 'logs' };
  }, [filteredTimeLogs, taskScopedTimeFilter, teamPeriodTime]);

  // Табель фільтрується лише по проєктах — вимір «хто» задає селектор учасника
  const projectScopedTimeLogs = useMemo(
    () => timeLogs.filter(log => (
      projectFilters.length === 0 || projectFilters.includes(log.projectId)
    )),
    [projectFilters, timeLogs]
  );
  const teamIssues = useMemo(
    () => filterTeamIssues(issues, projectFilters, teamMemberFilter),
    [issues, projectFilters, teamMemberFilter],
  );
  const teamScopedIssues = useMemo(
    () => issues.filter(issue => (
      projectFilters.length === 0 || projectFilters.includes(issue.projectId)
    )),
    [issues, projectFilters],
  );
  const TABS = [
    { id: 'overview', label: 'Огляд', icon: BarChart2 },
    { id: 'timesheet', label: 'Табель', icon: Clock },
    { id: 'velocity', label: 'Продуктивність', icon: Zap },
    { id: 'workload', label: 'Команда', icon: Users },
    ...(canSeeBilling ? [{
      id: 'billing',
      label: 'Рахунок',
      icon: invoicesAllowed ? Receipt : PlanCrownIcon,
    }] : []),
  ];

  // Рахунок — один конкретний проєкт
  const billingProject = activeProjects.find(project => project.id === billingProjectId) || activeProjects[0];
  // Archived included on purpose: an hour recorded against a task somebody
  // later put aside is still an hour that was worked, and leaving it out would
  // quietly bill the client for less than was done.
  const billingIssues = allIssues.filter(i => i.projectId === billingProject?.id);

  const periodOptions = ANALYTICS_PERIOD_DAYS.map(d => ({ value: d, label: `${d}д` }));

  return (
    <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
      <div className="workspace-page-layout min-h-full pb-[120px]">

        <PageHeader
          title="Аналітика"
          tabs={TABS}
          activeTab={activeTab}
          onTabChange={changeActiveTab}
          mobileActions={
            activeTab === 'timesheet' ? (
              <Button style="primary" size="icon-lg" icon={Plus} onClick={() => setTsLogOpen(true)} title="Зафіксувати час" />
            ) : null
          }
          filters={
            activeTab === 'billing' ? (
              <FilterBar>
                <Select
                  filterRole="project"
                  value={billingProject?.id || ''}
                  onChange={setBillingProjectId}
                  options={activeProjects.map(project => ({ value: project.id, label: project.name }))}
                  variant="ghost"
                />
              </FilterBar>
            ) : activeTab === 'timesheet' ? (
              <>
                <FilterBar>
                  {canSeeTeamTimesheet && (
                    <Select
                      filterRole="member"
                      value={effectiveTsMember}
                      onChange={setTsMember}
                      options={[
                        { value: 'all', label: 'Вся команда' },
                        ...members.map(m => ({ value: m.id || m.uid, label: m.name || m.email, user: m })),
                      ]}
                      variant="ghost"
                    />
                  )}
                  <MultiSelect
                    value={projectFilters}
                    onChange={setProjectFilters}
                    options={activeProjects.map(project => ({ value: project.id, label: project.name }))}
                    placeholder="Всі проєкти"
                    searchPlaceholder="Пошук проєкту..."
                    filterRole="project"
                    variant="ghost"
                  />
                  {/* Період — не фільтр, а нижче md рядок фільтрів цілком їде
                      в модалку. Тиждень гортається власним рядком під шапкою. */}
                  <span className="contents max-md:hidden">
                    <FilterDivider />
                    <Segmented
                      value={tsMode}
                      onChange={setTsMode}
                      options={[{ value: 'week', label: 'Тиждень' }, { value: 'month', label: 'Місяць' }]}
                    />
                    <FilterDivider />
                    <Button style="ghost" size="icon-sm" icon={ChevronLeft} onClick={() => shiftAnchor(-1)} aria-label="Попередній період" />
                    <Button style="ghost" size="sm" onClick={() => setTsAnchor(new Date())}>Сьогодні</Button>
                    <Button style="ghost" size="icon-sm" icon={ChevronRight} onClick={() => shiftAnchor(1)} aria-label="Наступний період" />
                  </span>
                </FilterBar>
                {headerTrailing}
                <Button style="primary" size="lg" icon={Plus} onClick={() => setTsLogOpen(true)} className="max-md:hidden">
                  Зафіксувати час
                </Button>
              </>
            ) : activeTab === 'workload' ? (
              <>
              <FilterBar>
                <MultiSelect
                  value={projectFilters}
                  onChange={setProjectFilters}
                  options={activeProjects.map(project => ({ value: project.id, label: project.name }))}
                  placeholder="Всі проєкти"
                  searchPlaceholder="Пошук проєкту..."
                  filterRole="project"
                  variant="ghost"
                />
                <Select
                  filterRole="member"
                  value={teamMemberFilter}
                  onChange={selectTeamMember}
                  options={[
                    { value: 'all', label: 'Вся команда' },
                    ...members.map(member => ({
                      value: member.id || member.uid,
                      label: member.name || member.email,
                      user: member,
                    })),
                  ]}
                  variant="ghost"
                />
                <FilterDivider />
                <Segmented value={period} onChange={setPeriod} options={periodOptions} />
              </FilterBar>
              {headerTrailing}
              </>
            ) : (
              <>
              <FilterBar>
                <MultiSelect
                  value={projectFilters}
                  onChange={setProjectFilters}
                  options={activeProjects.map(project => ({ value: project.id, label: project.name }))}
                  placeholder="Всі проєкти"
                  searchPlaceholder="Пошук проєкту..."
                  filterRole="project"
                  variant="ghost"
                />
                <Select
                  filterRole="member"
                  value={assigneeFilter}
                  onChange={setAssigneeFilter}
                  options={[
                    { value: 'all', label: 'Всі виконавці' },
                    { value: 'unassigned', label: 'Без виконавця' },
                    ...members.map(m => ({ value: m.id || m.uid, label: m.name || m.email, user: m }))
                  ]}
                  variant="ghost"
                />
                <Select
                  filterRole="priority"
                  value={priorityFilter}
                  onChange={setPriorityFilter}
                  options={[
                    { value: 'all', label: 'Всі пріоритети' },
                    ...prioritySelectOptions(priorities),
                  ]}
                  variant="ghost"
                />
                <Select
                  filterRole="type"
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={[
                    { value: 'all', label: 'Всі типи' },
                    ...types.map(taskTypeSelectOption),
                  ]}
                  variant="ghost"
                />
                <FilterDivider />
                <Segmented value={period} onChange={setPeriod} options={periodOptions} />
              </FilterBar>
              {headerTrailing}
              </>
            )
          }
        />

        {/* Тиждень/місяць і сам період, на телефоні. */}
        {activeTab === 'timesheet' && (
          <div className="mb-[12px] flex items-center gap-[8px] md:hidden">
            <Button style="secondary" size="icon" icon={ChevronLeft} onClick={() => shiftAnchor(-1)} aria-label="Попередній період" />
            <Segmented
              className="min-w-0 flex-1"
              value={tsMode}
              onChange={setTsMode}
              options={[{ value: 'week', label: 'Тиждень' }, { value: 'month', label: 'Місяць' }]}
            />
            <Button style="secondary" size="sm" onClick={() => setTsAnchor(new Date())}>Сьогодні</Button>
            <Button style="secondary" size="icon" icon={ChevronRight} onClick={() => shiftAnchor(1)} aria-label="Наступний період" />
          </div>
        )}

        {/* Content — сіра панель з відступами і скругленнями, як на сторінці
            проєктів; на ній білі картки без обводок */}
        <Surface preset="panel" padding="lg" composition="chart-panel" className="flex-1 flex flex-col">
        {analyticsReadError ? (
          <div className="flex min-h-[420px] flex-1 items-center justify-center">
            <EmptyState
              icon={AlertTriangle}
              title="Не вдалося завантажити аналітику"
              description="Цифри не показуємо, бо вони могли б бути неповними. Перевірте з’єднання та спробуйте ще раз."
              action="Спробувати ще"
              onAction={refreshReading}
            />
          </div>
        ) : (
        <>
        {activeTab === 'overview' && (
          <AnalyticsContent
            projects={visibleProjects}
            issues={filteredIssues}
            issueReferenceIssues={issues}
            issueLinks={issueLinks}
            periodTime={periodTime}
            members={members}
            loading={loading || rollupsLoading || calendarLoading}
            now={now}
            period={period}
            onTabChange={changeActiveTab}
            onExportReady={registerExport}
            selectedProjectIds={projectFilters}
          />
        )}

        {activeTab === 'timesheet' && (
          <TimesheetTab
            issues={projectScopedIssueReferences}
            events={calendarEvents}
            timeLogs={projectScopedTimeLogs}
            members={members}
            projects={visibleProjects}
            member={effectiveTsMember}
            mode={tsMode}
            anchor={tsAnchor}
            onSelectMember={uid => setTsMember(uid)}
            onSelectDay={d => { setTsAnchor(d); setTsMode('week'); }}
            logModalOpen={tsLogOpen}
            onCloseLogModal={() => setTsLogOpen(false)}
            onExportReady={registerExport}
            formatDate={formatExportDate}
          />
        )}

        {activeTab === 'velocity' && (
          <VelocityTab
            issues={filteredIssues}
            projects={visibleProjects}
            members={members}
            period={period}
            onExportReady={registerExport}
            selectedProjectIds={projectFilters}
            formatDate={formatExportDate}
          />
        )}

        {activeTab === 'workload' && (
          <WorkloadTab
            members={members}
            issues={teamIssues}
            scopedIssues={teamScopedIssues}
            logIssues={projectScopedIssueReferences}
            periodTime={teamPeriodTime}
            events={calendarEvents}
            projects={activeProjects}
            period={period}
            selectedMemberId={teamMemberFilter}
            onSelectMember={selectTeamMember}
            onExportReady={registerExport}
            selectedProjectIds={projectFilters}
            formatDate={formatExportDate}
          />
        )}

        {activeTab === 'billing' && canSeeBilling && (
          <PlanGate capabilityId="invoices">
          <BillingTab
            issues={billingIssues}
            events={calendarEvents}
            members={members}
            project={billingProject}
            projectId={billingProject?.id}
          />
          </PlanGate>
        )}
        </>
        )}
        </Surface>
      </div>
    </div>
  );
}
