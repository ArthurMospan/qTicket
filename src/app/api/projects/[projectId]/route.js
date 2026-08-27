import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { authorizeOrgRequest, getAdminDb } from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { deleteProjectAnalyticsRollups } from '@/lib/server/analyticsRollups';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';
import {
  organizationPlan,
  recordPlanUsage,
  resyncProjectsOverPlanLimit,
} from '@/lib/server/planLimits';
import { normalizePlan, planLimit, planLimitRefusal } from '@/lib/utils/plans.mjs';
import { introducedIssueExecutionViolations } from '@/lib/utils/issueStatusTransition.mjs';
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

const MAX_PROJECT_SETTINGS_TRANSACTION_WRITES = 450;

function projectTransactionError(code, status, message, details = {}) {
  const error = new Error(code);
  error.projectApi = { code, status, message, ...details };
  return error;
}

async function loadAuthorizedProject(request, projectId) {
  const db = getAdminDb();
  const ref = db.collection('projects').doc(projectId);
  const snap = await ref.get();
  if (!snap.exists) return { error: 'Project not found', status: 404 };
  const project = snap.data();
  const authorization = await authorizeOrgRequest(request, project.organizationId, ['owner', 'admin']);
  if (authorization.error) return authorization;
  return { db, ref, project, authorization };
}

