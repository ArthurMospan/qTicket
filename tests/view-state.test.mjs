import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_VIEW_SCHEMA,
  MY_TASKS_VIEW_SCHEMA,
  SPRINTS_VIEW_SCHEMA,
  defaultViewState,
  hasViewStateParams,
  isDefaultViewState,
  parseViewState,
  restoredViewQuery,
  serializeViewState,
  viewStateQuery,
} from '../src/lib/utils/viewState.mjs';

const SCHEMA = {
  view: { default: 'kanban', values: ['kanban', 'list'] },
  assignee: { default: 'all' },
  projects: { default: [], type: 'list' },
};

test('an absent parameter reads as its default', () => {
  assert.deepEqual(parseViewState(SCHEMA, ''), {
    view: 'kanban',
    assignee: 'all',
    projects: [],
  });
});

test('parsing accepts a string, a plain object and URLSearchParams alike', () => {
  const expected = { view: 'list', assignee: 'member-a', projects: [] };
  assert.deepEqual(parseViewState(SCHEMA, 'view=list&assignee=member-a'), expected);
  assert.deepEqual(parseViewState(SCHEMA, { view: 'list', assignee: 'member-a' }), expected);
  assert.deepEqual(
    parseViewState(SCHEMA, new URLSearchParams('view=list&assignee=member-a')),
    expected,
  );
});

test('a list parameter is comma separated and drops empty entries', () => {
  assert.deepEqual(parseViewState(SCHEMA, 'projects=a,,b').projects, ['a', 'b']);
  assert.deepEqual(parseViewState(SCHEMA, 'projects=').projects, []);
});

// A link outlives the thing it points at: a shared board whose view mode was
// renamed, or a hand-edited address, must still open the board rather than
// render an unknown mode.
test('a value outside the declared set falls back to the default', () => {
  assert.equal(parseViewState(SCHEMA, 'view=gallery').view, 'kanban');
  assert.equal(parseViewState(SCHEMA, 'view=list').view, 'list');
});

test('serializing omits every value that equals its default', () => {
  assert.equal(viewStateQuery(SCHEMA, defaultViewState(SCHEMA)), '');
  assert.equal(
    viewStateQuery(SCHEMA, { view: 'list', assignee: 'all', projects: [] }),
    'view=list',
  );
});

// `org`, `new` and `member` are already carried in these addresses by the
// organization guard, the command palette and the member profile. A filter
// change must not drop somebody else's parameter.
test('parameters outside the schema survive a filter change', () => {
  const next = serializeViewState(
    SCHEMA,
    { view: 'list', assignee: 'all', projects: [] },
    new URLSearchParams('org=org-7&new=1'),
  );
  assert.equal(next.get('org'), 'org-7');
  assert.equal(next.get('new'), '1');
  assert.equal(next.get('view'), 'list');
});

test('returning a filter to its default removes it from the address', () => {
  const next = serializeViewState(
    SCHEMA,
    { view: 'kanban', assignee: 'all', projects: [] },
    new URLSearchParams('org=org-7&view=list&assignee=member-a'),
  );
  assert.equal(next.get('view'), null);
  assert.equal(next.get('assignee'), null);
  assert.equal(next.get('org'), 'org-7');
});

test('a list round-trips through the address', () => {
  const state = { view: 'kanban', assignee: 'all', projects: ['p1', 'p2'] };
  assert.deepEqual(parseViewState(SCHEMA, viewStateQuery(SCHEMA, state)), state);
});

// This is the rule that decides whether a link or the previous visit wins.
test('hasViewStateParams sees only keys the schema owns', () => {
  assert.equal(hasViewStateParams(SCHEMA, 'org=org-7'), false);
  assert.equal(hasViewStateParams(SCHEMA, ''), false);
  assert.equal(hasViewStateParams(SCHEMA, 'org=org-7&view=list'), true);
  assert.equal(hasViewStateParams(SCHEMA, 'projects=p1'), true);
});

// The conflict rule. Getting this backwards is the bug that would make a
// shared link silently show the reader's own filters instead of the sender's.
test('a link that carries filters is never overruled by the previous visit', () => {
  assert.equal(restoredViewQuery(SCHEMA, 'view=list', 'view=kanban'), null);
  assert.equal(restoredViewQuery(SCHEMA, 'view=list', 'projects=p1'), null);
});

