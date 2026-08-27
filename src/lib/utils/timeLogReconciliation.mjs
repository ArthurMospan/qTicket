export const MAX_RECONCILABLE_TIME_LOG_MINUTES = 525_600;

export function hasCanonicalIssueTimeScope(issue) {
  return Boolean(
    typeof issue?.id === 'string'
    && issue.id.trim()
    && typeof issue?.organizationId === 'string'
    && issue.organizationId.trim()
    && typeof issue?.projectId === 'string'
    && issue.projectId.trim()
  );
}

export function reconciliableTaskTimeLog(log, issue) {
  return Boolean(
    log
    && issue
    && hasCanonicalIssueTimeScope(issue)
    && log.issueId === issue.id
    && log.organizationId === issue.organizationId
    && log.projectId === issue.projectId
    && log.sourceType !== 'calendar_event'
    && !log.eventId
    && !log.occurrenceStartAt
    && Number.isSafeInteger(log.spentMinutes)
    && log.spentMinutes > 0
    && log.spentMinutes <= MAX_RECONCILABLE_TIME_LOG_MINUTES
  );
}

export function reconcileIssueSpentMinutes(issue, timeLogs = []) {
  const scopeValid = hasCanonicalIssueTimeScope(issue);
  const validLogs = [];
  const rejectedLogIds = [];
  for (const log of Array.isArray(timeLogs) ? timeLogs : []) {
    if (reconciliableTaskTimeLog(log, issue)) {
      validLogs.push(log);
    } else if (log?.id) {
      rejectedLogIds.push(log.id);
    }
  }
  return {
    scopeValid,
    spentMinutes: validLogs.reduce(
      (total, log) => total + log.spentMinutes,
      0,
    ),
    validLogCount: validLogs.length,
    rejectedLogIds,
  };
}
