'use client';

import { auth } from '@/lib/firebase';

async function projectRequest(projectId, method, body = null) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Authentication required');
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Project request failed');
  return result;
}

export const archiveProject = projectId => projectRequest(projectId, 'PATCH', { action: 'archive' });
export const restoreProject = projectId => projectRequest(projectId, 'PATCH', { action: 'restore' });
export const updateProjectSettings = (projectId, settings) =>
  projectRequest(projectId, 'PATCH', { action: 'update-settings', ...settings });
export const deleteProject = projectId => projectRequest(projectId, 'DELETE');
