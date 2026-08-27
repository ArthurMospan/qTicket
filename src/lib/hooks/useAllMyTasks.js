'use client';

// src/lib/hooks/useAllMyTasks.js — «Мої завдання», read from the shared task set.
//
// This used to run its own pair of queries per project chunk — the tasks
// assigned to this person, and their links — plus a third wave of queries for
// the children of those tasks, because a personal query by assignee cannot see
// a subtask somebody else is doing. Three sets of listeners over documents the
// dashboard was already subscribed to, and Firestore bills a delivery per
// listener.
//
// So there are none here now. `useOrganizationIssues` reads every task of every
// project this account can open, once, and «Мої завдання» is a filter over it:
// the cards are the tasks with this person among the assignees, and the context
// the cards need — children, blockers, the project's own ordering — is the rest
// of that same set, which is why the separate child subscription could be
// deleted outright rather than shared.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import {
  useOrganizationIssueLinks,
  useOrganizationIssues,
} from '@/lib/hooks/useOrganizationIssues';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useOptimisticPatch } from '@/lib/hooks/useOptimisticPatch';
import { reportLoadError } from '@/lib/utils/errors';
import { pickPatchableFields, planDrop } from '@/lib/utils/optimistic.mjs';
import { issueCompletionBlockers } from '@/lib/utils/issueExecution.mjs';
import { issueParticipants } from '@/lib/utils/issueParticipants.mjs';
import { statusLabel } from '@/lib/utils/workflowDefaults.mjs';
import {
  resolveCategoryStatusId,
  statusCategoryOf,
  statusCategoryLabel,
} from '@/lib/utils/statusCategories.mjs';
import {
  compareMyTaskIssues,
  normalizeMyTaskOrders,
  planMyTaskDrop,
} from '@/lib/utils/myTaskOrder.mjs';
import { sendNotification } from '@/lib/hooks/useNotifications';
import {
  syncIssueRemindersViaApi,
  transitionIssueStatusViaApi,
} from '@/lib/services/issues';
import { issuePath } from '@/lib/utils/issueKeys.mjs';

function issueLabel(issue) {
  return issue?.issueKey || issue?.title || issue?.id || 'без назви';
}

