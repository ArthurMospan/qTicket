'use client';

import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

export class WorkflowRequestError extends Error {
  constructor(message, { code = '', status = 0, details = {} } = {}) {
    super(message);
    this.name = 'WorkflowRequestError';
    this.code = code;
    this.status = status;
    Object.assign(this, details);
  }
}

export async function fetchWorkflowViaApi(organizationId) {
  if (!organizationId) return null;
  return authenticatedRequest(
    `/api/organizations/${encodeURIComponent(organizationId)}/workflow`,
    { cache: 'no-store' },
    'Не вдалося завантажити workflow',
  ).then(result => result.workflow || null);
}

export async function updateWorkflowViaApi({
  organizationId,
  workflow,
  statusMigrations = [],
}) {
  if (!organizationId) {
    throw new WorkflowRequestError('Не вибрано організацію', {
      code: 'ORGANIZATION_REQUIRED',
      status: 400,
    });
  }
  try {
    return await authenticatedRequest(
      `/api/organizations/${encodeURIComponent(organizationId)}/workflow`,
      {
      method: 'PATCH',
      body: JSON.stringify({ workflow, statusMigrations }),
      },
      'Не вдалося оновити workflow',
    );
  } catch (error) {
    throw new WorkflowRequestError(
      error.message || 'Не вдалося оновити workflow',
      {
        code: error.code || '',
        status: error.status || 0,
        details: Object.fromEntries(
          Object.entries(error).filter(([key]) => !['name', 'message', 'code', 'status'].includes(key)),
        ),
      },
    );
  }
}
