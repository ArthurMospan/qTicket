// Pure search-scope decisions shared by the header and command palette.
// UI state and network requests stay elsewhere; this file only describes what
// the current scope means and what the escalation row should say.

export function createProjectSearchScope(project) {
  if (!project?.id) return null;
  return {
    type: 'project',
    projectId: String(project.id),
    label: `у проєкті ${project.name || 'Без назви'}`,
  };
}

export function normalizeSearchScope(scope) {
  if (scope?.type !== 'project' || !scope.projectId) return null;
  return {
    type: 'project',
    projectId: String(scope.projectId),
    label: String(scope.label || 'у проєкті').trim() || 'у проєкті',
  };
}

export function searchScopeParams(scope) {
  const normalized = normalizeSearchScope(scope);
  return normalized ? { projectId: normalized.projectId } : {};
}

export function countWorkspaceSearchMatches({ issues = [], matches = {} } = {}) {
  return [issues, matches.people, matches.projects, matches.events]
    .reduce((total, list) => total + (Array.isArray(list) ? list.length : 0), 0);
}

export function searchEscalationState({
  query,
  localResultCount = null,
  outsideResultCount = 0,
  outsideLoading = false,
} = {}) {
  const term = String(query || '').trim();
  const localCount = Number.isFinite(localResultCount)
    ? Math.max(0, Math.floor(localResultCount))
    : null;
  const outsideCount = Number.isFinite(outsideResultCount)
    ? Math.max(0, Math.floor(outsideResultCount))
    : 0;

  return {
    active: Boolean(term) && localCount === 0,
    term,
    localEmpty: localCount === 0,
    localCount,
    outsideCount,
    outsideLoading: Boolean(outsideLoading),
  };
}

export function shouldRemoveSearchScope({ key, query, scope } = {}) {
  return key === 'Backspace'
    && String(query || '').length === 0
    && Boolean(normalizeSearchScope(scope));
}
