import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import 'server-only';

import { getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  analyticsRollupDeltasFor,
  commitAnalyticsRollupDeltas,
} from '@/lib/server/analyticsRollups';
import { isBilledTimeLog } from '@/lib/utils/issueDeletion.mjs';

const PURGE_BATCH_SIZE = 25;

async function deleteRefsInBatches(db, refs) {
  const uniqueRefs = [...new Map(refs.map(ref => [ref.path, ref])).values()];
  for (let offset = 0; offset < uniqueRefs.length; offset += 400) {
    const batch = db.batch();
    uniqueRefs.slice(offset, offset + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
  return uniqueRefs.length;
}

async function loadIssueRelationsAndTimeLogs(db, issue) {
  const [sourceLinks, targetLinks, timeLogs] = await Promise.all([
    db.collection('issueLinks').where('sourceIssueId', '==', issue.id).get(),
    db.collection('issueLinks').where('targetIssueId', '==', issue.id).get(),
    db.collection('timeLogs')
      .where('organizationId', '==', issue.organizationId)
      .where('issueId', '==', issue.id)
      .get(),
  ]);
  return {
    billedLogs: timeLogs.docs.filter(document => isBilledTimeLog(document.data())),
    timeLogs: timeLogs.docs.map(document => ({ ...document.data(), id: document.id })),
    refs: [
      ...sourceLinks.docs
        .filter(document => document.data().organizationId === issue.organizationId)
        .map(document => document.ref),
      ...targetLinks.docs
        .filter(document => document.data().organizationId === issue.organizationId)
        .map(document => document.ref),
      ...timeLogs.docs.map(document => document.ref),
    ],
  };
}

async function purgeIssueTombstone(tombstoneDocument, nowMs) {
  const db = getAdminDb();
  const initial = tombstoneDocument.data();
  const issue = initial?.issue;
  if (
    !issue
    || issue.id !== initial.issueId
    || issue.organizationId !== initial.organizationId
    || issue.projectId !== initial.projectId
  ) {
    await tombstoneDocument.ref.set({
      purgeError: 'INVALID_TOMBSTONE_SCOPE',
      purgeFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { purged: 0, failed: 1, related: 0 };
  }

  // Accounting evidence is immutable. The DELETE route checks this before the
  // tombstone is created; this second guard makes the final cascade fail closed
  // if corrupt or externally-written evidence appears during retention.
  const related = await loadIssueRelationsAndTimeLogs(db, issue);
  if (related.billedLogs.length > 0) {
    await tombstoneDocument.ref.set({
      purgeError: 'ISSUE_HAS_BILLED_TIME',
      purgeFailedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { purged: 0, failed: 1, related: 0 };
  }

  const issueRef = db.collection('issues').doc(issue.id);
  const projectRef = db.collection('projects').doc(issue.projectId);
  const prepared = await db.runTransaction(async transaction => {
    const currentTombstone = await transaction.get(tombstoneDocument.ref);
    const liveIssue = await transaction.get(issueRef);
    const project = await transaction.get(projectRef);
    if (!currentTombstone.exists) return { proceed: false };
    if (liveIssue.exists) {
      transaction.delete(tombstoneDocument.ref);
      return { proceed: false };
    }
    const current = currentTombstone.data();
    const purgeAfterMs = current.purgeAfter?.toMillis?.() ?? Number.POSITIVE_INFINITY;
    if (purgeAfterMs > nowMs) return { proceed: false };

    const canonicalChildren = await transaction.get(
      db.collection('issues').where('parentIssueId', '==', issue.id),
    );
    const legacyChildren = await transaction.get(
      db.collection('issues').where('parentEpicId', '==', issue.id),
    );
    const children = [...new Map(
      [...canonicalChildren.docs, ...legacyChildren.docs]
        .filter(child => {
          const data = child.data();
          return data.organizationId === issue.organizationId
            && data.projectId === issue.projectId;
        })
        .map(child => [child.id, child]),
    ).values()];
    const now = FieldValue.serverTimestamp();
    children.forEach(child => transaction.update(child.ref, {
      parentIssueId: null,
      parentEpicId: FieldValue.delete(),
      updatedAt: now,
    }));
    transaction.update(tombstoneDocument.ref, { purgingAt: now });
    if (project.exists && project.data().organizationId === issue.organizationId) {
      transaction.update(projectRef, {
        issueHierarchyVersion: FieldValue.increment(1),
        updatedAt: now,
      });
    }
    return { proceed: true };
  });
  if (!prepared.proceed) return { purged: 0, failed: 0, related: 0 };

  // The hours go with the task. Deleting is the one of the three that removes
  // the record rather than moving it, so the days those hours were logged on
  // stop counting them — «logged» and «cancelled» alike, because a purged task
  // is not a task that was called off, it is a task that never existed.
  await removePurgedTimeLogsFromRollups(db, issue, related.timeLogs);
  const relatedCount = await deleteRefsInBatches(db, related.refs);
  // The parent issue document is already absent, but recursiveDelete still
  // removes its retained comments and audit descendants.
  await db.recursiveDelete(issueRef);
  await tombstoneDocument.ref.delete();
  return { purged: 1, failed: 0, related: relatedCount };
}

async function removePurgedTimeLogsFromRollups(db, issue, timeLogs) {
  if (!timeLogs?.length) return;
  const deltas = await analyticsRollupDeltasFor(db, issue.organizationId);
  const cancelled = Boolean(issue.cancelledAt);
  for (const log of timeLogs) deltas.add(log, -1, { cancelled });
  // Batches rather than a transaction: the log documents themselves are removed
  // in batches too, and a task worked on for a year touches more days than one
  // transaction may write.
  await commitAnalyticsRollupDeltas(db, deltas);
}

export async function purgeExpiredDeletedIssues({ nowMs = Date.now() } = {}) {
  const db = getAdminDb();
  const snapshot = await db.collection('deletedIssues')
    .where('purgeAfter', '<=', Timestamp.fromMillis(nowMs))
    .limit(PURGE_BATCH_SIZE)
    .get();
  const totals = { scanned: snapshot.size, purged: 0, failed: 0, related: 0 };
  for (const tombstone of snapshot.docs) {
    try {
      const result = await purgeIssueTombstone(tombstone, nowMs);
      totals.purged += result.purged;
      totals.failed += result.failed;
      totals.related += result.related;
    } catch (error) {
      totals.failed += 1;
      console.warn('[issue-trash] Could not purge tombstone:', tombstone.id, error.message);
    }
  }
  return totals;
}
