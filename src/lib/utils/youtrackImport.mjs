const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^0\./,
];

function isPrivateIpv4(hostname) {
  const match = hostname.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function normalizeYouTrackBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Вкажіть адресу YouTrack');
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('YouTrack має використовувати HTTPS');
  if (url.username || url.password || url.port) throw new Error('Некоректна адреса YouTrack');
  if (
    PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(url.hostname))
    || isPrivateIpv4(url.hostname)
    || url.hostname === '::1'
  ) {
    throw new Error('Локальні та приватні адреси YouTrack не підтримуються');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  return url.toString().replace(/\/+$/, '');
}

export function normalizeMappingKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function sourceUserId(user) {
  return String(user?.id || user?.login || user?.email || '').trim();
}

export function sourceUserName(user) {
  return String(user?.name || user?.fullName || user?.login || user?.email || 'Користувач YouTrack').trim();
}

export function suggestUserMappings(sourceUsers, members) {
  const membersByEmail = new Map(
    (members || [])
      .filter(member => member?.email)
      .map(member => [String(member.email).trim().toLowerCase(), member.id || member.uid]),
  );
  return Object.fromEntries((sourceUsers || []).flatMap(user => {
    const id = sourceUserId(user);
    if (!id) return [];
    const email = String(user?.email || '').trim().toLowerCase();
    return [[id, email && membersByEmail.has(email) ? membersByEmail.get(email) : 'external']];
  }));
}

export function youTrackField(issue, fieldName) {
  const wanted = normalizeMappingKey(fieldName);
  return (issue?.customFields || []).find(field => normalizeMappingKey(field?.name) === wanted)?.value ?? null;
}

export function isYouTrackStateField(field) {
  const type = String(field?.$type || '');
  const name = normalizeMappingKey(field?.field?.name || field?.name);
  return /State(?:Project|Issue)CustomField/u.test(type)
    || ['state', 'status', 'стан', 'статус'].includes(name);
}

/**
 * Reads an issue's workflow state.
 *
 * Discovery recognises the state field by its `$type`, so a YouTrack whose
 * field is renamed or localized still offers its statuses for selection. Doing
 * the lookup here by the literal name "State" made the two disagree: the picker
 * listed statuses that no issue could ever match, and the prepared job counted
 * zero. Match on type first and keep the name as the fallback for responses
 * that do not carry `$type`.
 */
export function youTrackStateName(issue) {
  const fields = issue?.customFields || [];
  const field = fields.find(isYouTrackStateField);
  return fieldPresentation(field?.value ?? null);
}

/**
 * Builds the source-status catalogue used by the import picker. Admin bundle
 * values are the preferred inventory, but ordinary issue reads are the
 * permission-safe fallback: a token that can import an issue can still reveal
 * that issue's current state even when YouTrack refuses the bundle endpoint.
 */
export function mergeYouTrackStatuses(bundleStatuses = [], issues = []) {
  const byName = new Map();
  (bundleStatuses || []).forEach((status, index) => {
    const name = String(status?.name || '').trim();
    const key = normalizeMappingKey(name);
    if (!key) return;
    byName.set(key, {
      id: String(status?.id || name),
      name,
      archived: status?.archived === true,
      ordinal: Number.isFinite(status?.ordinal) ? status.ordinal : index,
      issueCount: 0,
    });
  });
  (issues || []).forEach(issue => {
    const name = youTrackStateName(issue);
    const key = normalizeMappingKey(name);
    if (!key) return;
    const current = byName.get(key);
    if (current) {
      current.issueCount += 1;
      return;
    }
    byName.set(key, {
      id: name,
      name,
      archived: false,
      ordinal: Number.MAX_SAFE_INTEGER,
      issueCount: 1,
    });
  });
  return [...byName.values()]
    .sort((a, b) => a.ordinal - b.ordinal || a.name.localeCompare(b.name, 'uk'))
    .map(({ ordinal, ...status }) => status);
}

export function firstFieldValue(value) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export function fieldPresentation(value) {
  const item = firstFieldValue(value);
  if (item == null) return '';
  if (typeof item === 'string' || typeof item === 'number') return String(item);
  return String(item.name || item.fullName || item.login || item.presentation || item.text || '');
}

export function fieldMinutes(value) {
  const item = firstFieldValue(value);
  if (Number.isFinite(item?.minutes)) return Math.max(0, Math.round(item.minutes));
  if (Number.isFinite(item)) return Math.max(0, Math.round(item));
  return null;
}

