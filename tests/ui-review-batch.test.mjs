// QUI-129…QUI-142 plus the project-settings unification.
//
// One batch of reported UI issues. They are kept together rather than folded
// into issue-fixes.test.mjs because most of them are the same kind of finding:
// a decision that lived at a call site instead of in the kit, so the same thing
// looked different depending on where you opened it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readShowcase } from '../scripts/ui-kit-showcase.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// The catalogue is a directory of story files; these assertions ask whether it
// shows something at all, not which file it lives in.
const readKitShowcase = () => readShowcase().everything;

test('QUI-129 and QUI-139 keep the project header free of team avatars', async () => {
  const [topHeader, workspaceHeader, kit] = await Promise.all([
    read('../src/components/ui/Layout/TopHeader.jsx'),
    read('../src/components/WorkspaceHeader.jsx'),
    readKitShowcase(),
  ]);
  for (const source of [topHeader, workspaceHeader, kit]) {
    assert.doesNotMatch(source, /projectMembers/, 'the project team avatar strip is gone');
  }
  assert.doesNotMatch(topHeader, /ProjectMembersMenu/);
  // Nor a strip of who is online, for two reasons that arrived together: a
  // ticket system does not report on the whereabouts of the people answering
  // tickets, and the only screen that ever filled the strip was the workspace
  // messenger.
  assert.doesNotMatch(topHeader, /renderOnlineUsers|onlineUsers/);
  // The preview also stopped reaching for a third-party avatar host, which had
  // been failing on every page load.
  assert.doesNotMatch(kit, /pravatar/);
});

test('qTicket headers distinguish global screens from client spaces', async () => {
  const [topHeader, workspaceHeader, kit] = await Promise.all([
    read('../src/components/ui/Layout/TopHeader.jsx'),
    read('../src/components/WorkspaceHeader.jsx'),
    readKitShowcase(),
  ]);

  assert.match(workspaceHeader, /pathname\.startsWith\('\/overview'\)/);
  assert.match(workspaceHeader, /pathname\.startsWith\('\/clients'\)/);
  assert.match(workspaceHeader, /placeholder: 'Пошук клієнтів\.\.\.'/);
  assert.match(topHeader, /\{ label: 'Клієнти', href: '\/clients' \}/);
  assert.match(topHeader, /Пошук інцидентів клієнта/);
  assert.doesNotMatch(topHeader, /Назва проєкту|label: 'Проєкти'/);
  assert.match(kit, /Client Space Mode/);
  assert.match(kit, /INC-104: Не працює імпорт/);
});

test('QUI-130 drops the epic copy and leads the type list with Задача', async () => {
  const [settings, workflow, taskTypes] = await Promise.all([
    read('../src/app/(app)/settings/page.js'),
    read('../src/lib/hooks/useWorkflowConfig.js'),
    read('../src/lib/utils/taskTypes.mjs'),
  ]);
  assert.doesNotMatch(settings, /Старі Епіки лишаються видимими/);
  assert.doesNotMatch(settings, /legacy-дані/);
  assert.match(workflow, /export const DEFAULT_TYPES = DEFAULT_TASK_TYPES/);
  const types = taskTypes.slice(
    taskTypes.indexOf('export const DEFAULT_TASK_TYPES'),
    taskTypes.indexOf('export const BUILT_IN_TASK_TYPE_ICON_KEYS'),
  );
  assert.ok(types.indexOf("id: 'task'") < types.indexOf("id: 'feature'"), 'Задача leads the list');
});

