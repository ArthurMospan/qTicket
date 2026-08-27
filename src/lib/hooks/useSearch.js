'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { auth } from '@/lib/firebase';
import { searchScopeParams } from '@/lib/utils/searchScope.mjs';
import { searchMinimumLength } from '@/lib/utils/searchRanking.mjs';

// QUI-104. `results` is still the task list, so the header's search dropdown is
// unchanged; people, projects and events arrive beside it for callers that show
// more than tasks.
const EMPTY = { people: [], projects: [], events: [] };

export function useSearch() {
  const [results, setResults] = useState([]);
  const [matches, setMatches] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const activeRequest = useRef(null);
  const pendingDelay = useRef(null);

  useEffect(() => () => {
    activeRequest.current?.abort();
    if (pendingDelay.current) {
      clearTimeout(pendingDelay.current.timer);
      pendingDelay.current.resolve(false);
    }
  }, []);

  // `mention` picks the ranking on the server and the shortest term the client
  // will send: `#5` is a whole question, «5» typed into the header is not.
  const search = useCallback(async (queryText, orgId, scope = null, { mention = false } = {}) => {
    const term = queryText.trim();
    if (term.length < searchMinimumLength(mention) || !orgId) {
      if (pendingDelay.current) {
        clearTimeout(pendingDelay.current.timer);
        pendingDelay.current.resolve(false);
        pendingDelay.current = null;
      }
      activeRequest.current?.abort();
      setResults([]);
      setMatches(EMPTY);
      setLoading(false);
      setError(null);
      return;
    }

    if (pendingDelay.current) {
      clearTimeout(pendingDelay.current.timer);
      pendingDelay.current.resolve(false);
    }
    activeRequest.current?.abort();
    setResults([]);
    setMatches(EMPTY);
    setLoading(true);
    setError(null);
    const shouldRun = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(true), 250);
      pendingDelay.current = { timer, resolve };
    });
    if (!shouldRun) return;
    pendingDelay.current = null;
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Authentication required');
      const params = new URLSearchParams({
        organizationId: orgId,
        q: term,
        ...(mention ? { mention: 'issue' } : {}),
        ...searchScopeParams(scope),
      });
      const response = await fetch(`/api/search?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: 'no-store',
      });
      const result = await response.json();
      if (!response.ok) {
        const requestError = new Error(result.error || 'Search failed');
        requestError.status = response.status;
        requestError.code = result.code || null;
        throw requestError;
      }
      setResults(result.results || []);
      setMatches({
        people: result.people || [],
        projects: result.projects || [],
        events: result.events || [],
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[useSearch]', err);
      setResults([]);
      setMatches(EMPTY);
      setError(err);
    } finally {
      if (activeRequest.current === controller) setLoading(false);
    }
  }, []);

  // Callers that hide their results surface need to drop them too — otherwise
  // reopening the command palette shows the previous query's answers before the
  // new request lands.
  const clear = useCallback(() => {
    if (pendingDelay.current) {
      clearTimeout(pendingDelay.current.timer);
      pendingDelay.current.resolve(false);
      pendingDelay.current = null;
    }
    activeRequest.current?.abort();
    setResults([]);
    setMatches(EMPTY);
    setLoading(false);
    setError(null);
  }, []);

  return { results, matches, loading, error, search, clear };
}
