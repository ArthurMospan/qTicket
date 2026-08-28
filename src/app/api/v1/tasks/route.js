import { FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';
import { readJsonBody, routeErrorResponse } from '@/lib/server/apiErrors';
import { randomUUID } from 'node:crypto';
import { enforceRateLimit, getAdminDb, getOrganizationApiKeys, hashApiKey, isValidApiKey } from '@/lib/server/firebaseAdmin';
import { hasActiveQuickTeamEntitlement } from '@/lib/utils/quickTeamManaged.mjs';
import {
  DEFAULT_PRIORITY_IDS,
  DEFAULT_TYPE_IDS,
  resolveClosedStatusIds,
  resolveEntryStatusId,
  workflowIds,
} from '@/lib/utils/workflowDefaults.mjs';
import { resolveNewIssueType } from '@/lib/utils/issueCreationModel.mjs';
import { NO_PRIORITY_ID } from '@/lib/utils/priorities.mjs';
import { isValidIssuePrefix, issuePath } from '@/lib/utils/issueKeys.mjs';
import { resolveProjectIssuePrefixInTransaction } from '@/lib/server/issueKeys';
import {
  projectIssueCountDeltasFor,
  projectIssueCountIncrements,
} from '@/lib/server/projectIssueCounts';

function resolveIntegrationWorkflow({ workflow, project = null, requestedPriority }) {
  const hiddenStatusIds = new Set(
    Array.isArray(project?.hiddenColumns) ? project.hiddenColumns : [],
  );
  const status = resolveEntryStatusId(workflow.statuses, [...hiddenStatusIds]);
  if (!status) {
    const error = new Error('INVALID_PROJECT_WORKFLOW');
    error.issueApi = {
      code: 'INVALID_PROJECT_WORKFLOW',
      status: 409,
      message: 'У проєкті немає доступного статусу для нової задачі',
    };
    throw error;
  }

  const priorityIds = [NO_PRIORITY_ID, ...workflowIds(workflow.priorities, DEFAULT_PRIORITY_IDS)];
  const typeSelection = resolveNewIssueType(
    'bug',
    workflowIds(workflow.types, DEFAULT_TYPE_IDS),
  );
  if (typeSelection.error) {
    const error = new Error(typeSelection.error.code);
    error.issueApi = typeSelection.error;
    throw error;
  }
  return {
    status,
    // An integration that does not mention priority has not set one — it used
    // to get «Високий», which is a louder claim than the caller made.
    priority: priorityIds.includes(requestedPriority) ? requestedPriority : NO_PRIORITY_ID,
    type: typeSelection.type,
    completed: resolveClosedStatusIds(workflow.statuses).includes(status),
  };
}

export async function POST(req) {
  try {
    const apiKey = req.headers.get('x-api-key');

    if (!apiKey) {
      return NextResponse.json({ error: 'Unauthorized. Missing API Key.' }, { status: 401 });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      return NextResponse.json({
        error: 'Invalid JSON body',
        code: 'INVALID_JSON',
      }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }
    const { title, description, attachments, organizationId, projectId, metadata, reporter, priority } = body;

    if (!title || !organizationId || title.trim().length > 240) {
      return NextResponse.json({ error: 'Missing required fields: title, organizationId' }, { status: 400 });
    }

    const db = getAdminDb();

    // 1. Verify organization exists and validate API Key
    const orgRef = db.collection('organizations').doc(organizationId);
    const orgSnap = await orgRef.get();

    if (!orgSnap.exists) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    const orgData = orgSnap.data();
    if (!hasActiveQuickTeamEntitlement(orgData)) {
      return NextResponse.json({ error: 'qTicket is inactive for this organization' }, { status: 403 });
    }
    const apiKeys = await getOrganizationApiKeys(organizationId);

    // Check if the provided apiKey exists in the organization's valid apiKeys
    const validApiKey = isValidApiKey(apiKeys, apiKey);

    if (!validApiKey) {
      return NextResponse.json({ error: 'Unauthorized. Invalid or revoked API Key for this organization.' }, { status: 401 });
    }
    if (!(await enforceRateLimit('integration-task', `${organizationId}:${hashApiKey(apiKey)}`, 120, 60))) {
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }

    if (projectId) {
      const projectSnap = await db.collection('projects').doc(projectId).get();
      if (!projectSnap.exists || projectSnap.data().organizationId !== organizationId) {
        return NextResponse.json({ error: 'Project does not belong to this organization' }, { status: 400 });
      }
      if (projectSnap.data().deletionPending === true) {
        return NextResponse.json({
          error: 'Проєкт уже видаляється',
          code: 'PROJECT_DELETING',
        }, { status: 409 });
      }
    }

    const safeAttachments = (Array.isArray(attachments) ? attachments : []).slice(0, 10).flatMap(attachment => {
      if (!attachment || typeof attachment !== 'object') return [];
      try {
        const url = new URL(attachment.url);
        if (url.protocol !== 'https:') return [];
        return [{
          name: String(attachment.name || 'Attachment').slice(0, 180),
          url: url.toString(),
          type: String(attachment.type || '').slice(0, 100),
          size: Number.isFinite(attachment.size) ? Math.max(0, attachment.size) : null,
        }];
      } catch {
        return [];
      }
    });
    let safeMetadata = {};
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      const serializedMetadata = JSON.stringify(metadata);
      if (serializedMetadata.length <= 20_000) safeMetadata = JSON.parse(serializedMetadata);
    }

    // 2. Resolve workflow and save atomically. Reading the workflow in this
    // transaction prevents an admin status/type edit from racing task creation.
    const workflowRef = orgRef.collection('settings').doc('workflow');
    const issueRef = db.collection('issues').doc();
    let issueKey = projectId ? '' : `EXT-${randomUUID().slice(0, 8).toUpperCase()}`;
    let payload;
    if (projectId) {
      const projectRef = db.collection('projects').doc(projectId);
      const countDeltas = await projectIssueCountDeltasFor(db, organizationId);
      await db.runTransaction(async transaction => {
        // Firestore re-runs this body on contention; the counter accumulator
        // lives outside it and would otherwise count the same task once per
        // attempt.
        countDeltas.reset();
        const [freshProject, workflowSnapshot] = await Promise.all([
          transaction.get(projectRef),
          transaction.get(workflowRef),
        ]);
        if (
          !freshProject.exists
          || freshProject.data().organizationId !== organizationId
        ) {
          throw new Error('PROJECT_NOT_FOUND');
        }
        if (freshProject.data().deletionPending === true) {
          throw new Error('PROJECT_DELETING');
        }
        if (freshProject.data().status === 'archived') {
          throw new Error('PROJECT_ARCHIVED');
        }
        const resolved = resolveIntegrationWorkflow({
          workflow: workflowSnapshot.data() || {},
          project: freshProject.data(),
          requestedPriority: priority,
        });
        const project = freshProject.data();
        const next = Number(project.issueCounter || 0) + 1;
        const issuePrefix = await resolveProjectIssuePrefixInTransaction({
          db,
          transaction,
          project,
          projectId,
          organizationId,
        });
        issueKey = `${issuePrefix}-${next}`;
        const now = FieldValue.serverTimestamp();
        payload = {
          issueKey,
          title: title.trim(),
          description: description ? String(description).trim().slice(0, 50_000) : '',
          status: resolved.status,
          columnId: resolved.status,
          priority: resolved.priority,
          type: resolved.type,
          organizationId,
          projectId,
          attachments: safeAttachments,
          metadata: safeMetadata,
          source: 'buggybag',
          parentIssueId: null,
          spentMinutes: 0,
          spentMinutesMirrorVersion: 1,
          timeLogMutationVersion: 0,
          // Integrations consume the same project sequence as every other
          // writer, so the visible key is stable and the initial order stays
          // unique within the column.
          order: -next,
          assigneeIds: [],
          reporterName: reporter ? String(reporter).slice(0, 120) : 'Buggy Bag Integration',
          createdAt: now,
          updatedAt: now,
          // Activity the project card can read, so a task that has just arrived
          // does not describe itself as one that was updated.
          lastActivityType: 'created',
          lastActivityAt: now,
          ...(resolved.completed ? { completedAt: now } : {}),
        };
        transaction.create(issueRef, payload);
        // A task arriving from an integration is one of the project's tasks
        // like any other, and the counters are what the home screen draws from.
        // A path that created work without counting it would leave a progress
        // bar that quietly disagreed with the board beside it.
        countDeltas
          .observeProject(projectId, project)
          .change(null, { ...payload, projectId, id: issueRef.id });
        transaction.update(projectRef, {
          issueCounter: next,
          ...projectIssueCountIncrements(countDeltas, projectId),
          ...(!isValidIssuePrefix(project.issuePrefix) ? { issuePrefix } : {}),
          updatedAt: now,
        });
        transaction.create(issueRef.collection('audit').doc(), {
          userId: null,
          userName: 'Buggy Bag Integration',
          action: 'експортував баг з Buggy Bag',
          from: null,
          to: issueKey,
          createdAt: now,
        });
      });
    } else {
      await db.runTransaction(async transaction => {
        const workflowSnapshot = await transaction.get(workflowRef);
        const resolved = resolveIntegrationWorkflow({
          workflow: workflowSnapshot.data() || {},
          requestedPriority: priority,
        });
        const now = FieldValue.serverTimestamp();
        payload = {
          issueKey,
          title: title.trim(),
          description: description ? String(description).trim().slice(0, 50_000) : '',
          status: resolved.status,
          columnId: resolved.status,
          priority: resolved.priority,
          type: resolved.type,
          organizationId,
          projectId: null,
          attachments: safeAttachments,
          metadata: safeMetadata,
          source: 'buggybag',
          parentIssueId: null,
          spentMinutes: 0,
          spentMinutesMirrorVersion: 1,
          timeLogMutationVersion: 0,
          // No project means no column to be positioned in; the value only has
          // to exist for the field to be present when it is triaged into one.
          order: 0,
          assigneeIds: [],
          reporterName: reporter ? String(reporter).slice(0, 120) : 'Buggy Bag Integration',
          createdAt: now,
          updatedAt: now,
          lastActivityType: 'created',
          lastActivityAt: now,
          ...(resolved.completed ? { completedAt: now } : {}),
        };
        transaction.create(issueRef, payload);
        transaction.create(issueRef.collection('audit').doc(), {
          userId: null,
          userName: 'Buggy Bag Integration',
          action: 'експортував баг з Buggy Bag',
          from: null,
          to: null,
          createdAt: now,
        });
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        taskId: issueRef.id,
        issueKey: payload.issueKey,
        taskUrl: issuePath({ id: issueRef.id, issueKey: payload.issueKey }, payload.projectId) || `/`
      },
      message: 'Task created successfully in QuickTeam'
    });

  } catch (error) {
    if (error?.issueApi) {
      return NextResponse.json({
        error: error.issueApi.message,
        code: error.issueApi.code,
      }, { status: error.issueApi.status });
    }
    if (error?.message === 'PROJECT_DELETING') {
      return NextResponse.json({
        error: 'Проєкт уже видаляється',
        code: 'PROJECT_DELETING',
      }, { status: 409 });
    }
    if (error?.message === 'PROJECT_NOT_FOUND') {
      return NextResponse.json({
        error: 'Проєкт не знайдено',
        code: 'PROJECT_NOT_FOUND',
      }, { status: 404 });
    }
    if (error?.message === 'PROJECT_ARCHIVED') {
      return NextResponse.json({
        error: 'Проєкт архівовано',
        code: 'PROJECT_ARCHIVED',
      }, { status: 409 });
    }
    return routeErrorResponse(error, { context: 'API v1 Tasks Create', fallbackMessage: 'Internal Server Error' });
  }
}
