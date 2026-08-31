import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  COMMAND_GROUPS,
  buildCommands,
  flattenGroups,
  fuzzyScore,
  groupCommands,
  issueCommands,
  rankCommands,
  searchCommands,
} from '../src/lib/utils/commandPalette.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const projects = [
  { id: 'p1', name: 'Сайт RetroMagaz', issuePrefix: 'RM' },
  { id: 'p2', name: 'Мобільний застосунок' },
  { id: 'p3', name: 'Архів 2024', status: 'archived' },
];

test('the catalogue reflects what this person can actually do', () => {
  const member = buildCommands({ projects, allowedPermissions: [] });
  assert.equal(member.some(command => command.id === 'action-new-client'), false);
  // Only a client opens a request, so the internal palette cannot create one.
  assert.equal(member.some(command => command.id === 'action-new-issue'), false);
  assert.equal(
    buildCommands({ projects, role: 'client_member' })
      .some(command => command.id === 'action-new-issue'),
    true,
  );

  const admin = buildCommands({ projects, allowedPermissions: ['create:project'] });
  assert.equal(admin.some(command => command.id === 'action-new-client'), true);
  for (const inherited of ['action-stop-timer', 'action-new-event', 'action-new-sprint', 'nav-calendar', 'nav-sprints', 'nav-analytics', 'nav-chat']) {
    assert.equal(admin.some(command => command.id === inherited), false, `${inherited} leaked into qTicket`);
  }

  // «Огляд» leads the client's catalogue because it is their front screen: `/`
  // sends them there. It was absent while that screen was staff-only, and
  // leaving it absent afterwards would be the palette describing a product that
  // no longer exists.
  const clientMember = buildCommands({ projects, role: 'client_member' });
  assert.deepEqual(clientMember.filter(command => command.group === 'navigation').map(command => command.id), [
    'nav-client-overview',
    'nav-requests',
    'nav-profile',
  ]);
  const clientAdmin = buildCommands({ projects, role: 'client_admin' });
  assert.ok(clientAdmin.some(command => command.id === 'nav-client-team'));
  assert.equal(clientAdmin.some(command => command.group === 'project'), false);

  assert.equal(
    buildCommands({ organizationCount: 3 }).some(command => command.id === 'action-switch-org'),
    true,
  );
});

test('archived projects are not destinations', () => {
  const commands = buildCommands({ projects });
  const ids = commands.filter(command => command.group === 'project').map(command => command.id);
  assert.deepEqual(ids, ['project-p1', 'project-p2']);
});

test('a query finds the thing you were aiming at, not merely something matching', () => {
  const commands = buildCommands({ projects, allowedPermissions: ['create:project'] });

  // The container is a «проєкт» now, and both words find it. A rename that
  // makes a control unfindable by the name it had yesterday is a rename that
  // costs its users the one screen they open when they cannot see a button.
  assert.equal(rankCommands(commands, 'новий проєкт')[0].id, 'action-new-client');
  assert.equal(rankCommands(commands, 'новий клієнт')[0].id, 'action-new-client');
  assert.equal(rankCommands(commands, 'retro')[0].id, 'project-p1');
  // The client's own palette still reaches the one composer the product has.
  const clientCommands = buildCommands({ projects, role: 'client_member' });
  assert.equal(rankCommands(clientCommands, 'створити звернення')[0].id, 'action-new-issue');
});

test('the wrong keyboard layout still finds the right command', () => {
  const commands = buildCommands({ projects });
  assert.equal(rankCommands(commands, 'settings')[0].id, 'nav-settings');
  assert.equal(rankCommands(commands, 'clients')[0].id, 'nav-clients');
  assert.equal(rankCommands(commands, 'incidents')[0].id, 'nav-incidents');
});

