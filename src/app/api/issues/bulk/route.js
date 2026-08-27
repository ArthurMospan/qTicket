import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { POST as createIssue } from '../route';
import { DELETE as deleteIssue } from '../[issueId]/route';
import { PATCH as archiveIssue } from '../[issueId]/archive/route';
import { PATCH as cancelIssue } from '../[issueId]/cancel/route';
import { PATCH as transitionIssueStatus } from '../[issueId]/status/route';
import { deliverBulkNotifications } from '@/lib/server/bulkNotifications';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  ISSUE_BULK_ACTION_BY_ID,
  MAX_BULK_ISSUES,
  normalizeBulkIssueIds,
  validateBulkActionValue,
} from '@/lib/bulk/issueBulkActions.mjs';
import {
  DEFAULT_LABEL_IDS,
  DEFAULT_PRIORITY_IDS,
  DEFAULT_STATUS_IDS,
  DEFAULT_TYPE_IDS,
  STATUS_LABELS,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';
import { resolveCategoryStatusId } from '@/lib/utils/statusCategories.mjs';
import { NO_PRIORITY_ID } from '@/lib/utils/priorities.mjs';
import { issueParticipants } from '@/lib/utils/issueParticipants.mjs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { assigneesOutsideProject, projectWriteError } from '@/lib/utils/projectAccess.mjs';
import { can } from '@/lib/utils/can';
import { DEFAULT_ORGANIZATION_TIME_ZONE, zonedDateTimeToUtcMs } from '@/lib/utils/timeZone.mjs';

const ACTION_CONCURRENCY = 8;

function jsonRequest(url, request, method, body) {
  return new Request(url, {
    method,
    headers: {
      Authorization: request.headers.get('authorization') || '',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function responseResult(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Операцію відхилено');
  return body;
}

function fallbackStatuses(workflow) {
  return Array.isArray(workflow.statuses) && workflow.statuses.length > 0
    ? workflow.statuses
    : DEFAULT_STATUS_IDS.map(id => ({ id, label: STATUS_LABELS[id] || id }));
}

function serializedDate(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function duplicateData(issue) {
  return {
    title: `Копія — ${issue.title || issue.issueKey || 'Завдання'}`.slice(0, 240),
    description: typeof issue.description === 'string' ? issue.description : '',
    status: issue.columnId || issue.status,
    priority: issue.priority || NO_PRIORITY_ID,
    type: issue.type || 'task',
    assigneeIds: Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [],
    labelIds: Array.isArray(issue.labelIds) ? issue.labelIds : [],
    dueDate: serializedDate(issue.dueDate),
    estimateMinutes: Number.isFinite(Number(issue.estimateMinutes)) ? Number(issue.estimateMinutes) : null,
    sprintId: issue.sprintId || null,
  };
}

function projectAccessError(project, organizationId, authorization) {
  return projectWriteError(
    project,
    organizationId,
    authorization.membership?.role,
    authorization.user.uid,
  );
}

function cleanIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))].slice(0, 20);
}

function updateForAction({ actionId, value, issue, workflow, timeZone }) {
  const priorityIds = new Set(workflowIds(workflow.priorities, DEFAULT_PRIORITY_IDS));
  const labelIds = new Set(workflowIds(workflow.labels, DEFAULT_LABEL_IDS));
  const typeIds = new Set(workflowIds(workflow.types, DEFAULT_TYPE_IDS));
  const previousAssignees = cleanIds(issue.assigneeIds);
  const previousLabels = cleanIds(issue.labelIds);

  switch (actionId) {
    case 'assignees-add':
      return { assigneeIds: cleanIds([...previousAssignees, ...value]) };
    case 'assignees-remove': {
      const removed = new Set(value);
      return { assigneeIds: previousAssignees.filter(id => !removed.has(id)) };
    }
    case 'assignees-replace':
      return { assigneeIds: cleanIds(value) };
    case 'assignees-clear':
      return { assigneeIds: [] };
    case 'priority':
      if (!priorityIds.has(value) && value !== NO_PRIORITY_ID) throw new Error('Пріоритет не належить до workflow');
      return { priority: value };
    case 'priority-clear':
      return { priority: NO_PRIORITY_ID };
    case 'labels-add': {
      if (value.some(id => !labelIds.has(id))) throw new Error('Мітка не належить до workflow');
      return { labelIds: cleanIds([...previousLabels, ...value]) };
    }
    case 'labels-remove': {
      const removed = new Set(value);
      return { labelIds: previousLabels.filter(id => !removed.has(id)) };
    }
    case 'labels-clear':
      return { labelIds: [] };
    case 'type':
      if (!typeIds.has(value) || value === 'epic') throw new Error('Тип не належить до workflow');
      return { type: value };
    case 'deadline': {
      const timestamp = zonedDateTimeToUtcMs(value, {
        hour: 23,
        minute: 59,
        second: 59,
        millisecond: 999,
      }, timeZone);
      if (!Number.isFinite(timestamp)) throw new Error('Некоректний дедлайн');
      return { dueDate: Timestamp.fromMillis(timestamp) };
    }
    case 'deadline-clear':
      return { dueDate: null };
    case 'estimate':
      return { estimateMinutes: Number(value) };
    case 'estimate-clear':
      return { estimateMinutes: null };
    case 'sprint':
      return { sprintId: value };
    case 'backlog':
      return { sprintId: null };
    default:
      throw new Error('Дія не підтримує оновлення атрибутів');
  }
}

/**
 * What one task has to say, or `null` when it has nothing. Nothing is sent from
 * here: the notices are collected across the whole operation and delivered once
 * at the end, because a per-task send meant a per-task email and a per-task
 * Telegram round-trip — the whole reason a large selection took minutes.
 */
function noticeForAction({ issue, nextIssue, actionId, organizationId, actorId }) {
  let userIds = [];
  let type = '';
  let title = '';
  if (actionId === 'status') {
    userIds = issueParticipants(issue, { actorId });
    type = 'status_changed';
    title = `${issue.issueKey || 'Задача'}: статус змінено`;
  } else if (actionId.startsWith('assignees-')) {
    const previous = new Set(issue.assigneeIds || []);
    userIds = (nextIssue.assigneeIds || []).filter(id => !previous.has(id) && id !== actorId);
    type = 'assigned';
    title = `${issue.issueKey || 'Задача'}: вас призначено відповідальним`;
  }
  if (!userIds.length) return null;
  return {
    userIds,
    type,
    title,
    body: issue.title || issue.issueKey || 'Завдання',
    link: issuePath(issue, issue.projectId),
    issueId: issue.id,
    projectId: issue.projectId,
    organizationId,
  };
}

async function inChunks(items, worker) {
  const results = [];
  for (let offset = 0; offset < items.length; offset += ACTION_CONCURRENCY) {
    results.push(...await Promise.all(items.slice(offset, offset + ACTION_CONCURRENCY).map(worker)));
  }
  return results;
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({ error: 'Тіло запиту має бути коректним JSON' }, { status: 400 });
    }
    const organizationId = typeof body?.organizationId === 'string' ? body.organizationId.trim() : '';
    const rawIssueIds = Array.isArray(body?.issueIds) ? body.issueIds : [];
    const issueIds = normalizeBulkIssueIds(rawIssueIds);
    const actionId = typeof body?.action === 'string' ? body.action : '';
    const action = ISSUE_BULK_ACTION_BY_ID.get(actionId);
    if (!organizationId || organizationId.length > 256) {
      return NextResponse.json({ error: 'Потрібна коректна організація' }, { status: 400 });
    }
    if (!rawIssueIds.length || rawIssueIds.length > MAX_BULK_ISSUES || !issueIds.length || issueIds.length > MAX_BULK_ISSUES) {
      return NextResponse.json({ error: `Дозволено від 1 до ${MAX_BULK_ISSUES} задач` }, { status: 400 });
    }
    const valueError = validateBulkActionValue(actionId, body.value);
    if (!action || valueError) return NextResponse.json({ error: valueError || 'Невідома масова дія' }, { status: 400 });

    const authorization = await authorizeOrgRequest(request, organizationId, ['owner', 'admin', 'member']);
    if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    // Whether a role may archive at all comes from the matrix; whether it may
    // archive *this* task comes from `projectAccessError` below, per issue.
    if (action.permission && !can(authorization.membership?.role, action.permission)) {
      return NextResponse.json({ error: 'Ця масова дія недоступна для вашої ролі' }, { status: 403 });
    }
    if (!(await enforceRateLimit('issue-bulk', authorization.user.uid, 20, 60))) {
      return NextResponse.json({ error: 'Забагато масових операцій. Спробуйте за хвилину' }, { status: 429 });
    }
    const db = getAdminDb();
    const issueSnaps = await db.getAll(...issueIds.map(id => db.collection('issues').doc(id)));
    const issues = issueSnaps.map((snap, index) => snap.exists ? { ...snap.data(), id: snap.id } : { id: issueIds[index], missing: true });
    const projectIds = [...new Set(issues.filter(issue => !issue.missing).map(issue => issue.projectId).filter(Boolean))];
    const [projectSnaps, workflowSnap, organizationSnap] = await Promise.all([
      projectIds.length ? db.getAll(...projectIds.map(id => db.collection('projects').doc(id))) : [],
      db.collection('organizations').doc(organizationId).collection('settings').doc('workflow').get(),
      db.collection('organizations').doc(organizationId).get(),
    ]);
    const projects = new Map(projectSnaps.map(snap => [snap.id, snap.exists ? { ...snap.data(), id: snap.id } : null]));
    const workflow = workflowSnap.exists ? workflowSnap.data() : {};
    const timeZone = organizationSnap.data()?.timezone || DEFAULT_ORGANIZATION_TIME_ZONE;
    const statuses = fallbackStatuses(workflow);

    let valueMemberships = null;
    // The role each of them holds, because being in the organization is not
    // what opens a project — `project.team` is, and an owner or an admin
    // reaches every project without being listed in one.
    let valueRoles = new Map();
    if (['assignees-add', 'assignees-replace'].includes(actionId)) {
      const memberIds = cleanIds(body.value);
      const memberships = await db.getAll(...memberIds.map(id => db.collection('orgMemberships').doc(`${organizationId}_${id}`)));
      if (memberships.some((snap, index) => !snap.exists || snap.data().userId !== memberIds[index] || snap.data().orgId !== organizationId)) {
        return NextResponse.json({ error: 'Один із відповідальних не є учасником організації' }, { status: 400 });
      }
      valueMemberships = memberIds;
      valueRoles = new Map(memberIds.map((id, index) => [id, memberships[index].data().role || null]));
    }
    let sprint = null;
    if (actionId === 'sprint') {
      const sprintSnap = await db.collection('sprints').doc(body.value).get();
      sprint = sprintSnap.exists ? { ...sprintSnap.data(), id: sprintSnap.id } : null;
      if (!sprint || sprint.organizationId !== organizationId || sprint.status === 'completed') {
        return NextResponse.json({ error: 'Спринт не належить організації або вже завершений' }, { status: 400 });
      }
    }

    // The project task counters for the whole operation, accumulated across the
    // loop and committed once at the end. Not inside each task's transaction:
    // this route already learned that writing `projects/{id}` per task makes
    // eight concurrent transactions fight over one row and serialises the
    // operation behind it, which is why `updatedAt` moved out of the loop too.
    //
    // The delegated actions — archive, cancel, delete, status, duplicate — are
    // real requests to the routes that own them, so their counters are written
    // there. What is left here is attribute edits, and the only attribute a
    // count depends on is the deadline.
    const countDeltas = await projectIssueCountDeltasFor(db, organizationId);
    for (const [projectId, project] of projects) {
      if (project) countDeltas.observeProject(projectId, project);
    }

    const results = await inChunks(issues, async issue => {
      try {
        if (issue.missing) throw new Error('Завдання не знайдено');
        if (issue.organizationId !== organizationId) throw new Error('Завдання не належить активній організації');
        if (issue.deletionPending === true) throw new Error('Завдання вже видаляється');
        const project = projects.get(issue.projectId);
        const accessError = projectAccessError(project, organizationId, authorization);
        if (accessError) throw new Error(accessError);

        if (actionId === 'duplicate') {
          const internal = jsonRequest(new URL('/api/issues', request.url), request, 'POST', {
            organizationId,
            projectId: issue.projectId,
            data: duplicateData(issue),
          });
          const created = await responseResult(await createIssue(internal));
          return { id: issue.id, createdId: created.id, issueKey: created.issueKey };
        }
        if (actionId === 'archive') {
          const internal = jsonRequest(new URL(`/api/issues/${encodeURIComponent(issue.id)}/archive`, request.url), request, 'PATCH', { archived: true });
          await responseResult(await archiveIssue(internal, { params: Promise.resolve({ issueId: issue.id }) }));
          return { id: issue.id, patch: { archivedAt: new Date() }, archived: true };
        }
        if (actionId === 'cancel') {
          const internal = jsonRequest(new URL(`/api/issues/${encodeURIComponent(issue.id)}/cancel`, request.url), request, 'PATCH', { cancelled: true });
          await responseResult(await cancelIssue(internal, { params: Promise.resolve({ issueId: issue.id }) }));
          return { id: issue.id, patch: { cancelledAt: new Date() }, cancelled: true };
        }
        if (actionId === 'delete') {
          const internal = jsonRequest(new URL(`/api/issues/${encodeURIComponent(issue.id)}?childPolicy=block`, request.url), request, 'DELETE');
          await responseResult(await deleteIssue(internal, { params: Promise.resolve({ issueId: issue.id }) }));
          return { id: issue.id, softDeleted: true };
        }
        if (actionId === 'status') {
          const requestedStatus = body.value.mode === 'category'
            ? resolveCategoryStatusId(body.value.id, statuses, {
              currentStatusId: issue.columnId || issue.status,
              hiddenStatusIds: project.hiddenColumns || [],
            })
            : body.value.id;
          if (!requestedStatus) throw new Error(`У проєкті «${project.name || project.id}» немає доступного статусу цієї категорії`);
          const internal = jsonRequest(new URL(`/api/issues/${encodeURIComponent(issue.id)}/status`, request.url), request, 'PATCH', { status: requestedStatus });
          await responseResult(await transitionIssueStatus(internal, { params: Promise.resolve({ issueId: issue.id }) }));
          return {
            id: issue.id,
            patch: { status: requestedStatus, columnId: requestedStatus },
            notice: noticeForAction({
              issue,
              nextIssue: { ...issue, status: requestedStatus, columnId: requestedStatus },
              actionId,
              organizationId,
              actorId: authorization.user.uid,
            }),
          };
        }

        const normalizedValue = action.value === 'memberIds'
          ? (valueMemberships || cleanIds(body.value))
          : body.value;
        const issueRef = db.collection('issues').doc(issue.id);
        const projectRef = db.collection('projects').doc(issue.projectId);
        const sprintRef = actionId === 'sprint'
          ? db.collection('sprints').doc(body.value)
          : null;
        let patch = null;
        let freshIssue = issue;
        await db.runTransaction(async transaction => {
          const freshSnap = await transaction.get(issueRef);
          const freshProjectSnap = await transaction.get(projectRef);
          const freshSprintSnap = sprintRef ? await transaction.get(sprintRef) : null;
          if (!freshSnap.exists) throw new Error('Завдання більше не існує');
          const fresh = { ...freshSnap.data(), id: freshSnap.id };
          if (fresh.organizationId !== organizationId || fresh.projectId !== issue.projectId) throw new Error('Область задачі змінилася');
          const freshProject = freshProjectSnap.exists
            ? { ...freshProjectSnap.data(), id: freshProjectSnap.id }
            : null;
          const freshAccessError = projectAccessError(freshProject, organizationId, authorization);
          if (freshAccessError) throw new Error(freshAccessError);
          if (freshSprintSnap && (
            !freshSprintSnap.exists
            || freshSprintSnap.data().organizationId !== organizationId
            || freshSprintSnap.data().status === 'completed'
          )) throw new Error('Спринт не належить організації або вже завершений');
          // The workflow is one document shared by every task in the operation
          // and it is only read to validate an id against it. Reading it inside
          // each transaction meant fifty reads of the same document and fifty
          // transactions that a single unrelated workflow edit could abort. It
          // is read once, above, with the rest of the operation's context.
          patch = updateForAction({ actionId, value: normalizedValue, issue: fresh, workflow, timeZone });
          freshIssue = fresh;
          // An assignee has to be able to open the project the task is in. In
          // bulk this is per task, because a selection spans projects: the same
          // person may be on one of them and not the next.
          //
          // Only the people this action is *adding*. Reading it off the patch
          // would also pick up somebody assigned long ago who has since left
          // the project team, and quietly put them back into it — removing an
          // assignee is not the moment to grant anybody access.
          //
          // This used to grant the access instead of refusing it, for an owner
          // or an admin. A selection spans projects, so the one checkbox that
          // could authorise it here would read «додати цю людину до кожного
          // проєкту у виділенні» — a broader grant than anybody means to make
          // from a toolbar. The single-task composer is where that decision has
          // a project to name, so this says which project refused and stops.
          const outsideProject = valueMemberships
            ? assigneesOutsideProject(freshProject, valueMemberships, uid => valueRoles.get(uid) ?? null)
            : [];
          if (outsideProject.length) {
            throw new Error(`У проєкті «${freshProject?.name || issue.projectId}» цей виконавець не входить до складу проєкту — додайте його на вкладці «Команда»`);
          }
          const now = FieldValue.serverTimestamp();
          transaction.update(issueRef, {
            ...patch,
            updatedAt: now,
            lastActivityType: `bulk_${actionId}`,
            lastActivityAt: now,
            lastActivityActorId: authorization.user.uid,
            lastActivityActorName: authorization.user.name || authorization.user.email || '',
            lastActivityActorAvatar: authorization.user.picture || null,
          });
          // The project's `updatedAt` is deliberately NOT written here. Every
          // task in a selection usually belongs to the same project, so this
          // line made eight concurrent transactions all write the same document
          // — they conflicted, retried with backoff, and serialised the whole
          // operation behind one hot row. It is written once per project after
          // the loop instead, which is the same fact stated once.
          transaction.create(issueRef.collection('audit').doc(), {
            userId: authorization.user.uid,
            userName: authorization.user.name || authorization.user.email || '',
            action: `bulk_${actionId}`,
            from: JSON.stringify(Object.fromEntries(Object.keys(patch).map(key => [key, fresh[key] ?? null]))),
            to: JSON.stringify(patch),
            createdAt: now,
          });
        });
        // A deadline is the one attribute a counter depends on: everything else
        // this branch can write — assignees, labels, priority, type, estimate,
        // sprint — leaves a task exactly as countable as it was. Accumulated
        // after the transaction rather than inside it, so a retry cannot count
        // the same move twice.
        if (patch && patch.dueDate !== undefined) {
          countDeltas.change(freshIssue, { ...freshIssue, ...patch });
        }
        // A bulk deadline or a change of assignee moves the same reminders a
        // single edit would, so it writes the same rows. The patched task is
        // handed over rather than read back — the transaction above already
        // holds every field a deadline candidate looks at.
        if (patch && (patch.dueDate !== undefined || patch.assigneeIds !== undefined)) {
          await syncIssueReminderRows({
            issueId: issue.id,
            issue: { ...freshIssue, ...patch, id: issue.id },
          }).catch(error => console.warn('[issue-bulk] reminder rows failed:', error.message));
        }
        return {
          id: issue.id,
          patch,
          notice: noticeForAction({
            issue: freshIssue,
            nextIssue: { ...freshIssue, ...patch },
            actionId,
            organizationId,
            actorId: authorization.user.uid,
          }),
        };
      } catch (error) {
        return { id: issue.id, error: String(error?.message || error || 'Невідома помилка') };
      }
    });

    const updated = results.filter(result => !result.error);
    const failed = results.filter(result => result.error).map(result => ({ id: result.id, reason: result.error }));

    // One touch per project the operation actually changed, not one per task.
    const touchedProjectIds = [...new Set(
      updated
        .map(result => issues.find(issue => issue.id === result.id)?.projectId)
        .filter(Boolean),
    )];
    // A project whose counters moved but whose tasks were all delegated
    // elsewhere is already touched by the route that handled them; this only
    // has to cover the projects this loop wrote to itself.
    const countedProjectIds = countDeltas.changed().map(entry => entry.projectId);
    const projectIdsToWrite = [...new Set([...touchedProjectIds, ...countedProjectIds])];
    if (projectIdsToWrite.length) {
      const touch = db.batch();
      for (const id of projectIdsToWrite) {
        touch.update(db.collection('projects').doc(id), {
          updatedAt: FieldValue.serverTimestamp(),
          ...projectIssueCountIncrements(countDeltas, id),
        });
      }
      await touch.commit().catch(error => console.warn('[issue-bulk] project touch failed:', error.message));
    }

    // One delivery pass for the whole operation: a row in the bell per task, a
    // single digest per person on email and Telegram.
    const notices = updated.map(result => result.notice).filter(Boolean);
    if (notices.length) {
      await deliverBulkNotifications({
        organizationId,
        actor: {
          uid: authorization.user.uid,
          name: authorization.user.name || authorization.user.email || '',
          avatar: authorization.user.picture || '',
        },
        events: notices,
        digestTitle: actionId === 'status' ? 'Змінено статус задач' : 'Вас призначено відповідальним',
      }).catch(error => console.warn('[issue-bulk] notification delivery failed:', error.message));
    }

    return NextResponse.json({
      requested: issueIds.length,
      // `notice` is server-side routing data — it names the recipients of the
      // notification — and has no business travelling back to the browser.
      updated: updated.map(({ notice, ...result }) => result),
      failed,
      summary: `Оновлено ${updated.length} із ${issueIds.length}`,
    });
  } catch (error) {
    return routeErrorResponse(error, { context: 'Issue bulk POST', fallbackMessage: 'Не вдалося виконати масову операцію' });
  }
}
