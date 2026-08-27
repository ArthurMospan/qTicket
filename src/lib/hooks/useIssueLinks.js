'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { reportLoadError } from '@/lib/utils/errors';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import { issueLinkRequestFromPerspective } from '@/lib/utils/issueLinkPresentation.mjs';
export {
  ISSUE_LINK_OPTIONS,
  issueLinkPerspective,
} from '@/lib/utils/issueLinkPresentation.mjs';

const requestCache = new Map();

function linkRequestCacheKey(viewerScope, issueId) {
  return `${viewerScope}:${issueId}`;
}

async function requestLinks(issueId, viewerScope, method = 'GET', body = null) {
  const cacheKey = linkRequestCacheKey(viewerScope, issueId);
  if (method === 'GET') {
    const cached = requestCache.get(cacheKey);
    if (cached) return cached;
    const request = performRequest(issueId, method, body);
    requestCache.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (requestCache.get(cacheKey) === request) requestCache.delete(cacheKey);
    }
  }

  try {
    const result = await performRequest(issueId, method, body);
    requestCache.delete(cacheKey);
    return result;
  } catch (error) {
    requestCache.delete(cacheKey);
    throw error;
  }
}

async function performRequest(issueId, method, body) {
  return authenticatedRequest(`/api/issues/${encodeURIComponent(issueId)}/links`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: 'no-store',
  }, 'Не вдалося завантажити зв’язки завдання');
}

export function useIssueLinks(issueId) {
  const { activeOrgId, currentUser, orgRole } = useAppContext();
  const { closedStatusIds } = useWorkflowConfig();
  const viewerId = currentUser?.uid || currentUser?.id || '';
  const viewerScope = `${activeOrgId || 'none'}:${viewerId || 'anonymous'}:${orgRole || 'pending'}`;
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!issueId) {
      setLinks([]);
      setError(null);
      setLoading(false);
      return [];
    }
    setLoading(true);
    try {
      const result = await requestLinks(issueId, viewerScope);
      if (generation !== requestGeneration.current) return null;
      const nextLinks = result.links || [];
      setLinks(nextLinks);
      setError(null);
      return nextLinks;
    } catch (error) {
      if (generation !== requestGeneration.current) return null;
      reportLoadError('[useIssueLinks]', error);
      setLinks([]);
      setError(error);
      return null;
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [issueId, viewerScope]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) refresh();
    });
    return () => {
      cancelled = true;
      requestGeneration.current += 1;
    };
  }, [refresh]);

  const addLink = useCallback(async (sourceId, targetId, relationType) => {
    const request = issueLinkRequestFromPerspective(sourceId, targetId, relationType);
    await requestLinks(request.sourceIssueId, viewerScope, 'POST', {
      targetIssueId: request.targetIssueId,
      relationType: request.relationType,
    });
    requestCache.delete(linkRequestCacheKey(viewerScope, sourceId));
    requestCache.delete(linkRequestCacheKey(viewerScope, targetId));
    await refresh();
  }, [refresh, viewerScope]);

  const removeLink = useCallback(async linkId => {
    await requestLinks(issueId, viewerScope, 'DELETE', { linkId });
    await refresh();
  }, [issueId, refresh, viewerScope]);

  const hasBlocker = useCallback((targetIssueId, allIssues) => {
    const blockingLinks = links.filter(link => link.relationType === 'blocks' && link.targetIssueId === targetIssueId);
    return blockingLinks.some(link => {
      const blocker = allIssues.find(issue => issue.id === link.sourceIssueId) || link.sourceIssue;
      return blocker && !closedStatusIds.includes(blocker.columnId ?? blocker.status);
    });
  }, [links, closedStatusIds]);

  return { links, loading, error, refresh, addLink, removeLink, hasBlocker };
}
