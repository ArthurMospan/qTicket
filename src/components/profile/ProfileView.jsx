import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';
import { Mail, Phone, Send, X } from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import { Button, Pill, Tabs, EmptyState } from '@/components/ui';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { useAppContext } from '@/lib/context/AppContext';
import { useAllMyTasks } from '@/lib/hooks/useAllMyTasks';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { isOnProjectTeam } from '@/lib/utils/projectAccess.mjs';
import { isActiveMember, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { isClientRole } from '@/lib/utils/can';

// A support profile answers three questions and no others: who this is, which
// clients they are on, and what they have open. The task manager this product
// was copied from also carried a mood bubble, a presence dot, an «Про себе»
// paragraph and a contact card with a Telegram handle, a phone number and a
// city — a colleague's social page, none of which helps anybody answer a
// ticket.
export default function ProfileView({ user, onClose }) {
  const router = useRouter();
  const openIssueQuickView = useWorkspaceStore(state => state.openIssueQuickView);
  const { currentUser, projects, orgRole } = useAppContext();
  const {
    tasks,
    allIssues,
  } = useAllMyTasks(user?.id || user?.uid);
  const { positions = [], closedStatusIds } = useWorkflowConfig();
  const { members: orgMembers } = useOrganization();
  const [activeTab, setActiveTab] = useState('profile');

  if (!user) return null;

  const uid = user.id || user.uid;
  const isMe = uid === (currentUser?.id || currentUser?.uid);
  const isAdminOrOwner = orgRole === 'admin' || orgRole === 'owner';
  // Live membership record from the role-filtered organization members API.
  const memberRecord = orgMembers.find(m => (m.id || m.uid) === uid);

  // Посада і роль — два різні факти, і рядок під іменем показував то один, то
  // другий. Ланцюжок закінчувався `organizationRoleLabel(...)`, тож у людини з
  // посадою роль зникала з екрана зовсім, а в людини без посади на її місці
  // стояла роль — і прочитати, що саме перед тобою, було ніяк. Посада тут
  // лишається посадою; роль стоїть поруч власною пігулкою.
  const positionName = positions.find(p => p.id === user.positionId)?.label
    || user.title
    || 'Без посади';

  // «Звернення» means a different set on each side of the desk, because being
  // «on» a request does. An agent is put on one — `assigneeIds` — and that is
  // what `useAllMyTasks` answers. A customer never is: `assigneeIds` is
  // support's routing and a client role is never written into it, so this tab
  // read zero on every customer's profile no matter how many requests they had
  // opened. Theirs is the set they are actually on: the requests they wrote,
  // plus the ones their own administrator made them answerable for
  // (`clientAssigneeIds`) — the same two facts `issueDisplayParticipants`
  // draws on their cards.
  const viewedRole = memberRecord?.role || user.role || null;
  const viewedIsClient = isClientRole(viewedRole);
  const ownedIssues = viewedIsClient
    ? allIssues.filter(issue => (
      (issue.reporterId || issue.createdBy) === uid
      || (Array.isArray(issue.clientAssigneeIds) && issue.clientAssigneeIds.includes(uid))
    ))
    : tasks;
  const allActiveTasks = ownedIssues.filter(task => {
    const project = projects.find(item => item.id === task.projectId);
    return project?.status !== 'archived' && !closedStatusIds.includes(task.columnId || task.status);
  });
  // Which projects name this person.
  //
  // The profile could answer what somebody is working on and never where they
  // are, so «в яких він проєктах» had no answer anywhere in the product — you
  // opened each project's «Команда» tab and looked. `project.team` is the
  // roster, the same list the project card draws its faces from, so a person
  // appears here exactly when they appear there.
  const memberProjects = projects
    .filter(project => project.status !== 'archived' && isOnProjectTeam(project, uid))
    .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'uk'));
  // Whose list this is depends on who is reading it: an owner or an admin holds
  // every project of the organization, so their copy is the whole answer, while
  // a member holds only the projects they are on — making the list they see the
  // intersection of the two, and «спільні» the only honest word for it.
  const projectListIsComplete = isAdminOrOwner || isMe;

  // A profile is a place you look somebody up from. Opening one of their tasks
  // used to close the profile and land you on a task page — two navigations to
  // answer «what is this one».
  const handleTaskClick = task => openIssueQuickView(task);

  // Leaving the profile for somewhere else is two navigations: the modal gives
  // its history entry back, and the router goes. Issued together they race, and
  // one of them is lost. `navigateAfterOverlayClose` orders them.
  const leaveFor = href => {
    if (onClose) onClose();
    navigateAfterOverlayClose(() => router.push(href));
  };

  const tabsConfig = [
    { id: 'profile', label: 'Профіль' },
    { id: 'tasks', label: `Звернення (${allActiveTasks.length})` },
  ];

  // The admin menu is gone with the thing it managed. Who holds a qTicket seat
  // is decided in QuickTeam and re-sent whole on the next provisioning sync, so
  // its one item led into a settings section that can only list who was sent —
  // an action that promised to change something and then showed a list.

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white relative">
      {onClose && (
        <div className="absolute top-4 right-4 z-10">
          <Button style="secondary" size="icon" icon={X} onClick={onClose} aria-label="Закрити" />
        </div>
      )}
      {/* HEADER SECTION */}
      <div className="shrink-0 pt-8 pb-4 flex flex-col items-center">
        <div className="flex flex-col items-center text-center px-8">
          <div className="relative mb-2">
            <UserAvatar user={user} size="hero" />
          </div>

          <div className="flex flex-col gap-1 text-center items-center">
            <h2 className="ui-type-profile-title text-ink">{user.name || user.email} {isMe && <span className="text-muted font-normal text-[18px]">(ти)</span>}</h2>
            <p className="text-[14px] text-muted font-medium">
              {positionName}
            </p>
            {viewedRole && (
              <Pill tone="ink-subtle" size="md">{organizationRoleLabel(viewedRole)}</Pill>
            )}
            {/* «Команда» lists people whose seat QuickTeam switched off, because
                their name is still on the work. The row that leads here says so
                and so does the profile it opens — a page that reads like every
                other one is a page that says this person can still be given a
                request. */}
            {memberRecord && !isActiveMember(memberRecord) && (
              <Pill tone="warning" size="md" shape="badge">Без доступу</Pill>
            )}
          </div>

          {/* The action row is gone with the last action in it. That circle
              opened a request in a customer's name and put a colleague on it in
              one click, which is the thing this product refuses outright: only
              a client opens a request, and an agent who can open one on
              somebody's behalf is how a support desk stops being able to say
              who asked for what.
              A profile is now exactly what it claims to be — who this is, which
              customers they are on, and what they have open. */}
        </div>

        {/* TABS */}
        <div className="mt-6 flex w-full justify-center overflow-x-auto px-4 sm:px-8">
          <Tabs variant="raised" tabs={tabsConfig} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>

      {/* BODY SECTION */}
      <div className="qt-nav-scroll flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 md:p-8 w-full max-w-[800px] mx-auto">

        {activeTab === 'profile' && (
          <div className="flex flex-col gap-8">
            {/* Контакти — секція, а не підпис під аватаркою.
                Пошта, телефон і Telegram стояли стовпчиком одразу під іменем,
                у самій шапці: особисті дані людини як перше, що падає в око,
                і шапка, висота якої залежить від того, скільки полів вона
                заповнила. У QuickTeam це окремий блок нижче, і тут тепер так
                само — та сама сітка з іконкою, підписом і значенням.

                Локації немає навмисно: qTicket не питає, у якому місті людина
                живе. Адреса — це те, як вона увійшла; решта два — те, чим
                можна дописати, коли лист не той формат для питання. */}
            <div className="flex flex-col gap-4">
              <h3 className="ui-type-column-title text-muted uppercase tracking-wider">Контакти</h3>
              <div className="grid grid-cols-1 gap-y-6 gap-x-8 sm:grid-cols-2">
                <div className="flex items-center gap-3">
                  <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-canvas">
                    <Mail size={14} className="text-ink" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="mb-1 text-[11px] font-bold leading-none text-muted">Пошта</span>
                    {user.email ? (
                      <a href={`mailto:${user.email}`} className="truncate text-[13px] font-medium leading-none text-ink hover:underline">
                        {user.email}
                      </a>
                    ) : (
                      <span className="text-[13px] leading-none text-faint">Не вказано</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-canvas">
                    <Phone size={14} className="text-ink" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="mb-1 text-[11px] font-bold leading-none text-muted">Телефон</span>
                    {user.phone ? (
                      <a href={`tel:${String(user.phone).replace(/[^\d+]/g, '')}`} className="truncate text-[13px] font-medium leading-none text-ink hover:underline">
                        {user.phone}
                      </a>
                    ) : (
                      <span className="text-[13px] leading-none text-faint">Не вказано</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full bg-canvas">
                    <Send size={14} className="text-ink" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <span className="mb-1 text-[11px] font-bold leading-none text-muted">Telegram</span>
                    {user.telegram ? (
                      <a
                        href={`https://t.me/${String(user.telegram).replace(/^@/, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-[13px] font-medium leading-none text-ink hover:underline"
                      >
                        @{String(user.telegram).replace(/^@/, '')}
                      </a>
                    ) : (
                      <span className="text-[13px] leading-none text-faint">Не вказано</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Client spaces */}
            <div className="flex flex-col gap-3">
              <h3 className="ui-type-column-title text-muted uppercase tracking-wider">
                {projectListIsComplete ? 'Проєкти' : 'Спільні проєкти'}
              </h3>
              {memberProjects.length === 0 ? (
                <p className="text-[14px] text-faint italic">
                  {projectListIsComplete
                    ? 'Не закріплений за жодним проєктом.'
                    : 'Спільних проєктів немає.'}
                </p>
              ) : (
                // A wrapped row of capsules, not a stack of full-width panels.
                // Each one was a bordered row carrying a glyph, the name and a
                // member count, so eight projects were eight boxes down a narrow
                // column and the only thing anybody reads on any of them — the
                // name — was the smallest part. The capsule is the kit's Pill,
                // so its geometry is written once; the button around it adds the
                // one thing a Pill has no business knowing, that this one opens
                // something.
                <div className="flex flex-wrap gap-2">
                  {memberProjects.map(project => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => leaveFor(`/${project.id}`)}
                      title={project.name}
                      className="ui-native-control"
                      data-ui-control="profile-project-chip"
                    >
                      <Pill appearance="outline" tone="surface-ink" size="lg" weight="medium">
                        {project.name}
                      </Pill>
                    </button>
                  ))}
                </div>
              )}
              {/* Two footnotes stood here and neither one was read. «Має
                  доступ до всіх клієнтів організації за роллю» and «Показані
                  лише клієнти, до яких маєте доступ ви» explained the scoping
                  of a list of chips to somebody who opened a profile to find
                  out who a colleague is. The scoping is still true; the
                  heading is what carries it — «Проєкти» for the whole answer,
                  «Спільні проєкти» for the intersection — and a heading that
                  names the list needs no paragraph under it saying the same
                  thing in more words. */}
            </div>

            {/* Rates section removed as user requested to only configure rates via settings positions */}
          </div>
        )}

        {activeTab === 'tasks' && (
          <div className="flex flex-col gap-2">
            {allActiveTasks.length === 0 ? (
              <EmptyState
                icon={TaskIcon}
                title="Немає активних звернень"
                description={viewedIsClient
                  ? 'Звернення, які ця людина відкриє, з’являться тут автоматично'
                  : 'Звернення, призначені на учасника, з’являться тут автоматично'}
              />
            ) : (
              <>
                {allActiveTasks.map(task => {
                  const projectName = projects.find(p => p.id === task.projectId)?.name || 'Проєкт';
                  return (
                    <TaskRow
                      key={task.id}
                      issue={task}
                      projectId={task.projectId}
                      projectName={projectName}
                      showProjectName
                      onClick={() => handleTaskClick(task)}
                    />
                  );
                })}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