test('scoring prefers word starts, runs and short labels', () => {
  assert.ok(fuzzyScore('Чат', 'чат') > fuzzyScore('Налаштування чату', 'чат'));
  assert.ok(fuzzyScore('Команда', 'ком') > fuzzyScore('Мої команди та проєкти', 'ком'));
  assert.equal(fuzzyScore('Календар', 'zzz'), null, 'a non-match is null, not zero');
  assert.equal(fuzzyScore('', 'a'), null);
  assert.equal(fuzzyScore('Календар', ''), 0);
});

test('an empty query is a menu, with actions at the top', () => {
  const commands = buildCommands({ projects, allowedPermissions: ['create:project'] });
  const ranked = rankCommands(commands, '');
  assert.equal(ranked[0].group, 'action');
  // And it never silently drops to nothing.
  assert.ok(ranked.length > 0);
});

// The menu used to share one 12-row budget between the actions, the
// destinations and the projects, so a workspace with a running timer and a
// second organization pushed «Аналітика» and «Налаштування» off the bottom —
// of the one list whose whole job is to say where you can go.
test('the menu never hides a destination behind a project', () => {
  const commands = buildCommands({
    projects: new Array(30).fill(0).map((_value, index) => ({ id: `p${index}`, name: `Проєкт ${index}` })),
    allowedPermissions: ['create:project'],
    organizationCount: 2,
  });
  const ranked = rankCommands(commands, '');

  const fixed = commands.filter(command => command.group === 'action' || command.group === 'navigation');
  for (const command of fixed) {
    assert.ok(ranked.some(entry => entry.id === command.id), `${command.id} is missing from the menu`);
  }
  // Projects are the part that can be arbitrarily long, so they are the part
  // that is capped.
  assert.ok(ranked.filter(entry => entry.group === 'project').length <= 4);
});

// Every action people asked for is one keystroke away, in the order these
// things are actually done in a week.
test('the actions are the things worth creating, in that order', () => {
  const commands = buildCommands({
    allowedPermissions: ['create:project'],
    organizationCount: 2,
  });
  assert.deepEqual(commands.filter(command => command.group === 'action').map(command => command.id), [
    'action-new-client',
    'action-switch-org',
  ]);
  const byId = Object.fromEntries(commands.map(command => [command.id, command]));
  assert.equal(byId['action-new-client'].href, '/clients?new=1');
  // The one «створити звернення» in the product belongs to the client, and it
  // lands in their own space — the same `[projectId]` screen support opens.
  assert.equal(buildCommands({ role: 'client_member' }).find(command => command.id === 'action-new-issue').href, '/?new=1');
  // A cheat sheet is not an action.
  assert.equal(commands.some(command => command.id === 'action-shortcuts'), false);
});

test('search results are a separate group, not mixed into the catalogue ranking', () => {
  const results = [
    { id: 'i1', issueKey: 'RM-12', title: 'Полагодити Telegram', projectId: 'p1' },
    { id: 'i2', issueKey: 'RM-13', title: 'Мобільна навігація', projectId: 'p1' },
  ];
  const issues = issueCommands(results, projects);
  assert.equal(issues[0].group, 'issue');
  assert.equal(issues[0].href, '/p1/issue/RM-12');
  assert.equal(issues[0].hint, 'RM-12 · Сайт RetroMagaz');
  assert.ok(issueCommands(new Array(40).fill(results[0]), projects).length <= 8);
});

test('grouping keeps the catalogue order and flattens to the keyboard order', () => {
  const commands = [
    ...buildCommands({ projects, allowedPermissions: ['create:project'] }),
    ...issueCommands([{ id: 'i1', title: 'Задача', projectId: 'p1' }], projects),
    ...searchCommands({
      people: [{ id: 'u1', name: 'Артур Моспан', email: 'arthur@quickteam.app' }],
      projects: [],
    }),
  ];
  const groups = groupCommands(commands);
  assert.deepEqual(groups.map(entry => entry.group), COMMAND_GROUPS);
  assert.ok(groups.every(entry => entry.label));

  const flat = flattenGroups(groups);
  assert.equal(flat.length, commands.length);
  // The flat order is what ArrowDown walks, so it must match what is rendered.
  assert.equal(flat[0].group, 'action');
  assert.equal(flat[flat.length - 1].group, 'person');
});

