import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPortalProjectOptions, resolveLinkView } from '../src/lib/portal/qtplusLinkModel.mjs';

test('toPortalProjectOptions: sorts by name (uk, case-insensitive)', () => {
  const out = toPortalProjectOptions([
    { id: 'b', name: 'Яблуко' },
    { id: 'a', name: 'абрикос' },
    { id: 'c', name: 'Банан' },
  ]);
  assert.deepEqual(out.map((o) => o.id), ['a', 'c', 'b']); // абрикос, Банан, Яблуко
});

test('toPortalProjectOptions: blank/missing name -> "Без назви"', () => {
  const out = toPortalProjectOptions([{ id: 'x' }, { id: 'y', name: '' }, { id: 'z', name: '  ' }]);
  assert.deepEqual(out.map((o) => o.name), ['Без назви', 'Без назви', 'Без назви']);
});

test('toPortalProjectOptions: de-dupes by id, first wins', () => {
  const out = toPortalProjectOptions([
    { id: 'a', name: 'First' },
    { id: 'a', name: 'Second' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'First');
});

test('toPortalProjectOptions: nullish/empty -> []', () => {
  assert.deepEqual(toPortalProjectOptions(null), []);
  assert.deepEqual(toPortalProjectOptions(undefined), []);
  assert.deepEqual(toPortalProjectOptions([]), []);
});

test('resolveLinkView: unlinked', () => {
  const view = resolveLinkView({
    link: null, options: [{ id: 'a', name: 'A' }], otherLinkedIds: [], optionsLoaded: true,
  });
  assert.equal(view.linked, false);
  assert.equal(view.linkedId, null);
  assert.equal(view.linkedName, null);
  assert.equal(view.selectedId, null);
  assert.equal(view.staleAccess, false);
  assert.deepEqual(view.options, [{ id: 'a', name: 'A', linkedElsewhere: false }]);
});

test('resolveLinkView: linked -> name from snapshot, selectedId echoes linkedId', () => {
  const view = resolveLinkView({
    link: { projectId: 'p1', projectName: 'Acme' },
    options: [{ id: 'p1', name: 'Acme (fresh)' }],
    otherLinkedIds: [], optionsLoaded: true,
  });
  assert.equal(view.linked, true);
  assert.equal(view.linkedId, 'p1');
  assert.equal(view.linkedName, 'Acme'); // snapshot wins over fresh option name
  assert.equal(view.selectedId, 'p1');
  assert.equal(view.staleAccess, false);
});

test('resolveLinkView: linkedName falls back to option name when snapshot missing', () => {
  const view = resolveLinkView({
    link: { projectId: 'p1' }, options: [{ id: 'p1', name: 'Acme fresh' }],
    otherLinkedIds: [], optionsLoaded: true,
  });
  assert.equal(view.linkedName, 'Acme fresh');
});

test('resolveLinkView: linkedElsewhere marks ids linked to other workspace projects', () => {
  const view = resolveLinkView({
    link: null, options: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    otherLinkedIds: ['b'], optionsLoaded: true,
  });
  assert.equal(view.options.find((o) => o.id === 'a').linkedElsewhere, false);
  assert.equal(view.options.find((o) => o.id === 'b').linkedElsewhere, true);
});

test('resolveLinkView: staleAccess true when linked id absent from loaded options', () => {
  const view = resolveLinkView({
    link: { projectId: 'gone', projectName: 'Gone' }, options: [{ id: 'a', name: 'A' }],
    otherLinkedIds: [], optionsLoaded: true,
  });
  assert.equal(view.staleAccess, true);
  assert.equal(view.linkedName, 'Gone'); // snapshot still renders
});

test('resolveLinkView: staleAccess false while options not loaded', () => {
  const view = resolveLinkView({
    link: { projectId: 'gone', projectName: 'Gone' }, options: [],
    otherLinkedIds: [], optionsLoaded: false,
  });
  assert.equal(view.staleAccess, false);
});
