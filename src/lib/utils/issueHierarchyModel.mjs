const ERROR_DEFINITIONS = Object.freeze({
  INVALID_PARENT_ID: {
    status: 400,
    message: 'Некоректний ідентифікатор батьківського завдання',
  },
  SELF_PARENT: {
    status: 400,
    message: 'Завдання не може бути підзавданням самого себе',
  },
  PARENT_NOT_FOUND: {
    status: 404,
    message: 'Батьківське завдання не знайдено',
  },
  PARENT_SCOPE_MISMATCH: {
    status: 400,
    message: 'Батьківське завдання має бути в тому самому проєкті',
  },
  PARENT_IS_CHILD: {
    status: 409,
    message: 'Підзавдання не може мати власні підзавдання',
  },
  ISSUE_HAS_CHILDREN: {
    status: 409,
    message: 'Завдання з підзавданнями не можна зробити підзавданням',
  },
  ISSUE_DELETING: {
    status: 409,
    message: 'Завдання вже видаляється',
  },
  PARENT_DELETING: {
    status: 409,
    message: 'Батьківське завдання вже видаляється',
  },
});

export const ISSUE_HIERARCHY_ERROR_CODES = Object.freeze(
  Object.keys(ERROR_DEFINITIONS),
);

export function issueHierarchyError(code, details = {}) {
  const definition = ERROR_DEFINITIONS[code];
  if (!definition) throw new TypeError(`Unknown issue hierarchy error: ${code}`);
  return { code, ...definition, ...details };
}

export function normalizeParentIssueId(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 256 ? normalized : undefined;
}

export function existingParentIssueId(issue) {
  if (!issue || typeof issue !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(issue, 'parentIssueId')) {
    return normalizeParentIssueId(issue.parentIssueId) ?? null;
  }
  return normalizeParentIssueId(issue.parentEpicId) ?? null;
}

/**
 * Finds cycles formed specifically by canonical `parentIssueId` fields.
 * Legacy pointers are intentionally excluded: the migration must report
 * corruption already present in the authoritative field separately from
 * ambiguous legacy data.
 */
export function findCanonicalIssueParentCycles(issues = []) {
  const parentByIssue = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    const issueId = normalizeParentIssueId(issue?.id);
    if (!issueId || !Object.prototype.hasOwnProperty.call(issue, 'parentIssueId')) {
      continue;
    }
    const parentIssueId = normalizeParentIssueId(issue.parentIssueId);
    if (parentIssueId) parentByIssue.set(issueId, parentIssueId);
  }

  const visited = new Set();
  const cycles = [];
  for (const startIssueId of [...parentByIssue.keys()].sort()) {
    if (visited.has(startIssueId)) continue;
    const path = [];
    const pathIndex = new Map();
    let cursor = startIssueId;
    while (cursor && parentByIssue.has(cursor) && !visited.has(cursor)) {
      if (pathIndex.has(cursor)) {
        const cycle = path.slice(pathIndex.get(cursor));
        const firstIndex = cycle.reduce(
          (best, value, index) => (value < cycle[best] ? index : best),
          0,
        );
        const normalized = [
          ...cycle.slice(firstIndex),
          ...cycle.slice(0, firstIndex),
        ];
        cycles.push([...normalized, normalized[0]]);
        break;
      }
      pathIndex.set(cursor, path.length);
      path.push(cursor);
      cursor = parentByIssue.get(cursor);
    }
    path.forEach(issueId => visited.add(issueId));
  }
  return cycles.sort((left, right) => left[0].localeCompare(right[0]));
}

/**
 * Validates the one-level hierarchy invariant without depending on Firestore.
 * The caller remains responsible for loading `parent` and the current child
 * documents in the same transaction that performs the write.
 */
export function validateIssueParentAssignment({
  issueId,
  issue,
  requestedParentIssueId,
  parent,
  childIds = [],
}) {
  const parentIssueId = normalizeParentIssueId(requestedParentIssueId);
  if (parentIssueId === undefined) return issueHierarchyError('INVALID_PARENT_ID');
  if (issue?.deletionPending === true) return issueHierarchyError('ISSUE_DELETING');
  if (parentIssueId === null) return null;
  if (parentIssueId === issueId) return issueHierarchyError('SELF_PARENT');
  if (!parent) return issueHierarchyError('PARENT_NOT_FOUND');

  if (
    !issue
    || parent.organizationId !== issue.organizationId
    || parent.projectId !== issue.projectId
  ) {
    return issueHierarchyError('PARENT_SCOPE_MISMATCH');
  }
  if (parent.deletionPending === true) return issueHierarchyError('PARENT_DELETING');
  if (existingParentIssueId(parent)) return issueHierarchyError('PARENT_IS_CHILD');

  const otherChildren = [...new Set(
    (Array.isArray(childIds) ? childIds : []).filter(
      childId => typeof childId === 'string' && childId !== issueId,
    ),
  )];
  if (otherChildren.length > 0) {
    return issueHierarchyError('ISSUE_HAS_CHILDREN', {
      childCount: otherChildren.length,
    });
  }
  return null;
}

export function legacySubtasksToChecklist(description, subtasks) {
  const source = typeof description === 'string' ? description : '';
  const items = (Array.isArray(subtasks) ? subtasks : []).flatMap(item => {
    const title = typeof item?.title === 'string'
      ? item.title.replace(/\s+/gu, ' ').trim()
      : '';
    return title ? [{ title, done: item.done === true }] : [];
  });
  if (items.length === 0) return source;

  const marker = '<!-- quickteam:legacy-subtasks-migrated -->';
  if (source.includes(marker)) return source;
  const checklist = [
    marker,
    '## Чекліст',
    ...items.map(item => `- [${item.done ? 'x' : ' '}] ${item.title}`),
  ].join('\n');
  return source.trimEnd() ? `${source.trimEnd()}\n\n${checklist}` : checklist;
}
