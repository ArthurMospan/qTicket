import { redirect } from 'next/navigation';
import ProjectBoardClient from './ProjectBoardClient';
import { readWorkspaceProjectAccess } from '@/lib/server/workspaceProjectAccess';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';

export default async function BoardPage({ params, searchParams }) {
  const { projectId } = await params;
  const query = await searchParams;
  const access = await readWorkspaceProjectAccess(projectId);

  if (access && query?.org !== access.organizationId) {
    const current = new URLSearchParams(query || {});
    current.delete('org');
    const suffix = current.toString();
    redirect(withNotificationOrganization(
      `/${encodeURIComponent(projectId)}${suffix ? `?${suffix}` : ''}`,
      access.organizationId,
    ));
  }

  return (
    <ProjectBoardClient
      projectId={projectId}
      resourceOrganizationId={access?.organizationId || null}
    />
  );
}
