export const ISSUE_UNDO_RETENTION_MS = 24 * 60 * 60 * 1000;

export function issueTombstoneId(organizationId, issueId) {
  const org = String(organizationId || '').trim();
  const issue = String(issueId || '').trim();
  if (!org || !issue) return '';
  return `${org}_${issue}`;
}

export function issueUndoExpiresAt(deletedAtMs) {
  const value = Number(deletedAtMs);
  return Number.isFinite(value) ? value + ISSUE_UNDO_RETENTION_MS : 0;
}

export function canRestoreIssueTombstone(tombstone, nowMs = Date.now()) {
  const purgeAfterMs = tombstone?.purgeAfter?.toMillis?.()
    ?? new Date(tombstone?.purgeAfter || 0).getTime();
  return Boolean(
    tombstone?.issue
    && !tombstone?.purgingAt
    && Number.isFinite(purgeAfterMs)
    && purgeAfterMs > nowMs,
  );
}
