import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import { can, rolesFor } from '@/lib/utils/can';
import {
  AUDITED_ISSUE_FIELDS,
  auditValue,
  auditedChange,
} from '@/lib/utils/issueAuditEvents.mjs';
import { pickIssueContentFields, pickIssueDeskFields } from '@/lib/utils/issueContentFields.mjs';
import { projectWriteError } from '@/lib/utils/projectAccess.mjs';
import {
  issueTombstoneId,
  issueUndoExpiresAt,
} from '@/lib/utils/issueTrash.mjs';
import { recordIssueHistory } from '@/lib/server/issueHistory.mjs';

const MAX_TRANSACTIONAL_CHILD_PROMOTION = 400;

function apiTransactionError(code, status, message, details = {}) {
  const error = new Error(code);
  error.api = { code, status, message, ...details };
  return error;
}

// PATCH — the record's own content, from either side of the desk.
//
// Support writes these fields straight from the browser and always has;
// `firestore.rules` authorizes that write and there is no reason to move it.
// A client cannot: `canMutateIssueData` is `isInternalContributor`, and the
// rules file is close enough to its expression budget that the comment on
// `issues/{issueId}` asks the next change to remove from it rather than add.
//
// So the customer's half of editing arrives here instead. The route is the
// narrow part: `pickIssueContentFields` drops everything that is not the
// record's content, so status, support's assignees, the deadline, the counters
// and every identity field are unreachable through it whatever the browser
// sends — and the same list is what the screen offers, so the two agree by
// construction rather than by review.
export async function PATCH(request, context) {
  try {
    const { issueId } = await context.params;
    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      return NextResponse.json({
        error: 'Звернення не знайдено',
        code: 'ISSUE_NOT_FOUND',
      }, { status: 404 });
    }

    const issue = issueSnap.data();
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      rolesFor('edit:issue_content'),
    );
    if (authorization.error) {
      return NextResponse.json({
        error: localizedIssueAuthorizationMessage(authorization.error),
      }, { status: authorization.status });
    }

    const body = await readJsonBody(request);
    const submitted = body?.data ?? body;
    // Two halves of one patch, and two different permissions.
    //
    // The desk half — who is on the request, when it is due — used to be
    // written straight from the browser, which is why neither side of the desk
    // could read that it had happened. It comes through here now, behind
    // `edit:issue`, which no client role holds: the route is what decides,
    // exactly as it decides the content half above.
    const deskPatch = pickIssueDeskFields(submitted);
    const editsDesk = Object.keys(deskPatch).length > 0;
    if (editsDesk && !can(authorization.membership?.role, 'edit:issue')) {
      return NextResponse.json({
        error: 'Робочий процес звернення веде підтримка',
        code: 'DESK_FIELDS_FORBIDDEN',
      }, { status: 403 });
    }
    if (deskPatch.assigneeIds !== undefined && !Array.isArray(deskPatch.assigneeIds)) {
      return NextResponse.json({
        error: 'Некоректне значення поля',
        code: 'INVALID_FIELD',
        field: 'assigneeIds',
      }, { status: 400 });
    }
    if (deskPatch.dueDate !== undefined) {
      // A `Date` reaches the server as an ISO string; clearing a deadline
      // reaches it as `null`, which is a value rather than an omission.
      if (deskPatch.dueDate === null) {
        deskPatch.dueDate = null;
      } else {
        const parsed = new Date(deskPatch.dueDate);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({
            error: 'Некоректне значення поля',
            code: 'INVALID_FIELD',
            field: 'dueDate',
          }, { status: 400 });
        }
        deskPatch.dueDate = Timestamp.fromDate(parsed);
      }
    }
    const patch = { ...pickIssueContentFields(submitted), ...deskPatch };
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({
        error: 'Немає полів для збереження',
        code: 'EMPTY_PATCH',
      }, { status: 400 });
    }
    if (patch.title !== undefined && !String(patch.title).trim()) {
      return NextResponse.json({
        error: 'Назва звернення не може бути порожньою',
        code: 'TITLE_REQUIRED',
      }, { status: 400 });
    }
    for (const field of ['attachments', 'labelIds', 'clientAssigneeIds']) {
      if (patch[field] !== undefined && !Array.isArray(patch[field])) {
        return NextResponse.json({
          error: 'Некоректне значення поля',
          code: 'INVALID_FIELD',
          field,
        }, { status: 400 });
      }
    }
    if (issue.archivedAt || issue.cancelledAt) {
      return NextResponse.json({
        error: 'Звернення відкладено — поверніть його, щоб редагувати',
        code: 'ISSUE_SET_ASIDE',
      }, { status: 409 });
    }

    const projectRef = db.collection('projects').doc(issue.projectId);
    const now = Timestamp.now();
    const actorName = authorization.user.name || authorization.user.email || '';

    await db.runTransaction(async transaction => {
      const currentSnap = await transaction.get(issueRef);
      const projectSnap = await transaction.get(projectRef);
      if (!currentSnap.exists) {
        throw apiTransactionError('ISSUE_NOT_FOUND', 404, 'Звернення не знайдено');
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== issue.organizationId
        || current.projectId !== issue.projectId
      ) {
        throw apiTransactionError(
          'ISSUE_SCOPE_CHANGED',
          409,
          'Область звернення змінилася. Оновіть сторінку',
        );
      }
      // Membership of the client space is what authorizes this, for a support
      // member and for a customer alike — the role check above only said the
      // role may edit content at all.
      const projectAccessError = projectWriteError(
        { ...projectSnap.data(), id: projectSnap.id },
        current.organizationId,
        authorization.membership?.role,
        authorization.user.uid,
      );
      if (projectAccessError) {
        throw apiTransactionError(
          'PROJECT_FORBIDDEN',
          projectAccessError === 'Ви не входите до команди цього проєкту' ? 403 : 409,
          projectAccessError,
        );
      }

      // The same history the browser writes for a support edit, written here
      // because a client may not write to `audit/` at all — and the change
      // still belongs in the record.
      const changedFields = [];
      for (const field of AUDITED_ISSUE_FIELDS) {
        if (patch[field] === undefined) continue;
        if (auditValue(current[field]) === auditValue(patch[field])) continue;
        changedFields.push(field);
        recordIssueHistory(transaction, issueRef, {
          userId: authorization.user.uid,
          userName: actorName,
          ...auditedChange(field, current[field], patch[field]),
          createdAt: now,
        });
      }

      transaction.update(issueRef, {
        ...patch,
        updatedAt: now,
        lastActivityType: 'updated',
        lastActivityAt: now,
        lastActivityActorId: authorization.user.uid,
        lastActivityActorName: actorName,
        // Which fields this edit was about, so a feed can tell whether it has
        // anything to say to the person reading it. «Оновила звернення» about a
        // resolution date the customer is not shown is a notification that
        // something they cannot find has changed — the worst kind, because the
        // only way to act on it is to ask.
        lastActivityFields: changedFields,
      });
      transaction.update(projectRef, { updatedAt: now });
    });

    return NextResponse.json({ ok: true, issueId, fields: Object.keys(patch) });
  } catch (error) {
    return routeErrorResponse(error, 'Не вдалося зберегти звернення');
  }
}

