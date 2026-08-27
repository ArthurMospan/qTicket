import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import {
  authorizeOrgRequest,
  enforceRateLimit,
  getAdminDb,
} from '@/lib/server/firebaseAdmin';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import {
  forgetCountContext,
  recountProjectIssueCounts,
} from '@/lib/server/projectIssueCounts';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';
import {
  introducedIssueExecutionViolations,
} from '@/lib/utils/issueStatusTransition.mjs';
import {
  DEFAULT_STATUS_IDS,
  resolveClosedStatusIds,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';
import {
  normalizeWorkflowMutationInput,
  sameStringSet,
  WORKFLOW_MUTATION_SECTIONS,
} from '@/lib/utils/workflowMutation.mjs';
import {
  effectivePositionRates,
  positionRatesFromWorkflow,
  publicWorkflow,
  samePositionRates,
  workflowWithProtectedRates,
} from '@/lib/server/workflowBilling';

const MAX_TRANSACTION_WRITES = 450;

function workflowError(code, status, message, details = {}) {
  const error = new Error(code);
  error.workflow = { code, status, message, ...details };
  return error;
}

function serializedLink(document) {
  return { ...document.data(), id: document.id };
}

function statusIdOf(issue) {
  return issue?.columnId || issue?.status || null;
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function workflowSectionsEqual(current, next) {
  return WORKFLOW_MUTATION_SECTIONS.every(section => (
    JSON.stringify(current?.[section] || []) === JSON.stringify(next[section])
  ));
}

function sameIssueScope(left, right) {
  return left?.organizationId === right?.organizationId
    && left?.projectId === right?.projectId;
}

export async function GET(request, context) {
  try {
    const { organizationId } = await context.params;
    const authorization = await authorizeOrgRequest(request, organizationId);
    if (authorization.error) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const db = getAdminDb();
    const workflowRef = db.collection('organizations')
      .doc(organizationId)
      .collection('settings')
      .doc('workflow');
    const ratesRef = db.collection('organizations')
      .doc(organizationId)
      .collection('private')
      .doc('workflowRates');
    const [workflowSnap, ratesSnap] = await Promise.all([
      workflowRef.get(),
      ratesRef.get(),
    ]);
    const workflow = workflowSnap.data() || {};
    const canViewBilling = ['owner', 'admin'].includes(authorization.membership.role);

    return NextResponse.json({
      workflow: canViewBilling
        ? workflowWithProtectedRates(workflow, ratesSnap.data())
        : publicWorkflow(workflow),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error, {
      context: 'Workflow GET',
      fallbackMessage: 'Не вдалося завантажити workflow',
    });
  }
}

export async function PATCH(request, context) {
  try {
    const { organizationId } = await context.params;
    const authorization = await authorizeOrgRequest(
      request,
      organizationId,
      ['owner', 'admin'],
    );
    if (authorization.error) {
      return NextResponse.json({
        error: localizedIssueAuthorizationMessage(authorization.error),
      }, { status: authorization.status });
    }
    if (!(await enforceRateLimit(
      'workflow-update',
      authorization.user.uid,
      30,
      60,
    ))) {
      return NextResponse.json({
        error: 'Забагато змін workflow. Спробуйте ще раз за хвилину',
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
    const normalized = normalizeWorkflowMutationInput(body);
    if (normalized.error) {
      const { status, ...payload } = normalized.error;
      return NextResponse.json({
        error: payload.message,
        ...Object.fromEntries(
          Object.entries(payload).filter(([key]) => key !== 'message'),
        ),
      }, { status });
    }

    const { workflow: requestedWorkflow, statusMigrations } = normalized.value;
    const nextWorkflow = publicWorkflow(requestedWorkflow);
    const nextPositionRates = positionRatesFromWorkflow(requestedWorkflow);
    const suppliedPositionRateIds = new Set((Array.isArray(body.workflow?.positions)
      ? body.workflow.positions
      : [])
      .filter(position => (
        position?.id
        && Object.prototype.hasOwnProperty.call(position, 'hourlyRate')
      ))
      .map(position => position.id));
    const nextStatusIds = nextWorkflow.statuses.map(status => status.id);
    const nextClosedStatusIds = resolveClosedStatusIds(nextWorkflow.statuses);
    const migrationTargetIds = new Set(
      statusMigrations.map(migration => migration.toStatusId),
    );
    const invalidMigrationTargets = [...migrationTargetIds]
      .filter(statusId => !nextStatusIds.includes(statusId));
    if (invalidMigrationTargets.length > 0) {
      return NextResponse.json({
        error: 'Ціль міграції має існувати в новому workflow',
        code: 'STATUS_MIGRATION_TARGET_NOT_FOUND',
        statusIds: invalidMigrationTargets,
      }, { status: 400 });
    }

    const db = getAdminDb();
    const workflowRef = db.collection('organizations')
      .doc(organizationId)
      .collection('settings')
      .doc('workflow');
    const orgRef = db.collection('organizations').doc(organizationId);
    const ratesRef = orgRef.collection('private').doc('workflowRates');
    const migrationBySource = new Map(
      statusMigrations.map(migration => [
        migration.fromStatusId,
        migration.toStatusId,
      ]),
    );
    const result = await db.runTransaction(async transaction => {
      const [currentWorkflowSnap, currentRatesSnap] = await Promise.all([
        transaction.get(workflowRef),
        transaction.get(ratesRef),
      ]);
      const storedWorkflow = currentWorkflowSnap.data() || {};
      const currentWorkflow = publicWorkflow(storedWorkflow);
      const currentPositionRates = effectivePositionRates(
        storedWorkflow,
        currentRatesSnap.data(),
      );
      const resolvedNextPositionRates = Object.fromEntries(
        nextWorkflow.positions.map(position => [
          position.id,
          suppliedPositionRateIds.has(position.id)
            ? nextPositionRates[position.id]
            : currentPositionRates[position.id] || 0,
        ]),
      );
      const currentStatusIds = workflowIds(
        currentWorkflow.statuses,
        DEFAULT_STATUS_IDS,
      );
      const currentClosedStatusIds = resolveClosedStatusIds(
        currentWorkflow.statuses,
      );
      const executionSemanticsChanged = (
        !sameStringSet(currentStatusIds, nextStatusIds)
        || !sameStringSet(currentClosedStatusIds, nextClosedStatusIds)
        || statusMigrations.length > 0
      );

      if (!executionSemanticsChanged) {
        if (
          workflowSectionsEqual(currentWorkflow, nextWorkflow)
          && samePositionRates(currentPositionRates, resolvedNextPositionRates)
        ) {
          return {
            changed: false,
            migratedIssues: 0,
            changedTerminalSemantics: false,
            updatedProjects: 0,
          };
        }
        transaction.set(workflowRef, {
          ...nextWorkflow,
          schemaVersion: 2,
          updatedBy: authorization.user.uid,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(ratesRef, {
          positionRates: resolvedNextPositionRates,
          updatedBy: authorization.user.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(orgRef, {
          workflowVersion: FieldValue.increment(1),
        });
        return {
          changed: true,
          migratedIssues: 0,
          changedTerminalSemantics: false,
          updatedProjects: 0,
        };
      }

      const issuesSnapshot = await transaction.get(
        db.collection('issues').where('organizationId', '==', organizationId),
      );
      const linksSnapshot = await transaction.get(
        db.collection('issueLinks').where('organizationId', '==', organizationId),
      );
      const projectsSnapshot = await transaction.get(
        db.collection('projects').where('organizationId', '==', organizationId),
      );
      const currentIssues = issuesSnapshot.docs.map(document => ({
        ...document.data(),
        id: document.id,
      }));
      const missingMigrationCounts = new Map();
      const nextIssues = currentIssues.map(issue => {
        const currentStatusId = statusIdOf(issue);
        if (nextStatusIds.includes(currentStatusId)) return issue;
        const targetStatusId = migrationBySource.get(currentStatusId);
        if (!targetStatusId) {
          missingMigrationCounts.set(
            currentStatusId || '(empty)',
            (missingMigrationCounts.get(currentStatusId || '(empty)') || 0) + 1,
          );
          return issue;
        }
        return {
          ...issue,
          columnId: targetStatusId,
          status: targetStatusId,
        };
      });
      if (missingMigrationCounts.size > 0) {
        throw workflowError(
          'STATUS_MIGRATION_REQUIRED',
          409,
          'Для видалених або застарілих статусів потрібно вибрати ціль міграції',
          {
            statuses: [...missingMigrationCounts].map(([statusId, issueCount]) => ({
              statusId,
              issueCount,
            })),
          },
        );
      }

      const issueById = new Map(currentIssues.map(issue => [issue.id, issue]));
      const scopedLinks = linksSnapshot.docs
        .map(serializedLink)
        .filter(link => {
          const source = issueById.get(link.sourceIssueId);
          const target = issueById.get(link.targetIssueId);
          return source && target && sameIssueScope(source, target);
        });
      const violations = introducedIssueExecutionViolations({
        currentIssues,
        nextIssues,
        issueLinks: scopedLinks,
        currentClosedStatusIds,
        nextClosedStatusIds,
      });
      if (violations.length > 0) {
        throw workflowError(
          'WORKFLOW_EXECUTION_CONFLICT',
          409,
          'Нові завершальні статуси суперечать ієрархії або залежностям',
          {
            violationCount: violations.length,
            violations: violations.slice(0, 50),
          },
        );
      }

      const currentDoneSet = new Set(currentClosedStatusIds);
      const nextDoneSet = new Set(nextClosedStatusIds);
      const issueChanges = [];
      nextIssues.forEach((nextIssue, index) => {
        const currentIssue = currentIssues[index];
        const currentStatusId = statusIdOf(currentIssue);
        const nextStatusId = statusIdOf(nextIssue);
        const statusChanged = (
          currentIssue.columnId !== nextStatusId
          || currentIssue.status !== nextStatusId
        );
        const wasClosed = currentDoneSet.has(currentStatusId);
        const willBeClosed = nextDoneSet.has(nextStatusId);
        const completedAtNeedsSet = willBeClosed
          && (!wasClosed || (statusChanged && !currentIssue.completedAt));
        const completedAtNeedsClear = !willBeClosed
          && (wasClosed || statusChanged)
          && owns(currentIssue, 'completedAt');
        if (
          statusChanged
          || completedAtNeedsSet
          || completedAtNeedsClear
        ) {
          issueChanges.push({
            currentIssue,
            nextStatusId,
            wasClosed,
            willBeClosed,
            completedAtNeedsSet,
            completedAtNeedsClear,
          });
        }
      });

      const projectsById = new Map(
        projectsSnapshot.docs.map(document => [document.id, document]),
      );
      const projectChanges = new Map();
      const removedStatusIds = currentStatusIds.filter(
        statusId => !nextStatusIds.includes(statusId),
      );
      for (const projectDocument of projectsSnapshot.docs) {
        const project = projectDocument.data();
        const hiddenColumns = Array.isArray(project.hiddenColumns)
          ? project.hiddenColumns
          : [];
        const nextHiddenColumns = hiddenColumns.filter(
          statusId => (
            !removedStatusIds.includes(statusId)
            && !migrationTargetIds.has(statusId)
          ),
        );
        if (nextHiddenColumns.length !== hiddenColumns.length) {
          if (project.deletionPending === true) {
            throw workflowError(
              'PROJECT_DELETING',
              409,
              'Один із проєктів уже видаляється',
              { projectId: projectDocument.id },
            );
          }
          projectChanges.set(projectDocument.id, {
            document: projectDocument,
            hiddenColumns: nextHiddenColumns,
          });
        }
      }
      for (const change of issueChanges) {
        if (change.currentIssue.deletionPending === true) {
          throw workflowError(
            'ISSUE_DELETING',
            409,
            'Одне із завдань уже видаляють. Дочекайтеся завершення й повторіть зміну workflow',
            { issueId: change.currentIssue.id },
          );
        }
        const projectDocument = projectsById.get(change.currentIssue.projectId);
        if (!projectDocument) continue;
        if (projectDocument.data().deletionPending === true) {
          throw workflowError(
            'PROJECT_DELETING',
            409,
            'Один із проєктів уже видаляється',
            { projectId: projectDocument.id },
          );
        }
        if (!projectChanges.has(projectDocument.id)) {
          projectChanges.set(projectDocument.id, {
            document: projectDocument,
            hiddenColumns: null,
          });
        }
      }

      const plannedWrites = (
        issueChanges.length * 2
        + projectChanges.size
        + 3
      );
      if (plannedWrites > MAX_TRANSACTION_WRITES) {
        throw workflowError(
          'WORKFLOW_MIGRATION_TOO_LARGE',
          409,
          'Забагато завдань для однієї безпечної транзакції. Виконайте окрему адміністративну міграцію',
          {
            affectedIssues: issueChanges.length,
            affectedProjects: projectChanges.size,
            maxTransactionWrites: MAX_TRANSACTION_WRITES,
          },
        );
      }

      const now = FieldValue.serverTimestamp();
      for (const change of issueChanges) {
        const issueRef = db.collection('issues').doc(change.currentIssue.id);
        const updates = {
          columnId: change.nextStatusId,
          status: change.nextStatusId,
          updatedAt: now,
        };
        if (change.completedAtNeedsSet) {
          updates.completedAt = now;
        } else if (change.completedAtNeedsClear) {
          updates.completedAt = FieldValue.delete();
        }
        transaction.update(issueRef, updates);
        transaction.create(issueRef.collection('audit').doc(), {
          userId: authorization.user.uid,
          userName: authorization.user.name || authorization.user.email || '',
          action: 'workflow-status-migrated',
          from: statusIdOf(change.currentIssue),
          to: change.nextStatusId,
          fromCompleted: change.wasClosed,
          toCompleted: change.willBeClosed,
          createdAt: now,
        });
      }
      for (const change of projectChanges.values()) {
        transaction.update(change.document.ref, {
          ...(change.hiddenColumns
            ? { hiddenColumns: change.hiddenColumns }
            : {}),
          issueStatusVersion: FieldValue.increment(1),
          updatedAt: now,
        });
      }
      transaction.set(workflowRef, {
        ...nextWorkflow,
        schemaVersion: 2,
        updatedBy: authorization.user.uid,
        updatedAt: now,
      }, { merge: true });
      transaction.set(ratesRef, {
        positionRates: resolvedNextPositionRates,
        updatedBy: authorization.user.uid,
        updatedAt: now,
      });
      transaction.update(orgRef, {
        workflowVersion: FieldValue.increment(1),
      });
      return {
        changed: true,
        migratedIssues: issueChanges.length,
        changedTerminalSemantics: !sameStringSet(
          currentClosedStatusIds,
          nextClosedStatusIds,
        ),
        updatedProjects: projectChanges.size,
      };
    });

    // Editing the workflow does not move one task's counters — it changes what
    // «delivered» and «closed» mean for every task in the workspace at once, so
    // no delta can express it. The project counters are therefore rebuilt from
    // scratch, which is the one operation that does not have to know what
    // changed. This is rare (a settings save), it is the same read the
    // transaction above just made, and the process cache of "what this
    // organization counts by" has to be dropped first or the rebuild would
    // recount against the workflow that was just replaced.
    //
    // Fire and forget: the workflow has already been saved, and a counter that
    // failed to catch up is repaired by the twice-daily pass rather than being
    // allowed to fail the request that changed it.
    forgetCountContext(organizationId);
    recountProjectIssueCounts({ organizationIds: [organizationId] })
      .catch(error => console.warn('[workflow] project counters not rebuilt:', error.message));

    return NextResponse.json({
      success: true,
      ...result,
      closedStatusIds: nextClosedStatusIds,
    });
  } catch (error) {
    if (error?.workflow) {
      const { message, status, ...details } = error.workflow;
      return NextResponse.json({
        error: message,
        ...details,
      }, { status });
    }
    return routeErrorResponse(error, {
      context: 'Workflow PATCH',
      fallbackMessage: 'Не вдалося оновити workflow',
    });
  }
}