test('search grouping preserves relevance for the active row and Enter', () => {
  const relevantProject = {
    id: 'project-machete',
    group: 'project',
    label: 'Мачете',
  };
  const weakAction = {
    id: 'action-switch-org',
    group: 'action',
    label: 'Змінити організацію',
  };
  const groups = groupCommands([relevantProject, weakAction]);

  assert.deepEqual(groups.map(group => group.group), ['project', 'action']);
  assert.equal(flattenGroups(groups)[0].id, 'project-machete');
});

test('keyword aliases cannot match by hopping across unrelated words', () => {
  const commands = buildCommands({
    projects: [{ id: 'machete', name: 'Мачете', issuePrefix: 'MAC' }],
    organizationCount: 2,
  });
  const ranked = rankCommands(commands, 'MAC');

  assert.equal(ranked[0].id, 'project-machete');
  assert.equal(ranked.some(command => command.id === 'action-switch-org'), false);
  assert.equal(rankCommands(commands, 'requests')[0].id, 'nav-incidents');
});

test('qTicket search answers with support people and clients beside incidents', () => {
  const commands = searchCommands({
    people: [{ id: 'u1', name: 'Артур Моспан', email: 'arthur@quickteam.app' }],
    projects: [{ id: 'p9', name: 'Редизайн сайту' }],
    events: [{ id: 'e1', title: 'Планерка', startAt: '2026-08-14T09:00:00.000Z' }],
  });

  const byGroup = Object.fromEntries(commands.map(command => [command.group, command]));
  assert.equal(byGroup.person.label, 'Артур Моспан');
  // A person result has to land on that person, not on the top of the list.
  assert.equal(byGroup.person.href, '/team?member=u1');

  // …and on a screen that holds them. «Команда» is the support roster and it
  // filters client roles out, so a customer contact opened there was never in
  // the list it selects from — it selected whoever was first instead. The
  // server says where the person is reachable and the command obeys it.
  const [customer] = searchCommands({
    people: [{ id: 'u7', name: 'Ірина Бондар', email: 'iryna@acme.ua', role: 'client_admin', spaceId: 'acme' }],
  });
  assert.equal(customer.href, '/acme?member=u7');
  assert.equal(byGroup.project.href, '/p9');
  assert.equal(byGroup.event, undefined, 'calendar events are not qTicket search results');
  for (const command of commands) {
    assert.ok(command.href, `${command.id} does nothing`);
    assert.ok(COMMAND_GROUPS.includes(command.group), `${command.id} has an unknown group`);
  }
});

// A project the client already knows and a project the server matched are the
// same project; rendering it twice is a bug the user sees before anyone else.
test('a project found twice is listed once', () => {
  const groups = groupCommands([
    ...buildCommands({ projects, allowedPermissions: [] }),
    ...searchCommands({ projects: [{ id: 'p1', name: 'Сайт RetroMagaz' }] }),
  ]);
  const projectGroup = groups.find(entry => entry.group === 'project');
  assert.equal(projectGroup.items.filter(item => item.id === 'project-p1').length, 1);
});

// The team page is where a person result lands, so it has to read the id back.
test('the team screen selects the member the search sent it to', async () => {
  const page = await read('../src/app/(app)/team/page.js');
  assert.match(page, /searchParams\.get\('member'\)/);
  assert.match(page, /setSelectedUid\(requestedMemberId\)/);
});

test('every command is reachable: it navigates or it acts, never neither', () => {
  const commands = [
    ...buildCommands({ projects, allowedPermissions: ['create:project'], organizationCount: 2 }),
    ...issueCommands([{ id: 'i1', title: 'Задача', projectId: 'p1' }], projects),
  ];
  for (const command of commands) {
    assert.ok(command.href || command.action, `${command.id} does nothing`);
    assert.ok(command.label, `${command.id} has no label`);
    assert.ok(COMMAND_GROUPS.includes(command.group), `${command.id} has an unknown group`);
  }
  assert.equal(new Set(commands.map(command => command.id)).size, commands.length, 'ids collide');
});

