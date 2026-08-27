// src/lib/utils/commandPalette.mjs
// What the command palette can do, and how a query picks from it.
//
// Pure: descriptors carry an icon *name*, never a component, so the whole
// catalogue and its ranking can be asserted without React. The workspace
// already has a route table, a project list, a permission helper and a search
// API; this is the layer that lets one keystroke reach all four.

import { issuePath } from './issueKeys.mjs';

export const COMMAND_GROUPS = ['action', 'navigation', 'project', 'issue', 'person', 'event'];

export const GROUP_LABELS = {
  action: 'Дії',
  navigation: 'Перейти',
  project: 'Проєкти',
  issue: 'Інциденти',
  person: 'Люди',
  event: 'Події',
};

// Latin spellings sit next to the Ukrainian ones on purpose. People type with
// whatever layout is active, and having to notice the layout before you can
// search is exactly the friction the palette exists to remove.
const NAVIGATION = [
  { id: 'nav-projects', label: 'Проєкти', href: '/', icon: 'folder', keywords: 'proekty projects home dashboard' },
  { id: 'nav-my', label: 'Мої інциденти', href: '/my', icon: 'check', keywords: 'moi intsydenty incidenty incidents my tasks todo' },
  { id: 'nav-chat', label: 'Чат', href: '/chat', icon: 'message', keywords: 'chat chat povidomlennya messages' },
  { id: 'nav-calendar', label: 'Календар', href: '/calendar', icon: 'calendar', keywords: 'kalendar calendar events podii' },
  { id: 'nav-sprints', label: 'Спринти', href: '/sprints', icon: 'zap', keywords: 'sprinty sprints' },
  { id: 'nav-team', label: 'Команда', href: '/team', icon: 'users', keywords: 'komanda team people ludy' },
  { id: 'nav-analytics', label: 'Аналітика', href: '/analytics', icon: 'chart', keywords: 'analityka analytics reports zvity' },
  { id: 'nav-settings', label: 'Налаштування', href: '/settings', icon: 'settings', keywords: 'nalashtuvannya settings preferences profile' },
];

// `permission` is checked against `can(orgRole, …)` by the caller, so this file
// stays free of the permission model.
//
// The order here is the order somebody reads on an empty palette, and it is the
// order these things actually get done in a week: a task most days, an event
// most days, a sprint every fortnight, a project rarely, another organization
// rarer still. «Гарячі клавіші» used to sit among them — a cheat sheet is not
// an action, and it now lives behind «?» in the sidebar with the rest of the
// help. Stopping a timer is first only while a timer is running: it is the one
// entry that answers a question the workspace is already asking.
const ACTIONS = [
  {
    id: 'action-stop-timer',
    label: 'Зупинити таймер',
    hint: 'Зберегти витрачений час',
    icon: 'stop',
    action: 'stop-timer',
    requiresTimer: true,
    keywords: 'zupynyty taymer stop timer time',
  },
  {
    id: 'action-new-issue',
    label: 'Новий інцидент',
    hint: 'Створити інцидент',
    href: '/my?new=1',
    icon: 'plus',
    keywords: 'novyi intsydent nove zavdannya нове завдання new incident task issue stvoryty create',
  },
  {
    id: 'action-new-event',
    label: 'Нова подія',
    hint: 'Створити подію в календарі',
    href: '/calendar?new=1',
    icon: 'calendar',
    keywords: 'nova podiya new event meeting zustrich calendar kalendar stvoryty create',
  },
  {
    id: 'action-new-sprint',
    label: 'Новий спринт',
    hint: 'Створити спринт',
    href: '/sprints?new=1',
    icon: 'zap',
    permission: 'manage:sprints',
    keywords: 'novyi sprint new sprint stvoryty create',
  },
  {
    id: 'action-new-project',
    label: 'Новий проєкт',
    hint: 'Створити проєкт',
    href: '/?new=1',
    // A folder, like every other project row in this list and in the sidebar.
    // «Нова подія» is a calendar and «Новий спринт» is a lightning bolt: an
    // action is drawn as the thing it makes, and this one was drawn as a plus.
    icon: 'folder',
    permission: 'create:project',
    keywords: 'novyi proekt new project stvoryty create',
  },
  {
    id: 'action-switch-org',
    label: 'Змінити організацію',
    icon: 'building',
    action: 'switch-organization',
    requiresManyOrganizations: true,
    keywords: 'zminyty organizatsiyu switch organization workspace team',
  },
];

export function buildCommands({
  projects = [],
  allowedPermissions = [],
  hasActiveTimer = false,
  organizationCount = 1,
} = {}) {
  const permitted = new Set(allowedPermissions);
  const commands = [];

  for (const action of ACTIONS) {
    if (action.permission && !permitted.has(action.permission)) continue;
    if (action.requiresTimer && !hasActiveTimer) continue;
    if (action.requiresManyOrganizations && organizationCount < 2) continue;
    commands.push({ ...action, group: 'action' });
  }
  for (const entry of NAVIGATION) commands.push({ ...entry, group: 'navigation' });
  for (const project of projects) {
    if (!project?.id || project.status === 'archived') continue;
    commands.push({
      id: `project-${project.id}`,
      group: 'project',
      label: project.name || 'Проєкт',
      href: `/${project.id}`,
      icon: 'folder',
      keywords: project.issuePrefix || '',
    });
  }
  return commands;
}

