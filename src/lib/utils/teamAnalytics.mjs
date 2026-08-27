export function filterTeamIssues(issues = [], projectIds = [], memberId = 'all') {
  return issues.filter(issue => {
    if (projectIds.length > 0 && !projectIds.includes(issue.projectId)) return false;
    if (memberId !== 'all' && !issue.assigneeIds?.includes(memberId)) return false;
    return true;
  });
}

export function filterTeamTimeLogs(timeLogs = [], projectIds = [], memberId = 'all') {
  return timeLogs.filter(log => {
    if (projectIds.length > 0 && !projectIds.includes(log.projectId)) return false;
    if (memberId !== 'all' && log.userId !== memberId) return false;
    return true;
  });
}

export function memberAnalyticsHref(memberId, {
  projectIds = [],
  period = 30,
  view = 'overview',
} = {}) {
  const normalizedId = typeof memberId === 'string' ? memberId.trim() : '';
  if (!normalizedId) return '/analytics?tab=workload';
  const params = new URLSearchParams();
  if (projectIds.length > 0) params.set('projects', [...new Set(projectIds)].join(','));
  if (period !== 30) params.set('period', String(period));
  if (view !== 'overview') params.set('view', view);
  const query = params.toString();
  return `/analytics/team/${encodeURIComponent(normalizedId)}${query ? `?${query}` : ''}`;
}
