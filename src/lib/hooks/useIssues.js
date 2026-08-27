'use client';

// src/lib/hooks/useIssues.js — the board's view of the shared task set, plus
// the writes a board makes.
//
// This used to run the board's own pair of listeners: every task of one
// project, and every link in it. That looked like the cheap read — one project
// instead of the organization — and it was the opposite, because the dashboard
// already held a listener over the same documents and Firestore charges for
// every delivery to every listener. Opening a task on the board added a third
// copy of the same query, since the task screen wants archived and cancelled
// work included and asked for it separately.
//
// So there is no listener here. The tasks come from `useOrganizationIssues`,
// which every screen shares, and this hook is the board's slice of it: one
// project's cards, sorted the way a board sorts them. A workspace whose
// dashboard has not been opened pays for the whole set on the first screen
// rather than for one project — the same set the next screen would have read
// anyway, and once, not once per screen.
import { useCallback, useMemo } from 'react';
import { collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import {
  useOrganizationIssueLinks,
  useOrganizationIssues,
} from '@/lib/hooks/useOrganizationIssues';
import { sendNotification } from '@/lib/hooks/useNotifications';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useOptimisticPatch } from '@/lib/hooks/useOptimisticPatch';
import {
  createIssueViaApi,
  notifyIssueAssigned,
  syncIssueRemindersViaApi,
  transitionIssueStatusViaApi,
} from '@/lib/services/issues';
import { createResponseError } from '@/lib/utils/errors';
import { withoutArchivedIssues } from '@/lib/utils/issueArchive.mjs';
import { withoutCancelledIssues } from '@/lib/utils/issueCancel.mjs';
import { statusLabel } from '@/lib/utils/workflowDefaults.mjs';
import { issueCompletionBlockers } from '@/lib/utils/issueExecution.mjs';
import { issueParticipants } from '@/lib/utils/issueParticipants.mjs';
import {
  AUDITED_ISSUE_FIELDS,
  FACT_ONLY_AUDITED_FIELDS,
  auditValue,
} from '@/lib/utils/issueAuditEvents.mjs';
import { compareIssues, pickPatchableFields, planDrop } from '@/lib/utils/optimistic.mjs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';

// Stable references for "this caller wants none of that", so a hook that is
// not asking for links does not hand a new empty array down on every render.
const NO_PROJECTS = Object.freeze([]);
const NO_LINKS = Object.freeze([]);
const NO_ISSUES = Object.freeze([]);

