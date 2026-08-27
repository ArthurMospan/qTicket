const DAY_MS = 86_400_000;

function timestampMillis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  if (typeof value === 'string') {
    const millis = new Date(value).getTime();
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

export function issueCycleStartMillis(issue) {
  return timestampMillis(issue?.createdAt);
}

// The value at a share of the way through a sorted list. Nearest-rank, not
// interpolated: a cycle time is a whole number of days to the reader, and
// inventing 4.3 days between two real tasks is precision the data does not have.
function percentile(sortedValues, share) {
  if (sortedValues.length === 0) return null;
  const rank = Math.ceil(share * sortedValues.length);
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, rank - 1))];
}

/**
 * Build cycle-time metrics without allowing corrupted dates to disappear.
 * Imported YouTrack history uses the source creation and completion dates.
 * The caller admits only completion dates with trustworthy provenance; moving
 * the start to the QuickTeam migration date would turn historical work into a
 * negative or artificially short cycle.
 *
 * Three readings, because one of them was lying. Cycle time is the textbook
 * skewed distribution: most tasks close in a few days and a handful sit open
 * for months, and the mean is dragged by that tail until it describes no task
 * anybody actually worked on. «Середній цикл 12д» in a team whose typical task
 * closes in three is not a rounding error, it is the wrong sentence.
 *
 * `medianDays` is the typical task. `p85Days` is the promise you can make about
 * the rest — "almost everything is done within" — which is the number a
 * deadline is actually built from. `averageDays` stays because the exported
 * file has always carried it and a report that changes its own history is
 * worse than a mean nobody reads.
 */
export function summarizeCycleTimes(issues, getCompletedAtMillis) {
  const values = [];
  const invalidIssueIds = [];

  for (const issue of issues || []) {
    const startedAt = issueCycleStartMillis(issue);
    const completedAt = Number(getCompletedAtMillis(issue)) || 0;
    if (startedAt <= 0 || completedAt <= 0) continue;

    const days = (completedAt - startedAt) / DAY_MS;
    if (days < 0) {
      invalidIssueIds.push(issue.id || issue.issueKey || 'unknown');
      continue;
    }
    values.push(days);
  }

  const sorted = [...values].sort((left, right) => left - right);
  const round = value => (value === null ? null : Math.round(value));

  return {
    averageDays: values.length > 0
      ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null,
    medianDays: round(percentile(sorted, 0.5)),
    p85Days: round(percentile(sorted, 0.85)),
    sampleSize: values.length,
    invalidIssueIds,
  };
}
