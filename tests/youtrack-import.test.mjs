import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldMinutes,
  filterYouTrackIssuesByStatuses,
  mapYouTrackPriority,
  mapYouTrackStatus,
  mapYouTrackType,
  mergeYouTrackStatuses,
  normalizeYouTrackRelation,
  normalizeYouTrackBaseUrl,
  relationTypeFromYouTrack,
  resolveYouTrackStatus,
  strongestYouTrackRelationRow,
  suggestYouTrackStatusMappings,
  suggestUserMappings,
  youTrackImportedWorkLogMatches,
  youTrackField,
  youTrackStateName,
} from '../src/lib/utils/youtrackImport.mjs';

const workflow = {
  statuses: [
    { id: 'backlog', label: 'Беклог' },
    { id: 'todo', label: 'До роботи' },
    { id: 'in-progress', label: 'У роботі' },
    { id: 'done', label: 'Готово' },
  ],
  priorities: [
    { id: 'blocker', label: 'Блокер' },
    { id: 'high', label: 'Високий' },
    { id: 'medium', label: 'Середній' },
    { id: 'low', label: 'Низький' },
  ],
  types: [
    { id: 'task', label: 'Задача' },
    { id: 'bug', label: 'Баг' },
    { id: 'feature', label: 'Фіча' },
  ],
};

test('normalizes a public YouTrack URL and rejects private hosts', () => {
  assert.equal(normalizeYouTrackBaseUrl('https://acme.youtrack.cloud/'), 'https://acme.youtrack.cloud');
  assert.equal(normalizeYouTrackBaseUrl('https://example.com/youtrack/api'), 'https://example.com/youtrack');
  assert.throws(() => normalizeYouTrackBaseUrl('http://acme.youtrack.cloud'));
  assert.throws(() => normalizeYouTrackBaseUrl('https://127.0.0.1/youtrack'));
  assert.throws(() => normalizeYouTrackBaseUrl('https://192.168.1.20'));
});

test('suggests only exact email mappings', () => {
  assert.deepEqual(
    suggestUserMappings(
      [
        { id: 'u1', name: 'Same Name', email: 'member@example.com' },
        { id: 'u2', name: 'Same Name', email: 'other@example.com' },
      ],
      [{ id: 'qt1', name: 'Same Name', email: 'MEMBER@example.com' }],
    ),
    { u1: 'qt1', u2: 'external' },
  );
});

test('maps common YouTrack workflow values', () => {
  assert.equal(mapYouTrackStatus('In Progress', workflow.statuses), 'in-progress');
  assert.equal(mapYouTrackStatus('Fixed', workflow.statuses), 'done');
  assert.equal(mapYouTrackPriority('Show-stopper', workflow.priorities), 'blocker');
  assert.equal(mapYouTrackPriority('Minor', workflow.priorities), 'low');
  assert.equal(mapYouTrackType('Bug', workflow.types), 'bug');
  assert.equal(mapYouTrackType('User Story', workflow.types), 'feature');
  assert.equal(mapYouTrackType('Epic', workflow.types), 'feature');
  assert.equal(mapYouTrackType('Epic', [
    { id: 'epic', label: 'Epic' },
    ...workflow.types,
  ]), 'feature');
  assert.equal(mapYouTrackType('Epic', [{ id: 'epic', label: 'Epic' }]), null);
});

test('suggests status mappings per source project and honors a valid manual override', () => {
  const projects = [{
    id: 'yt-project',
    statuses: [
      { id: 'open', name: 'Open' },
      { id: 'working', name: 'In Progress' },
      { id: 'fixed', name: 'Fixed', archived: true },
    ],
  }];
  assert.deepEqual(suggestYouTrackStatusMappings(projects, workflow.statuses), {
    'yt-project': {
      Open: 'todo',
      'In Progress': 'in-progress',
      Fixed: 'done',
    },
  });
  assert.equal(resolveYouTrackStatus('Fixed', workflow.statuses, 'in-progress'), 'in-progress');
  assert.equal(resolveYouTrackStatus('Fixed', workflow.statuses, 'removed-status'), 'done');
});

test('reads custom fields and YouTrack durations', () => {
  const issue = {
    customFields: [
      { name: 'State', value: { name: 'Open' } },
      { name: 'Estimation', value: { minutes: 95 } },
    ],
  };
  assert.deepEqual(youTrackField(issue, 'state'), { name: 'Open' });
  assert.equal(fieldMinutes(youTrackField(issue, 'Estimation')), 95);
});

test('detects only exact idempotent YouTrack work-log reimports', () => {
  const timestamp = millis => ({ toMillis: () => millis });
  const imported = {
    issueId: 'issue-a',
    projectId: 'project-a',
    userId: 'external:youtrack:user-a',
    organizationId: 'org-a',
    spentMinutes: 45,
    description: 'Implementation',
    loggedAt: timestamp(1_700_000_000_000),
    source: 'youtrack',
    sourceId: 'work-a',
    externalActor: {
      id: 'external:youtrack:user-a',
      name: 'User A',
      avatar: null,
      email: '',
      external: true,
      sourceId: 'user-a',
    },
  };
  const stored = {
    ...imported,
    loggedAt: {
      seconds: 1_700_000_000,
      nanoseconds: 0,
    },
    createdAt: timestamp(1_700_000_100_000),
  };

  assert.equal(youTrackImportedWorkLogMatches(stored, imported), true);
  assert.equal(
    youTrackImportedWorkLogMatches(
      { ...stored, spentMinutes: 46 },
      imported,
    ),
    false,
  );
  assert.equal(
    youTrackImportedWorkLogMatches(
      { ...stored, description: 'Changed' },
      imported,
    ),
    false,
  );
  assert.equal(
    youTrackImportedWorkLogMatches(
      { ...stored, loggedAt: timestamp(1_700_000_000_001) },
      imported,
    ),
    false,
  );
  assert.equal(youTrackImportedWorkLogMatches(null, imported), false);
});

