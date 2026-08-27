import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  countWorkspaceSearchMatches,
  createProjectSearchScope,
  normalizeSearchScope,
  searchEscalationState,
  searchScopeParams,
  shouldRemoveSearchScope,
} from '../src/lib/utils/searchScope.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('a project page produces the one removable palette scope', () => {
  const scope = createProjectSearchScope({ id: 'p1', name: 'Мобільний застосунок' });
  assert.deepEqual(scope, {
    type: 'project',
    projectId: 'p1',
    label: 'у проєкті Мобільний застосунок',
  });
  assert.deepEqual(searchScopeParams(scope), { projectId: 'p1' });
  assert.equal(createProjectSearchScope(null), null);
  assert.equal(normalizeSearchScope({ type: 'team', projectId: 'p1' }), null);
});

test('the empty local state reports workspace matches rather than a dead end', () => {
  const outsideCount = countWorkspaceSearchMatches({
    issues: [{ id: 'i1' }, { id: 'i2' }],
    matches: {
      people: [{ id: 'u1' }],
      projects: [{ id: 'p1' }],
      events: [{ id: 'e1' }],
    },
  });
  assert.equal(outsideCount, 5);
  assert.deepEqual(searchEscalationState({
    query: '  дизайн ',
    localResultCount: 0,
    outsideResultCount: outsideCount,
  }), {
    active: true,
    term: 'дизайн',
    localEmpty: true,
    localCount: 0,
    outsideCount: 5,
    outsideLoading: false,
  });
});

test('scope expands only on Backspace from an already empty input', () => {
  const scope = createProjectSearchScope({ id: 'p1', name: 'Сайт' });
  assert.equal(shouldRemoveSearchScope({ key: 'Backspace', query: '', scope }), true);
  assert.equal(shouldRemoveSearchScope({ key: 'Backspace', query: 'с', scope }), false);
  assert.equal(shouldRemoveSearchScope({ key: 'Delete', query: '', scope }), false);
  assert.equal(shouldRemoveSearchScope({ key: 'Backspace', query: '', scope: null }), false);
});

test('the local field and palette are wired through one launch request', async () => {
  const [field, header, host, palette] = await Promise.all([
    read('../src/components/ui/Forms/HeaderSearch.jsx'),
    read('../src/components/WorkspaceHeader.jsx'),
    read('../src/components/WorkspaceCommandPalette.jsx'),
    read('../src/components/ui/Navigation/CommandPalette.jsx'),
  ]);
  assert.match(field, /Шукати «\{escalation\.term\}» у всьому робочому просторі/);
  assert.match(field, /event\.key === 'ArrowDown'/);
  assert.match(header, /openCommandPalette\(\{ query, scope: searchScope \}\)/);
  assert.match(host, /initialQuery=\{paletteRequest\.query\}/);
  assert.match(palette, /shouldRemoveSearchScope/);
});

test('broader search is offered only after the local scope returns no matches', () => {
  assert.equal(searchEscalationState({
    query: 'дизайн',
    localResultCount: 2,
  }).active, false);
  assert.equal(searchEscalationState({
    query: 'дизайн',
    localResultCount: null,
  }).active, false);
  assert.equal(searchEscalationState({
    query: 'дизайн',
    localResultCount: 0,
  }).active, true);
});

test('project scope is applied by the server before issue and event reads', async () => {
  const route = await read('../src/app/api/search/route.js');
  assert.match(route, /issuesQuery = issuesQuery\.where\('projectId', '==', projectId\)/);
  assert.match(route, /eventsQuery = eventsQuery\.where\('projectId', '==', projectId\)/);
  assert.match(route, /Project not found/);
});
