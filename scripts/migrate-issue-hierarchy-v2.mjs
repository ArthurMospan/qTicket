// Migrates the legacy Epic/subtasks/paired-link model to issue hierarchy v2.
//
// Safety:
//   - dry-run is the default;
//   - an explicit Firebase project is always required;
//   - apply additionally requires an exact --confirm-project value;
//   - ambiguous hierarchy/duplicate data is reported, never guessed.
//
// Usage:
//   node --env-file=.env.local scripts/migrate-issue-hierarchy-v2.mjs \
//     --project quickteam-prod
//   node --env-file=.env.local scripts/migrate-issue-hierarchy-v2.mjs \
//     --project quickteam-prod --apply --confirm-project quickteam-prod \
//     --report ./issue-hierarchy-migration.json
import {
  applicationDefault,
  cert,
  getApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { writeFile } from 'node:fs/promises';

import {
  existingParentIssueId,
  findCanonicalIssueParentCycles,
  legacySubtasksToChecklist,
  normalizeParentIssueId,
  validateIssueParentAssignment,
} from '../src/lib/utils/issueHierarchyModel.mjs';
import {
  canonicalIssueLinkDocumentId,
  findDirectionalIssueLinkCycle,
  normalizeStoredIssueLinks,
} from '../src/lib/utils/issueRelations.mjs';

function argumentValue(name) {
  const inline = process.argv.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const FIREBASE_PROJECT_ID = argumentValue('--project');
const CONFIRMED_PROJECT_ID = argumentValue('--confirm-project');
const ORGANIZATION_ID = argumentValue('--organization');
const REPORT_PATH = argumentValue('--report');
const APPLY = process.argv.includes('--apply');

if (!FIREBASE_PROJECT_ID || FIREBASE_PROJECT_ID.startsWith('--')) {
  console.error('Потрібен явний `--project <firebase-project-id>`.');
  process.exit(2);
}
if (APPLY && CONFIRMED_PROJECT_ID !== FIREBASE_PROJECT_ID) {
  console.error('Apply зупинено: `--confirm-project` має точно збігатися з `--project`.');
  process.exit(2);
}

function initAdmin() {
  if (getApps().length) {
    const currentProject = getApp().options.projectId;
    if (currentProject && currentProject !== FIREBASE_PROJECT_ID) {
      throw new Error(`Admin SDK already targets "${currentProject}", expected "${FIREBASE_PROJECT_ID}"`);
    }
    return getApp();
  }
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const options = { projectId: FIREBASE_PROJECT_ID };
  if (clientEmail && privateKey) {
    options.credential = cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail,
      privateKey,
    });
  } else {
    options.credential = applicationDefault();
  }
  return initializeApp(options);
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function stableFirestoreValue(value) {
  if (value == null) return value;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return { __type: 'number', value: 'NaN' };
    if (value === Infinity) return { __type: 'number', value: 'Infinity' };
    if (value === -Infinity) return { __type: 'number', value: '-Infinity' };
    if (Object.is(value, -0)) return { __type: 'number', value: '-0' };
    return value;
  }
  if (typeof value !== 'object') return value;
  if (
    Number.isFinite(value.seconds)
    && Number.isFinite(value.nanoseconds)
    && typeof value.toMillis === 'function'
  ) {
    return {
      __type: 'timestamp',
      seconds: value.seconds,
      nanoseconds: value.nanoseconds,
    };
  }
  if (typeof value.path === 'string' && typeof value.get === 'function') {
    return { __type: 'reference', path: value.path };
  }
  if (
    Number.isFinite(value.latitude)
    && Number.isFinite(value.longitude)
  ) {
    return {
      __type: 'geopoint',
      latitude: value.latitude,
      longitude: value.longitude,
    };
  }
  if (typeof value.toBase64 === 'function') {
    return { __type: 'bytes', value: value.toBase64() };
  }
  if (Array.isArray(value)) return value.map(stableFirestoreValue);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableFirestoreValue(value[key])]),
  );
}

function linkDocumentFingerprint(data) {
  return JSON.stringify(stableFirestoreValue(data));
}

