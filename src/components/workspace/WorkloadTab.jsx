'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { isActiveMember } from '@/lib/utils/orgMembership.mjs';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Folders,
  LayoutDashboard,
  ListChecks,
  Target,
  Users,
} from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import {
  BarList,
  Button,
  ChartCard,
  DataTable,
  EmptyState,
  KpiCard,
  Meter,
  Pill,
  Segmented,
  TaskListCard,
} from '@/components/ui';
import {
  getCompletedAtMillis,
  useWorkflowConfig,
} from '@/lib/hooks/useWorkflowConfig';
import { isDueDateOverdue } from '@/lib/utils/date';
import { useAppContext } from '@/lib/context/AppContext';
import { organizationTimeZone, zonedDateTimeToUtcMs } from '@/lib/utils/timeZone.mjs';
import {
  effectiveTimeLogDate,
  effectiveTimeLogMillis,
  isCalendarEventTimeLog,
} from '@/lib/utils/timeLogDates.mjs';
import {
  calendarEventHref,
  calendarEventOccurrenceKey,
} from '@/lib/utils/calendarEventNavigation.mjs';
import TimesheetTab from '@/components/workspace/TimesheetTab';
import { sumRawTimeLogMinutes } from '@/lib/utils/issueAccounting.mjs';
import { issueActivity } from '@/lib/utils/issueReadState.mjs';
import { inProgressStatusIds } from '@/lib/utils/statusCategories.mjs';
import { summarizeCycleTimes } from '@/lib/utils/velocityMetrics.mjs';
import { buildMemberExport, buildWorkloadExport } from '@/lib/utils/analyticsExport.mjs';
import { memberAnalyticsHref } from '@/lib/utils/teamAnalytics.mjs';
import { plural } from '@/lib/utils/plural.mjs';

// Eight weeks is what a sparkline on a tile can carry without the marks
// touching, and it is the same window the velocity chart uses — so the two do
// not disagree about how far back «нещодавно» reaches.
const WEEKS_ON_A_TILE = 8;

