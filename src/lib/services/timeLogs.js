'use client';

import { auth } from '@/lib/firebase';

export class TaskTimeLogRequestError extends Error {
  constructor(message, { code = '', status = 0 } = {}) {
    super(message);
    this.name = 'TaskTimeLogRequestError';
    this.code = code;
    this.status = status;
  }
}

async function taskTimeLogRequest(path, options, fallbackMessage) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    throw new TaskTimeLogRequestError(
      'Потрібно увійти в акаунт',
      { code: 'TASK_TIME_UNAUTHORIZED', status: 401 },
    );
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new TaskTimeLogRequestError(
      result.error || fallbackMessage,
      {
        code: result.code || '',
        status: response.status,
      },
    );
  }
  return result;
}

function taskTimeLogPath(issueId, logId = '') {
  if (!issueId) throw new Error('Issue is required');
  const base = `/api/issues/${encodeURIComponent(issueId)}/time-logs`;
  return logId ? `${base}/${encodeURIComponent(logId)}` : base;
}

export function createTaskTimeLogViaApi({
  organizationId,
  projectId,
  issueId,
  userId,
  spentMinutes,
  description = '',
  loggedAt,
  timerSessionId,
}) {
  return taskTimeLogRequest(taskTimeLogPath(issueId), {
    method: 'POST',
    body: JSON.stringify({
      organizationId,
      projectId,
      ...(userId ? { userId } : {}),
      spentMinutes,
      description,
      ...(loggedAt ? { loggedAt } : {}),
      ...(timerSessionId ? { timerSessionId } : {}),
    }),
  }, 'Не вдалося зафіксувати час');
}

export function updateTaskTimeLogViaApi({
  organizationId,
  projectId,
  issueId,
  logId,
  spentMinutes,
  description,
}) {
  return taskTimeLogRequest(taskTimeLogPath(issueId, logId), {
    method: 'PATCH',
    body: JSON.stringify({
      organizationId,
      projectId,
      ...(spentMinutes !== undefined ? { spentMinutes } : {}),
      ...(description !== undefined ? { description } : {}),
    }),
  }, 'Не вдалося змінити зафіксований час');
}

export function deleteTaskTimeLogViaApi({
  organizationId,
  projectId,
  issueId,
  logId,
}) {
  const query = new URLSearchParams({ organizationId, projectId });
  return taskTimeLogRequest(
    `${taskTimeLogPath(issueId, logId)}?${query}`,
    { method: 'DELETE' },
    'Не вдалося видалити зафіксований час',
  );
}