function isCleanCanonicalLink(document, {
  canonicalId,
  organizationId,
  projectId,
  link,
}) {
  if (document.id !== canonicalId) return false;
  const data = document.data();
  const staleFields = [
    'legacyAmbiguousDirection',
    'legacyLinkIds',
    'legacyRelationType',
    'requiresReview',
  ];
  return Number(data.schemaVersion) >= 2
    && data.organizationId === organizationId
    && data.projectId === projectId
    && data.sourceIssueId === link.sourceIssueId
    && data.targetIssueId === link.targetIssueId
    && data.relationType === link.relationType
    && staleFields.every(field => !owns(data, field));
}

function issueScopeMatches(left, right) {
  return left?.organizationId
    && left.organizationId === right?.organizationId
    && left.projectId
    && left.projectId === right?.projectId;
}

function effectiveChildIds(issueDocuments) {
  const children = new Map();
  for (const document of issueDocuments) {
    const parentId = existingParentIssueId(document.data);
    if (!parentId) continue;
    const ids = children.get(parentId) || new Set();
    ids.add(document.id);
    children.set(parentId, ids);
  }
  return children;
}

function translatedWorkflowSection(section, items) {
  const translations = {
    statuses: {
      backlog: ['Backlog', 'Беклог'],
      todo: ['To Do', 'До виконання'],
      'in-progress': ['In Progress', 'У роботі'],
      'code-review': ['Code Review', 'Код-ревʼю'],
      'client-approval': ['Client Approval', 'Погодження клієнтом'],
      done: ['Done', 'Готово'],
    },
    types: {
      epic: ['Epic', 'Епік (legacy)'],
      feature: ['Feature', 'Фіча'],
      task: ['Task', 'Задача'],
      bug: ['Bug', 'Баг'],
    },
    priorities: {
      blocker: ['Blocker', 'Блокер'],
      high: ['High', 'Високий'],
      medium: ['Medium', 'Середній'],
      low: ['Low', 'Низький'],
    },
    labels: {
      bug: ['Bug', 'Баг'],
      frontend: ['Frontend', 'Фронтенд'],
      design: ['Design', 'Дизайн'],
    },
    positions: {
      dev: ['Developer', 'Розробник'],
      designer: ['Designer', 'Дизайнер'],
      pm: ['Project Manager', 'PM'],
      qa: ['Quality Assurance', 'QA'],
    },
  }[section];
  if (!translations || !Array.isArray(items)) return { items, changed: 0 };
  let changed = 0;
  const localized = items.map(item => {
    const translation = translations[item?.id];
    if (!translation || item?.label !== translation[0]) return item;
    changed += 1;
    return { ...item, label: translation[1] };
  });
  return { items: localized, changed };
}

function makeReport() {
  return {
    firebaseProjectId: FIREBASE_PROJECT_ID,
    organizationId: ORGANIZATION_ID || null,
    mode: APPLY ? 'apply' : 'dry-run',
    startedAt: new Date().toISOString(),
    summary: {
      issuesScanned: 0,
      parentsConverted: 0,
      canonicalParentsInitialized: 0,
      canonicalParentProblems: 0,
      canonicalParentCycles: 0,
      legacyParentFieldsRemoved: 0,
      checklistsConverted: 0,
      linksScanned: 0,
      linksCanonicalized: 0,
      workflowLabelsLocalized: 0,
      workflowDocumentsChanged: 0,
      manualReview: 0,
    },
    manualReview: [],
    changes: [],
  };
}

function addReview(report, review) {
  report.summary.manualReview += 1;
  report.manualReview.push(review);
}

