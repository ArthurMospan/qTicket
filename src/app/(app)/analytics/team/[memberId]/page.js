'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Users } from 'lucide-react';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useMinuteClock } from '@/lib/hooks/useMinuteClock';
import { useWorkspaceAnalytics } from '@/lib/hooks/useWorkspaceAnalytics';
import { useCalendarEvents } from '@/lib/hooks/useCalendarEvents';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import WorkloadTab from '@/components/workspace/WorkloadTab';
import FilterBar from '@/components/ui/FilterBar';
import {
  Button,
  EmptyState,
  LoadingSpinner,
  RefreshStamp,
  Segmented,
  Surface,
} from '@/components/ui';
import { MultiSelect } from '@/components/ui/Select';
import {
  filterTeamIssues,
  filterTeamTimeLogs,
} from '@/lib/utils/teamAnalytics.mjs';
import {
  ANALYTICS_PERIOD_DAYS,
  memberAnalyticsTimeLogWindow,
} from '@/lib/utils/analyticsWindow.mjs';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import {
  analyticsDateKey,
  analyticsDateParam,
  analyticsPeriodParam,
  commaListParam,
  memberViewParam,
  setSearchParam,
  timesheetModeParam,
} from '@/lib/utils/analyticsUrlState.mjs';

const PERIOD_OPTIONS = ANALYTICS_PERIOD_DAYS.map(days => ({ value: days, label: `${days}д` }));

function memberName(member) {
  return member?.name || member?.displayName || member?.email || 'Учасник';
}

