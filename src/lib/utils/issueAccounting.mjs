import { existingParentIssueId } from './issueHierarchyModel.mjs';

const CALENDAR_EVENT_SOURCE = 'calendar_event';

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sharesIssueScope(child, parent) {
  if (child?.projectId && parent?.projectId && child.projectId !== parent.projectId) {
    return false;
  }
  if (
    child?.organizationId
    && parent?.organizationId
    && child.organizationId !== parent.organizationId
  ) {
    return false;
  }
  return true;
}

function cyclicChildIds(parentIdByChild) {
  const cyclicIds = new Set();
  const resolved = new Set();

  for (const startId of parentIdByChild.keys()) {
    if (resolved.has(startId)) continue;

    const path = [];
    const positionById = new Map();
    let currentId = startId;

    while (currentId && parentIdByChild.has(currentId) && !resolved.has(currentId)) {
      const cycleStart = positionById.get(currentId);
      if (cycleStart !== undefined) {
        path.slice(cycleStart).forEach(id => cyclicIds.add(id));
        break;
      }
      positionById.set(currentId, path.length);
      path.push(currentId);
      currentId = parentIdByChild.get(currentId);
    }

    path.forEach(id => resolved.add(id));
  }

  return cyclicIds;
}

/**
 * Builds the accounting view of task hierarchy.
 *
 * Only a resolvable same-project/same-organization `parentIssueId` creates an
 * edge. Broken legacy pointers stay visible as standalone work, while cyclic
 * pointers are ignored rather than making every task in a cycle disappear
 * from reports.
 */
export function buildIssueAccountingIndex(issues = []) {
  const byId = new Map();
  issues.forEach(issue => {
    const id = normalizedId(issue?.id);
    if (id && !byId.has(id)) byId.set(id, issue);
  });

  const candidateParentIdByChild = new Map();
  const orphanIssueIds = new Set();

  byId.forEach((issue, issueId) => {
    const parentId = normalizedId(existingParentIssueId(issue));
    if (!parentId) return;
    const parent = byId.get(parentId);
    if (
      !parent
      || parentId === issueId
      || !sharesIssueScope(issue, parent)
    ) {
      orphanIssueIds.add(issueId);
      return;
    }
    candidateParentIdByChild.set(issueId, parentId);
  });

  const cycleIssueIds = cyclicChildIds(candidateParentIdByChild);
  const parentIdByChild = new Map();
  const childIdsByParent = new Map();

  candidateParentIdByChild.forEach((parentId, childId) => {
    if (cycleIssueIds.has(childId)) return;
    parentIdByChild.set(childId, parentId);
    const childIds = childIdsByParent.get(parentId) || [];
    childIds.push(childId);
    childIdsByParent.set(parentId, childIds);
  });

  const summaryIssueIds = new Set(childIdsByParent.keys());
  const actionableIssueIds = new Set(
    [...byId.keys()].filter(id => !summaryIssueIds.has(id)),
  );

  return {
    actionableIssueIds,
    byId,
    childIdsByParent,
    cycleIssueIds,
    orphanIssueIds,
    parentIdByChild,
    summaryIssueIds,
  };
}

function actionableDescendantIds(parentId, index) {
  const result = [];
  const pending = [...(index.childIdsByParent.get(parentId) || [])];
  const visited = new Set([parentId]);

  while (pending.length > 0) {
    const issueId = pending.pop();
    if (!issueId || visited.has(issueId)) continue;
    visited.add(issueId);
    const children = index.childIdsByParent.get(issueId) || [];
    if (children.length === 0) result.push(issueId);
    else pending.push(...children);
  }

  return result;
}

/**
 * Parent progress is intentionally separate from task throughput. A nested
 * legacy hierarchy is reduced to its leaf descendants so it cannot count an
 * intermediate summary and its children at the same time.
 */