test('a bare address is rewritten to the previous visit', () => {
  assert.equal(restoredViewQuery(SCHEMA, 'view=list&projects=p1', ''), 'view=list&projects=p1');
});

test('restoring keeps parameters that are not about this screen', () => {
  assert.equal(restoredViewQuery(SCHEMA, 'view=list', 'org=org-7'), 'org=org-7&view=list');
});

test('nothing to restore leaves the address untouched', () => {
  assert.equal(restoredViewQuery(SCHEMA, '', 'org=org-7'), null);
  // A remembered visit that was entirely default must not cause a navigation.
  assert.equal(restoredViewQuery(SCHEMA, 'view=kanban', 'org=org-7'), null);
});

test('isDefaultViewState reports an untouched screen', () => {
  assert.equal(isDefaultViewState(SCHEMA, defaultViewState(SCHEMA)), true);
  assert.equal(isDefaultViewState(SCHEMA, { ...defaultViewState(SCHEMA), assignee: 'x' }), false);
  assert.equal(isDefaultViewState(SCHEMA, { ...defaultViewState(SCHEMA), projects: ['x'] }), false);
});

test('serializing ignores keys the schema does not declare', () => {
  const next = serializeViewState(SCHEMA, { view: 'list', rogue: 'value' });
  assert.equal(next.get('rogue'), null);
});

// The board's `view` key is what the table view extended, and `/my` carries
// `assignee` for the composer rather than as a filter. Both are contract, not
// incidental, so they are asserted here.
test('the shipped schemas keep their agreed keys', () => {
  assert.deepEqual(
    Object.keys(BOARD_VIEW_SCHEMA),
    ['view', 'sprint', 'assignee', 'priority', 'type', 'sort', 'dir', 'cols'],
  );
  assert.deepEqual(BOARD_VIEW_SCHEMA.view.values, ['kanban', 'list', 'table']);
  assert.deepEqual(Object.keys(MY_TASKS_VIEW_SCHEMA), ['view', 'projects', 'sprint', 'priority', 'type']);
  assert.equal(MY_TASKS_VIEW_SCHEMA.assignee, undefined);
  assert.deepEqual(Object.keys(SPRINTS_VIEW_SCHEMA), ['projects', 'assignee', 'priority', 'type']);
});

// The table's whole point is that its arrangement is somebody else's link.
test('a configured table is one address', () => {
  const state = {
    ...defaultViewState(BOARD_VIEW_SCHEMA),
    view: 'table',
    sort: 'due',
    dir: 'desc',
    cols: ['key', 'title', 'due'],
  };
  const query = viewStateQuery(BOARD_VIEW_SCHEMA, state);
  assert.deepEqual(parseViewState(BOARD_VIEW_SCHEMA, query), state);
  assert.match(query, /view=table/);
  assert.match(query, /cols=key%2Ctitle%2Cdue/);
});

test('an untouched table says only that it is a table', () => {
  assert.equal(
    viewStateQuery(BOARD_VIEW_SCHEMA, { ...defaultViewState(BOARD_VIEW_SCHEMA), view: 'table' }),
    'view=table',
  );
});

// The columns you chose are not thrown away by looking at the kanban, because
// the keys stay declared whichever view is showing.
test('the table’s arrangement survives a trip through another view', () => {
  const configured = 'view=table&sort=due&cols=key%2Ctitle%2Cestimate';
  const asKanban = serializeViewState(
    BOARD_VIEW_SCHEMA,
    { ...parseViewState(BOARD_VIEW_SCHEMA, configured), view: 'kanban' },
    configured,
  );
  assert.equal(asKanban.get('view'), null);
  assert.equal(asKanban.get('sort'), 'due');
  assert.equal(asKanban.get('cols'), 'key,title,estimate');
});

// The table does not group, so the address has no key for it either.
test('a sort the build no longer has opens the table anyway', () => {
  const state = parseViewState(BOARD_VIEW_SCHEMA, 'view=table&sort=moon-phase&dir=sideways&group=weather');
  assert.equal(state.view, 'table');
  assert.equal(state.sort, 'manual');
  assert.equal(state.dir, 'asc');
  assert.equal(state.group, undefined);
});
