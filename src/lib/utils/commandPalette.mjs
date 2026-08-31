// src/lib/utils/commandPalette.mjs
// What the command palette can do, and how a query picks from it.
//
// Pure: descriptors carry an icon *name*, never a component, so the whole
// catalogue and its ranking can be asserted without React. The workspace
// already has a route table, a client-space list, a permission helper and a
// search API; this is the layer that lets one keystroke reach them coherently.

import { issuePath } from './issueKeys.mjs';

export const COMMAND_GROUPS = ['action', 'navigation', 'project', 'issue', 'person'];

export const GROUP_LABELS = {
  action: 'Дії',
  navigation: 'Перейти',
  project: 'Клієнти',
  issue: 'Звернення',
  person: 'Люди',
};

// Latin spellings sit next to the Ukrainian ones on purpose. People type with
// whatever layout is active, and having to notice the layout before you can
// search is exactly the friction the palette exists to remove.
const INTERNAL_NAVIGATION = [
  { id: 'nav-overview', label: 'Огляд', href: '/overview', icon: 'overview', keywords: 'ohliad overview dashboard support pidtrymka' },
  { id: 'nav-incidents', label: 'Звернення', href: '/my', icon: 'issue', keywords: 'intsydenty incidents requests zvernennya queue cherha' },
  { id: 'nav-clients', label: 'Клієнти', href: '/clients', icon: 'folder', keywords: 'kliyenty clients customers projects proekty' },
  { id: 'nav-team', label: 'Команда', href: '/team', icon: 'users', keywords: 'komanda team support people ludy' },
  { id: 'nav-settings', label: 'Налаштування', href: '/settings', icon: 'settings', keywords: 'nalashtuvannya settings preferences profile workflow' },
];

const CLIENT_NAVIGATION = [
  { id: 'nav-requests', label: 'Мої звернення', href: '/', icon: 'issue', keywords: 'moi zvernennya requests incidents support dopomoha' },
  // The same address the support team's «Команда» is. One roster screen, and
  // the client boundary decides which half of it a `client_admin` sees; the
  // settings section this used to point at is gone at every door.
  { id: 'nav-client-team', label: 'Співробітники', href: '/team', icon: 'users', keywords: 'spivrobitnyky employees people team komanda', clientAdminOnly: true },
  { id: 'nav-profile', label: 'Мій профіль', href: '/settings?section=profile', icon: 'user', keywords: 'mii profil profile account settings' },
];

// `permission` is checked against `can(orgRole, …)` by the caller, so this file
// stays free of the permission model.
//
// Actions are deliberately qTicket-native. The calendar, the sprints and the
// timer the inherited engine came with are deleted, and the palette is the last
// place they could come back through — a shortcut to a screen is a screen.
//
// «Нове звернення» is not among them. Only a client opens a request — support
// receives it, works it and closes it — so the internal palette creates the
// space a customer writes in, and nothing inside it.
const INTERNAL_ACTIONS = [
  {
    id: 'action-new-client',
    label: 'Новий клієнт',
    hint: 'Створити клієнтський простір',
    href: '/clients?new=1',
    icon: 'folder',
    permission: 'create:project',
    keywords: 'novyi kliyent new client customer project proekt stvoryty create',
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

// The palette a client opens sits behind «Мої звернення», and it says the same
// word the portal behind it does. There is one name for the record, and a
// palette action is not a place that gets to invent a second.
const CLIENT_ACTIONS = [
  {
    id: 'action-new-issue',
    label: 'Створити звернення',
    hint: 'Опишіть проблему або запит до підтримки',
    href: '/?new=1',
    icon: 'plus',
    keywords: 'stvoryty intsydent nove zvernennya new incident request support help',
  },
  INTERNAL_ACTIONS.find(action => action.id === 'action-switch-org'),
];

export function buildCommands({
  projects = [],
  allowedPermissions = [],
  organizationCount = 1,
  role = 'member',
} = {}) {
  const clientRole = role === 'client_admin' || role === 'client_member';
  const permitted = new Set(allowedPermissions);
  const commands = [];

  for (const action of clientRole ? CLIENT_ACTIONS : INTERNAL_ACTIONS) {
    if (action.permission && !permitted.has(action.permission)) continue;
    if (action.requiresManyOrganizations && organizationCount < 2) continue;
    commands.push({ ...action, group: 'action' });
  }
  for (const entry of clientRole ? CLIENT_NAVIGATION : INTERNAL_NAVIGATION) {
    if (entry.clientAdminOnly && role !== 'client_admin') continue;
    commands.push({ ...entry, group: 'navigation' });
  }
  if (clientRole) return commands;
  for (const project of projects) {
    if (!project?.id || project.status === 'archived') continue;
    commands.push({
      id: `project-${project.id}`,
      group: 'project',
      label: project.name || 'Клієнт',
      href: `/${project.id}`,
      icon: 'folder',
      keywords: project.issuePrefix || '',
    });
  }
  return commands;
}

// Subsequence matching, scored so that the thing you were obviously aiming at
// wins. Typing "зв" should reach «Створити звернення» before it reaches
// anything that merely contains a з and a в.
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
// 12-row budget with the client spaces, so a full workspace pushed important
// destinations like «Налаштування» off the bottom of a
// menu whose whole job is to list where you can go. A menu that hides half of
// itself is worse than no menu. Clients are the part that can be long, so they
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
// against the static catalogue: they answer a different question ("which incident?")
// and mixing the two scores makes both worse.
export function issueCommands(results = [], projects = []) {
  return results.slice(0, 8).map(issue => ({
    id: `issue-${issue.id}`,
    group: 'issue',
    label: issue.title || 'Звернення',
    hint: [issue.issueKey, projects.find(item => item.id === issue.projectId)?.name]
      .filter(Boolean).join(' · '),
    href: issuePath(issue, projects.find(item => item.id === issue.projectId) || issue.projectId),
    icon: 'issue',
  }));
}

// The two qTicket kinds the server answers with beside incidents. Client spaces
// appear here as well as in `buildCommands` — the static list only knows the projects
// already loaded in the client and matches their names, while these are matched
// on the server by description and issue prefix too. `groupCommands` renders one
// «Клієнти» group, and identical ids collapse rather than doubling up.
const dedupe = commands => {
  const seen = new Set();
  return commands.filter(command => !seen.has(command.id) && seen.add(command.id));
};

export function searchCommands({ people = [], projects = [] } = {}) {
  return [
    // Where a person is opened is decided by where they can be found, and the
    // server answers that with the result: `spaceId` is the client space a
    // customer contact is reachable in, and null for the support team. Without
    // it every result went to «Команда», which is the support roster and
    // filters client roles out — so asking for a customer by name landed on a
    // screen that selected whoever happened to be first in a list they were
    // never in.
    ...people.slice(0, 6).map(person => ({
      id: `person-${person.id}`,
      group: 'person',
      label: person.name || 'Учасник',
      hint: person.email || '',
      href: person.spaceId
        ? `/${person.spaceId}?member=${encodeURIComponent(person.id)}`
        : `/team?member=${encodeURIComponent(person.id)}`,
      icon: 'user',
    })),
    ...projects.slice(0, 6).map(project => ({
      id: `project-${project.id}`,
      group: 'project',
      label: project.name || 'Клієнт',
      href: `/${project.id}`,
      icon: 'folder',
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
