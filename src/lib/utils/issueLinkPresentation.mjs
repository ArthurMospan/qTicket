export const ISSUE_LINK_OPTIONS = Object.freeze([
  { value: 'depends-on', label: 'Залежить від' },
  { value: 'blocks', label: 'Блокує' },
  { value: 'relates-to', label: 'Пов’язана з' },
  { value: 'duplicates', label: 'Дублює' },
]);

export function issueLinkRequestFromPerspective(currentIssueId, otherIssueId, relationType) {
  if (relationType === 'depends-on') {
    return {
      sourceIssueId: otherIssueId,
      targetIssueId: currentIssueId,
      relationType: 'blocks',
    };
  }
  return {
    sourceIssueId: currentIssueId,
    targetIssueId: otherIssueId,
    relationType,
  };
}

export function issueLinkPerspective(link, issueId) {
  if (!link || !issueId) return null;
  const outgoing = link.sourceIssueId === issueId;
  const incoming = link.targetIssueId === issueId;
  if (!outgoing && !incoming) return null;

  const otherIssueId = outgoing ? link.targetIssueId : link.sourceIssueId;
  const otherIssue = outgoing ? link.targetIssue : link.sourceIssue;
  let label = 'Пов’язана з';
  if (link.relationType === 'blocks') label = outgoing ? 'Блокує' : 'Залежить від';
  if (link.relationType === 'duplicates') label = outgoing ? 'Дублює' : 'Дублікат';

  return {
    outgoing,
    otherIssueId,
    otherIssue: otherIssue || null,
    label,
  };
}