test('filters import stubs by the selected YouTrack statuses', () => {
  const issues = [
    { id: 'open', customFields: [{ name: 'State', value: { name: 'Open' } }] },
    { id: 'done', customFields: [{ name: 'State', value: { name: 'Done' } }] },
  ];
  assert.deepEqual(filterYouTrackIssuesByStatuses(issues, ['Open']).map(issue => issue.id), ['open']);
  assert.equal(filterYouTrackIssuesByStatuses(issues, undefined), issues);
});

test('an empty status selection never turns into an accidental full import', () => {
  const issues = [
    { id: 'open', customFields: [{ name: 'State', value: { name: 'Open' } }] },
    { id: 'done', customFields: [{ name: 'State', value: { name: 'Done' } }] },
  ];
  assert.deepEqual(filterYouTrackIssuesByStatuses(issues, []), []);
  assert.deepEqual(filterYouTrackIssuesByStatuses(issues, ['', '  ']), []);
});

test('status discovery falls back to states observed on readable issues', () => {
  const statuses = mergeYouTrackStatuses([], [
    { customFields: [{ name: 'Статус', value: { name: 'In Progress' } }] },
    { customFields: [{ name: 'State', value: { name: 'Done' } }] },
    { customFields: [{ name: 'State', value: { name: 'In Progress' } }] },
  ]);
  assert.deepEqual(statuses, [
    { id: 'Done', name: 'Done', archived: false, issueCount: 1 },
    { id: 'In Progress', name: 'In Progress', archived: false, issueCount: 2 },
  ]);
});

// Discovery recognises the state field by `$type`, so a renamed or localized
// one still offers its statuses. Matching the literal name "State" here made
// the picker offer statuses no issue could ever match.
test('the workflow state is read from a renamed or localized state field', () => {
  const renamed = {
    customFields: [
      { name: 'Стан', $type: 'StateIssueCustomField', value: { name: 'У роботі' } },
      { name: 'Priority', $type: 'SingleEnumIssueCustomField', value: { name: 'Critical' } },
    ],
  };
  assert.equal(youTrackStateName(renamed), 'У роботі');
  assert.deepEqual(
    filterYouTrackIssuesByStatuses([renamed], ['У роботі']).length,
    1,
  );
  // Responses without `$type` still resolve through the field name.
  assert.equal(youTrackStateName({ customFields: [{ name: 'State', value: { name: 'Open' } }] }), 'Open');
  assert.equal(youTrackStateName({ customFields: [{ name: 'Статус', value: { name: 'В роботі' } }] }), 'В роботі');
  assert.equal(youTrackStateName({ customFields: [] }), '');
});

test('normalizes link types', () => {
  assert.equal(relationTypeFromYouTrack({ sourceToTarget: 'blocks' }, 'OUTWARD'), 'blocks');
  assert.equal(relationTypeFromYouTrack({ sourceToTarget: 'is required for' }, 'OUTWARD'), 'blocks');
  assert.equal(relationTypeFromYouTrack({ sourceToTarget: 'depends on' }, 'OUTWARD'), 'blocks');
  assert.deepEqual(
    normalizeYouTrackRelation({ sourceToTarget: 'depends on' }, 'OUTWARD'),
    { relationType: 'blocks', reverse: true, hierarchyHint: false },
  );
  assert.equal(relationTypeFromYouTrack({ sourceToTarget: 'duplicates' }, 'OUTWARD'), 'duplicates');
  assert.equal(relationTypeFromYouTrack({ sourceToTarget: 'relates to' }, 'OUTWARD'), 'relates-to');
  assert.deepEqual(
    normalizeYouTrackRelation({ sourceToTarget: 'parent for' }, 'OUTWARD'),
    { relationType: 'relates-to', reverse: false, hierarchyHint: true },
  );
});

test('selects the strongest reciprocal relation independently of enqueue order', () => {
  const relates = {
    id: 'pair',
    sourceExternalId: 'b',
    targetExternalId: 'a',
    relationType: 'relates-to',
    hierarchyHint: true,
    externalRelation: 'parent for',
  };
  const blocks = {
    id: 'pair',
    sourceExternalId: 'a',
    targetExternalId: 'b',
    relationType: 'blocks',
    hierarchyHint: false,
    externalRelation: 'blocks',
  };

  assert.deepEqual(
    strongestYouTrackRelationRow(relates, blocks),
    strongestYouTrackRelationRow(blocks, relates),
  );
  assert.equal(strongestYouTrackRelationRow(relates, blocks).relationType, 'blocks');
  assert.equal(strongestYouTrackRelationRow(relates, blocks).hierarchyHint, false);
});

test('breaks equal-strength reciprocal relations deterministically', () => {
  const outward = {
    id: 'pair',
    sourceExternalId: 'b',
    targetExternalId: 'a',
    relationType: 'blocks',
    hierarchyHint: false,
    externalRelation: 'blocks',
  };
  const inward = {
    id: 'pair',
    sourceExternalId: 'a',
    targetExternalId: 'b',
    relationType: 'blocks',
    hierarchyHint: false,
    externalRelation: 'is blocked by',
  };

  assert.equal(
    strongestYouTrackRelationRow(outward, inward).sourceExternalId,
    'a',
  );
  assert.deepEqual(
    strongestYouTrackRelationRow(outward, inward),
    strongestYouTrackRelationRow(inward, outward),
  );
});