export function buildParentIssueProgress(issues = [], closedStatusIds = []) {
  const index = buildIssueAccountingIndex(issues);
  const closedSet = closedStatusIds instanceof Set
    ? closedStatusIds
    : new Set(closedStatusIds);

  return [...index.summaryIssueIds].map(parentId => {
    const childIds = actionableDescendantIds(parentId, index);
    const done = childIds.reduce((count, childId) => {
      const child = index.byId.get(childId);
      const statusId = child?.columnId || child?.status;
      return count + (closedSet.has(statusId) ? 1 : 0);
    }, 0);
    return {
      issue: index.byId.get(parentId),
      issueId: parentId,
      childIds,
      total: childIds.length,
      done,
      percent: childIds.length > 0 ? Math.round((done / childIds.length) * 100) : 0,
    };
  });
}

function validMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

export function isValidRawTimeLogMinutes(value) {
  const minutes = Number(value);
  return Number.isSafeInteger(minutes) && minutes > 0 && minutes <= 525_600;
}

function validRawLogMinutes(value) {
  return isValidRawTimeLogMinutes(value) ? Number(value) : 0;
}

/**
 * Aggregates each raw task time log once and retains source IDs for invoice
 * traceability. Calendar occurrence logs are handled by their own billing
 * grouping and are deliberately excluded here.
 */
export function aggregateIssueTimeLogs(logs = []) {
  const byIssue = {};
  const seenLogIds = new Set();

  logs.forEach(log => {
    if (
      log?.sourceType === CALENDAR_EVENT_SOURCE
      || log?.eventId
    ) {
      return;
    }
    const issueId = normalizedId(log?.issueId);
    if (!issueId) return;
    if (!isValidRawTimeLogMinutes(log?.spentMinutes)) return;

    const logId = normalizedId(log?.id);
    if (logId && seenLogIds.has(logId)) return;
    if (logId) seenLogIds.add(logId);

    if (!byIssue[issueId]) {
      byIssue[issueId] = { totalMinutes: 0, byUser: {}, logIds: [] };
    }
    const minutes = validRawLogMinutes(log?.spentMinutes);
    byIssue[issueId].totalMinutes += minutes;

    const userId = normalizedId(log?.userId);
    if (userId) {
      byIssue[issueId].byUser[userId] = (
        byIssue[issueId].byUser[userId] || 0
      ) + minutes;
    }
    if (logId) byIssue[issueId].logIds.push(logId);
  });

  return byIssue;
}

export function sumRawTimeLogMinutes(logs = []) {
  const seenLogIds = new Set();
  return logs.reduce((total, log) => {
    const logId = normalizedId(log?.id);
    if (logId && seenLogIds.has(logId)) return total;
    if (logId) seenLogIds.add(logId);
    return total + validRawLogMinutes(log?.spentMinutes);
  }, 0);
}

/**
 * An invoice charges for work that happened, so the only automatic source is
 * raw time logs. An estimate is a plan, and turning a plan into money without
 * anyone deciding to is the one thing billing must never do — a fixed price is
 * typed in by hand instead.
 */
export function calculateBillingAutoPrice({ logSummary, rates = {} } = {}) {
  if (validMinutes(logSummary?.totalMinutes) <= 0) return 0;
  return Object.entries(logSummary?.byUser || {}).reduce(
    (total, [userId, minutes]) => (
      total + (validMinutes(minutes) / 60) * (Number(rates[userId]) || 0)
    ),
    0,
  );
}

/**
 * Incremental invoicing offers the work that still has money left in it:
 * unbilled raw logs, or a task that has never been billed at all and may need
 * a hand-entered price. A task whose logs are already invoiced is settled
 * business and returns only when new unbilled logs appear.
 *
 * Task hierarchy is deliberately absent here. A parent bills its own logs like
 * any other task; nothing rolls up, so nothing can be charged twice.
 */
export function selectIncrementalBillableIssues(
  issues = [],
  availableTimeLogsByIssue = {},
  allTimeLogsByIssue = availableTimeLogsByIssue,
) {
  return issues.filter(issue => {
    const issueId = normalizedId(issue?.id);
    const availableActual = validMinutes(
      availableTimeLogsByIssue[issueId]?.totalMinutes,
    ) > 0;
    if (availableActual) return true;
    return (allTimeLogsByIssue[issueId]?.logIds || []).length === 0;
  });
}

export function collectSourceTimeLogIds(items = [], timeLogsByItem = {}) {
  const ids = new Set();
  items.forEach(item => {
    (timeLogsByItem[item?.id]?.logIds || []).forEach(id => {
      const normalized = normalizedId(id);
      if (normalized) ids.add(normalized);
    });
  });
  return [...ids];
}

