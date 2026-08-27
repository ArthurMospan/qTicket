import { existingParentIssueId } from './issueHierarchyModel.mjs';
import { issueStatusId } from './issueExecution.mjs';
import { plural } from './plural.mjs';

export const MAX_ISSUE_STATUS_ORDER_UPDATES = 350;

const MAX_SAFE_ORDER = Number.MAX_SAFE_INTEGER;

function cleanId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 256 && !normalized.includes('/')
    ? normalized
    : '';
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function validOrder(value) {
  return Number.isFinite(value) && Math.abs(value) <= MAX_SAFE_ORDER;
}

function inputError(code, message, details = {}) {
  return {
    error: {
      code,
      status: 400,
      message,
      ...details,
    },
  };
}

/**
 * Parses the status-transition API body without depending on Firestore.
 *
 * `orderUpdates` may contain the moved issue because the board's move planner
 * produces one patch map for the whole destination/source layout. The moved
 * issue is folded into `order`; every remaining entry is a peer update.
 */
export function normalizeIssueStatusTransitionInput(body, issueId) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return inputError(
      'INVALID_STATUS_TRANSITION_BODY',
      'Тіло запиту має бути JSON-об’єктом',
    );
  }

  const status = cleanId(body.status);
  if (!status) {
    return inputError(
      'INVALID_STATUS',
      'Потрібен коректний статус завдання',
    );
  }

  let order;
  if (owns(body, 'order')) {
    if (!validOrder(body.order)) {
      return inputError(
        'INVALID_ISSUE_ORDER',
        'Позиція завдання має бути скінченним безпечним числом',
      );
    }
    order = body.order;
  }

  const rawOrderUpdates = owns(body, 'orderUpdates') ? body.orderUpdates : [];
  if (!Array.isArray(rawOrderUpdates)) {
    return inputError(
      'INVALID_ORDER_UPDATES',
      'orderUpdates має бути масивом змін позицій',
    );
  }
  if (rawOrderUpdates.length > MAX_ISSUE_STATUS_ORDER_UPDATES) {
    return inputError(
      'TOO_MANY_ORDER_UPDATES',
      `За один запит можна змінити не більше ${MAX_ISSUE_STATUS_ORDER_UPDATES} ${plural(MAX_ISSUE_STATUS_ORDER_UPDATES, ['позиції', 'позицій', 'позицій'])}`,
      { maxOrderUpdates: MAX_ISSUE_STATUS_ORDER_UPDATES },
    );
  }

  const currentIssueId = cleanId(issueId);
  const seen = new Set();
  const orderUpdates = [];
  for (const entry of rawOrderUpdates) {
    const entryIssueId = cleanId(entry?.issueId);
    if (!entryIssueId || !validOrder(entry?.order)) {
      return inputError(
        'INVALID_ORDER_UPDATE',
        'Кожна зміна позиції має містити коректні issueId та order',
      );
    }
    if (seen.has(entryIssueId)) {
      return inputError(
        'DUPLICATE_ORDER_UPDATE',
        'Одне завдання не можна двічі вказати в orderUpdates',
        { issueId: entryIssueId },
      );
    }
    seen.add(entryIssueId);

    if (entryIssueId === currentIssueId) {
      if (order !== undefined && order !== entry.order) {
        return inputError(
          'CONFLICTING_ISSUE_ORDER',
          'Позиція переміщеного завдання відрізняється в order та orderUpdates',
        );
      }
      order = entry.order;
    } else {
      orderUpdates.push({ issueId: entryIssueId, order: entry.order });
    }
  }

  return {
    value: {
      status,
      order,
      orderUpdates,
    },
  };
}

/**
 * Converts canonical `blocks` and the legacy inverse document into the same
 * directional edge: source blocks target. Paired legacy records collapse by
 * edge, while review-only or malformed records never enforce execution state.
 */
export function normalizedIssueBlockEdges(issueLinks = []) {
  const edges = new Map();
  for (const link of Array.isArray(issueLinks) ? issueLinks : []) {
    if (link?.requiresReview === true) continue;
    let sourceIssueId;
    let targetIssueId;
    if (link?.relationType === 'blocks') {
      sourceIssueId = cleanId(link.sourceIssueId);
      targetIssueId = cleanId(link.targetIssueId);
    } else if (link?.relationType === 'is-blocked-by') {
      sourceIssueId = cleanId(link.targetIssueId);
      targetIssueId = cleanId(link.sourceIssueId);
    } else {
      continue;
    }
    if (!sourceIssueId || !targetIssueId || sourceIssueId === targetIssueId) {
      continue;
    }
    const key = `${sourceIssueId}\u0000${targetIssueId}`;
    if (!edges.has(key)) {
      edges.set(key, { sourceIssueId, targetIssueId });
    }
  }
  return [...edges.values()];
}

