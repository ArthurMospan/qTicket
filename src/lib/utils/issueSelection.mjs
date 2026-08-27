export function visibleSelectedIds(selectedIds, issues) {
  const available = new Set((issues || []).map(issue => issue.id));
  return new Set([...selectedIds].filter(id => available.has(id)));
}

export function toggleIssueId(selectedIds, issueId, order, anchorId, shiftKey = false) {
  const next = new Set(selectedIds);
  const anchorIndex = order.indexOf(anchorId);
  const issueIndex = order.indexOf(issueId);
  if (shiftKey && anchorIndex >= 0 && issueIndex >= 0) {
    const start = Math.min(anchorIndex, issueIndex);
    const end = Math.max(anchorIndex, issueIndex);
    order.slice(start, end + 1).forEach(id => next.add(id));
  } else if (next.has(issueId)) next.delete(issueId);
  else next.add(issueId);
  return next;
}

export function toggleIssueScope(selectedIds, scopeIds) {
  const ids = [...new Set((scopeIds || []).filter(Boolean))];
  const next = new Set(selectedIds);
  const allSelected = ids.length > 0 && ids.every(id => next.has(id));
  ids.forEach(id => (allSelected ? next.delete(id) : next.add(id)));
  return next;
}
