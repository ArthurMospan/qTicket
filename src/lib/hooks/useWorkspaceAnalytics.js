'use client';

// Loads issues only for the already-authorized project list.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import {
  useOrganizationIssueLinks,
  useOrganizationIssues,
} from '@/lib/hooks/useOrganizationIssues';

// Frozen so that «this caller wants no links» is one stable reference rather
// than a new empty array on every render.
const NO_PROJECTS = Object.freeze([]);
const NO_LINKS = Object.freeze([]);

/**
 * One subscription, three readings of it.
 *
 * `issues` is the working set — what is being worked on now. Archived incidents
 * are not in it, so boards, counts and progress do not carry work nobody is
 * doing.
 *
 * `allIssues` includes them, because an incident leaving the present does not
 * leave the past. Anything reasoning about what *happened* reads this one;
 * anything reasoning about what is *open* reads the other.
 *
 * A cancelled incident is in neither. Work that is not going to happen is not
 * part of the present and did not happen in the past, so it is filtered out
 * here rather than at each of the several dozen places that would otherwise
 * have to remember. `cancelledIssues` is what «Архів» → «Скасовані» lists, and
 * the only reader that gets them.
 *
 * The incidents come from `useOrganizationIssues`, the workspace's single
 * shared subscription, because several screens reading the same documents
 * through several listeners is what a delivery-per-listener bill is made of.
 */
export function useWorkspaceAnalytics(projectIds = [], {
  includeLinks = true,
  live = true,
} = {}) {
  const { activeOrgId } = useAppContext();
  // Incidents and links, from the workspace's one shared subscription. The
  // three readings this hook publishes are the same three that module derives,
  // so «working set», «record» and «скасовані» mean one thing in one place.
  const {
    issues,
    allIssues: record,
    cancelledIssues,
    error: issuesError,
    loading: issuesLoading,
  } = useOrganizationIssues(activeOrgId, projectIds);
  const {
    issueLinks: sharedIssueLinks,
    error: issueLinksError,
  } = useOrganizationIssueLinks(activeOrgId, includeLinks ? projectIds : NO_PROJECTS);
  const issueLinks = includeLinks ? sharedIssueLinks : NO_LINKS;
  // The incident set is live, so it was last read the moment it was last
  // delivered. «Оновлено о» therefore still has something true to say.
  const [issuesReadAt, setIssuesReadAt] = useState(null);
  useEffect(() => {
    // `record` is the signal rather than a value: a new array is a new delivery.
    const at = record && !issuesLoading ? Date.now() : null;
    queueMicrotask(() => setIssuesReadAt(at));
  }, [record, issuesLoading]);
  // Nothing to re-read: the incidents are a live subscription, so the newest
  // reading is the one already on screen. Kept so a caller that offers the
  // control does not have to know that.
  const refresh = useCallback(() => {}, []);

  const error = useMemo(
    () => issuesError || issueLinksError,
    [issuesError, issueLinksError],
  );

  return {
    issues,
    allIssues: record,
    cancelledIssues,
    issueLinks,
    loading: issuesLoading,
    refreshing: false,
    error,
    errors: { issues: error },
    // When the reading was taken. Null while this is a live subscription,
    // because «оновлено о» would be a lie about data that is never more than a
    // moment old.
    readAt: live ? null : issuesReadAt,
    refresh,
  };
}
