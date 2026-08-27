import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { routeErrorResponse } from '@/lib/server/apiErrors';
import { legacySubtasksToChecklist } from '@/lib/utils/issueHierarchyModel.mjs';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';

function apiTransactionError(code, status, message) {
  const error = new Error(code);
  error.api = { code, status, message };
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
  if (
    authorization.membership?.role === 'member'
    && !(
      Array.isArray(projectSnap.data().team)
      && projectSnap.data().team.includes(authorization.user.uid)
    )
  ) {
    return {
      error: 'Ви не входите до команди цього проєкту',
      code: 'PROJECT_ACCESS_DENIED',
      status: 403,
    };
  }
  return { db, issueRef, issue, authorization };
}

export async function POST(request, context) {
  try {
    const { issueId } = await context.params;
    const loaded = await loadAuthorizedIssue(request, issueId);
    if (loaded.error) {
      return NextResponse.json({
        error: loaded.error,
        ...(loaded.code ? { code: loaded.code } : {}),
      }, { status: loaded.status });
    }
    if (!(await enforceRateLimit(
      'issue-legacy-checklist',
      loaded.authorization.user.uid,
      60,
      60,
    ))) {
      return NextResponse.json({
        error: 'Забагато запитів. Спробуйте ще раз за хвилину',
        code: 'RATE_LIMITED',
      }, { status: 429 });
    }

    const { db, issueRef, issue: loadedIssue, authorization } = loaded;
    const projectRef = db.collection('projects').doc(loadedIssue.projectId);
    const result = await db.runTransaction(async transaction => {
      const currentSnap = await transaction.get(issueRef);
      const projectSnap = await transaction.get(projectRef);
      if (!currentSnap.exists) {
        throw apiTransactionError('ISSUE_NOT_FOUND', 404, 'Завдання не знайдено');
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== loadedIssue.organizationId
        || current.projectId !== loadedIssue.projectId
      ) {
        throw apiTransactionError(
          'ISSUE_SCOPE_CHANGED',
          409,
          'Область завдання змінилася. Оновіть сторінку',
        );
      }
      if (
        !projectSnap.exists
        || projectSnap.data().organizationId !== current.organizationId
      ) {
        throw apiTransactionError(
          'PROJECT_NOT_FOUND',
          404,
          'Проєкт завдання не знайдено',
        );
      }
      if (projectSnap.data().deletionPending === true) {
        throw apiTransactionError(
          'PROJECT_DELETING',
          409,
          'Проєкт уже видаляється',
        );
      }
      if (current.deletionPending === true) {
        throw apiTransactionError(
          'ISSUE_DELETING',
          409,
          'Неможливо змінити завдання, яке видаляється',
        );
      }

      const hasLegacyField = Object.prototype.hasOwnProperty.call(current, 'subtasks');
      if (!hasLegacyField) {
        return {
          changed: false,
          migratedItems: 0,
          description: typeof current.description === 'string' ? current.description : '',
        };
      }
      if (!Array.isArray(current.subtasks)) {
        throw apiTransactionError(
          'MALFORMED_LEGACY_SUBTASKS',
          409,
          'Старий список підзавдань пошкоджено. Потрібен ручний перегляд',
        );
      }

      const migratedItems = current.subtasks.filter(item =>
        typeof item?.title === 'string' && item.title.trim()).length;
      const description = legacySubtasksToChecklist(
        current.description,
        current.subtasks,
      );
      const now = FieldValue.serverTimestamp();
      transaction.update(issueRef, {
        description,
        subtasks: FieldValue.delete(),
        updatedAt: now,
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: 'legacy-subtasks-migrated',
        from: migratedItems,
        to: 'description-checklist',
        createdAt: now,
      });
      return { changed: true, migratedItems, description };
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error?.api) {
      return NextResponse.json({
        error: error.api.message,
        code: error.api.code,
      }, { status: error.api.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue legacy checklist POST',
      fallbackMessage: 'Не вдалося перенести старий список в опис',
    });
  }
}
