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
  assert.equal(member.some(command => command.id === 'action-new-project'), false);
  assert.equal(member.some(command => command.id === 'action-new-sprint'), false);
  // A task and an event are everybody's work.
  assert.equal(member.some(command => command.id === 'action-new-issue'), true);
  assert.equal(member.some(command => command.id === 'action-new-event'), true);

  const admin = buildCommands({ projects, allowedPermissions: ['create:project', 'manage:sprints'] });
  assert.equal(admin.some(command => command.id === 'action-new-project'), true);
  assert.equal(admin.some(command => command.id === 'action-new-sprint'), true);

  // Stopping a timer is not offered when none is running.
  assert.equal(admin.some(command => command.id === 'action-stop-timer'), false);
  assert.equal(
    buildCommands({ hasActiveTimer: true }).some(command => command.id === 'action-stop-timer'),
    true,
  );
  // Nor is switching organization when there is only one.
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

  assert.equal(rankCommands(commands, 'нове завдання')[0].id, 'action-new-issue');
  assert.equal(rankCommands(commands, 'подія')[0].id, 'action-new-event');
  assert.equal(rankCommands(commands, 'кален')[0].id, 'nav-calendar');
  assert.equal(rankCommands(commands, 'retro')[0].id, 'project-p1');
});

test('the wrong keyboard layout still finds the right command', () => {
  const commands = buildCommands({ projects });
  assert.equal(rankCommands(commands, 'settings')[0].id, 'nav-settings');
  assert.equal(rankCommands(commands, 'calendar')[0].id, 'nav-calendar');
  assert.equal(rankCommands(commands, 'my tasks')[0].id, 'nav-my');
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
    allowedPermissions: ['create:project', 'manage:sprints'],
    hasActiveTimer: true,
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
    allowedPermissions: ['create:project', 'manage:sprints'],
    hasActiveTimer: true,
    organizationCount: 2,
  });
  assert.deepEqual(commands.filter(command => command.group === 'action').map(command => command.id), [
    'action-stop-timer',
    'action-new-issue',
    'action-new-event',
    'action-new-sprint',
    'action-new-project',
    'action-switch-org',
  ]);
  const byId = Object.fromEntries(commands.map(command => [command.id, command]));
  assert.equal(byId['action-new-event'].href, '/calendar?new=1');
  assert.equal(byId['action-new-sprint'].href, '/sprints?new=1');
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
      events: [{ id: 'e1', title: 'Планерка', startAt: '2026-08-14T09:00:00.000Z' }],
    }),
  ];
  const groups = groupCommands(commands);
  assert.deepEqual(groups.map(entry => entry.group), COMMAND_GROUPS);
  assert.ok(groups.every(entry => entry.label));

  const flat = flattenGroups(groups);
  assert.equal(flat.length, commands.length);
  // The flat order is what ArrowDown walks, so it must match what is rendered.
  assert.equal(flat[0].group, 'action');
  assert.equal(flat[flat.length - 1].group, 'event');
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
  assert.equal(rankCommands(commands, 'my tasks')[0].id, 'nav-my');
});

// QUI-104. Typing a colleague's name found nothing at all, because search read
// one collection and that collection was `issues`.
test('search answers with people, projects and events, not only tasks', () => {
  const commands = searchCommands({
    people: [{ id: 'u1', name: 'Артур Моспан', email: 'arthur@quickteam.app' }],
    projects: [{ id: 'p9', name: 'Редизайн сайту' }],
    events: [{ id: 'e1', title: 'Планерка', startAt: '2026-08-14T09:00:00.000Z' }],
  });

  const byGroup = Object.fromEntries(commands.map(command => [command.group, command]));
  assert.equal(byGroup.person.label, 'Артур Моспан');
  // A person result has to land on that person, not on the top of the list.
  assert.equal(byGroup.person.href, '/team?member=u1');
  assert.equal(byGroup.project.href, '/p9');
  assert.equal(byGroup.event.href, '/calendar/event/e1');
  assert.match(byGroup.event.hint, /серпня/);
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
    ...buildCommands({ projects, allowedPermissions: ['create:project'], hasActiveTimer: true, organizationCount: 2 }),
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
  assert.ok(labels.some(label => label.includes('чаті')), 'send, newline and mentions');
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

// The palette is the only way to «Новий спринт», so the sprints screen has to
// understand the request the same way the other screens already do.
test('every action the palette offers lands somewhere that answers it', async () => {
  const sprints = await read('../src/app/(app)/sprints/page.js');
  const calendar = await read('../src/app/(app)/calendar/page.js');
  const my = await read('../src/app/(app)/my/page.js');

  assert.match(sprints, /searchParams\.get\('new'\) !== '1'/);
  assert.match(sprints, /setShowCreateSprintModal\(true\)/);
  assert.match(calendar, /searchParams\.get\('new'\) !== '1'/);
  assert.match(my, /searchParams\.get\('new'\) === '1'/);
});

// «Команди» sat above a field that already says what the window is for.
test('the palette has no headline, and still has a name for a screen reader', async () => {
  const palette = await read('../src/components/ui/Navigation/CommandPalette.jsx');
  const dialog = await read('../src/components/ui/Dialog.jsx');

  assert.doesNotMatch(palette, /title="Команди"/);
  assert.match(palette, /ariaLabel="/);
  assert.match(dialog, /aria-label=\{title \? undefined : ariaLabel\}/);
});
