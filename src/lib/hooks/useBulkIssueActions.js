'use client';

import { useCallback, useMemo, useState } from 'react';
import { bulkIssuesViaApi } from '@/lib/services/issues';
import { useOptimisticPatch } from '@/lib/hooks/useOptimisticPatch';
import { optimisticBulkPatches } from '@/lib/bulk/issueBulkOptimistic.mjs';
import { MAX_BULK_ISSUES } from '@/lib/bulk/issueBulkActions.mjs';

function batches(values, size) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

// How many server-sized batches are in flight at once. Not unbounded: the
// endpoint rate-limits a user to 20 bulk requests a minute, and a selection of
// a thousand tasks would otherwise open twenty connections in one breath and
// spend the whole allowance before the first reply. Three is enough to hide the
// round-trip while leaving the limit room to breathe.
const BATCH_CONCURRENCY = 3;

/**
 * Runs the batches with a bounded number in flight, calling `onSettled` after
 * each one so the caller can count what has already landed. Results come back
 * in the order the batches were sent, not the order they finished.
 */
async function inFlight(items, limit, worker, onSettled) {
  const results = new Array(items.length);
  let next = 0;
  const runner = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
      onSettled?.(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

function resultMessage(result, selectedIssues, action) {
  const failed = result?.failed || [];
  const completed = result?.updated?.length || 0;
  const requested = result?.requested || selectedIssues.length;
  const base = action === 'duplicate'
    ? `Створено копій: ${completed} із ${requested}`
    : action === 'archive'
      ? `В архів: ${completed} із ${requested}`
      : action === 'cancel'
        ? `Скасовано ${completed} із ${requested}`
        : action === 'delete'
          ? `Видалено ${completed} із ${requested}`
          : `Оновлено ${completed} із ${requested}`;
  if (!failed.length) return base;
  const byId = new Map(selectedIssues.map(issue => [issue.id, issue.issueKey || issue.title || issue.id]));
  const reasons = failed
    .slice(0, 4)
    .map(item => `${byId.get(item.id) || item.id}: ${item.reason}`)
    .join('; ');
  const rest = failed.length > 4 ? `; ще ${failed.length - 4}` : '';
  return `${base}; ${failed.length} не змінено — ${reasons}${rest}`;
}

export function useBulkIssueActions({
  issues = [],
  organizationId,
  showToast,
  resolveStatusId,
}) {
  const [optimisticIssues, applyPatch, revertPatch] = useOptimisticPatch(issues);
  // `null` when nothing is running. The bar reads this to say how far along a
  // long selection is instead of going silently dead for minutes.
  const [progress, setProgress] = useState(null);
  const visibleIssues = useMemo(
    () => optimisticIssues.filter(issue => !issue._bulkArchived),
    [optimisticIssues],
  );

  const applyBulkAction = useCallback(async (action, value, selectedIssues) => {
    const scopedIssues = (selectedIssues || []).filter(issue => issue?.id);
    if (!organizationId || !scopedIssues.length) return null;
    const issueIds = scopedIssues.map(issue => issue.id);
    const optimistic = optimisticBulkPatches(scopedIssues, action, value, resolveStatusId);
    applyPatch(optimistic);
    setProgress({ action, done: 0, total: issueIds.length });

    try {
      // The endpoint is deliberately bounded. A user-facing «select all» must
      // still mean all, so larger selections are sent as safe server-sized
      // batches and merged into one partial-result contract.
      const result = { requested: issueIds.length, updated: [], failed: [] };
      const sent = batches(issueIds, MAX_BULK_ISSUES);
      const outcomes = await inFlight(
        sent,
        BATCH_CONCURRENCY,
        async issueIdBatch => {
          try {
            const batch = await bulkIssuesViaApi({
              organizationId,
              issueIds: issueIdBatch,
              action,
              value,
            });
            return { updated: batch.updated || [], failed: batch.failed || [] };
          } catch (error) {
            const reason = error?.message || 'Не вдалося виконати масову дію';
            return { updated: [], failed: issueIdBatch.map(id => ({ id, reason })) };
          }
        },
        issueIdBatch => setProgress(current => (current
          ? { ...current, done: current.done + issueIdBatch.length }
          : current)),
      );
      for (const outcome of outcomes) {
        result.updated.push(...outcome.updated);
        result.failed.push(...outcome.failed);
      }
      const failedIds = (result.failed || []).map(item => item.id);
      if (failedIds.length) revertPatch(failedIds);

      // Category operations resolve to each project's real status on the
      // server. Replace a guessed optimistic status with that authoritative
      // per-task patch as soon as the response arrives.
      const serverPatches = Object.fromEntries((result.updated || []).flatMap(item => (
        item.patch ? [[item.id, item.patch]] : []
      )));
      applyPatch(serverPatches);
      showToast?.(resultMessage(result, scopedIssues, action), failedIds.length ? 'error' : undefined);
      return result;
    } catch (error) {
      revertPatch(issueIds);
      showToast?.(error?.message || 'Не вдалося виконати масову дію', 'error');
      return {
        requested: issueIds.length,
        updated: [],
        failed: issueIds.map(id => ({ id, reason: error?.message || 'Не вдалося виконати масову дію' })),
      };
    } finally {
      setProgress(null);
    }
  }, [applyPatch, organizationId, resolveStatusId, revertPatch, showToast]);

  return { issues: visibleIssues, applyBulkAction, bulkProgress: progress };
}

export default useBulkIssueActions;
