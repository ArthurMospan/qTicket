import { statusLabel } from './workflowDefaults.mjs';
import { NO_PRIORITY_ID } from './priorities.mjs';
import { ISSUE_BULK_ACTION_BY_ID } from '../bulk/issueBulkActions.mjs';

/**
 * Which field changes are worth a line in a task's history.
 *
 * The list used to be three fields long — назва, пріоритет, виконавці — so the
 * feed in the task chat stayed silent while a deadline moved by a week, a task
 * changed type, or somebody dropped it into another sprint. "Дії пишуться в
 * чаті" was only a third true, and the third it covered was not the third that
 * causes arguments.
 *
 * `description` is deliberately recorded as a fact and not as a diff: the whole
 * body of a task in a `from`/`to` pair is a document inside a log entry, and
 * nobody reads it there.
 */
export const AUDITED_ISSUE_FIELDS = Object.freeze([
  'title',
  'priority',
  'assigneeIds',
  'type',
  'dueDate',
  'estimateMinutes',
  'labelIds',
  'sprintId',
  'description',
]);

export const FACT_ONLY_AUDITED_FIELDS = Object.freeze(['description']);

const FIELD_LABELS = Object.freeze({
  status: 'статус',
  columnId: 'статус',
  priority: 'пріоритет',
  title: 'назву',
  assigneeIds: 'виконавців',
  type: 'тип',
  dueDate: 'дедлайн',
  estimateMinutes: 'оцінку',
  labelIds: 'мітки',
  sprintId: 'спринт',
  parentIssueId: 'основну задачу',
});

const FACT_ONLY_TEXT = Object.freeze({
  description: 'Опис змінено',
});

/**
 * Changes to a field, logged under a name of their own.
 *
 * Only the client edit path writes `changed_<field>`. Everything the server
 * does writes what it *did* — the board writes `moved`, the workflow editor
 * writes `workflow-status-migrated` — and every one of them is «статус
 * змінено» to whoever reads a task's history. Nothing here knew that, so the
 * feed printed the raw action id: a column of `moved` under a person's name.
 */
const ACTION_FIELDS = Object.freeze({
  moved: 'status',
  'workflow-status-migrated': 'status',
  'hidden-column-migrated': 'status',
});

/** Actions that are a fact rather than a change, in the words the feed says. */
const ACTION_TEXT = Object.freeze({
  created: 'Створено завдання',
  imported: 'Завдання імпортовано',
  restored: 'Завдання відновлено',
  archived: 'Завдання відправлено в архів',
  unarchived: 'Завдання повернуто з архіву',
  cancelled: 'Завдання скасовано',
  uncancelled: 'Скасування завдання відмінено',
  'legacy-subtasks-migrated': 'Підзавдання перенесено в опис',
});

const BULK_ACTION_PREFIX = 'bulk_';

/**
 * Stable string form of an audited field, so array values compare by content
 * rather than by identity. Order-insensitive for arrays: reordering assignees
 * is not a change worth an entry in the history.
 */
export function auditValue(value) {
  if (Array.isArray(value)) return JSON.stringify([...value].map(String).sort());
  if (value && typeof value.toMillis === 'function') return String(value.toMillis());
  if (value instanceof Date) return String(value.getTime());
  return String(value ?? '');
}

// An audited array arrives as the JSON `auditValue` produced, and a single id
// arrives bare — entries written before this module existed are both.
function idsOf(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value) return [];
  if (!value.startsWith('[')) return [value];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [value];
  }
}

function nameOf(collection, id, fallback) {
  const found = (collection || []).find(item => (item?.id || item?.uid) === id);
  return found?.name || found?.label || fallback;
}