function fmtH(minutes) {
  if (!minutes) return '0г';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}хв`;
  return rest ? `${hours}г ${rest}хв` : `${hours}г`;
}

function memberId(member) {
  return member?.id || member?.uid || '';
}

function memberName(member) {
  return member?.name || member?.displayName || member?.email || 'Без імені';
}

function positionLabel(member, positions) {
  return positions.find(position => position.id === member?.positionId)?.label
    || member?.title
    || 'Посада не вказана';
}

// A day key back to an instant, so «остання активність» from a daily total and
// «остання активність» from a record are the same kind of number. Noon rather
// than midnight: the day is all that is known, and the middle of it is the
// reading least likely to fall on the wrong side of «сьогодні».
function dayKeyMillis(day, timeZone) {
  if (!day) return 0;
  const millis = zonedDateTimeToUtcMs(day, { hour: 12 }, timeZone);
  return Number.isFinite(millis) ? millis : 0;
}

function latestActivityMillis(memberIssues, memberLogs) {
  // What happened to their tasks, not when the documents were last written:
  // somebody else dragging a card past one of theirs renumbered it, and that
  // used to count as this person being active today.
  const issueTime = memberIssues.reduce(
    (latest, issue) => Math.max(latest, issueActivity(issue).millis),
    0,
  );
  return memberLogs.reduce(
    (latest, log) => Math.max(latest, effectiveTimeLogMillis(log)),
    issueTime,
  );
}

function relativeActivity(value, now) {
  if (!value) return 'Активності ще немає';
  const days = Math.floor((now - value) / 86_400_000);
  if (days <= 0) return 'Сьогодні';
  if (days === 1) return 'Вчора';
  if (days < 7) return `${days} дн. тому`;
  return new Date(value).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
}

// How this person's week is going, in one chip. It was four hand-mixed colour
// pairs that had been the kit's four semantic pill tones all along — the same
// greens, ambers and reds, half a shade off each.
// The reading is words plus a tone, and only the tone is a pill. Splitting them
// is what lets the exported file carry the same sentence the chip shows instead
// of a second opinion about the same person.
function riskReading(stat) {
  if (stat.overdue > 0) return { tone: 'danger', label: `${stat.overdue} прострочено` };
  if (stat.open >= 8) return { tone: 'warning', label: 'Високе навантаження' };
  if (stat.open > 0 && stat.minutes === 0) return { tone: 'neutral', label: 'Час не зафіксовано' };
  return { tone: 'success', label: 'Стабільно' };
}

// The tone is written out four times rather than passed through as
// `tone={reading.tone}`: a variant chosen at runtime is invisible to
// `kit:scan`, and a value the catalogue cannot see a call site for is reported
// as declared-but-unused. The thresholds still live in one place above.
function RiskPill({ stat }) {
  const { tone, label } = riskReading(stat);
  if (tone === 'danger') return <Pill tone="danger" size="md">{label}</Pill>;
  if (tone === 'warning') return <Pill tone="warning" size="md">{label}</Pill>;
  if (tone === 'neutral') return <Pill tone="neutral" size="md">{label}</Pill>;
  return <Pill tone="success" size="md">{label}</Pill>;
}

function TeamOverview({ stats, summary, period, positions, now }) {
  return (
    <div className="flex w-full flex-col gap-4 pb-16">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={Clock}
          value={fmtH(summary.minutes)}
          label={`Зафіксовано за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
          sub="за задачами та подіями"
        />
        <KpiCard
          icon={CheckCircle2}
          value={summary.done}
          label={`Завершено за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
          sub="унікальні задачі"
        />
        <KpiCard
          icon={ListChecks}
          value={summary.open}
          label="Відкритих завдань"
          sub={`${stats.filter(stat => stat.inProgress > 0).length} ${plural(stats.filter(stat => stat.inProgress > 0).length, ['людина має', 'людини мають', 'людей мають'])} роботу в процесі`}
        />
        <KpiCard
          icon={AlertTriangle}
          value={summary.overdue}
          label="Прострочених"
          sub={summary.overdue ? 'потребують рішення керівника' : 'критичних затримок немає'}
        />
      </div>

      <ChartCard icon={Users} title="Команда" count={stats.length}>
        {/* This was a six-column CSS grid written out twice — once for the
            header and once for every row — with a fourth heading style, a 15px
            figure that appears nowhere else, emerald and cyan numbers, and a
            hand-mixed three-colour progress bar underneath. It is the same
            table as «По проєктах» now, and the numbers are the same figures. */}
        <DataTable
          rows={stats}
          rowKey={row => row.uid}
          // A person's row is two lines and a face, which is not the shape a row
          // of figures has. It used to be a 40px avatar inside a 36px row: the
          // avatar won, the row grew under it, and nothing on the screen agreed
          // about how tall a row was.
          density="comfortable"
          // And the whole row goes there. It used to be a button around the name
          // only, so the way to open somebody's analytics was to hit their name
          // — everything else on the row was dead, including their own face.
          rowHref={row => memberAnalyticsHref(row.uid)}
          emptyText="У команді ще немає учасників із задачами"
          columns={[
            {
              id: 'member',
              header: 'Учасник',
              lead: true,
              cell: row => (
                <span className="flex min-w-0 items-center gap-3">
                  <UserAvatar user={row.member} size="md" />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-ink">
                      {memberName(row.member)}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted">
                      {positionLabel(row.member, positions)} · {relativeActivity(row.lastActivity, now)}
                    </span>
                  </span>
                </span>
              ),
            },
            {
              id: 'focus',
              header: 'Поточний фокус',
              // A task title, a progress bar and a state chip are not figures:
              // stacked on a phone each takes the row to itself instead of
              // being folded into half a card.
              wide: true,
              cell: row => (row.inProgressItems.length > 0 ? (
                <span className="block min-w-0">
                  <span className="block truncate text-[12px] font-medium text-ink">
                    {row.inProgressItems[0].title}
                  </span>
                  {row.inProgressItems.length > 1 && (
                    <span className="mt-0.5 block text-[10px] text-muted">
                      + ще {row.inProgressItems.length - 1} в роботі
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[12px] text-faint">Немає задач у роботі</span>
              )),
            },
            {
              id: 'progress',
              header: 'Прогрес',
              size: 'meter',
              cell: row => (
                // Done against everything assigned — the same quantity the bar
                // is a picture of. The figure beside it used to count the other
                // half, «1 відкрито» against a bar that had moved because
                // something was *finished*; and it used to say so above the bar
                // rather than beside it, which is two lines in a one-line row.
                <Meter
                  value={row.done / Math.max(row.done + row.open, 1)}
                  reading={`${row.done}/${row.done + row.open}`}
                  layout="inline"
                  height={6}
                />
              ),
            },
            { id: 'done', header: 'Готово', size: 'figure', cell: row => row.done },
            { id: 'inProgress', header: 'В роботі', size: 'figure', cell: row => row.inProgress },
            { id: 'time', header: 'Час', size: 'figure', cell: row => fmtH(row.minutes) },
            { id: 'state', header: 'Стан', size: 'chip', cell: row => <RiskPill stat={row} /> },
          ]}
        />
      </ChartCard>
    </div>
  );
}

// Three, not four. «Продуктивність» used to mount the whole `VelocityTab` for
// one person — burndown for a single member, and a bar list of every project in
// the organization — to say two things about them that fit on the tiles they
// already have: how their output is trending, and how long their tasks take.
const MEMBER_VIEWS = [
  { id: 'overview', label: 'Огляд', description: 'Ключові показники', icon: LayoutDashboard },
  { id: 'work', label: 'Робота', description: 'Завдання й активність', icon: ListChecks },
  { id: 'timesheet', label: 'Табель', description: 'Робочий час', icon: Clock },
];

// The right-hand slot carries the page's own filters when it has any. It used
// to hold a workload badge and a "Період: N днів" chip — both were read-only
// restatements of state the filters themselves now show.
function MemberHeader({ stat, positions, onBack, standalone, filters }) {
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-4">
        {!standalone && (
          <Button style="ghost" size="icon-sm" icon={ArrowLeft} onClick={onBack} aria-label="Повернутися до команди" />
        )}
        <UserAvatar user={stat.member} size={standalone ? 64 : 52} />
        <div className="min-w-0 flex-1">
          <h1
            data-ui-density={standalone ? 'standalone' : 'embedded'}
            className="ui-type-member-title truncate tracking-tight text-ink"
          >
            {memberName(stat.member)}
          </h1>
          <p className="mt-1 truncate text-[12px] text-muted">
            {positionLabel(stat.member, positions)}
            {stat.member?.email ? ` · ${stat.member.email}` : ''}
          </p>
        </div>
        {filters && (
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">{filters}</div>
        )}
      </div>
    </div>
  );
}

function ProjectDistribution({ stat, projects }) {
  const rows = projects
    .map(project => ({
      project,
      minutes: stat.logs
        .filter(log => log.projectId === project.id)
        .reduce((sum, log) => sum + (Number(log.spentMinutes) || 0), 0),
      open: stat.openItems.filter(issue => issue.projectId === project.id).length,
    }))
    .filter(row => row.minutes > 0 || row.open > 0)
    .sort((a, b) => b.minutes - a.minutes || b.open - a.open);

  return (
    <ChartCard icon={Folders} title="Розподіл по проєктах">
      <BarList
        items={rows.map(row => ({
          id: row.project.id,
          label: row.project.name,
          value: row.minutes,
          meta: `${row.open} відкрито`,
        }))}
        format={fmtH}
        emptyText="Немає проєктних даних за період"
      />
    </ChartCard>
  );
}

// A list of tasks on this screen used to be a priority dot with a subtitle line
// — a third way of drawing a task, after the board row and the overview list.
// `TaskListCard` is the one way now: the same row, the same badges, the same
// click through to the task.
function IssueList({ title, issues, projects, members, emptyText }) {
  return (
    <TaskListCard
      title={title}
      issues={issues}
      members={members}
      projects={projects}
      emptyText={emptyText}
    />
  );
}

// An hour was recorded against something, and the square on the left says what
// kind of something. It used to say it with a briefcase — a glyph that stands
// for a task nowhere else in this product, against events that got the calendar
// they actually use. A task already has a mark the reader has learnt on its
// card, in search and in every selector: its type. So the row shows that, in
// the type's own colour, and the square steps down from 32px to 24px because it
// is a mark beside a sentence, not a thumbnail.
function RecentTime({ logs, issues, events, projects, types = [] }) {
  const issuesById = useMemo(
    () => new Map(issues.map(issue => [issue.id, issue])),
    [issues],
  );
  const typesById = useMemo(
    () => new Map(types.map(type => [type.id, type])),
    [types],
  );
  const eventsByKey = useMemo(() => {
    const map = new Map();
    events.forEach(event => {
      map.set(
        calendarEventOccurrenceKey(event.sourceEventId || event.id, event.startAt),
        event,
      );
    });
    return map;
  }, [events]);

  return (
    <ChartCard icon={Clock} title="Останні записи часу">
      {logs.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-faint">Час за вибраний період не списувався</p>
      ) : (
        <div className="divide-y divide-[color:var(--color-chart-grid)]">
          {logs.map(log => {
            const event = isCalendarEventTimeLog(log)
              ? eventsByKey.get(calendarEventOccurrenceKey(log.eventId, log.occurrenceStartAt))
              : null;
            const issue = log.issueId ? issuesById.get(log.issueId) : null;
            const project = projects.find(item => item.id === log.projectId);
            const date = effectiveTimeLogDate(log);
            const issueType = issue ? typesById.get(issue.type) : null;
            const TypeGlyph = issue ? taskTypeIcon(issueType || issue.type) : null;
            const content = (
              <>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-canvas text-muted">
                  {event
                    ? <CalendarIcon size={13} />
                    : TypeGlyph
                      ? <TypeGlyph size={13} style={issueType?.color ? { color: issueType.color } : undefined} />
                      : <Clock size={13} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-ink">
                    {event?.title || issue?.title || log.sourceTitle || log.description || 'Запис часу'}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-muted">
                    {project?.name || 'Без проєкту'}
                    {date ? ` · ${date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}` : ''}
                  </span>
                </span>
                <span className="ui-type-figure shrink-0 text-ink">{fmtH(log.spentMinutes)}</span>
              </>
            );
            if (event) {
              return (
                <Link key={log.id} href={calendarEventHref(event)} className="flex items-center gap-3 py-3 hover:bg-canvas/50">
                  {content}
                </Link>
              );
            }
            if (issue) {
              return (
                <Link key={log.id} href={issuePath(issue, project || issue.projectId)} className="flex items-center gap-3 py-3 hover:bg-canvas/50">
                  {content}
                </Link>
              );
            }
            return <div key={log.id} className="flex items-center gap-3 py-3">{content}</div>;
          })}
        </div>
      )}
    </ChartCard>
  );
}

function MemberOverview({ stat, projects, members, events, types, period }) {
  const averagePerDay = stat.minutes > 0 ? Math.round(stat.minutes / Math.max(period, 1)) : 0;
  return (
    <>
      {/* The two facts the «Продуктивність» sub-tab existed to carry now ride on
          the tile they belong to: the shape of this person's recent output, and
          how long one of their tasks typically takes. A whole velocity screen
          for one member drew a burndown of their own backlog and a bar list of
          projects that were not about them. */}
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Clock} value={fmtH(stat.minutes)} label="Зафіксовано часу" sub={`≈ ${fmtH(averagePerDay)} на календарний день`} />
        <KpiCard
          icon={CheckCircle2}
          value={stat.done}
          label={`Завершено за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
          series={stat.weeklyDone}
          sub={stat.medianCycleTime !== null
            ? `типовий цикл — ${stat.medianCycleTime} ${plural(stat.medianCycleTime, ['день', 'дні', 'днів'])}`
            : 'закритих задач ще замало для циклу'}
        />
        <KpiCard icon={Target} value={stat.inProgress} label="Зараз у роботі" sub={`${stat.open} відкритих загалом`} />
        <KpiCard icon={AlertTriangle} value={stat.overdue} label="Прострочено" sub={stat.overdue ? 'потребує уваги' : 'затримок немає'} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <IssueList
          title="Поточний фокус"
          issues={stat.inProgressItems}
          projects={projects}
          members={members}
          emptyText="Немає задач у статусі «В роботі»"
        />
        <ProjectDistribution stat={stat} projects={projects} />
        <IssueList
          title={`Завершено за ${period} ${plural(period, ['день', 'дні', 'днів'])}`}
          issues={stat.doneItems}
          projects={projects}
          members={members}
          emptyText="За вибраний період задач не завершено"
        />
        <RecentTime logs={stat.logs} issues={stat.referenceIssues} events={events} projects={projects} types={types} />
      </div>
    </>
  );
}

