import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  canonicalIssueLinkDocumentId,
  canonicalizeRequestedIssueLink,
  findDirectionalIssueLinkCycle,
  normalizeStoredIssueLinks,
} from '@/lib/utils/issueRelations.mjs';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import { issueBlockLinkStatusConflict } from '@/lib/utils/issueStatusTransition.mjs';
import { resolveClosedStatusIds } from '@/lib/utils/workflowDefaults.mjs';

function apiTransactionError(code, status, message, details = {}) {
  const error = new Error(code);
  error.api = { code, status, message, ...details };
  return error;
}

function serializedDocument(document) {
  const data = document.data();
  return {
    id: document.id,
    ...data,
    createdAt: data.createdAt?.toDate?.().toISOString()
      || (typeof data.createdAt === 'string' ? data.createdAt : null),
  };
}

function issueSummary(document) {
  if (!document?.exists) return null;
  const data = document.data();
  return {
    id: document.id,
    projectId: data.projectId || null,
    issueKey: data.issueKey || null,
    title: data.title || '',
    columnId: data.columnId || null,
    status: data.status || data.columnId || null,
  };
}

async function loadIssueAndAuthorization(request, issueId) {
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
  return { db, issueRef, issue, authorization };
}

async function ensureProjectMutationAccess(loaded) {
  const { db, issue, authorization } = loaded;
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
  return null;
}

async function loadScopedIssueSummaries(
  db,
  issueIds,
  organizationId,
  projectId,
) {
  const summaries = new Map();
  const ids = [...new Set(issueIds)].filter(Boolean);
  for (let offset = 0; offset < ids.length; offset += 400) {
    const refs = ids.slice(offset, offset + 400)
      .map(issueId => db.collection('issues').doc(issueId));
    const documents = refs.length ? await db.getAll(...refs) : [];
    for (const document of documents) {
      if (
        document.exists
        && document.data().organizationId === organizationId
        && document.data().projectId === projectId
      ) {
        summaries.set(document.id, issueSummary(document));
      }
    }
  }
  return summaries;
}

function jsonLoadedError(loaded) {
  return NextResponse.json({
    error: loaded.error,
    ...(loaded.code ? { code: loaded.code } : {}),
  }, { status: loaded.status });
}

export async function GET(request, context) {
  try {
    const { issueId } = await context.params;
    const loaded = await loadIssueAndAuthorization(request, issueId);
    if (loaded.error) return jsonLoadedError(loaded);
    const accessError = await ensureProjectMutationAccess(loaded);
    if (accessError) return jsonLoadedError(accessError);
    const { db, issue } = loaded;
    const links = db.collection('issueLinks');
    const [source, target] = await Promise.all([
      links.where('sourceIssueId', '==', issueId).get(),
      links.where('targetIssueId', '==', issueId).get(),
    ]);
    const rawDocuments = new Map(
      [...source.docs, ...target.docs]
        .filter(document => document.data().organizationId === issue.organizationId)
        .map(document => [document.id, serializedDocument(document)]),
    );
    const normalizedLinks = normalizeStoredIssueLinks([...rawDocuments.values()]);
    const summaries = await loadScopedIssueSummaries(
      db,
      normalizedLinks.flatMap(link => [link.sourceIssueId, link.targetIssueId]),
      issue.organizationId,
      issue.projectId,
    );

    return NextResponse.json({
      links: normalizedLinks
        .filter(link => (
          summaries.has(link.sourceIssueId)
          && summaries.has(link.targetIssueId)
        ))
        .map(link => ({
          ...link,
          sourceIssue: summaries.get(link.sourceIssueId),
          targetIssue: summaries.get(link.targetIssueId),
        })),
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'Issue links GET',
      fallbackMessage: 'Не вдалося завантажити зв’язки завдання',
    });
  }
}

