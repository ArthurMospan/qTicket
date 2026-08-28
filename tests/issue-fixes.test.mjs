import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readShowcase } from '../scripts/ui-kit-showcase.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

// The catalogue is a directory of story files; these assertions ask whether it
// shows something at all, not which file it lives in.
const readKitShowcase = () => readShowcase().everything;

test('QUI-77 keeps task detail additions compact and floating menus stationary', async () => {
  // `Dropdown` was checked here too; it was one of 31 kit components nothing
  // rendered and has been deleted. `ContextMenu` is what the product actually
  // opens, and it is covered by the floating-overlay tests.
  const [issueDetail, popover, select] = await Promise.all([
    read('../src/components/workspace/IssueDetail.jsx'),
    read('../src/components/ui/Navigation/Popover.jsx'),
    read('../src/components/ui/Select.jsx'),
  ]);
  // The task's sections: everything from the description down. The two wrapper
  // divs that used to be called «MAIN SECTIONS PANEL» are gone — the stack of
  // sections is `DetailLayout`'s children now, and the description is the first
  // of them.
  const mainSections = issueDetail.slice(issueDetail.indexOf('{/* DESCRIPTION */}'));
  assert.ok(mainSections.length > 0, 'the description opens the task sections');

  assert.match(issueDetail, /<Popover[\s\S]{0,180}align="start"[\s\S]{0,180}hideArrow/);
  // An external author has no profile and no chat, so their name still opens a
  // popover that explains that. The density is named, not a raw CSS length
  // written at the call site (see tests/kit-drift.test.mjs).
  assert.match(issueDetail, /padding="default"/);
  assert.match(issueDetail, /triggerClassName="inline-flex"/);
  // A member's name opens the product's own menu — the same panel the kebab
  // drops — instead of a hand-built popover body full of ghost buttons.
  assert.match(issueDetail, /<ContextMenu\s+align="start"/);
  assert.match(issueDetail, /label: 'Написати в чат',\s*\n\s*icon: MessageCircle,/);
  assert.doesNotMatch(issueDetail, /Написати в чат\s*\n\s*<\/Button>/);
  assert.doesNotMatch(popover, /animate-in|zoom-in|slide-in/);
  assert.doesNotMatch(mainSections, /border-t border-line/);
  assert.doesNotMatch(mainSections, /<FormGroup label="(?:Зв’язок|Завдання)"/);
  assert.match(mainSections, /ariaLabel="Тип зв’язку"/);
  assert.match(mainSections, /ariaLabel="Пов’язаний інцидент"/);
  assert.match(select, /aria-label=\{ariaLabel\}/);
  assert.match(
    mainSections,
    /\{showSubInput && \([\s\S]{0,180}<Surface preset="compact-bordered-card"/,
  );
  assert.match(mainSections, /onClick=\{handleAddSubtask\}/);
  assert.ok(
    mainSections.indexOf('aria-label="Додати мітку"') > mainSections.indexOf('{showLinkInput &&'),
    'the add actions must stay below the shared grey detail surface',
  );
});

test('QUI-76 uses the shared deterministic avatar in project activity', async () => {
  const source = await read('../src/app/(app)/page.js');

  // The synthesised actor is now conditional: with nothing recorded about who
  // acted there is no person to draw, so the avatar and the name line are both
  // omitted rather than rendered blank.
  assert.match(source, /actorUser:\s*actorUser\s*\|\|\s*\(actorName\s*\?\s*\{/);
  // Size is a scale token, not a literal: raw pixel sizes moved into
  // AVATAR_SIZES so the avatar scale has one place to change. The card carries
  // three rows now, so the face is the small one.
  assert.match(source, /<UserAvatar user=\{action\.actorUser\} size="xs" \/>/);
  assert.doesNotMatch(source, /action\.actor\.slice\(0,\s*2\)/);
});

test('QUI-75 exposes column visibility settings in both My Tasks views', async () => {
  const source = await read('../src/app/(app)/my/page.js');
  const settingsButton = source.match(
    /<Button[\s\S]{0,240}title="Налаштування видимості колонок"[\s\S]{0,40}\/>/,
  );

  assert.ok(settingsButton, 'the visibility settings action must always be rendered');
  assert.doesNotMatch(settingsButton[0], /viewMode === 'kanban'/);
  // The columns of this board are the shared status categories, so the setting
  // is over categories in both views and in the picker they share.
  assert.match(source, /<TaskListView[\s\S]{0,420}hiddenGroupIds=\{hiddenCategories\}/);
  assert.match(source, /<StatusVisibilityPicker[\s\S]{0,220}hiddenStatusIds=\{hiddenCategories\}/);
});

test('QUI-74 gives sprint backlog cards the canonical Kanban card width', async () => {
  const source = await read('../src/app/(app)/sprints/page.js');

  // The sprint rows keep the board's inset; a phone gets a tighter one, because
  // 16px of gutter on each side of a 390px screen is a sixth of the card.
  // «Без спринта» owns its own scroller now — it is the one list long enough to
  // need virtualizing — so the two insets are declared where each list is built
  // rather than chosen by a flag inside one shared renderer.
  assert.match(source, /const listClass = '[^']*px-\[8px\][^']*'/);
  assert.match(source, /className="flex min-h-\[60px\] flex-col px-2 pb-4 pt-1 sm:px-4"/);
  // 82vw was the board's *peek*: a column that shows a slice of the next one so
  // you know to swipe. Below lg the sprints page has no next column — «Без
  // спринта» is stacked under the sprints — so the peek was 18% of the screen
  // reserved for nothing. The column is full width there and fixed on desktop.
  assert.match(
    source,
    /w-full shrink-0 flex-col overflow-hidden lg:w-\[280px\]/,
  );
});

test('QUI-73 and QUI-81 show newly created sprint, backlog and board tasks first', async () => {
  const [source, createRoute, board] = await Promise.all([
    read('../src/app/(app)/sprints/page.js'),
    read('../src/app/api/issues/route.js'),
    read('../src/components/workspace/AgileBoard.jsx'),
  ]);

  assert.match(source, /useState\('order'\)/);
  assert.match(source, /\[sortDir,\s*setSortDir\]\s*=\s*useState\('asc'\)/);
  assert.match(source, /return sortDir === 'asc' \? res : -res/);
  assert.match(createRoute, /order:\s*-next/);
  // The board sorts by the shared comparator, not by a rule of its own. Its
  // own copy read a missing `order` as 0 while the move planner read it as
  // last, so the column the user saw and the column the planner numbered were
  // two different lists and a dropped card landed off by however many they
  // disagreed about.
  assert.match(board, /import \{ columnOf, compareIssues \} from '@\/lib\/utils\/optimistic\.mjs'/);
  assert.match(board, /compareIssueCards = compareIssues/);
  assert.match(board, /const columnCards = \(laneIssues, column\) =>[\s\S]{0,320}\.sort\(compareIssueCards\)/);
  assert.doesNotMatch(board, /\(a\.order \?\? 0\) - \(b\.order \?\? 0\)/);
});

test('QUI-80 gives every FilterBar selector a semantic icon role', async () => {
  const [select, project, my, sprints, analytics] = await Promise.all([
    read('../src/components/ui/Select.jsx'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/app/(app)/my/page.js'),
    read('../src/app/(app)/sprints/page.js'),
    read('../src/app/(app)/analytics/page.js'),
  ]);

  for (const role of ['type', 'priority', 'sprint', 'date', 'member', 'project', 'sort']) {
    assert.match(select, new RegExp(`${role}:\\s*[A-Z]`));
  }
  assert.match(project, /filterRole="sprint"[\s\S]{0,100}value=\{boardSprintFilter\}/);
  assert.match(project, /filterRole="priority"[\s\S]{0,100}value=\{boardPriorityFilter\}/);
  assert.match(my, /filterRole="status"[\s\S]{0,100}value=\{filters\.status\}/);
  assert.match(my, /filterRole="member"[\s\S]{0,100}value=\{filters\.assigned\}/);
  assert.match(my, /filterRole="priority"[\s\S]{0,100}value=\{filters\.priority\}/);
  assert.match(my, /filterRole="date"[\s\S]{0,100}value=\{filters\.period\}/);
  assert.doesNotMatch(my, /filterRole="sprint"/);
  assert.match(sprints, /filterRole="priority"[\s\S]{0,100}value=\{priorityFilter\}/);
  assert.match(analytics, /filterRole="type"[\s\S]{0,100}value=\{typeFilter\}/);
});

test('QUI-79 reuses the chat attachment viewer on issue details', async () => {
  const source = await read('../src/components/workspace/IssueDetail.jsx');

  assert.match(source, /import AttachmentViewer from '@\/components\/ui\/AttachmentViewer'/);
  assert.match(source, /function MediaViewer[\s\S]{0,260}<AttachmentViewer/);
  assert.match(source, /previewUrl: getMatFileUrl\(mat\)/);
  assert.doesNotMatch(source, /bg-black\/85 backdrop-blur-sm/);
});

test('QUI-78 uses compact billing rows, one selection control and a defined FormGroup', async () => {
  const [billing, sprints] = await Promise.all([
    read('../src/components/workspace/BillingTab.jsx'),
    read('../src/app/(app)/sprints/page.js'),
  ]);

  assert.match(billing, /data-ui-surface="billing-item"[\s\S]{0,100}data-ui-padding="compact-row"/);
  assert.match(billing, /composition="billing-selection"/);
  assert.doesNotMatch(billing, />Позиції:<\/span>/);
  assert.doesNotMatch(billing, /\(\{checkedCount\} обрано\)/);
  assert.match(billing, /filterRole="status"[\s\S]{0,100}value=\{filterStatus\}/);
  assert.match(billing, /statusLabel=\{statusLabelOf\(iss\.columnId \|\| iss\.status\)\}/);
  assert.match(sprints, /import \{[^}]*\bFormGroup\b[^}]*\} from '@\/components\/ui'/s);
});

test('QUI-72 never submits a completed or stale sprint from Create Task', async () => {
  const source = await read('../src/components/CreateTaskModal.jsx');

  assert.match(
    source,
    /\(sprints \|\| \[\]\)\.filter\(sprint => sprint\.status !== 'completed'\)/,
  );
  assert.match(
    source,
    /form\.sprintId && !availableSprints\.some\(sprint => sprint\.id === form\.sprintId\)/,
  );
  assert.match(source, /\.\.\.availableSprints\.map\(s => \(\{ value: s\.id, label: s\.name \}\)\)/);
  assert.doesNotMatch(source, /\.\.\.sprints\.map\(s => \(\{ value: s\.id, label: s\.name \}\)\)/);
});

test('QUI-71 uses shared date and time controls throughout the calendar event form', async () => {
  const [dialog, kit, timePicker, datePicker] = await Promise.all([
    read('../src/components/workspace/calendar/CalendarEventDialog.jsx'),
    readKitShowcase(),
    read('../src/components/ui/Forms/TimePicker.jsx'),
    read('../src/components/ui/Forms/DatePicker.jsx'),
  ]);

  assert.doesNotMatch(dialog, /<Input type="(?:date|time)"/);
  // A type with no duration of its own asks for one moment rather than a range,
  // so the start controls label themselves accordingly; the end pair only
  // renders for types that have an end.
  assert.match(dialog, /<DatePicker[\s\S]{0,220}aria-label=\{hasDuration \? 'Дата початку' : 'Дата'\}/);
  assert.match(dialog, /<DatePicker[\s\S]{0,220}aria-label="Дата завершення"/);
  assert.match(dialog, /<TimePicker[\s\S]{0,220}aria-label=\{hasDuration \? 'Час початку' : 'Час'\}/);
  assert.match(dialog, /<TimePicker[\s\S]{0,220}aria-label="Час завершення"/);
  assert.match(dialog, /value=\{form\.recurrenceUntil\}[\s\S]{0,120}minDate=\{form\.startDate\}/);
  assert.match(datePicker, /disabled=\{Boolean\(isBeforeMinimum\)\}/);
  assert.match(timePicker, /data-ui-size=\{size\}/);
  assert.match(kit, /title="Date & Time Pickers"[\s\S]{0,900}<TimePicker/);
});

test('QUI-70 shares calendar type icons between creation and filtering', async () => {
  const [page, dialog] = await Promise.all([
    read('../src/app/(app)/calendar/page.js'),
    read('../src/components/workspace/calendar/CalendarEventDialog.jsx'),
  ]);

  assert.match(page, /CALENDAR_EVENT_TYPE_OPTIONS/);
  assert.match(
    page,
    /\{ value: 'all', label: 'Усі типи', icon: CalendarIcon \}/,
  );
  assert.match(
    page,
    /Object\.entries\(TYPE_CONFIG\)\.map\(\(\[value, config\]\) => \(\{ value, label: config\.label, icon: config\.icon \}\)\)/,
  );
  // The options are now derived: the label comes from the shared type table and
  // only the icon and colours live in the dialog, so the filter and the picker
  // cannot drift apart.
  assert.match(dialog, /event: \{ color: '#8b5cf6', bg: '#f5f3ff', icon: CalendarIcon \}/);
  assert.match(
    dialog,
    /Object\.entries\(TYPE_PRESENTATION\)\.map\(\s*\(\[value, presentation\]\) => \(\{ value, label: calendarEventTypeLabel\(value\), \.\.\.presentation \}\)/s,
  );
});

test('QUI-69 lays out overlaps and renders people as avatar plus name', async () => {
  const [calendarPage, eventDialog, eventPage, select, kit] = await Promise.all([
    read('../src/app/(app)/calendar/page.js'),
    read('../src/components/workspace/calendar/CalendarEventDialog.jsx'),
    read('../src/components/workspace/calendar/CalendarEventPage.jsx'),
    read('../src/components/ui/Select.jsx'),
    readKitShowcase(),
  ]);

  assert.match(calendarPage, /const boxes = layoutDayEvents\(timedEvents, day\)/);
  assert.match(calendarPage, /width: `\$\{box\.widthPercent\}%`/);
  assert.match(calendarPage, /\{ value: 'all', label: 'Уся команда', icon: Users \}/);
  assert.match(calendarPage, /label: member\.name[\s\S]{0,100}user: member/);
  assert.match(eventDialog, /label: memberLabel\(member\),\s*user: member/);
  assert.match(eventPage, /label: memberLabel\(member\),\s*user: member/);
  assert.match(select, /function OptionIdentity\(\{ option, size = 14 \}\)/);
  assert.match(select, /<OptionIdentity option=\{selectedOption\} \/>/);
  // QUI-106: a MultiSelect of people still shows the person, and once more than
  // one is picked it shows the stack rather than a bare "Обрано (N)".
  assert.match(select, /<OptionIdentity option=\{showSelectedAvatars \? \(avatarOptions\[0\] \|\| singleSelectedOption\) : singleSelectedOption\} \/>/);
  assert.match(select, /avatarOptions\.slice\(0, 3\)\.map/);
  assert.match(kit, /label: 'Артур Моспан', user: \{ id: 'u1'/);
});

test('QUI-68 unifies project settings and safely moves hidden statuses to Backlog', async () => {
  const [
    workspace,
    projectPage,
    settingsDialog,
    settingsForm,
    picker,
    projectRoute,
    createProjectRoute,
    createIssueRoute,
    myTasks,
    kit,
  ] = await Promise.all([
    read('../src/app/(app)/page.js'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/components/workspace/BoardConfigModal.jsx'),
    read('../src/components/ui/TaskManagement/ProjectSettingsForm.jsx'),
    read('../src/components/ui/TaskManagement/StatusVisibilityPicker.jsx'),
    read('../src/app/api/projects/[projectId]/route.js'),
    read('../src/app/api/projects/route.js'),
    read('../src/app/api/issues/route.js'),
    read('../src/app/(app)/my/page.js'),
    readKitShowcase(),
  ]);

  assert.doesNotMatch(workspace, /function EditProjectModal/);
  // QUI-99: the project card offers one settings entry, not a settings/members
  // split, and it opens the very dialog the project page opens.
  assert.match(workspace, /label: 'Налаштування'/);
  assert.doesNotMatch(workspace, /function AddMemberModal/);
  assert.match(workspace, /hiddenColumns,\s*\n/);
  assert.match(workspace, /<BoardConfigModal[\s\S]{0,400}canManageTeam=\{can\(orgRole, 'manage:team'\)\}/);
  const sharedProjectFormCall = workspace.match(/<ProjectSettingsForm[\s\S]*?\/>/)?.[0] || '';
  assert.match(sharedProjectFormCall, /onHiddenStatusIdsChange=\{setHiddenColumns\}/);
  assert.match(projectPage, /title="Налаштування проєкту"/);
  assert.ok(
    projectPage.indexOf('title="Налаштування проєкту"')
      < projectPage.indexOf('title="Створити інцидент"'),
    'project settings must be immediately available before incident creation',
  );
  assert.match(projectPage, /<BoardConfigModal[\s\S]{0,160}project=\{project\}[\s\S]{0,160}issues=\{issues\}/);
  assert.match(settingsDialog, /size="sm"/);
  assert.doesNotMatch(settingsDialog, /presentation="dialog"/);
  assert.match(settingsDialog, /title: 'Приховати колонки проєкту\?'/);
  assert.match(settingsDialog, /updateProjectSettings\(project\.id/);
  assert.match(settingsDialog, /<ProjectSettingsForm/);
  // QUI-98: settings and create render the same shared form, and archiving or
  // deleting the project is reachable from the settings dialog itself.
  assert.match(settingsDialog, /dangerZone=\{dangerZone\}/);
  assert.match(settingsDialog, /Небезпечна зона/);
  // Inviting is the inline list the create dialog already used, not a second
  // dialog stacked on this one: the same form must not offer two different
  // affordances for the same act depending on who is hosting it.
  assert.doesNotMatch(settingsDialog, /<InviteMemberDialog/);
  assert.match(settingsDialog, /inviteEmails=\{inviteEmails\}/);
  assert.match(workspace, /<ProjectSettingsForm/);
  assert.match(settingsForm, /<StatusVisibilityPicker/);
  assert.match(settingsForm, /<MultiSelect/);
  assert.match(settingsForm, /Запросити/);
  assert.match(picker, /disabled=\{disabled \|\| isBacklog\}/);
  assert.match(projectRoute, /'update-settings'/);
  assert.match(projectRoute, /columnId: backlogStatusId,\s*status: backlogStatusId/);
  assert.match(projectRoute, /completedAt: FieldValue\.delete\(\)/);
  assert.match(createProjectRoute, /hiddenColumns: requestedHidden/);
  assert.match(createIssueRoute, /\(project\.hiddenColumns \|\| \[\]\)\.includes\(statusCandidate\)/);
  // The qTicket incident queue folds away a *category*, not a status name — see
  // tests/status-categories.test.mjs. The preference is also scoped to both the
  // signed-in account and organization, so neither can inherit another scope's
  // hidden board columns after a switch.
  assert.match(myTasks, /const hiddenCategoriesStorageKey = `qt:incident-queue:hidden-categories:\$\{uid \|\| 'anonymous'\}:\$\{activeOrgId \|\| 'none'\}`/);
  assert.match(myTasks, /localStorage\.setItem\(hiddenCategoriesStorageKey/);
  assert.match(kit, /title="Project Status Visibility"[\s\S]{0,500}<StatusVisibilityPicker/);
});

test('QUI-67 and QUI-87 keep the sprint task column responsive and fixed on desktop', async () => {
  const source = await read('../src/app/(app)/sprints/page.js');
  const backlogSurface = source.match(
    /<Surface[\s\S]{0,80}preset="panel"[\s\S]{0,80}padding="none"[\s\S]{0,80}className="([^"]+)"/,
  );

  assert.ok(backlogSurface, 'the sprint backlog surface must be present');
  // Responsive below the breakpoint where the two columns sit side by side,
  // fixed at 280px above it. That breakpoint is `lg`, which is where the layout
  // itself turns into a row — it used to be declared at `md`, a width at which
  // the column was still stacked and therefore still had the whole screen.
  assert.match(backlogSurface[1], /w-full/);
  assert.match(backlogSurface[1], /lg:w-\[280px\]/);
  assert.doesNotMatch(backlogSurface[1], /(?:lg|xl|2xl):w-\[[\d.]+%\]/);
  assert.match(source, /const listClass = '[^']*px-\[8px\][^']*'/);
});
