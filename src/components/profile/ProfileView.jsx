import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';
import { X } from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import { Button, Pill, Tabs, EmptyState } from '@/components/ui';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { useAppContext } from '@/lib/context/AppContext';
import { useAllMyTasks } from '@/lib/hooks/useAllMyTasks';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { isOnProjectTeam, isPrivilegedRole } from '@/lib/utils/projectAccess.mjs';
import { isActiveMember, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';

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

  const positionName = positions.find(p => p.id === user.positionId)?.label
    || user.title
    || organizationRoleLabel(memberRecord?.role || user.role);

  const allActiveTasks = tasks.filter(task => {
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
  // And an owner or an admin *being looked at* reaches every project without
  // being on it, so a short list under their name is not the whole story.
  const viewedReachesEveryProject = isPrivilegedRole(memberRecord?.role || user.role || null);

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
            {/* «Команда» lists people whose seat QuickTeam switched off, because
                their name is still on the work. The row that leads here says so
                and so does the profile it opens — a page that reads like every
                other one is a page that says this person can still be given a
                request. */}
            {memberRecord && !isActiveMember(memberRecord) && (
              <Pill tone="warning" size="md" shape="badge">Без доступу</Pill>
            )}
            {/* The one contact a support desk needs. The «Контакти» block that
                used to stand here — Telegram, phone, location — was a social
                card from the task manager and went with the rest of it; an
                address is not that. It is how a person signed in, how their
                invitation was matched, and the only way to reach a client
                outside their own portal. */}
            {user.email && (
              <a
                href={`mailto:${user.email}`}
                className="text-[13px] text-muted hover:text-ink transition-colors"
              >
                {user.email}
              </a>
            )}
            {/* And the two a customer may add to that address. This is not the
                контакт-картка that went out with the task manager: nobody's
                city, nobody's birthday, nobody's mood — a number and a handle,
                filled in by the person on the other side of a request so the
                desk can reach them when a thread is the wrong shape for the
                question. Drawn only where they exist, and they exist only where
                somebody typed them; the member directory never sends either
                field to a customer, so this line is the desk's alone. */}
            {(user.phone || user.telegram) && (
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-muted">
                {user.phone && (
                  <a href={`tel:${user.phone.replace(/[^\d+]/g, '')}`} className="hover:text-ink transition-colors">
                    {user.phone}
                  </a>
                )}
                {user.telegram && (
                  <a
                    href={`https://t.me/${String(user.telegram).replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-ink transition-colors"
                  >
                    @{String(user.telegram).replace(/^@/, '')}
                  </a>
                )}
              </div>
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
            {/* Client spaces */}
            <div className="flex flex-col gap-3">
              <h3 className="ui-type-column-title text-muted uppercase tracking-wider">
                {projectListIsComplete ? 'Проєкти' : 'Спільні клієнти'}
              </h3>
              {memberProjects.length === 0 ? (
                <p className="text-[14px] text-faint italic">
                  {projectListIsComplete
                    ? 'Не закріплений за жодним клієнтом.'
                    : 'Спільних клієнтів немає.'}
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
              {/* Said whether or not the list is empty: for an owner or an admin
                  «не входить до жодного проєкту» would otherwise read as «has no
                  access to anything», which is the opposite of the truth. */}
              {viewedReachesEveryProject && (
                <p className="text-[11px] leading-[1.4] text-muted">
                  Має доступ до всіх клієнтів організації за роллю — тут лише ті, за якими закріплений.
                </p>
              )}
              {!projectListIsComplete && (
                <p className="text-[11px] leading-[1.4] text-muted">
                  Показані лише клієнти, до яких маєте доступ ви.
                </p>
              )}
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
                description="Звернення, призначені на учасника, з’являться тут автоматично"
              />
            ) : (
              <>
                {allActiveTasks.map(task => {
                  const projectName = projects.find(p => p.id === task.projectId)?.name || 'Клієнт';
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