function formatMinutes(raw) {
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} хв`;
  return rest === 0 ? `${hours} год` : `${hours} год ${rest} хв`;
}

function formatDueDate(raw, timeZone) {
  if (raw === null || raw === undefined || raw === '') return null;
  // Deadlines reach the log as milliseconds (`auditValue` of a Timestamp), as an
  // ISO string, or as a Firestore Timestamp when the entry was written before
  // this module existed.
  const millis = typeof raw === 'object' && typeof raw.toMillis === 'function'
    ? raw.toMillis()
    : Number(raw);
  const date = Number.isFinite(millis) && String(raw).trim() !== ''
    ? new Date(millis)
    : new Date(String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(timeZone ? { timeZone } : {}),
  });
}

function formatAuditValue(field, value, context) {
  const {
    statuses = [],
    priorities = [],
    types = [],
    labels = [],
    sprints = [],
    members = [],
    timeZone,
  } = context || {};

  if (field === 'assigneeIds') {
    const ids = idsOf(value);
    if (ids.length === 0) return 'ніхто';
    return ids.map(id => nameOf(members, id, 'учасник')).join(', ');
  }
  if (field === 'labelIds') {
    const ids = idsOf(value);
    if (ids.length === 0) return 'без міток';
    return ids.map(id => nameOf(labels, id, id)).join(', ');
  }
  if (value === null || value === undefined || value === '') return 'не вказано';
  if (field === 'status' || field === 'columnId') return statusLabel(value, statuses);
  if (field === 'priority') {
    if (value === NO_PRIORITY_ID) return 'без пріоритету';
    return nameOf(priorities, value, value);
  }
  if (field === 'type') return nameOf(types, value, value);
  if (field === 'sprintId') return nameOf(sprints, value, 'спринт');
  if (field === 'dueDate') return formatDueDate(value, timeZone) || 'не вказано';
  if (field === 'estimateMinutes') return formatMinutes(value) || 'не вказано';
  return String(value);
}

function changeSentence(field, rawFrom, rawTo, context) {
  const label = FIELD_LABELS[field];
  const fieldLabel = `${label[0].toUpperCase()}${label.slice(1)}`;
  const from = formatAuditValue(field, rawFrom, context);
  const to = formatAuditValue(field, rawTo, context);
  if (from === to || from === 'не вказано' || from === 'ніхто' || from === 'без міток') {
    return `${fieldLabel} змінено на «${to}»`;
  }
  return `${fieldLabel} змінено: «${from}» → «${to}»`;
}

// A bulk operation logs the patch it wrote, as JSON keyed by the very fields
// this module already reads out. `bulk_priority` is a priority change that
// happened to be made from a selection — so it should read as one, in the same
// words a single edit produces, rather than as its own id.
function bulkPatch(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.startsWith('{')) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// A Firestore Timestamp survives `JSON.stringify` as its two parts, which is
// the one shape `formatAuditValue` cannot read — a bulk deadline arrives this
// way and no other.
function plainAuditValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const seconds = value._seconds ?? value.seconds;
  if (typeof seconds !== 'number') return value;
  const nanoseconds = value._nanoseconds ?? value.nanoseconds ?? 0;
  return String(seconds * 1000 + Math.round(nanoseconds / 1e6));
}

function describeBulkEvent(entry, actionId, context) {
  const before = bulkPatch(entry?.from);
  const after = bulkPatch(entry?.to);
  const sentences = Object.keys(after)
    .filter(field => FIELD_LABELS[field])
    .map(field => changeSentence(
      field,
      plainAuditValue(before[field]),
      plainAuditValue(after[field]),
      context,
    ));
  if (sentences.length > 0) return sentences.join('; ');
  const label = ISSUE_BULK_ACTION_BY_ID.get(actionId)?.label;
  return label ? `Масова дія: ${label.toLocaleLowerCase('uk-UA')}` : 'Оновлено завдання';
}

/**
 * One line of a task's history, in words.
 *
 * The statuses, priorities, types, labels and sprints are read from the live
 * workflow — never from a table inside this file. A hard-coded map of seven
 * status ids is what made a project that renamed «QA» read «QA» in its own
 * history, and a project that added one read a raw `status-3`.
 *
 * @param {object} entry An `issues/{id}/audit` document.
 * @param {object} context Live workflow and directory: `statuses`, `priorities`,
 *   `types`, `labels`, `sprints`, `members`, `timeZone`.
 * @returns {string} A sentence for the timeline.
 */
export function describeAuditEvent(entry, context = {}) {
  const action = typeof entry?.action === 'string' ? entry.action : '';
  if (ACTION_TEXT[action]) return ACTION_TEXT[action];
  if (action === 'parent-changed') {
    return entry?.to ? 'Основну задачу змінено' : 'Завдання відкріплено від основної задачі';
  }
  // Assigning work may put somebody on the project, and that is a change to the
  // project rather than to the task — but this task is where it was decided, so
  // this is where it has to be readable.
  if (action === 'project-team-granted') {
    const ids = idsOf(entry?.to);
    if (ids.length === 0) return 'Виконавців додано до складу проєкту';
    const names = ids.map(id => nameOf(context?.members, id, 'учасник')).join(', ');
    return `До складу проєкту додано: ${names}`;
  }
  if (action.startsWith(BULK_ACTION_PREFIX)) {
    return describeBulkEvent(entry, action.slice(BULK_ACTION_PREFIX.length), context);
  }

  const field = entry?.field || ACTION_FIELDS[action] || action.replace(/^changed_/, '');
  if (field && FACT_ONLY_TEXT[field]) return FACT_ONLY_TEXT[field];
  if (!field || !FIELD_LABELS[field]) {
    // An action this build has no phrase for still names itself rather than
    // pretending the task was merely "updated".
    return action && !action.startsWith('changed_') ? action : 'Оновлено завдання';
  }

  const from = entry.from ?? entry.oldValue;
  const to = entry.to ?? entry.newValue;
  // A board write happens for a reorder inside one column as well as for a
  // crossing between two, and the entry looks identical either way. Reading a
  // reorder out as «Статус змінено на «В роботі»» claims a move that did not
  // happen — the card was already there.
  if (action === 'moved' && auditValue(from) === auditValue(to)) {
    return 'Позицію на дошці змінено';
  }
  return changeSentence(field, from, to, context);
}
