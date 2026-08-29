import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';
import { CakeSlice, Mail, MapPin, Phone, Send, X } from 'lucide-react';
import { ChatIcon, TaskIcon } from '@/lib/design/icons';
import { Button, IconAction, Pill, PresenceDot, Tabs, EmptyState, Tooltip } from '@/components/ui';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import UserStatusDialog from '@/components/UserStatusDialog';
import { useAppContext } from '@/lib/context/AppContext';
import { useAllMyTasks } from '@/lib/hooks/useAllMyTasks';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { formatLastSeenUk, isPresenceOnline } from '@/lib/utils/presence.mjs';
import { isOnProjectTeam, isPrivilegedRole } from '@/lib/utils/projectAccess.mjs';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';

const getRealProfileDetails = (member) => {
  const skills = member.profile?.skills || member.skills;
  return {
    bio:      member.profile?.bio      || member.bio      || null,
    skills:   Array.isArray(skills) && skills.length ? skills : null,
    telegram: member.profile?.telegram || member.telegram || null,
    phone:    member.profile?.phone    || member.phone    || null,
    location: member.profile?.location || member.location || null,
    timezone: member.profile?.timezone || member.timezone || member.localization?.timezone || null,
    birthday: member.profile?.birthday || member.birthday || null,
  };
};

// A phone number and an address are things people copy, not things they read
// out. A click puts the value on the clipboard, and the underline on hover is
// the affordance the Telegram handle beside them already had — so the three
// contact values now behave alike, without any of them growing an icon.
function CopyableContact({ value, label }) {
  const copy = async () => {
    const toast = useWorkspaceStore.getState().showToast;
    try {
      await navigator.clipboard.writeText(value);
      toast(`${label} скопійовано`, 'success');
    } catch {
      toast('Не вдалося скопіювати', 'error');
    }
  };
  return (
    <button
      type="button"
      data-ui-control="profile-contact-value"
      onClick={copy}
      title={`Скопіювати: ${value}`}
      className="cursor-pointer truncate rounded-[4px] text-left text-[13px] font-medium leading-none text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ink"
    >
      {value}
    </button>
  );
}

// The line over the avatar. On your own profile it is a button and on anybody
// else's it is a bubble, which is the whole difference between the two — so
// they are one shape rather than two that drift.
function StatusBubble({ emoji, text, onClick }) {
  const Shell = onClick ? 'button' : 'div';
  return (
    <Shell
      {...(onClick ? { type: 'button', onClick, title: 'Змінити статус' } : {})}
      data-ui-surface="local"
      className={`absolute top-[-20px] left-[65%] z-20 flex min-w-[50px] max-w-[180px] items-center gap-[6px] rounded-[18px] border border-line bg-white px-[12px] py-[8px] shadow-lg ${
        onClick ? 'cursor-pointer transition-colors hover:border-line hover:bg-canvas' : ''
      }`}
    >
      <span className="shrink-0 text-[18px]">{emoji || '💭'}</span>
      {text ? (
        <span className="truncate text-[13px] font-normal tracking-tight text-ink">{text}</span>
      ) : onClick ? (
        <span className="truncate text-[13px] font-normal tracking-tight text-muted">Статус</span>
      ) : null}
    </Shell>
  );
}