test('the palette is opened from one place and rendered from the kit', async () => {
  const layout = await read('../src/app/(app)/layout.js');
  assert.match(layout, /CommandPalette/);
  const index = await read('../src/components/ui/index.js');
  assert.match(index, /CommandPalette/);
});

// QUI-103. "?" was a global shortcut, guarded only by "the event is not aimed
// at an input". That guard cannot hold: a question mark is ordinary
// punctuation, so everywhere else it was typed the character was swallowed and
// a help panel appeared instead.
test('no printable character is a global shortcut', async () => {
  const host = await read('../src/components/WorkspaceCommandPalette.jsx');
  const shortcuts = await read('../src/lib/content/shortcuts.mjs');
  const catalogue = await read('../src/lib/utils/commandPalette.mjs');

  assert.doesNotMatch(host, /event\.key === '\?'/);
  assert.doesNotMatch(host, /isTypingTarget/);
  // ⌘K/Ctrl+K stays: a modifier combination is nobody's typing.
  assert.match(host, /event\.metaKey \|\| event\.ctrlKey/);
  // And nothing advertises a key that no longer opens anything.
  assert.doesNotMatch(shortcuts, /keys: \['\?'\]/);
  assert.doesNotMatch(catalogue, /hint: '\?'/);
});

// A keystroke a text field has already answered is answered. ⌘K in the markdown
// editor inserts a link; it used to insert a link and then throw the palette
// over the top of the sentence being written.
test('the global keystroke yields to a field that already handled it', async () => {
  const host = await read('../src/components/WorkspaceCommandPalette.jsx');
  assert.match(host, /if \(event\.defaultPrevented\) return;/);
});

// The cheat sheet is looked up, not performed, so it sits with the help behind
// «?» in the sidebar rather than among the palette's actions.
test('the shortcuts sheet is opened from the help menu', async () => {
  const menu = await read('../src/components/WorkspaceHelpMenu.jsx');
  const host = await read('../src/components/WorkspaceCommandPalette.jsx');

  assert.match(menu, /KeyboardShortcutsDialog/);
  assert.match(menu, /label: 'Гарячі клавіші'/);
  assert.doesNotMatch(host, /KeyboardShortcutsDialog/);
  assert.doesNotMatch(host, /open-shortcuts/);
});

// The sheet describes the whole product now, not one window. A list that knows
// only about the palette teaches that the keyboard does one thing.
test('the cheat sheet covers more than the palette', async () => {
  const { SHORTCUT_GROUPS } = await import('../src/lib/content/shortcuts.mjs');
  const labels = SHORTCUT_GROUPS.map(group => group.label);

  assert.ok(SHORTCUT_GROUPS.length >= 8, 'the sheet is a survey, not a footnote');
  for (const group of SHORTCUT_GROUPS) {
    assert.ok(group.items.length > 0, `${group.label} lists nothing`);
    for (const item of group.items) {
      assert.ok(item.label && item.keys?.length, `${group.label} has a row with no keys`);
    }
  }
  // Each of these is a real handler in the product, and each was missing.
  assert.ok(labels.some(label => label.includes('тексту')), 'the markdown editor keys');
  // There is one conversation and it lives inside a request; the group used to
  // be «У чаті та в коментарях», back when a chat screen existed to be in.
  assert.ok(labels.some(label => label.includes('розмові')), 'send, newline and mentions');
  assert.ok(labels.some(label => label.includes('вкладення')), 'zooming an image');
  assert.ok(labels.some(label => label.includes('вкладках')), 'moving between tabs');
});

