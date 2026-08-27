// Relative, not aliased: this module is loaded straight by `node --test`.
import {
  isStatusCategoryId,
  isClosingCategory,
  withStatusCategories,
} from './statusCategories.mjs';
import {
  hasValidSystemPriorityStructure,
  NO_PRIORITY_ID,
  SYSTEM_PRIORITY_IDS,
} from './priorities.mjs';
import {
  hasSystemTaskType,
  SYSTEM_TASK_TYPE_ID,
  taskTypeIconKeyForType,
} from './taskTypes.mjs';

const SECTION_LIMITS = Object.freeze({
  statuses: { min: 1, max: 50 },
  types: { min: 1, max: 100 },
  priorities: { min: 4, max: 100 },
  labels: { min: 0, max: 100 },
  positions: { min: 0, max: 100 },
});

export const WORKFLOW_MUTATION_SECTIONS = Object.freeze(
  Object.keys(SECTION_LIMITS),
);

function cleanId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized
    && normalized.length <= 120
    && !normalized.includes('/')
    ? normalized
    : '';
}

function mutationError(code, message, details = {}) {
  return {
    error: {
      code,
      status: 400,
      message,
      ...details,
    },
  };
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function normalizeWorkflowSection(section, items) {
  const limits = SECTION_LIMITS[section];
  if (
    section === 'types'
    && Array.isArray(items)
    && !hasSystemTaskType(items)
  ) {
    return mutationError(
      'MISSING_SYSTEM_TASK_TYPE',
      'Системний тип «Задача» не можна видалити',
      { section, requiredIds: [SYSTEM_TASK_TYPE_ID] },
    );
  }
  if (
    section === 'priorities'
    && Array.isArray(items)
    && items.length < limits.min
  ) {
    return mutationError(
      'MISSING_SYSTEM_PRIORITIES',
      'Критичний, високий, середній і низький пріоритети є системними та не можуть бути видалені або переставлені',
      { section, requiredIds: SYSTEM_PRIORITY_IDS },
    );
  }
  if (
    !Array.isArray(items)
    || items.length < limits.min
    || items.length > limits.max
  ) {
    return mutationError(
      'INVALID_WORKFLOW_SECTION',
      `Некоректний розділ workflow: ${section}`,
      { section, minItems: limits.min, maxItems: limits.max },
    );
  }

  const seen = new Set();
  const normalized = [];
  for (const item of items) {
    const id = cleanId(item?.id);
    const label = typeof item?.label === 'string'
      ? item.label.trim()
      : '';
    if (!id || !label || label.length > 160 || seen.has(id)) {
      return mutationError(
        seen.has(id) ? 'DUPLICATE_WORKFLOW_ID' : 'INVALID_WORKFLOW_ITEM',
        seen.has(id)
          ? `Ідентифікатор ${id} повторюється в розділі ${section}`
          : `Некоректний елемент у розділі ${section}`,
        { section, id: id || null },
      );
    }
    seen.add(id);
    if (section === 'priorities' && id === NO_PRIORITY_ID) {
      return mutationError(
        'RESERVED_PRIORITY_ID',
        '«Без пріоритету» є системним станом і не зберігається серед налаштовуваних пріоритетів',
        { section, id },
      );
    }
    const next = { id, label };
    if (typeof item.color === 'string' && item.color.trim()) {
      next.color = item.color.trim().slice(0, 32);
    }
    if (section === 'types') next.icon = taskTypeIconKeyForType(item);
    if (section === 'statuses') {
      // The category is the shared layer of a status and the only thing that
      // decides whether it closes a task. An unknown value is dropped rather
      // than rejected: the derivation below then reads the same status the way
      // every pre-category document is read, so an older client that still
      // sends only `isDone` keeps working.
      if (isStatusCategoryId(item.category)) next.category = item.category;
      if (typeof item.isDone === 'boolean') next.isDone = item.isDone;
    }
    if (section === 'positions') {
      const hourlyRate = Number(item.hourlyRate);
      next.hourlyRate = Number.isFinite(hourlyRate)
        ? Math.min(1_000_000, Math.max(0, hourlyRate))
        : 0;
    }
    normalized.push(next);
  }
  if (section === 'priorities' && !hasValidSystemPriorityStructure(normalized)) {
    return mutationError(
      'MISSING_SYSTEM_PRIORITIES',
      'Критичний, високий, середній і низький пріоритети є системними та не можуть бути видалені або переставлені',
      { section, requiredIds: SYSTEM_PRIORITY_IDS },
    );
  }
  if (section !== 'statuses') return { value: normalized };

  // Every saved status carries an explicit category and an `isDone` that agrees
  // with it, so no reader ever has to derive either and the two can never drift.
  const statuses = withStatusCategories(normalized);
  const terminal = statuses.filter(status => isClosingCategory(status.category));
  if (terminal.length === 0) {
    return mutationError(
      'MISSING_TERMINAL_STATUS',
      'Потрібен щонайменше один статус категорії «Готово» або «Скасовано» — '
        + 'без нього не рахуються прогрес, швидкість і рахунок',
      { section },
    );
  }
  if (terminal.length === statuses.length) {
    return mutationError(
      'MISSING_OPEN_STATUS',
      'Потрібен щонайменше один незавершальний статус — інакше нові завдання '
        + 'одразу вважатимуться закритими',
      { section },
    );
  }
  return { value: statuses };
}

export function normalizeWorkflowMutationInput(body) {
  if (
    !body
    || typeof body !== 'object'
    || Array.isArray(body)
    || !body.workflow
    || typeof body.workflow !== 'object'
    || Array.isArray(body.workflow)
  ) {
    return mutationError(
      'INVALID_WORKFLOW_BODY',
      'Потрібен JSON-об’єкт workflow',
    );
  }

  const workflow = {};
  for (const section of WORKFLOW_MUTATION_SECTIONS) {
    const result = normalizeWorkflowSection(section, body.workflow[section]);
    if (result.error) return result;
    workflow[section] = result.value;
  }

  const rawMigrations = owns(body, 'statusMigrations')
    ? body.statusMigrations
    : [];
  if (!Array.isArray(rawMigrations) || rawMigrations.length > 50) {
    return mutationError(
      'INVALID_STATUS_MIGRATIONS',
      'statusMigrations має бути масивом до 50 відповідностей',
    );
  }
  const statusMigrations = [];
  const sources = new Set();
  for (const migration of rawMigrations) {
    const fromStatusId = cleanId(migration?.fromStatusId);
    const toStatusId = cleanId(migration?.toStatusId);
    if (
      !fromStatusId
      || !toStatusId
      || fromStatusId === toStatusId
      || sources.has(fromStatusId)
    ) {
      return mutationError(
        sources.has(fromStatusId)
          ? 'DUPLICATE_STATUS_MIGRATION'
          : 'INVALID_STATUS_MIGRATION',
        'Некоректна відповідність міграції статусу',
        { fromStatusId: fromStatusId || null, toStatusId: toStatusId || null },
      );
    }
    sources.add(fromStatusId);
    statusMigrations.push({ fromStatusId, toStatusId });
  }
  return { value: { workflow, statusMigrations } };
}

export function sameStringSet(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size
    && [...leftSet].every(value => rightSet.has(value));
}