export default function ProfileView({ user, onClose }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const router = useRouter();
  const openIssueQuickView = useWorkspaceStore(state => state.openIssueQuickView);
  const { currentUser, projects, orgRole } = useAppContext();
  const {
    tasks,
  } = useAllMyTasks(user?.id || user?.uid);
  const { positions = [], closedStatusIds } = useWorkflowConfig();
  const { members: orgMembers } = useOrganization();
  const [activeTab, setActiveTab] = useState('profile');
  const [statusOpen, setStatusOpen] = useState(false);

  if (!user) return null;

  const uid = user.id || user.uid;
  const isMe = uid === (currentUser?.id || currentUser?.uid);
  const isAdminOrOwner = orgRole === 'admin' || orgRole === 'owner';
  // Live membership record from the role-filtered organization members API.
  const memberRecord = orgMembers.find(m => (m.id || m.uid) === uid);

  const isOnline = user.online === true || isPresenceOnline(user.lastActive, now);
  const presenceLabel = user.presenceLabel || formatLastSeenUk(user.lastActive, { now, online: isOnline });
  const details = getRealProfileDetails(user);
  // The line the person wrote about themselves. `user.status` is the membership
  // record and says «active» about everybody.
  //
  // On your own profile it is read from the signed-in user rather than from the
  // member list: that one is a server route the page holds a copy of, so a
  // status you have just set here would not come back for as long as the copy
  // lasts, and the bubble you had just used would still show the old line.
  const statusText = (isMe ? currentUser?.status : user.statusText) || null;
  const statusEmoji = (isMe ? currentUser?.statusEmoji : user.statusEmoji) || null;

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
            {isOnline && <PresenceDot size="hero" collar="white" className="bottom-[6px] right-[6px]" />}
            {/* `statusText`, not `status`: the second one is the membership —
                `active` — and this bubble used to read it out as the line the
                person had written about themselves.

                On your own profile the bubble is the control that sets it. It
                was readable here and settable only from the pill in the chat
                header, which is a different screen — so the one place the
                status is actually looked at could not change it. Somebody
                else's bubble stays a bubble. */}
            {(statusText || statusEmoji || isMe) && (
              <StatusBubble
                emoji={statusEmoji}
                text={statusText}
                onClick={isMe ? () => setStatusOpen(true) : undefined}
              />
            )}
          </div>

          <div className="flex flex-col gap-1 text-center items-center">
            <h2 className="ui-type-profile-title text-ink">{user.name || user.email} {isMe && <span className="text-muted font-normal text-[18px]">(ти)</span>}</h2>
            <p className="text-[14px] text-muted font-medium">
              {positionName}
            </p>
            <p className={`text-[11px] font-medium ${isOnline ? 'text-success' : 'text-faint'}`}>
              {presenceLabel}
            </p>
          </div>

          {/* Actions — four 56px circles.
              Labels went first: four one-word buttons read as a sentence rather
              than a set of actions. Then the icons themselves, which were
              invented here — `CheckSquare` for a task, `CalendarPlus` for an
              event, `MessageCircle` for chat — while the sidebar, the mobile bar
              and the palette each showed something else for the same three
              things. They all read the same three names now.
              The emergency call moved into the menu: it is the one action here
              nobody performs by accident, and it was the loudest thing on a
              colleague's profile. */}
          {!isMe && (
            <div className="flex items-center gap-2 mt-4">
              {/* Each circle carries its name twice: as the accessible label a
                  screen reader reads, and as a tooltip for everyone else. An
                  icon on its own says nothing, and these four are the whole
                  action row — there is no text anywhere near them. */}
              <Tooltip content="Написати повідомлення">
                <IconAction
                  label="Написати повідомлення"
                  icon={ChatIcon}
                  size="xl"
                  appearance="contrast"
                  onClick={() => leaveFor(`/chat?dm=${encodeURIComponent(uid)}`)}
                />
              </Tooltip>
              <Tooltip content="Створити інцидент">
                <IconAction
                  label="Створити інцидент і призначити учасника"
                  icon={TaskIcon}
                  size="xl"
                  appearance="contrast"
                  onClick={() => leaveFor(`/my?new=1&assignee=${encodeURIComponent(uid)}`)}
                />
              </Tooltip>
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
            {/* Про себе */}
            {(details.bio || isMe) && (
              <div className="flex flex-col gap-3">
                <h3 className="ui-type-column-title text-muted uppercase tracking-wider">Про себе</h3>
                {details.bio ? (
                  <p className="text-[14px] text-ink leading-relaxed">
                    {details.bio}
                  </p>
                ) : (
                  <p className="text-[14px] text-faint italic">
                    Додайте опис у налаштуваннях профілю.
                  </p>
                )}
              </div>
            )}

            {/* Анкета */}
            <div className="flex flex-col gap-4">
              <h3 className="ui-type-column-title text-muted uppercase tracking-wider">Контакти</h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-8">
                {/* Telegram */}
                <div className="flex items-center gap-3">
                  <div className="w-[32px] h-[32px] rounded-full bg-canvas flex items-center justify-center shrink-0">
                    <Send size={14} className="text-ink" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-muted leading-none mb-1">Telegram</span>
                    {details.telegram ? (
                      <a href={`https://t.me/${details.telegram.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="text-[13px] text-ink hover:underline font-medium truncate leading-none">
                        {details.telegram}
                      </a>
                    ) : (
                      <span className="text-[13px] text-faint leading-none">Не вказано</span>
                    )}
                  </div>
                </div>

                {/* Phone */}
                <div className="flex items-center gap-3">
                  <div className="w-[32px] h-[32px] rounded-full bg-canvas flex items-center justify-center shrink-0">
                    <Phone size={14} className="text-ink" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-muted leading-none mb-1">Телефон</span>
                    {details.phone ? (
                      <CopyableContact value={details.phone} label="Телефон" />
                    ) : (
                      <span className="text-[13px] text-faint leading-none">Не вказано</span>
                    )}
                  </div>
                </div>

                {/* Location */}
                <div className="flex items-center gap-3">
                  <div className="w-[32px] h-[32px] rounded-full bg-canvas flex items-center justify-center shrink-0">
                    <MapPin size={14} className="text-ink" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-muted leading-none mb-1">Локація</span>
                    {details.location ? (
                      <span className="text-[13px] text-ink font-medium leading-none truncate">{details.location}</span>
                    ) : (
                      <span className="text-[13px] text-faint leading-none">Не вказано</span>
                    )}
                  </div>
                </div>

                {/* Email */}
                <div className="flex items-center gap-3">
                  <div className="w-[32px] h-[32px] rounded-full bg-canvas flex items-center justify-center shrink-0">
                    <Mail size={14} className="text-ink" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-muted leading-none mb-1">Email</span>
                    {user.email ? (
                      <CopyableContact value={user.email} label="Email" />
                    ) : (
                      <span className="text-[13px] text-faint leading-none">Не вказано</span>
                    )}
                  </div>
                </div>

                {/* Birthday */}
                <div className="flex items-center gap-3">
                  <div className="w-[32px] h-[32px] rounded-full bg-canvas flex items-center justify-center shrink-0">
                    <CakeSlice size={14} className="text-ink" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-muted leading-none mb-1">День народження</span>
                    <span className={`text-[13px] font-medium leading-none truncate ${details.birthday ? 'text-ink' : 'text-faint'}`}>
                      {details.birthday
                        ? new Date(`${details.birthday}T00:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })
                        : 'Не вказано'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

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

      {statusOpen && <UserStatusDialog onClose={() => setStatusOpen(false)} />}
    </div>
  );
}
