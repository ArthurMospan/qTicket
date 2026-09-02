import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assignableMembersFor } from '../src/lib/utils/assignableMembers.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const MEMBERS = [
  { id: 'agent-a', name: 'Оля', role: 'member' },
  { id: 'agent-b', name: 'Дмитро', role: 'member' },
  { id: 'agent-gone', name: 'Ігор', role: 'member', status: 'inactive' },
  { id: 'client-a', name: 'Марія', role: 'client_admin' },
];
const PROJECTS = [
  { id: 'p1', team: ['agent-a', 'agent-b', 'agent-gone', 'client-a'] },
  { id: 'p2', team: ['agent-b', 'client-a'] },
  { id: 'legacy' },
];
const ids = list => list.map(member => member.id);

test('a request can only be given to somebody who can open it', () => {
  assert.deepEqual(
    ids(assignableMembersFor({
      members: MEMBERS,
      issues: [{ id: 'i1', projectId: 'p1', assigneeIds: [] }],
      projects: PROJECTS,
    })),
    ['agent-a', 'agent-b'],
  );
});

test('a selection is answered by the people on every project in it', () => {
  // The same people are written to all of it, so somebody on one project of
  // two cannot be made answerable for the other.
  assert.deepEqual(
    ids(assignableMembersFor({
      members: MEMBERS,
      issues: [
        { id: 'i1', projectId: 'p1', assigneeIds: [] },
        { id: 'i2', projectId: 'p2', assigneeIds: [] },
      ],
      projects: PROJECTS,
    })),
    ['agent-b'],
  );
});

test('the desk only, and only people who can still sign in', () => {
  const result = assignableMembersFor({
    members: MEMBERS,
    issues: [{ id: 'i1', projectId: 'p1', assigneeIds: [] }],
    projects: PROJECTS,
  });
  // A customer is never written into `assigneeIds`, and a switched-off seat
  // keeps its name on past work without being handed new work.
  assert.equal(result.some(member => member.id === 'client-a'), false);
  assert.equal(result.some(member => member.id === 'agent-gone'), false);
});

test('two deliberate exceptions', () => {
  // A project with no recorded team is legacy data, not a project nobody may
  // be assigned to.
  assert.deepEqual(
    ids(assignableMembersFor({
      members: MEMBERS,
      issues: [{ id: 'i1', projectId: 'legacy', assigneeIds: [] }],
      projects: PROJECTS,
    })),
    ['agent-a', 'agent-b'],
  );
  // And anyone already assigned stays listed even if they have left the team,
  // or they could never be un-assigned.
  assert.deepEqual(
    ids(assignableMembersFor({
      members: MEMBERS,
      issues: [{ id: 'i1', projectId: 'p2', assigneeIds: ['agent-a'] }],
      projects: PROJECTS,
    })),
    ['agent-a', 'agent-b'],
  );
});

test('the bulk bar asks the same question as every other assignee control', async () => {
  const [board, list] = await Promise.all([
    read('../src/components/workspace/AgileBoard.jsx'),
    read('../src/components/ui/TaskManagement/TaskListView.jsx'),
  ]);
  // It listed the whole organization on every board — the same defect the
  // request's own page and the assignee dialog both had.
  for (const source of [board, list]) {
    assert.match(source, /memberOptions=\{assignableMembersFor\(\{ members, issues: selectedIssues, projects \}\)/);
    assert.doesNotMatch(source, /memberOptions=\{activeMembers\(members\)/);
  }
});
