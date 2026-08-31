// A task's assignee has to be able to open the project the task is in.
//
// The workspace could produce the opposite, and did: «Команда» → учасник →
// «Створити завдання» opens the composer with that person already on it, the
// composer offered every project and the whole organization as assignees, and
// the create route only ever checked that an assignee was in the organization.
// The task then sat in their «Мої завдання» pointing at a project they cannot
// open, and the board silently dropped their face — a card resolves faces from
// the project's team, and `.filter(Boolean)` removed anyone who was not on it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  assigneesOffProjectTeam,
  assigneesOutsideProject,
  hasProjectAccess,
  hasRecordedTeam,
  isOnProjectTeam,
  isPrivilegedRole,
} from '../src/lib/utils/projectAccess.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('an assignee outside the project team is named, and a privileged one is not', () => {
  const project = { id: 'p1', team: ['owner-1', 'member-in'] };
  const roles = { 'owner-1': 'owner', 'member-in': 'member', 'member-out': 'member', 'admin-out': 'admin' };
  const roleOf = uid => roles[uid] || null;

  assert.deepEqual(assigneesOutsideProject(project, ['member-in'], roleOf), []);
  assert.deepEqual(assigneesOutsideProject(project, ['member-out'], roleOf), ['member-out']);
  // An admin reaches every project of the organization without being listed on
  // one, so assigning to them needs no grant at all.
  assert.deepEqual(assigneesOutsideProject(project, ['admin-out'], roleOf), []);
  assert.deepEqual(
    assigneesOutsideProject(project, ['member-in', 'member-out', 'member-out'], roleOf),
    ['member-out'],
  );
});

// The bug the roster/access split exists for, in one test: OneB → «Design» had
// an admin assigned to a task and no face for him on the project card. He was
// never missing access — he was never on the project, and the only check asked
// about access.
test('an admin assigned to a project is off its roster even though they reach it', () => {
  const project = { id: 'p1', team: ['owner-1', 'member-in'] };
  const roles = { 'owner-1': 'owner', 'member-in': 'member', 'member-out': 'member', 'admin-out': 'admin' };
  const roleOf = uid => roles[uid] || null;

  assert.equal(hasProjectAccess(project, 'admin', 'admin-out'), true);
  assert.equal(isOnProjectTeam(project, 'admin-out'), false);
  assert.equal(isOnProjectTeam(project, 'member-in'), true);

  // Access says nothing is wrong; the roster is what the card draws.
  assert.deepEqual(assigneesOutsideProject(project, ['admin-out'], roleOf), []);
  assert.deepEqual(assigneesOffProjectTeam(project, ['admin-out']), ['admin-out']);

  // Off-roster is a superset of locked-out, never the other way round.
  const ids = ['owner-1', 'member-in', 'member-out', 'admin-out'];
  const lockedOut = assigneesOutsideProject(project, ids, roleOf);
  const offRoster = assigneesOffProjectTeam(project, ids);
  assert.deepEqual(lockedOut, ['member-out']);
  assert.deepEqual(offRoster.sort(), ['admin-out', 'member-out']);
  assert.ok(lockedOut.every(uid => offRoster.includes(uid)));
});

test('a project whose team was never recorded is legacy data, not a closed door', () => {
  assert.equal(hasRecordedTeam({ id: 'p' }), false);
  assert.equal(hasRecordedTeam({ id: 'p', team: [] }), true);
  // Without this the rule would refuse every assignment on the oldest projects
  // in the workspace, which is not what "nobody is on this team" means there.
  assert.deepEqual(assigneesOutsideProject({ id: 'p' }, ['anyone'], () => 'member'), []);
  assert.deepEqual(assigneesOffProjectTeam({ id: 'p' }, ['anyone']), []);
  // An empty recorded team is a real answer and does close the door.
  assert.deepEqual(assigneesOutsideProject({ id: 'p', team: [] }, ['anyone'], () => 'member'), ['anyone']);
  assert.deepEqual(assigneesOffProjectTeam({ id: 'p', team: [] }, ['anyone']), ['anyone']);
  assert.equal(hasProjectAccess({ team: [] }, 'member', 'someone'), false);
  assert.equal(isPrivilegedRole('admin'), true);
  assert.equal(isPrivilegedRole('member'), false);
});