// This tab is that person's tasks, and only that. «Останні записи часу» used to
// sit beside the list here as well as in «Огляд» — the same card, twice, two
// clicks apart — while the tab next to both of them is the timesheet, which is
// the question that card half answers.
function MemberWork({ stat, projects, members }) {
  const [filter, setFilter] = useState('open');
  const visibleIssues = useMemo(() => {
    if (filter === 'done') return stat.doneItems;
    if (filter === 'overdue') return stat.overdueItems;
    if (filter === 'all') return stat.issues;
    return stat.openItems;
  }, [filter, stat]);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: `Відкриті ${stat.open}` },
            { value: 'done', label: `Завершені ${stat.done}` },
            { value: 'overdue', label: `Прострочені ${stat.overdue}` },
            { value: 'all', label: `Усі за весь час ${stat.issues.length}` },
          ]}
        />
      </div>
      <IssueList
        title="Завдання"
        issues={visibleIssues}
        projects={projects}
        members={members}
        emptyText="За цим фільтром завдань немає"
      />
    </div>
  );
}

function MemberTimesheet({
  stat,
  members,
  projects,
  events,
  controlledMode,
  onModeChange,
  controlledAnchor,
  onAnchorChange,
}) {
  const [localMode, setLocalMode] = useState('week');
  const [localAnchor, setLocalAnchor] = useState(() => new Date());
  const mode = controlledMode ?? localMode;
  const anchor = controlledAnchor ?? localAnchor;
  const setMode = onModeChange || setLocalMode;
  const setAnchor = onAnchorChange || setLocalAnchor;
  const shift = direction => {
    setAnchor(previous => {
      const next = new Date(previous);
      if (mode === 'week') next.setDate(next.getDate() + direction * 7);
      else next.setMonth(next.getMonth() + direction);
      return next;
    });
  };
  return (
    <div>
      <div data-ui-surface="local" className="mb-4 flex flex-wrap items-center gap-2 rounded-[14px] bg-white p-2">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'week', label: 'Тиждень' },
            { value: 'month', label: 'Місяць' },
          ]}
        />
        <span className="mx-1 h-5 w-px bg-line" />
        <Button style="ghost" size="icon-sm" icon={ChevronLeft} onClick={() => shift(-1)} aria-label="Попередній період" />
        <Button style="ghost" size="sm" onClick={() => setAnchor(new Date())}>Сьогодні</Button>
        <Button style="ghost" size="icon-sm" icon={ChevronRight} onClick={() => shift(1)} aria-label="Наступний період" />
      </div>
      <TimesheetTab
        // Every task the record knows about, not the ones this person happens
        // to be assigned to. A timesheet names the task an hour was logged
        // against, and somebody can log time on a task they do not own — that
        // is normal, and it was showing up as «???» on their own page while the
        // workspace timesheet, which is handed the whole record, named it
        // perfectly. Adding yourself as assignee «fixed» it, which is exactly
        // the wrong lesson to have to learn.
        issues={stat.referenceIssues}
        events={events}
        timeLogs={stat.allLogs}
        members={members}
        projects={projects}
        member={stat.uid}
        mode={mode}
        anchor={anchor}
        // A month cell already invites the click — it says «Відкрити тиждень».
        // Without this it was a cursor over a dead square.
        onSelectDay={day => { setAnchor(day); setMode('week'); }}
      />
    </div>
  );
}

