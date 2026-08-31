import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, enforceRateLimit, getAdminDb } from '@/lib/server/firebaseAdmin';
import { syncIssueReminderRows } from '@/lib/server/reminderJobs';
import { announceIncidentCreated } from '@/lib/server/incidentAnnouncement';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { isValidIssuePrefix } from '@/lib/utils/issueKeys.mjs';
import { isClientRole, rolesFor } from '@/lib/utils/can';
import { assigneesOffProjectTeam, assigneesOutsideProject } from '@/lib/utils/projectAccess.mjs';
import { resolveProjectIssuePrefixInTransaction } from '@/lib/server/issueKeys';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import {
  DEFAULT_LABEL_IDS,
  DEFAULT_PRIORITY_IDS,
  DEFAULT_STATUS_IDS,
  DEFAULT_TYPE_IDS,
  resolveClosedStatusIds,
  resolveEntryStatusId,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';
import {
  normalizeParentIssueId,
  validateIssueParentAssignment,
} from '@/lib/utils/issueHierarchyModel.mjs';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import { resolveNewIssueType } from '@/lib/utils/issueCreationModel.mjs';
import { NO_PRIORITY_ID } from '@/lib/utils/priorities.mjs';
import { issueParentStatusConflict } from '@/lib/utils/issueStatusTransition.mjs';

function normalizedDate(value) {
  if (value == null || value === '') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? Timestamp.fromDate(date) : undefined;
}

function hierarchyTransactionError(details) {
  const error = new Error(details.code);
  error.hierarchy = details;
  return error;
}

export async function POST(request) {
  try {
    let body;
    try {
      body = await readJsonBody(request);
    } catch {
      return NextResponse.json({
        error: 'Тіло запиту має бути коректним JSON',
        code: 'INVALID_JSON',
      }, { status: 400 });
    }
    const {
      organizationId: rawOrganizationId,
      projectId: rawProjectId,
      data: rawData,
    } = body || {};
    const organizationId = typeof rawOrganizationId === 'string'
      ? rawOrganizationId.trim()
      : '';
    const projectId = typeof rawProjectId === 'string' ? rawProjectId.trim() : '';
    const submittedData = rawData && typeof rawData === 'object' && !Array.isArray(rawData)
      ? rawData
      : {};
    if (
      !organizationId
      || organizationId.length > 256
      || !projectId
      || projectId.length > 256
    ) {
      return NextResponse.json({
        error: 'Потрібні коректні організація та клієнтський простір',
        code: 'INVALID_SCOPE',
      }, { status: 400 });
    }
    const authorization = await authorizeOrgRequest(request, organizationId, rolesFor('create:issue'));
    if (authorization.error) {
      return NextResponse.json({
        error: localizedIssueAuthorizationMessage(authorization.error),
      }, { status: authorization.status });
    }
    const clientAuthor = isClientRole(authorization.membership?.role);
    // External clients describe an incident; the support workflow classifies
    // and routes it. This projection is the server boundary behind the simple
    // client composer: hand-crafted requests cannot pick a status, priority,
    // assignee, sprint, parent, deadline, labels or estimate during creation.
    const data = clientAuthor
      ? {
          title: submittedData.title,
          description: submittedData.description,
        }
      : submittedData;
    if (!projectId || typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 240) {
      // Shown verbatim to whoever posted it, and an external client posts here
      // too, so it names the record the way every other screen does.
      return NextResponse.json({ error: 'Потрібні коректний клієнтський простір і тема' }, { status: 400 });
    }
    if (data.parentEpicId) {
      return NextResponse.json({
        error: 'Поле parentEpicId застаріло. Використовуйте parentIssueId',
        code: 'LEGACY_PARENT_FIELD',
      }, { status: 400 });
    }
    if (Array.isArray(data.subtasks) && data.subtasks.length > 0) {
      return NextResponse.json({
        error: 'Вкладені пункти треба додавати як чекліст в описі або як окремі дочірні звернення',
        code: 'LEGACY_SUBTASKS_UNSUPPORTED',
      }, { status: 400 });
    }
    if (data.type === 'epic') {
      return NextResponse.json({
        error: 'Цей тип застарілий і недоступний для нових звернень',
        code: 'LEGACY_EPIC_TYPE',
      }, { status: 400 });
    }

    const parentIssueId = normalizeParentIssueId(data.parentIssueId);
    let parentIssueKey = '';
    if (parentIssueId === undefined) {
      return NextResponse.json({
        error: 'Некоректний ідентифікатор основного звернення',
        code: 'INVALID_PARENT_ID',
      }, { status: 400 });
    }

    const dueDate = normalizedDate(data.dueDate);
    if (dueDate === undefined) {
      return NextResponse.json({ error: 'Некоректний дедлайн' }, { status: 400 });
    }
    // Invalid form submissions do not consume the creation budget. The limit
    // still protects every request that has a valid body and could reach the
    // project/workflow reads below: 60 attempts per user per 60 seconds.
    if (!(await enforceRateLimit('issue-create', authorization.user.uid, 60, 60))) {
      return NextResponse.json({
        error: 'Забагато запитів на створення',
        code: 'RATE_LIMITED',
      }, { status: 429 });
    }

    const db = getAdminDb();
    const projectRef = db.collection('projects').doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists || projectSnap.data().organizationId !== organizationId) {
      return NextResponse.json({
        error: 'Клієнтський простір не належить цій організації',
        code: 'INVALID_PROJECT_SCOPE',
      }, { status: 400 });
    }
    const projectData = projectSnap.data();

    // Per-project access: a plain member may only create tasks in projects they
    // belong to. Owners/admins can create in any project of the org. This is the
    // server-side counterpart to the team-gated `projects` read rule — without it
    // a member could POST an issue into a project they can't even see.
    const role = authorization.membership?.role;
    const isPrivileged = role === 'owner' || role === 'admin';
    const projectTeam = projectData.team;
    if (!isPrivileged && !(Array.isArray(projectTeam) && projectTeam.includes(authorization.user.uid))) {
      return NextResponse.json({ error: 'Ви не входите до команди цього клієнтського простору' }, { status: 403 });
    }
    const assigneeIds = Array.isArray(data.assigneeIds) ? [...new Set(data.assigneeIds)].slice(0, 20) : [];
    // Adding somebody to a project is a thing the caller asks for, never a side
    // effect of assigning them work. The first version of this rule did it
    // silently, in the same write, on the strength of a 10px line in the
    // composer — and the owner who triggered it did not know he had.
    const addAssigneesToProjectTeam = data.addAssigneesToProjectTeam === true;
    // Being in the organization was the only thing ever asked of an assignee,
    // and it is not enough: `project.team` is what opens a project, so a task
    // could be handed to somebody who could not open the project it was in.
    // They then had a task in «Звернення» whose project 404'd for them, and
    // a card on a board that dropped their face because the board resolves
    // faces from the team they were not in.
    let assigneesToAddToTeam = [];
    if (assigneeIds.length) {
      const refs = assigneeIds.map(uid => db.collection('orgMemberships').doc(`${organizationId}_${uid}`));
      const memberships = await db.getAll(...refs);
      if (memberships.some((snap, index) => !snap.exists || snap.data().userId !== assigneeIds[index])) {
        return NextResponse.json({ error: 'Виконавець не є учасником організації' }, { status: 400 });
      }
      const roleByUid = new Map(assigneeIds.map((uid, index) => [uid, memberships[index].data().role || null]));
      // Two different questions, and the answers are two different sets. Who
      // cannot open the project decides whether this request may proceed at
      // all; who is missing from the roster decides what a granted request
      // writes — an admin is in the second set and not the first, which is why
      // assigning one used to leave no trace on the project.
      const lockedOut = assigneesOutsideProject(projectData, assigneeIds, uid => roleByUid.get(uid) || null);
      const offRoster = assigneesOffProjectTeam(projectData, assigneeIds);
      // Granting project access is `manage:team`, which a member does not hold.
      // For them the assignment is refused rather than performed half-way; the
      // composer does not offer these people to a member in the first place, so
      // this is the server saying the same thing the screen already said.
      if (lockedOut.length && (!isPrivileged || !addAssigneesToProjectTeam)) {
        return NextResponse.json({
          error: isPrivileged
            ? 'Виконавець не входить до складу клієнта. Позначте «Додати до складу», щоб додати його разом зі створенням звернення.'
            : 'Виконавець не входить до складу клієнта. Попросіть власника або адміністратора додати його.',
          code: 'ASSIGNEE_OUTSIDE_PROJECT',
        }, { status: 403 });
      }
      // An owner or an admin who is merely off the roster is not blocking
      // anything — the task is created either way, and the roster is written
      // only because the caller asked for it.
      if (addAssigneesToProjectTeam && !isPrivileged) {
        return NextResponse.json({
          error: 'Додавати учасників до складу клієнта може лише власник або адміністратор',
          code: 'PROJECT_TEAM_FORBIDDEN',
        }, { status: 403 });
      }
      if (addAssigneesToProjectTeam) assigneesToAddToTeam = offRoster;
    }

    const workflowRef = db.collection('organizations').doc(organizationId)
      .collection('settings').doc('workflow');
    const workflowSnap = await workflowRef.get();
    const workflow = workflowSnap.data() || {};
    const statusIds = workflowIds(workflow.statuses, DEFAULT_STATUS_IDS);
    const typeSelection = resolveNewIssueType(
      data.type,
      workflowIds(workflow.types, DEFAULT_TYPE_IDS),
    );
    if (typeSelection.error) {
      return NextResponse.json({
        error: typeSelection.error.message,
        code: typeSelection.error.code,
      }, { status: typeSelection.error.status });
    }
    const requestedStatus = typeof data.status === 'string' ? data.status : null;
    if (requestedStatus && !statusIds.includes(requestedStatus)) {
      return NextResponse.json({ error: 'Некоректний статус процесу' }, { status: 400 });
    }
    const issueRef = db.collection('issues').doc();
    let issueKey;
    // Read back out of the transaction so the reminder row below can be written
    // from what was stored, without a second read of the task.
    let createdStatus;
    const countDeltas = await projectIssueCountDeltasFor(db, organizationId);

    await db.runTransaction(async transaction => {
      // Firestore re-runs this body on contention; the counter accumulator
      // lives outside it and would otherwise add the same task once per attempt.
      countDeltas.reset();
      const freshProjectSnap = await transaction.get(projectRef);
      const freshWorkflowSnap = await transaction.get(workflowRef);
      if (!freshProjectSnap.exists || freshProjectSnap.data().organizationId !== organizationId) {
        throw new Error('PROJECT_NOT_FOUND');
      }
      const project = freshProjectSnap.data();
      if (project.deletionPending === true) {
        throw hierarchyTransactionError({
          code: 'PROJECT_DELETING',
          status: 409,
          message: 'Клієнтський простір уже видаляється',
        });
      }
      const freshWorkflow = freshWorkflowSnap.data() || {};
      const freshStatusIds = workflowIds(
        freshWorkflow.statuses,
        DEFAULT_STATUS_IDS,
      );
      const entryStatusId = resolveEntryStatusId(
        freshWorkflow.statuses,
        project.hiddenColumns,
      );
      const statusCandidate = requestedStatus || entryStatusId;
      if (!freshStatusIds.includes(statusCandidate)) {
        throw hierarchyTransactionError({
          code: 'INVALID_WORKFLOW_STATUS',
          status: 400,
          message: 'Статус не належить до поточного workflow',
        });
      }
      const status = (project.hiddenColumns || []).includes(statusCandidate)
        ? entryStatusId
        : statusCandidate;
      createdStatus = status;
      const closedIds = resolveClosedStatusIds(freshWorkflow.statuses);
      const freshPriorityIds = new Set(workflowIds(
        freshWorkflow.priorities,
        DEFAULT_PRIORITY_IDS,
      ));
      freshPriorityIds.add(NO_PRIORITY_ID);
      const freshTypeSelection = resolveNewIssueType(
        data.type,
        workflowIds(freshWorkflow.types, DEFAULT_TYPE_IDS),
      );
      if (freshTypeSelection.error) {
        throw hierarchyTransactionError(freshTypeSelection.error);
      }
      const freshLabelIds = new Set(workflowIds(
        freshWorkflow.labels,
        DEFAULT_LABEL_IDS,
      ));
      if (parentIssueId) {
        const parentSnap = await transaction.get(db.collection('issues').doc(parentIssueId));
        const parent = parentSnap.exists
          ? { ...parentSnap.data(), id: parentSnap.id }
          : null;
        parentIssueKey = parent?.issueKey || '';
        const hierarchyError = validateIssueParentAssignment({
          issueId: issueRef.id,
          issue: {
            id: issueRef.id,
            organizationId,
            projectId,
            deletionPending: false,
            columnId: status,
            status,
          },
          requestedParentIssueId: parentIssueId,
          parent,
          childIds: [],
        });
        if (hierarchyError) throw hierarchyTransactionError(hierarchyError);
        const statusConflict = issueParentStatusConflict({
          issue: {
            id: issueRef.id,
            organizationId,
            projectId,
            columnId: status,
            status,
          },
          parentIssue: parent,
          closedStatusIds: closedIds,
        });
        if (statusConflict) throw hierarchyTransactionError(statusConflict);
      }
      const next = (project.issueCounter || 0) + 1;
      const issuePrefix = await resolveProjectIssuePrefixInTransaction({
        db,
        transaction,
        project,
        projectId,
        organizationId: project.organizationId,
      });
      issueKey = `${issuePrefix}-${next}`;
      const now = FieldValue.serverTimestamp();
      const payload = {
        issueKey,
        organizationId,
        projectId,
        title: data.title.trim(),
        description: typeof data.description === 'string' ? data.description.slice(0, 50_000) : '',
        columnId: status,
        status,
        // Nothing said about priority means no priority, not «Середній».
        // Defaulting to the middle of the scale is not a neutral choice — it is
        // a claim, made on the author's behalf, about work nobody has ranked
        // yet, and it made «Середній» the most common priority in the workspace
        // by a wide margin while meaning nothing at all. `none` is a real,
        // selectable value that every reader already understands
        // (`priorityPresentation`), so it is what an unranked task gets.
        priority: freshPriorityIds.has(data.priority) ? data.priority : NO_PRIORITY_ID,
        type: freshTypeSelection.type,
        assigneeIds,
        labelIds: Array.isArray(data.labelIds)
          ? data.labelIds.filter(id => freshLabelIds.has(id)).slice(0, 20)
          : [],
        dueDate,
        reporterId: authorization.user.uid,
        parentIssueId,
        // Denormalised for the same reason a mention carries its task's title:
        // the writer knows it, the reader would otherwise have to go looking,
        // and «looking» means a card guessing from whatever is on screen.
        ...(parentIssueKey ? { parentIssueKey } : {}),
        watcherIds: [],
        order: -next,
        createdBy: authorization.user.uid,
        createdAt: now,
        updatedAt: now,
        lastActivityType: 'created',
        lastActivityAt: now,
        lastActivityActorId: authorization.user.uid,
        lastActivityActorName: authorization.user.name || authorization.user.email || '',
        lastActivityActorAvatar: authorization.user.picture || null,
        ...(closedIds.includes(status) ? { completedAt: now } : {}),
      };
      transaction.create(issueRef, payload);
      // The project's task counters, so the home screen can draw a progress bar
      // from one document instead of from every task in the workspace. Measured
      // against the day the stored figures answer for, which is why the project
      // document is handed over — see `src/lib/utils/projectIssueCounts.mjs`.
      countDeltas
        .observeProject(projectId, project)
        .change(null, { ...payload, projectId, id: issueRef.id });
      transaction.update(projectRef, {
        issueCounter: next,
        ...projectIssueCountIncrements(countDeltas, projectId),
        ...(!isValidIssuePrefix(project.issuePrefix) ? { issuePrefix } : {}),
        // Only ever populated when the request explicitly asked to add these
        // people to the project — see `addAssigneesToProjectTeam` above. The
        // audit entry below records who did it, because a change to a project's
        // roster that leaves no trace is how the owner ends up not knowing.
        ...(assigneesToAddToTeam.length ? { team: FieldValue.arrayUnion(...assigneesToAddToTeam) } : {}),
        updatedAt: now,
        ...(parentIssueId
          ? { issueHierarchyVersion: FieldValue.increment(1) }
          : {}),
      });
      transaction.create(issueRef.collection('audit').doc(), {
        userId: authorization.user.uid,
        userName: authorization.user.name || authorization.user.email || '',
        action: 'created',
        from: null,
        to: issueKey,
        createdAt: now,
      });
      // A project's roster changed, and the task that changed it is the only
      // place the two facts meet. Without this line the whole record of "who
      // put this person on the project" is the project document itself, which
      // remembers the members but not the moment.
      if (assigneesToAddToTeam.length) {
        transaction.create(issueRef.collection('audit').doc(), {
          userId: authorization.user.uid,
          userName: authorization.user.name || authorization.user.email || '',
          action: 'project-team-granted',
          from: null,
          to: assigneesToAddToTeam,
          createdAt: now,
        });
      }
    });

    // The payload above is everything a deadline candidate reads, so the queue
    // row is written without reading the task back.
    if (dueDate && assigneeIds.length) {
      await syncIssueReminderRows({
        issueId: issueRef.id,
        issue: {
          id: issueRef.id,
          organizationId,
          projectId,
          issueKey,
          title: data.title.trim(),
          dueDate,
          assigneeIds,
          columnId: createdStatus,
          status: createdStatus,
        },
      }).catch(error => console.warn('[issues POST] reminder rows failed:', error.message));
    }

    // The one event this product exists to react to. `notifyIssueAssigned` on
    // the browser side covers "somebody handed you this", whose audience is the
    // new task's assignees — and a customer's request has none, because only a
    // client opens one and support picks it up afterwards. So creation told
    // nobody anything, and a request filed at midnight waited for somebody to
    // open the queue and notice an unread dot.
    //
    // It is said here rather than by the composer because the recipients are the
    // tenant's internal staff, and the customer's browser is exactly the place
    // that may not enumerate them.
    announceIncidentCreated({
      organizationId,
      projectId,
      projectName: projectData.name || '',
      projectTeam: Array.isArray(projectData.team) ? projectData.team : [],
      issueId: issueRef.id,
      issueKey,
      title: data.title.trim(),
      actor: {
        uid: authorization.user.uid,
        name: authorization.user.name || authorization.user.email || '',
      },
    }).catch(error => console.warn('[issues POST] incident announcement failed:', error.message));

    return NextResponse.json({ id: issueRef.id, issueKey }, { status: 201 });
  } catch (error) {
    if (error?.hierarchy) {
      return NextResponse.json({
        error: error.hierarchy.message,
        code: error.hierarchy.code,
        ...(error.hierarchy.childCount ? { childCount: error.hierarchy.childCount } : {}),
      }, { status: error.hierarchy.status });
    }
    if (error?.message === 'PROJECT_NOT_FOUND') {
      return NextResponse.json({ error: 'Клієнтський простір не знайдено', code: 'PROJECT_NOT_FOUND' }, { status: 404 });
    }
    return routeErrorResponse(error, {
      context: 'Issue POST',
      // The composer already names the record in its own title. This is the
      // sentence under it, so it says what went wrong and names nothing.
      fallbackMessage: 'Не вдалося зберегти. Спробуйте ще раз',
    });
  }
}
