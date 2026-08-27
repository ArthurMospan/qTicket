export const MAX_BULK_ISSUES = 50;

export const ISSUE_BULK_ACTIONS = Object.freeze([
  { id: 'status', label: 'Змінити статус', value: 'status' },
  { id: 'assignees-add', label: 'Додати відповідальних', value: 'memberIds' },
  { id: 'assignees-remove', label: 'Прибрати відповідальних', value: 'memberIds' },
  { id: 'assignees-replace', label: 'Замінити відповідальних', value: 'memberIds' },
  { id: 'assignees-clear', label: 'Очистити відповідальних', value: 'none' },
  { id: 'priority', label: 'Змінити пріоритет', value: 'priorityId' },
  { id: 'priority-clear', label: 'Очистити пріоритет', value: 'none' },
  { id: 'labels-add', label: 'Додати мітки', value: 'labelIds' },
  { id: 'labels-remove', label: 'Прибрати мітки', value: 'labelIds' },
  { id: 'labels-clear', label: 'Очистити мітки', value: 'none' },
  { id: 'type', label: 'Змінити тип', value: 'typeId' },
  { id: 'deadline', label: 'Встановити дедлайн', value: 'date' },
  { id: 'deadline-clear', label: 'Очистити дедлайн', value: 'none' },
  { id: 'estimate', label: 'Встановити оцінку', value: 'minutes' },
  { id: 'estimate-clear', label: 'Очистити оцінку', value: 'none' },
  { id: 'sprint', label: 'Перемістити у спринт', value: 'sprintId' },
  { id: 'backlog', label: 'Повернути в backlog', value: 'none' },
  { id: 'duplicate', label: 'Дублювати', value: 'none' },
  // Three actions, because they are three things. `archive` puts finished work
  // aside reversibly and forever, and it stays in the record. `cancel` says the
  // work is not going to happen, and takes it out of the record too. `delete` is
  // the tombstone flow with a clock on it. See src/lib/utils/issueCancel.mjs.
  { id: 'archive', label: 'Архівувати', value: 'none', permission: 'edit:issue' },
  { id: 'cancel', label: 'Скасувати', value: 'none', permission: 'edit:issue' },
  { id: 'delete', label: 'Видалити', value: 'none', dangerous: true, permission: 'delete:issue' },
]);

export const ISSUE_BULK_ACTION_IDS = Object.freeze(ISSUE_BULK_ACTIONS.map(action => action.id));
export const ISSUE_BULK_ACTION_BY_ID = new Map(ISSUE_BULK_ACTIONS.map(action => [action.id, action]));

export function normalizeBulkIssueIds(issueIds) {
  if (!Array.isArray(issueIds)) return [];
  return [...new Set(issueIds
    .filter(id => typeof id === 'string')
    .map(id => id.trim())
    .filter(id => id && id.length <= 256))];
}

export function validateBulkActionValue(actionId, value) {
  const action = ISSUE_BULK_ACTION_BY_ID.get(actionId);
  if (!action) return 'Невідома масова дія';
  if (action.value === 'none') return null;
  if (action.value === 'status') {
    return value && typeof value === 'object'
      && ['status', 'category'].includes(value.mode)
      && typeof value.id === 'string' && value.id
      ? null
      : 'Потрібен коректний статус або категорія';
  }
  if (['memberIds', 'labelIds'].includes(action.value)) {
    return Array.isArray(value) && value.length > 0 && value.length <= 20
      && value.every(id => typeof id === 'string' && id.trim() && id.length <= 256)
      ? null
      : 'Потрібен непорожній обмежений список значень';
  }
  if (action.value === 'minutes') {
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes >= 0 && minutes <= 525600
      ? null
      : 'Оцінка виходить за допустимі межі';
  }
  if (action.value === 'date') {
    const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
    if (!match) return 'Потрібна коректна дата';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
      && date.getUTCMonth() === month - 1
      && date.getUTCDate() === day
      ? null
      : 'Потрібна коректна дата';
  }
  return typeof value === 'string' && value.trim() && value.length <= 256
    ? null
    : 'Потрібне коректне значення';
}