function MemberDetail({
  stat,
  members,
  positions,
  projects,
  events,
  types,
  period,
  onBack,
  standalone = false,
  filters,
  controlledView,
  onViewChange,
  timesheetMode,
  onTimesheetModeChange,
  timesheetAnchor,
  onTimesheetAnchorChange,
}) {
  const [localView, setLocalView] = useState('overview');
  const view = controlledView ?? localView;
  const setView = onViewChange || setLocalView;

  return (
    <div className="w-full pb-16">
      <MemberHeader
        stat={stat}
        positions={positions}
        onBack={onBack}
        standalone={standalone}
        filters={filters}
      />
      <nav
        className="custom-scrollbar mb-6 flex gap-1.5 overflow-x-auto rounded-[16px] bg-line p-1.5"
        aria-label="Розділи аналітики учасника"
      >
        {MEMBER_VIEWS.map(item => {
          const Icon = item.icon;
          const active = view === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => setView(item.id)}
              className={`flex min-w-[150px] flex-1 items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left transition-all ${
                active
                  ? 'bg-white text-ink shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
                  : 'text-muted hover:bg-white/50 hover:text-ink'
              }`}
            >
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[9px] ${active ? 'bg-ink text-white' : 'bg-white/70 text-muted'}`}>
                <Icon size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold">{item.label}</span>
                <span className="mt-0.5 block truncate text-[9px] font-medium text-muted">{item.description}</span>
              </span>
            </button>
          );
        })}
      </nav>

      <div key={view}>
        {view === 'overview' && (
          <MemberOverview stat={stat} projects={projects} members={members} events={events} types={types} period={period} />
        )}
        {view === 'work' && (
          <MemberWork stat={stat} projects={projects} members={members} />
        )}
        {view === 'timesheet' && (
          <MemberTimesheet
            stat={stat}
            members={members}
            projects={projects}
            events={events}
            controlledMode={timesheetMode}
            onModeChange={onTimesheetModeChange}
            controlledAnchor={timesheetAnchor}
            onAnchorChange={onTimesheetAnchorChange}
          />
        )}
      </div>
    </div>
  );
}

export default function WorkloadTab({
  members = [],
  issues = [],
  // Every task in the selected projects, not only the ones a member filter
  // left standing. «Остання активність» reads it, so a person's last touch on
  // somebody else's task still counts as activity.
  scopedIssues = issues,
  // Only «Останні записи часу» reads this. It must include archived tasks so an
  // entry keeps naming the task it belongs to.
  logIssues = scopedIssues,
  timeLogs = [],
  // The period's hours, already summed per person by `analyticsRollups`.
  //
  // The team table needs three figures per row and no records: how many minutes
  // somebody logged, and roughly when they last did. That is what a daily total
  // is, and reading it costs a document per project per day instead of every
  // time log the period contains.
  //
  // A member's own page is the other case — it draws their timesheet, which is
  // the records themselves — and it passes `timeLogs` instead. Exactly one of
  // the two is ever supplied.
  periodTime = null,
  events = [],
  projects = [],
  period = 30,
  selectedMemberId = 'all',
  onSelectMember,
  standaloneDetail = false,
  // Rendered in the member header. The standalone member page owns the filter
  // controls but has no header row of its own to put them in.
  detailFilters,
  detailView,
  onDetailViewChange,
  timesheetMode,
  onTimesheetModeChange,
  timesheetAnchor,
  onTimesheetAnchorChange,
  onExportReady,
  selectedProjectIds = [],
  formatDate,
}) {
  const { activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const [now, setNow] = useState(() => Date.now());
  const { closedStatusIds, deliveredStatusIds, positions = [], statuses, types = [] } = useWorkflowConfig();
  // What is left to do reads the closed set; what a person actually finished in
  // the period reads the delivered one — a task they cancelled is not output.
  const closedSet = useMemo(() => new Set(closedStatusIds), [closedStatusIds]);
  const deliveredSet = useMemo(() => new Set(deliveredStatusIds), [deliveredStatusIds]);
  // The category, not the literal id 'in-progress': an org that renamed that
  // column showed every member as having nothing in progress.
  const inProgressSet = useMemo(() => new Set(inProgressStatusIds(statuses)), [statuses]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Whose workload is worth a row: everyone with access, plus anyone who has
  // lost it but still has open tasks in their name. Deactivation deliberately
  // leaves those assignments alone, and this is the screen where somebody
  // notices they need a new owner — dropping the person here would turn their
  // leftover work into work nobody can see.
  const chartedMembers = useMemo(() => {
    const assignedIds = new Set(
      issues
        .filter(issue => !closedSet.has(issue.columnId || issue.status))
        .flatMap(issue => (Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [])),
    );
    return members.filter(member => (
      isActiveMember(member) || assignedIds.has(memberId(member))
    ));
  }, [issues, closedSet, members]);

  const stats = useMemo(() => {
    const periodAgo = now - period * 86_400_000;
    return chartedMembers.map(member => {
      const uid = memberId(member);
      const summedMinutes = periodTime ? (periodTime.minutesByUser?.[uid] || 0) : null;
      const memberIssues = issues.filter(issue => issue.assigneeIds?.includes(uid));
      const timesheetIssues = scopedIssues.filter(issue => issue.assigneeIds?.includes(uid));
      const openItems = memberIssues.filter(issue => !closedSet.has(issue.columnId || issue.status));
      const doneItems = memberIssues
        .filter(issue => deliveredSet.has(issue.columnId || issue.status) && getCompletedAtMillis(issue) >= periodAgo)
        .sort((a, b) => getCompletedAtMillis(b) - getCompletedAtMillis(a));
      const overdueItems = openItems.filter(issue => (
        isDueDateOverdue(issue.dueDate, { now, timeZone })
      ));
      const inProgressItems = openItems.filter(issue => inProgressSet.has(issue.columnId || issue.status));
      const allLogs = timeLogs
        .filter(log => log.userId === uid)
        .sort((a, b) => effectiveTimeLogMillis(b) - effectiveTimeLogMillis(a));
      const logs = allLogs.filter(log => effectiveTimeLogMillis(log) >= periodAgo);
      const minutes = summedMinutes === null ? sumRawTimeLogMinutes(logs) : summedMinutes;
      // «Востаннє активний» is drawn as «3 дні тому», so a day is all the
      // precision that reading ever carried — and a day is what a daily total
      // can say without opening a single record.
      const lastLoggedMillis = periodTime
        ? dayKeyMillis(periodTime.lastLoggedDayByUser?.[uid], timeZone)
        : 0;
      // The shape of the last eight weeks, and how long one of this person's
      // tasks typically takes. Both used to require opening a whole velocity
      // screen scoped to one member — which also drew them a burndown of their
      // own backlog and a chart of projects that were not about them.
      const weeklyDone = Array.from({ length: WEEKS_ON_A_TILE }, (_, index) => {
        const weeksBack = WEEKS_ON_A_TILE - 1 - index;
        const from = now - (weeksBack + 1) * 7 * 86_400_000;
        const to = now - weeksBack * 7 * 86_400_000;
        return memberIssues.filter(issue => {
          if (!deliveredSet.has(issue.columnId || issue.status)) return false;
          const at = getCompletedAtMillis(issue);
          return at >= from && at < to;
        }).length;
      });
      const cycle = summarizeCycleTimes(doneItems, getCompletedAtMillis);
      return {
        member,
        uid,
        issues: memberIssues,
        referenceIssues: logIssues,
        timesheetIssues,
        openItems,
        doneItems,
        overdueItems,
        inProgressItems,
        allLogs,
        logs,
        open: openItems.length,
        done: doneItems.length,
        overdue: overdueItems.length,
        inProgress: inProgressItems.length,
        minutes,
        weeklyDone,
        medianCycleTime: cycle.medianDays,
        lastActivity: Math.max(
          latestActivityMillis(timesheetIssues, allLogs),
          lastLoggedMillis,
        ),
      };
    }).sort((a, b) => {
      if (b.overdue !== a.overdue) return b.overdue - a.overdue;
      if (b.inProgress !== a.inProgress) return b.inProgress - a.inProgress;
      return b.lastActivity - a.lastActivity;
    });
  }, [issues, chartedMembers, closedSet, deliveredSet, scopedIssues, inProgressSet, logIssues, now, period, periodTime, timeLogs, timeZone]);

  const selectedStat = selectedMemberId !== 'all'
    ? stats.find(stat => stat.uid === selectedMemberId)
    : null;
  const summary = useMemo(() => {
    const periodAgo = now - period * 86_400_000;
    const openItems = issues.filter(issue => !closedSet.has(issue.columnId || issue.status));
    return {
      minutes: periodTime ? periodTime.totalMinutes : sumRawTimeLogMinutes(
        timeLogs.filter(log => effectiveTimeLogMillis(log) >= periodAgo),
      ),
      done: issues.filter(issue => (
        deliveredSet.has(issue.columnId || issue.status)
        && getCompletedAtMillis(issue) >= periodAgo
      )).length,
      open: openItems.length,
      overdue: openItems.filter(issue => (
        isDueDateOverdue(issue.dueDate, { now, timeZone })
      )).length,
    };
  }, [issues, closedSet, deliveredSet, now, period, periodTime, timeLogs, timeZone]);

  // What the file is depends on what the screen is showing: the team table, or
  // the one person it has been opened on. Exporting the whole team from a
  // member's page would hand somebody a file that does not match the screen
  // they asked for it from.
  const buildExport = useCallback(() => (selectedStat
    ? buildMemberExport({
      stat: selectedStat,
      projects,
      period,
      formatDate,
      dateOf: effectiveTimeLogDate,
    })
    : buildWorkloadExport({
      stats,
      positions,
      period,
      projects,
      selectedProjectIds,
      activityLabel: row => relativeActivity(row.lastActivity, now),
      stateLabel: row => riskReading(row).label,
    })), [
    formatDate, now, period, positions, projects, selectedProjectIds, selectedStat, stats,
  ]);
  useEffect(() => {
    onExportReady?.(stats.length > 0 ? buildExport : null);
    return () => onExportReady?.(null);
  }, [buildExport, onExportReady, stats.length]);

  if (members.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Users}
          title="У команді ще немає учасників"
          description="Додайте людей до організації, щоб бачити їхню роботу, час і продуктивність."
        />
      </div>
    );
  }

  if (selectedMemberId !== 'all' && !selectedStat) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={Users}
          title="Учасника не знайдено"
          description="Можливо, він більше не входить до організації."
          action="Повернутися до команди"
          onAction={() => onSelectMember?.('all')}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      {selectedStat ? (
        <MemberDetail
          key={selectedStat.uid}
          stat={selectedStat}
          members={members}
          positions={positions}
          projects={projects}
          events={events}
          types={types}
          period={period}
          onBack={() => onSelectMember?.('all')}
          standalone={standaloneDetail}
          filters={detailFilters}
          controlledView={detailView}
          onViewChange={onDetailViewChange}
          timesheetMode={timesheetMode}
          onTimesheetModeChange={onTimesheetModeChange}
          timesheetAnchor={timesheetAnchor}
          onTimesheetAnchorChange={onTimesheetAnchorChange}
        />
      ) : (
        <TeamOverview
          stats={stats}
          summary={summary}
          positions={positions}
          period={period}
          now={now}
        />
      )}
    </div>
  );
}
