// tests/visual/sections.mjs — the section list the screenshot suite covers.
//
// Playwright needs the test names before it opens a browser, so the list is
// static. It is not allowed to drift: `ui-kit.spec.mjs` reads the navigation
// out of the live page and fails when the two disagree, which is what makes a
// newly added section arrive with a baseline instead of silently uncovered.
export const SECTIONS = [
  { id: 'tokens', label: 'Design Tokens' },
  { id: 'typography', label: 'Typography' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'inputs', label: 'Inputs, Selectors & Pickers' },
  { id: 'selects', label: 'Selects & Dropdowns' },
  { id: 'tabs', label: 'Tabs' },
  { id: 'badges', label: 'Priority, Tags & Counters' },
  { id: 'avatars', label: 'Avatars & Teams' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'tooltips', label: 'Tooltips' },
  { id: 'task-attributes', label: 'Task Attributes Panel' },
  { id: 'calendar', label: 'Календар — власні елементи' },
  { id: 'form-groups', label: 'Form Groups' },
  { id: 'filters', label: 'Filter Bar' },
  { id: 'navigation-overlays', label: 'Navigation & Overlays' },
  { id: 'progress', label: 'KPI Cards' },
  { id: 'charts', label: 'Графіки й таблиці' },
  { id: 'feedback', label: 'Feedback & States' },
  { id: 'skeletons', label: 'Skeletons' },
  { id: 'chat-composer', label: 'Chat Composer Dock' },
  { id: 'chat-elements', label: 'Чат — власні елементи' },
  { id: 'task-crm', label: 'Task Rows' },
  { id: 'task-elements', label: 'Задачі — власні елементи' },
  { id: 'dialogs', label: 'Dialogs & Modals' },
  { id: 'headers', label: 'Header (Хедер)' },
  { id: 'page-headers', label: 'Page Header (Шапка)' },
  { id: 'sidebar-layout', label: 'Workspace Shell' },
  { id: 'inner-nav-layout', label: 'SidebarLayout — 3 контексти' },
  { id: 'detail-layout', label: 'Деталі задачі й події' },
  { id: 'variant-matrix', label: 'Матриця варіантів' },
  { id: 'states', label: 'Матриця станів' },
];

// The one section photographed twice. Its hover and focus cells have no DOM of
// their own — a pseudo-class cannot be rendered, only provoked — so a second
// pass forces `:hover` and `:focus-visible` through CDP and takes another shot.
// Kept out of SECTIONS so the navigation guard still compares like with like.
export const FORCED_STATE_SECTION = 'states';
