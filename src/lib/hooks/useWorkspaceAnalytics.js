'use client';

// Loads issues and time logs only for the already-authorized project list.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  collection,
  getDocs,
  onSnapshot,
  query,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import {
  useOrganizationIssueLinks,
  useOrganizationIssues,
} from '@/lib/hooks/useOrganizationIssues';
import { reportLoadError } from '@/lib/utils/errors';
import { liveDocumentData } from '@/lib/utils/firestoreDocument.mjs';
import {
  isTimeLogWindow,
  timeLogWindowKey,
} from '@/lib/utils/analyticsWindow.mjs';
import {
  chunkProjectIds,
  flattenDocumentBuckets,
} from '@/lib/utils/projectScopedQueries.mjs';

// Frozen so that «this caller wants no links» is one stable reference rather
// than a new empty array on every render.
const NO_PROJECTS = Object.freeze([]);
const NO_LINKS = Object.freeze([]);

/**
 * One subscription, three readings of it.
 *
 * `issues` is the working set — what is being worked on now. Archived tasks are
 * not in it, so boards, counts, workload and progress do not carry work nobody
 * is doing.
 *
 * `allIssues` includes them, because a task leaving the present does not leave
 * the past: hours recorded against it are still hours somebody worked, and an
 * invoice built without them would quietly bill less than was done. Anything
 * reasoning about what *happened* reads this one; anything reasoning about what
 * is *open* reads the other.
 *
 * A cancelled task is in neither. Work that is not going to happen is not part
 * of the present and did not happen in the past, so it is filtered out here
 * rather than at each of the several dozen places that would otherwise have to
 * remember. `cancelledIssues` is what «Архів» → «Скасовані» lists, and the only
 * reader that gets them.
 *
 * ── Вікно часу ───────────────────────────────────────────────────────────
 *
 * Tasks are a bounded set: one document per piece of work, and a workspace has
 * as many as it has work. Time logs are not. One is written every time somebody
 * stops a timer — daily, per person, forever — and the screen that said «за 30
 * днів» used to read all of them and drop the rest in the browser.
 *
 * So `timeLogWindow` is not optional when time logs are wanted: the caller says
 * which period it is about to draw, and that period becomes a bound in the
 * query. Without one this hook reads no logs at all and reports the misuse,
 * rather than quietly falling back to the whole history — that fallback is
 * precisely the bug this exists to prevent.
 *
 * The tasks and the logs are two effects rather than one, because they move on
 * different clocks. The task set changes when the project scope changes; the
 * log window changes whenever somebody picks another period or pages the
 * timesheet back a week. Sharing one effect meant every period change tore down
 * and re-read every task in the organization to answer a question about hours.
 *
 * ── Живе чи разове ───────────────────────────────────────────────────────
 *
 * `live` decides whether the *time logs* are a subscription or one reading.
 * The tasks are neither any more: they come from `useOrganizationIssues`, the
 * workspace's single shared subscription, because four screens reading the same
 * documents through four listeners is what a delivery-per-listener bill is made
 * of. One shared live listener costs less than four separate one-off reads of
 * the same set, so a report joins it rather than buying its own copy.
 *
 * A live listener is worth its cost where somebody is acting on the data as it
 * changes: a board they are dragging cards on, a task two people are editing,
 * a conversation. A report is not that. Nobody drags anything on «Огляд»; the
 * numbers are read, and a figure that rewrites itself mid-sentence is a
 * distraction rather than a service — and it is a distraction that keeps a
 * listener open over the largest collections the product has, for as long as
 * the tab is left on screen.
 *
 * So the report screens ask for `live: false`: one read, a `readAt` to say when
 * it was taken, and `refresh` for when somebody wants a newer one. The board,
 * «Мої завдання» and the sprint screens keep the live default, because there
 * the data is the thing being worked on.
 */
