import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { getAdminDb } from '@/lib/server/firebaseAdmin';
import {
  organizationRollupTimeZone,
  writeAnalyticsRollupDeltas,
} from '@/lib/server/analyticsRollups';
import { AnalyticsRollupDeltas } from '@/lib/utils/analyticsRollups.mjs';
import { normalizePlan, planLimit, planLimitRefusal } from '@/lib/utils/plans.mjs';
import { resolveProjectIssuePrefixInTransaction } from '@/lib/server/issueKeys';
import { recountProjectIssueCounts } from '@/lib/server/projectIssueCounts';
import {
  ISSUE_IMPORT_COLLECTION,
  ISSUE_IMPORT_DOCUMENT,
  splitIssueImportRecord,
} from '@/lib/utils/issueImportRecord.mjs';
import { youTrackClientFor } from '@/lib/server/youtrackIntegration';
import {
  isValidIssuePrefix,
  suggestAvailableIssuePrefix,
} from '@/lib/utils/issueKeys.mjs';
import {
  fieldMinutes,
  fieldPresentation,
  fieldTimestamp,
  filterYouTrackIssuesByStatuses,
  firstFieldValue,
  mapYouTrackPriority,
  mapYouTrackType,
  normalizeYouTrackRelation,
  normalizeMappingKey,
  resolveYouTrackStatus,
  serializeCustomFields,
  sourceUserId,
  sourceUserName,
  strongestYouTrackRelationRow,
  youTrackImportedWorkLogMatches,
  youTrackField,
  youTrackStateName,
} from '@/lib/utils/youtrackImport.mjs';
import {
  canonicalIssueLinkDocumentId,
  canonicalizeRequestedIssueLink,
  findDirectionalIssueLinkCycle,
  normalizeStoredIssueLinks,
} from '@/lib/utils/issueRelations.mjs';
import { resolveNewIssueType } from '@/lib/utils/issueCreationModel.mjs';
import { isBilledTimeLog } from '@/lib/utils/issueDeletion.mjs';
import {
  isTaskEstimateReservationIdentity,
  taskTimeLogMirrorTransition,
} from '@/lib/utils/taskTimeLog.mjs';
import { invoiceSourcelessReservationId } from '@/lib/server/invoicePayload.mjs';
import {
  evaluateIssueStatusTransition,
  issueBlockLinkStatusConflict,
  normalizedIssueBlockEdges,
} from '@/lib/utils/issueStatusTransition.mjs';
import { existingParentIssueId } from '@/lib/utils/issueHierarchyModel.mjs';
import {
  resolveClosedStatusIds,
  resolveEntryStatusId,
} from '@/lib/utils/workflowDefaults.mjs';
import { plural } from '@/lib/utils/plural.mjs';

const DEFAULT_WORKFLOW = {
  statuses: [
    { id: 'backlog', label: 'Беклог', category: 'backlog' },
    { id: 'todo', label: 'До виконання', category: 'todo' },
    { id: 'in-progress', label: 'У роботі', category: 'in-progress' },
    { id: 'done', label: 'Готово', category: 'done', isDone: true },
  ],
  priorities: [
    { id: 'blocker', label: 'Критичний' },
    { id: 'high', label: 'Високий' },
    { id: 'medium', label: 'Середній' },
    { id: 'low', label: 'Низький' },
  ],
  types: [
    { id: 'feature', label: 'Фіча' },
    { id: 'task', label: 'Задача' },
    { id: 'bug', label: 'Баг' },
  ],
  labels: [],
};

const IMPORT_STEP_LEASE_MS = 90_000;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function hashId(...parts) {
  return createHash('sha256').update(parts.map(part => String(part || '')).join('|')).digest('hex');
}

function importJobRef(jobId) {
  return getAdminDb().collection('imports').doc(jobId);
}

function externalLinkRef(organizationId, connectionId, entityType, externalId) {
  return getAdminDb().collection('externalObjectLinks')
    .doc(hashId(organizationId, 'youtrack', connectionId, entityType, externalId));
}

function timestamp(value, fallback = null) {
  if (typeof value?.toDate === 'function') return Timestamp.fromDate(value.toDate());
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? Timestamp.fromDate(date) : fallback;
}

function serializeJob(snapshot) {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return {
    id: snapshot.id,
    organizationId: data.organizationId,
    // Who this import belongs to. The screen needs it to say whose it is and to
    // stop offering somebody else's import a «Продовжити» button; the server
    // does not trust that and checks the same field again on every step.
    createdBy: data.createdBy || '',
    status: data.status,
    phase: data.phase,
    totalIssues: data.totalIssues || 0,
    processedIssues: data.processedIssues || 0,
    failedIssues: data.failedIssues || 0,
    processedLinks: data.processedLinks || 0,
    skippedLinks: data.skippedLinks || 0,
    nextIndex: data.nextIndex || 0,
    sourceProjects: data.sourceProjects || [],
    warnings: data.warnings || [],
    lastError: data.lastError || '',
    createdAt: data.createdAt?.toDate?.().toISOString() || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString() || null,
    completedAt: data.completedAt?.toDate?.().toISOString() || null,
  };
}

// One import belongs to one person, and it is the person who started it.
//
// Every owner and admin of an organization could previously drive any import
// job it had: continue one somebody else had paused halfway, or stop one that
// was running. A migration is not a shared control surface — it writes projects,
// tasks, comments, attachments and time into the workspace from a mapping only
// its author chose, and two people stepping the same job take turns writing over
// each other's idea of where it had got to.
//
// Continuing is therefore the author's alone. Stopping is the author's or the
// organization owner's: an import whose author has gone home must still be
// stoppable by somebody, and the owner is who that is.
const IMPORT_NOT_YOURS = 'Імпорт запустив інший учасник';

function assertImportControl(data, { userId, isOrganizationOwner = false, action }) {
  const createdBy = data?.createdBy || '';
  // A job written before this field existed has no author to defer to, so it
  // stays available to whoever the route already let through.
  if (!createdBy || createdBy === userId) return;
  if (action === 'cancel' && isOrganizationOwner) return;
  throw new Error(action === 'cancel'
    ? `${IMPORT_NOT_YOURS}. Зупинити його може той, хто розпочав, або власник організації.`
    : `${IMPORT_NOT_YOURS}. Продовжити його може лише той, хто розпочав.`);
}

async function assertNoForeignActiveImport(organizationId, userId) {
  // The same query shape the job listing uses, so this rides the one composite
  // index `imports` already has instead of asking for a second one for a check
  // that runs once per prepare. An unfinished import is the newest thing in
  // this collection in every case that matters.
  const snapshot = await getAdminDb().collection('imports')
    .where('organizationId', '==', organizationId)
    .where('provider', '==', 'youtrack')
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();
  const foreign = snapshot.docs.find(doc => {
    const data = doc.data();
    if (data.status !== 'prepared' && data.status !== 'running') return false;
    const createdBy = data.createdBy || '';
    return createdBy && createdBy !== userId;
  });
  if (foreign) {
    throw new Error(
      `${IMPORT_NOT_YOURS} і він ще не завершений. Дочекайтеся його завершення або попросіть зупинити.`,
    );
  }
}

async function claimImportStep(jobRef, organizationId, control) {
  const leaseId = randomUUID();
  const now = Date.now();
  let claimedJob = null;
  let terminalSnapshot = null;
  let busySnapshot = null;

  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists || snapshot.data().organizationId !== organizationId) {
      throw new Error('Імпорт не знайдено');
    }

    const data = snapshot.data();
    assertImportControl(data, { ...control, action: 'run' });
    if (data.status === 'completed') {
      terminalSnapshot = snapshot;
      return;
    }
    if (data.status === 'cancelled') throw new Error('Імпорт скасовано');

    const leaseUntil = data.stepLeaseUntil?.toMillis?.() || 0;
    if (data.stepLeaseId && leaseUntil > now) {
      busySnapshot = snapshot;
      return;
    }

    transaction.update(jobRef, {
      stepLeaseId: leaseId,
      stepLeaseUntil: Timestamp.fromMillis(now + IMPORT_STEP_LEASE_MS),
      updatedAt: FieldValue.serverTimestamp(),
    });
    claimedJob = { ...data, id: snapshot.id };
  });

  return { leaseId, claimedJob, terminalSnapshot, busySnapshot };
}

