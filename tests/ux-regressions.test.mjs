import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('task selection is entered from kebab menus, never from hover', async () => {
  const [board, list, card, row] = await Promise.all([
    read('src/components/workspace/AgileBoard.jsx'),
    read('src/components/ui/TaskManagement/TaskListView.jsx'),
    read('src/components/workspace/IssueCard.jsx'),
    read('src/components/ui/TaskManagement/TaskRow.jsx'),
  ]);
  assert.match(board, /label: allSelected \? 'Зняти вибір у колонці' : 'Вибрати всі у колонці'/);
  assert.match(list, /Вибрати всі у списку/);
  assert.match(card, /selectionActive && onSelect/);
  assert.match(row, /selectionActive && onSelect/);
  assert.doesNotMatch(card, /group-hover[^\n]*(Checkbox|checkbox)/);
  assert.doesNotMatch(row, /group-hover[^\n]*(Checkbox|checkbox)/);
});

test('card and row checkbox replace the priority slot, including no priority', async () => {
  const [card, row, priorityIcon] = await Promise.all([
    read('src/components/workspace/IssueCard.jsx'),
    read('src/components/ui/TaskManagement/TaskRow.jsx'),
    read('src/components/ui/DataDisplay/PriorityIcon.jsx'),
  ]);
  assert.ok(card.indexOf('selectionActive && onSelect ?') < card.indexOf('<PriorityIcon priority={priorityConfig}'));
  assert.ok(row.indexOf('selectionActive && onSelect ?') < row.indexOf('<PriorityIcon priority={priorityConfig}'));
  assert.match(priorityIcon, /if \(config\.isNoPriority\)/);
  assert.match(priorityIcon, /NO_PRIORITY_OUTER_RADIUS = 5\.5/);
  assert.match(priorityIcon, /NO_PRIORITY_PATH_RADIUS = NO_PRIORITY_OUTER_RADIUS - \(NO_PRIORITY_STROKE_WIDTH \/ 2\)/);
  assert.match(priorityIcon, /strokeDasharray="0\.8 1\.6"/);
  assert.match(priorityIcon, /opacity="0\.32"/);
});