test('the create route never writes a project roster it was not asked to write', async () => {
  const route = await read('../src/app/api/issues/route.js');
  assert.match(route, /assigneesOutsideProject/);
  assert.match(route, /assigneesOffProjectTeam/);
  assert.match(route, /ASSIGNEE_OUTSIDE_PROJECT/);
  // The whole of the decision: a flag the caller sends, and nothing else.
  assert.match(route, /const addAssigneesToProjectTeam = data\.addAssigneesToProjectTeam === true;/);
  assert.match(route, /if \(addAssigneesToProjectTeam\) assigneesToAddToTeam = offRoster;/);
  // An assignment that would need a grant and did not ask for one is refused,
  // for a privileged actor too — that silent `arrayUnion` is the bug this is.
  assert.match(route, /lockedOut\.length && \(!isPrivileged \|\| !addAssigneesToProjectTeam\)/);
  assert.match(route, /addAssigneesToProjectTeam && !isPrivileged/);
  assert.match(route, /team: FieldValue\.arrayUnion\(\.\.\.assigneesToAddToTeam\)/);
  // And a roster change leaves a trace, because not knowing one had happened is
  // the other half of the report.
  assert.match(route, /action: 'project-team-granted'/);
});

test('bulk assignment refuses rather than granting, because a selection spans projects', async () => {
  const route = await read('../src/app/api/issues/bulk/route.js');
  assert.match(route, /assigneesOutsideProject\(freshProject, valueMemberships/);
  // One checkbox on a toolbar over a multi-project selection would read «додати
  // цю людину до кожного проєкту у виділенні». It names the project and stops.
  assert.match(route, /if \(outsideProject\.length\) \{/);
  assert.doesNotMatch(route, /projectTeamGrants/);
  assert.doesNotMatch(route, /transaction\.update\(projectRef/);
  assert.doesNotMatch(route, /team: FieldValue\.arrayUnion/);
  // Only the people the action is adding. Reading it off the patch would put
  // somebody who has since left the team back into it while removing them.
  assert.doesNotMatch(route, /assigneesOutsideProject\(freshProject, patch\.assigneeIds/);
});

test('the composer scopes assignees to the project selected inside it', async () => {
  const modal = await read('../src/components/CreateTaskModal.jsx');
  // Three of the four screens that open this dialog handed it the whole
  // organization, because they ask for a project inside the dialog and had none
  // to scope by. The dialog knows which project is selected.
  assert.match(modal, /const assignableMembers = useMemo/);
  assert.match(modal, /assignableMembers\.map\(m => \{/);
  assert.doesNotMatch(modal, /\{teamMembers\.map\(m => \{/);
  // Adding somebody to a project is asked for, not performed on the strength of
  // a 10px grey line saying it is about to happen.
  assert.match(modal, /assigneesJoiningProject/);
  assert.doesNotMatch(modal, /буде додано разом зі створенням завдання/);
  assert.match(modal, /const \[addToProjectTeam, setAddToProjectTeam\] = useState\(false\);/);
  // The consent the person reads is about the client they are filing under, not
  // about a «проєкт» — the collection keeps that name, the sentence does not.
  assert.match(modal, /Додати до команди підтримки клієнта/);
  assert.doesNotMatch(modal, /Додати до проєкту/);
  // Beside the project, not at the bottom of the form: the block used to sit
  // under the assignee chips, which is past the fold of a form somebody is
  // still filling in.
  const projectField = modal.indexOf('<FormGroup label="Проєкт" required');
  const consent = modal.indexOf('assigneesJoiningProject.length > 0 && (');
  const description = modal.indexOf('<MarkdownEditor');
  assert.ok(projectField > 0 && consent > projectField && consent < description,
    'блок згоди має стояти між селектором проєкту й описом');
  assert.match(modal, /addAssigneesToProjectTeam: addToProjectTeam && assigneesJoiningProject\.length > 0/);
  // Consent is about one project, so choosing another one asks again.
  assert.match(modal, /if \(key === 'projectId'\) setAddToProjectTeam\(false\);/);
  // A task whose assignee cannot open its project does not get created while
  // the box is unticked; a member — who may not grant anything — is not offered
  // the dead end at all.
  assert.match(modal, /assigneesLockedOut\.length > 0 && !addToProjectTeam/);
  assert.match(modal, /disabled=\{lockedOut && !mayGrantProjectAccess\}/);
});

// Saving project settings used to write the roster it read when the dialog
// opened. Anybody added to the project in between — by a task that had just
// granted them access, or by somebody else in another tab — was dropped by a
// save that had nothing to say about them.
test('saving project settings applies the change to the team, not the snapshot', async () => {
  const route = await read('../src/app/api/projects/[projectId]/route.js');
  assert.match(route, /const teamBaseline = Array\.isArray\(body\.teamBaseline\)/);
  assert.match(route, /const teamAdded = teamBaseline/);
  assert.match(route, /const teamRemoved = teamBaseline/);
  // Resolved inside the transaction, against the document as it is now.
  assert.match(route, /const freshTeam = Array\.isArray\(currentProject\.team\) \? currentProject\.team : \[\];/);
  assert.match(route, /\[\.\.\.new Set\(\[\.\.\.freshTeam, \.\.\.teamAdded\]\)\]\.filter\(userId => !teamRemoved\.includes\(userId\)\)/);
  assert.match(route, /team: resolvedTeam,/);
  // The response reports what was written, not what was asked for.
  assert.match(route, /team: settingsResult\.team,/);

  const modal = await read('../src/components/workspace/BoardConfigModal.jsx');
  assert.match(modal, /const \[teamBaseline\] = useState\(/);
  assert.match(modal, /team: \[\.\.\.new Set\(\[\.\.\.clientMemberIds, \.\.\.teamMemberIds\]\)\]/);
  assert.match(modal, /teamBaseline,/);
  assert.match(modal, /!isClientRole\(member\.role\)/);
});

// One composer is left in the product — the client's, in their own space —
// because only a client opens a request. The two staff copies that used to
// stand beside it went with the rule, so «every composer» is now one file.
test('every composer forwards the consent to the API, or the box does nothing', async () => {
  const source = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  assert.match(
    source,
    /addAssigneesToProjectTeam: formData\.addAssigneesToProjectTeam === true/,
    'the client composer drops the project-roster consent on the way to the API',
  );
  for (const path of ['../src/app/(app)/page.js', '../src/app/(app)/my/page.js']) {
    assert.doesNotMatch(
      await read(path),
      /<CreateTaskModal/,
      `${path} is a staff screen and must not open a composer`,
    );
  }
});

test('a customer incident row no longer loses the face of someone outside the project team', async () => {
  const workspace = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  // The picker is restricted to the project roster, but a card resolves the
  // face it already carries out of the organization list — so an assignment
  // keeps its face even after the person leaves this customer roster. The board
  // and the list are handed that list, not the roster.
  assert.match(workspace, /members=\{clientViewer \? clientMembers : members\}/);
  assert.match(workspace, /const supportAssigneeOptions = useMemo\(\(\) => supportMembers/);
  const detail = await read('../src/components/workspace/IssueDetail.jsx');
  assert.match(detail, /const assignableIds = new Set\(\[\.\.\.teamUids, \.\.\.\(issue\?\.assigneeIds \|\| \[\]\)\]\);/);
  // And the task itself says so for the tasks that already exist in this state
  // — including the one this whole change came from, where the assignee was an
  // admin and the old access check therefore said nothing at all.
  assert.match(detail, /assigneesOffProjectRoster\.length > 0 && \(/);
  assert.match(detail, /isOnProjectTeam\(project, member\.id \|\| member\.uid\)/);
  // One colour and one sentence, whatever the person's role. The branch that
  // said «доступ є за роллю, але на картці проєкту його не видно» explained our
  // data model to somebody who had asked to give a colleague a task.
  assert.match(detail, /Цього працівника немає в команді підтримки клієнта/);
  assert.doesNotMatch(detail, /доступ є за роллю/);
  assert.doesNotMatch(detail, /Виконавець не у складі проєкту/);
  // And the control on the coloured wash is ink, not the near-white secondary
  // fill, which stopped reading as a button at all on the four washes.
  assert.ok(detail.includes('style="primary"'), 'кнопка в алерті має бути чорнильною');
  // The explicit grant button reports both outcomes. Assignment itself never
  // mutates the client-support roster as a side effect.
  assert.doesNotMatch(detail, /catch \{ \/\* member assigner lacks team-write permission — non-fatal \*\/ \}/);
  assert.match(detail, /Додано до команди підтримки клієнта/);
  assert.match(detail, /Не вдалося додати до команди підтримки клієнта/);
  assert.doesNotMatch(detail, /team: arrayUnion\(\.\.\.missingFromTeam\)/);
});

// «В яких він проєктах» had no answer anywhere in the product: you opened each
// project's «Команда» tab and looked. The profile is where somebody is looked
// up, so it is where the answer belongs.
test('a profile says which projects name the person', async () => {
  const profile = await read('../src/components/profile/ProfileView.jsx');
  assert.match(profile, /isOnProjectTeam\(project, uid\)/);
  // A member holds only their own projects, so the list they see is the
  // intersection — and says so, rather than reading as the whole answer.
  assert.match(profile, /const projectListIsComplete = isAdminOrOwner \|\| isMe;/);
  assert.match(profile, /Спільні клієнти/);
  assert.match(profile, /Показані лише клієнти, до яких маєте доступ ви\./);
  // And an owner or an admin being looked at reaches every project without
  // being on it, so a short list under their name is not the whole story.
  assert.match(profile, /const viewedReachesEveryProject = isPrivilegedRole\(/);
});

// The other half of the same afternoon: a task screen with nowhere to type.
test('a role still loading is not read as a refusal', async () => {
  const { can, canWhileRoleLoads } = await import('../src/lib/utils/can.js');

  // What `can` says while the membership is in flight, and why a screen cannot
  // act on it: it is the same `false` as a real denial.
  assert.equal(can(null, 'create:comment'), false);
  assert.equal(can(null, 'create:project'), false);

  // Every role in the workspace may comment, so a missing role there can only
  // mean "not yet" — nobody who is in the organization at all is refused.
  assert.equal(canWhileRoleLoads(null, 'create:comment'), true);
  assert.equal(canWhileRoleLoads(null, 'edit:comment'), true);
  assert.equal(canWhileRoleLoads(null, 'edit:issue'), true);
  assert.equal(canWhileRoleLoads(null, 'delete:issue'), true);
  // A privileged action stays hidden until the role proves otherwise: showing
  // a control somebody is about to lose is the worse way to be wrong.
  assert.equal(canWhileRoleLoads(null, 'create:project'), false);
  assert.equal(canWhileRoleLoads(null, 'manage:finance'), false);
  // Once the role is known it answers exactly as `can` does.
  for (const role of ['owner', 'admin', 'member']) {
    for (const action of ['create:comment', 'create:project', 'manage:team', 'delete:issue']) {
      assert.equal(canWhileRoleLoads(role, action), can(role, action), `${role}/${action}`);
    }
  }
});

test('the comment composer is on the task screen before the membership arrives', async () => {
  const timeline = await read('../src/components/workspace/UnifiedTimeline.jsx');
  // It was gated on `can(orgRole, …)`, so the composer was simply not there
  // until the role landed — which looks exactly like a task you are not allowed
  // to write in, and there is no such task for anyone who can open it.
  assert.match(timeline, /const canWriteComments = canWhileRoleLoads\(orgRole, 'create:comment'\);/);
  assert.match(timeline, /const canEditOwnComment = canWhileRoleLoads\(orgRole, 'edit:comment'\);/);
  // Moderating somebody else's comment is owner/admin, so it keeps waiting.
  assert.match(timeline, /const canModerateComments = can\(orgRole, 'moderate:content'\);/);

  // QuickTeam-only screens keep the old member-level behaviour.
  {
    const path = '../src/app/(app)/my/page.js';
    const source = await read(path);
    assert.doesNotMatch(source, /can\(orgRole, '(?:edit|delete):issue'\)/, path);
  }

  // qTicket has external client roles, so mutation controls must wait for the
  // resolved role instead of flashing internal controls during membership load.
  const detail = await read('../src/components/workspace/IssueDetail.jsx');
  assert.match(detail, /isClientRole\(orgRole\)/);
  assert.match(detail, /can\(orgRole, 'edit:issue'\)/);

  // One screen, two readers: the client's copy of it has no hand on the work.
  // Dragging a card, selecting rows and picking an assignee are staff actions,
  // and the client's board is the same board in `readOnly`.
  const workspace = await read('../src/app/(app)/[projectId]/ProjectBoardClient.jsx');
  assert.match(workspace, /isClientRole\(orgRole\)/);
  assert.match(workspace, /readOnly=\{clientViewer\}/);
  assert.match(workspace, /onMoveIssue=\{clientViewer \? undefined : handleMoveIssue\}/);
  assert.match(workspace, /onBulkUpdate=\{clientViewer \? undefined : handleBulkUpdate\}/);
  assert.doesNotMatch(workspace, /updateIssue/);
});