export function useWorkspaceAnalytics(projectIds = [], {
  includeLinks = true,
  includeTimeLogs = true,
  timeLogWindow = null,
  live = true,
} = {}) {
  const { activeOrgId, authLoading, orgLoading } = useAppContext();
  // Tasks and links, from the workspace's one shared subscription. The three
  // readings this hook publishes are the same three that module derives, so
  // «working set», «record» and «скасовані» mean one thing in one place.
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
  const [timeLogs, setTimeLogs] = useState([]);
  const [timeLogsLoading, setTimeLogsLoading] = useState(true);
  const [timeLogsReadAt, setTimeLogsReadAt] = useState(null);
  const [timeLogsError, setTimeLogsError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped by `refresh`. In live mode nothing reads it, because there is
  // nothing to refresh.
  const [nonce, setNonce] = useState(0);
  // Asking a new question and asking the same one again look different. A new
  // project scope or a new period clears the screen and shows a spinner,
  // because what was there answered something else. Pressing refresh leaves the
  // figures exactly where they are: they are still the right ones until better
  // ones arrive, and a report that blanks itself every time somebody checks for
  // newer numbers teaches people not to check.
  const refresh = useCallback(() => {
    setRefreshing(true);
    setNonce(value => value + 1);
  }, []);
  const projectScope = [...new Set(projectIds.filter(Boolean))].sort().join(',');
  // The task set is live, so it was last read the moment it was last delivered.
  // «Оновлено о» next to the hours therefore still has something true to say.
  const [issuesReadAt, setIssuesReadAt] = useState(null);
  useEffect(() => {
    // `record` is the signal rather than a value: a new array is a new delivery.
    const at = record && !issuesLoading ? Date.now() : null;
    queueMicrotask(() => setIssuesReadAt(at));
  }, [record, issuesLoading]);
  const windowedTimeLogs = includeTimeLogs && isTimeLogWindow(timeLogWindow);
  const sinceMillis = windowedTimeLogs ? timeLogWindow.sinceMillis : null;
  const untilMillis = windowedTimeLogs && Number.isFinite(timeLogWindow.untilMillis)
    ? timeLogWindow.untilMillis
    : null;
  const timeTarget = `${activeOrgId || ''}/${projectScope}/${windowedTimeLogs ? timeLogWindowKey(timeLogWindow) : 'no-time'}`;
  const timeTargetRef = useRef('');

  useEffect(() => {
    if (includeTimeLogs && !windowedTimeLogs) {
      reportLoadError(
        '[useWorkspaceAnalytics]',
        new Error('timeLogWindow is required whenever includeTimeLogs is on'),
      );
    }
  }, [includeTimeLogs, windowedTimeLogs]);

  // ── Time logs, inside the window the caller is drawing ──────────────────
  useEffect(() => {
    if (!activeOrgId || !windowedTimeLogs) {
      timeTargetRef.current = '';
      queueMicrotask(() => {
        setTimeLogs([]);
        setTimeLogsError(null);
        setTimeLogsLoading(!activeOrgId && Boolean(authLoading || orgLoading));
      });
      return undefined;
    }

    if (timeTargetRef.current !== timeTarget) {
      timeTargetRef.current = timeTarget;
      queueMicrotask(() => {
        setTimeLogsLoading(true);
        setTimeLogs([]);
        setTimeLogsError(null);
      });
    }

    // The window, as Firestore bounds rather than as a browser predicate. The
    // component that draws the period re-applies the same edges to what comes
    // back; the query is what decides how much comes back at all.
    const windowBounds = [
      where('loggedAt', '>=', Timestamp.fromMillis(sinceMillis)),
      ...(untilMillis === null
        ? []
        : [where('loggedAt', '<', Timestamp.fromMillis(untilMillis))]),
    ];

    const chunks = chunkProjectIds(projectScope ? projectScope.split(',') : []);
    const timeLogBuckets = new Map();
    const readyStreams = new Set();
    const expectedStreamCount = chunks.length * 2 + 1;
    const unsubs = [];
    const subscribe = options => unsubs.push(readBucket({
      ...options,
      live,
      buckets: timeLogBuckets,
      publish: setTimeLogs,
      readyStreams,
      expectedStreamCount,
      onReady: () => {
        setTimeLogsLoading(false);
        setTimeLogsReadAt(Date.now());
        setRefreshing(false);
      },
      onError: setTimeLogsError,
    }));

    // Projectless team events are organization analytics only and cannot be
    // invoiced until attached to a project.
    subscribe({
      key: 'calendar:organization',
      sourceQuery: query(
        collection(db, 'timeLogs'),
        where('organizationId', '==', activeOrgId),
        where('projectId', '==', ''),
        where('sourceType', '==', 'calendar_event'),
        where('eventVisibility', '==', 'team'),
        ...windowBounds,
      ),
    });

    // Task and calendar logs must remain separate queries. Rules can then
    // prove that restricted calendar entries can never satisfy analytics.
    chunks.forEach((chunk, chunkIndex) => {
      subscribe({
        key: `time:task:${chunkIndex}`,
        sourceQuery: query(
          collection(db, 'timeLogs'),
          where('organizationId', '==', activeOrgId),
          where('projectId', 'in', chunk),
          where('issueId', '!=', ''),
          ...windowBounds,
        ),
      });
      subscribe({
        key: `time:calendar:${chunkIndex}`,
        sourceQuery: query(
          collection(db, 'timeLogs'),
          where('organizationId', '==', activeOrgId),
          where('projectId', 'in', chunk),
          where('sourceType', '==', 'calendar_event'),
          where('eventVisibility', '==', 'team'),
          ...windowBounds,
        ),
      });
    });

    return () => unsubs.forEach(unsubscribe => unsubscribe());
  }, [
    activeOrgId,
    authLoading,
    orgLoading,
    projectScope,
    timeTarget,
    windowedTimeLogs,
    sinceMillis,
    untilMillis,
    live,
    nonce,
  ]);

  // The hours follow the task out. Time logs arrive on their own subscription
  // and are read straight — the timesheet and the period totals do not join
  // them back to the issue list — so a cancelled task's hours would go on being
  // counted while the task itself had left every chart above them. Calendar
  // logs carry no `issueId` and are untouched.
  const cancelledIssueIds = useMemo(
    () => new Set(cancelledIssues.map(issue => issue.id)),
    [cancelledIssues],
  );
  const recordTimeLogs = useMemo(
    () => (cancelledIssueIds.size
      ? timeLogs.filter(log => !log?.issueId || !cancelledIssueIds.has(log.issueId))
      : timeLogs),
    [cancelledIssueIds, timeLogs],
  );

  return {
    issues,
    allIssues: record,
    cancelledIssues,
    timeLogs: recordTimeLogs,
    issueLinks,
    loading: issuesLoading || (windowedTimeLogs && timeLogsLoading),
    refreshing: live ? false : refreshing,
    error: issuesError || issueLinksError || (windowedTimeLogs ? timeLogsError : null),
    errors: {
      issues: issuesError || issueLinksError,
      timeLogs: windowedTimeLogs ? timeLogsError : null,
    },
    // When the reading was taken, and how to take another. Null while this is a
    // live subscription, because «оновлено о» would be a lie about data that is
    // never more than a moment old.
    readAt: live ? null : latestReadAt(issuesReadAt, windowedTimeLogs ? timeLogsReadAt : null),
    refresh,
  };
}

function latestReadAt(...values) {
  const known = values.filter(value => typeof value === 'number');
  return known.length ? Math.max(...known) : null;
}

/**
 * One stream of documents into its bucket — as a subscription or as a single
 * read, depending on what the screen is for.
 *
 * Both shapes publish the same way and return the same teardown, so the two
 * call sites above do not branch: the difference between a board and a report
 * is one flag, not two code paths that can drift apart.
 */
function readBucket({
  key,
  sourceQuery,
  buckets,
  publish,
  live,
  readyStreams,
  expectedStreamCount,
  onReady,
  onError,
}) {
  const markReady = () => {
    readyStreams.add(key);
    if (readyStreams.size >= expectedStreamCount) onReady();
  };
  const deliver = docs => {
    buckets.set(key, docs.map(liveDocumentData));
    publish(flattenDocumentBuckets(buckets));
    markReady();
  };
  const fail = error => {
    reportLoadError(`[useWorkspaceAnalytics:${key}]`, error);
    onError?.(error);
    buckets.set(key, []);
    publish(flattenDocumentBuckets(buckets));
    markReady();
  };

  if (live) {
    return onSnapshot(
      sourceQuery,
      snapshot => {
        deliver(snapshot.docs);
      },
      fail,
    );
  }

  let cancelled = false;
  getDocs(sourceQuery).then(
    snapshot => {
      if (!cancelled) deliver(snapshot.docs);
    },
    error => {
      if (!cancelled) fail(error);
    },
  );
  return () => {
    cancelled = true;
  };
}
