import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';
import { MoreVertical, Shield, X } from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import { Button, IconAction, Pill, Tabs, ContextMenu, EmptyState, Tooltip } from '@/components/ui';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { useAppContext } from '@/lib/context/AppContext';
import { useAllMyTasks } from '@/lib/hooks/useAllMyTasks';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { isOnProjectTeam, isPrivilegedRole } from '@/lib/utils/projectAccess.mjs';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';

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
    { id: 'tasks', label: `Інциденти (${allActiveTasks.length})` },
  ];

  const memberMenu = [
    ...(isAdminOrOwner ? [
      { label: 'Керування доступом', icon: Shield, onClick: () => leaveFor(`/settings?section=team&user=${uid}`) },
    ] : []),
  ];

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
          </div>

          {/* Actions — 56px circles.
              Labels went first: one-word buttons read as a sentence rather
              than a set of actions. Then the icons themselves, which were
              invented here — `CheckSquare` for a task, `CalendarPlus` for an
              event — while the sidebar, the mobile bar and the palette each
              showed something else for the same things. They all read the same
              names now. */}
          {!isMe && (
            <div className="flex items-center gap-2 mt-4">
              {/* Each circle carries its name twice: as the accessible label a
                  screen reader reads, and as a tooltip for everyone else. An
                  icon on its own says nothing, and these are the whole action
                  row — there is no text anywhere near them. */}
              <Tooltip content="Створити інцидент">
                <IconAction
                  label="Створити інцидент і призначити учасника"
                  icon={TaskIcon}
                  size="xl"
                  appearance="contrast"
                  onClick={() => leaveFor(`/my?new=1&assignee=${encodeURIComponent(uid)}`)}
                />
              </Tooltip>
              {/* The tooltip goes around the menu, not around its trigger:
                  ContextMenu clones the trigger to attach its own onClick, and
                  Tooltip does not forward props to what it wraps — so a Tooltip
                  as the trigger would swallow the click that opens the menu. */}
              {memberMenu.length > 0 && <Tooltip content="Ще дії">
                <ContextMenu
                  trigger={
                    <IconAction label="Інші дії з учасником" icon={MoreVertical} size="xl" appearance="contrast" />
                  }
                  items={memberMenu}
                />
              </Tooltip>}
            </div>
          )}
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
                {projectListIsComplete ? 'Клієнтські простори' : 'Спільні клієнти'}
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
                title="Немає активних інцидентів"
                description="Інциденти, призначені на учасника, з’являться тут автоматично"
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
