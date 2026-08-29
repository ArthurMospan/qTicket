import { authenticatedRequest } from '@/lib/services/authenticatedRequest';

// Two calls, both proxied by qTicket's own server: the browser never holds the
// shared secret and never talks to QuickTeam directly.

export function fetchQuickTeamProjects(organizationId) {
  return authenticatedRequest(
    `/api/integrations/quickteam/projects?organizationId=${encodeURIComponent(organizationId)}`,
    {},
    'Не вдалося отримати список із QuickTeam',
  );
}

export function transferIssueToQuickTeam(issueId, quickTeamProjectId) {
  return authenticatedRequest(
    `/api/issues/${encodeURIComponent(issueId)}/quickteam-task`,
    { method: 'POST', body: JSON.stringify({ quickTeamProjectId }) },
    'Не вдалося перенести звернення',
  );
}