// ---------------------------------------------------------------------------
// Helper — write an audit log entry to issues/{issueId}/audit subcollection
// ---------------------------------------------------------------------------
async function writeAudit(issueId, {
  userId,
  userName,
  action,
  from,
  to
}) {
  try {
    await addDoc(collection(db, 'issues', issueId, 'audit'), {
      userId: userId || null,
      userName: userName || null,
      action,
      from: from ?? null,
      to: to ?? null,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.warn('[useIssues] audit write failed', err);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useIssues(projectId, { includeLinks = true, includeSetAside = false } = {}) {
  const {
    activeOrgId, currentUser, projects, authLoading, orgLoading, projectsLoading,
  } = useAppContext();
  const { closedStatusIds, statuses } = useWorkflowConfig();
  // Depend on the uid, not on the `currentUser` object: the profile listener
  // hands back a fresh object whenever anything on the user document changes.
  const currentUserId = currentUser?.uid || currentUser?.id || null;
  // The projects this account can already open — the scope of the shared read.
  // Firestore evaluates the read rule per document, so one project this user is
  // not on the team of would reject a query over the whole organization.
  const projectIds = useMemo(
    () => [...new Set((projects || []).map(project => project.id).filter(Boolean))],
    [projects],
  );
  const {
    documents,
    error,
    loading: issuesLoading,
  } = useOrganizationIssues(activeOrgId, projectIds);
  const {
    issueLinks: sharedLinks,
    error: sharedLinksError,
    loading: sharedLinksLoading,
  } = useOrganizationIssueLinks(activeOrgId, includeLinks ? projectIds : NO_PROJECTS);

  // This board's cards, in board order. Neither an archived nor a cancelled
  // task is part of the working set; one flag covers both because one reader
  // wants both — the task's own screen, where a link has to keep opening
  // whatever it points at, whichever of the two was done to it.
  const snapshotIssues = useMemo(() => {
    if (!projectId || !activeOrgId) return NO_ISSUES;
    const own = documents.filter(issue => issue.projectId === projectId);
    const scoped = includeSetAside
      ? own
      : withoutCancelledIssues(withoutArchivedIssues(own));
    // Sorted here rather than in the query, which would need a composite index
    // for a set the browser already holds.
    return scoped.sort(compareIssues);
  }, [documents, projectId, activeOrgId, includeSetAside]);

  const issueLinks = useMemo(() => (
    includeLinks && projectId
      ? sharedLinks.filter(link => link.projectId === projectId)
      : NO_LINKS
  ), [includeLinks, sharedLinks, projectId]);
  const linksError = includeLinks ? sharedLinksError : null;
  const linksReady = !includeLinks || (!sharedLinksLoading && !linksError);

  // "Nothing was asked" is not "nothing was found". On a page refresh the uid,
  // the organization and the project list all arrive a beat after the first
  // render, and reporting `loading: false` with an empty list there is what
  // made the task page flash «Задачу не знайдено» before the task appeared.
  const loading = Boolean(projectId) && (
    issuesLoading || authLoading || orgLoading || projectsLoading || !currentUserId
  );

  // A drag & drop is painted from this overlay until Firestore echoes it back.
  const [issues, applyPatch, revertPatch] = useOptimisticPatch(snapshotIssues, compareIssues);

  // -------------------------------------------------------------------------
  // createIssue — atomic issueCounter increment + addDoc + audit
  // -------------------------------------------------------------------------
  const createIssue = useCallback(async (data, actorUser = {}) => {
    const {
      userId,
      userName
    } = actorUser;
    const orgId = activeOrgId;
    if (!orgId || !projectId) throw new Error('Organization and project are required');
    const result = await createIssueViaApi({
      organizationId: orgId,
      projectId,
      data: {
        ...data,
        status: data.columnId || data.status || 'backlog',
        assigneeIds: data.assigneeIds || (userId ? [userId] : []),
        reporterId: data.reporterId || userId || null,
      },
    });

    // Step 4: Notify assignees who didn't create the task themselves. Said the
    // same way by every composer, so it cannot go out from one and not another.
    // No `actor` is passed: /api/notifications resolves the sender from the
    // verified ID token, and passing one was silently discarded.
    notifyIssueAssigned({
      issueId: result.id,
      issueKey: result.issueKey,
      title: data.title,
      assigneeIds: data.assigneeIds || [],
      actorId: userId,
      actorName: userName,
      projectId,
      organizationId: activeOrgId,
    });
    return {
      id: result.id,
      issueKey: result.issueKey
    };
  }, [projectId, activeOrgId]);

  // -------------------------------------------------------------------------
  // updateIssue — updateDoc + conditional audit for key field changes
  // -------------------------------------------------------------------------
  const updateIssue = useCallback(async (issueId, data, actorUser = {}) => {
    const {
      userId,
      userName
    } = actorUser;

    // Find current issue for diff
    const current = issues.find(i => i.id === issueId);

    const hasStatusUpdate = data.status !== undefined || data.columnId !== undefined;
    if (
      data.status !== undefined
      && data.columnId !== undefined
      && data.status !== data.columnId
    ) {
      throw new Error('Статус і колонка задачі мають збігатися');
    }
    if (data.completedAt !== undefined && !hasStatusUpdate) {
      throw new Error('Дата завершення керується статусом задачі');
    }
    const requestedStatus = data.columnId ?? data.status;
    const directData = { ...data };
    delete directData.status;
    delete directData.columnId;
    delete directData.completedAt;
    if (hasStatusUpdate) delete directData.order;

    // Mirror board-position fields locally right away. Backlog and sprint views
    // drag cards by writing sprintId/assigneeIds through here, and without the
    // overlay the card springs back until the round-trip completes.
    const optimistic = pickPatchableFields(data);
    if (optimistic) applyPatch({ [issueId]: optimistic });

    try {
      if (hasStatusUpdate) {
        await transitionIssueStatusViaApi({
          issueId,
          status: requestedStatus,
          ...(data.order !== undefined ? { order: data.order } : {}),
        });
      }
      if (Object.keys(directData).length > 0) {
        const actorId = userId || currentUserId;
        await updateDoc(doc(db, 'issues', issueId), {
          ...directData,
          updatedAt: serverTimestamp(),
          lastActivityType: 'updated',
          lastActivityAt: serverTimestamp(),
          lastActivityActorId: actorId || null,
          lastActivityActorName: userName || currentUser?.name || currentUser?.displayName || currentUser?.email || '',
          lastActivityActorAvatar: currentUser?.avatar || currentUser?.photoURL || null,
        });
      }
    } catch (err) {
      if (optimistic) revertPatch([issueId]);
      throw err;
    }
      // A moved deadline moves its reminders. The field write above is the
      // browser's; the queue row behind it is the server's, and this is how
      // the two stay one act.
      syncIssueRemindersViaApi(issueId, directData);

    // Touch parent project
    if (Object.keys(directData).length > 0) {
      await updateDoc(doc(db, 'projects', projectId), {
        updatedAt: serverTimestamp()
      }).catch(() => {});
    }

    // Write audit for notable field changes. Arrays are compared by VALUE —
    // comparing them by reference logged a "changed_assigneeIds" entry on every
    // single save, because a fresh array is never `===` the stored one.
    //
    // Which fields those are lives in `issueAuditEvents.mjs`, next to the phrases
    // that read them out. The two used to be written in different files and drift
    // was the result: three fields were logged here while the timeline knew how
    // to say five, so a moved deadline or a task dropped into another sprint left
    // no trace anywhere in the product.
    for (const field of AUDITED_ISSUE_FIELDS) {
      if (directData[field] === undefined || !current) continue;
      const from = auditValue(current[field]);
      const to = auditValue(directData[field]);
      if (from === to) continue;
      // A description is logged as a fact. Both versions of a task's body inside
      // one log entry is a document nobody reads in a feed.
      const factOnly = FACT_ONLY_AUDITED_FIELDS.includes(field);
      await writeAudit(issueId, {
        userId: userId || currentUserId,
        userName,
        action: `changed_${field}`,
        from: factOnly ? null : from,
        to: factOnly ? null : to,
      });
    }
  }, [issues, projectId, applyPatch, revertPatch, currentUser, currentUserId]);

  // -------------------------------------------------------------------------
  // deleteIssue
  // -------------------------------------------------------------------------
  const deleteIssue = useCallback(async (issueId, { childPolicy } = {}) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Authentication required');
    const policyQuery = childPolicy ? `?childPolicy=${encodeURIComponent(childPolicy)}` : '';
    const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}${policyQuery}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    if (!response.ok) {
      throw createResponseError(response, result, 'Не вдалося видалити задачу');
    }
    return result;
  }, []);

  const restoreIssue = useCallback(async (issueId, organizationId) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Authentication required');
    const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/restore`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ organizationId }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw createResponseError(response, result, 'Не вдалося відновити задачу');
    }
    return result;
  }, []);

  // Hierarchy writes go through the authenticated server route, which validates
  // same-project scope and the one-level invariant transactionally.
  const setIssueParent = useCallback(async (issueId, parentIssueId) => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Authentication required');
    applyPatch({ [issueId]: { parentIssueId: parentIssueId || null } });
    try {
      const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/parent`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ parentIssueId: parentIssueId || null }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw createResponseError(response, result, 'Не вдалося змінити основну задачу');
      }
      return result;
    } catch (error) {
      revertPatch([issueId]);
      throw error;
    }
  }, [applyPatch, revertPatch]);

  // -------------------------------------------------------------------------
  // moveIssue — batch reorder + columnId/status update + audit
  //   Guards:
  //     - terminal statuses: block while real child issues remain open
  //   Side-effects:
  //     - 'client-approval': sets clientApprovalPending on linked stage
  // -------------------------------------------------------------------------
  const moveIssue = useCallback(async (issueId, newColumnId, position, actorUser = {}) => {
    const { userId } = actorUser;
    const issue = issues.find(i => i.id === issueId);
    if (!issue) throw new Error('Issue not found');

    // A parent is a roll-up container, so closing it while a real child issue is
    // still open would make the hierarchy contradict the board and analytics.
    // Description checkboxes and legacy `subtasks[]` are lightweight checklist
    // items and deliberately do not participate in this guard.
    if (closedStatusIds.includes(newColumnId)) {
      if (includeLinks && !linksReady) {
        throw new Error(linksError
          ? 'Не вдалося перевірити залежності. Оновіть сторінку й повторіть.'
          : 'Зачекайте, перевіряємо залежності задачі');
      }
      const blockers = issueCompletionBlockers({
        issueId,
        issues,
        issueLinks,
        closedStatusIds,
      });
      if (blockers.children.length > 0) {
        throw new Error(`Спершу закрийте підзавдання: ${blockers.children.length} ще в роботі`);
      }
      if (blockers.dependencies.length > 0) {
        const names = blockers.dependencies
          .slice(0, 2)
          .map(blocker => blocker.issueKey || blocker.title)
          .filter(Boolean)
          .join(', ');
        throw new Error(`Задачу ще блокують: ${names || blockers.dependencies.length}`);
      }
    }
    const oldColumnId = issue.columnId || issue.status;

    // One plan drives both the repaint and the writes, so the overlay retires
    // the moment Firestore echoes back instead of disagreeing with it. Cards
    // whose position is unchanged are left out — no repaint, no write.
    const plan = planDrop(issues, issueId, newColumnId, position);
    if (!plan) throw new Error('Issue not found');

    // Paint first: @hello-pangea/dnd animates the card into the list as it
    // stands when the drag ends, so the destination slot has to exist by now.
    applyPatch(plan.patches);

    try {
      const movedPatch = plan.patches[issueId] || {};
      const orderUpdates = Object.entries(plan.patches)
        .filter(([, patch]) => patch.order !== undefined)
        .map(([id, patch]) => ({ issueId: id, order: patch.order }));
      await transitionIssueStatusViaApi({
        issueId,
        status: newColumnId,
        order: movedPatch.order,
        orderUpdates,
      });
    } catch (err) {
      revertPatch(Object.keys(plan.patches));
      throw err;
    }

    // Tell the task's participants it moved (same-column reorders are not a
    // status change and notify nobody). Shared rule, so the person who opened
    // the task is included — they used to be the one party never told.
    if (oldColumnId !== newColumnId) {
      const recipients = issueParticipants(issue, { actorId: userId });
      if (recipients.length) {
        sendNotification({
          userIds: recipients,
          type: 'status_changed',
          title: `${issue.issueKey || 'Задача'}: статус змінено`,
          body: `${issue.title || ''} → ${statusLabel(newColumnId, statuses)}`,
          link: issuePath(issue, projectId),
          issueId,
          projectId,
          organizationId: activeOrgId,
        }).catch(() => {});
      }
    }

    // Side-effect: if moved to client-approval and has a linked stage, mark it
    if (newColumnId === 'client-approval' && issue.linkedClientMaterialId) {
      try {
        await updateDoc(doc(db, 'stages', issue.linkedClientMaterialId), {
          clientApprovalPending: true,
          clientApprovalRequestedAt: serverTimestamp()
        });
      } catch (err) {
        console.warn('[useIssues] could not update stage clientApprovalPending', err);
      }
    }
  }, [activeOrgId, includeLinks, issues, issueLinks, linksError, linksReady, projectId, closedStatusIds, statuses, applyPatch, revertPatch]);
  return {
    issues,
    issueLinks,
    linksLoading: includeLinks && !linksReady && !linksError,
    linksError,
    loading,
    error,
    createIssue,
    updateIssue,
    setIssueParent,
    deleteIssue,
    restoreIssue,
    moveIssue
  };
}
