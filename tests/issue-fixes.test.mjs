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
  assert.match(issueDetail, /label: 'Переглянути профіль',\s*\n\s*icon: User,/);
  // «Написати в чат» went with the workspace messenger it opened: there is no
  // conversation with a colleague outside an incident to send anybody to.
  assert.doesNotMatch(issueDetail, /Написати в чат/);
  assert.doesNotMatch(popover, /animate-in|zoom-in|slide-in/);
  assert.doesNotMatch(mainSections, /border-t border-line/);
  assert.doesNotMatch(mainSections, /<FormGroup label="(?:Зв’язок|Завдання)"/);
  assert.match(mainSections, /ariaLabel="Тип зв’язку"/);
  assert.match(mainSections, /ariaLabel="Пов’язане звернення"/);
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

test('QUI-81 shows newly created board tasks first', async () => {
  const [createRoute, board] = await Promise.all([
    read('../src/app/api/issues/route.js'),
    read('../src/components/workspace/AgileBoard.jsx'),
  ]);

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
  const [select, project, my] = await Promise.all([
    read('../src/components/ui/Select.jsx'),
    read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx'),
    read('../src/app/(app)/my/page.js'),
  ]);

  for (const role of ['type', 'priority', 'date', 'member', 'project', 'sort']) {
    assert.match(select, new RegExp(`${role}:\\s*[A-Z]`));
  }
  assert.match(project, /filterRole="status"[\s\S]{0,120}value=\{scope\}/);
  assert.match(project, /filterRole="member"[\s\S]{0,120}value=\{assigneeFilter\}/);
  assert.match(project, /filterRole="priority"[\s\S]{0,120}value=\{priorityFilter\}/);
  assert.match(my, /filterRole="status"[\s\S]{0,100}value=\{filters\.status\}/);
  assert.match(my, /filterRole="member"[\s\S]{0,100}value=\{filters\.assigned\}/);
  assert.match(my, /filterRole="priority"[\s\S]{0,100}value=\{filters\.priority\}/);
  assert.match(my, /filterRole="date"[\s\S]{0,100}value=\{filters\.period\}/);
  assert.match(my, /filterRole="type"[\s\S]{0,100}value=\{filters\.type\}/);
});

test('QUI-79 reuses the chat attachment viewer on issue details', async () => {
  const source = await read('../src/components/workspace/IssueDetail.jsx');

  assert.match(source, /import AttachmentViewer from '@\/components\/ui\/AttachmentViewer'/);
  assert.match(source, /function MediaViewer[\s\S]{0,260}<AttachmentViewer/);
  assert.match(source, /previewUrl: getMatFileUrl\(mat\)/);
  assert.doesNotMatch(source, /bg-black\/85 backdrop-blur-sm/);
});

test('QUI-69 renders people as avatar plus name', async () => {
  const [select, kit] = await Promise.all([
    read('../src/components/ui/Select.jsx'),
    readKitShowcase(),
  ]);

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
      < projectPage.indexOf('{canOpenIncident && ('),
    'project settings must be immediately available before the composer',
  );
  assert.match(projectPage, /<BoardConfigModal[\s\S]{0,160}project=\{project\}[\s\S]{0,240}canManageTeam=\{can\(orgRole, 'manage:team'\)\}/);
  assert.match(settingsDialog, /size="sm"/);
  assert.doesNotMatch(settingsDialog, /presentation="dialog"/);
  assert.match(settingsDialog, /title: 'Приховати етапи звернень\?'/);
  assert.match(settingsDialog, /updateProjectSettings\(project\.id/);
  assert.match(settingsDialog, /<ProjectSettingsForm/);
  // QUI-98: settings and create render the same shared form, and archiving or
  // deleting the project is reachable from the settings dialog itself.
  assert.match(settingsDialog, /dangerZone=\{dangerZone\}/);
  assert.match(settingsDialog, /Небезпечна зона/);
  // Client invitation is not an inline project-setting field: that path used
  // the internal `member` role. It lives in the client's «Учасники» tab instead.
  assert.doesNotMatch(settingsDialog, /<InviteMemberDialog/);
  assert.doesNotMatch(settingsDialog, /inviteEmails=\{inviteEmails\}/);
  assert.match(settingsDialog, /\.\.\.clientMemberIds, \.\.\.teamMemberIds/);
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

// The crash behind «qTicket не завантажився», and the shape that caused it.
//
// `IssueDetail` derives `issue` from `issues.find(...)`, which finds nothing
// until the Firestore stream arrives — so on every page load, and on every
// refresh of a request's own URL, the component renders once with `issue`
// undefined. The `if (!issue)` guard cannot move up to meet that, because hooks
// run between the two points and React requires them unconditionally.
//
// So every read above the guard has to be optional, and one of them was not:
// `supportAssigneeOptions` did `(issue.assigneeIds || []).map(...)` two hundred
// lines early and threw `TypeError: can't access property "assigneeIds"`,
// which the error boundary caught and reported as «Дані не вдалося
// відрендерити» — a sentence about rendering for a request that had simply not
// arrived yet. Production console, 2026-09-01, named that property exactly.
test('IssueDetail tolerates a request that has not arrived yet', async () => {
  const source = await read('../src/components/workspace/IssueDetail.jsx');
  const lines = source.split('\n');
  const start = lines.findIndex(line => line.startsWith('  const issue = issues.find('));
  const guard = lines.findIndex(line => line.trim() === 'if (!issue) {');
  assert.ok(start > 0 && guard > start, 'the derivation and its guard both still exist');

  const unguarded = [];
  for (let index = start + 1; index < guard; index += 1) {
    const line = lines[index];
    // Comments are prose about the code, not the code.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (/(?<![\w?.])issue\.[a-zA-Z]/.test(line)) unguarded.push(`${index + 1}: ${line.trim()}`);
  }
  assert.deepEqual(
    unguarded,
    [],
    'every `issue.` above the guard must be `issue?.` — this region runs with no request:\n'
    + unguarded.join('\n'),
  );
});
