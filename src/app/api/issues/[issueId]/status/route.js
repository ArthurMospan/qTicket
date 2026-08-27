import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import { existingParentIssueId } from '@/lib/utils/issueHierarchyModel.mjs';
import {
  evaluateIssueStatusTransition,
  normalizeIssueStatusTransitionInput,
  normalizedIssueBlockEdges,
} from '@/lib/utils/issueStatusTransition.mjs';
import {
  DEFAULT_STATUS_IDS,
  resolveClosedStatusIds,
  statusLabel,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';

const TRANSACTIONAL_READ_CHUNK = 400;

// `details` is caller-supplied payload, so it is spread first: a detail named
// `status` must never replace the HTTP status code, otherwise the error
// response itself throws and the client only ever sees a generic failure.
function apiTransactionError(code, status, message, details = {}) {
  const error = new Error(code);
  error.api = { ...details, code, status, message };
  return error;
}

function jsonError(error, status, code, details = {}) {
  return NextResponse.json({
    ...details,
    error,
    ...(code ? { code } : {}),
  }, { status });
}

function serializedLink(document) {
  return {
    ...document.data(),
    id: document.id,
  };
}

function issueRecord(document) {
  return document?.exists
    ? { ...document.data(), id: document.id }
    : null;
}

function sameIssueScope(issue, organizationId, projectId) {
  return issue?.organizationId === organizationId
    && issue?.projectId === projectId;
}

async function transactionGetAll(transaction, references) {
  const documents = [];
  for (let offset = 0; offset < references.length; offset += TRANSACTIONAL_READ_CHUNK) {
    documents.push(
      ...await transaction.getAll(
        ...references.slice(offset, offset + TRANSACTIONAL_READ_CHUNK),
      ),
    );
  }
  return documents;
}

export async function PATCH(request, context) {
  try {
    const { issueId } = await context.params;
    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const initialIssueSnap = await issueRef.get();
    if (!initialIssueSnap.exists) {
      return jsonError(
        'Завдання не знайдено',
        404,
        'ISSUE_NOT_FOUND',
      );
    }

    const initialIssue = initialIssueSnap.data();
    const authorization = await authorizeOrgRequest(
      request,
      initialIssue.organizationId,
      ['owner', 'admin', 'member'],
    );
    if (authorization.error) {
      return jsonError(
        localizedIssueAuthorizationMessage(authorization.error),
        authorization.status,
      );
    }
    if (!(await enforceRateLimit(
      'issue-status-update',
      authorization.user.uid,
      240,
      60,
    ))) {
      return jsonError(
        'Забагато змін статусу. Спробуйте ще раз за хвилину',
        429,
        'RATE_LIMITED',
      );
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return jsonError(
        'Тіло запиту має бути коректним JSON',
        400,
        'INVALID_JSON',
      );
    }
    const parsed = normalizeIssueStatusTransitionInput(body, issueId);
    if (parsed.error) {
      const { message, status, code, ...details } = parsed.error;
      return jsonError(message, status, code, details);
    }

    const {
      status: requestedStatus,
      order: requestedOrder,
      orderUpdates,
    } = parsed.value;
    const projectRef = db.collection('projects').doc(initialIssue.projectId);
    const workflowRef = db.collection('organizations')
      .doc(initialIssue.organizationId)
      .collection('settings')
      .doc('workflow');

    const countDeltas = await projectIssueCountDeltasFor(db, initialIssue.organizationId);
    const result = await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; the counter accumulator
      // lives outside it and would otherwise count the same move once per
      // attempt.
      countDeltas.reset();
      const currentSnap = await transaction.get(issueRef);
      const projectSnap = await transaction.get(projectRef);
      const workflowSnap = await transaction.get(workflowRef);
      if (!currentSnap.exists) {
        throw apiTransactionError(
          'ISSUE_NOT_FOUND',
          404,
          'Завдання не знайдено',
        );
      }

      const current = { ...currentSnap.data(), id: currentSnap.id };
      if (
        current.organizationId !== initialIssue.organizationId
        || current.projectId !== initialIssue.projectId
      ) {
        throw apiTransactionError(
          'ISSUE_SCOPE_CHANGED',
          409,
          'Область завдання змінилася. Оновіть сторінку',
        );
      }
      if (current.deletionPending === true) {
        throw apiTransactionError(
          'ISSUE_DELETING',
          409,
          'Завдання вже видаляється',
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

      const project = projectSnap.data();
      if (project.deletionPending === true) {
        throw apiTransactionError(
          'PROJECT_DELETING',
          409,
          'Проєкт уже видаляється',
        );
      }
      if (
        authorization.membership?.role === 'member'
        && !(
          Array.isArray(project.team)
          && project.team.includes(authorization.user.uid)
        )
      ) {
        throw apiTransactionError(
          'PROJECT_ACCESS_DENIED',
          403,
          'Ви не входите до команди цього проєкту',
        );
      }

      const workflow = workflowSnap.exists ? workflowSnap.data() : {};
      const statusIds = workflowIds(workflow.statuses, DEFAULT_STATUS_IDS)
        .filter(statusId => typeof statusId === 'string' && statusId.trim());
      if (!statusIds.includes(requestedStatus)) {
        throw apiTransactionError(
          'INVALID_WORKFLOW_STATUS',
          400,
          'Статус не належить до поточного workflow',
          { allowedStatusIds: statusIds },
        );
      }
      if ((project.hiddenColumns || []).includes(requestedStatus)) {
        throw apiTransactionError(
          'STATUS_COLUMN_HIDDEN',
          409,
          `Колонка «${statusLabel(
            requestedStatus,
            Array.isArray(workflow.statuses) ? workflow.statuses : [],
          )}» прихована `
            + 'у налаштуваннях цього проєкту. Увімкніть її або виберіть інший статус',
          { statusId: requestedStatus },
        );
      }
      const closedStatusIds = resolveClosedStatusIds(workflow.statuses)
        .filter(statusId => typeof statusId === 'string' && statusId.trim());
      const closedStatusSet = new Set(closedStatusIds);
      const currentStatus = current.columnId || current.status || null;
      const enteringTerminal = (
        !closedStatusSet.has(currentStatus)
        && closedStatusSet.has(requestedStatus)
      );
      const leavingTerminal = (
        closedStatusSet.has(currentStatus)
        && !closedStatusSet.has(requestedStatus)
      );

      let childDocuments = [];
      if (enteringTerminal) {
        const canonicalChildren = await transaction.get(
          db.collection('issues').where('parentIssueId', '==', issueId),
        );
        const legacyChildren = await transaction.get(
          db.collection('issues').where('parentEpicId', '==', issueId),
        );
        childDocuments = [...new Map(
          [...canonicalChildren.docs, ...legacyChildren.docs]
            .map(document => [document.id, document]),
        ).values()];
      }

      let rawLinks = [];
      if (enteringTerminal || leavingTerminal) {
        const links = db.collection('issueLinks');
        const sourceLinks = await transaction.get(
          links.where('sourceIssueId', '==', issueId),
        );
        const targetLinks = await transaction.get(
          links.where('targetIssueId', '==', issueId),
        );
        rawLinks = [...new Map(
          [...sourceLinks.docs, ...targetLinks.docs]
            .filter(document => {
              const link = document.data();
              return link.organizationId === current.organizationId
                && (!link.projectId || link.projectId === current.projectId);
            })
            .map(document => [document.id, serializedLink(document)]),
        ).values()];
      }

      const parentIssueId = leavingTerminal
        ? existingParentIssueId(current)
        : null;
      const relatedIssueIds = normalizedIssueBlockEdges(rawLinks)
        .flatMap(link => [link.sourceIssueId, link.targetIssueId])
        .filter(id => id && id !== issueId);
      const peerIssueIds = orderUpdates.map(update => update.issueId);
      const additionalIssueIds = [...new Set([
        ...relatedIssueIds,
        ...peerIssueIds,
        ...(parentIssueId ? [parentIssueId] : []),
      ])];
      const additionalDocuments = await transactionGetAll(
        transaction,
        additionalIssueIds.map(id => db.collection('issues').doc(id)),
      );
      const additionalById = new Map(
        additionalDocuments
          .filter(document => document.exists)
          .map(document => [document.id, document]),
      );

      for (const update of orderUpdates) {
        const peerDocument = additionalById.get(update.issueId);
        if (!peerDocument) {
          throw apiTransactionError(
            'ORDER_ISSUE_NOT_FOUND',
            409,
            'Одне із завдань для перестановки вже не існує. Оновіть дошку',
            { issueId: update.issueId },
          );
        }
        const peer = peerDocument.data();
        if (!sameIssueScope(peer, current.organizationId, current.projectId)) {
          throw apiTransactionError(
            'ORDER_ISSUE_SCOPE_MISMATCH',
            400,
            'Усі завдання для перестановки мають належати тому самому проєкту',
            { issueId: update.issueId },
          );
        }
        if (peer.deletionPending === true) {
          throw apiTransactionError(
            'ORDER_ISSUE_DELETING',
            409,
            'Одне із завдань для перестановки вже видаляється. Оновіть дошку',
            { issueId: update.issueId },
          );
        }
      }

      const childIssues = childDocuments
        .map(issueRecord)
        .filter(issue => sameIssueScope(
          issue,
          current.organizationId,
          current.projectId,
        ));
      const relatedIssues = additionalDocuments
        .map(issueRecord)
        .filter(issue => sameIssueScope(
          issue,
          current.organizationId,
          current.projectId,
        ));
      const parentIssue = parentIssueId
        ? relatedIssues.find(issue => issue.id === parentIssueId) || null
        : null;
      const transition = evaluateIssueStatusTransition({
        issueId,
        issue: current,
        nextStatusId: requestedStatus,
        closedStatusIds,
        childIssues,
        parentIssue,
        issueLinks: rawLinks,
        relatedIssues,
      });
      if (transition.error) {
        throw apiTransactionError(
          transition.error.code,
          transition.error.status,
          transition.error.message,
          Object.fromEntries(
            Object.entries(transition.error)
              .filter(([key]) => !['code', 'status', 'message'].includes(key)),
          ),
        );
      }

      const willBeClosed = closedStatusSet.has(requestedStatus);
      const hasCompletedAt = Object.prototype.hasOwnProperty.call(current, 'completedAt');
      const statusFieldsChanged = (
        current.columnId !== requestedStatus
        || current.status !== requestedStatus
      );
      const movedOrderChanged = (
        requestedOrder !== undefined
        && current.order !== requestedOrder
      );
      const completedAtNeedsSet = willBeClosed && !current.completedAt;
      const completedAtNeedsClear = !willBeClosed && hasCompletedAt;
      const peerChanges = orderUpdates.flatMap(update => {
        const document = additionalById.get(update.issueId);
        return document.data().order !== update.order
          ? [{ document, order: update.order }]
          : [];
      });
      const changed = (
        statusFieldsChanged
        || movedOrderChanged
        || completedAtNeedsSet
        || completedAtNeedsClear
        || peerChanges.length > 0
      );
      if (!changed) {
        return {
          changed: false,
          transition,
          order: current.order ?? null,
          reorderedIssueCount: 0,
          completedAtChange: null,
          completed: willBeClosed,
        };
      }

      const now = FieldValue.serverTimestamp();
      const issueUpdates = {
        columnId: requestedStatus,
        status: requestedStatus,
        updatedAt: now,
      };
      if (currentStatus !== requestedStatus) {
        issueUpdates.lastActivityType = 'status';
        issueUpdates.lastActivityAt = now;
        issueUpdates.lastActivityActorId = authorization.user.uid;
        issueUpdates.lastActivityActorName = authorization.user.name || authorization.user.email || '';
        issueUpdates.lastActivityActorAvatar = authorization.user.picture || null;
      }
      if (requestedOrder !== undefined) issueUpdates.order = requestedOrder;
      if (completedAtNeedsSet) {
        issueUpdates.completedAt = now;
      } else if (completedAtNeedsClear) {
        issueUpdates.completedAt = FieldValue.delete();
      }
      transaction.update(issueRef, issueUpdates);
      peerChanges.forEach(change => {
        transaction.update(change.document.ref, {
          order: change.order,
          updatedAt: now,
        });
      });
      // A status move changes what the project has delivered, and can change
      // what it has overdue — a task that closes stops being late. The peers
      // reordered above are not counted: their `order` moved and nothing a
      // counter looks at did.
      countDeltas
        .observeProject(current.projectId, projectSnap.data())
        .change(
          current,
          { ...current, columnId: requestedStatus, status: requestedStatus },
        );
      transaction.update(projectRef, {
        issueStatusVersion: FieldValue.increment(1),
        ...projectIssueCountIncrements(countDeltas, current.projectId),
        updatedAt: now,
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: 'moved',
        from: currentStatus,
        to: requestedStatus,
        orderFrom: current.order ?? null,
        orderTo: requestedOrder ?? current.order ?? null,
        reorderedIssueCount: peerChanges.length,
        createdAt: now,
      });

      return {
        changed: true,
        transition,
        order: requestedOrder ?? current.order ?? null,
        reorderedIssueCount: peerChanges.length,
        completedAtChange: completedAtNeedsSet
          ? 'set'
          : (completedAtNeedsClear ? 'cleared' : null),
        completed: willBeClosed,
      };
    });

    // Closing a task takes its deadline reminder off the queue; reopening one
    // puts it back. Written now rather than found by a scan later — see
    // src/lib/server/notificationOutbox.js.
    await syncIssueReminderRows({ issueId })
      .catch(error => console.warn('[issues] reminder rows failed:', error.message));
    return NextResponse.json({
      success: true,
      changed: result.changed,
      issue: {
        id: issueId,
        status: requestedStatus,
        columnId: requestedStatus,
        order: result.order,
        completed: result.completed,
      },
      transition: {
        fromStatus: result.transition.fromStatusId,
        toStatus: result.transition.toStatusId,
        enteringTerminal: result.transition.enteringTerminal,
        leavingTerminal: result.transition.leavingTerminal,
        completedAtChange: result.completedAtChange,
      },
      reorderedIssueCount: result.reorderedIssueCount,
    });
  } catch (error) {
    if (error?.api) {
      const { message, status, code, ...details } = error.api;
      return jsonError(message, status, code, details);
    }
    return routeErrorResponse(error, {
      context: 'Issue status PATCH',
      fallbackMessage: 'Не вдалося змінити статус завдання',
    });
  }
}
