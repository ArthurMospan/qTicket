import { NO_PRIORITY_ID } from '../utils/priorities.mjs';

function ids(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
}

export function optimisticBulkPatch(issue, action, value, { statusId = null } = {}) {
  const assignees = ids(issue?.assigneeIds);
  const labels = ids(issue?.labelIds);

  switch (action) {
    case 'status':
      return statusId ? { status: statusId, columnId: statusId } : null;
    case 'assignees-add':
      return { assigneeIds: ids([...assignees, ...ids(value)]) };
    case 'assignees-remove': {
      const removed = new Set(ids(value));
      return { assigneeIds: assignees.filter(id => !removed.has(id)) };
    }
    case 'assignees-replace':
      return { assigneeIds: ids(value) };
    case 'assignees-clear':
      return { assigneeIds: [] };
    case 'priority':
      return { priority: value };
    case 'priority-clear':
      return { priority: NO_PRIORITY_ID };
    case 'labels-add':
      return { labelIds: ids([...labels, ...ids(value)]) };
    case 'labels-remove': {
      const removed = new Set(ids(value));
      return { labelIds: labels.filter(id => !removed.has(id)) };
    }
    case 'labels-clear':
      return { labelIds: [] };
    case 'type':
      return { type: value };
    case 'deadline':
      return { dueDate: value };
    case 'deadline-clear':
      return { dueDate: null };
    case 'estimate':
      return { estimateMinutes: Number(value) };
    case 'estimate-clear':
      return { estimateMinutes: null };
    case 'sprint':
      return { sprintId: value };
    case 'backlog':
      return { sprintId: null };
    // All three take the task off the screen it was selected on, so all three
    // paint the same local disappearance. What differs is where it lands:
    // «Архів» for one, «Скасовані» for the second, «Нещодавно видалене» for
    // the third.
    case 'archive':
    case 'cancel':
    case 'delete':
      return { _bulkArchived: true };
    default:
      return null;
  }
}

export function optimisticBulkPatches(issues, action, value, resolveStatusId) {
  return Object.fromEntries((issues || []).flatMap(issue => {
    const statusId = action === 'status' ? resolveStatusId?.(issue, value) : null;
    const patch = optimisticBulkPatch(issue, action, value, { statusId });
    return patch ? [[issue.id, patch]] : [];
  }));
}
