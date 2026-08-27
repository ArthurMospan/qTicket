'use client';
// src/components/workspace/VelocityTab.jsx — Продуктивність: потік роботи й час завершення
// Період керується з фільтрів сторінки (prop `period`), власного селектора немає.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Zap, CheckCircle2, Calendar, Activity, Shapes, TrendingDown, Target } from 'lucide-react';
import {
  Alert, BarList, ChartCard, ColumnChart, EmptyState, KpiCard, TaskListCard,
} from '@/components/ui';
import { useWorkflowConfig, getCompletedAtMillis } from '@/lib/hooks/useWorkflowConfig';
import { plural } from '@/lib/utils/plural.mjs';
import { summarizeCycleTimes } from '@/lib/utils/velocityMetrics.mjs';
import { buildVelocityExport } from '@/lib/utils/analyticsExport.mjs';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtShortDate(date) {
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

// The two series every chart on this screen plots. Opened is context — it is
// there so closed has something to be measured against — so it wears the
// de-emphasis grey and closed wears the measure. This used to be ink at 60%
// opacity against emerald, which is two colours nobody chose and one of them
// invented by an opacity.
const FLOW_SERIES = [
  { label: 'Закрито', color: 'var(--color-chart-1)' },
  { label: 'Створено', color: 'var(--color-chart-context)' },
];

function useWeeklyVelocity(issues, weeksBack, deliveredSet, now) {
  return useMemo(() => Array.from({ length: weeksBack }, (_, index) => {
    const weekIndex = weeksBack - 1 - index;
    const weekStart = now - (weekIndex + 1) * 7 * 86400000;
    const weekEnd = now - weekIndex * 7 * 86400000;
    const closed = issues.filter(issue => {
      if (!deliveredSet.has(issue.columnId || issue.status)) return false;
      const at = getCompletedAtMillis(issue);
      return at >= weekStart && at < weekEnd;
    }).length;
    const created = issues.filter(issue => {
      const at = issue.createdAt?.toMillis?.() ?? 0;
      return at >= weekStart && at < weekEnd;
    }).length;
    return { label: fmtShortDate(new Date(weekStart)), values: [closed, created] };
  }), [issues, weeksBack, deliveredSet, now]);
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function VelocityTab({
  issues = [],
  projects = [],
  members = [],
  period = 30,
  // Passed only by the screen that owns the header button. This component is
  // also drawn inside a member's page, where the member's own export is the
  // one the button must write.
  onExportReady,
  selectedProjectIds = [],
  formatDate,
}) {
  const { closedStatusIds, deliveredStatusIds, types = [] } = useWorkflowConfig();
  // The oldest-work list asks what is still open, so it reads the closed set.
  // Everything else here measures output, and cancelling something produces
  // none of it.
  const closedSet = useMemo(() => new Set(closedStatusIds), [closedStatusIds]);
  const deliveredSet = useMemo(() => new Set(deliveredStatusIds), [deliveredStatusIds]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const periodAgo = now - period * 86400000;
    const prevPeriodAgo = now - period * 2 * 86400000;

    const doneAll = issues.filter(i => deliveredSet.has(i.columnId || i.status));

    const donePeriod = doneAll.filter(i => {
      const t = getCompletedAtMillis(i);
      return t >= periodAgo;
    });

    const donePrev = doneAll.filter(i => {
      const t = getCompletedAtMillis(i);
      return t >= prevPeriodAgo && t < periodAgo;
    });

    const createdPeriod = issues.filter(i => {
      const t = i.createdAt?.toMillis?.() ?? 0;
      return t >= periodAgo;
    });

    const velocityTrend = donePrev.length > 0
      ? Math.round(((donePeriod.length - donePrev.length) / donePrev.length) * 100)
      : null;

    const cycleSummary = summarizeCycleTimes(donePeriod, getCompletedAtMillis);

    // Daily activity
    const dayCount = period;
    const days = Array.from({ length: dayCount }, (_, i) => {
      const daysBack = dayCount - 1;
      const dayStart = new Date(now - (daysBack - i) * 86400000).setHours(0, 0, 0, 0);
      const dayEnd = new Date(now - (daysBack - i) * 86400000).setHours(23, 59, 59, 999);
      const label = new Date(dayStart).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
      return {
        label,
        // Closed first, because closed is the measure and opened is the context
        // it is read against — the order the legend and the tooltip follow too.
        values: [
          issues.filter(iss => { if (!deliveredSet.has(iss.columnId || iss.status)) return false; const t = getCompletedAtMillis(iss); return t >= dayStart && t <= dayEnd; }).length,
          issues.filter(iss => { const t = iss.createdAt?.toMillis?.() ?? 0; return t >= dayStart && t <= dayEnd; }).length,
        ],
      };
    });

    // By type breakdown — types come from the shared workflow config, and the
    // whole type comes along: its glyph is what the reader already knows it by
    // on a card, in search and in the selector.
    const byType = types.map(entry => {
      const { id: type, label, color } = entry;
      const created = createdPeriod.filter(issue => issue.type === type).length;
      const done = donePeriod.filter(issue => issue.type === type).length;
      return { type, label, color, icon: taskTypeIcon(entry), created, done };
    }).filter(row => row.created > 0 || row.done > 0);

    return {
      donePeriod: donePeriod.length,
      velocityTrend,
      createdPeriod: createdPeriod.length,
      openNow: issues.filter(i => !closedSet.has(i.columnId || i.status)).length,
      excludedCompletionCount: doneAll.filter(i => getCompletedAtMillis(i) <= 0).length,
      medianCycleTime: cycleSummary.medianDays,
      p85CycleTime: cycleSummary.p85Days,
      invalidCycleCount: cycleSummary.invalidIssueIds.length,
      days,
      byType,
    };
  }, [issues, period, closedSet, deliveredSet, now, types]);

  const recentlyClosed = useMemo(
    () => issues
      .filter(issue => (
        deliveredSet.has(issue.columnId || issue.status)
        && getCompletedAtMillis(issue) >= now - period * 86400000
      ))
      .sort((left, right) => getCompletedAtMillis(right) - getCompletedAtMillis(left)),
    [issues, deliveredSet, now, period],
  );

  const openIssues = useMemo(
    () => issues
      .filter(issue => !closedSet.has(issue.columnId || issue.status))
      .sort((left, right) => {
        const leftCreated = left.createdAt?.toMillis?.() ?? Number.POSITIVE_INFINITY;
        const rightCreated = right.createdAt?.toMillis?.() ?? Number.POSITIVE_INFINITY;
        return leftCreated - rightCreated;
      }),
    [closedSet, issues],
  );

  const weeklyVelocity = useWeeklyVelocity(issues, 8, deliveredSet, now);

  // Every chart here is a count, so the file is those counts: the same days,
  // the same weeks, the same rows behind the bars.
  const buildExport = useCallback(() => buildVelocityExport({
    stats,
    weeklyVelocity,
    recentlyClosed,
    period,
    projects,
    selectedProjectIds,
    formatDate,
    completedAtOf: getCompletedAtMillis,
  }), [formatDate, period, projects, recentlyClosed, selectedProjectIds, stats, weeklyVelocity]);
  useEffect(() => {
    onExportReady?.(issues.length > 0 ? buildExport : null);
    return () => onExportReady?.(null);
  }, [issues.length, buildExport, onExportReady]);

  if (issues.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Zap}
          title="Немає даних про потік роботи"
          description="Створені й завершені завдання сформують активність та час завершення."
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="flex w-full flex-col gap-4 pb-16">

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard icon={Zap} trend={stats.velocityTrend ?? undefined}
            value={stats.donePeriod}
            label={`Закрито за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
            series={stats.days.map(day => day.values[0])}
            sub={stats.excludedCompletionCount > 0
              ? `${stats.excludedCompletionCount} без точної дати завершення не враховано`
              : 'проти попереднього періоду'} />
          {/* «Всього закрито» stood here and counted every task the workspace
              had ever finished — a number that only climbs, on the tab whose
              entire subject is change. The tile it makes room for is the one
              this tab was missing: how long a task actually takes. */}
          <KpiCard icon={Calendar}
            value={stats.medianCycleTime !== null ? `${stats.medianCycleTime}д` : '—'}
            label="Від створення до завершення"
            sub={stats.p85CycleTime !== null
              ? `85% закриваються за ≤ ${stats.p85CycleTime}д`
              : 'потрібні завершені задачі'} />
          <KpiCard icon={Target}
            value={stats.openNow}
            label="Відкрито зараз"
            sub="усі незавершені завдання у вибраному контексті" />
          <KpiCard icon={Activity}
            value={stats.createdPeriod}
            label={`Створено за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
            series={stats.days.map(day => day.values[1])}
            sub="нових завдань за вибраний період" />
        </div>

        {stats.invalidCycleCount > 0 && (
          <Alert variant="error" title="Помилка дат завершення">
            Виявлено {stats.invalidCycleCount} {plural(stats.invalidCycleCount, ['завдання', 'завдання', 'завдань'])} з датою завершення раніше за дату створення. Некоректні значення не включено в розрахунок.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ChartCard
            icon={Activity}
            title="Активність"
            meta={`${period} ${plural(period, ['день', 'дні', 'днів'])}`}
            className="md:col-span-2"
          >
            <ColumnChart data={stats.days} series={FLOW_SERIES} height={130} />
          </ChartCard>

          <ChartCard icon={Shapes} title="По типах">
            {/* The type owns its colour, and «зроблено з усього» is the number
                the bar is a picture of — it used to be printed beside a bar
                scaled to a different quantity entirely.

                A task type has a glyph, and it is the glyph a reader has
                already learnt on a card, in search and in every selector. This
                chart was drawing a plain colour dot instead — a second, poorer
                way of naming the same thing, and one that says nothing at all
                to a reader who cannot separate the hues. */}
            <BarList
              items={stats.byType.map(({ type, label, color, icon: TypeGlyph, created, done }) => ({
                id: type,
                label,
                value: done,
                color,
                leading: <TypeGlyph size={14} className="shrink-0" style={{ color }} />,
                meta: `створено ${created}`,
              }))}
              emptyText="За період задач не створювали й не закривали"
            />
          </ChartCard>
        </div>

        <TaskListCard
          title="Найстаріші відкриті завдання"
          icon={TrendingDown}
          count={openIssues.length}
          issues={openIssues}
          members={members}
          projects={projects}
          emptyText="Відкритих завдань немає"
        />

        {/* «По проєктах» stood beside this as a bar list of what each project
            closed — the same subject as the table on «Огляд», drawn a second
            way, so the workspace answered "how are the projects doing" twice
            and differently. The table won: it holds progress, open work,
            overdue and time, where the bar list held one bar. */}
        <ChartCard icon={Zap} title="Пропускна здатність по тижнях" meta="8 тижнів">
          <ColumnChart data={weeklyVelocity} series={FLOW_SERIES} height={130} />
        </ChartCard>

        {/* Recent done issues. These were the one list of tasks in the product
            you could not click: a title, a project and a cycle time, drawn by
            hand. They are `TaskListCard` rows now, like every other list. */}
        <TaskListCard
          title="Нещодавно закриті завдання"
          icon={CheckCircle2}
          count={stats.donePeriod}
          issues={recentlyClosed}
          members={members}
          projects={projects}
          emptyText="За вказаний період завдань не закрито"
        />
      </div>
    </div>
  );
}