function executionViolationKey(violation) {
  return violation.type === 'completed-parent-open-child'
    ? `parent\u0000${violation.parentIssueId}\u0000${violation.childIssueId}`
    : `blocks\u0000${violation.blockerIssueId}\u0000${violation.targetIssueId}`;
}

/**
 * Validates the final state of a whole execution graph. This is used for bulk
 * status migrations and workflow terminal-semantics changes where evaluating
 * issues one by one would incorrectly reject a parent and child that move
 * together.
 */
export function issueExecutionGraphViolations({
  issues = [],
  issueLinks = [],
  closedStatusIds = [],
} = {}) {
  const closedStatusSet = closedSetOf(closedStatusIds);
  const issuesById = issueMapOf(issues);
  const violations = new Map();

  for (const child of issuesById.values()) {
    if (!liveIssue(child)) continue;
    const parentIssueId = existingParentIssueId(child);
    if (!parentIssueId) continue;
    const parent = issuesById.get(parentIssueId);
    if (
      liveIssue(parent)
      && sameExecutionScope(parent, child)
      && closedStatusSet.has(issueStatusId(parent))
      && !closedStatusSet.has(issueStatusId(child))
    ) {
      const violation = {
        type: 'completed-parent-open-child',
        parentIssueId,
        childIssueId: cleanId(child.id),
      };
      violations.set(executionViolationKey(violation), violation);
    }
  }

  for (const edge of normalizedIssueBlockEdges(issueLinks)) {
    const blocker = issuesById.get(edge.sourceIssueId);
    const target = issuesById.get(edge.targetIssueId);
    if (
      liveIssue(blocker)
      && liveIssue(target)
      && sameExecutionScope(blocker, target)
      && closedStatusSet.has(issueStatusId(target))
      && !closedStatusSet.has(issueStatusId(blocker))
    ) {
      const violation = {
        type: 'completed-target-open-blocker',
        blockerIssueId: edge.sourceIssueId,
        targetIssueId: edge.targetIssueId,
      };
      violations.set(executionViolationKey(violation), violation);
    }
  }

  return [...violations.values()].sort((left, right) => (
    executionViolationKey(left).localeCompare(executionViolationKey(right))
  ));
}

export function introducedIssueExecutionViolations({
  currentIssues = [],
  nextIssues = [],
  issueLinks = [],
  currentClosedStatusIds = [],
  nextClosedStatusIds = [],
} = {}) {
  const currentKeys = new Set(
    issueExecutionGraphViolations({
      issues: currentIssues,
      issueLinks,
      closedStatusIds: currentClosedStatusIds,
    }).map(executionViolationKey),
  );
  return issueExecutionGraphViolations({
    issues: nextIssues,
    issueLinks,
    closedStatusIds: nextClosedStatusIds,
  }).filter(violation => !currentKeys.has(executionViolationKey(violation)));
}

function closedSetOf(closedStatusIds) {
  return new Set(
    [...(closedStatusIds || [])]
      .map(value => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean),
  );
}

function issueMapOf(issues) {
  return new Map(
    (Array.isArray(issues) ? issues : []).flatMap(issue => {
      const id = cleanId(issue?.id);
      return id ? [[id, issue]] : [];
    }),
  );
}

function liveIssue(issue) {
  return issue && issue.deletionPending !== true;
}

function sameExecutionScope(left, right) {
  if (!left || !right) return false;
  if (
    left.organizationId
    && right.organizationId
    && left.organizationId !== right.organizationId
  ) {
    return false;
  }
  if (
    left.projectId
    && right.projectId
    && left.projectId !== right.projectId
  ) {
    return false;
  }
  return true;
}

function transitionError(code, message, details) {
  return {
    code,
    status: 409,
    message,
    ...details,
  };
}

export function issueParentStatusConflict({
  issue,
  parentIssue,
  closedStatusIds = [],
} = {}) {
  if (!liveIssue(issue) || !liveIssue(parentIssue)) return null;
  const closedStatusSet = closedSetOf(closedStatusIds);
  if (
    closedStatusSet.has(issueStatusId(parentIssue))
    && !closedStatusSet.has(issueStatusId(issue))
  ) {
    return transitionError(
      'COMPLETED_PARENT_REQUIRES_COMPLETED_CHILD',
      'Неможливо додати незавершене підзавдання до завершеного основного завдання',
      {
        parentIssueId: cleanId(parentIssue.id) || null,
      },
    );
  }
  return null;
}