export function fieldTimestamp(value) {
  const item = firstFieldValue(value);
  const raw = typeof item === 'object' && item ? (item.timestamp ?? item.value ?? item.date) : item;
  if (Number.isFinite(raw)) return new Date(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const parsed = new Date(raw);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function firestoreTimestampMillis(value) {
  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (
    Number.isSafeInteger(value?.seconds)
    && Number.isSafeInteger(value?.nanoseconds)
  ) {
    return (value.seconds * 1_000) + Math.floor(value.nanoseconds / 1_000_000);
  }
  return null;
}

function exactFlatRecord(left, right) {
  if (left == null || right == null) return left == null && right == null;
  if (
    typeof left !== 'object'
    || Array.isArray(left)
    || typeof right !== 'object'
    || Array.isArray(right)
  ) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && Object.is(left[key], right[key])
    ))
  );
}

export function youTrackImportedWorkLogMatches(current, expected) {
  if (!current || !expected) return false;
  const scalarFields = [
    'issueId',
    'projectId',
    'userId',
    'organizationId',
    'spentMinutes',
    'description',
    'source',
    'sourceId',
  ];
  if (scalarFields.some(field => !Object.is(current[field], expected[field]))) {
    return false;
  }
  const currentLoggedAt = firestoreTimestampMillis(current.loggedAt);
  const expectedLoggedAt = firestoreTimestampMillis(expected.loggedAt);
  return (
    currentLoggedAt !== null
    && expectedLoggedAt !== null
    && currentLoggedAt === expectedLoggedAt
    && exactFlatRecord(current.externalActor, expected.externalActor)
  );
}

function findWorkflowId(items, sourceName, fallbacks) {
  const wanted = normalizeMappingKey(sourceName);
  const direct = (items || []).find(item => (
    normalizeMappingKey(item?.id) === wanted || normalizeMappingKey(item?.label) === wanted
  ));
  if (direct) return direct.id;
  const available = new Set((items || []).map(item => item.id));
  return fallbacks.find(id => available.has(id)) || items?.[0]?.id || null;
}

export function mapYouTrackStatus(sourceName, statuses = []) {
  const key = normalizeMappingKey(sourceName);
  const done = /(done|fixed|verified|resolved|closed|complete|виконан|готов)/u.test(key);
  const progress = /(progress|doing|review|test|робот|перевір)/u.test(key);
  const backlog = /(backlog|untriaged|черг|беклог)/u.test(key);
  return findWorkflowId(
    statuses,
    sourceName,
    done ? ['done'] : progress ? ['in-progress', 'doing'] : backlog ? ['backlog'] : ['todo', 'backlog'],
  );
}

/**
 * Resolves a YouTrack state to an organization status. A saved manual choice
 * wins only while that status still exists; otherwise the same deterministic
 * suggestion used by discovery is applied. This keeps old import jobs safe
 * when an administrator edits the workflow between discovery and commit.
 */
export function resolveYouTrackStatus(sourceName, statuses = [], explicitStatusId = '') {
  const available = new Set((statuses || []).map(status => status?.id).filter(Boolean));
  const explicit = String(explicitStatusId || '').trim();
  if (explicit && available.has(explicit)) return explicit;
  return mapYouTrackStatus(sourceName, statuses);
}

export function suggestYouTrackStatusMappings(projects = [], statuses = []) {
  return Object.fromEntries((projects || []).flatMap(project => {
    const projectId = String(project?.id || '').trim();
    if (!projectId) return [];
    return [[projectId, Object.fromEntries((project.statuses || []).flatMap(status => {
      const sourceName = String(status?.name || '').trim();
      if (!sourceName) return [];
      const targetId = mapYouTrackStatus(sourceName, statuses);
      return targetId ? [[sourceName, targetId]] : [];
    }))]];
  }));
}

export function filterYouTrackIssuesByStatuses(issues = [], allowedStatusNames) {
  if (!Array.isArray(allowedStatusNames)) return issues;
  const allowed = new Set(allowedStatusNames.map(normalizeMappingKey).filter(Boolean));
  // Never turn an explicit empty choice into a full import. The API rejects
  // this state for a selected project; the helper still fails closed on its
  // own so a malformed client cannot enqueue every issue by accident.
  if (allowed.size === 0) return [];
  return issues.filter(issue => allowed.has(normalizeMappingKey(youTrackStateName(issue))));
}