export async function POST(request, context) {
  try {
    const { issueId } = await context.params;
    const loaded = await loadIssueAndAuthorization(request, issueId);
    if (loaded.error) return jsonLoadedError(loaded);
    const accessError = await ensureProjectMutationAccess(loaded);
    if (accessError) return jsonLoadedError(accessError);
    if (!(await enforceRateLimit('issue-link-create', loaded.authorization.user.uid, 120, 60))) {
      return NextResponse.json({
        error: 'Забагато змін зв’язків. Спробуйте ще раз за хвилину',
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
    const selectedTargetIssueId = typeof body?.targetIssueId === 'string'
      ? body.targetIssueId.trim()
      : '';
    const requested = canonicalizeRequestedIssueLink({
      sourceIssueId: issueId,
      targetIssueId: selectedTargetIssueId,
      relationType: body?.relationType,
    });
    if (!requested) {
      return NextResponse.json({
        error: 'Некоректний тип зв’язку або вибране те саме завдання',
        code: 'INVALID_ISSUE_LINK',
      }, { status: 400 });
    }

    const {
      db,
      issue: loadedIssue,
      authorization,
    } = loaded;
    const canonicalId = canonicalIssueLinkDocumentId({
      organizationId: loadedIssue.organizationId,
      projectId: loadedIssue.projectId,
      sourceIssueId: issueId,
      targetIssueId: selectedTargetIssueId,
    });
    const canonicalRef = db.collection('issueLinks').doc(canonicalId);
    const sourceRef = db.collection('issues').doc(issueId);
    const targetRef = db.collection('issues').doc(selectedTargetIssueId);
    const projectRef = db.collection('projects').doc(loadedIssue.projectId);
    const workflowRef = db.collection('organizations')
      .doc(loadedIssue.organizationId)
      .collection('settings')
      .doc('workflow');

    const created = await db.runTransaction(async transaction => {
      const sourceSnap = await transaction.get(sourceRef);
      const targetSnap = await transaction.get(targetRef);
      const existingCanonical = await transaction.get(canonicalRef);
      const projectSnap = await transaction.get(projectRef);
      const workflowSnap = await transaction.get(workflowRef);
      const organizationRelations = await transaction.get(
        db.collection('issueLinks')
          .where('organizationId', '==', loadedIssue.organizationId),
      );
      const projectIssues = await transaction.get(
        db.collection('issues').where('projectId', '==', loadedIssue.projectId),
      );

      if (
        !sourceSnap.exists
        || sourceSnap.data().organizationId !== loadedIssue.organizationId
        || sourceSnap.data().projectId !== loadedIssue.projectId
      ) {
        throw apiTransactionError(
          'ISSUE_SCOPE_CHANGED',
          409,
          'Область завдання змінилася. Оновіть сторінку',
        );
      }
      if (
        !targetSnap.exists
        || targetSnap.data().organizationId !== loadedIssue.organizationId
      ) {
        throw apiTransactionError(
          'TARGET_ISSUE_NOT_FOUND',
          404,
          'Пов’язане завдання не знайдено',
        );
      }
      if (targetSnap.data().projectId !== loadedIssue.projectId) {
        throw apiTransactionError(
          'CROSS_PROJECT_LINK',
          400,
          'Логічні зв’язки можна створювати лише в межах одного проєкту',
        );
      }
      if (sourceSnap.data().deletionPending === true || targetSnap.data().deletionPending === true) {
        throw apiTransactionError(
          'ISSUE_DELETING',
          409,
          'Неможливо змінити зв’язки завдання, яке видаляється',
        );
      }
      if (
        !projectSnap.exists
        || projectSnap.data().organizationId !== loadedIssue.organizationId
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
      const statusConflict = issueBlockLinkStatusConflict({
        sourceIssue: { ...sourceSnap.data(), id: sourceSnap.id },
        targetIssue: { ...targetSnap.data(), id: targetSnap.id },
        relationType: requested.relationType,
        closedStatusIds: resolveClosedStatusIds(workflowSnap.data()?.statuses),
      });
      if (statusConflict) {
        throw apiTransactionError(
          statusConflict.code,
          statusConflict.status,
          statusConflict.message,
          Object.fromEntries(
            Object.entries(statusConflict)
              .filter(([key]) => !['code', 'status', 'message'].includes(key)),
          ),
        );
      }

      const legacyPairExists = organizationRelations.docs
        .some(document => {
          const data = document.data();
          return data.organizationId === loadedIssue.organizationId
            && (
              (data.sourceIssueId === issueId && data.targetIssueId === selectedTargetIssueId)
              || (data.sourceIssueId === selectedTargetIssueId && data.targetIssueId === issueId)
            );
        });
      if (existingCanonical.exists || legacyPairExists) {
        throw apiTransactionError(
          'ISSUE_LINK_EXISTS',
          409,
          'Зв’язок між цими завданнями вже існує',
        );
      }

      const knownIssueIds = projectIssues.docs
        .filter(document =>
          document.data().organizationId === loadedIssue.organizationId)
        .map(document => document.id);
      const graphLinks = normalizeStoredIssueLinks(
        organizationRelations.docs.map(serializedDocument),
      );
      const cyclePath = findDirectionalIssueLinkCycle({
        sourceIssueId: requested.sourceIssueId,
        targetIssueId: requested.targetIssueId,
        relationType: requested.relationType,
        links: graphLinks,
        knownIssueIds,
      });
      if (cyclePath) {
        throw apiTransactionError(
          requested.relationType === 'blocks'
            ? 'DEPENDENCY_CYCLE'
            : 'DUPLICATE_CYCLE',
          409,
          requested.relationType === 'blocks'
            ? 'Цей зв’язок створить циклічну залежність'
            : 'Цей зв’язок створить циклічний ланцюг дублікатів',
          { cyclePath },
        );
      }

      const payload = {
        schemaVersion: 2,
        organizationId: loadedIssue.organizationId,
        projectId: loadedIssue.projectId,
        ...requested,
        createdBy: authorization.user.uid,
        createdAt: FieldValue.serverTimestamp(),
      };
      transaction.create(canonicalRef, payload);
      transaction.update(projectRef, {
        issueLinkVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        id: canonicalId,
        ...payload,
        createdAt: null,
      };
    });
    return NextResponse.json({ success: true, link: created }, { status: 201 });
  } catch (error) {
    if (error?.api) {
      return NextResponse.json({
        error: error.api.message,
        code: error.api.code,
        ...Object.fromEntries(
          Object.entries(error.api)
            .filter(([key]) => !['message', 'code', 'status'].includes(key)),
        ),
      }, { status: error.api.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue links POST',
      fallbackMessage: 'Не вдалося створити зв’язок завдання',
    });
  }
}

export async function DELETE(request, context) {
  try {
    const { issueId } = await context.params;
    const loaded = await loadIssueAndAuthorization(request, issueId);
    if (loaded.error) return jsonLoadedError(loaded);
    const accessError = await ensureProjectMutationAccess(loaded);
    if (accessError) return jsonLoadedError(accessError);
    if (!(await enforceRateLimit('issue-link-delete', loaded.authorization.user.uid, 120, 60))) {
      return NextResponse.json({
        error: 'Забагато змін зв’язків. Спробуйте ще раз за хвилину',
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
    const linkId = typeof body?.linkId === 'string' ? body.linkId.trim() : '';
    if (!linkId || linkId.length > 256 || linkId.includes('/')) {
      return NextResponse.json({
        error: 'Некоректний ідентифікатор зв’язку',
        code: 'INVALID_LINK_ID',
      }, { status: 400 });
    }

    const { db, issue } = loaded;
    const linkRef = db.collection('issueLinks').doc(linkId);
    const projectRef = db.collection('projects').doc(issue.projectId);
    const removed = await db.runTransaction(async transaction => {
      const linkSnap = await transaction.get(linkRef);
      if (!linkSnap.exists) return 0;
      const link = linkSnap.data();
      const sourceIssueId = link.sourceIssueId;
      const targetIssueId = link.targetIssueId;
      if (
        link.organizationId !== issue.organizationId
        || ![sourceIssueId, targetIssueId].includes(issueId)
      ) {
        throw apiTransactionError(
          'ISSUE_LINK_NOT_FOUND',
          404,
          'Зв’язок не знайдено',
        );
      }

      const projectSnap = await transaction.get(projectRef);
      if (
        !projectSnap.exists
        || projectSnap.data().organizationId !== issue.organizationId
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
      const links = db.collection('issueLinks');
      const fromSource = await transaction.get(
        links.where('sourceIssueId', '==', sourceIssueId),
      );
      const fromTarget = await transaction.get(
        links.where('sourceIssueId', '==', targetIssueId),
      );
      const refs = [...new Map(
        [...fromSource.docs, ...fromTarget.docs]
          .filter(document => {
            const data = document.data();
            return data.organizationId === issue.organizationId
              && (
                (data.sourceIssueId === sourceIssueId && data.targetIssueId === targetIssueId)
                || (data.sourceIssueId === targetIssueId && data.targetIssueId === sourceIssueId)
              );
          })
          .map(document => [document.ref.path, document.ref]),
      ).values()];
      if (refs.length > 400) {
        throw apiTransactionError(
          'CORRUPTED_ISSUE_LINK_PAIR',
          409,
          'Для цієї пари знайдено забагато дубльованих зв’язків. Спершу запустіть міграцію',
          { duplicateCount: refs.length },
        );
      }

      refs.forEach(ref => transaction.delete(ref));
      transaction.update(projectRef, {
        issueLinkVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return refs.length;
    });
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    if (error?.api) {
      return NextResponse.json({
        error: error.api.message,
        code: error.api.code,
        ...Object.fromEntries(
          Object.entries(error.api)
            .filter(([key]) => !['message', 'code', 'status'].includes(key)),
        ),
      }, { status: error.api.status });
    }
    return routeErrorResponse(error, {
      context: 'Issue links DELETE',
      fallbackMessage: 'Не вдалося видалити зв’язок завдання',
    });
  }
}