// Closing the palette hands its history entry back with `history.back()`, and a
// `router.push` issued in the same tick is the navigation that loses. Every row
// in «Перейти» did nothing at all until the two were ordered.
test('choosing a command waits for the palette to give its history entry back', async () => {
  const host = await read('../src/components/WorkspaceCommandPalette.jsx');

  assert.match(host, /navigateAfterOverlayClose/);
  // No bare push survives: every one of them is wrapped.
  for (const match of host.matchAll(/router\.push\(/g)) {
    const before = host.slice(Math.max(0, match.index - 60), match.index);
    assert.match(before, /navigateAfterOverlayClose\(\(\) => $/);
  }
});

test('every action the palette offers lands somewhere that answers it', async () => {
  const my = await read('../src/app/(app)/my/page.js');
  const clients = await read('../src/app/(app)/page.js');
  // A client's «нове звернення» lands in their own space, which is the same
  // `[projectId]` screen support opens — the request travels through the
  // redirect at `/` and is consumed there.
  const board = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');

  // The support queue answers no `?new=1` at all: it has no composer to open,
  // because only a client opens a request.
  assert.doesNotMatch(my, /get\('new'\)/);
  assert.match(clients, /if \(!clientsRoute \|\| !orgRole \|\| searchParams\?\.get\('new'\) !== '1'\) return;/);
  // And it answers it only for somebody who may take it. `?new=1` is the second
  // door into the composer «Новий клієнт» opens, and it used to be a wider one:
  // the button asks `create:project`, the address asked nothing, and the empty
  // state on the overview handed that address to every internal role.
  assert.match(clients, /if \(can\(orgRole, 'create:project'\)\) queueMicrotask\(\(\) => setShowNewProject\(true\)\);/);
  // A client's `/` now leads to the shared «Огляд», and `?new=1` is the one
  // thing that overrides it: the composer lives in the space, so the request
  // the reader already made goes straight there rather than being dropped on a
  // screen with no composer on it.
  assert.match(
    clients,
    /router\.replace\(searchParams\?\.get\('new'\) === '1' \? `\/\$\{clientProject\.id\}\?new=1` : '\/overview'\)/,
  );
  assert.match(board, /params\.get\('new'\) !== '1'/);
  assert.match(board, /setShowComposer\(true\)/);
});

// «Команди» sat above a field that already says what the window is for.
test('the palette has no headline, and still has a name for a screen reader', async () => {
  const palette = await read('../src/components/ui/Navigation/CommandPalette.jsx');
  const dialog = await read('../src/components/ui/Dialog.jsx');

  assert.doesNotMatch(palette, /title="Команди"/);
  assert.match(palette, /ariaLabel="/);
  assert.match(dialog, /aria-label=\{title \? undefined : ariaLabel\}/);
});

test('the global search surface names the one record the product has', async () => {
  const [modal, header] = await Promise.all([
    read('../src/components/SearchModal.jsx'),
    read('../src/components/WorkspaceHeader.jsx'),
  ]);

  assert.match(modal, /номером, темою або описом звернення/);
  assert.doesNotMatch(modal, /описанню завдання/);
  assert.match(header, /placeholder: 'Пошук звернень\.\.\.'/);
  assert.doesNotMatch(header, /Пошук по спринтах і завданнях|Пошук в аналітиці|Пошук у календарі/);
});

// The other half of the same fix: `spaceId` is a fact about where a person can
// be found, and only the server holds the roster it comes from.
test('search answers with the space a person can be opened in', async () => {
  const route = await read('../src/app/api/search/route.js');
  assert.match(route, /const CLIENT_ROLES = \['client_admin', 'client_member'\];/);
  // Only a customer contact moves: the support team is on «Команда».
  assert.match(route, /spaceId: CLIENT_ROLES\.includes\(entry\.membership\.role\)/);
  assert.match(route, /role: entry\.membership\.role \|\| 'member',/);
  // An archived space is not somewhere to send anybody.
  assert.match(route, /clientSpaceOf = userId => projectRecords[\s\S]{0,120}project\.status !== 'archived'/);
});