export default function MemberAnalyticsPage() {
  const { memberId } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { activeOrg, projects = [] } = useAppContext();
  // Which day an hour belongs to is a fact about the workspace, so the period
  // is measured in the workspace's own days — the same ones the daily totals
  // and the exported file are keyed by.
  const timeZone = organizationTimeZone(activeOrg);
  const activeProjects = useMemo(
    () => projects.filter(project => project.status !== 'archived'),
    [projects],
  );
  const { members = [], loading: membersLoading } = useOrganization();
  const [projectFilters, setProjectFilters] = useState([]);
  const [period, setPeriod] = useState(30);
  const [detailView, setDetailView] = useState('overview');
  const [timesheetMode, setTimesheetMode] = useState('week');
  const [timesheetAnchor, setTimesheetAnchor] = useState(() => new Date());
  const [urlReady, setUrlReady] = useState(false);
  const activeProjectIds = useMemo(
    () => activeProjects.map(project => project.id),
    [activeProjects],
  );
  // One person's hours over the chosen period — so that is what is read. This
  // screen used to open the whole organization's time-log history to draw a
  // thirty-day bar chart.
  const now = useMinuteClock();
  const timeLogWindow = useMemo(
    () => (urlReady ? memberAnalyticsTimeLogWindow({
      view: detailView,
      mode: timesheetMode,
      anchor: timesheetAnchor,
      nowMillis: now,
      periodDays: period,
      timeZone,
    }) : null),
    [detailView, now, period, timeZone, timesheetAnchor, timesheetMode, urlReady],
  );
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const projectsFromUrl = commaListParam(params.get('projects'));
    const nextAnchor = analyticsDateParam(params.get('anchor'), new Date());
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setProjectFilters(previous => (
        previous.join(',') === projectsFromUrl.join(',') ? previous : projectsFromUrl
      ));
      setPeriod(analyticsPeriodParam(params.get('period')));
      setDetailView(memberViewParam(params.get('view')));
      setTimesheetMode(timesheetModeParam(params.get('mode')));
      setTimesheetAnchor(previous => (
        analyticsDateKey(previous) === analyticsDateKey(nextAnchor) ? previous : nextAnchor
      ));
      setUrlReady(true);
    });
    return () => { cancelled = true; };
  }, [searchParams]);

  useEffect(() => {
    if (!urlReady || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSearchParam(params, 'projects', projectFilters);
    setSearchParam(params, 'period', period, 30);
    setSearchParam(params, 'view', detailView, 'overview');
    if (detailView === 'timesheet') {
      setSearchParam(params, 'mode', timesheetMode, 'week');
      setSearchParam(params, 'anchor', analyticsDateKey(timesheetAnchor));
    } else {
      params.delete('mode');
      params.delete('anchor');
    }
    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(null, '', href);
    }
  }, [detailView, pathname, period, projectFilters, timesheetAnchor, timesheetMode, urlReady]);

  const changeDetailView = useCallback(nextView => {
    const safeView = memberViewParam(nextView);
    setDetailView(safeView);
    if (!urlReady || typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSearchParam(params, 'view', safeView, 'overview');
    const query = params.toString();
    const href = `${pathname}${query ? `?${query}` : ''}`;
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.pushState(null, '', href);
    }
  }, [pathname, urlReady]);

  const teamHref = useMemo(() => {
    const params = new URLSearchParams({ tab: 'workload' });
    setSearchParam(params, 'projects', projectFilters);
    setSearchParam(params, 'period', period, 30);
    return `/analytics?${params.toString()}`;
  }, [period, projectFilters]);
  const {
    issues,
    allIssues,
    timeLogs,
    loading,
    refreshing,
    error: recordsError,
    readAt,
    refresh: refreshRecords,
  } = useWorkspaceAnalytics(activeProjectIds, {
    includeLinks: false,
    includeTimeLogs: urlReady,
    timeLogWindow,
    live: false,
  });
  const {
    events,
    loading: calendarLoading,
    error: calendarError,
    refresh: refreshCalendar,
  } = useCalendarEvents();
  const refreshReading = useCallback(() => {
    refreshRecords();
    refreshCalendar({ silent: true });
  }, [refreshCalendar, refreshRecords]);

  const member = members.find(item => (item.id || item.uid) === memberId);
  const visibleProjects = useMemo(
    () => activeProjects.filter(project => (
      projectFilters.length === 0 || projectFilters.includes(project.id)
    )),
    [activeProjects, projectFilters],
  );
  const scopedIssues = useMemo(
    () => issues.filter(issue => (
      projectFilters.length === 0 || projectFilters.includes(issue.projectId)
    )),
    [issues, projectFilters],
  );
  const memberIssues = useMemo(
    () => filterTeamIssues(issues, projectFilters, memberId),
    [issues, memberId, projectFilters],
  );
  const memberTimeLogs = useMemo(
    () => filterTeamTimeLogs(timeLogs, projectFilters, memberId),
    [memberId, projectFilters, timeLogs],
  );

  useEffect(() => {
    useWorkspaceStore.setState({
      breadcrumbs: [
        { label: 'Аналітика', href: '/analytics' },
        { label: 'Команда', href: teamHref },
        { label: memberName(member), href: null },
      ],
    });
    return () => useWorkspaceStore.setState({ breadcrumbs: [] });
  }, [member, teamHref]);

  // The member list has to have arrived before "not found" can mean anything.
  if (!urlReady || loading || calendarLoading || membersLoading) {
    return (
      <div className="flex min-h-[360px] flex-1 items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (recordsError || calendarError) {
    return (
      <div className="flex min-h-[440px] flex-1 items-center justify-center bg-white">
        <EmptyState
          icon={AlertTriangle}
          title="Не вдалося завантажити аналітику учасника"
          description="Цифри не показуємо, бо частина даних недоступна. Спробуйте завантажити їх ще раз."
          action="Спробувати ще"
          onAction={refreshReading}
        />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="flex min-h-[440px] flex-1 items-center justify-center bg-white">
        <EmptyState
          icon={Users}
          title="Учасника не знайдено"
          description="Можливо, ця людина більше не входить до організації."
          action="Повернутися до команди"
          onAction={() => router.push(teamHref)}
        />
      </div>
    );
  }

  return (
    <div className="qt-nav-scroll custom-scrollbar h-full flex-1 overflow-y-auto overflow-x-hidden bg-transparent">
      <div className="workspace-page-layout min-h-full pb-[120px]">
        <Surface preset="panel" padding="lg" composition="member-chart-panel" className="flex-1">
          <WorkloadTab
            members={members}
            issues={memberIssues}
            scopedIssues={scopedIssues}
            logIssues={allIssues}
            timeLogs={memberTimeLogs}
            events={events}
            projects={visibleProjects}
            period={period}
            selectedMemberId={memberId}
            standaloneDetail
            detailView={detailView}
            onDetailViewChange={changeDetailView}
            timesheetMode={timesheetMode}
            onTimesheetModeChange={setTimesheetMode}
            timesheetAnchor={timesheetAnchor}
            onTimesheetAnchorChange={setTimesheetAnchor}
            onSelectMember={() => router.push(teamHref)}
            // The filters live in the member header rather than in a page
            // header of their own — they read as controls for the analytics
            // they actually scope, next to the person being analysed.
            detailFilters={(
              <FilterBar context="detail">
                <MultiSelect
                  value={projectFilters}
                  onChange={setProjectFilters}
                  options={activeProjects.map(project => ({ value: project.id, label: project.name }))}
                  placeholder="Всі проєкти"
                  searchPlaceholder="Пошук проєкту…"
                  filterRole="project"
                  variant="ghost"
                />
                <span className="mx-0.5 h-4 w-px shrink-0 bg-line" />
                <Segmented
                  value={period}
                  onChange={setPeriod}
                  options={PERIOD_OPTIONS}
                />
                <RefreshStamp at={readAt} loading={refreshing} onRefresh={refreshReading} />
              </FilterBar>
            )}
          />
        </Surface>
      </div>
    </div>
  );
}
