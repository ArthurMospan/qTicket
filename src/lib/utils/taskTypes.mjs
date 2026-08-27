export const SYSTEM_TASK_TYPE_ID = 'task';

export const DEFAULT_TASK_TYPES = Object.freeze([{
  id: SYSTEM_TASK_TYPE_ID,
  label: 'Інцидент',
  color: '#059669',
  icon: 'task',
}, {
  id: 'feature',
  label: 'Фіча',
  color: '#f59e0b',
  icon: 'sparkles',
}, {
  id: 'bug',
  label: 'Баг',
  color: '#dc2626',
  icon: 'bug',
}]);

export const BUILT_IN_TASK_TYPE_ICON_KEYS = Object.freeze({
  task: 'task',
  feature: 'sparkles',
  bug: 'bug',
  epic: 'epic',
});

export const CUSTOM_TASK_TYPE_ICON_KEY = 'star';

export function isSystemTaskTypeId(typeId) {
  return typeId === SYSTEM_TASK_TYPE_ID;
}

export function taskTypeIconKeyForType(type) {
  const id = typeof type === 'string' ? type : type?.id;
  return BUILT_IN_TASK_TYPE_ICON_KEYS[id] || CUSTOM_TASK_TYPE_ICON_KEY;
}

// A task is the safe creation fallback used by every writer. Older workflow
// documents may predate that invariant, so readers repair it in memory and the
// next settings save persists the repaired list.
export function ensureSystemTaskType(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return DEFAULT_TASK_TYPES.map(item => ({ ...item }));
  }
  if (items.some(item => isSystemTaskTypeId(item?.id))) {
    return items.map(item => ({ ...item }));
  }
  return [{ ...DEFAULT_TASK_TYPES[0] }, ...items.map(item => ({ ...item }))];
}

export function hasSystemTaskType(items) {
  return Array.isArray(items)
    && items.some(item => isSystemTaskTypeId(item?.id));
}