// Subsequence matching, scored so that the thing you were obviously aiming at
// wins. Typing "нз" should reach «Нове завдання» before it reaches anything
// that merely contains an н and a з.
export function fuzzyScore(text, query) {
  const haystack = String(text || '').toLowerCase();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 0;
  if (!haystack) return null;

  let score = 0;
  let index = 0;
  let previous = -1;
  for (const character of needle) {
    if (character === ' ') continue;
    const found = haystack.indexOf(character, index);
    if (found === -1) return null;
    // Consecutive characters are worth much more than scattered ones.
    if (found === previous + 1) score += 8;
    // So is landing on the start of a word.
    if (found === 0) score += 12;
    else if (/[\s\-_/]/.test(haystack[found - 1])) score += 6;
    else score += 1;
    previous = found;
    index = found + 1;
  }
  // A short label that matched is a better answer than a long one that also did.
  return score + Math.max(0, 20 - haystack.length / 4);
}

function keywordScore(text, query) {
  const haystack = String(text || '').trim().toLowerCase();
  const needle = String(query || '').trim().toLowerCase();
  if (!haystack || !needle) return null;

  // A keyword field is a bag of aliases, not one giant word. Scoring a fuzzy
  // subsequence across all aliases let three letters hop through a 50-character
  // string and manufacture a match. Exact phrases still work ("my tasks"),
  // while fuzzy matching is constrained to one actual alias.
  if (haystack.includes(needle)) return fuzzyScore(haystack, needle);
  const scores = haystack
    .split(/\s+/)
    .map(keyword => fuzzyScore(keyword, needle))
    .filter(score => score !== null);
  return scores.length ? Math.max(...scores) : null;
}

// The empty menu shows every action and every destination. It used to share one
// 12-row budget with the projects, so a full workspace — a running timer, two
// organizations — pushed «Аналітика» and «Налаштування» off the bottom of a
// menu whose whole job is to list where you can go. A menu that hides half of
// itself is worse than no menu. Projects are the part that can be long, so they
// are the part that is capped.
const MENU_PROJECTS = 4;

export function rankCommands(commands, query, { limit = 12 } = {}) {
  const term = String(query || '').trim();
  if (!term) {
    const menu = [...(commands || [])]
      .sort((a, b) => COMMAND_GROUPS.indexOf(a.group) - COMMAND_GROUPS.indexOf(b.group));
    const fixed = menu.filter(command => command.group === 'action' || command.group === 'navigation');
    const rest = menu.filter(command => command.group !== 'action' && command.group !== 'navigation');
    return [...fixed, ...rest.slice(0, MENU_PROJECTS)];
  }

  return (commands || [])
    .map(command => {
      const label = fuzzyScore(command.label, term);
      const keywords = keywordScore(command.keywords, term);
      const best = Math.max(label ?? -Infinity, (keywords ?? -Infinity) - 6);
      return Number.isFinite(best) ? { command, score: best } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .slice(0, limit)
    .map(entry => entry.command);
}

// Search results arrive asynchronously and are appended rather than ranked
// against the static catalogue: they answer a different question ("which task?")
// and mixing the two scores makes both worse.
export function issueCommands(results = [], projects = []) {
  return results.slice(0, 8).map(issue => ({
    id: `issue-${issue.id}`,
    group: 'issue',
    label: issue.title || 'Завдання',
    hint: [issue.issueKey, projects.find(item => item.id === issue.projectId)?.name]
      .filter(Boolean).join(' · '),
    href: issuePath(issue, projects.find(item => item.id === issue.projectId) || issue.projectId),
    icon: 'issue',
  }));
}

// QUI-104. The other three kinds the server now answers with. Projects appear
// here as well as in `buildCommands` — the static list only knows the projects
// already loaded in the client and matches their names, while these are matched
// on the server by description and issue prefix too. `groupCommands` renders one
// «Проєкти» group, and identical ids collapse rather than doubling up.
const dedupe = commands => {
  const seen = new Set();
  return commands.filter(command => !seen.has(command.id) && seen.add(command.id));
};

export function searchCommands({ people = [], projects = [], events = [] } = {}) {
  return [
    ...people.slice(0, 6).map(person => ({
      id: `person-${person.id}`,
      group: 'person',
      label: person.name || 'Учасник',
      hint: person.email || '',
      href: `/team?member=${encodeURIComponent(person.id)}`,
      icon: 'user',
    })),
    ...projects.slice(0, 6).map(project => ({
      id: `project-${project.id}`,
      group: 'project',
      label: project.name || 'Проєкт',
      href: `/${project.id}`,
      icon: 'folder',
    })),
    ...events.slice(0, 6).map(event => ({
      id: `event-${event.id}`,
      group: 'event',
      label: event.title || 'Подія',
      hint: event.startAt
        ? new Date(event.startAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })
        : '',
      href: `/calendar/event/${event.id}`,
      icon: 'calendar',
    })),
  ];
}

export { dedupe as dedupeCommands };

// Grouped for rendering, in relevance order, with the flat index each row needs
// for keyboard selection. rankCommands already puts the best result first, so
// each group's first input position is its highest-ranked member.
export function groupCommands(commands) {
  const unique = dedupe(commands || []);
  const groups = [];
  for (const [catalogueIndex, group] of COMMAND_GROUPS.entries()) {
    const items = unique.filter(command => command.group === group);
    if (!items.length) continue;
    groups.push({
      group,
      label: GROUP_LABELS[group],
      items,
      firstRank: unique.indexOf(items[0]),
      catalogueIndex,
    });
  }
  return groups
    .sort((a, b) => a.firstRank - b.firstRank || a.catalogueIndex - b.catalogueIndex)
    .map(({ firstRank: _firstRank, catalogueIndex: _catalogueIndex, ...group }) => group);
}

export function flattenGroups(groups) {
  return (groups || []).flatMap(entry => entry.items);
}