async function applyIssueUpdates(db, updates, report) {
  let applied = 0;
  for (const update of updates) {
    const issueRef = db.collection('issues').doc(update.id);
    const projectRef = db.collection('projects').doc(update.projectId);
    const result = await db.runTransaction(async transaction => {
      const project = await transaction.get(projectRef);
      const current = await transaction.get(issueRef);
      if (
        !project.exists
        || !current.exists
        || project.data().organizationId !== update.organizationId
        || current.data().organizationId !== update.organizationId
        || current.data().projectId !== update.projectId
      ) {
        return { applied: false, reason: 'scope-changed' };
      }
      if (project.data().deletionPending === true) {
        return { applied: false, reason: 'project-deleting' };
      }
      const data = current.data();
      const sourceStillMatches = (
        owns(data, 'parentIssueId') === update.expected.hasCanonicalParent
        && (data.parentIssueId ?? null) === update.expected.parentIssueId
        && owns(data, 'parentEpicId') === update.expected.hasLegacyParent
        && (data.parentEpicId ?? null) === update.expected.parentEpicId
        && owns(data, 'subtasks') === update.expected.hasSubtasks
        && JSON.stringify(data.subtasks ?? null) === update.expected.subtasks
        && (typeof data.description === 'string' ? data.description : '')
          === update.expected.description
      );
      if (!sourceStillMatches) return { applied: false, reason: 'source-changed' };

      if (update.parentTarget) {
        const parent = await transaction.get(
          db.collection('issues').doc(update.parentTarget),
        );
        const canonicalChildren = await transaction.get(
          db.collection('issues').where('parentIssueId', '==', update.id),
        );
        const legacyChildren = await transaction.get(
          db.collection('issues').where('parentEpicId', '==', update.id),
        );
        const childIds = [...new Set(
          [...canonicalChildren.docs, ...legacyChildren.docs]
            .filter(child => {
              const childData = child.data();
              return childData.organizationId === update.organizationId
                && childData.projectId === update.projectId;
            })
            .map(child => child.id),
        )];
        const hierarchyError = validateIssueParentAssignment({
          issueId: update.id,
          issue: data,
          requestedParentIssueId: update.parentTarget,
          parent: parent.exists ? parent.data() : null,
          childIds,
        });
        if (hierarchyError) {
          return { applied: false, reason: hierarchyError.code };
        }
      }

      transaction.update(issueRef, update.fields);
      transaction.update(projectRef, {
        issueHierarchyVersion: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { applied: true };
    });
    if (result.applied) {
      applied += 1;
    } else {
      addReview(report, {
        kind: 'issue-changed-during-apply',
        issueId: update.id,
        reason: result.reason,
      });
    }
  }
  return applied;
}

async function planIssueMigration(db, report) {
  let query = db.collection('issues');
  if (ORGANIZATION_ID) query = query.where('organizationId', '==', ORGANIZATION_ID);
  const snapshot = await query.get();
  const issueDocuments = snapshot.docs.map(document => ({
    id: document.id,
    ref: document.ref,
    data: document.data(),
  }));
  const byId = new Map(issueDocuments.map(document => [document.id, document]));
  const children = effectiveChildIds(issueDocuments);
  const canonicalCycles = findCanonicalIssueParentCycles(
    issueDocuments.map(document => ({ id: document.id, ...document.data })),
  );
  const canonicalCycleIssueIds = new Set(
    canonicalCycles.flatMap(cycle => cycle.slice(0, -1)),
  );
  for (const cyclePath of canonicalCycles) {
    report.summary.canonicalParentCycles += 1;
    report.summary.canonicalParentProblems += cyclePath.length - 1;
    addReview(report, {
      kind: 'canonical-parent-cycle',
      issueIds: cyclePath.slice(0, -1),
      issueKeys: cyclePath.slice(0, -1)
        .map(issueId => byId.get(issueId)?.data.issueKey || null),
      cyclePath,
      reason: 'canonical-parentIssueId-cycle',
    });
  }
  const updates = [];
  report.summary.issuesScanned = issueDocuments.length;

  for (const document of issueDocuments) {
    const data = document.data;
    if (!data.organizationId || !data.projectId) {
      addReview(report, {
        kind: 'unscoped-issue',
        issueId: document.id,
        issueKey: data.issueKey || null,
        reason: 'missing-organization-or-project',
      });
      continue;
    }
    const fields = {};
    const reasons = [];
    const hasCanonicalParent = owns(data, 'parentIssueId');
    const canonicalParent = normalizeParentIssueId(data.parentIssueId);
    const hasLegacyParent = owns(data, 'parentEpicId');
    const legacyParentMalformed = hasLegacyParent
      && data.parentEpicId !== null
      && typeof data.parentEpicId !== 'string';
    const legacyParent = typeof data.parentEpicId === 'string' && data.parentEpicId.trim()
      ? data.parentEpicId.trim()
      : null;

    if (hasCanonicalParent && canonicalParent === undefined) {
      report.summary.canonicalParentProblems += 1;
      addReview(report, {
        kind: 'invalid-parentIssueId',
        issueId: document.id,
        issueKey: data.issueKey || null,
        parentIssueId: data.parentIssueId ?? null,
        reason: 'malformed-canonical-parent-id',
      });
    } else if (
      hasCanonicalParent
      && canonicalParent
      && !canonicalCycleIssueIds.has(document.id)
    ) {
      const parent = byId.get(canonicalParent);
      const hierarchyError = validateIssueParentAssignment({
        issueId: document.id,
        issue: data,
        requestedParentIssueId: canonicalParent,
        parent: parent?.data || null,
        childIds: [...(children.get(document.id) || [])],
      });
      if (hierarchyError) {
        report.summary.canonicalParentProblems += 1;
        addReview(report, {
          kind: 'invalid-parentIssueId',
          issueId: document.id,
          issueKey: data.issueKey || null,
          parentIssueId: canonicalParent,
          reason: hierarchyError.code,
          childCount: hierarchyError.childCount || 0,
        });
      } else if (data.parentIssueId !== canonicalParent) {
        fields.parentIssueId = canonicalParent;
        reasons.push('normalize-parentIssueId');
      }
    } else if (
      hasCanonicalParent
      && canonicalParent === null
      && data.parentIssueId !== null
    ) {
      fields.parentIssueId = null;
      reasons.push('normalize-empty-parentIssueId');
    }

    if (legacyParentMalformed) {
      addReview(report, {
        kind: 'invalid-parentEpicId',
        issueId: document.id,
        issueKey: data.issueKey || null,
        parentEpicId: stableFirestoreValue(data.parentEpicId),
        reason: 'malformed-legacy-parent-id',
      });
    } else if (!hasCanonicalParent && legacyParent) {
      const parent = byId.get(legacyParent);
      const childCount = children.get(document.id)?.size || 0;
      let reason = null;
      if (legacyParent === document.id) reason = 'self-parent';
      else if (!parent) reason = 'parent-not-found';
      else if (!issueScopeMatches(data, parent.data)) reason = 'parent-outside-project';
      else if (existingParentIssueId(parent.data)) reason = 'parent-is-child';
      else if (childCount > 0) reason = 'child-already-has-children';
      else if (parent.data.deletionPending === true) reason = 'parent-is-deleting';

      if (reason) {
        addReview(report, {
          kind: 'invalid-parentEpicId',
          issueId: document.id,
          issueKey: data.issueKey || null,
          parentIssueId: legacyParent,
          reason,
          childCount,
        });
      } else {
        fields.parentIssueId = legacyParent;
        fields.parentEpicId = FieldValue.delete();
        reasons.push('parentEpicId->parentIssueId');
        report.summary.parentsConverted += 1;
        report.summary.legacyParentFieldsRemoved += 1;
      }
    } else if (!hasCanonicalParent) {
      fields.parentIssueId = null;
      reasons.push('initialize-parentIssueId');
      report.summary.canonicalParentsInitialized += 1;
      if (hasLegacyParent) {
        fields.parentEpicId = FieldValue.delete();
        report.summary.legacyParentFieldsRemoved += 1;
      }
    } else if (hasLegacyParent) {
      if (!legacyParent || legacyParent === canonicalParent || canonicalParent === null) {
        fields.parentEpicId = FieldValue.delete();
        reasons.push('remove-stale-parentEpicId');
        report.summary.legacyParentFieldsRemoved += 1;
      } else {
        addReview(report, {
          kind: 'conflicting-parent-fields',
          issueId: document.id,
          issueKey: data.issueKey || null,
          parentIssueId: canonicalParent,
          parentEpicId: legacyParent,
          reason: 'canonical-and-legacy-parent-differ',
        });
      }
    }

    if (owns(data, 'subtasks')) {
      if (!Array.isArray(data.subtasks)) {
        addReview(report, {
          kind: 'malformed-subtasks',
          issueId: document.id,
          issueKey: data.issueKey || null,
          reason: 'subtasks-is-not-an-array',
        });
      } else {
        const invalidSubtaskIndexes = data.subtasks.flatMap((item, index) => {
          const validItem = item
            && typeof item === 'object'
            && !Array.isArray(item)
            && typeof item.title === 'string'
            && item.title.replace(/\s+/gu, ' ').trim().length > 0
            && (!owns(item, 'done') || typeof item.done === 'boolean');
          return validItem ? [] : [index];
        });
        const descriptionMalformed = owns(data, 'description')
          && data.description !== null
          && typeof data.description !== 'string';
        const alreadyMigratedWithLiveItems = (
          typeof data.description === 'string'
          && data.description.includes(
            '<!-- quickteam:legacy-subtasks-migrated -->',
          )
          && data.subtasks.length > 0
        );
        if (
          invalidSubtaskIndexes.length > 0
          || descriptionMalformed
          || alreadyMigratedWithLiveItems
        ) {
          addReview(report, {
            kind: 'malformed-subtasks',
            issueId: document.id,
            issueKey: data.issueKey || null,
            reason: alreadyMigratedWithLiveItems
              ? 'migration-marker-with-live-subtasks'
              : descriptionMalformed
                ? 'description-is-not-text'
                : 'invalid-subtask-items',
            invalidSubtaskIndexes,
          });
        } else {
          const nextDescription = legacySubtasksToChecklist(
            data.description,
            data.subtasks,
          );
          if (nextDescription !== (typeof data.description === 'string' ? data.description : '')) {
            fields.description = nextDescription;
            report.summary.checklistsConverted += 1;
            reasons.push('subtasks->markdown-checklist');
          }
          fields.subtasks = FieldValue.delete();
          reasons.push('remove-legacy-subtasks');
        }
      }
    }

    if (Object.keys(fields).length > 0) {
      fields.updatedAt = FieldValue.serverTimestamp();
      updates.push({
        id: document.id,
        organizationId: data.organizationId,
        projectId: data.projectId,
        fields,
        parentTarget: reasons.includes('parentEpicId->parentIssueId')
          ? legacyParent
          : (reasons.includes('normalize-parentIssueId') ? canonicalParent : null),
        expected: {
          hasCanonicalParent,
          parentIssueId: data.parentIssueId ?? null,
          hasLegacyParent: owns(data, 'parentEpicId'),
          parentEpicId: data.parentEpicId ?? null,
          hasSubtasks: owns(data, 'subtasks'),
          subtasks: JSON.stringify(data.subtasks ?? null),
          description: typeof data.description === 'string' ? data.description : '',
        },
      });
      report.changes.push({
        kind: 'issue',
        id: document.id,
        issueKey: data.issueKey || null,
        reasons,
      });
    }
  }

  const appliedIssueUpdates = APPLY
    ? await applyIssueUpdates(db, updates, report)
    : updates.length;
  return {
    issueDocuments,
    issueUpdates: updates.length,
    appliedIssueUpdates,
  };
}

function linkPairGroupKey(document) {
  const data = document.data();
  const source = String(data.sourceIssueId || '');
  const target = String(data.targetIssueId || '');
  const organizationId = String(data.organizationId || '');
  if (!source || !target || source === target || !organizationId) return null;
  const pair = [source, target].sort();
  return `${organizationId}|${pair[0]}|${pair[1]}`;
}

async function applyLinkPlan(db, plan) {
  const canonicalRef = db.collection('issueLinks').doc(plan.canonicalId);
  const projectRef = db.collection('projects').doc(plan.projectId);
  const sourceIssueRef = db.collection('issues').doc(plan.link.sourceIssueId);
  const targetIssueRef = db.collection('issues').doc(plan.link.targetIssueId);
  return db.runTransaction(async transaction => {
    const project = await transaction.get(projectRef);
    const canonical = await transaction.get(canonicalRef);
    const sourceIssue = await transaction.get(sourceIssueRef);
    const targetIssue = await transaction.get(targetIssueRef);
    const currentLegacy = [];
    for (const id of plan.legacyIds) {
      currentLegacy.push(await transaction.get(db.collection('issueLinks').doc(id)));
    }
    const organizationRelations = await transaction.get(
      db.collection('issueLinks').where('organizationId', '==', plan.organizationId),
    );
    const projectIssues = await transaction.get(
      db.collection('issues').where('projectId', '==', plan.projectId),
    );

    if (!project.exists || project.data().organizationId !== plan.organizationId) {
      return { applied: false, reason: 'project-not-found' };
    }
    if (project.data().deletionPending === true) {
      return { applied: false, reason: 'project-deleting' };
    }
    if (
      !sourceIssue.exists
      || !targetIssue.exists
      || !issueScopeMatches(sourceIssue.data(), targetIssue.data())
      || sourceIssue.data().organizationId !== plan.organizationId
      || sourceIssue.data().projectId !== plan.projectId
      || sourceIssue.data().deletionPending === true
      || targetIssue.data().deletionPending === true
    ) {
      return { applied: false, reason: 'endpoint-changed-or-deleting' };
    }
    const currentLegacyById = new Map(
      currentLegacy.map(document => [document.id, document]),
    );
    const legacyChanged = plan.expectedLegacy.some(expected => {
      const current = currentLegacyById.get(expected.id);
      return !current?.exists
        || linkDocumentFingerprint(current.data()) !== expected.fingerprint;
    });
    if (legacyChanged) {
      return { applied: false, reason: 'legacy-link-changed' };
    }
    const expectedLegacyIds = new Set(
      plan.expectedLegacy.map(expected => expected.id),
    );
    const currentPairIds = organizationRelations.docs
      .filter(document => linkPairGroupKey(document) === plan.pairGroupKey)
      .map(document => document.id);
    if (
      currentPairIds.length !== expectedLegacyIds.size
      || currentPairIds.some(id => !expectedLegacyIds.has(id))
    ) {
      return { applied: false, reason: 'link-pair-membership-changed' };
    }
    const canonicalWasExpected = plan.expectedLegacy.some(
      expected => expected.id === plan.canonicalId,
    );
    if (canonical.exists && !canonicalWasExpected) {
      return { applied: false, reason: 'canonical-created-during-apply' };
    }
    const knownIssueIds = projectIssues.docs
      .filter(document => document.data().organizationId === plan.organizationId)
      .map(document => document.id);
    const graphLinks = normalizeStoredIssueLinks(
      organizationRelations.docs.map(document => ({
        id: document.id,
        ...document.data(),
      })),
    );
    const cyclePath = findDirectionalIssueLinkCycle({
      ...plan.link,
      links: graphLinks,
      knownIssueIds,
    });
    if (cyclePath) {
      return { applied: false, reason: 'directional-cycle', cyclePath };
    }

    transaction.set(canonicalRef, {
      schemaVersion: 2,
      organizationId: plan.organizationId,
      projectId: plan.projectId,
      ...plan.link,
      createdBy: plan.createdBy,
      createdAt: plan.createdAt || FieldValue.serverTimestamp(),
      migratedAt: FieldValue.serverTimestamp(),
    });
    currentLegacy
      .filter(document => document.exists && document.id !== canonicalRef.id)
      .forEach(document => transaction.delete(document.ref));
    transaction.update(projectRef, {
      issueLinkVersion: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { applied: true };
  });
}

async function migrateLinks(db, issueDocuments, report) {
  let query = db.collection('issueLinks');
  if (ORGANIZATION_ID) query = query.where('organizationId', '==', ORGANIZATION_ID);
  const snapshot = await query.get();
  report.summary.linksScanned = snapshot.size;
  const issueById = new Map(issueDocuments.map(document => [document.id, document]));
  const issueIdsByProject = new Map();
  for (const document of issueDocuments) {
    const projectId = document.data.projectId;
    if (!projectId) continue;
    const ids = issueIdsByProject.get(projectId) || new Set();
    ids.add(document.id);
    issueIdsByProject.set(projectId, ids);
  }
  const fullNormalizedGraph = normalizeStoredIssueLinks(
    snapshot.docs.map(document => ({ id: document.id, ...document.data() })),
  );
  const groups = new Map();

  for (const document of snapshot.docs) {
    const key = linkPairGroupKey(document);
    if (!key) {
      addReview(report, {
        kind: 'malformed-issue-link',
        linkId: document.id,
        reason: 'missing-or-self-endpoint',
      });
      continue;
    }
    const group = groups.get(key) || [];
    group.push(document);
    groups.set(key, group);
  }

  for (const documents of groups.values()) {
    const first = documents[0].data();
    const sourceIssue = issueById.get(first.sourceIssueId);
    const targetIssue = issueById.get(first.targetIssueId);
    if (
      !sourceIssue
      || !targetIssue
      || !issueScopeMatches(sourceIssue.data, targetIssue.data)
      || sourceIssue.data.organizationId !== first.organizationId
    ) {
      addReview(report, {
        kind: 'out-of-scope-issue-link',
        linkIds: documents.map(document => document.id),
        sourceIssueId: first.sourceIssueId || null,
        targetIssueId: first.targetIssueId || null,
        reason: 'missing-or-cross-project-endpoint',
      });
      continue;
    }

    const normalized = normalizeStoredIssueLinks(
      documents.map(document => ({ id: document.id, ...document.data() })),
    );
    if (
      normalized.length !== 1
      || normalized[0].requiresReview
      || !['blocks', 'relates-to', 'duplicates'].includes(normalized[0].relationType)
    ) {
      addReview(report, {
        kind: documents.some(document => document.data().relationType === 'subtask-of')
          ? 'ambiguous-subtask-link'
          : 'ambiguous-issue-link',
        linkIds: documents.map(document => document.id),
        sourceIssueId: first.sourceIssueId,
        targetIssueId: first.targetIssueId,
        relationTypes: [...new Set(documents.map(document => document.data().relationType))],
        reason: 'direction-or-semantics-require-manual-review',
      });
      continue;
    }

    const link = {
      sourceIssueId: normalized[0].sourceIssueId,
      targetIssueId: normalized[0].targetIssueId,
      relationType: normalized[0].relationType,
    };
    const projectId = sourceIssue.data.projectId;
    const cyclePath = findDirectionalIssueLinkCycle({
      ...link,
      links: fullNormalizedGraph,
      knownIssueIds: issueIdsByProject.get(projectId) || [],
    });
    if (cyclePath) {
      addReview(report, {
        kind: link.relationType === 'blocks'
          ? 'dependency-cycle'
          : 'duplicate-cycle',
        linkIds: documents.map(document => document.id),
        cyclePath,
        reason: 'canonicalization-would-preserve-a-directional-cycle',
      });
      continue;
    }
    const canonicalId = canonicalIssueLinkDocumentId({
      organizationId: first.organizationId,
      projectId,
      ...link,
    });
    const alreadyCanonical = documents.length === 1
      && isCleanCanonicalLink(documents[0], {
        canonicalId,
        organizationId: first.organizationId,
        projectId,
        link,
      });
    if (alreadyCanonical) continue;
    if (documents.length > 350) {
      addReview(report, {
        kind: 'oversized-link-pair',
        linkIds: documents.map(document => document.id),
        reason: 'too-many-legacy-documents-for-one-transaction',
      });
      continue;
    }

    const plan = {
      canonicalId,
      pairGroupKey: linkPairGroupKey(documents[0]),
      organizationId: first.organizationId,
      projectId,
      link,
      legacyIds: documents.map(document => document.id),
      expectedLegacy: documents.map(document => ({
        id: document.id,
        fingerprint: linkDocumentFingerprint(document.data()),
      })),
      createdBy: normalized[0].createdBy || 'migration',
      createdAt: documents
        .map(document => document.data().createdAt)
        .filter(Boolean)
        .sort((left, right) => {
          const leftMs = left?.toMillis?.() || 0;
          const rightMs = right?.toMillis?.() || 0;
          return leftMs - rightMs;
        })[0] || null,
    };
    if (APPLY) {
      const result = await applyLinkPlan(db, plan);
      if (!result.applied) {
        addReview(report, {
          kind: 'link-changed-during-apply',
          linkIds: plan.legacyIds,
          reason: result.reason,
          ...(result.cyclePath ? { cyclePath: result.cyclePath } : {}),
        });
        continue;
      }
    }
    report.summary.linksCanonicalized += 1;
    report.changes.push({
      kind: 'issue-link',
      canonicalId,
      legacyIds: plan.legacyIds,
      relationType: link.relationType,
    });
  }
}

async function migrateWorkflowLabels(db, report) {
  const organizationRefs = ORGANIZATION_ID
    ? [db.collection('organizations').doc(ORGANIZATION_ID)]
    : (await db.collection('organizations').get()).docs.map(document => document.ref);

  for (const organizationRef of organizationRefs) {
    const workflowRef = organizationRef.collection('settings').doc('workflow');
    const snapshot = await workflowRef.get();
    if (!snapshot.exists) continue;
    const buildPlan = data => {
      const update = {};
      let changed = 0;
      for (const section of [
        'statuses',
        'types',
        'priorities',
        'labels',
        'positions',
      ]) {
        const localized = translatedWorkflowSection(section, data[section]);
        if (localized.changed > 0) {
          update[section] = localized.items;
          changed += localized.changed;
        }
      }
      return { changed, update };
    };

    let plan = buildPlan(snapshot.data());
    if (!plan.changed) continue;
    if (APPLY) {
      plan = await db.runTransaction(async transaction => {
        const currentSnapshot = await transaction.get(workflowRef);
        if (!currentSnapshot.exists) return { changed: 0, update: {} };
        const currentPlan = buildPlan(currentSnapshot.data());
        if (!currentPlan.changed) return currentPlan;
        transaction.update(workflowRef, {
          ...currentPlan.update,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return currentPlan;
      });
      if (!plan.changed) continue;
    }

    report.summary.workflowLabelsLocalized += plan.changed;
    report.summary.workflowDocumentsChanged += 1;
    report.changes.push({
      kind: 'workflow-localization',
      organizationId: organizationRef.id,
      changedLabels: plan.changed,
    });
  }
}

async function run() {
  const app = initAdmin();
  const db = getFirestore(app);
  const report = makeReport();
  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} issue hierarchy v2 on Firebase project "${FIREBASE_PROJECT_ID}"`,
  );
  if (ORGANIZATION_ID) console.log(`Organization filter: ${ORGANIZATION_ID}`);

  const issueResult = await planIssueMigration(db, report);
  await migrateLinks(db, issueResult.issueDocuments, report);
  await migrateWorkflowLabels(db, report);
  report.finishedAt = new Date().toISOString();
  report.issueUpdates = issueResult.issueUpdates;
  report.appliedIssueUpdates = issueResult.appliedIssueUpdates;

  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (REPORT_PATH) {
    await writeFile(REPORT_PATH, output, 'utf8');
    console.log(`Full report: ${REPORT_PATH}`);
  } else {
    console.log(output);
  }
  console.log(
    `${APPLY ? 'Applied' : 'Would apply'}: `
      + `${APPLY ? report.appliedIssueUpdates : report.issueUpdates} issue updates, `
      + `${report.summary.linksCanonicalized} link migrations, `
      + `${report.summary.workflowLabelsLocalized} workflow labels. `
      + `Manual review: ${report.summary.manualReview}.`,
  );
  await app.delete();
}

run().catch(error => {
  console.error('Issue hierarchy migration failed:', error);
  process.exitCode = 1;
});
