import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalIssueLinkDocumentId,
  canonicalizeRequestedIssueLink,
  findDirectionalIssueLinkCycle,
  issueLinkPairKey,
  normalizeStoredIssueLinks,
} from '../src/lib/utils/issueRelations.mjs';

test('a pair has the same deterministic id in either direction', () => {
  const forward = {
    organizationId: 'org-a',
    projectId: 'project-a',
    sourceIssueId: 'issue-a',
    targetIssueId: 'issue-b',
  };
  const reverse = {
    ...forward,
    sourceIssueId: 'issue-b',
    targetIssueId: 'issue-a',
  };
  assert.equal(issueLinkPairKey(forward), issueLinkPairKey(reverse));
  assert.equal(canonicalIssueLinkDocumentId(forward), canonicalIssueLinkDocumentId(reverse));
  assert.equal(canonicalIssueLinkDocumentId(forward), canonicalIssueLinkDocumentId({
    ...forward,
    organizationId: ' org-a ',
    projectId: ' project-a ',
  }));
  assert.match(canonicalIssueLinkDocumentId(forward), /^link_v2_[a-f0-9]{64}$/u);
});

test('requested links accept only canonical types and normalize symmetric relations', () => {
  assert.deepEqual(canonicalizeRequestedIssueLink({
    sourceIssueId: 'z',
    targetIssueId: 'a',
    relationType: 'relates-to',
  }), {
    sourceIssueId: 'a',
    targetIssueId: 'z',
    relationType: 'relates-to',
  });
  assert.deepEqual(canonicalizeRequestedIssueLink({
    sourceIssueId: 'z',
    targetIssueId: 'a',
    relationType: 'blocks',
  }), {
    sourceIssueId: 'z',
    targetIssueId: 'a',
    relationType: 'blocks',
  });
  assert.equal(canonicalizeRequestedIssueLink({
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'is-blocked-by',
  }), null);
  assert.equal(canonicalizeRequestedIssueLink({
    sourceIssueId: 'a',
    targetIssueId: 'a',
    relationType: 'blocks',
  }), null);
});

test('legacy forward and inverse blocker documents collapse to one directional relation', () => {
  const links = normalizeStoredIssueLinks([
    {
      id: 'forward',
      organizationId: 'org-a',
      sourceIssueId: 'a',
      targetIssueId: 'b',
      relationType: 'blocks',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'inverse',
      organizationId: 'org-a',
      sourceIssueId: 'b',
      targetIssueId: 'a',
      relationType: 'is-blocked-by',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ]);
  assert.equal(links.length, 1);
  assert.deepEqual({
    sourceIssueId: links[0].sourceIssueId,
    targetIssueId: links[0].targetIssueId,
    relationType: links[0].relationType,
    legacyLinkIds: links[0].legacyLinkIds,
  }, {
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'blocks',
    legacyLinkIds: ['forward', 'inverse'],
  });
});

test('legacy symmetric links collapse without inventing subtask hierarchy', () => {
  const [duplicate] = normalizeStoredIssueLinks([
    { id: 'd2', sourceIssueId: 'b', targetIssueId: 'a', relationType: 'duplicates' },
    { id: 'd1', sourceIssueId: 'a', targetIssueId: 'b', relationType: 'duplicates' },
  ]);
  assert.equal(duplicate.relationType, 'duplicates');
  assert.equal(duplicate.legacyAmbiguousDirection, true);
  assert.equal(duplicate.requiresReview, true);

  const [legacySubtask] = normalizeStoredIssueLinks([
    { id: 's1', sourceIssueId: 'a', targetIssueId: 'b', relationType: 'subtask-of' },
    { id: 's2', sourceIssueId: 'b', targetIssueId: 'a', relationType: 'subtask-of' },
  ]);
  assert.equal(legacySubtask.relationType, 'relates-to');
  assert.equal(legacySubtask.legacyRelationType, 'subtask-of');
  assert.equal(legacySubtask.requiresReview, true);
});

test('a canonical v2 document passes through without legacy metadata', () => {
  const [link] = normalizeStoredIssueLinks([{
    id: 'link-v2',
    schemaVersion: 2,
    organizationId: 'org-a',
    projectId: 'project-a',
    sourceIssueId: 'b',
    targetIssueId: 'a',
    relationType: 'duplicates',
  }]);
  assert.equal(link.id, 'link-v2');
  assert.equal(link.schemaVersion, 2);
  assert.equal(link.sourceIssueId, 'b');
  assert.equal(link.targetIssueId, 'a');
  assert.equal('legacy' in link, false);
});

test('a review-required canonical import keeps its review marker', () => {
  const [link] = normalizeStoredIssueLinks([{
    id: 'imported-hierarchy',
    schemaVersion: 2,
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'relates-to',
    requiresReview: true,
    legacyRelationType: 'youtrack-hierarchy',
  }]);
  assert.equal(link.requiresReview, true);
  assert.equal(link.legacyRelationType, 'youtrack-hierarchy');
});

test('directional blockers reject transitive cycles and include normalized legacy edges', () => {
  const links = normalizeStoredIssueLinks([
    { id: 'b-c', sourceIssueId: 'b', targetIssueId: 'c', relationType: 'blocks' },
    { id: 'a-c-inverse', sourceIssueId: 'a', targetIssueId: 'c', relationType: 'is-blocked-by' },
  ]);
  assert.deepEqual(findDirectionalIssueLinkCycle({
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'blocks',
    links,
    knownIssueIds: ['a', 'b', 'c'],
  }), ['a', 'b', 'c', 'a']);
  assert.equal(findDirectionalIssueLinkCycle({
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'blocks',
    links: [links[0]],
    knownIssueIds: ['a', 'b', 'c'],
  }), null);
});

test('duplicate cycles are rejected while review-required and dangling edges are ignored', () => {
  const cycle = findDirectionalIssueLinkCycle({
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'duplicates',
    links: [
      { sourceIssueId: 'b', targetIssueId: 'c', relationType: 'duplicates' },
      { sourceIssueId: 'c', targetIssueId: 'a', relationType: 'duplicates' },
      { sourceIssueId: 'b', targetIssueId: 'missing', relationType: 'duplicates' },
      {
        sourceIssueId: 'b',
        targetIssueId: 'a',
        relationType: 'duplicates',
        requiresReview: true,
      },
    ],
    knownIssueIds: ['a', 'b', 'c'],
  });
  assert.deepEqual(cycle, ['a', 'b', 'c', 'a']);
  assert.equal(findDirectionalIssueLinkCycle({
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'relates-to',
    links: [],
    knownIssueIds: ['a', 'b'],
  }), null);
});