const CANCELLED_INVOICE_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'voided',
]);

export function collectReservedInvoiceTimeLogIds(invoices = []) {
  const reservedIds = new Set();
  invoices.forEach(invoice => {
    const status = typeof invoice?.status === 'string'
      ? invoice.status.trim().toLowerCase()
      : '';
    if (CANCELLED_INVOICE_STATUSES.has(status)) return;
    const sourceIds = [
      ...(Array.isArray(invoice?.sourceTimeLogIds) ? invoice.sourceTimeLogIds : []),
      ...(Array.isArray(invoice?.items)
        ? invoice.items.flatMap(item => (
          Array.isArray(item?.sourceTimeLogIds) ? item.sourceTimeLogIds : []
        ))
        : []),
    ];
    sourceIds.forEach(id => {
      const normalized = normalizedId(id);
      if (normalized) reservedIds.add(normalized);
    });
  });
  return reservedIds;
}

export function collectReservedInvoiceItemIds(invoices = []) {
  const reservedIds = new Set();
  invoices.forEach(invoice => {
    const status = typeof invoice?.status === 'string'
      ? invoice.status.trim().toLowerCase()
      : '';
    if (CANCELLED_INVOICE_STATUSES.has(status)) return;
    (Array.isArray(invoice?.items) ? invoice.items : []).forEach(item => {
      const itemId = normalizedId(item?.itemId);
      const sourceIds = Array.isArray(item?.sourceTimeLogIds)
        ? item.sourceTimeLogIds.filter(id => normalizedId(id))
        : [];
      // An estimate/manual position without raw logs reserves the whole
      // billing item. Actual-time positions reserve only their source logs.
      if (itemId && sourceIds.length === 0) reservedIds.add(itemId);
    });
  });
  return reservedIds;
}

export function collectAmbiguousLegacyInvoiceKeys(invoices = []) {
  const keys = new Set();
  invoices.forEach(invoice => {
    const status = typeof invoice?.status === 'string'
      ? invoice.status.trim().toLowerCase()
      : '';
    if (CANCELLED_INVOICE_STATUSES.has(status)) return;
    (Array.isArray(invoice?.items) ? invoice.items : []).forEach(item => {
      const itemId = normalizedId(item?.itemId);
      const sourceIds = Array.isArray(item?.sourceTimeLogIds)
        ? item.sourceTimeLogIds.filter(id => normalizedId(id))
        : [];
      const key = normalizedId(item?.key);
      if (!itemId && sourceIds.length === 0 && key) keys.add(key);
    });
  });
  return keys;
}

/**
 * Drafts reserve source logs too: the current UI has no cancel/delete flow, so
 * silently issuing a second draft from the same work is more dangerous than
 * requiring the user to deselect the conflicting row. Cancelled/void invoices
 * release their sources, and estimate-only rows never conflict.
 */
export function findInvoiceTimeLogOverlap(
  items = [],
  timeLogsByItem = {},
  invoices = [],
) {
  const reservedIds = collectReservedInvoiceTimeLogIds(invoices);
  const reservedItemIds = collectReservedInvoiceItemIds(invoices);
  const ambiguousLegacyKeys = collectAmbiguousLegacyInvoiceKeys(invoices);
  const byItemId = {};
  const overlappingIds = new Set();
  const overlappingItemIds = new Set();

  items.forEach(item => {
    const itemId = normalizedId(item?.id);
    if (!itemId) return;
    const overlap = (timeLogsByItem[itemId]?.logIds || []).filter(id => (
      reservedIds.has(normalizedId(id))
    ));
    const itemReserved = (
      reservedItemIds.has(itemId)
      || ambiguousLegacyKeys.has(normalizedId(item?.issueKey || item?.key))
    );
    if (overlap.length === 0 && !itemReserved) return;
    byItemId[itemId] = [...new Set(overlap)];
    overlap.forEach(id => overlappingIds.add(id));
    if (itemReserved) overlappingItemIds.add(itemId);
  });

  return {
    byItemId,
    itemIds: Object.keys(byItemId),
    logIds: [...overlappingIds],
    sourceItemIds: [...overlappingItemIds],
  };
}
