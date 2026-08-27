'use client';
// src/components/workspace/AnalyticsTab.jsx — Real reports: velocity, burndown, assignee stats, overdue
import { useEffect, useMemo, useState } from 'react';
import { useProjectTimeLogs } from '@/lib/hooks/useProjectTimeLogs';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import {
  AlertCircle, Users, Target, Zap, BarChart2, AlertTriangle, ClipboardList, Flag, Wallet,
} from 'lucide-react';
import { useWorkflowConfig, getCompletedAtMillis } from '@/lib/hooks/useWorkflowConfig';
import KpiCard from '@/components/ui/DataDisplay/KpiCard';
import { isDueDateOverdue } from '@/lib/utils/date';
import { useAppContext } from '@/lib/context/AppContext';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import EmptyState from '@/components/ui/Feedback/EmptyState';
import {
  BarList, ChartCard, DataTable, LoadingSpinner, Meter, TaskListCard,
} from '@/components/ui';
import PriorityIcon from '@/components/ui/DataDisplay/PriorityIcon';
import AttentionPanel from '@/components/workspace/AttentionPanel';
import { memberAnalyticsHref } from '@/lib/utils/teamAnalytics.mjs';
import { openBlockerIssues } from '@/lib/utils/issueExecution.mjs';
import { priorityPresentation, selectablePriorities } from '@/lib/utils/priorities.mjs';
import {
  backlogStatusIds,
  inProgressStatusIds,
} from '@/lib/utils/statusCategories.mjs';
import { plural } from '@/lib/utils/plural.mjs';