test('requested navigation and readability regressions stay fixed', async () => {
  const [board, sidebar, help, search, team, settings, bulk] = await Promise.all([
    read('src/components/workspace/AgileBoard.jsx'),
    read('src/components/WorkspaceSidebar.jsx'),
    read('src/components/WorkspaceHelpMenu.jsx'),
    read('src/components/ui/Forms/HeaderSearch.jsx'),
    read('src/components/ui/Navigation/MemberRail.jsx'),
    read('src/app/(app)/settings/page.js'),
    read('src/components/ui/TaskManagement/BulkActionBar.jsx'),
  ]);
  // The plus that used to stand beside the kebab went with the rule it broke:
  // only a client opens a request, so no column of any board is a place to file
  // one. The kebab is the whole column control now.
  assert.doesNotMatch(board, /icon=\{Plus\}/);
  assert.doesNotMatch(board, /Додати інцидент/);
  assert.doesNotMatch(board, /InlineAddForm|onAddIssue|onRequestAddIssue/);
  assert.doesNotMatch(board, /kanban-full-bleed/);
  // The kebab keeps its miniature box, the vertical glyph the rest of the
  // product uses, and a smaller icon size so three filled dots do not read
  // darker than two hairline strokes.
  assert.match(board, /icon=\{MoreVertical\}\s*\r?\n\s*composition="section-kebab"/);
  // The wrapper is a flex box in the component itself, so no call site has to
  // pass `flex` — which collided with its `inline-block` and left the kebab
  // sitting on a text baseline, a few pixels above the plus beside it.
  const contextMenu = await read('src/components/ui/ContextMenu.jsx');
  assert.match(contextMenu, /relative inline-flex items-center/);
  assert.doesNotMatch(contextMenu, /relative inline-block/);
  assert.doesNotMatch(board, /<ContextMenu\s*\r?\n\s*className="flex"/);
  // A larger box pushed long status names onto a second row.
  assert.doesNotMatch(board, /size="icon-sm"/);
  assert.match(board, /ui-type-column-title[^"]*truncate" title=\{col\.label\}/);
  // The clip and the gutter belong to different boxes — one element carrying
  // both cancels itself out inside an `overflow: hidden` parent.
  assert.match(board, /overflow-hidden bleed-edges/);
  assert.match(board, /overflow-auto[^"]*bleed-gutter/);
  // A bare pseudo-element hit area answered nothing: no hover, no pointer. The
  // collapse and expand controls are 32px buttons that react like buttons.
  assert.doesNotMatch(sidebar, /after:-inset-\[8px\]/);
  // 36px, not 32: the old pseudo-element inset already gave the glyph a 36px
  // target, and shrinking it to fit a hover box would undo the enlargement.
  assert.equal((sidebar.match(/h-\[36px\] w-\[36px\][^"]*cursor-pointer/g) || []).length, 2);
  // qTicket is not the task manager: the workspace rail never grows an
  // inherited timer capsule, regardless of timer state left in legacy data.
  assert.doesNotMatch(sidebar, /activeTimer|timerElapsed|timerTargetHref/);
  assert.doesNotMatch(help, />\s*Допомога\s*</);
  assert.doesNotMatch(help, /<Tooltip/);
  // Help is a square, not a rail-wide slab.
  assert.doesNotMatch(help.slice(0, help.indexOf('<Dialog')), /w-full/);
  assert.match(help, /size="icon"\s+icon=\{CircleHelp\}/);
  // The palette shortcut is a hint, and a hint nobody needs while they are
  // looking elsewhere: it fades in on hover or focus rather than sitting in the
  // header all day.
  assert.match(search, /group\/search/);
  assert.match(search, /opacity-0 transition-opacity group-hover\/search:/);
  assert.match(search, /group-focus-within\/search:opacity-100/);
  assert.doesNotMatch(team, /lastActivity|Остання активність/);
  // Every settings section is one level deep, so the way out is the pane's own
  // arrow beside the title — never a labelled ghost button on its own row.
  assert.doesNotMatch(settings, /backLabel|backAction/);
  // The bulk bar's pickers are drawn on the dark bar, never as white blocks
  // dropped on top of it, and the bar wraps instead of cropping its last
  // controls inside an invisible scroller.
  assert.doesNotMatch(bulk, /!bg-white hover:!bg-canvas !text-ink/);
  assert.match(bulk, /ui-bulk-actions__trigger/);
  assert.equal((bulk.match(/ui-bulk-actions__control/g) || []).length, 5);
});

test('help, news and versions are read in place; contracts keep their own address', async () => {
  const [menu, centre, shell, legal, helpExplorer, newsIndex, support, authShell, login] = await Promise.all([
    read('src/components/WorkspaceHelpMenu.jsx'),
    read('src/components/WorkspaceInfoCenter.jsx'),
    read('src/app/(public)/layout.js'),
    read('src/app/(public)/_components/LegalDocumentPage.jsx'),
    read('src/app/(public)/help/HelpExplorer.jsx'),
    read('src/app/(public)/news/page.js'),
    read('src/components/SupportDialog.jsx'),
    read('src/components/AuthLayout.jsx'),
    read('src/app/login/page.js'),
  ]);
  // A public route gets brand identity, not a second navigation system. Help
  // already lives in the product and each contract keeps its own URL.
  const withoutComments = source => source.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(shell, /next\/image/);
  assert.match(shell, /aria-label="qTicket — головна"/);
  assert.doesNotMatch(withoutComments(shell), /<nav|Довідка|Правова інформація|До робочого простору|PublicBackLink|router\.back|Назад/);
  // A contract is a heading followed by its text, without a document hub,
  // duplicated metadata, a contents rail or cross-document footer.
  assert.match(legal, /<article aria-label=\{document\.title\}/);
  assert.doesNotMatch(withoutComments(legal), /Tabs|LEGAL_TABS|Набуває чинності|Постачальник сервісу|Зміст документа|<aside|<footer|next\/link/);
  // …and set in the product's own type scale, not a landing page's.
  for (const [name, source] of [
    ['legal document', legal],
    ['help explorer', helpExplorer],
    ['news index', newsIndex],
  ]) {
    assert.doesNotMatch(
      withoutComments(source),
      /font-black|rounded-3xl|shadow-sm|text-[34]xl/,
      `${name} must use the kit's scale, not a second one`,
    );
  }
  // Three things you glance at and close. They used to navigate to a separate
  // public shell and throw away whatever was on screen.
  for (const pane of ['help', 'news']) {
    assert.match(menu, new RegExp(`setInfoPane\\('${pane}'\\)`));
  }
  assert.doesNotMatch(menu, /router\.push\('\/(help|news)'\)/);
  // The version history went out with its page: a changelog grouped by area is
  // written for whoever built the thing, not for somebody asking what changed.
  // The build number stays, because a support conversation asks for it.
  assert.doesNotMatch(menu, /setInfoPane\('versions'\)/);
  assert.match(support, /qTicket \{APP_VERSION\}/);
  // A contract needs an address that can be linked, printed and cited.
  for (const legalRoute of ['/terms', '/privacy', '/offer']) {
    assert.match(menu, new RegExp(`router\\.push\\('${legalRoute}'\\)`));
  }

  // The sign-in shell is not a lesser place to be told any of this. It is the
  // screen you land on before a workspace, between two of them, and after
  // something has gone wrong — so it carries the same three documents, the
  // published help, and the same support dialog the workspace opens, rather
  // than a lone privacy link and its own private list of contacts.
  for (const route of ['/help', '/terms', '/privacy', '/offer']) {
    assert.match(authShell, new RegExp(`href: '${route}'`));
  }
  assert.match(authShell, /<SupportDialog isOpen=\{supportOpen\}/);
  assert.match(menu, /<SupportDialog isOpen=\{supportOpen\}/);
  // One list of channels, in one file: two copies would drift, and the copy
  // that drifted would be the one a stranded person reads.
  assert.match(support, /ONEB_SUPPORT_CONTACTS/);
  for (const source of [menu, authShell]) {
    assert.doesNotMatch(source, /ONEB_SUPPORT_CONTACTS/);
  }

  // Consent under the sign-in buttons covers the two documents a person can be
  // said to have agreed to by signing in, and links both. The offer is a
  // commercial contract, bound in by §1 of the terms and accepted when
  // something is bought — asking for agreement to it at the door was asking
  // for more than the door is for. It stays one line below, in the footer.
  const consent = withoutComments(login).match(/Продовжуючи, ви погоджуєтеся з[\s\S]*?<\/p>/)?.[0] || '';
  assert.match(consent, /href="\/terms"/);
  assert.match(consent, /href="\/privacy"/);
  assert.doesNotMatch(consent, /href="\/offer"/);
  // The centre reads the catalogue by role: «?» is in the rail for an external
  // client too, and the support team's manual is not theirs to read.
  assert.match(centre, /helpArticlesForRole\(role\)/);
  assert.match(centre, /NEWS_ARTICLES/);
});

test('the quiet greys stay light and stay three steps apart', async () => {
  const [styles, { textContrastRatio }] = await Promise.all([
    read('src/app/globals.css'),
    import('../scripts/kit-a11y.mjs'),
  ]);
  const token = name => styles.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
  const canvas = token('canvas');
  const muted = textContrastRatio(token('muted'), canvas);
  const faint = textContrastRatio(token('faint'), canvas);
  // Pushed to AA these two landed nine points apart and the product went heavy.
  // What has to hold is that they are visible and that they are not one grey.
  assert.ok(muted > 2, `muted must stay readable, got ${muted}`);
  assert.ok(muted < 4, `muted must stay light, got ${muted}`);
  assert.ok(muted - faint > 0.5, 'faint must stay clearly quieter than muted');
});

test('a project card offers no action the role cannot perform', async () => {
  const projects = await read('src/app/(app)/page.js');
  assert.match(projects, /const canEditProject = can\(orgRole, 'edit:project_settings'\)/);
  assert.match(projects, /const canDeleteProject = can\(orgRole, 'delete:project'\)/);
  assert.match(projects, /\{projectMenuItems\.length > 0 && \(/);
  // «N моїх» is not something anyone acts on — and neither, on a card, was any
  // of the four counters that replaced it in turn. The featured card ends in
  // the last three things that happened, which is a reason to open it; the
  // small ones end in nothing at all.
  assert.doesNotMatch(projects, /<span>моїх<\/span>/);
  assert.doesNotMatch(projects, /<span>прострочено<\/span>/);
  assert.match(projects, /recentActions\.map\(action =>/);
});

test('a new task appears at the top of My tasks, as it does on a board', async () => {
  const { compareMyTaskIssues } = await import('../src/lib/utils/myTaskOrder.mjs');
  const arranged = { old: 0, older: 1 };
  const fresh = { id: 'fresh', order: -9 };
  const sorted = [
    { id: 'old', order: -1 },
    { id: 'older', order: -2 },
    fresh,
  ].toSorted(compareMyTaskIssues(arranged));
  assert.equal(sorted[0].id, 'fresh');
  // Cards the user has arranged keep the order they were dragged into.
  assert.deepEqual(sorted.slice(1).map(issue => issue.id), ['old', 'older']);
});

// Дві знахідки з одного повідомлення: у редакторі опису при створенні завдання
// не було «прикріпити файл», хоч у самому завданні воно є, і жодна іконка
// тулбара не показувала підказки.
test('an icon button says what it is, and the description toolbar says it in the kit’s own bubble', async () => {
  const iconAction = await read('src/components/ui/IconAction.jsx');
  const editor = await read('src/components/ui/Forms/MarkdownEditor.jsx');

  // Документація IconAction завжди обіцяла «Accessible name and tooltip», і
  // правдивою була тільки перша половина: aria-label називає кнопку для
  // читалки і не показує зрячій людині нічого.
  assert.match(iconAction, /title=\{tooltip \? undefined : label\}/);
  assert.match(iconAction, /aria-label=\{label\}/);
  // Бульбашка кіта — за згодою, бо Tooltip додає обгортку навколо тригера, а
  // обгортка не безкоштовна у flex-рядку чи в абсолютному куті.
  assert.match(iconAction, /if \(!tooltip\) return control;/);
  assert.match(iconAction, /<Tooltip/);

  // Тулбар опису — шістнадцять іконок поспіль без жодного тексту, саме там це
  // й помітили.
  assert.match(editor, /tooltip="bottom"/);
});

test('the task composer can attach a file, like the task screen already could', async () => {
  const composer = await read('src/components/CreateTaskModal.jsx');
  const editor = await read('src/components/ui/Forms/MarkdownEditor.jsx');

  // MarkdownEditor малює скріпку лише коли йому передали onUploadFiles — цей
  // виклик не передавав, і кнопка просто не існувала.
  assert.match(editor, /\{onUploadFiles && \(/);
  assert.match(composer, /onUploadFiles=\{handleUploadFiles\}/);
  assert.match(composer, /uploading=\{uploadingFiles\}/);

  // Тека — та сама, що й у завдання, і вона scoped на організацію: підпис
  // /api/upload/sign відмовляє в чужій.
  assert.match(composer, /`organizations\/\$\{organizationId\}\/attachments`/);

  // І скріпка стоїть перед «Посилання», а не в кінці рядка. Тулбар
  // прокручується, коли редактор вузький — а вузький він саме в модалці
  // створення, — тож остання кнопка в рядку невидима, доки хтось не здогадається
  // його потягнути.
  const clip = editor.indexOf('icon={uploading ? LoaderCircle : Paperclip}');
  const link = editor.indexOf('label="Посилання (Ctrl+K)"');
  const quote = editor.indexOf('label="Цитата"');
  assert.ok(clip > 0 && link > 0 && quote > 0, 'усі три кнопки на місці');
  assert.ok(quote < clip && clip < link, 'скріпка між «Цитата» і «Посилання»');
  // В одній групі з посиланням, кодом і таблицею — тобто без власного
  // розділювача між нею і ними.
  assert.doesNotMatch(editor.slice(clip, link), /<ToolbarDivider \/>/);
});
