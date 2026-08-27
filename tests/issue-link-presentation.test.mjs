import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_LINK_OPTIONS,
  issueLinkRequestFromPerspective,
  issueLinkPerspective,
} from '../src/lib/utils/issueLinkPresentation.mjs';

test('link picker exposes only canonical user-facing relations', () => {
  assert.deepEqual(
    ISSUE_LINK_OPTIONS.map(option => [option.value, option.label]),
    [
      ['depends-on', 'Залежить від'],
      ['blocks', 'Блокує'],
      ['relates-to', 'Пов’язана з'],
      ['duplicates', 'Дублює'],
    ],
  );
});

test('depends-on is stored as the selected issue blocking the current issue', () => {
  assert.deepEqual(issueLinkRequestFromPerspective('current', 'selected', 'depends-on'), {
    sourceIssueId: 'selected',
    targetIssueId: 'current',
    relationType: 'blocks',
  });
  assert.deepEqual(issueLinkRequestFromPerspective('current', 'selected', 'blocks'), {
    sourceIssueId: 'current',
    targetIssueId: 'selected',
    relationType: 'blocks',
  });
});

test('directional links render from the current issue perspective', () => {
  const blocker = { id: 'a', issueKey: 'QUI-1' };
  const blocked = { id: 'b', issueKey: 'QUI-2' };
  const link = {
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'blocks',
    sourceIssue: blocker,
    targetIssue: blocked,
  };

  assert.deepEqual(issueLinkPerspective(link, 'a'), {
    outgoing: true,
    otherIssueId: 'b',
    otherIssue: blocked,
    label: 'Блокує',
  });
  assert.deepEqual(issueLinkPerspective(link, 'b'), {
    outgoing: false,
    otherIssueId: 'a',
    otherIssue: blocker,
    label: 'Залежить від',
  });
  assert.equal(issueLinkPerspective(link, 'unrelated'), null);
});
