import {
  isValidIssuePrefix,
  normalizeIssuePrefix,
  suggestAvailableIssuePrefix,
} from '@/lib/utils/issueKeys.mjs';

/**
 * Materialize a unique prefix for a project created before prefixes became a
 * required field. The query is part of the task-creation transaction, so two
 * legacy projects with similar names cannot claim the same code concurrently.
 */
export async function resolveProjectIssuePrefixInTransaction({
  db,
  transaction,
  project,
  projectId,
  organizationId,
}) {
  if (isValidIssuePrefix(project?.issuePrefix)) {
    return normalizeIssuePrefix(project.issuePrefix);
  }

  const projectsSnapshot = await transaction.get(
    db.collection('projects').where('organizationId', '==', organizationId),
  );
  const organizationProjects = projectsSnapshot.docs.map(document => ({
    ...document.data(),
    id: document.id,
  }));

  return suggestAvailableIssuePrefix(project, organizationProjects, projectId);
}
