import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ISSUE_LINK_OPTIONS,
  issueLinkRequestFromPerspective,
  issueLinkPerspective,
} from '../src/lib/utils/issueLinkPresentation.mjs';
import {
  CANONICAL_ISSUE_LINK_TYPES,
  canonicalizeRequestedIssueLink,
} from '../src/lib/utils/issueRelations.mjs';

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

// Кожен варіант у списку, що його бачить підтримка, має доїхати до сервера.
// Поки секцію звʼязків було приховано, розійтися вони могли непомітно: список
// пропонує чотири відношення, сервер приймає три канонічні, і «Залежить від»
// живе лише як перевернуте «Блокує». Тест тримає цей стик, бо саме він
// перетворює вибір людини на документ.
test('every relation the support picker offers is one the server stores', () => {
  for (const option of ISSUE_LINK_OPTIONS) {
    const request = issueLinkRequestFromPerspective('current', 'selected', option.value);
    assert.ok(
      CANONICAL_ISSUE_LINK_TYPES.includes(request.relationType),
      `${option.value} maps onto a canonical stored type`,
    );
    assert.notEqual(
      canonicalizeRequestedIssueLink(request),
      null,
      `${option.value} survives server canonicalization`,
    );
  }
});

// Дублікат — найчастіше відношення в підтримці, і воно напрямлене: одне
// звернення дублює інше, а не «обидва однакові». Тому екран мусить називати
// кожен кінець своїм словом.
test('a duplicate reads correctly from both ends', () => {
  const link = {
    sourceIssueId: 'a',
    targetIssueId: 'b',
    relationType: 'duplicates',
    sourceIssue: { id: 'a', issueKey: 'ACME-9' },
    targetIssue: { id: 'b', issueKey: 'ACME-4' },
  };
  assert.equal(issueLinkPerspective(link, 'a').label, 'Дублює');
  assert.equal(issueLinkPerspective(link, 'b').label, 'Дублікат');
  // Напрямок зберігається так, як його вибрали: канонізація сортує пару лише
  // для ненапрямленого «Повʼязана з».
  assert.deepEqual(canonicalizeRequestedIssueLink({
    sourceIssueId: 'zzz',
    targetIssueId: 'aaa',
    relationType: 'duplicates',
  }), { sourceIssueId: 'zzz', targetIssueId: 'aaa', relationType: 'duplicates' });
});
