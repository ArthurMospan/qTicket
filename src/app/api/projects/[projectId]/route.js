import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import { introducedIssueExecutionViolations } from '@/lib/utils/issueStatusTransition.mjs';
import { rolesFor } from '@/lib/utils/can';
import {
  DEFAULT_STATUS_IDS,
  resolveClosedStatusIds,
  resolveEntryStatusId,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';
import {
  isValidIssuePrefix,
  projectIssuePrefix,
  suggestAvailableIssuePrefix,
} from '@/lib/utils/issueKeys.mjs';
import { recordIssueHistory } from '@/lib/server/issueHistory.mjs';

const MAX_PROJECT_SETTINGS_TRANSACTION_WRITES = 450;

function projectTransactionError(code, status, message, details = {}) {
  const error = new Error(code);
  error.projectApi = { code, status, message, ...details };
  return error;
}

// Editing a client space and deleting one are two permissions, so each verb
// names its own rather than sharing one list that happens to be identical today.
async function loadAuthorizedProject(request, projectId, allowedRoles) {
  const db = getAdminDb();
  const ref = db.collection('projects').doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Project not found', status: 404 };
  const project = snap.data();
  const authorization = await authorizeOrgRequest(request, project.organizationId, allowedRoles);
  if (authorization.error) return authorization;
  return { db, ref, project, authorization };
}

export async function PATCH(request, context) {
  try {
    const { projectId } = await context.params;
    const loaded = await loadAuthorizedProject(request, projectId, rolesFor('edit:project_settings'));
    if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    const body = await readJsonBody(request);
    const { action } = body;
    if (!['archive', 'restore', 'update-settings'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const { db, ref, project } = loaded;
    // There is no whole-array roster write any more. `update-team` replaced
    // `project.team` with whatever list the caller was holding, which silently
    // undid anything added while their dialog was open — the exact failure
    // `teamBaseline` below exists to prevent. Its one caller was a «Команда»
    // tab that nothing had rendered for some time.
    if (action === 'update-settings') {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!name || name.length > 160 || description.length > 10_000) {
        return NextResponse.json({ error: 'Некоректна назва або опис клієнта' }, { status: 400 });
      }

      if (body.team !== undefined && !Array.isArray(body.team)) {
        return NextResponse.json({ error: 'Некоректний склад команди клієнта' }, { status: 400 });
      }
      if (body.teamBaseline !== undefined && !Array.isArray(body.teamBaseline)) {
        return NextResponse.json({ error: 'Некоректний склад команди клієнта' }, { status: 400 });
      }
      const editsTeam = Array.isArray(body.team);
      const requestedSettingsTeam = editsTeam
        ? [...new Set(body.team.filter(Boolean))].slice(0, 100)
        : (Array.isArray(project.team) ? project.team : []);
      // The list the caller edited was read when their dialog opened. Applying
      // it as-is overwrites everything that happened since — including a person
      // a task added to the project two minutes ago, whom this save never meant
      // to mention. With the baseline the caller edited against, the change can
      // be applied as what it is: these were added, these were removed, and the
      // rest of the roster is none of this save's business.
      const teamBaseline = Array.isArray(body.teamBaseline)
        ? [...new Set(body.teamBaseline.filter(Boolean))]
        : null;
      const teamAdded = teamBaseline
        ? requestedSettingsTeam.filter(userId => !teamBaseline.includes(userId))
        : [];
      const teamRemoved = teamBaseline
        ? teamBaseline.filter(userId => !requestedSettingsTeam.includes(userId))
        : [];
      // Only the people this save is putting on the project have to be checked;
      // everybody already on it was checked when they were put there.
      const introducedMembers = teamBaseline ? teamAdded : requestedSettingsTeam;
      if (introducedMembers.length > 0) {
        const memberships = await db.getAll(...introducedMembers.map(
          userId => db.collection('orgMemberships').doc(`${project.organizationId}_${userId}`),
        ));
        if (memberships.some(
          (membership, index) => !membership.exists || membership.data().userId !== introducedMembers[index],
        )) {
          return NextResponse.json(
            { error: 'У команді може бути лише учасник організації' },
            { status: 400 },
          );
        }
      }

      const workflowRef = db.collection('organizations')
        .doc(project.organizationId)
        .collection('settings')
        .doc('workflow');
      const requestedHidden = Array.isArray(body.hiddenColumns)
        ? [...new Set(body.hiddenColumns.filter(value => typeof value === 'string'))]
        : [];
      const countDeltas = await projectIssueCountDeltasFor(db, project.organizationId);
      const settingsResult = await db.runTransaction(async transaction => {
        // Firestore re-runs this body on contention; the counter accumulator
        // lives outside it and would otherwise count the same move once per
        // attempt.
        countDeltas.reset();
        const freshProject = await transaction.get(ref);
        const workflowSnap = await transaction.get(workflowRef);
        if (
          !freshProject.exists
          || freshProject.data().organizationId !== project.organizationId
        ) {
          throw projectTransactionError(
            'PROJECT_NOT_FOUND',
            404,
            'Клієнта не знайдено',
          );
        }
        if (freshProject.data().deletionPending === true) {
          throw projectTransactionError(
            'PROJECT_DELETING',
            409,
            'Проєкт уже видаляється',
          );
        }
        const currentProject = freshProject.data();
        // Resolved against the document as it is now, not as the dialog last
        // saw it. Without a baseline there is no change to apply, only a list —
        // an older client, and the old behaviour it expects.
        const freshTeam = Array.isArray(currentProject.team) ? currentProject.team : [];
        const resolvedTeamBase = !editsTeam
          ? freshTeam
          : (teamBaseline
            ? [...new Set([...freshTeam, ...teamAdded])].filter(userId => !teamRemoved.includes(userId))
            : requestedSettingsTeam);
        // The person who made the project can always reach it, whatever a save
        // says: dropping them is how a project ends up with no way in.
        const resolvedTeam = project.createdBy && !resolvedTeamBase.includes(project.createdBy)
          ? [project.createdBy, ...resolvedTeamBase]
          : resolvedTeamBase;
        const hasPersistedIssuePrefix = isValidIssuePrefix(currentProject.issuePrefix);
        let resolvedIssuePrefix = projectIssuePrefix(currentProject);
        if (!hasPersistedIssuePrefix) {
          const projectsSnapshot = await transaction.get(
            db.collection('projects')
              .where('organizationId', '==', project.organizationId),
          );
          const organizationProjects = projectsSnapshot.docs.map(document => ({
            ...document.data(),
            id: document.id,
          }));
          resolvedIssuePrefix = suggestAvailableIssuePrefix(
            { name },
            organizationProjects,
            projectId,
          );
        }

        const workflow = workflowSnap.data() || {};
        const statusIds = workflowIds(workflow.statuses, DEFAULT_STATUS_IDS);
        // Where the tasks of a newly hidden column go. The category answers it,
        // so a project whose workflow has no column literally called 'backlog'
        // no longer falls back to whatever happens to be first in the list.
        const backlogStatusId = resolveEntryStatusId(workflow.statuses);
        if (
          requestedHidden.some(statusId => !statusIds.includes(statusId))
          || requestedHidden.includes(backlogStatusId)
          || requestedHidden.length >= statusIds.length
        ) {
          throw projectTransactionError(
            'INVALID_HIDDEN_COLUMNS',
            400,
            'Некоректна конфігурація колонок',
          );
        }

        const issuesSnapshot = requestedHidden.length
          ? await transaction.get(
            db.collection('issues')
              .where('organizationId', '==', project.organizationId)
              .where('projectId', '==', projectId),
          )
          : null;
        const currentIssues = issuesSnapshot
          ? issuesSnapshot.docs.map(document => ({
            ...document.data(),
            id: document.id,
          }))
          : [];
        const issueIdsToMove = new Set(
          currentIssues
            .filter(issue => (
              issue.deletionPending !== true
              && requestedHidden.includes(issue.columnId || issue.status)
            ))
            .map(issue => issue.id),
        );
        const nextIssues = currentIssues.map(issue => (
          issueIdsToMove.has(issue.id)
            ? { ...issue, columnId: backlogStatusId, status: backlogStatusId }
            : issue
        ));

        let scopedLinks = [];
        if (issueIdsToMove.size > 0) {
          const linksSnapshot = await transaction.get(
            db.collection('issueLinks')
              .where('organizationId', '==', project.organizationId),
          );
          const projectIssueIds = new Set(currentIssues.map(issue => issue.id));
          scopedLinks = linksSnapshot.docs
            .map(document => ({ ...document.data(), id: document.id }))
            .filter(link => (
              projectIssueIds.has(link.sourceIssueId)
              && projectIssueIds.has(link.targetIssueId)
            ));
        }
        const closedStatusIds = resolveClosedStatusIds(workflow.statuses);
        const violations = introducedIssueExecutionViolations({
          currentIssues,
          nextIssues,
          issueLinks: scopedLinks,
          currentClosedStatusIds: closedStatusIds,
          nextClosedStatusIds: closedStatusIds,
        });
        if (violations.length > 0) {
          throw projectTransactionError(
            'HIDDEN_COLUMN_EXECUTION_CONFLICT',
            409,
            'Не можна приховати колонку: перенесення звернень порушить ієрархію або залежності',
            {
              violationCount: violations.length,
              violations: violations.slice(0, 50),
            },
          );
        }
        const plannedWrites = issueIdsToMove.size * 2 + 1;
        if (plannedWrites > MAX_PROJECT_SETTINGS_TRANSACTION_WRITES) {
          throw projectTransactionError(
            'HIDDEN_COLUMN_MIGRATION_TOO_LARGE',
            409,
            'Забагато звернень для однієї безпечної зміни колонок',
            {
              affectedIssues: issueIdsToMove.size,
              maxTransactionWrites: MAX_PROJECT_SETTINGS_TRANSACTION_WRITES,
            },
          );
        }

        const closedSet = new Set(closedStatusIds);
        const now = FieldValue.serverTimestamp();
        countDeltas.observeProject(projectId, freshProject.data());
        for (const issue of currentIssues.filter(item => issueIdsToMove.has(item.id))) {
          const issueRef = db.collection('issues').doc(issue.id);
          const wasClosed = closedSet.has(issue.columnId || issue.status);
          const willBeClosed = closedSet.has(backlogStatusId);
          // Hiding a column moves every task out of it, which is a status change
          // like any other — a delivered task landing in the backlog stops being
          // delivered, and one that had slipped its deadline becomes late again.
          // The counters have to move with it, or the home screen keeps drawing
          // the board that was here before.
          countDeltas.change(
            issue,
            { ...issue, columnId: backlogStatusId, status: backlogStatusId },
          );
          transaction.update(issueRef, {
            columnId: backlogStatusId,
            status: backlogStatusId,
            updatedAt: now,
            ...(willBeClosed && !issue.completedAt
              ? { completedAt: now }
              : {}),
            ...(!willBeClosed && Object.prototype.hasOwnProperty.call(issue, 'completedAt')
              ? { completedAt: FieldValue.delete() }
              : {}),
          });
          recordIssueHistory(transaction, issueRef, {
            userId: loaded.authorization.user.uid,
            userName: loaded.authorization.user.name
              || loaded.authorization.user.email
              || '',
            action: 'hidden-column-migrated',
            from: issue.columnId || issue.status || null,
            to: backlogStatusId,
            fromCompleted: wasClosed,
            toCompleted: willBeClosed,
            createdAt: now,
          });
        }
        transaction.update(ref, {
          name,
          description,
          issuePrefix: resolvedIssuePrefix,
          hiddenColumns: requestedHidden,
          team: resolvedTeam,
          issueStatusVersion: FieldValue.increment(1),
          ...projectIssueCountIncrements(countDeltas, projectId),
          updatedAt: now,
        });
        return {
          hiddenColumns: requestedHidden,
          movedIssues: issueIdsToMove.size,
          issuePrefix: resolvedIssuePrefix,
          team: resolvedTeam,
        };
      });
      return NextResponse.json({
        success: true,
        hiddenColumns: settingsResult.hiddenColumns,
        team: settingsResult.team,
        movedIssues: settingsResult.movedIssues,
        issuePrefix: settingsResult.issuePrefix,
      });
    }

    const orgRef = db.collection('organizations').doc(project.organizationId);
    await db.runTransaction(async transaction => {
      const [freshProject, orgSnap] = await Promise.all([transaction.get(ref), transaction.get(orgRef)]);
      if (!freshProject.exists || !orgSnap.exists) throw new Error('NOT_FOUND');
      transaction.update(ref, {
        status: action === 'archive' ? 'archived' : 'active',
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(orgRef, { projectMutationVersion: FieldValue.increment(1) });
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.projectApi) {
      const { message, status, ...details } = error.projectApi;
      return NextResponse.json({
        error: message,
        ...details,
      }, { status });
    }
    return routeErrorResponse(error, { context: 'Project PATCH', fallbackMessage: 'Internal Server Error' });
  }
}

export async function DELETE(request, context) {
  try {
    const { projectId } = await context.params;
    const loaded = await loadAuthorizedProject(request, projectId, rolesFor('delete:project'));
    if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    const { db, ref, project } = loaded;

    // The project lock: the deletion marker is what closes every later creation
    // path, and it is set inside a transaction so a write already in flight
    // either lands before it or fails against it.
    await db.runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (
        !current.exists
        || current.data().organizationId !== project.organizationId
      ) {
        throw new Error('NOT_FOUND');
      }

      if (current.data().deletionPending !== true) {
        transaction.update(ref, {
          deletionPending: true,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    const [
      issues,
      timeLogs,
      orgLinks,
    ] = await Promise.all([
      db.collection('issues').where('organizationId', '==', project.organizationId).where('projectId', '==', projectId).get(),
      db.collection('timeLogs').where('organizationId', '==', project.organizationId).where('projectId', '==', projectId).get(),
      db.collection('issueLinks').where('organizationId', '==', project.organizationId).get(),
    ]);
    const issueIds = new Set(issues.docs.map(document => document.id));
    const simpleRefs = [
      ...timeLogs.docs.map(document => document.ref),
      ...orgLinks.docs
        .filter(document => issueIds.has(document.data().sourceIssueId) || issueIds.has(document.data().targetIssueId))
        .map(document => document.ref),
    ];
    for (let offset = 0; offset < simpleRefs.length; offset += 400) {
      const batch = db.batch();
      simpleRefs.slice(offset, offset + 400).forEach(documentRef => batch.delete(documentRef));
      await batch.commit();
    }
    for (const issue of issues.docs) await db.recursiveDelete(issue.ref);

    await db.collection('organizations').doc(project.organizationId).update({
      projectMutationVersion: FieldValue.increment(1),
    });
    await db.recursiveDelete(ref);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.projectApi) {
      const { message, status, ...details } = error.projectApi;
      return NextResponse.json({ error: message, ...details }, { status });
    }
    return routeErrorResponse(error, { context: 'Project DELETE', fallbackMessage: 'Internal Server Error' });
  }
}