export async function DELETE(request, context) {
  try {
    const { issueId } = await context.params;
    const db = getAdminDb();
    const issueRef = db.collection('issues').doc(issueId);
    const issueSnap = await issueRef.get();
    if (!issueSnap.exists) {
      return NextResponse.json({
        error: 'Звернення не знайдено',
        code: 'ISSUE_NOT_FOUND',
      }, { status: 404 });
    }

    const issue = issueSnap.data();
    // Deleting is a project right, not an organization right: a member reaches
    // the tasks of the projects they belong to and no others. The role check
    // below only says the role may delete at all — `projectWriteError` inside
    // the transaction decides whether it may delete *this* one, against the
    // project document the transaction itself read.
    const authorization = await authorizeOrgRequest(
      request,
      issue.organizationId,
      rolesFor('delete:issue'),
    );
    if (authorization.error) {
      return NextResponse.json({
        error: localizedIssueAuthorizationMessage(authorization.error),
      }, { status: authorization.status });
    }

    const childPolicy = new URL(request.url).searchParams.get('childPolicy') || 'block';
    if (!['block', 'promote'].includes(childPolicy)) {
      return NextResponse.json({
        error: 'Некоректна політика для дочірніх звернень',
        code: 'INVALID_CHILD_POLICY',
      }, { status: 400 });
    }

    const projectRef = db.collection('projects').doc(issue.projectId);
    const deletedAtMs = Date.now();
    const undoExpiresAtMs = issueUndoExpiresAt(deletedAtMs);
    const tombstoneRef = db.collection('deletedIssues').doc(
      issueTombstoneId(issue.organizationId, issueId),
    );
    const countDeltas = await projectIssueCountDeltasFor(db, issue.organizationId);
    const deletion = await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; the counter accumulator
      // lives outside it and would otherwise remove the same task once per
      // attempt.
      countDeltas.reset();
      const currentSnap = await transaction.get(issueRef);
      const projectSnap = await transaction.get(projectRef);
      const tombstoneSnap = await transaction.get(tombstoneRef);
      if (!currentSnap.exists) {
        throw apiTransactionError(
          'ISSUE_NOT_FOUND',
          404,
          'Звернення не знайдено',
        );
      }
      const current = currentSnap.data();
      if (
        current.organizationId !== issue.organizationId
        || current.projectId !== issue.projectId
      ) {
        throw apiTransactionError(
          'ISSUE_SCOPE_CHANGED',
          409,
          'Область звернення змінилася. Оновіть сторінку',
        );
      }
      if (
        !projectSnap.exists
        || projectSnap.data().organizationId !== current.organizationId
      ) {
        throw apiTransactionError(
          'PROJECT_NOT_FOUND',
          404,
          'Проєкт звернення не знайдено',
        );
      }
      const projectAccessError = projectWriteError(
        { ...projectSnap.data(), id: projectSnap.id },
        current.organizationId,
        authorization.membership?.role,
        authorization.user.uid,
      );
      if (projectAccessError) {
        throw apiTransactionError(
          'PROJECT_FORBIDDEN',
          projectAccessError === 'Ви не входите до команди цього проєкту' ? 403 : 409,
          projectAccessError,
        );
      }
      if (tombstoneSnap.exists) {
        throw apiTransactionError(
          'ISSUE_ALREADY_DELETED',
          409,
          'Звернення вже видалено',
        );
      }

      const canonicalChildren = await transaction.get(
        db.collection('issues').where('parentIssueId', '==', issueId),
      );
      const legacyChildren = await transaction.get(
        db.collection('issues').where('parentEpicId', '==', issueId),
      );
      const children = [...new Map(
        [...canonicalChildren.docs, ...legacyChildren.docs]
          .filter(child => {
            const data = child.data();
            return data.organizationId === current.organizationId
              && data.projectId === current.projectId;
          })
          .map(child => [child.id, child]),
      ).values()];

      if (children.length > 0 && childPolicy === 'block') {
        throw apiTransactionError(
          'ISSUE_HAS_CHILDREN',
          409,
          'Звернення має дочірні. Підтвердьте їх перенесення на верхній рівень',
          { childCount: children.length, allowedChildPolicy: 'promote' },
        );
      }
      if (children.length > MAX_TRANSACTIONAL_CHILD_PROMOTION) {
        throw apiTransactionError(
          'TOO_MANY_CHILDREN_TO_PROMOTE',
          409,
          'Забагато дочірніх звернень для безпечного автоматичного перенесення',
          {
            childCount: children.length,
            maxTransactionalPromotion: MAX_TRANSACTIONAL_CHILD_PROMOTION,
          },
        );
      }

      const now = FieldValue.serverTimestamp();
      transaction.create(tombstoneRef, {
        schemaVersion: 1,
        issueId,
        organizationId: current.organizationId,
        projectId: current.projectId,
        issue: { ...current, id: issueId },
        childPolicy,
        childCount: children.length,
        deletedBy: authorization.user.uid,
        deletedAt: now,
        purgeAfter: Timestamp.fromMillis(undoExpiresAtMs),
      });
      // The task is gone from the project, so it is gone from its counters. The
      // promoted children stay in the same project with the same statuses, so
      // they contribute exactly what they contributed before — only their
      // parent moved.
      countDeltas
        .observeProject(current.projectId, projectSnap.data())
        .change({ ...current, id: issueId }, null);
      transaction.delete(issueRef);
      transaction.update(projectRef, {
        issueHierarchyVersion: FieldValue.increment(1),
        ...projectIssueCountIncrements(countDeltas, current.projectId),
        updatedAt: now,
      });
      return { childCount: children.length };
    });

    // The task is gone, so nothing wants its reminders. `issue: null` says so
    // without a read: the row is cancelled rather than left to fire about a
    // deadline on a task nobody can open.
    await syncIssueReminderRows({ issueId, issue: null })
      .catch(error => console.warn('[issues DELETE] reminder rows failed:', error.message));

    return NextResponse.json({
      success: true,
      softDeleted: true,
      issueId,
      organizationId: issue.organizationId,
      projectId: issue.projectId,
      childCount: deletion.childCount,
      undoExpiresAtMs,
    });
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
      context: 'Issue DELETE',
      fallbackMessage: 'Не вдалося видалити звернення',
    });
  }
}