function fmtH(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}г ${m}хв` : `${h}г`) : `${m}хв`;
}

export default function AnalyticsTab({
  issues,
  issueLinks = [],
  members,
  project,
  projectId,
  priorityFilter = 'all',
  typeFilter = 'all',
}) {
  const { activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const {
    totalMinutes,
    byUser,
    loading: timeLoading,
    error: timeError,
    refresh: refreshTime,
  } = useProjectTimeLogs(projectId);
  const { statuses, closedStatusIds, deliveredStatusIds, priorities } = useWorkflowConfig();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const closedSet = useMemo(() => new Set(closedStatusIds), [closedStatusIds]);
  // See the workspace analytics page: closed is "no work left", delivered is
  // "something was produced", and only the second may drive a percentage.
  const deliveredSet = useMemo(() => new Set(deliveredStatusIds), [deliveredStatusIds]);
  // Both used to be guessed: the backlog as "the first status in the list", and
  // work in progress as the literal id 'in-progress'. Categories say it outright.
  const backlogSet = useMemo(() => new Set(backlogStatusIds(statuses)), [statuses]);
  const inProgressSet = useMemo(() => new Set(inProgressStatusIds(statuses)), [statuses]);

  const filteredIssues = useMemo(() => {
    return issues.filter(i => {
      if (
        priorityFilter !== 'all'
        && priorityPresentation(i.priority, priorities).id !== priorityFilter
      ) return false;
      if (typeFilter !== 'all' && i.type !== typeFilter) return false;
      return true;
    });
  }, [issues, priorities, priorityFilter, typeFilter]);

  const stats = useMemo(() => {
    const total   = filteredIssues.length;
    const done    = filteredIssues.filter(i => deliveredSet.has(i.columnId || i.status)).length;
    const inProg  = filteredIssues.filter(i => inProgressSet.has(i.columnId || i.status)).length;
    // Arrays, not counts. A finding on this tab was as much of a dead end as
    // the same finding on the workspace screen: the tasks were computed by a
    // filter and the filter was thrown away.
    const blockerPriority = filteredIssues.filter(i => (
      i.priority === 'blocker'
      && !closedSet.has(i.columnId || i.status)
    ));
    const dependencyBlocked = filteredIssues.filter(i => (
      !closedSet.has(i.columnId || i.status)
      && openBlockerIssues(i.id, issues, issueLinks, closedSet).length > 0
    ));
    const overdue = filteredIssues.filter(i => {
      return isDueDateOverdue(i.dueDate, { now, timeZone })
        && !closedSet.has(i.columnId || i.status);
    });
    const noAssignee = filteredIssues.filter(i => !i.assigneeIds?.length && !closedSet.has(i.columnId || i.status));
    const unestimated = filteredIssues.filter(i => !i.estimateMinutes && !backlogSet.has(i.columnId || i.status) && !closedSet.has(i.columnId || i.status));
    const completionPct = total > 0 ? Math.round((done / total) * 100) : 0;

    // Budget
    const budget      = (project?.totalBudgetHours || 0) * 60;
    const spentHours  = +(totalMinutes / 60).toFixed(1);
    const burnPct     = budget > 0 ? Math.min(Math.round((totalMinutes / budget) * 100), 100) : null;
    const remainH     = budget > 0 ? Math.max(0, (budget - totalMinutes) / 60).toFixed(1) : null;

    // Velocity: done tasks in last 7 days (+ trend vs previous 7 days, as in VelocityTab)
    const weekAgo = now - 7 * 24 * 3600 * 1000;
    const twoWeeksAgo = now - 14 * 24 * 3600 * 1000;
    const recentDone = filteredIssues.filter(i => {
      if (!deliveredSet.has(i.columnId || i.status)) return false;
      const t = getCompletedAtMillis(i);
      return t > weekAgo;
    }).length;
    const prevDone = filteredIssues.filter(i => {
      if (!deliveredSet.has(i.columnId || i.status)) return false;
      const t = getCompletedAtMillis(i);
      return t > twoWeeksAgo && t <= weekAgo;
    }).length;
    const velocityTrend = prevDone > 0
      ? Math.round(((recentDone - prevDone) / prevDone) * 100)
      : null;

    // By status distribution — column order & styling come from the live config
    const byStatus = (statuses || []).map(s => ({
      col: s.id, count: filteredIssues.filter(i => i.columnId === s.id).length,
      label: s.label, color: s.color,
    })).filter(s => s.count > 0);

    // By priority
    const byPriority = selectablePriorities(priorities).map(priority => ({
      p: priority.id,
      label: priority.label,
      color: priority.color,
      count: filteredIssues.filter(i => (
        priorityPresentation(i.priority, priorities).id === priority.id
        && !closedSet.has(i.columnId || i.status)
      )).length,
    })).filter(s => s.count > 0);

    // Per-member stats
    const memberStats = members.map(m => {
      const uid    = m.id || m.uid;
      const mine   = filteredIssues.filter(i => i.assigneeIds?.includes(uid));
      const mDone  = mine.filter(i => deliveredSet.has(i.columnId || i.status)).length;
      const mOpen  = mine.filter(i => !closedSet.has(i.columnId || i.status)).length;
      const mOverdue = mine.filter(i => {
        return isDueDateOverdue(i.dueDate, { now, timeZone })
          && !closedSet.has(i.columnId || i.status);
      }).length;
      const mMin  = byUser[uid] || 0;
      return { m, uid, total: mine.length, done: mDone, open: mOpen, overdue: mOverdue, minutes: mMin };
    }).filter(s => s.total > 0).sort((a, b) => b.total - a.total);

    return {
      total, done, inProg, blockerPriority, dependencyBlocked, overdue, noAssignee, unestimated,
      completionPct, budget, spentHours, burnPct, remainH, recentDone, velocityTrend,
      byStatus, byPriority, memberStats,
    };
  }, [
    filteredIssues,
    members,
    project,
    totalMinutes,
    byUser,
    statuses,
    priorities,
    closedSet,
    deliveredSet,
    backlogSet,
    inProgressSet,
    issueLinks,
    issues,
    now,
    timeZone,
  ]);

  // The project's attention list. This was four `Alert` banners under a heading
  // called «Увага» — the loudest component in the kit, stacked, on the quietest
  // screen. The findings themselves have not changed.
  const signals = [
    stats.dependencyBlocked.length > 0 && {
      id: 'blocked',
      tone: 'critical',
      count: stats.dependencyBlocked.length,
      title: `${plural(stats.dependencyBlocked.length, ['Завдання заблоковане', 'Завдання заблоковані', 'Завдань заблоковано'])} залежностями`,
      description: 'Їх стримують незавершені задачі',
      issues: stats.dependencyBlocked,
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

  if (timeLoading) {
    return (
      <div className="flex min-h-[360px] flex-1 items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (timeError) {
    return (
      <div className="flex-1 pb-8">
        <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface min-h-[360px]">
          <EmptyState
            icon={AlertTriangle}
            title="Не вдалося завантажити час проєкту"
            description="Показники не показуємо як нулі, бо журнали часу недоступні. Спробуйте ще раз."
            action="Спробувати ще"
            onAction={refreshTime}
            context="page"
            surface="card"
          />
        </div>
      </div>
    );
  }

  if (filteredIssues.length === 0) {
    return (
      <div className="flex-1 pb-8">
        <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface min-h-[360px]">
          <EmptyState
            icon={ClipboardList}
            title="Немає даних для аналітики"
            description="Створіть завдання або змініть активні фільтри — показники з’являться автоматично."
            context="page"
            surface="card"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col pb-8">
      {/* Сіра панель-підложка, на ній білі картки — як на сторінці проєктів */}
      <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface w-full flex flex-col gap-4">

        {/* ── KPI row ─────────────────────────────────────────────────
            «Завершено завдань» counts over the whole life of the project and
            stays that way, unlike the same tile on the workspace overview: a
            workspace is ongoing and its completion rate only climbs, while a
            project is a finite thing and "how far along is it" is the question
            somebody opens this tab to ask. It says which set it is a share of,
            which is the part that was missing.

            «Velocity (7 днів)» is «Закрито за 7 днів». An English word in a
            Ukrainian interface is a word most readers have to translate before
            they can read the number under it, and the window it measures was
            only in the label by accident. Seven days is fixed here because this
            tab has no period control — the workspace screen is where a window
            is chosen. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard icon={Target}       label="Завершено завдань"
            value={`${stats.done} / ${stats.total}`}
            sub={`${stats.completionPct}% усіх завдань проєкту`} />
          <KpiCard icon={Zap}          label="Закрито за 7 днів"
            value={stats.recentDone}
            sub="проти попереднього тижня"
            trend={stats.velocityTrend} />
          <KpiCard icon={AlertCircle}  label="Прострочено зараз"
            value={stats.overdue.length}
            sub="завдань після дедлайну" />
          <KpiCard icon={Users}        label="У роботі зараз"
            value={stats.inProg}
            sub="активних завдань" />
        </div>

        {/* ── Budget burn ──────────────────────────────────────────── */}
        {stats.burnPct !== null && (
          <ChartCard icon={Wallet} title="Бюджет часу" meta={`${project?.totalBudgetHours}г заплановано`}>
            <Meter
              value={stats.burnPct / 100}
              // The only place on this screen where a colour means good or bad,
              // and it says so in words as well as in hue.
              tone={stats.burnPct >= 90 ? 'danger' : stats.burnPct >= 70 ? 'warning' : 'neutral'}
              label={stats.burnPct >= 90 ? 'Бюджет майже вичерпано' : stats.burnPct >= 70 ? 'Бюджет наближається до межі' : 'Бюджет у нормі'}
              reading={`${stats.burnPct}%`}
            />
            <div className="grid grid-cols-3 gap-4 border-t border-[color:var(--color-chart-grid)] pt-3">
              {[
                ['Витрачено', `${stats.spentHours}г`],
                ['Залишилось', `${stats.remainH}г`],
                ['Бюджет', `${project?.totalBudgetHours}г`],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[11px] text-muted">{label}</p>
                  <p className="ui-type-figure mt-0.5 text-ink">{value}</p>
                </div>
              ))}
            </div>
          </ChartCard>
        )}

        {/* ── Status distribution + Priority breakdown ─────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ChartCard icon={BarChart2} title="Завдання по статусах">
            {/* The same chart as /analytics → «По статусах», and now literally
                the same component: this file used to carry its own copy, and
                the priority chart beside it carried a third. */}
            <BarList
              items={stats.byStatus.map(({ col, count, label, color }) => ({
                id: col, label, value: count, color,
              }))}
              emptyText="Задач немає"
            />
          </ChartCard>

          <ChartCard icon={Flag} title="Відкриті по пріоритету">
            {/* The bar used to multiply its share by three "to make small bars
                visible", which is a chart that lies about its own values. It
                scales to the largest priority now, like every other bar list. */}
            <BarList
              items={stats.byPriority.map(({ p, label, color, count }) => ({
                id: p,
                label,
                value: count,
                color,
                // The priority's own glyph, not a dot: a priority has a shape as
                // well as a hue, and that shape is what tells the two urgent
                // levels apart for a reader who cannot see the difference.
                leading: <PriorityIcon priority={p} priorities={priorities} />,
              }))}
              emptyText="Немає відкритих завдань"
            />
          </ChartCard>
        </div>

        {/* ── Overdue issues ───────────────────────────────────────── */}
        {stats.overdue.length > 0 && (
          <TaskListCard
            title="Прострочені завдання"
            icon={AlertTriangle}
            issues={stats.overdue}
            allIssues={issues}
            members={members}
            projects={project ? [project] : []}
          />
        )}

        {/* ── Per-member table ─────────────────────────────────────── */}
        {stats.memberStats.length > 0 && (
          <ChartCard icon={Users} title="Навантаження по виконавцях" count={stats.memberStats.length}>
            {/* Two hand-written tables — one for the screen, one for the phone —
                each with its own header type, its own rules and its own idea of
                what colour a number is. `DataTable` is both, and it is the same
                table the workspace screen draws its projects with. */}
            <DataTable
              rows={stats.memberStats}
              rowKey={row => row.m.id || row.m.uid}
              rowHref={row => memberAnalyticsHref(row.m.id || row.m.uid)}
              emptyText="Немає виконавців із задачами"
              columns={[
                {
                  id: 'member',
                  header: 'Учасник',
                  lead: true,
                  cell: row => (
                    <span className="flex min-w-0 items-center gap-2">
                      <UserAvatar user={row.m} size="sm" />
                      <span className="min-w-0 truncate text-[13px] font-semibold text-ink">{row.m.name || row.m.email}</span>
                    </span>
                  ),
                },
                { id: 'total', header: 'Всього', size: 'figure', cell: row => row.total },
                { id: 'done', header: 'Виконано', size: 'figure', cell: row => row.done },
                { id: 'open', header: 'Відкрито', size: 'figure', cell: row => row.open },
                {
                  id: 'overdue',
                  header: 'Прострочено',
                  size: 'figure',
                  cell: row => (row.overdue > 0
                    ? <span className="font-semibold text-danger">{row.overdue}</span>
                    : <span className="text-faint">—</span>),
                },
                { id: 'time', header: 'Час', size: 'figure', cell: row => (row.minutes > 0 ? fmtH(row.minutes) : <span className="text-faint">—</span>) },
              ]}
            />
          </ChartCard>
        )}

        {/* ── What needs a look ──────────────────────────────────────
            The same panel as the workspace overview, so a finding opens onto
            its tasks here too rather than stopping at a number. */}
        {signals.length > 0 && (
          <AttentionPanel
            signals={signals}
            allIssues={issues}
            members={members}
            projects={project ? [project] : []}
            issueLinks={issueLinks}
          />
        )}

        {/* ── Empty state ───────────────────────────────────────────── */}
        {stats.total === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <BarChart2 size={36} className="text-line mb-3" />
            <p className="text-[14px] font-semibold text-faint mb-1">Даних немає</p>
            <p className="text-[12px] text-faint">Аналітика з’явиться після створення завдань</p>
          </div>
        )}

      </div>
    </div>
  );
}