export async function PATCH(request, context) {
  // Read inside the transaction and answered in the catch, which cannot see
  // into the try block above it.
  let restoredPlan = '';
  let restoredCount = 0;
  try {
    const { projectId } = await context.params;
    const loaded = await loadAuthorizedProject(request, projectId);
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
        return NextResponse.json({ error: 'Некоректна назва або опис проєкту' }, { status: 400 });
      }

      if (body.team !== undefined && !Array.isArray(body.team)) {
        return NextResponse.json({ error: 'Некоректний склад команди проєкту' }, { status: 400 });
      }
      if (body.teamBaseline !== undefined && !Array.isArray(body.teamBaseline)) {
        return NextResponse.json({ error: 'Некоректний склад команди проєкту' }, { status: 400 });
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
            'Проєкт не знайдено',
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
            'Не можна приховати колонку: перенесення задач порушить ієрархію або залежності',
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
            'Забагато задач для однієї безпечної зміни колонок',
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
          transaction.create(issueRef.collection('audit').doc(), {
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
      restoredPlan = normalizePlan(orgSnap.data().plan);
      // Bringing a project back is creating one as far as the ceiling is
      // concerned, so it asks the same registry the create route asks. It used
      // to read `plan !== 'pro'` with a hardcoded three — the exact bug the
      // create route was fixed for, still living in the other half of the same
      // pair, which is what happens when a ceiling is written twice.
      if (action === 'restore' && freshProject.data().status !== 'active') {
        const activeQuery = db.collection('projects')
          .where('organizationId', '==', project.organizationId)
          .where('status', '==', 'active');
        const activeSnap = await transaction.get(activeQuery);
        restoredCount = activeSnap.size;
        if (activeSnap.size >= planLimit(restoredPlan, 'projects')) {
          throw new Error('PROJECT_LIMIT_REACHED');
        }
      }
      transaction.update(ref, {
        status: action === 'archive' ? 'archived' : 'active',
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(orgRef, { projectMutationVersion: FieldValue.increment(1) });
    });
    // A restore has just counted the active projects for real; an archive knows
    // the count moved but not to what, so it leaves the cache alone rather than
    // guessing — every screen that shows it also holds the project list itself.
    if (action === 'restore' && restoredCount) {
      await recordPlanUsage(db, project.organizationId, { projects: restoredCount + 1 });
    }
    // The set of projects the ceiling has room for just changed. Archiving one
    // on a workspace that is over its plan makes room for one of the ones that
    // went read-only, and nothing else would have noticed: the mark was written
    // by the plan switch, and the plan has not changed.
    await resyncProjectsOverPlanLimit(db, project.organizationId, organizationPlan(await orgRef.get()));
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.projectApi) {
      const { message, status, ...details } = error.projectApi;
      return NextResponse.json({
        error: message,
        ...details,
      }, { status });
    }
    if (error.message === 'PROJECT_LIMIT_REACHED') {
      return NextResponse.json({
        error: planLimitRefusal(restoredPlan, 'projects', restoredCount),
        planLimit: { id: 'projects', plan: restoredPlan, ceiling: planLimit(restoredPlan, 'projects'), used: restoredCount },
      }, { status: 403 });
    }
    return routeErrorResponse(error, { context: 'Project PATCH', fallbackMessage: 'Internal Server Error' });
  }
}

export async function DELETE(request, context) {
  try {
    const { projectId } = await context.params;
    const loaded = await loadAuthorizedProject(request, projectId);
    if (loaded.error) return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    const { db, ref, project } = loaded;

    // Accounting documents are audit evidence, never cascade garbage. The
    // project lock makes this guard conflict with invoice/calendar mutations
    // before the deletion marker closes all later creation paths.
    await db.runTransaction(async transaction => {
      const current = await transaction.get(ref);
      if (
        !current.exists
        || current.data().organizationId !== project.organizationId
      ) {
        throw new Error('NOT_FOUND');
      }

      const scoped = collectionName => db.collection(collectionName)
        .where('organizationId', '==', project.organizationId)
        .where('projectId', '==', projectId)
        .limit(1);
      const [
        invoiceEvidence,
        timeReservations,
        estimateReservations,
        invoiceMarkedLogs,
        billedAtLogs,
        calendarEvents,
      ] = await Promise.all([
        transaction.get(scoped('invoices')),
        transaction.get(scoped('invoiceTimeLogReservations')),
        transaction.get(scoped('invoiceEstimateReservations')),
        transaction.get(
          db.collection('timeLogs')
            .where('organizationId', '==', project.organizationId)
            .where('projectId', '==', projectId)
            .where('invoiceId', '>', '')
            .limit(1),
        ),
        transaction.get(
          db.collection('timeLogs')
            .where('organizationId', '==', project.organizationId)
            .where('projectId', '==', projectId)
            .where(
              'billedAt',
              '>',
              Timestamp.fromMillis(0),
            )
            .limit(1),
        ),
        transaction.get(
          db.collection('calendarEvents')
            .where('organizationId', '==', project.organizationId)
            .where('projectId', '==', projectId)
            .limit(1),
        ),
      ]);
      if (
        !invoiceEvidence.empty
        || !timeReservations.empty
        || !estimateReservations.empty
        || !invoiceMarkedLogs.empty
        || !billedAtLogs.empty
      ) {
        throw projectTransactionError(
          'PROJECT_HAS_ACCOUNTING_EVIDENCE',
          409,
          'Проєкт має рахунки або зафіксований у них час. Архівуйте проєкт; рахунки можна лише анулювати, а облікові докази не видаляються.',
        );
      }
      if (!calendarEvents.empty) {
        throw projectTransactionError(
          'PROJECT_HAS_CALENDAR_EVENTS',
          409,
          'Спочатку перенесіть або видаліть усі календарні події цього проєкту',
          { calendarEventId: calendarEvents.docs[0].id },
        );
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
      stages,
      timeLogs,
      orgLinks,
    ] = await Promise.all([
      db.collection('issues').where('organizationId', '==', project.organizationId).where('projectId', '==', projectId).get(),
      db.collection('stages').where('projectId', '==', projectId).get(),
      db.collection('timeLogs').where('organizationId', '==', project.organizationId).where('projectId', '==', projectId).get(),
      db.collection('issueLinks').where('organizationId', '==', project.organizationId).get(),
    ]);
    const unexpectedBilledLog = timeLogs.docs.find(document => {
      const log = document.data();
      return (
        (typeof log.invoiceId === 'string' && log.invoiceId.trim())
        || log.billedAt
      );
    });
    if (unexpectedBilledLog) {
      await db.runTransaction(async transaction => {
        const current = await transaction.get(ref);
        if (
          current.exists
          && current.data().organizationId === project.organizationId
        ) {
          transaction.update(ref, {
            deletionPending: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
      throw projectTransactionError(
        'PROJECT_HAS_ACCOUNTING_EVIDENCE',
        409,
        'Видалення зупинено: знайдено незмінний запис часу з рахунку',
        { timeLogId: unexpectedBilledLog.id },
      );
    }
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
    // The project's days go with the project. Correcting each day's totals
    // would be arithmetic in service of documents that no longer describe
    // anything — there is no project left for them to be about.
    await deleteProjectAnalyticsRollups(db, project.organizationId, projectId);
    for (const issue of issues.docs) await db.recursiveDelete(issue.ref);
    for (const stage of stages.docs) await db.recursiveDelete(stage.ref);

    await db.collection('organizations').doc(project.organizationId).update({
      projectMutationVersion: FieldValue.increment(1),
    });
    await db.recursiveDelete(ref);
    // One fewer active project is one more place under the ceiling, and on a
    // workspace that is over it that place belongs to whichever project went
    // read-only last.
    await resyncProjectsOverPlanLimit(
      db,
      project.organizationId,
      organizationPlan(await db.collection('organizations').doc(project.organizationId).get()),
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error?.projectApi) {
      const { message, status, ...details } = error.projectApi;
      return NextResponse.json({ error: message, ...details }, { status });
    }
    return routeErrorResponse(error, { context: 'Project DELETE', fallbackMessage: 'Internal Server Error' });
  }
}
