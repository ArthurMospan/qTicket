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

function isYouTrackIssue(issue) {
  return issue?.source === 'youtrack'
    || issue?.importMetadata?.provider === 'youtrack';
}

/**
 * Return a completion date only when its provenance is trustworthy.
 *
 * `updatedAt` is deliberately not a fallback: editing a closed task is not
 * closing it. The first YouTrack importer also stamped old resolved tasks with
 * the migration time and did not store `importedAt`, so those legacy records
 * cannot support period or cycle-time claims. Current imports store both the
 * source completion date and the import marker and are safe to include.
 */
export function reliableCompletedAtMillis(issue) {
  const completedAt = timestampMillis(issue?.completedAt);
  if (completedAt <= 0) return 0;

  if (isYouTrackIssue(issue)) {
    const importedAt = timestampMillis(
      issue?.importedAt || issue?.importMetadata?.importedAt,
    );
    if (importedAt <= 0) return 0;
  }

  return completedAt;
}
