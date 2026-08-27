import { createHash } from 'node:crypto';

export const CANONICAL_ISSUE_LINK_TYPES = Object.freeze([
  'blocks',
  'relates-to',
  'duplicates',
]);

const CANONICAL_TYPES = new Set(CANONICAL_ISSUE_LINK_TYPES);

function cleanId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= 256 ? normalized : '';
}

function sortedPair(sourceIssueId, targetIssueId) {
  return sourceIssueId < targetIssueId
    ? [sourceIssueId, targetIssueId]
    : [targetIssueId, sourceIssueId];
}

function encodedPart(value) {
  const text = String(value);
  return `${Buffer.byteLength(text, 'utf8')}:${text}`;
}

export function issueLinkPairKey({
  organizationId,
  projectId,
  sourceIssueId,
  targetIssueId,
}) {
  const organization = cleanId(organizationId);
  const project = cleanId(projectId);
  const source = cleanId(sourceIssueId);
  const target = cleanId(targetIssueId);
  if (!organization || !project || !source || !target || source === target) {
    return null;
  }
  const [first, second] = sortedPair(source, target);
  return [
    'issue-link-v2',
    organization,
    project,
    first,
    second,
  ].map(encodedPart).join('|');
}

export function canonicalIssueLinkDocumentId(input) {
  const pairKey = issueLinkPairKey(input);
  if (!pairKey) return null;
  return `link_v2_${createHash('sha256').update(pairKey).digest('hex')}`;
}

export function canonicalizeRequestedIssueLink({
  sourceIssueId,
  targetIssueId,
  relationType,
}) {
  const source = cleanId(sourceIssueId);
  const target = cleanId(targetIssueId);
  if (!source || !target || source === target || !CANONICAL_TYPES.has(relationType)) {
    return null;
  }
  if (relationType === 'relates-to') {
    const [first, second] = sortedPair(source, target);
    return {
      sourceIssueId: first,
      targetIssueId: second,
      relationType,
    };
  }
  return { sourceIssueId: source, targetIssueId: target, relationType };
}

function normalizedStoredLink(record) {
  const source = cleanId(record?.sourceIssueId);
  const target = cleanId(record?.targetIssueId);
  if (!source || !target || source === target) return null;

  const schemaVersion = Number(record.schemaVersion) || 1;
  if (record.relationType === 'blocks') {
    return {
      ...record,
      sourceIssueId: source,
      targetIssueId: target,
      relationType: 'blocks',
      groupKey: `blocks|${source}|${target}`,
      schemaVersion,
    };
  }
  if (record.relationType === 'is-blocked-by') {
    return {
      ...record,
      sourceIssueId: target,
      targetIssueId: source,
      relationType: 'blocks',
      groupKey: `blocks|${target}|${source}`,
      schemaVersion,
      legacyInverse: true,
    };
  }
  if (record.relationType === 'relates-to') {
    const [first, second] = sortedPair(source, target);
    return {
      ...record,
      sourceIssueId: first,
      targetIssueId: second,
      relationType: 'relates-to',
      groupKey: `relates-to|${first}|${second}`,
      schemaVersion,
    };
  }
  if (record.relationType === 'duplicates') {
    if (schemaVersion >= 2) {
      return {
        ...record,
        sourceIssueId: source,
        targetIssueId: target,
        relationType: 'duplicates',
        groupKey: `duplicates|${source}|${target}`,
        schemaVersion,
      };
    }
    const [first, second] = sortedPair(source, target);
    return {
      ...record,
      sourceIssueId: first,
      targetIssueId: second,
      relationType: 'duplicates',
      groupKey: `legacy-duplicates|${first}|${second}`,
      schemaVersion,
      legacyAmbiguousDirection: true,
    };
  }

  // A legacy subtask link is not safe to reinterpret as hierarchy: old data
  // contains the same `subtask-of` record in both directions. Keep it visible
  // as a review-required related link until the migration report is resolved.
  const [first, second] = sortedPair(source, target);
  return {
    ...record,
    sourceIssueId: first,
    targetIssueId: second,
    relationType: 'relates-to',
    groupKey: `legacy-review|${record.relationType || 'unknown'}|${first}|${second}`,
    schemaVersion,
    legacyRelationType: record.relationType || 'unknown',
    requiresReview: true,
  };
}

function createdAtMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const millis = new Date(value || 0).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

/**
 * Collapses the paired documents written by the legacy API into one logical
 * relation. New v2 documents pass through unchanged.
 */
export function normalizeStoredIssueLinks(records) {
  const groups = new Map();
  for (const rawRecord of Array.isArray(records) ? records : []) {
    const normalized = normalizedStoredLink(rawRecord);
    if (!normalized) continue;
    const group = groups.get(normalized.groupKey) || [];
    group.push(normalized);
    groups.set(normalized.groupKey, group);
  }

  return [...groups.values()].map(group => {
    const ordered = [...group].sort((left, right) => {
      const canonicalDifference = Number(right.schemaVersion >= 2) - Number(left.schemaVersion >= 2);
      if (canonicalDifference) return canonicalDifference;
      const timeDifference = createdAtMillis(left.createdAt) - createdAtMillis(right.createdAt);
      if (timeDifference) return timeDifference;
      return String(left.id || '').localeCompare(String(right.id || ''));
    });
    const primary = ordered[0];
    const legacyLinkIds = [...new Set(
      ordered.map(item => cleanId(item.id)).filter(Boolean),
    )].sort();
    const canonical = ordered.length === 1
      && primary.schemaVersion >= 2
      && !primary.requiresReview;

    return {
      id: cleanId(primary.id) || legacyLinkIds[0],
      organizationId: primary.organizationId || null,
      projectId: primary.projectId || null,
      sourceIssueId: primary.sourceIssueId,
      targetIssueId: primary.targetIssueId,
      relationType: primary.relationType,
      createdBy: primary.createdBy || null,
      createdAt: primary.createdAt || null,
      schemaVersion: canonical ? 2 : 1,
      ...(canonical ? {} : {
        legacy: true,
        legacyLinkIds,
      }),
      ...(ordered.some(item => item.legacyAmbiguousDirection)
        ? { legacyAmbiguousDirection: true, requiresReview: true }
        : {}),
      ...(ordered.some(item => item.requiresReview === true)
        ? { requiresReview: true }
        : {}),
      ...(primary.legacyRelationType
        ? {
            legacyRelationType: primary.legacyRelationType,
            requiresReview: true,
          }
        : {}),
    };
  }).sort((left, right) => {
    const timeDifference = createdAtMillis(left.createdAt) - createdAtMillis(right.createdAt);
    return timeDifference || String(left.id).localeCompare(String(right.id));
  });
}

/**
 * Returns the cycle that would be created by a new directional relation, or
 * null when the edge is safe. The returned path starts and ends at `source`.
 * Review-required legacy relations and dangling endpoints are deliberately
 * ignored: their direction or existence is not trustworthy enough to enforce.
 */
export function findDirectionalIssueLinkCycle({
  sourceIssueId,
  targetIssueId,
  relationType,
  links,
  knownIssueIds,
}) {
  if (!['blocks', 'duplicates'].includes(relationType)) return null;
  const source = cleanId(sourceIssueId);
  const target = cleanId(targetIssueId);
  if (!source || !target || source === target) return null;

  const known = knownIssueIds
    ? new Set([...knownIssueIds].map(cleanId).filter(Boolean))
    : null;
  if (known && (!known.has(source) || !known.has(target))) return null;

  const adjacency = new Map();
  for (const link of Array.isArray(links) ? links : []) {
    if (link?.relationType !== relationType || link.requiresReview === true) continue;
    const from = cleanId(link.sourceIssueId);
    const to = cleanId(link.targetIssueId);
    if (!from || !to || from === to) continue;
    if (known && (!known.has(from) || !known.has(to))) continue;
    const targets = adjacency.get(from) || new Set();
    targets.add(to);
    adjacency.set(from, targets);
  }

  const queue = [target];
  const previous = new Map([[target, null]]);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === source) {
      const path = [];
      let cursor = source;
      while (cursor) {
        path.push(cursor);
        cursor = previous.get(cursor);
      }
      path.reverse();
      return [source, ...path];
    }
    for (const next of adjacency.get(current) || []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  return null;
}