export function mapYouTrackPriority(sourceName, priorities = []) {
  const key = normalizeMappingKey(sourceName);
  const fallbacks = /(showstopper|critical|blocker|критич)/u.test(key)
    ? ['blocker', 'high']
    : /(major|high|важлив|висок)/u.test(key)
      ? ['high', 'medium']
      : /(minor|low|низьк)/u.test(key)
        ? ['low', 'medium']
        : ['medium', 'low'];
  return findWorkflowId(priorities, sourceName, fallbacks);
}

export function mapYouTrackType(sourceName, types = []) {
  const key = normalizeMappingKey(sourceName);
  const creatableTypes = (types || []).filter(type => type?.id !== 'epic');
  const fallbacks = /(bug|defect|помил|баг)/u.test(key)
    ? ['bug', 'task']
    : /(epic|епік)/u.test(key)
      // Epic is a source-system grouping, not a QuickTeam task type. Preserve
      // the original YouTrack value in import metadata and map the work item to
      // the closest actionable type instead.
      ? ['feature', 'task']
      : /(feature|story|функц|істор)/u.test(key)
        ? ['feature', 'task']
        : ['task', 'feature'];
  return findWorkflowId(creatableTypes, sourceName, fallbacks);
}

export function serializeCustomFields(fields) {
  return (fields || []).slice(0, 100).map(field => ({
    id: String(field?.id || ''),
    name: String(field?.name || ''),
    type: String(field?.$type || ''),
    value: Array.isArray(field?.value)
      ? field.value.slice(0, 50).map(fieldPresentation)
      : fieldPresentation(field?.value),
  }));
}

export function normalizeYouTrackRelation(linkType = {}, direction = '') {
  const label = normalizeMappingKey(
    direction === 'INWARD'
      ? linkType.targetToSource || linkType.name
      : linkType.sourceToTarget || linkType.name,
  );
  if (/(isduplicatedby|duplicatedby)/u.test(label)) {
    return { relationType: 'duplicates', reverse: true, hierarchyHint: false };
  }
  if (/duplicate/u.test(label)) {
    return { relationType: 'duplicates', reverse: false, hierarchyHint: false };
  }
  // YouTrack hierarchy can be deeper than the deliberately one-level QuickTeam
  // model and can span projects. Keep it visible as a regular relation and flag
  // it for review instead of silently constructing an invalid parent chain.
  if (/(subtask|parent)/u.test(label)) {
    return { relationType: 'relates-to', reverse: false, hierarchyHint: true };
  }
  if (/(blocks|isrequiredfor)/u.test(label)) {
    return { relationType: 'blocks', reverse: false, hierarchyHint: false };
  }
  if (/(blockedby|dependson|requiredfor)/u.test(label)) {
    return { relationType: 'blocks', reverse: true, hierarchyHint: false };
  }
  return { relationType: 'relates-to', reverse: false, hierarchyHint: false };
}

const YOUTRACK_RELATION_STRENGTH = {
  blocks: 3,
  duplicates: 2,
  'relates-to': 1,
};

function relationRowTieBreakKey(row) {
  return [
    String(row?.sourceExternalId || ''),
    String(row?.targetExternalId || ''),
    String(row?.externalRelation || ''),
    String(row?.targetReadableId || ''),
  ].join('\u0000');
}

/**
 * Selects the one relation QuickTeam may retain for a YouTrack issue pair.
 *
 * The comparison is intentionally independent from discovery order. This is
 * used both while folding one API response and while a reciprocal issue later
 * enqueues the same pair, so a weaker early `relates-to` can still become a
 * `blocks` relation before the link phase starts.
 */
export function strongestYouTrackRelationRow(left, right) {
  const candidates = [left, right].filter(Boolean);
  if (candidates.length === 0) return null;

  const strongestValue = Math.max(...candidates.map(
    row => YOUTRACK_RELATION_STRENGTH[row?.relationType] || 0,
  ));
  const strongest = candidates
    .filter(row => (YOUTRACK_RELATION_STRENGTH[row?.relationType] || 0) === strongestValue)
    .sort((a, b) => relationRowTieBreakKey(a).localeCompare(relationRowTieBreakKey(b)));
  const selected = strongest[0];

  return {
    ...selected,
    hierarchyHint: strongest.some(row => row?.hierarchyHint === true),
  };
}

export function relationTypeFromYouTrack(linkType = {}, direction = '') {
  return normalizeYouTrackRelation(linkType, direction).relationType;
}