export function issueBlockLinkStatusConflict({
  sourceIssue,
  targetIssue,
  relationType,
  closedStatusIds = [],
} = {}) {
  if (
    relationType !== 'blocks'
    || !liveIssue(sourceIssue)
    || !liveIssue(targetIssue)
  ) {
    return null;
  }
  const closedStatusSet = closedSetOf(closedStatusIds);
  if (
    closedStatusSet.has(issueStatusId(targetIssue))
    && !closedStatusSet.has(issueStatusId(sourceIssue))
  ) {
    return transitionError(
      'COMPLETED_TARGET_REQUIRES_COMPLETED_BLOCKER',
      'Неможливо додати активний блокер до вже завершеного завдання',
      {
        sourceIssueId: cleanId(sourceIssue.id) || null,
        targetIssueId: cleanId(targetIssue.id) || null,
      },
    );
  }
  return null;
}

/**
 * Enforces the execution invariants for an already validated workflow status.
 * Callers must load every supplied document in the same transaction as the
 * eventual write.
 */
export function evaluateIssueStatusTransition({
  issueId,
  issue,
  nextStatusId,
  closedStatusIds = [],
  childIssues = [],
  parentIssue = null,
  issueLinks = [],
  relatedIssues = [],
} = {}) {
  const currentIssueId = cleanId(issueId);
  const fromStatusId = issueStatusId(issue);
  const closedStatusSet = closedSetOf(closedStatusIds);
  const wasClosed = closedStatusSet.has(fromStatusId);
  const willBeClosed = closedStatusSet.has(nextStatusId);
  const enteringTerminal = !wasClosed && willBeClosed;
  const leavingTerminal = wasClosed && !willBeClosed;
  const relatedById = issueMapOf([
    ...(Array.isArray(relatedIssues) ? relatedIssues : []),
    ...(Array.isArray(childIssues) ? childIssues : []),
    ...(parentIssue ? [parentIssue] : []),
  ]);
  const blockEdges = normalizedIssueBlockEdges(issueLinks);

  const openChildren = enteringTerminal
    ? [...new Map(
      childIssues
        .filter(child => (
          liveIssue(child)
          && existingParentIssueId(child) === currentIssueId
          && !closedStatusSet.has(issueStatusId(child))
        ))
        .map(child => [cleanId(child.id), child]),
    ).values()]
    : [];

  const openBlockers = enteringTerminal
    ? blockEdges.flatMap(edge => {
      if (edge.targetIssueId !== currentIssueId) return [];
      const blocker = relatedById.get(edge.sourceIssueId);
      return liveIssue(blocker) && !closedStatusSet.has(issueStatusId(blocker))
        ? [blocker]
        : [];
    })
    : [];

  const parentIssueId = existingParentIssueId(issue);
  const completedParent = leavingTerminal
    && parentIssueId
    && cleanId(parentIssue?.id) === parentIssueId
    && liveIssue(parentIssue)
    && closedStatusSet.has(issueStatusId(parentIssue))
    ? parentIssue
    : null;

  const completedBlockedTargets = leavingTerminal
    ? blockEdges.flatMap(edge => {
      if (edge.sourceIssueId !== currentIssueId) return [];
      const target = relatedById.get(edge.targetIssueId);
      return liveIssue(target) && closedStatusSet.has(issueStatusId(target))
        ? [target]
        : [];
    })
    : [];

  if (openChildren.length > 0 || openBlockers.length > 0) {
    const reasons = [];
    if (openChildren.length > 0) {
      reasons.push(`незавершені підзавдання: ${openChildren.length}`);
    }
    if (openBlockers.length > 0) {
      reasons.push(`активні блокери: ${openBlockers.length}`);
    }
    return {
      fromStatusId,
      toStatusId: nextStatusId,
      enteringTerminal,
      leavingTerminal,
      error: transitionError(
        'ISSUE_COMPLETION_BLOCKED',
        `Неможливо завершити завдання — ${reasons.join('; ')}`,
        {
          openChildIssueIds: openChildren.map(child => child.id),
          openBlockerIssueIds: openBlockers.map(blocker => blocker.id),
        },
      ),
    };
  }

  if (completedParent || completedBlockedTargets.length > 0) {
    const reasons = [];
    if (completedParent) reasons.push('основне завдання вже завершене');
    if (completedBlockedTargets.length > 0) {
      reasons.push(`завершені заблоковані завдання: ${completedBlockedTargets.length}`);
    }
    return {
      fromStatusId,
      toStatusId: nextStatusId,
      enteringTerminal,
      leavingTerminal,
      error: transitionError(
        'ISSUE_REOPEN_BLOCKED',
        `Неможливо повторно відкрити завдання — ${reasons.join('; ')}`,
        {
          completedParentIssueId: completedParent?.id || null,
          completedBlockedTargetIssueIds: completedBlockedTargets.map(target => target.id),
        },
      ),
    };
  }

  return {
    fromStatusId,
    toStatusId: nextStatusId,
    enteringTerminal,
    leavingTerminal,
    error: null,
  };
}
