import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  existingParentIssueId,
  normalizeParentIssueId,
  validateIssueParentAssignment,
} from '@/lib/utils/issueHierarchyModel.mjs';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import { issueParentStatusConflict } from '@/lib/utils/issueStatusTransition.mjs';
import { resolveClosedStatusIds } from '@/lib/utils/workflowDefaults.mjs';

function hierarchyTransactionError(details) {
  const error = new Error(details.code);
  error.hierarchy = details;
  return error;
}

async function loadAuthorizedIssue(request, issueId) {
  const db = getAdminDb();
  const issueRef = db.collection('issues').doc(issueId);
  const issueSnap = await issueRef.get();
  if (!issueSnap.exists) {
    return { error: 'Завдання не знайдено', code: 'ISSUE_NOT_FOUND', status: 404 };
  }

  const issue = issueSnap.data();
  const authorization = await authorizeOrgRequest(
    request,
    issue.organizationId,
    ['owner', 'admin', 'member'],
  );
  if (authorization.error) {
    return {
      ...authorization,
      error: localizedIssueAuthorizationMessage(authorization.error),
    };
  }

  const projectSnap = await db.collection('projects').doc(issue.projectId).get();
  if (
    !projectSnap.exists
    || projectSnap.data().organizationId !== issue.organizationId
  ) {
    return { error: 'Проєкт завдання не знайдено', code: 'PROJECT_NOT_FOUND', status: 404 };
  }

  const role = authorization.membership?.role;
  const projectTeam = projectSnap.data().team;
  if (
    role === 'member'
    && !(Array.isArray(projectTeam) && projectTeam.includes(authorization.user.uid))
  ) {
    return {
      error: 'Ви не входите до команди цього проєкту',
      code: 'PROJECT_ACCESS_DENIED',
      status: 403,
    };
  }
  return { db, issueRef, issue, authorization };
}

export async function PATCH(request, context) {
  try {
    const { issueId } = await context.params;
    const loaded = await loadAuthorizedIssue(request, issueId);
    if (loaded.error) {
      return NextResponse.json({
        error: loaded.error,
        ...(loaded.code ? { code: loaded.code } : {}),
      }, { status: loaded.status });
    }
    if (!(await enforceRateLimit('issue-parent-update', loaded.authorization.user.uid, 120, 60))) {
      return NextResponse.json({
        error: 'Забагато змін ієрархії. Спробуйте ще раз за хвилину',
        code: 'RATE_LIMITED',
      }, { status: 429 });
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Тіло запиту має бути коректним JSON',
        code: 'INVALID_JSON',
      }, { status: 400 });
    }
    const parentIssueId = normalizeParentIssueId(body?.parentIssueId);
    if (parentIssueId === undefined) {
      return NextResponse.json({
        error: 'Некоректний ідентифікатор батьківського завдання',
        code: 'INVALID_PARENT_ID',
      }, { status: 400 });
    }

    const {
      db,
      issueRef,
      issue: loadedIssue,
      authorization,
    } = loaded;
    const projectRef = db.collection('projects').doc(loadedIssue.projectId);
    const workflowRef = db.collection('organizations')
      .doc(loadedIssue.organizationId)
      .collection('settings')
      .doc('workflow');
    const result = await db.runTransaction(async transaction => {
      const currentSnap = await transaction.get(issueRef);
      const projectSnap = await transaction.get(projectRef);
      if (!currentSnap.exists) {
        throw hierarchyTransactionError({
          code: 'ISSUE_NOT_FOUND',
          status: 404,
          message: 'Завдання не знайдено',
        });
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== loadedIssue.organizationId
        || current.projectId !== loadedIssue.projectId
      ) {
        throw hierarchyTransactionError({
          code: 'ISSUE_SCOPE_CHANGED',
          status: 409,
          message: 'Область завдання змінилася. Оновіть сторінку',
        });
      }
      if (
        !projectSnap.exists
        || projectSnap.data().organizationId !== current.organizationId
      ) {
        throw hierarchyTransactionError({
          code: 'PROJECT_NOT_FOUND',
          status: 404,
          message: 'Проєкт завдання не знайдено',
        });
      }
      if (projectSnap.data().deletionPending === true) {
        throw hierarchyTransactionError({
          code: 'PROJECT_DELETING',
          status: 409,
          message: 'Проєкт уже видаляється',
        });
      }

      let parent = null;
      let childIds = [];
      let closedStatusIds = [];
      if (parentIssueId) {
        const workflowSnap = await transaction.get(workflowRef);
        closedStatusIds = resolveClosedStatusIds(workflowSnap.data()?.statuses);
        const parentSnap = await transaction.get(
          db.collection('issues').doc(parentIssueId),
        );
        parent = parentSnap.exists
          ? { ...parentSnap.data(), id: parentSnap.id }
          : null;

        const canonicalChildren = await transaction.get(
          db.collection('issues').where('parentIssueId', '==', issueId),
        );
        const legacyChildren = await transaction.get(
          db.collection('issues').where('parentEpicId', '==', issueId),
        );
        childIds = [...new Map(
          [...canonicalChildren.docs, ...legacyChildren.docs]
            .filter(child => {
              const data = child.data();
              return data.organizationId === current.organizationId
                && data.projectId === current.projectId;
            })
            .map(child => [child.id, child.id]),
        ).values()];
      }

      const hierarchyError = validateIssueParentAssignment({
        issueId,
        issue: current,
        requestedParentIssueId: parentIssueId,
        parent,
        childIds,
      });
      if (hierarchyError) throw hierarchyTransactionError(hierarchyError);
      const statusConflict = issueParentStatusConflict({
        issue: { ...current, id: issueId },
        parentIssue: parent,
        closedStatusIds,
      });
      if (statusConflict) throw hierarchyTransactionError(statusConflict);

      const previousParentIssueId = existingParentIssueId(current);
      const hasLegacyParentField = Object.prototype.hasOwnProperty.call(current, 'parentEpicId');
      const changed = previousParentIssueId !== parentIssueId || hasLegacyParentField;
      if (!changed) {
        return { changed: false, previousParentIssueId, parentIssueId };
      }

      const now = FieldValue.serverTimestamp();
      transaction.update(issueRef, {
        parentIssueId,
        // The parent's key, written down where the child can read it.
        //
        // A subtask card shows the task it hangs under, and it used to find
        // that task by searching the issues that happened to be loaded on the
        // same screen. The parent is usually not among them — another sprint,
        // another column, past the page — so the identifier slot fell through
        // to the words «Батьківське завдання», which read as if that were the
        // task's number. This transaction has already read the parent to
        // validate the move; keeping its key costs nothing and means no card
        // ever has to look one up.
        parentIssueKey: parent?.issueKey || FieldValue.delete(),
        parentEpicId: FieldValue.delete(),
        updatedAt: now,
      });
      transaction.update(projectRef, {
        issueHierarchyVersion: FieldValue.increment(1),
        updatedAt: now,
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: 'parent-changed',
        from: previousParentIssueId,
        to: parentIssueId,
        createdAt: now,
      });
      return { changed: true, previousParentIssueId, parentIssueId };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error?.hierarchy) {
      return NextResponse.json({
        error: error.hierarchy.message,
        code: error.hierarchy.code,
        ...(error.hierarchy.childCount ? { childCount: error.hierarchy.childCount } : {}),
      }, { status: error.hierarchy.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue parent PATCH',
      fallbackMessage: 'Не вдалося змінити ієрархію завдання',
    });
  }
}
