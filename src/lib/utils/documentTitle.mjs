// src/lib/utils/documentTitle.mjs
// What the browser tab says.
//
// Every authenticated screen used to render the same six letters, because the
// only title in the app was the one static string in the root layout and the
// workspace is a client tree that never sets its own. A person with the board,
// a task, the chat and settings open in four tabs had four tabs reading
// "QuickTeam" and had to click through them to find one.
//
// Pure so the mapping can be asserted without a browser: the component that
// uses it only writes the result to document.title.

const BRAND = 'qTicket';

// Route → what to call that screen. Order matters: the first match wins, and
// `/` is exact because every other path also starts with it.
export const ROUTE_TITLES = [
  { path: '/', exact: true, title: 'Огляд' },
  { path: '/overview', title: 'Огляд' },
  { path: '/clients', title: 'Клієнти' },
  // The words the screens themselves use — the tab is not the place to invent
  // a third name for a destination the sidebar and the page already agree on.
  { path: '/my', title: 'Інциденти' },
  { path: '/chat', title: 'Чат' },
  { path: '/analytics', title: 'Аналітика' },
  { path: '/team', title: 'Команда' },
  { path: '/settings', title: 'Налаштування' },
  { path: '/ai-call', title: 'Дзвінок в інциденти' },
];

export function routeTitle(pathname, projects = [], { clientPortal = false } = {}) {
  const path = String(pathname || '/');
  if (path === '/' && clientPortal) return 'Мої звернення';
  for (const entry of ROUTE_TITLES) {
    if (entry.exact ? path === entry.path : path.startsWith(entry.path)) return entry.title;
  }
  // Everything else is /<projectId>[/...]: the project *is* the screen's name.
  const projectId = path.split('/').filter(Boolean)[0] || '';
  const project = (projects || []).find(item => item?.id === projectId);
  if (project?.name) return project.name;
  // The one such route a client can open is their own incident, and until the
  // spaces load there is no name for it — «Проєкт» is a word from the product
  // they did not buy, so their tab says where they are instead.
  if (clientPortal) return 'Мої звернення';
  return projectId ? 'Проєкт' : BRAND;
}

// The breadcrumb trail is already the answer to "where am I", and detail screens
// fill it with the thing you are actually looking at — the issue key, the event
// name. Reusing it means a new detail screen gets a real tab title for free,
// and the tab can never disagree with the header.
export function workspaceDocumentTitle({
  pathname = '/',
  breadcrumbs = [],
  projects = [],
  organizationName = '',
  clientPortal = false,
} = {}) {
  const trail = (breadcrumbs || [])
    .map(crumb => String(crumb?.label || '').trim())
    .filter(label => label && label !== '...');

  const leaf = trail.length
    ? trail[trail.length - 1]
    : routeTitle(pathname, projects, { clientPortal });
  const context = trail.length > 1 ? trail[trail.length - 2] : '';
  const brand = String(organizationName || '').trim() || BRAND;

  // Most specific first: a browser truncates a tab title from the right, so the
  // part that identifies the tab has to be the part that survives.
  return [leaf, context, brand]
    .filter((part, index, parts) => part && parts.indexOf(part) === index)
    .join(' · ');
}

// The unread decoration. Kept next to the title it decorates so the two cannot
// drift into fighting over document.title, which is what happened when one
// component wrote the title and another sniffed it back out with a regex to
// recover the undecorated form.
export function decorateTitle(baseTitle, { unread = 0, alternate = false } = {}) {
  const title = baseTitle || BRAND;
  if (!unread) return title;
  return alternate ? `Нове повідомлення · ${title}` : `(${unread}) ${title}`;
}