async function commitClaimedStep(jobRef, leaseId, {
  jobUpdates = {},
  itemRef = null,
  itemUpdates = null,
} = {}) {
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists || snapshot.data().stepLeaseId !== leaseId) return;

    const updates = { ...jobUpdates };
    if (snapshot.data().status === 'cancelled') {
      delete updates.status;
      if (jobUpdates.status === 'completed') {
        delete updates.phase;
        delete updates.completedAt;
      }
    }

    transaction.update(jobRef, {
      ...updates,
      stepLeaseId: FieldValue.delete(),
      stepLeaseUntil: FieldValue.delete(),
    });
    if (itemRef && itemUpdates) transaction.set(itemRef, itemUpdates, { merge: true });
  });
}

async function releaseImportStep(jobRef, leaseId) {
  await getAdminDb().runTransaction(async transaction => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists || snapshot.data().stepLeaseId !== leaseId) return;
    transaction.update(jobRef, {
      stepLeaseId: FieldValue.delete(),
      stepLeaseUntil: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
}

async function writeInChunks(entries, writer) {
  const db = getAdminDb();
  for (let offset = 0; offset < entries.length; offset += 400) {
    const batch = db.batch();
    entries.slice(offset, offset + 400).forEach((entry, index) => writer(batch, entry, offset + index));
    await batch.commit();
  }
}

function actorFor(user, job) {
  if (!user) return {
    id: 'external:youtrack:unknown',
    name: 'Користувач YouTrack',
    avatar: null,
    email: '',
    external: true,
    sourceId: 'unknown',
  };
  const externalId = sourceUserId(user) || 'unknown';
  const mapped = job.userMappings?.[externalId];
  const external = !mapped || mapped === 'external';
  return {
    id: external ? `external:youtrack:${job.connectionId}:${externalId}` : mapped,
    name: sourceUserName(user),
    avatar: user.avatarUrl || null,
    email: String(user.email || ''),
    external,
    sourceId: externalId,
  };
}

async function saveExternalActors(job, actors) {
  const unique = new Map(
    actors
      .filter(actor => actor?.external && actor.sourceId)
      .map(actor => [actor.sourceId, actor]),
  );
  if (!unique.size) return;
  await writeInChunks([...unique.values()], (batch, actor) => {
    const ref = getAdminDb().collection('externalActors')
      .doc(hashId(job.organizationId, job.connectionId, actor.sourceId));
    batch.set(ref, {
      provider: 'youtrack',
      organizationId: job.organizationId,
      connectionId: job.connectionId,
      externalId: actor.sourceId,
      name: actor.name,
      email: actor.email,
      avatar: actor.avatar,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function ensureTargetProject(job, sourceProject) {
  const db = getAdminDb();
  const configuredTarget = job.projectMappings?.[sourceProject.id];
  if (configuredTarget && configuredTarget !== 'create') {
    const snapshot = await db.collection('projects').doc(configuredTarget).get();
    if (!snapshot.exists || snapshot.data().organizationId !== job.organizationId) {
      throw new Error(`Проєкт-призначення для ${sourceProject.name} більше не існує`);
    }
    return snapshot.id;
  }

  const linkRef = externalLinkRef(job.organizationId, job.connectionId, 'project', sourceProject.id);
  const existingLink = await linkRef.get();
  if (existingLink.exists) {
    const target = await db.collection('projects').doc(existingLink.data().quickTeamId).get();
    if (target.exists && target.data().organizationId === job.organizationId) return target.id;
  }

  const projectRef = db.collection('projects').doc();
  const mappedTeam = [...new Set([
    job.createdBy,
    ...Object.values(job.userMappings || {}).filter(value => value && value !== 'external'),
  ])].slice(0, 100);
  await db.runTransaction(async transaction => {
    const [freshLink, organization, organizationProjects] = await Promise.all([
      transaction.get(linkRef),
      transaction.get(db.collection('organizations').doc(job.organizationId)),
      transaction.get(
        db.collection('projects').where('organizationId', '==', job.organizationId),
      ),
    ]);
    if (freshLink.exists) return;
    if (!organization.exists) throw new Error('Організацію не знайдено');
    // An import that creates a project is creating a project, so it asks the
    // same registry the create route asks. This was the third copy of one
    // ceiling — `plan !== 'pro'` with a hardcoded three, refusing Lite a fourth
    // project like a free workspace — and the third copy of one refusal, which
    // named Pro as the only way out while Lite raises this ceiling too.
    const plan = normalizePlan(organization.data().plan);
    const activeProjectCount = organizationProjects.docs
      .filter(document => document.data().status === 'active')
      .length;
    if (activeProjectCount >= planLimit(plan, 'projects')) {
      throw new Error(
        `${planLimitRefusal(plan, 'projects', activeProjectCount)} Або зіставте імпорт із наявним проєктом.`,
      );
    }
    const organizationProjectValues = organizationProjects.docs.map(document => ({
      ...document.data(),
      id: document.id,
    }));
    const issuePrefix = suggestAvailableIssuePrefix(
      { name: sourceProject.name, issuePrefix: sourceProject.shortName },
      organizationProjectValues,
    );
    transaction.create(projectRef, {
      name: sourceProject.name,
      description: sourceProject.description || `Імпортовано з YouTrack · ${sourceProject.shortName}`,
      issuePrefix,
      visibility: 'internal',
      organizationId: job.organizationId,
      team: mappedTeam,
      status: 'active',
      stagesCount: 0,
      issueCounter: 0,
      source: 'youtrack',
      externalKey: sourceProject.shortName,
      createdBy: job.createdBy,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(linkRef, {
      provider: 'youtrack',
      organizationId: job.organizationId,
      connectionId: job.connectionId,
      entityType: 'project',
      externalId: sourceProject.id,
      externalReadableId: sourceProject.shortName,
      quickTeamId: projectRef.id,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(db.collection('organizations').doc(job.organizationId), {
      projectMutationVersion: FieldValue.increment(1),
    });
  });

  const finalLink = await linkRef.get();
  return finalLink.exists ? finalLink.data().quickTeamId : projectRef.id;
}

function workflowValues(snapshot) {
  const data = snapshot.exists ? snapshot.data() : {};
  return {
    statuses: Array.isArray(data.statuses) && data.statuses.length ? data.statuses : DEFAULT_WORKFLOW.statuses,
    priorities: Array.isArray(data.priorities) && data.priorities.length ? data.priorities : DEFAULT_WORKFLOW.priorities,
    types: Array.isArray(data.types) && data.types.length ? data.types : DEFAULT_WORKFLOW.types,
    labels: Array.isArray(data.labels) ? data.labels : DEFAULT_WORKFLOW.labels,
  };
}

function issueRecord(document) {
  return document?.exists
    ? { ...document.data(), id: document.id }
    : null;
}

function serializedLink(document) {
  return {
    ...document.data(),
    id: document.id,
  };
}

function sameIssueScope(issue, organizationId, projectId) {
  return issue
    && issue.organizationId === organizationId
    && issue.projectId === projectId;
}

async function transactionGetAll(transaction, references) {
  return references.length > 0
    ? transaction.getAll(...references)
    : [];
}

function importedWorkflowFields({
  issue,
  project,
  workflow,
  stateName,
  explicitStatusId,
  priorityName,
  typeName,
  tags,
}) {
  const statusIds = workflow.statuses.map(item => item.id);
  if (explicitStatusId && !statusIds.includes(explicitStatusId)) {
    throw new Error(`Обраний статус QuickTeam для ${stateName || 'YouTrack'} більше не існує`);
  }
  const mappedStatus = resolveYouTrackStatus(stateName, workflow.statuses, explicitStatusId)
    || statusIds[0];
  const hiddenStatusIds = new Set(
    Array.isArray(project?.hiddenColumns) ? project.hiddenColumns : [],
  );
  if (explicitStatusId && hiddenStatusIds.has(explicitStatusId)) {
    throw new Error(
      `Обраний статус для ${stateName || 'YouTrack'} приховано у проєкті-призначенні`,
    );
  }
  const fallbackStatus = resolveEntryStatusId(workflow.statuses, [...hiddenStatusIds])
    || statusIds[0];
  const status = hiddenStatusIds.has(mappedStatus)
    ? fallbackStatus
    : mappedStatus;
  if (!status || hiddenStatusIds.has(status)) {
    throw new Error(
      `У проєкті немає доступного статусу для імпорту ${issue.idReadable || issue.id}`,
    );
  }
  const priority = mapYouTrackPriority(priorityName, workflow.priorities)
    || workflow.priorities[0]?.id
    || null;
  const mappedType = mapYouTrackType(typeName, workflow.types);
  const typeSelection = resolveNewIssueType(
    mappedType,
    workflow.types.map(item => item.id),
  );
  if (typeSelection.error) {
    throw new Error(
      `Не вдалося імпортувати тип задачі ${issue.idReadable || issue.id}: ${typeSelection.error.message}`,
    );
  }

  return {
    columnId: status,
    status,
    priority,
    type: typeSelection.type,
    labelIds: labelIdsFor(tags, workflow),
    closedStatusIds: resolveClosedStatusIds(workflow.statuses),
  };
}

function sourceTags(issue) {
  return (issue.tags || []).map(tag => String(tag?.name || '')).filter(Boolean).slice(0, 50);
}

function labelIdsFor(tags, workflow) {
  const tagKeys = new Set(tags.map(normalizeMappingKey));
  return (workflow.labels || [])
    .filter(label => tagKeys.has(normalizeMappingKey(label.label || label.id)))
    .map(label => label.id)
    .slice(0, 20);
}

function issueAssignees(issue, job) {
  const value = youTrackField(issue, 'Assignee');
  const users = Array.isArray(value) ? value : value ? [value] : [];
  return users.map(user => actorFor(user, job));
}

async function uploadBuffer(bytes, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
    stream.end(bytes);
  });
}

async function importAttachments({ client, job, issue, existingAttachments = [] }) {
  const sourceAttachments = await client.attachments(issue.id);
  const existingBySource = new Map(
    existingAttachments.filter(item => item?.sourceId).map(item => [item.sourceId, item]),
  );
  const imported = [];
  const warnings = [];

  for (const attachment of sourceAttachments) {
    const sourceId = String(attachment.id || '');
    if (!sourceId || !attachment.url) continue;
    if (existingBySource.has(sourceId)) {
      imported.push(existingBySource.get(sourceId));
      continue;
    }
    try {
      const { bytes, contentType } = await client.downloadAttachment(attachment.url);
      const publicId = `yt_${hashId(job.connectionId, sourceId).slice(0, 32)}`;
      const result = await uploadBuffer(bytes, {
        folder: `quickteam/imports/${job.organizationId}`,
        public_id: publicId,
        resource_type: 'auto',
        overwrite: true,
      });
      imported.push({
        source: 'youtrack',
        sourceId,
        name: String(attachment.name || 'attachment').slice(0, 240),
        url: result.secure_url,
        size: Number(attachment.size || bytes.length),
        type: String(attachment.mimeType || contentType),
        storagePath: result.public_id,
        resourceType: result.resource_type,
      });
    } catch (error) {
      warnings.push(`Вкладення ${attachment.name || sourceId}: ${error.message}`);
    }
  }
  return { attachments: imported, warnings };
}

async function upsertIssue({ job, sourceProject, issue, targetProjectId, attachments }) {
  const db = getAdminDb();
  const projectRef = db.collection('projects').doc(targetProjectId);
  const workflowRef = db.collection('organizations')
    .doc(job.organizationId)
    .collection('settings')
    .doc('workflow');
  const linkRef = externalLinkRef(job.organizationId, job.connectionId, 'issue', issue.id);
  const existingLink = await linkRef.get();
  const existingIssue = existingLink.exists
    ? await db.collection('issues').doc(existingLink.data().quickTeamId).get()
    : null;

  const stateName = youTrackStateName(issue);
  const explicitStatusId = (job.statusMappings || []).find(mapping => (
    mapping?.sourceProjectId === sourceProject.id
    && normalizeMappingKey(mapping?.sourceStatus) === normalizeMappingKey(stateName)
  ))?.targetStatusId || '';
  const priorityName = fieldPresentation(youTrackField(issue, 'Priority'));
  const typeName = fieldPresentation(youTrackField(issue, 'Type'));
  const reporter = actorFor(issue.reporter, job);
  const assigneeActors = issueAssignees(issue, job);
  const watcherActors = (issue.watchers?.users || []).map(user => actorFor(user, job));
  const tags = sourceTags(issue);
  const dueDate = fieldTimestamp(youTrackField(issue, 'Due Date'));
  const estimateMinutes = fieldMinutes(youTrackField(issue, 'Estimation'));
  const sourceCreatedAt = timestamp(issue.created, Timestamp.now());
  const sourceUpdatedAt = timestamp(issue.updated, sourceCreatedAt);
  const currentImportAt = timestamp(job.createdAt, Timestamp.now());

  const importedFields = {
    title: String(issue.summary || issue.idReadable || 'Без назви').trim().slice(0, 240),
    description: String(issue.description || '').slice(0, 50_000),
    assigneeIds: assigneeActors.filter(actor => !actor.external).map(actor => actor.id).slice(0, 20),
    watcherIds: watcherActors.filter(actor => !actor.external).map(actor => actor.id).slice(0, 50),
    dueDate: dueDate ? timestamp(dueDate) : null,
    estimateMinutes,
    attachments,
    reporterId: reporter.id,
    reporterName: reporter.name,
    source: 'youtrack',
    sourceKey: String(issue.idReadable || issue.id),
    importMetadata: {
      provider: 'youtrack',
      connectionId: job.connectionId,
      externalId: String(issue.id),
      externalReadableId: String(issue.idReadable || ''),
      sourceProjectId: sourceProject.id,
      sourceProjectKey: sourceProject.shortName,
      sourceUrl: `${job.baseUrl}/issue/${encodeURIComponent(issue.idReadable || issue.id)}`,
      externalReporter: reporter.external ? reporter : null,
      externalAssignees: assigneeActors.filter(actor => actor.external),
      externalWatchers: watcherActors.filter(actor => actor.external),
      tags,
      customFields: serializeCustomFields(issue.customFields),
      adapterVersion: 2,
      mappingVersion: 4,
    },
    createdAt: sourceCreatedAt,
    updatedAt: sourceUpdatedAt,
  };
  // What the task carries about its origin, and what goes to the subcollection
  // nothing subscribes to. The raw record — every custom field YouTrack had on
  // the issue, every external person on it — used to sit on the task document
  // itself, which meant every board delivered it to every browser to draw cards
  // that show none of it. See `src/lib/utils/issueImportRecord.mjs` for the
  // measurement that decided the split.
  const importRecord = splitIssueImportRecord(importedFields.importMetadata);
  importedFields.importMetadata = importRecord.carried;

  const actors = [reporter, ...assigneeActors, ...watcherActors];

  if (existingIssue?.exists) {
    const updateResult = await db.runTransaction(async transaction => {
      const [projectSnapshot, currentIssueSnapshot, freshLink, workflowSnapshot] = await Promise.all([
        transaction.get(projectRef),
        transaction.get(existingIssue.ref),
        transaction.get(linkRef),
        transaction.get(workflowRef),
      ]);
      if (
        !projectSnapshot.exists
        || projectSnapshot.data().organizationId !== job.organizationId
      ) {
        throw new Error('Проєкт-призначення не знайдено');
      }
      if (projectSnapshot.data().deletionPending === true) {
        throw new Error('Проєкт-призначення вже видаляється');
      }
      if (
        !currentIssueSnapshot.exists
        || !freshLink.exists
        || freshLink.data().quickTeamId !== currentIssueSnapshot.id
      ) {
        throw new Error('Імпортована задача була видалена під час оновлення');
      }
      const currentIssue = issueRecord(currentIssueSnapshot);
      if (!sameIssueScope(currentIssue, job.organizationId, targetProjectId)) {
        throw new Error('Імпортована задача більше не належить проєкту-призначенню');
      }
      if (currentIssue.deletionPending === true) {
        throw new Error('Імпортовану задачу вже видаляють');
      }

      const project = projectSnapshot.data();
      const freshWorkflow = workflowValues(workflowSnapshot);
      const workflowFields = importedWorkflowFields({
        issue,
        project,
        workflow: freshWorkflow,
        stateName,
        explicitStatusId,
        priorityName,
        typeName,
        tags,
      });
      const currentStatus = currentIssue.columnId || currentIssue.status || null;
      const nextStatus = workflowFields.status;
      const closedStatusSet = new Set(workflowFields.closedStatusIds);
      const enteringTerminal = (
        !closedStatusSet.has(currentStatus)
        && closedStatusSet.has(nextStatus)
      );
      const leavingTerminal = (
        closedStatusSet.has(currentStatus)
        && !closedStatusSet.has(nextStatus)
      );
      let transitionError = null;

      if (currentStatus !== nextStatus && (enteringTerminal || leavingTerminal)) {
        let childDocuments = [];
        if (enteringTerminal) {
          const canonicalChildren = await transaction.get(
            db.collection('issues').where('parentIssueId', '==', currentIssue.id),
          );
          const legacyChildren = await transaction.get(
            db.collection('issues').where('parentEpicId', '==', currentIssue.id),
          );
          childDocuments = [...new Map(
            [...canonicalChildren.docs, ...legacyChildren.docs]
              .map(document => [document.id, document]),
          ).values()];
        }

        const links = db.collection('issueLinks');
        const sourceLinks = await transaction.get(
          links.where('sourceIssueId', '==', currentIssue.id),
        );
        const targetLinks = await transaction.get(
          links.where('targetIssueId', '==', currentIssue.id),
        );
        const rawLinks = [...new Map(
          [...sourceLinks.docs, ...targetLinks.docs]
            .filter(document => {
              const link = document.data();
              return link.organizationId === job.organizationId
                && (!link.projectId || link.projectId === targetProjectId);
            })
            .map(document => [document.id, serializedLink(document)]),
        ).values()];
        const parentIssueId = leavingTerminal
          ? existingParentIssueId(currentIssue)
          : null;
        const relatedIssueIds = normalizedIssueBlockEdges(rawLinks)
          .flatMap(link => [link.sourceIssueId, link.targetIssueId])
          .filter(id => id && id !== currentIssue.id);
        const additionalIssueIds = [...new Set([
          ...relatedIssueIds,
          ...(parentIssueId ? [parentIssueId] : []),
        ])];
        const additionalDocuments = await transactionGetAll(
          transaction,
          additionalIssueIds.map(id => db.collection('issues').doc(id)),
        );
        const childIssues = childDocuments
          .map(issueRecord)
          .filter(child => sameIssueScope(child, job.organizationId, targetProjectId));
        const relatedIssues = additionalDocuments
          .map(issueRecord)
          .filter(related => sameIssueScope(related, job.organizationId, targetProjectId));
        const parentIssue = parentIssueId
          ? relatedIssues.find(related => related.id === parentIssueId) || null
          : null;
        transitionError = evaluateIssueStatusTransition({
          issueId: currentIssue.id,
          issue: currentIssue,
          nextStatusId: nextStatus,
          closedStatusIds: workflowFields.closedStatusIds,
          childIssues,
          parentIssue,
          issueLinks: rawLinks,
          relatedIssues,
        }).error;
      }

      const acceptedWorkflowFields = {
        priority: workflowFields.priority,
        type: workflowFields.type,
        labelIds: workflowFields.labelIds,
      };
      if (!transitionError) {
        acceptedWorkflowFields.columnId = nextStatus;
        acceptedWorkflowFields.status = nextStatus;
        acceptedWorkflowFields.completedAt = closedStatusSet.has(nextStatus)
          ? timestamp(issue.resolved || issue.updated, sourceUpdatedAt)
          : FieldValue.delete();
      }
      const firstImportedAt = timestamp(
        currentIssue.importedAt || currentIssue.importMetadata?.importedAt,
        currentImportAt,
      );
      transaction.set(existingIssue.ref, {
        ...importedFields,
        importedAt: firstImportedAt,
        importMetadata: {
          ...importedFields.importMetadata,
          importedAt: firstImportedAt,
        },
        ...acceptedWorkflowFields,
      }, { merge: true });
      // Written whole rather than merged: a re-import is what the source says
      // now, and a custom field somebody deleted in YouTrack must not survive
      // here because the last import happened to mention it.
      if (importRecord.hasArchive) {
        transaction.set(
          existingIssue.ref.collection(ISSUE_IMPORT_COLLECTION).doc(ISSUE_IMPORT_DOCUMENT),
          { ...importRecord.archived, importedAt: firstImportedAt },
        );
      }
      transaction.set(linkRef, {
        externalUpdatedAt: sourceUpdatedAt,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      if (!transitionError && currentStatus !== nextStatus) {
        transaction.update(projectRef, {
          issueStatusVersion: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return {
        warning: transitionError
          ? `Статус ${issue.idReadable || issue.id} не імпортовано: ${transitionError.message}`
          : null,
      };
    });
    return {
      issueId: existingIssue.id,
      created: false,
      actors,
      warnings: updateResult.warning ? [updateResult.warning] : [],
    };
  }

  const issueRef = db.collection('issues').doc();
  const creationResult = await db.runTransaction(async transaction => {
    const [freshLink, projectSnapshot, workflowSnapshot] = await Promise.all([
      transaction.get(linkRef),
      transaction.get(projectRef),
      transaction.get(workflowRef),
    ]);
    if (freshLink.exists) {
      const linkedIssue = await transaction.get(
        db.collection('issues').doc(freshLink.data().quickTeamId),
      );
      const linkedIssueData = issueRecord(linkedIssue);
      if (
        !sameIssueScope(linkedIssueData, job.organizationId, targetProjectId)
        || linkedIssueData.deletionPending === true
      ) {
        throw new Error('Імпортована задача була змінена або видаляється');
      }
      return { issueId: linkedIssue.id, created: false };
    }
    if (!projectSnapshot.exists || projectSnapshot.data().organizationId !== job.organizationId) {
      throw new Error('Проєкт-призначення не знайдено');
    }
    if (projectSnapshot.data().deletionPending === true) {
      throw new Error('Проєкт-призначення вже видаляється');
    }
    const project = projectSnapshot.data();
    const freshWorkflow = workflowValues(workflowSnapshot);
    const workflowFields = importedWorkflowFields({
      issue,
      project,
      workflow: freshWorkflow,
      stateName,
      explicitStatusId,
      priorityName,
      typeName,
      tags,
    });
    const { closedStatusIds, ...persistedWorkflowFields } = workflowFields;
    const next = (project.issueCounter || 0) + 1;
    const issuePrefix = await resolveProjectIssuePrefixInTransaction({
      db,
      transaction,
      project,
      projectId: targetProjectId,
      organizationId: job.organizationId,
    });
    const issueKey = `${issuePrefix}-${next}`;
    transaction.create(issueRef, {
      ...importedFields,
      importedAt: currentImportAt,
      importMetadata: {
        ...importedFields.importMetadata,
        importedAt: currentImportAt,
      },
      ...persistedWorkflowFields,
      ...(closedStatusIds.includes(workflowFields.status)
        ? { completedAt: timestamp(issue.resolved || issue.updated, sourceUpdatedAt) }
        : {}),
      organizationId: job.organizationId,
      projectId: targetProjectId,
      issueKey,
      sprintId: null,
      parentIssueId: null,
      spentMinutes: 0,
      spentMinutesMirrorVersion: 1,
      timeLogMutationVersion: 0,
      // One sign for the whole collection: a task nobody has positioned yet
      // sorts above the ones somebody has, newest first. `+next` put an
      // imported task below every card on the board instead, and mixed the two
      // conventions inside one column.
      order: -next,
      createdBy: job.createdBy,
    });
    if (importRecord.hasArchive) {
      transaction.create(
        issueRef.collection(ISSUE_IMPORT_COLLECTION).doc(ISSUE_IMPORT_DOCUMENT),
        { ...importRecord.archived, importedAt: currentImportAt },
      );
    }
    transaction.update(projectRef, {
      issueCounter: next,
      ...(!isValidIssuePrefix(project.issuePrefix) ? { issuePrefix } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(linkRef, {
      provider: 'youtrack',
      organizationId: job.organizationId,
      connectionId: job.connectionId,
      entityType: 'issue',
      externalId: String(issue.id),
      externalReadableId: String(issue.idReadable || ''),
      quickTeamId: issueRef.id,
      externalUpdatedAt: sourceUpdatedAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(issueRef.collection('audit').doc(`import_${hashId(job.connectionId, issue.id).slice(0, 24)}`), {
      userId: job.createdBy,
      userName: 'YouTrack Import',
      action: 'imported',
      from: String(issue.idReadable || issue.id),
      to: issueKey,
      createdAt: sourceCreatedAt,
    });
    return { issueId: issueRef.id, created: true };
  });
  return {
    ...creationResult,
    actors,
    warnings: [],
  };
}

async function importComments({ job, issueId, projectId, comments }) {
  if (!comments.length) return [];
  const db = getAdminDb();
  const issueRef = db.collection('issues').doc(issueId);
  const projectRef = db.collection('projects').doc(projectId);
  const actors = [];
  const rows = comments.map(comment => {
    const actor = actorFor(comment.author, job);
    actors.push(actor);
    return {
      ref: issueRef.collection('comments')
        .doc(`yt_${hashId(job.connectionId, comment.id).slice(0, 36)}`),
      fields: {
        authorId: actor.id,
        authorName: actor.name,
        authorAvatar: actor.avatar,
        text: comment.deleted ? '[Коментар видалено в YouTrack]' : String(comment.text || '').slice(0, 50_000),
        attachments: [],
        readBy: [],
        replyTo: null,
        source: 'youtrack',
        sourceId: String(comment.id),
        createdAt: timestamp(comment.created, Timestamp.now()),
        ...(comment.updated && comment.updated !== comment.created
          ? { editedAt: timestamp(comment.updated) }
          : {}),
      },
    };
  });

  for (let offset = 0; offset < rows.length; offset += 350) {
    const chunk = rows.slice(offset, offset + 350);
    await db.runTransaction(async transaction => {
      const [issueSnapshot, projectSnapshot] = await Promise.all([
        transaction.get(issueRef),
        transaction.get(projectRef),
      ]);
      if (
        !issueSnapshot.exists
        || issueSnapshot.data().organizationId !== job.organizationId
        || issueSnapshot.data().projectId !== projectId
        || issueSnapshot.data().deletionPending === true
      ) {
        throw new Error('Задача була змінена або видаляється під час імпорту коментарів');
      }
      if (
        !projectSnapshot.exists
        || projectSnapshot.data().organizationId !== job.organizationId
        || projectSnapshot.data().deletionPending === true
      ) {
        throw new Error('Проєкт був змінений або видаляється під час імпорту коментарів');
      }
      chunk.forEach(row => transaction.set(row.ref, row.fields, { merge: true }));
      transaction.update(issueRef, {
        commentCount: comments.length,
      });
    });
  }
  return actors;
}

async function importWorkItems({
  job,
  issueId,
  projectId,
  sourceKey = '',
  sourceTitle = '',
  workItems,
}) {
  const normalizedItems = workItems.map(item => ({
    item,
    spentMinutes: Math.round(Number(item?.duration?.minutes)),
  }));
  const validItems = normalizedItems.filter(({ item, spentMinutes }) => (
    item?.id
    && Number.isSafeInteger(spentMinutes)
    && spentMinutes > 0
    && spentMinutes <= 525_600
  ));
  const invalidWorkItemCount = normalizedItems.length - validItems.length;
  const invalidWarnings = invalidWorkItemCount > 0
    ? [
      `Пропущено ${invalidWorkItemCount} ${plural(invalidWorkItemCount, ['запис', 'записи', 'записів'])} часу YouTrack з некоректною тривалістю або ID`,
    ]
    : [];
  if (!validItems.length) {
    return { actors: [], warnings: invalidWarnings };
  }
  const db = getAdminDb();
  const rollupTimeZone = await organizationRollupTimeZone(db, job.organizationId);
  const issueRef = db.collection('issues').doc(issueId);
  const projectRef = db.collection('projects').doc(projectId);
  const estimateReservationRef = db.collection('invoiceEstimateReservations').doc(
    invoiceSourcelessReservationId(job.organizationId, projectId, issueId),
  );
  const actors = [];
  const rows = validItems.map(({ item, spentMinutes }) => {
    const actor = actorFor(item.author || item.creator, job);
    actors.push(actor);
    return {
      id: String(item.id),
      ref: db.collection('timeLogs')
        .doc(`yt_${hashId(job.connectionId, item.id).slice(0, 36)}`),
      fields: {
        issueId,
        projectId,
        sourceKey: String(sourceKey || '').slice(0, 120),
        sourceTitle: String(sourceTitle || '').slice(0, 500),
        userId: actor.id,
        organizationId: job.organizationId,
        spentMinutes,
        description: String(item.text || item.type?.name || '').slice(0, 5_000),
        loggedAt: timestamp(item.date || item.created, Timestamp.now()),
        source: 'youtrack',
        sourceId: String(item.id),
        externalActor: actor.external ? actor : null,
      },
    };
  });
  const billedSourceIds = new Set();

  for (let offset = 0; offset < rows.length; offset += 350) {
    const chunk = rows.slice(offset, offset + 350);
    const skipped = await db.runTransaction(async transaction => {
      const [
        issueSnapshot,
        projectSnapshot,
        estimateReservationSnapshot,
        ...timeLogSnapshots
      ] = await Promise.all([
        transaction.get(issueRef),
        transaction.get(projectRef),
        transaction.get(estimateReservationRef),
        ...chunk.map(row => transaction.get(row.ref)),
      ]);
      if (
        !issueSnapshot.exists
        || issueSnapshot.data().organizationId !== job.organizationId
        || issueSnapshot.data().projectId !== projectId
        || issueSnapshot.data().deletionPending === true
      ) {
        throw new Error('Задача була змінена або видаляється під час імпорту часу');
      }
      if (
        !projectSnapshot.exists
        || projectSnapshot.data().organizationId !== job.organizationId
        || projectSnapshot.data().deletionPending === true
        || projectSnapshot.data().status === 'archived'
      ) {
        throw new Error('Проєкт був змінений або видаляється під час імпорту часу');
      }

      const issue = issueSnapshot.data();
      const skippedIds = [];
      let spentMinutesDelta = 0;
      const changedRows = [];
      chunk.forEach((row, index) => {
        const currentSnapshot = timeLogSnapshots[index];
        const current = currentSnapshot.exists ? currentSnapshot.data() : null;
        if (
          current
          && (
            current.organizationId !== job.organizationId
            || current.projectId !== projectId
            || current.issueId !== issueId
          )
        ) {
          throw new Error(`Запис часу ${row.id} вже належить іншій задачі`);
        }
        if (current && isBilledTimeLog(current)) {
          skippedIds.push(row.id);
          return;
        }
        if (
          current
          && (
            !Number.isSafeInteger(current.spentMinutes)
            || current.spentMinutes <= 0
            || current.spentMinutes > 525_600
          )
        ) {
          throw new Error(
            `Запис часу ${row.id} потребує звірки перед імпортом`,
          );
        }
        if (youTrackImportedWorkLogMatches(current, row.fields)) return;
        spentMinutesDelta += row.fields.spentMinutes - (current?.spentMinutes || 0);
        changedRows.push({ ...row, previous: current });
      });

      const changedLogs = changedRows.length;
      if (changedLogs === 0) return skippedIds;
      if (estimateReservationSnapshot.exists) {
        const reservation = estimateReservationSnapshot.data();
        if (!isTaskEstimateReservationIdentity(reservation, {
          issueId,
          organizationId: job.organizationId,
          projectId,
        })) {
          const error = new Error(
            'Резерв оцінки задачі має некоректну область. Потрібна звірка рахунку перед імпортом часу',
          );
          error.code = 'YOUTRACK_TIME_ESTIMATE_RESERVATION_SCOPE_CONFLICT';
          throw error;
        }
        const error = new Error(
          'Оцінку цієї задачі вже включено до рахунку, тому імпортувати новий або змінений фактичний час не можна',
        );
        error.code = 'YOUTRACK_TIME_ESTIMATE_ALREADY_INVOICED';
        throw error;
      }

      let initializeSpentMinutesMirror = false;
      if (issue.spentMinutesMirrorVersion !== 1) {
        const existingLogs = await transaction.get(
          db.collection('timeLogs')
            .where('issueId', '==', issueId)
            .limit(1),
        );
        if (!existingLogs.empty) {
          throw new Error(
            'Історичні записи часу треба звірити перед імпортом нових',
          );
        }
        initializeSpentMinutesMirror = true;
      }

      const mirrorTransition = taskTimeLogMirrorTransition({
        currentSpentMinutes: issue.spentMinutes,
        spentMinutesDelta,
        initialize: initializeSpentMinutesMirror,
      });
      if (!mirrorTransition) {
        throw new Error(
          'Підсумок часу завдання потребує звірки перед імпортом',
        );
      }
      // An import is an edit like any other, so the daily totals move by the
      // difference: the row as it stood is taken out and the row as imported is
      // put in. A re-import of the same worklog is not a second contribution —
      // it does not reach here at all, because an unchanged row is skipped above.
      const rollupDeltas = new AnalyticsRollupDeltas(rollupTimeZone);
      const issueCancelled = Boolean(issue.cancelledAt);
      changedRows.forEach(row => {
        if (row.previous) {
          rollupDeltas.add(row.previous, -1, { cancelled: issueCancelled });
        }
        rollupDeltas.add(row.fields, 1, { cancelled: issueCancelled });
        transaction.set(row.ref, row.fields, { merge: true });
      });
      writeAnalyticsRollupDeltas({ writer: transaction, db, deltas: rollupDeltas });
      transaction.update(issueRef, {
        spentMinutes: initializeSpentMinutesMirror
          ? mirrorTransition.next
          : FieldValue.increment(spentMinutesDelta),
        spentMinutesMirrorVersion: 1,
        timeLogMutationVersion: FieldValue.increment(1),
      });
      transaction.update(projectRef, {
        timeLogImportVersion: FieldValue.increment(1),
        invoiceMutationVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return skippedIds;
    });
    skipped.forEach(id => billedSourceIds.add(id));
  }

  return {
    actors,
    warnings: [
      ...invalidWarnings,
      ...(billedSourceIds.size > 0
        ? [
        `Не оновлено ${billedSourceIds.size} виставлених у рахунок записів часу YouTrack: ${
          [...billedSourceIds].slice(0, 20).join(', ')
        }`,
          ]
        : []),
    ],
  };
}

async function enqueueLinks(jobRef, job, sourceIssue, links) {
  const candidateRows = links.flatMap(link => (link.issues || []).flatMap(target => {
    if (!target?.id || String(target.id) === String(sourceIssue.id)) return [];
    const normalized = normalizeYouTrackRelation(link.linkType, link.direction);
    const sourceExternalId = String(normalized.reverse ? target.id : sourceIssue.id);
    const targetExternalId = String(normalized.reverse ? sourceIssue.id : target.id);
    const pair = [sourceExternalId, targetExternalId].sort();
    const id = hashId(job.connectionId, 'issue-link-v2', pair[0], pair[1]);
    return [{
      id,
      sourceExternalId,
      targetExternalId,
      targetReadableId: String(target.idReadable || ''),
      relationType: normalized.relationType,
      hierarchyHint: normalized.hierarchyHint,
      externalRelation: String(link.linkType?.name || ''),
    }];
  }));
  // QuickTeam deliberately allows one logical relation per issue pair. When
  // YouTrack exposes more than one, select the strongest meaning
  // deterministically so import order cannot change the result.
  const rowsById = new Map();
  for (const row of candidateRows) {
    rowsById.set(
      row.id,
      strongestYouTrackRelationRow(rowsById.get(row.id), row),
    );
  }
  const rows = [...rowsById.values()];
  if (!rows.length) return;
  const db = getAdminDb();
  for (let offset = 0; offset < rows.length; offset += 350) {
    const chunk = rows.slice(offset, offset + 350);
    await db.runTransaction(async transaction => {
      const refs = chunk.map(row => jobRef.collection('links').doc(row.id));
      const existing = await transaction.getAll(...refs);
      chunk.forEach((row, index) => {
        const snapshot = existing[index];
        if (!snapshot.exists) {
          transaction.create(snapshot.ref, {
            ...row,
            status: 'pending',
            createdAt: FieldValue.serverTimestamp(),
          });
          return;
        }
        if (snapshot.data().status !== 'pending') return;
        const strongest = strongestYouTrackRelationRow(snapshot.data(), row);
        if (
          strongest.relationType !== snapshot.data().relationType
          || strongest.sourceExternalId !== snapshot.data().sourceExternalId
          || strongest.targetExternalId !== snapshot.data().targetExternalId
          || strongest.hierarchyHint !== (snapshot.data().hierarchyHint === true)
          || strongest.externalRelation !== snapshot.data().externalRelation
          || strongest.targetReadableId !== snapshot.data().targetReadableId
        ) {
          transaction.update(snapshot.ref, {
            sourceExternalId: strongest.sourceExternalId,
            targetExternalId: strongest.targetExternalId,
            targetReadableId: strongest.targetReadableId,
            relationType: strongest.relationType,
            hierarchyHint: strongest.hierarchyHint === true,
            externalRelation: strongest.externalRelation,
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    });
  }
}

async function processIssue(jobRef, job, queueItem) {
  const { client } = await youTrackClientFor(job.organizationId);
  const sourceProject = job.sourceProjects.find(project => project.id === queueItem.sourceProjectId);
  if (!sourceProject) throw new Error('Джерельний проєкт не знайдено у job');
  const targetProjectId = await ensureTargetProject(job, sourceProject);
  const issue = await client.issue(queueItem.sourceIssueId);
  const issueLink = await externalLinkRef(job.organizationId, job.connectionId, 'issue', issue.id).get();
  const existingIssue = issueLink.exists
    ? await getAdminDb().collection('issues').doc(issueLink.data().quickTeamId).get()
    : null;
  const [comments, workItems, links, attachmentResult] = await Promise.all([
    client.comments(issue.id),
    client.workItems(issue.id),
    client.links(issue.id),
    importAttachments({
      client,
      job,
      issue,
      existingAttachments: existingIssue?.exists ? existingIssue.data().attachments || [] : [],
    }),
  ]);
  const saved = await upsertIssue({
    job,
    sourceProject,
    issue,
    targetProjectId,
    attachments: attachmentResult.attachments,
  });
  const [commentActors, workItemResult] = await Promise.all([
    importComments({
      job,
      issueId: saved.issueId,
      projectId: targetProjectId,
      comments,
    }),
    importWorkItems({ job, issueId: saved.issueId, projectId: targetProjectId,
      sourceKey: issue.idReadable || '',
      sourceTitle: issue.summary || '',
      workItems,
    }),
  ]);
  await Promise.all([
    saveExternalActors(job, [...saved.actors, ...commentActors, ...workItemResult.actors]),
    enqueueLinks(jobRef, job, issue, links),
  ]);
  return {
    issueId: saved.issueId,
    created: saved.created,
    warnings: [
      ...attachmentResult.warnings,
      ...(saved.warnings || []),
      ...workItemResult.warnings,
    ],
  };
}

async function processPendingLink(jobRef, job) {
  const pending = await jobRef.collection('links').where('status', '==', 'pending').limit(1).get();
  if (pending.empty) return null;
  const rowSnapshot = pending.docs[0];
  const row = rowSnapshot.data();
  const [source, target] = await Promise.all([
    externalLinkRef(job.organizationId, job.connectionId, 'issue', row.sourceExternalId).get(),
    externalLinkRef(job.organizationId, job.connectionId, 'issue', row.targetExternalId).get(),
  ]);
  if (!source.exists || !target.exists || source.data().quickTeamId === target.data().quickTeamId) {
    await rowSnapshot.ref.update({
      status: 'skipped',
      reason: 'Пов’язана задача не входить до імпорту',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: true };
  }

  const sourceId = source.data().quickTeamId;
  const targetId = target.data().quickTeamId;
  const db = getAdminDb();
  const [sourceIssue, targetIssue] = await Promise.all([
    db.collection('issues').doc(sourceId).get(),
    db.collection('issues').doc(targetId).get(),
  ]);
  if (
    !sourceIssue.exists
    || !targetIssue.exists
    || sourceIssue.data().organizationId !== job.organizationId
    || targetIssue.data().organizationId !== job.organizationId
    || !sourceIssue.data().projectId
    || sourceIssue.data().projectId !== targetIssue.data().projectId
  ) {
    await rowSnapshot.ref.update({
      status: 'skipped',
      reason: 'Зв’язок між різними проєктами або недоступними задачами не імпортовано',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: true };
  }

  const canonical = canonicalizeRequestedIssueLink({
    sourceIssueId: sourceId,
    targetIssueId: targetId,
    relationType: row.relationType,
  });
  const linkId = canonical && canonicalIssueLinkDocumentId({
    organizationId: job.organizationId,
    projectId: sourceIssue.data().projectId,
    ...canonical,
  });
  if (!canonical || !linkId) {
    await rowSnapshot.ref.update({
      status: 'skipped',
      reason: 'Некоректний тип або напрямок зв’язку',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: true };
  }

  const linkRef = db.collection('issueLinks').doc(linkId);
  const projectId = sourceIssue.data().projectId;
  const projectRef = db.collection('projects').doc(projectId);
  const workflowRef = db.collection('organizations')
    .doc(job.organizationId)
    .collection('settings')
    .doc('workflow');
  return db.runTransaction(async transaction => {
    const freshRow = await transaction.get(rowSnapshot.ref);
    const freshSource = await transaction.get(db.collection('issues').doc(sourceId));
    const freshTarget = await transaction.get(db.collection('issues').doc(targetId));
    const existingLink = await transaction.get(linkRef);
    const projectSnapshot = await transaction.get(projectRef);
    const workflowSnapshot = await transaction.get(workflowRef);
    const organizationRelations = await transaction.get(
      db.collection('issueLinks').where('organizationId', '==', job.organizationId),
    );
    const projectIssues = await transaction.get(
      db.collection('issues').where('projectId', '==', projectId),
    );

    if (!freshRow.exists || freshRow.data().status !== 'pending') {
      return { skipped: freshRow.data()?.status === 'skipped' };
    }
    if (
      !freshSource.exists
      || !freshTarget.exists
      || freshSource.data().organizationId !== job.organizationId
      || freshTarget.data().organizationId !== job.organizationId
      || freshSource.data().projectId !== projectId
      || freshTarget.data().projectId !== projectId
      || freshSource.data().deletionPending === true
      || freshTarget.data().deletionPending === true
      || !projectSnapshot.exists
      || projectSnapshot.data().organizationId !== job.organizationId
      || projectSnapshot.data().deletionPending === true
    ) {
      transaction.update(rowSnapshot.ref, {
        status: 'skipped',
        reason: projectSnapshot.data()?.deletionPending === true
          ? 'Проєкт уже видаляється'
          : freshSource.data()?.deletionPending === true
            || freshTarget.data()?.deletionPending === true
            ? 'Одну з пов’язаних задач уже видаляють'
          : 'Проєкт або одна з пов’язаних задач змінилися під час імпорту',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { skipped: true };
    }

    const isSameCanonicalLink = existingLink.exists
      && existingLink.data().relationType === canonical.relationType
      && existingLink.data().sourceIssueId === canonical.sourceIssueId
      && existingLink.data().targetIssueId === canonical.targetIssueId;
    if (existingLink.exists && !isSameCanonicalLink) {
      transaction.update(rowSnapshot.ref, {
        status: 'skipped',
        reason: 'Для цієї пари задач уже існує інший логічний зв’язок',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { skipped: true };
    }

    const pairHasLegacyLink = !existingLink.exists
      && organizationRelations.docs.some(document => {
        const data = document.data();
        return (
          (data.sourceIssueId === sourceId && data.targetIssueId === targetId)
          || (data.sourceIssueId === targetId && data.targetIssueId === sourceId)
        );
      });
    if (pairHasLegacyLink) {
      transaction.update(rowSnapshot.ref, {
        status: 'skipped',
        reason: 'Для цієї пари вже є старий зв’язок. Спершу виконайте міграцію зв’язків',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { skipped: true };
    }

    if (!existingLink.exists) {
      const closedStatusIds = resolveClosedStatusIds(
        workflowValues(workflowSnapshot).statuses,
      );
      const statusConflict = issueBlockLinkStatusConflict({
        sourceIssue: {
          ...freshSource.data(),
          id: freshSource.id,
        },
        targetIssue: {
          ...freshTarget.data(),
          id: freshTarget.id,
        },
        relationType: canonical.relationType,
        closedStatusIds,
      });
      if (statusConflict) {
        transaction.update(rowSnapshot.ref, {
          status: 'skipped',
          reason: statusConflict.message,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { skipped: true };
      }

      const graphLinks = normalizeStoredIssueLinks(
        organizationRelations.docs.map(document => ({
          ...document.data(),
          id: document.id,
        })),
      );
      const knownIssueIds = projectIssues.docs
        .filter(document => document.data().organizationId === job.organizationId)
        .map(document => document.id);
      const cyclePath = findDirectionalIssueLinkCycle({
        ...canonical,
        links: graphLinks,
        knownIssueIds,
      });
      if (cyclePath) {
        transaction.update(rowSnapshot.ref, {
          status: 'skipped',
          reason: canonical.relationType === 'blocks'
            ? `Зв’язок створив би циклічну залежність: ${cyclePath.join(' → ')}`
            : `Зв’язок створив би циклічний ланцюг дублікатів: ${cyclePath.join(' → ')}`,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { skipped: true };
      }
    }

    if (!existingLink.exists) {
      transaction.create(linkRef, {
        schemaVersion: 2,
        organizationId: job.organizationId,
        projectId,
        ...canonical,
        source: 'youtrack',
        externalRelation: row.externalRelation,
        ...(row.hierarchyHint ? {
          requiresReview: true,
          legacyRelationType: 'youtrack-hierarchy',
        } : {}),
        createdBy: job.createdBy,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(projectRef, {
        issueLinkVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    transaction.update(rowSnapshot.ref, {
      status: 'completed',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { skipped: false };
  });
}

export async function prepareYouTrackImport({
  organizationId,
  userId,
  selectedProjectIds,
  projectMappings = {},
  userMappings = {},
  statusFilters = {},
  statusMappings = {},
}) {
  const selected = [...new Set((selectedProjectIds || []).filter(Boolean))].slice(0, 20);
  if (!selected.length) throw new Error('Оберіть хоча б один проєкт YouTrack');
  // The same rule from the other side. Refusing to let somebody continue or
  // stop another person's import means nothing if they can simply start a
  // second one on top of it — two importers writing the same projects from two
  // mappings is the collision the rule exists to prevent.
  await assertNoForeignActiveImport(organizationId, userId);
  const { client, connection } = await youTrackClientFor(organizationId);
  const allProjects = await client.projects();
  const sourceProjects = allProjects
    .filter(project => selected.includes(String(project.id)) && !project.archived)
    .map(project => ({
      id: String(project.id),
      name: String(project.name || project.shortName || 'Без назви'),
      shortName: String(project.shortName || project.id),
      description: String(project.description || ''),
    }));
  if (sourceProjects.length !== selected.length) throw new Error('Один із вибраних проєктів недоступний');

  const mappedUids = [...new Set(Object.values(userMappings).filter(value => value && value !== 'external'))];
  if (mappedUids.length) {
    const memberships = await getAdminDb().getAll(
      ...mappedUids.map(uid => getAdminDb().collection('orgMemberships').doc(`${organizationId}_${uid}`)),
    );
    if (memberships.some((snapshot, index) => (
      !snapshot.exists || snapshot.data().orgId !== organizationId || snapshot.data().userId !== mappedUids[index]
    ))) {
      throw new Error('Один із користувачів більше не належить до організації');
    }
  }

  const targetIds = [...new Set(
    Object.values(projectMappings).filter(value => value && value !== 'create'),
  )];
  let targetSnapshots = [];
  if (targetIds.length) {
    targetSnapshots = await getAdminDb().getAll(
      ...targetIds.map(id => getAdminDb().collection('projects').doc(id)),
    );
    if (targetSnapshots.some(snapshot => !snapshot.exists || snapshot.data().organizationId !== organizationId)) {
      throw new Error('Один із проєктів-призначень недоступний');
    }
  }

  const workflowSnapshot = await getAdminDb().collection('organizations').doc(organizationId)
    .collection('settings').doc('workflow').get();
  const workflow = workflowValues(workflowSnapshot);
  const availableStatusIds = new Set(workflow.statuses.map(status => status?.id).filter(Boolean));
  const targetById = new Map(targetSnapshots.map(snapshot => [snapshot.id, snapshot.data()]));
  const sanitizedStatusMappings = sourceProjects.flatMap(sourceProject => {
    const rawProjectMappings = statusMappings?.[sourceProject.id];
    if (!rawProjectMappings || typeof rawProjectMappings !== 'object' || Array.isArray(rawProjectMappings)) {
      return [];
    }
    const targetProject = targetById.get(projectMappings[sourceProject.id]);
    const hiddenStatusIds = new Set(
      Array.isArray(targetProject?.hiddenColumns) ? targetProject.hiddenColumns : [],
    );
    return Object.entries(rawProjectMappings).slice(0, 200).flatMap(([rawSource, rawTarget]) => {
      const sourceStatus = String(rawSource || '').trim().slice(0, 200);
      const targetStatusId = String(rawTarget || '').trim().slice(0, 200);
      if (!sourceStatus || !targetStatusId) return [];
      if (!availableStatusIds.has(targetStatusId)) {
        throw new Error(`Статус QuickTeam для «${sourceStatus}» більше не існує`);
      }
      if (hiddenStatusIds.has(targetStatusId)) {
        throw new Error(`Обраний статус для «${sourceStatus}» приховано у проєкті-призначенні`);
      }
      return [{ sourceProjectId: sourceProject.id, sourceStatus, targetStatusId }];
    });
  });

  const queue = [];
  const normalizedStatusFilters = {};
  const selectedStatusKeys = new Set();
  for (const sourceProject of sourceProjects) {
    const stubs = await client.issueStubs(sourceProject.shortName);
    const hasStatusFilter = Object.prototype.hasOwnProperty.call(statusFilters || {}, sourceProject.id);
    if (!hasStatusFilter) {
      throw new Error(`Оберіть статуси задач для проєкту ${sourceProject.name}`);
    }
    const selectedStatuses = [...new Set((statusFilters[sourceProject.id] || [])
      .map(value => String(value || '').trim())
      .filter(Boolean))]
      .slice(0, 200);
    if (!selectedStatuses.length) {
      throw new Error(`Оберіть хоча б один статус для проєкту ${sourceProject.name}`);
    }
    normalizedStatusFilters[sourceProject.id] = selectedStatuses;
    selectedStatuses.forEach(sourceStatus => {
      const mappingKey = `${sourceProject.id}\u0000${normalizeMappingKey(sourceStatus)}`;
      selectedStatusKeys.add(mappingKey);
      const hasMapping = sanitizedStatusMappings.some(mapping => (
        mapping.sourceProjectId === sourceProject.id
        && normalizeMappingKey(mapping.sourceStatus) === normalizeMappingKey(sourceStatus)
      ));
      if (!hasMapping) {
        throw new Error(`Оберіть статус QuickTeam для «${sourceStatus}»`);
      }
    });
    const filteredStubs = filterYouTrackIssuesByStatuses(stubs, selectedStatuses);
    filteredStubs.forEach(issue => queue.push({
      sourceProjectId: sourceProject.id,
      sourceIssueId: String(issue.id),
      sourceReadableId: String(issue.idReadable || ''),
      title: String(issue.summary || issue.idReadable || ''),
      sourceUpdatedAt: issue.updated || null,
    }));
    if (queue.length > 100_000) throw new Error('Один імпорт обмежений 100 000 задач');
  }

  const jobRef = getAdminDb().collection('imports').doc();
  await jobRef.set({
    provider: 'youtrack',
    organizationId,
    connectionId: connection.connectionId,
    baseUrl: connection.baseUrl,
    createdBy: userId,
    status: 'prepared',
    phase: 'issues',
    sourceProjects,
    projectMappings: Object.fromEntries(sourceProjects.map(project => [
      project.id,
      projectMappings[project.id] || 'create',
    ])),
    userMappings,
    statusMappings: sanitizedStatusMappings.filter(mapping => selectedStatusKeys.has(
      `${mapping.sourceProjectId}\u0000${normalizeMappingKey(mapping.sourceStatus)}`,
    )),
    statusFilters: normalizedStatusFilters,
    totalIssues: queue.length,
    processedIssues: 0,
    failedIssues: 0,
    processedLinks: 0,
    skippedLinks: 0,
    nextIndex: 0,
    warnings: [],
    adapterVersion: 2,
    mappingVersion: 4,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeInChunks(queue, (batch, item, index) => {
    batch.create(jobRef.collection('items').doc(String(index).padStart(8, '0')), {
      ...item,
      index,
      status: 'pending',
    });
  });
  return serializeJob(await jobRef.get());
}

export async function runYouTrackImportStep({ organizationId, jobId, userId }) {
  const jobRef = importJobRef(jobId);
  const {
    leaseId,
    claimedJob: job,
    terminalSnapshot,
    busySnapshot,
  } = await claimImportStep(jobRef, organizationId, { userId });
  if (terminalSnapshot) return serializeJob(terminalSnapshot);
  if (busySnapshot) return { ...serializeJob(busySnapshot), stepInProgress: true };

  try {
    if (job.phase === 'issues') {
      if ((job.nextIndex || 0) >= (job.totalIssues || 0)) {
        await commitClaimedStep(jobRef, leaseId, {
          jobUpdates: {
            phase: 'links',
            status: 'running',
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
        return serializeJob(await jobRef.get());
      }

      const itemRef = jobRef.collection('items').doc(String(job.nextIndex || 0).padStart(8, '0'));
      const item = await itemRef.get();
      if (!item.exists) {
        await commitClaimedStep(jobRef, leaseId, {
          jobUpdates: {
            nextIndex: FieldValue.increment(1),
            failedIssues: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
        return serializeJob(await jobRef.get());
      }

      await itemRef.set({
        status: 'processing',
        startedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      try {
        const result = await processIssue(jobRef, job, item.data());
        await commitClaimedStep(jobRef, leaseId, {
          itemRef,
          itemUpdates: {
            status: 'completed',
            quickTeamIssueId: result.issueId,
            result: result.created ? 'created' : 'updated',
            warnings: result.warnings,
            completedAt: FieldValue.serverTimestamp(),
          },
          jobUpdates: {
            status: 'running',
            nextIndex: FieldValue.increment(1),
            processedIssues: FieldValue.increment(1),
            ...(result.warnings.length ? { warnings: FieldValue.arrayUnion(...result.warnings.slice(0, 10)) } : {}),
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
      } catch (error) {
        const message = String(error.message || error).slice(0, 1_000);
        await commitClaimedStep(jobRef, leaseId, {
          itemRef,
          itemUpdates: {
            status: 'failed',
            error: message,
            completedAt: FieldValue.serverTimestamp(),
          },
          jobUpdates: {
            status: 'running',
            nextIndex: FieldValue.increment(1),
            failedIssues: FieldValue.increment(1),
            lastError: message,
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
      }
      return serializeJob(await jobRef.get());
    }

    const linkResult = await processPendingLink(jobRef, job);
    if (!linkResult) {
      await commitClaimedStep(jobRef, leaseId, {
        jobUpdates: {
          status: 'completed',
          phase: 'completed',
          completedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
      // An import writes tasks one at a time, across as many steps as it takes,
      // and each of those writes is a task the project's counters know nothing
      // about. Counting them one by one would put a write on the project
      // document inside every step of a job that may run for thousands of them.
      // The counters are rebuilt once instead, at the one moment the import is
      // over — which is also the only moment the whole result is knowable.
      //
      // Fire and forget: the import has finished, and the twice-daily pass
      // repairs whatever this missed rather than failing a completed job.
      recountProjectIssueCounts({ organizationIds: [organizationId] })
        .catch(error => console.warn('[youtrack] project counters not rebuilt:', error.message));
    } else {
      await commitClaimedStep(jobRef, leaseId, {
        jobUpdates: {
          processedLinks: FieldValue.increment(linkResult.skipped ? 0 : 1),
          skippedLinks: FieldValue.increment(linkResult.skipped ? 1 : 0),
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
    return serializeJob(await jobRef.get());
  } finally {
    await releaseImportStep(jobRef, leaseId);
  }
}

export async function getYouTrackImport({ organizationId, jobId }) {
  if (jobId) {
    const snapshot = await importJobRef(jobId).get();
    if (!snapshot.exists || snapshot.data().organizationId !== organizationId) return null;
    return serializeJob(snapshot);
  }
  const snapshot = await getAdminDb().collection('imports')
    .where('organizationId', '==', organizationId)
    .where('provider', '==', 'youtrack')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  return snapshot.docs.map(serializeJob);
}

export async function cancelYouTrackImport({
  organizationId,
  jobId,
  userId,
  isOrganizationOwner = false,
}) {
  const ref = importJobRef(jobId);
  const snapshot = await ref.get();
  if (!snapshot.exists || snapshot.data().organizationId !== organizationId) {
    throw new Error('Імпорт не знайдено');
  }
  assertImportControl(snapshot.data(), { userId, isOrganizationOwner, action: 'cancel' });
  if (snapshot.data().status === 'completed') return serializeJob(snapshot);
  await ref.update({
    status: 'cancelled',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return serializeJob(await ref.get());
}