// QUI-131 approved "several statuses may close a task, but the board must keep
// somewhere for new work to land". The control that says so is now the status's
// category — `isDone` was the same idea with a single value — so the invariant is
// stated over categories and no longer over a position in the list.
test('QUI-131 allows several closing statuses but never a workflow without an open one', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  const guard = settings.slice(
    settings.indexOf('const statusGroupsBreakInvariant'),
    settings.indexOf('const handleStatusDragEnd'),
  );
  // Something has to close a task…
  assert.match(guard, /if \(closing === 0\) \{/);
  // …and something has to stay open for new tasks to land in.
  assert.match(guard, /if \(closing === next\.length\) \{/);
  // Every path that could break either one asks the same guard: dragging a
  // status into another category, and deleting one.
  assert.match(settings, /if \(source\.droppableId !== destination\.droppableId\) \{\s*\n\s*const problem = statusGroupsBreakInvariant\(next\);/);
  assert.match(settings, /const problem = statusGroupsBreakInvariant\(statuses\.filter\(s => s\.id !== id\)\);/);
  // And the delete control is disabled rather than refusing after the click.
  assert.match(settings, /const canDeleteStatus = status => \(/);
  assert.match(settings, /Налаштуйте етапи, через які проходять звернення клієнтів/);
});

// The editor is a list per category, the way Linear and Shortcut do it: a status
// belongs to the section it sits in, so the two-layer model is visible instead of
// explained, and the saved array always comes out in the order work flows.
test('the workflow editor groups statuses by category and moves them by dragging', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');

  assert.match(settings, /STATUS_CATEGORY_IDS\.map\(\(categoryId, categoryIndex\) => \{/);
  assert.match(settings, /<Droppable droppableId=\{categoryId\}>/);
  assert.match(settings, /statusAnnouncements\.onDragEnd\(result, provided\);\s*handleStatusDragEnd\(result\)/);
  assert.match(settings, /handleAddStatus\(categoryId\)/);
  // The row carries no category control of its own any more — where it sits is
  // the answer, and two ways to say one thing is how they drift apart.
  assert.doesNotMatch(settings, /onCategoryChange/);
  assert.doesNotMatch(settings, /STATUS_CATEGORY_OPTIONS/);
  // Saved in canonical category order, so a project board's columns follow the
  // flow of work rather than the order somebody happened to add them in.
  assert.match(settings, /flattenStatusGroups\(groups\)/);
  // Dragging is the only category-changing action; a second arrow/menu beside
  // every row duplicated the gesture and consumed the action space.
  assert.doesNotMatch(settings, /onMoveToCategory|handleStatusMoveToCategory|MoveRight/);
  // No id is special any more: what may be deleted is decided by the invariants.
  assert.doesNotMatch(settings, /!\['backlog', 'done'\]\.includes/);
});

test('QUI-133 gives the money input its currency instead of bare padding', async () => {
  const [input, kit] = await Promise.all([
    read('../src/components/ui/Input.jsx'),
    readKitShowcase(),
  ]);
  assert.match(input, /money: 'text-right font-bold tabular-nums'/);
  assert.doesNotMatch(input, /pr-\[54px\]/, 'the hardcoded suffix gutter is gone');
  assert.match(input, /suffixText && \(/);
  // The call sites hand-drew the suffix, at two different sizes and offsets;
  // the field draws it now, so the catalogue can show the one shape there is.
  assert.match(kit, /preset="money" suffix=/);
});

test('QUI-134 gives the neutral dot the surface opposite, not a brand hue', async () => {
  const counter = await read('../src/components/ui/DataDisplay/Counter.jsx');
  assert.doesNotMatch(counter, /818cf8|6366f1/, 'the indigo dot and its glow are gone');
  assert.match(counter, /info: 'bg-white shadow-\[0_0_8px_rgba\(255,255,255,0\.45\)\]'/);
  assert.match(counter, /info: 'bg-ink'/);
  // Colours that mean something keep meaning it.
  assert.match(counter, /danger: 'bg-danger-solid'/);
  assert.match(counter, /success: 'bg-success-solid'/);
});

test('QUI-135 keeps every status pill readable against its own tint', async () => {
  const kit = readKitShowcase();
  // `#cbd5e1` text on a 9% tint of itself scored about 1.5:1. The sprint screen
  // that shipped the unreadable pill is gone; the catalogue still has to show
  // the readable one.
  assert.doesNotMatch(kit, /label="Завершено" color="#cbd5e1"/);
  assert.match(kit, /label="Вирішено" color="#1f1f1f"/);
});

test('QUI-136 gives every tooltip the same seamless arrow', async () => {
  const tooltip = await read('../src/components/ui/Navigation/Tooltip.jsx');
  // A border triangle butted against the bubble showed its seam on `top` — the
  // one side that lands inside the bubble's own downward-offset shadow.
  assert.doesNotMatch(tooltip, /border-[tblr]-\[4px\]/);
  assert.match(tooltip, /absolute h-\[6px\] w-\[6px\] rotate-45 bg-ink/);
  for (const offset of ['bottom-\\[-3px\\]', 'top-\\[-3px\\]', 'right-\\[-3px\\]', 'left-\\[-3px\\]']) {
    assert.match(tooltip, new RegExp(offset), `all four sides use the same offset (${offset})`);
  }
});

// The decision is unchanged; where it is written had to move. The rule below
// declared the grey and the ink and delivered neither: `Button` writes both as
// utilities for whichever `style` it is given, and Tailwind emits the utility
// layer after the components layer, so layer order beat the more specific
// selector. The control went on reading as a bare link with the fix sitting in
// the stylesheet. `style="secondary"` is the same pair, in the place the kit
// already keeps colour — and it is the only one of the two that reaches the
// screen.
test('QUI-137 makes the inline add control look like a button', async () => {
  const globals = await read('../src/app/globals.css');
  const issueDetail = await read('../src/components/workspace/IssueDetail.jsx');
  const kit = await readKitShowcase();
  const rule = globals.slice(
    globals.indexOf(".ui-control[data-ui-composition='inline-add-action'] {"),
    globals.indexOf(".ui-control[data-ui-composition='inline-add-action'] {") + 220,
  );

  // Size only: it is what a custom property can carry past the utility layer.
  assert.match(rule, /--ui-control-height: 26px/);
  assert.doesNotMatch(rule, /background:/, 'a background here cannot beat the utility that Button writes');
  assert.doesNotMatch(rule, /color: var\(--color-ink\)/);

  for (const source of [issueDetail, kit]) {
    for (const match of source.matchAll(/composition="inline-add-action"/g)) {
      const call = source.slice(Math.max(0, match.index - 260), match.index);
      assert.match(call, /style="secondary"/, 'the add control carries the grey the decision asked for');
      assert.doesNotMatch(call.slice(call.lastIndexOf('<Button')), /style="ghost"/);
    }
  }
});

test('QUI-138 says where each rare Dialog variant actually lives', async () => {
  const kit = await readKitShowcase();
  const list = kit.slice(kit.indexOf('const DIALOG_VARIANTS'), kit.indexOf('function DialogsSection'));
  for (const id of ['flush', 'responsive', 'spacious', 'invite', 'horizontal', 'sheet', 'status']) {
    assert.match(list, new RegExp(`id: '${id}'`), `${id} must stay listed`);
  }
  // Bare buttons labelled with prop syntax read as options invented for the
  // catalogue; each one now names the screen it ships on and how to open it —
  // every one of them, however many there are.
  const declared = [...list.matchAll(/\bid: '/g)].length;
  assert.equal([...list.matchAll(/\bwhere:/g)].length, declared);
  assert.equal([...list.matchAll(/\bopen:/g)].length, declared);
  assert.match(kit, /Де на сайті:/);
});

test('QUI-140 removes the unreachable portal route and the variant it kept alive', async () => {
  const [pageHeader, variants] = await Promise.all([
    read('../src/components/ui/Layout/PageHeader.jsx'),
    read('../scripts/kit-variants.mjs'),
  ]);
  await assert.rejects(
    read('../src/app/(app)/[projectId]/portal/page.js'),
    'the orphan route is gone',
  );
  assert.doesNotMatch(pageHeader, /variant === 'alt'/);
  assert.doesNotMatch(variants, /PageHeader: \{ variant/);
});

// QUI-141 / QUI-142. The previews were hand-copies of the rails, and the copies
// were wrong in five ways at once — 8px radius drawn as 10px, the `bg-line`
// selected row drawn as white-with-a-shadow, a 32px avatar drawn at 24px, a
// muted name drawn as bold ink, no presence dot. A copy will always drift; the
// fix is that there is no copy. There were two rails and three call sites; the
// channel rail went with the screen it listed channels for.
test('the team rail exists once, and the page and the catalogue both render it', async () => {
  const [memberRail, team, kit] = await Promise.all([
    read('../src/components/ui/Navigation/MemberRail.jsx'),
    read('../src/app/(app)/team/page.js'),
    readKitShowcase(),
  ]);

  // The markup lives in the component and nowhere else.
  assert.match(memberRail, /rounded-\[8px\][\s\S]{0,80}isSelected \? 'bg-line'/);
  assert.match(memberRail, /<UserAvatar user=\{member\} size="md" \/>/);
  assert.match(memberRail, /text-\[13px\] font-medium truncate/);
  // No presence mark on the rail. Whether a colleague is at their desk is not a
  // fact a ticket system keeps.
  assert.doesNotMatch(memberRail, /PresenceDot/);

  for (const [name, source] of [['team', team], ['kit', kit]]) {
    assert.doesNotMatch(
      source,
      /data-ui-control="chat-list-action"|isSelected \? 'bg-line'/,
      `${name} must render the shared rail, not its own copy of the markup`,
    );
  }
  assert.match(team, /<MemberRail/);
  assert.match(kit, /<MemberRail/);
  assert.doesNotMatch(kit, /<ChannelRail/);
});

test('both entry points to project settings offer the same capabilities', async () => {
  const [projectPage, list] = await Promise.all([
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/app/(app)/page.js'),
  ]);
  // Opening "Налаштування проєкту" from the kebab included archive, delete and
  // invites; opening it inside the project silently dropped all three.
  for (const source of [projectPage, list]) {
    const at = source.indexOf('<BoardConfigModal');
    const call = source.slice(at, at + 600);
    for (const prop of ['onArchive', 'onUnarchive', 'onDelete']) {
      assert.match(call, new RegExp(`${prop}=`), `BoardConfigModal must receive ${prop}`);
    }
    assert.doesNotMatch(call, /canInvite=/);
  }
  // Archiving or deleting the project you are standing in has to leave it.
  assert.match(projectPage, /handleArchiveProject[\s\S]{0,240}router\.push\('\/clients'\)/);
  assert.match(projectPage, /handleDeleteProject[\s\S]{0,240}router\.push\('\/clients'\)/);
});

// A qTicket profile answers three questions and takes no actions at all. What
// used to stand here was a task manager's colleague page: calendar planning,
// an emergency call, a message, a seat to administer — and, last to go, a
// «Створити інцидент і призначити учасника» circle, which filed a request in a
// customer's name and put a colleague on it in one click. Only a client opens a
// request, so that circle was the rule's last exception on this screen.
test('a member profile offers qTicket actions only', async () => {
  const profile = await read('../src/components/profile/ProfileView.jsx');
  const myTasks = await read('../src/app/(app)/my/page.js');

  assert.doesNotMatch(profile, />\s*Написати\s*</);
  assert.doesNotMatch(profile, />\s*Виклик\s*</);
  // No action row at all: no circles, and nothing that opens a composer — a
  // staff member does not open a request, the client does.
  assert.doesNotMatch(profile, /<IconAction/);
  assert.doesNotMatch(profile, /Створити інцидент/);
  assert.doesNotMatch(profile, /new=1/);
  // Writing to a colleague is not there either: it opened a direct room in the
  // workspace messenger, and the product has one conversation — the request's.
  assert.doesNotMatch(profile, /Написати повідомлення/);
  assert.doesNotMatch(profile, /Написати повідомлення/);
  assert.doesNotMatch(profile, /Екстрений виклик|Створити подію|\/calendar\?new=1/);
  // Nothing here administers the seat: no menu, and no link into a settings
  // section that can only list who QuickTeam sent.
  assert.doesNotMatch(profile, /Керування доступом/);
  assert.doesNotMatch(profile, /section=team&user=/);
  assert.doesNotMatch(profile, /<ContextMenu/);

  // And nothing is left on the queue to receive such a request: the composer
  // there is gone, and with it the `assignee` the circle used to carry.
  assert.doesNotMatch(myTasks, /get\('assignee'\)/);
  assert.doesNotMatch(myTasks, /<CreateTaskModal/);
});

// The same count was drawn four different ways for the same question: a
// `Counter` in the board's collapsed and swimlane headers, a `Pill` with
// `opacity-60` in the header that actually ships, another `Pill` for swimlane
// totals, and an outline `Pill` in the team rail. Reaching for `Counter` in the
// rail matched two of the board's headers and not the one anybody sees.
test('one count chip answers "how many are in this list"', async () => {
  const board = await read('../src/components/workspace/AgileBoard.jsx');
  const rail = await read('../src/components/ui/Navigation/MemberRail.jsx');
  const globals = await read('../src/app/globals.css');

  assert.match(globals, /data-ui-pill-tone='count'\]/);
  assert.doesNotMatch(board, /<Counter/, 'the board no longer has a second kind of count');
  assert.doesNotMatch(board, /opacity-60/, 'the 60% white lives in the tone, not at the call site');
  assert.equal((board.match(/<Pill tone="count" size="md"/g) || []).length, 5);
  assert.match(rail, /<Pill tone="count" size="md">\{members\.length\}<\/Pill>/);
});

// The three feature glyphs were copied into two dozen files by hand, so
// "change the calendar icon" meant finding every import and hoping none had
// been missed — and some had.
test('the sidebar, the mobile bar, the palette and a profile show the same three icons', async () => {
  const icons = await read('../src/lib/design/icons.js');
  const sidebar = await read('../src/components/WorkspaceSidebar.jsx');
  const mobile = await read('../src/components/MobileNav.jsx');
  const palette = await read('../src/components/ui/Navigation/CommandPalette.jsx');
  const profile = await read('../src/components/profile/ProfileView.jsx');

  assert.match(icons, /export const TaskIcon = SquareCheckBig/);
  assert.match(icons, /export const CalendarIcon = Calendar\b/);
  assert.match(icons, /export const ChatIcon = MessageCircle/);

  for (const source of [sidebar, mobile, palette, profile]) {
    assert.match(source, /from '@\/lib\/design\/icons'/);
    // Nobody reaches past the names for the glyph they replaced.
    assert.doesNotMatch(source, /\bCalendarDays\b/);
    assert.doesNotMatch(source, /\bMessageSquare\b/);
  }
  assert.match(sidebar, /icon: TaskIcon/);
  assert.match(mobile, /icon: TaskIcon/);
  // A found task looks like every other task rather than a bullseye nobody
  // else uses.
  assert.match(palette, /issue: TaskIcon/);
});

// «Нічого не знайдено» while the request is still in flight is a wrong answer,
// not a slow one — and it was the answer for the whole debounce plus round trip.
test('the palette says it is searching rather than that it found nothing', async () => {
  const palette = await read('../src/components/ui/Navigation/CommandPalette.jsx');
  assert.match(palette, /searching \? 'Шукаємо…' : `Нічого не знайдено за «\$\{query\}»`/);
});

// The action circles counted down to zero. «Ще дії» went with the seat it
// administered, «Написати» with the second conversation, and the last one —
// «Створити інцидент» — with the rule that only a client opens a request. A row
// of one circle was already odd; a row of none is the honest answer, so the row
// itself is gone rather than standing empty.
//
// The 56px circle is still a declared kit size, waiting for the next screen
// that needs one; nothing in the product renders it today.
test('a member profile has no action circles left to size', async () => {
  const profile = await read('../src/components/profile/ProfileView.jsx');
  const button = await read('../src/components/ui/Button.jsx');
  const iconAction = await read('../src/components/ui/IconAction.jsx');
  const globals = await read('../src/app/globals.css');

  assert.equal((profile.match(/appearance="contrast"/g) || []).length, 0);
  assert.doesNotMatch(profile, /<IconAction|<Tooltip/);
  assert.match(button, /'icon-xl': 'w-\[56px\] p-0'/);
  assert.match(iconAction, /xl: 'icon-xl'/);
  assert.match(iconAction, /contrast: '!bg-selected !text-ink/);
  assert.match(globals, /data-ui-size='icon-56'\] \{[\s\S]{0,120}--ui-control-height: 56px;/);
});

// The board column and the task list section are two places that fold a group
// of tasks away. They are one control. The sprint accordion was the third and
// left with its screen.
test('every collapse control that folds a group of tasks is the same button', async () => {
  const [board, listView] = await Promise.all([
    readFile(new URL('../src/components/workspace/AgileBoard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ui/TaskManagement/TaskListView.jsx', import.meta.url), 'utf8'),
  ]);

  for (const [name, source] of [['board', board], ['list view', listView]]) {
    assert.match(
      source,
      /style="ghost"\s*\r?\n\s*size="icon-xs"/,
      `${name} must fold with the shared ghost icon-xs control`,
    );
    // A bigger box pushed longer status names onto a second row and broke the
    // rank of column headers. The controls stay miniature; what changed is the
    // kebab's glyph and its optical weight beside the plus.
    assert.doesNotMatch(source, /size="icon-sm"/, `${name} must keep the miniature control`);
  }
});

// The theme picker it used to guard is gone: QuickTeam owns the brand and
// re-sends it on the next provisioning sync, so «Організація і бренд» shows the
// name, the logo and the rail colour and offers nothing to change them with.
test('«Організація і бренд» reports the QuickTeam brand and never edits it', async () => {
  const settings = await read('../src/app/(app)/settings/page.js');
  const section = settings.slice(
    settings.indexOf("case 'workspace': {"),
    settings.indexOf("case 'billing': {"),
  );

  // One source of truth for what the tenant's brand is — the same pair the
  // client rail and the invitation landing page paint themselves from.
  assert.match(section, /resolveOrganizationPortalBrand\(org\)/);
  assert.match(section, /organizationPortalBackground\(brand\)/);
  assert.match(section, /Брендинг керується в QuickTeam/);
  // Named, shown, and said where it is changed.
  assert.match(section, /label="Назва організації"/);
  assert.match(section, /label="Логотип клієнтського порталу"/);
  assert.match(section, /label="Колір бічної панелі"/);

  // Nothing on this screen writes the brand, and nothing previews a change to
  // it — a colour wheel, an upload and a live preview all belonged to an editor
  // whose value the next sync overwrote.
  assert.doesNotMatch(settings, /persistBranding|saveOrgName/);
  assert.doesNotMatch(settings, /setSidebarPreview|clearSidebarPreview/);
  assert.doesNotMatch(settings, /@uiw\/react-color|<Colorful/);
  assert.doesNotMatch(settings, /setOrgCustomBranding|setSidebarColor|setSidebarTheme/);
  assert.doesNotMatch(section, /<ImageUpload|<ColorSwatch|<ToggleSwitch/);
});
