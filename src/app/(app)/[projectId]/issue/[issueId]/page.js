import { redirect } from 'next/navigation';
import IssueDetail from '@/components/workspace/IssueDetail';
import { readWorkspaceProjectAccess } from '@/lib/server/workspaceProjectAccess';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';

export default async function IssuePage({ params, searchParams }) {
  const { projectId, issueId } = await params;
  const query = await searchParams;
  const access = await readWorkspaceProjectAccess(projectId);

  if (access && query?.org !== access.organizationId) {
    const current = new URLSearchParams(query || {});
    current.delete('org');
    const suffix = current.toString();
    redirect(withNotificationOrganization(
      `/${encodeURIComponent(projectId)}/issue/${encodeURIComponent(issueId)}${suffix ? `?${suffix}` : ''}`,
      access.organizationId,
    ));
  }

  return <IssueDetail issueId={issueId} projectId={projectId} isModal={false} />;
}