export function useAllMyTasks(userId) {
  const {
    activeOrgId,
    projects,
    authLoading,
    orgLoading,
    projectsLoading,
  } = useAppContext();
  const { closedStatusIds, statuses } = useWorkflowConfig();
  // Only the projects this user can already open. An organization-wide query
  // is rejected in full the moment it touches one project they are not on the
  // team of, which is what used to empty this page for every member.
  const projectIds = useMemo(
    () => [...new Set((projects || []).map(project => project.id).filter(Boolean))],
    [projects],
  );
  // The workspace's one task subscription. `issues` is the working set —
  // archived and cancelled work is already out of it — which is exactly what
  // this screen is about: a task put aside is not on anybody's list of what to
  // do next.
  const {
    issues: workspaceIssues,
    error: issuesError,
    loading: issuesLoading,
  } = useOrganizationIssues(activeOrgId, projectIds);
  const {
    issueLinks,
    error: linksError,
  } = useOrganizationIssueLinks(activeOrgId, projectIds);
  const [myTaskOrders, setMyTaskOrders] = useState({});
  const [myTaskOrderLoading, setMyTaskOrderLoading] = useState(true);

  // The cards. Everything else in the set stays available below as context: a
  // subtask somebody else is doing still decides whether the parent may close,
  // and a card's position among its project's tasks is computed against all of
  // them, not against the handful this person happens to own.
  const snapshotTasks = useMemo(() => {
    if (!userId) return [];
    return workspaceIssues
      .filter(issue => issue.assigneeIds?.includes(userId))
      .sort((a, b) => {
        const aTime = a.dueDate?.toMillis?.() ?? a.createdAt?.toMillis?.() ?? 0;
        const bTime = b.dueDate?.toMillis?.() ?? b.createdAt?.toMillis?.() ?? 0;
        return aTime - bTime;
      });
  }, [workspaceIssues, userId]);

  // Keeps the "My tasks" kanban from springing a dropped card back to its old
  // column while the write is in flight. Sorted by due date here, not by
  // `order`, so the merged list needs no re-sort.
  const [tasks, applyPatch, revertPatch] = useOptimisticPatch(snapshotTasks);
  const [allIssues, applyAllPatch, revertAllPatch] = useOptimisticPatch(workspaceIssues);
  const compareTaskCards = useMemo(
    () => compareMyTaskIssues(myTaskOrders),
    [myTaskOrders],
  );
  const categoryOfIssue = useCallback(
    issue => statusCategoryOf(issue?.columnId || issue?.status || null, statuses),
    [statuses],
  );
  // An empty project list before the projects have loaded is not a user with
  // nothing assigned to them.
  const loading = issuesLoading || Boolean(authLoading || orgLoading || projectsLoading);
  const error = issuesError || linksError;

  // Project `order` belongs to project boards. This private settings document
  // holds the user's own cross-project order for "My tasks".
  useEffect(() => {
    if (!userId || !activeOrgId) {
      queueMicrotask(() => {
        setMyTaskOrders({});
        setMyTaskOrderLoading(false);
      });
      return;
    }
    queueMicrotask(() => setMyTaskOrderLoading(true));
    const orderRef = doc(db, 'users', userId, 'settings', `my-tasks-${activeOrgId}`);
    return onSnapshot(
      orderRef,
      snapshot => {
        setMyTaskOrders(normalizeMyTaskOrders(snapshot.data()?.orders));
        setMyTaskOrderLoading(false);
      },
      error => {
        reportLoadError('[useAllMyTasks] personal order', error);
        setMyTaskOrders({});
        setMyTaskOrderLoading(false);
      },
    );
  }, [activeOrgId, userId]);

  // Shared by the board and by any other status write: a parent or a blocked
  // task may not be closed while real work under it is still open.
  const assertCompletable = useCallback((taskId, current, nextStatus) => {
    if (!current || !nextStatus) return;
    const wasClosed = closedStatusIds.includes(current.columnId || current.status);
    const willBeClosed = closedStatusIds.includes(nextStatus);
    if (!willBeClosed || wasClosed) return;
    const blockers = issueCompletionBlockers({
      issueId: taskId,
      issues: allIssues,
      issueLinks,
      closedStatusIds,
    });
    if (blockers.canComplete) return;
    const reasons = [];
    if (blockers.children.length > 0) {
      reasons.push(
        `спочатку завершіть підзавдання: ${blockers.children.map(issueLabel).join(', ')}`,
      );
    }
    if (blockers.dependencies.length > 0) {
      reasons.push(
        `завдання ще блокують: ${blockers.dependencies.map(issueLabel).join(', ')}`,
      );
    }
    throw new Error(`Не можна завершити завдання — ${reasons.join('; ')}.`);
  }, [allIssues, closedStatusIds, issueLinks]);

  /**
   * A drop on "Мої завдання" always updates a private cross-project order.
   * Project `order` is only touched when the task really enters another status;
   * a reorder in one category creates no status update or audit event.
   */
  const moveTask = useCallback(async (
    taskId,
    columnId,
    categoryId,
    position,
    actorUser = {},
  ) => {
    const current = allIssues.find(issue => issue.id === taskId);
    if (!current) throw new Error('Issue not found');
    const fromColumnId = current.columnId || current.status || null;
    const statusChanged = fromColumnId !== columnId;
    const personalPlan = planMyTaskDrop({
      issues: tasks,
      issueId: taskId,
      targetCategoryId: categoryId,
      position,
      orders: myTaskOrders,
      categoryOf: categoryOfIssue,
    });
    if (!personalPlan) throw new Error('Issue not found');
    const previousOrders = myTaskOrders;

    let statusPlan = null;
    if (statusChanged) {
      assertCompletable(taskId, current, columnId);
      statusPlan = planDrop(
        allIssues,
        taskId,
        columnId,
        { index: 0 },
        { scopeToProject: true },
      );
      if (!statusPlan) {
        throw new Error('Issue not found');
      }
    }
    setMyTaskOrders(personalPlan.orders);
    if (statusPlan) {
      applyPatch(statusPlan.patches);
      applyAllPatch(statusPlan.patches);
    }

    let statusPersisted = false;
    try {
      if (statusPlan) {
        await transitionIssueStatusViaApi({
          issueId: taskId,
          status: columnId,
          order: statusPlan.patches[taskId]?.order,
          orderUpdates: Object.entries(statusPlan.patches)
            .filter(([, patch]) => patch.order !== undefined)
            .map(([id, patch]) => ({ issueId: id, order: patch.order })),
        });
        statusPersisted = true;
      }
      await setDoc(
        doc(db, 'users', userId, 'settings', `my-tasks-${activeOrgId}`),
        {
          organizationId: activeOrgId,
          orders: personalPlan.orders,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (error) {
      // If the status request already succeeded, keep its optimistic patch:
      // reverting here would briefly lie about the server state until the
      // Firestore snapshot arrives. The personal order may still remain useful
      // for this session even when its separate settings write failed.
      if (!statusPersisted) {
        setMyTaskOrders(previousOrders);
      }
      if (statusPlan && !statusPersisted) {
        revertPatch(Object.keys(statusPlan.patches));
        revertAllPatch(Object.keys(statusPlan.patches));
      }
      throw error;
    }

    // Only a real status transition reaches participants. Personal sorting is
    // private UI state and must not look like activity on the task itself.
    if (statusChanged) {
      const recipients = issueParticipants(current, {
        actorId: actorUser.userId || userId,
      });
      if (recipients.length) {
        sendNotification({
          userIds: recipients,
          type: 'status_changed',
          title: `${current.issueKey || 'Задача'}: статус змінено`,
          body: `${current.title || ''} → ${statusLabel(columnId, statuses)}`,
          link: issuePath(current),
          issueId: taskId,
          projectId: current.projectId,
          organizationId: activeOrgId,
        }).catch(() => {});
      }
    }
    return { statusChanged, statusId: columnId };
  }, [
    activeOrgId,
    allIssues,
    applyAllPatch,
    applyPatch,
    assertCompletable,
    categoryOfIssue,
    myTaskOrders,
    revertAllPatch,
    revertPatch,
    statuses,
    tasks,
    userId,
  ]);

  /**
   * A drop on the category columns of «Мої завдання». The column names a
   * category; the status written is one the task's *own project* uses, so a
   * column of this board can never be missing from a project and a drop can
   * never be refused by a project setting the person dropping the card cannot
   * see. A task already in the target category keeps its status — moving inside
   * one category is a reorder, not a status change.
   */
  const moveTaskToCategory = useCallback(async (taskId, categoryId, position, actorUser = {}) => {
    const current = allIssues.find(issue => issue.id === taskId);
    if (!current) throw new Error('Issue not found');
    const project = (projects || []).find(item => item.id === current.projectId);
    const statusId = resolveCategoryStatusId(categoryId, statuses, {
      currentStatusId: current.columnId || current.status || null,
      hiddenStatusIds: Array.isArray(project?.hiddenColumns) ? project.hiddenColumns : [],
    });
    if (!statusId) {
      throw new Error(
        `У проєкті «${project?.name || current.projectId}» немає доступної колонки `
          + `категорії «${statusCategoryLabel(categoryId) || categoryId}». `
          + 'Увімкніть її в налаштуваннях проєкту або оберіть інший статус',
      );
    }
    return moveTask(taskId, statusId, categoryId, position, actorUser);
  }, [allIssues, moveTask, projects, statuses]);

  const updateTask = useCallback(async (taskId, data) => {
    const current = tasks.find(task => task.id === taskId);
    if (
      data.status !== undefined
      && data.columnId !== undefined
      && data.status !== data.columnId
    ) {
      throw new Error('Статус і колонка задачі мають збігатися');
    }
    const hasStatusUpdate = data.status !== undefined || data.columnId !== undefined;
    if (data.completedAt !== undefined && !hasStatusUpdate) {
      throw new Error('Дата завершення керується статусом задачі');
    }
    const nextStatus = data.columnId ?? data.status;
    const directData = { ...data };
    delete directData.status;
    delete directData.columnId;
    delete directData.completedAt;
    if (hasStatusUpdate) delete directData.order;
    assertCompletable(taskId, current, nextStatus);
    // Paint the new column before the round-trip, otherwise the drop animation
    // lands the card back where it started and the echo teleports it.
    const optimistic = pickPatchableFields(data);
    if (optimistic) {
      applyPatch({ [taskId]: optimistic });
      applyAllPatch({ [taskId]: optimistic });
    }

    try {
      if (hasStatusUpdate) {
        await transitionIssueStatusViaApi({
          issueId: taskId,
          status: nextStatus,
          ...(data.order !== undefined ? { order: data.order } : {}),
        });
      }
      if (Object.keys(directData).length > 0) {
        await updateDoc(doc(db, 'issues', taskId), {
          ...directData,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      if (optimistic) {
        revertPatch([taskId]);
        revertAllPatch([taskId]);
      }
      throw err;
    }
    // Same act, same rule as the board: the deadline is written here, the
    // queue row that reminds somebody about it is written by the server.
    syncIssueRemindersViaApi(taskId, directData);
  }, [
    applyAllPatch,
    applyPatch,
    assertCompletable,
    revertAllPatch,
    revertPatch,
    tasks,
  ]);
  return {
    tasks,
    allIssues,
    issueLinks,
    loading: loading || myTaskOrderLoading,
    error,
    moveTask,
    moveTaskToCategory,
    compareTaskCards,
    updateTask
  };
}
