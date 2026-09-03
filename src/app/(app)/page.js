'use client';
import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { auth } from '@/lib/firebase';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { organizationLoadErrorKind } from '@/lib/utils/organizationLoadErrors.mjs';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { useProjectActivity } from '@/lib/hooks/useProjectActivity';
import {
  deliveredPercent,
  projectIssueCounts,
} from '@/lib/utils/projectIssueCounts.mjs';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, Archive, ArchiveRestore, Inbox, Plus, Folder, Clock, Users, TrendingUp, Target, ArrowRight, MoreVertical, Trash2, User, Settings2 } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import ActivityRow from '@/components/ui/DataDisplay/ActivityRow';
import { useOrganization } from '@/lib/hooks/useOrganization';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { can, isClientRole } from '@/lib/utils/can';
import { isExternalActorId } from '@/lib/utils/issueParticipants.mjs';
import { issueActivity } from '@/lib/utils/issueReadState.mjs';
import { issueActivityPhrase } from '@/lib/utils/issueActivityFeed.mjs';
import { relativeTimeLabel } from '@/lib/utils/relativeTime.mjs';
import BoardConfigModal from '@/components/workspace/BoardConfigModal';
import {
  EmptyState,
  IconAction,
  PageHeader,
  LoadingSpinner,
  ProjectSettingsForm,
  Pill,
  useConfirm,
} from '@/components/ui';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import TaskCounters from '@/components/ui/TaskManagement/TaskCounters';
import ContextMenu from '@/components/ui/ContextMenu';
import Alert from '@/components/ui/Feedback/Alert';
import Card from '@/components/ui/Layout/Card';
import { Select } from '@/components/ui/Select';
import FilterBar from '@/components/ui/FilterBar';
import Surface from '@/components/ui/Surface';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { archiveProject, deleteProject, restoreProject } from '@/lib/services/projects';


// ── Project Card ─────────────────────────────────────────────────────────────
const WorkspaceProjectCard = ({ project, archive, unarchive, members = [], allOrgMembers = [], isLarge = false, orgLoading, now }) => {
  const router = useRouter();
  const { currentUser, activeOrgId, orgRole } = useAppContext();
  const showToast = useWorkspaceStore(state => state.showToast);
  const confirmDialog = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showBoardConfig, setShowBoardConfig] = useState(false);
  const notifications = useWorkspaceStore(state => state.notifications);
  const isArchived = project.status === 'archived';
  const teamCount = Array.isArray(project.team) ? project.team.length : 0;

  // Preserve the familiar project-card identity: the people are the useful
  // context here, not an abstract visibility label. The featured card scales
  // the whole stack as one unit so placeholders never overpower real faces.
  const stackAvatar = isLarge ? 'md' : 'sm';
  const stackChip = isLarge ? 30 : 24;
  const stackOverlap = isLarge ? '-space-x-[10px]' : '-space-x-[8px]';

  // The one badge on a project card, and what it used to cost.
  //
  // It was fed by two live listeners *per card*: one over the entire message
  // history of `project_<id>` and one over its read cursor. That channel is
  // legacy — `isVisibleChatChannel` has excluded `project_*` rooms for a while
  // and nothing in the product writes to one any more — so opening the
  // dashboard read a dead conversation's whole history, once per project, to
  // draw a number that could only ever be zero.
  //
  // Being named is already in the workspace's notification stream, which is
  // subscribed once at the layout and shared by the sidebar's project dot. The
  // card reads the same stream: no listener, no document, and a number that is
  // about something that actually happens. Unread project chat is counted there
  // too, and the sidebar's dot is where it is said: one number on a card, and
  // it is the one addressed to you.
  const mentionCount = useMemo(() => notifications.filter(item => (
    !item.read
    && item.type === 'mentioned'
    && item.projectId === project.id
    && item.organizationId === activeOrgId
  )).length, [activeOrgId, notifications, project.id]);

  const handleCardClick = (e) => {
    if (e.target.closest('.no-nav')) return;
    router.push(`/${project.id}`);
  };

  // Built from what this role may actually do, not filtered afterwards — an
  // entry that would only ever be refused is never offered.
  const canEditProject = can(orgRole, 'edit:project_settings');
  const canDeleteProject = can(orgRole, 'delete:project');
  const projectMenuItems = [
    // One entry, one dialog — the same one the project page opens. Splitting
    // settings from members meant two different dialogs edited the same
    // project record.
    ...(canEditProject
      ? [{ icon: Settings2, label: 'Налаштування', onClick: () => setShowBoardConfig(true) }]
      : []),
    // Three entries do not need to be sorted into three groups: the rules used
    // to separate «Налаштування», «Архівувати» and «Видалити» drew more lines
    // than the menu had items.
    ...(canEditProject
      ? [
        !isArchived
          ? { icon: Archive, label: 'Архівувати проєкт', onClick: () => archive(project.id) }
          : { icon: ArchiveRestore, label: 'Розархівувати', onClick: () => unarchive(project.id), color: '#10b981' },
      ]
      : []),
    ...(canDeleteProject
      ? [
        {
          icon: Trash2,
          label: 'Видалити',
          isDanger: true,
          onClick: async () => {
            if (await confirmDialog({
              title: 'Видалити проєкт?',
              message: `Ви видаляєте «${project.name}». Цю дію неможливо скасувати.`,
              confirmText: 'Видалити',
              danger: true,
            })) {
              try {
                await deleteProject(project.id);
                showToast('Проєкт видалено');
              } catch (error) {
                showToast(userFacingErrorMessage(error, 'Не вдалося видалити проєкт'), 'error');
              }
            }
          },
        },
      ]
      : []),
  ];

  return (
    <>
      <div
        data-ui-surface="project-card"
        data-ui-density={isLarge ? 'large' : 'default'}
        onClick={handleCardClick}
        // The card holds its own menu button, so it cannot be a `<button>`
        // without nesting one. It takes the role, the tab stop and the two
        // activation keys instead.
        role="button"
        tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          handleCardClick(event);
        }}
        className={`ui-surface group relative flex flex-col justify-between cursor-pointer overflow-visible transition-all duration-300 ${menuOpen ? 'z-30' : 'hover:z-10'} ${
          isLarge
            ? 'md:col-span-2 md:row-span-2'
            : ''
        }`}
      >
        {/* Top row: the original project-team identity plus the kebab. */}
        <div className={`flex items-center justify-between ${menuOpen ? 'z-20' : 'z-10'}`}>
          <div className={`flex ${stackOverlap}`} aria-label={`Учасників проєкту: ${teamCount}`}>
            {teamCount === 0 && (
              <div title="До проєкту ще нікого не додано" data-ui-surface="local" style={{ width: stackChip, height: stackChip }} className="rounded-full bg-white flex items-center justify-center border-2 border-canvas">
                <Users size={isLarge ? 13 : 11} className="text-muted" />
              </div>
            )}
            {(project.team || []).slice(0, 4).map(uid => {
              const member = members.find(candidate => (candidate.id || candidate.uid) === uid);
              return member ? (
                // A face with no name under it is a riddle: the stack is the
                // only place the project's people appear, so hovering one says
                // who it is.
                <UserAvatar key={uid} user={member} size={stackAvatar} stacked tooltip />
              ) : (
                <div key={uid} title="Учасника не знайдено в організації" data-ui-surface="local" style={{ width: stackChip, height: stackChip }} className="rounded-full bg-white flex items-center justify-center border-2 border-canvas">
                  <User size={isLarge ? 13 : 11} className="text-muted" />
                </div>
              );
            })}
            {teamCount > 4 && (
              <Pill tone="neutral" preset="avatar-counter">+{teamCount - 4}</Pill>
            )}
          </div>

          {/* Kebab menu */}
          {/* No «Розархівувати» chip here: this list filters archived projects
              out before it renders a card (see filteredProjects below), so the
              chip could never appear on screen. The one the product actually
              shows lives in Settings → «Архів і видалене» and is already a kit
              Button. The menu item below is dead for the same reason; it costs
              one line and keeps the menu correct if the filter ever changes. */}
          {/* A member sees no kebab at all. Every entry in it is owner/admin
              work, and a menu that only ever answers "у вас немає прав" is
              worse than no menu: it advertises three things you cannot do on
              a project you are simply a participant of. */}
          {projectMenuItems.length > 0 && (
            <div className="relative no-nav flex items-center gap-[8px]">
              <ContextMenu
                onOpenChange={setMenuOpen}
                // QUI-105. 32px, not 28px. This is the only control on a project
                // card and it sits in a corner with nothing beside it to make a
                // small target forgivable — `sm` is the size for dense toolbars,
                // which this is the opposite of.
                trigger={
                  <IconAction label="Дії з проєктом" icon={MoreVertical} size="md" appearance="quiet" />
                }
                items={projectMenuItems}
              />
            </div>
          )}
        </div>

        {/* Title + description */}
        <div className="flex flex-col gap-[8px] z-10">
          <div className="flex flex-wrap items-center gap-[8px]">
            <h2
              data-ui-density={isLarge ? 'large' : 'default'}
              className="ui-type-project-card-title text-ink leading-tight transition-all duration-300"
            >
              {project.name}
            </h2>
            {/* «Вас тут згадали» — на кожній картці, а не лише на великій.
                Це єдиний факт на картці, адресований особисто читачеві, і саме
                його раніше було видно тільки на одній картці з чотирьох: стрічка
                дій живе лише на великій, а лічильник згадок стояв усередині неї
                й ішов на дно разом із нею. Число вже пораховано з того самого
                потоку сповіщень, що його тримає layout, тож на маленькій картці
                воно не коштує жодного читання.

                Праворуч від назви, а не в кутку: назва — це те, за чим шукають
                клієнта у сітці, і мітка, адресована тобі, має стояти там, де
                погляд уже зупинився. */}
            {mentionCount > 0 && !isLarge && (
              <TaskCounters mentions={mentionCount} size="sm" />
            )}
          </div>
          {project.description && (
            <p className={`text-muted font-medium leading-[1.5] line-clamp-2 ${
              isLarge ? 'text-[14px] max-w-[560px]' : 'text-[13px]'
            }`}>
              {project.description}
            </p>
          )}
        </div>

        {/* Real-time stats and Dynamic content */}
        <ProjectStatsSection
          isLarge={isLarge}
          members={members}
          project={project}
          now={now}
          currentUser={currentUser}
          orgLoading={orgLoading}
          mentionCount={mentionCount}
        />
      </div>

      {/* Modals */}
      {showBoardConfig && (
        <BoardConfigModal
          project={project}
          organizationMembers={allOrgMembers}
          canManageTeam={can(orgRole, 'manage:team')}
          onArchive={archive}
          onUnarchive={unarchive}
          onDelete={deleteProject}
          onClose={() => setShowBoardConfig(false)}
        />
      )}
    </>
  );
};

// Helper Component for Real-time project statistics and details
//
// What the activity record says happened is `issueActivityPhrase`, and it lives
// beside the feed on «Огляд» rather than here. This file used to hold its own
// pair of tables — one with a person in front of the verb, one without — for
// the same events in slightly different words, so a comment was «написав у
// чаті звернення» on a card and «відповів у зверненні» in the feed above it.
// Two vocabularies for one event is how a product starts describing itself two
// ways depending on which screen you are standing on; and the copy here was the
// one that fell behind, because every bulk action and every archive/cancel
// verb had to be remembered in two places.

// How many recent actions the featured card carries.
//
// One was a caption: it said the project was alive without saying what anybody
// had been doing in it. Three is a shape — the same person three times reads
// differently from three people once — and it is what the card has room for
// without becoming a feed. The small cards carry none: at that size an activity
// line is a truncated sentence nobody finishes reading, and the project is one
// click away.
const RECENT_ACTIONS = 3;

/**
 * The last few things that happened in a project, on the featured card only.
 *
 * The three documents behind these three lines are read by this component, from
 * this project, in this order — not filtered out of every task in the
 * workspace. A small card asks for none: `useProjectActivity` reads nothing at
 * a count of zero, which is why the hook can be called unconditionally the way
 * a hook must be.
 *
 * @param {boolean} props.isLarge Whether this is the 2×2 card. A small one draws nothing at all.
 */
function ProjectStatsSection({ isLarge, members, project, now, currentUser, orgLoading, mentionCount = 0 }) {
  const issues = useProjectActivity(
    project?.organizationId,
    project?.id,
    isLarge ? RECENT_ACTIONS : 0,
  );
  // Who *acted*, which is only ever what the activity record says. This used to
  // fall through to `reporterId` and then `reporterName`, so a task with no
  // recorded activity was attributed to whoever originally filed it. Where that
  // reporter is an external person with no account at all, the card announced
  // that they had «оновив завдання» — an action by someone who does not exist,
  // on a task nobody had touched.
  //
  // The reporter is not the actor. With no actor recorded there is nothing
  // truthful to say about who did it, so the line says what happened without
  // naming anyone.
  const describeAction = useCallback((issue, activity) => {
    const actorId = issue.lastActivityActorId || issue.updatedBy || '';
    const isExternalActor = isExternalActorId(actorId);
    let actorUser = null;
    if (actorId && !isExternalActor) {
      actorUser = members.find(m => (m.id || m.uid) === actorId) || null;
      if (!actorUser && (actorId === currentUser?.id || actorId === currentUser?.uid)) actorUser = currentUser;
    }

    // A member list still loading is not a member who cannot be found.
    if (actorId && !actorUser && !isExternalActor && orgLoading) return null;

    let actorName = '';
    let actorAvatar = null;
    if (actorUser) {
      actorName = actorUser.name || actorUser.displayName || actorUser.email?.split('@')[0] || '';
      actorAvatar = actorUser.avatar || actorUser.photoURL || actorUser.photoUrl || null;
    } else if (actorId && issue.lastActivityActorName) {
      // Recorded by whoever performed the action, so it names the person who
      // did it even if they have since left the organization.
      actorName = issue.lastActivityActorName;
      actorAvatar = issue.lastActivityActorAvatar || null;
    }

    return {
      issueKey: issue.issueKey || 'Звернення',
      title: issue.title,
      actor: actorName,
      actorUser: actorUser || (actorName ? { id: actorId || undefined, name: actorName, avatar: actorAvatar } : null),
      // Every type that was not a comment used to read «оновив завдання», so a
      // task that had just been created announced itself as updated.
      action: issueActivityPhrase(activity.type, actorName ? 'actor' : 'event'),
      time: activity.at,
      projectId: issue.projectId,
      id: issue.id,
    };
  }, [currentUser, members, orgLoading]);

  const recentActions = useMemo(() => {
    if (!isLarge) return [];
    // Only what the activity record says, never `updatedAt` — see
    // `issueActivity`. A card whose position was renumbered because somebody
    // dropped another card into its column had its document written and
    // nothing else, and it used to take this whole line with it.
    //
    // The order and the limit are the query's now, so this no longer sorts;
    // what it still does is drop a document the query could not have known was
    // unusable — a task whose activity stamp is there but empty.
    return issues
      .map(issue => ({ issue, activity: issueActivity(issue) }))
      .filter(entry => entry.activity.millis > 0)
      .map(entry => describeAction(entry.issue, entry.activity))
      .filter(Boolean);
  }, [describeAction, isLarge, issues]);

  // The small cards carry nothing here at all. Everything that used to sit on
  // one — a row of counts, then a status band — was a number in a place too
  // small to say what it was a number of, on the screen you go through rather
  // than the one you read. A project's own board answers all of it in a click.
  if (!isLarge) return null;
  // Порожня стрічка дій ховала й лічильник згадок разом із собою: обидва стояли
  // за одним `return null`, хоча це два різні факти. Проєкт, у якому ще нічого
  // не відбувалося, але тебе вже покликали, мовчав про це.
  if (recentActions.length === 0 && mentionCount === 0) return null;

  return (
    <div className="z-10 mt-auto flex w-full flex-col gap-[6px]">
      {mentionCount > 0 && (
        // Being named is the one fact on this card addressed to you, so it sits
        // above the activity rather than inside it: those are things other
        // people did, this is a thing you have to do something about.
        <TaskCounters mentions={mentionCount} className="self-end" />
      )}
      {/* The whole row is the link, not the task title inside it. Only the
          title used to be clickable and nothing said so, so the block behaved
          like a caption you could accidentally hit.

          The shape this card invented is the kit's `ActivityRow` now, and
          «Огляд» draws the same one: one event, one row, one product. It was
          the other way round for a while — this card had the compact grey row
          and «Огляд» had a bordered white tile of its own, which is two lists
          of the same sentences looking like two applications. */}
      {recentActions.map(action => (
        <ActivityRow
          key={action.id}
          href={issuePath(action)}
          onClick={(e) => e.stopPropagation()}
          className="no-nav"
          actor={action.actorUser}
          actorName={action.actor}
          text={action.action}
          issueKey={action.issueKey}
          title={action.title}
          time={relativeTimeLabel(action.time, { now })}
        />
      ))}
    </div>
  );
}

// ── New Internal Project Modal ───────────────────────────────────────────────
function NewProjectModal({ onClose, orgId, members = [], statuses = [] }) {
  const router = useRouter();
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [team,        setTeam]        = useState([]);
  const [hiddenColumns, setHiddenColumns] = useState([]);
  const [nameError, setNameError] = useState('');

  const [error, setError] = useState(null);
  const handleCreate = async () => {
    // A disabled primary button gave no reason why, so the form now says what
    // is missing and marks the field instead of silently refusing the click.
    if (!name.trim()) {
      setNameError('Вкажіть назву проєкту');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        organizationId: orgId,
        team,
        hiddenColumns,
      };

      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Сесія завершилась. Увійдіть знову.');

      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setError({ message: result.error || 'Не вдалося створити проєкт' });
        setSaving(false);
        return;
      }

      onClose();
    } catch (err) {
      console.error('[NewProject]', err);
      setError({ message: err.message });
    }
    setSaving(false);
  };

  return (
    <Dialog isOpen={true} onClose={onClose} title="Новий проєкт" size="sm" footer={
      <>
        <Button onClick={onClose} style="secondary" size="md" dismiss>Скасувати</Button>
        <Button onClick={handleCreate} disabled={saving} loading={saving} style="primary" size="md">Створити проєкт</Button>
      </>
    }>
      <div className="flex flex-col gap-[16px]">
          {error && (
            <Alert variant="error" title={error.message} />
          )}
          {/* Same shared form the settings dialog renders — the two used to be
              hand-written separately and drifted apart field by field. */}
          <ProjectSettingsForm
            name={name}
            onNameChange={value => {
              setName(value);
              if (nameError) setNameError('');
            }}
            nameError={nameError}
            description={description}
            onDescriptionChange={setDescription}
            statuses={statuses}
            hiddenStatusIds={hiddenColumns}
            onHiddenStatusIdsChange={setHiddenColumns}
            backlogStatusId={statuses.some(status => status.id === 'backlog') ? 'backlog' : statuses[0]?.id}
            teamMembers={members}
            teamMemberIds={team}
            onTeamMemberIdsChange={setTeam}
            teamPlaceholder="Оберіть працівників підтримки"
            teamHint="Після створення відкрийте проєкт → «Учасники», щоб окремо запросити адміністратора клієнта."
          />
      </div>
    </Dialog>
  );
}

export default function WorkspacePage({ clientsRoute = false } = {}) {
  const { projects, projectsLoading, projectsError, activeOrgId, orgRole } = useAppContext();
  const showToast = useWorkspaceStore(s => s.showToast);
  const { members, loading: orgLoading } = useOrganization();
  const { statuses } = useWorkflowConfig();
  const isMobile = useIsMobile() === true;
  const searchParams = useSearchParams();
  const router       = useRouter();
  const [showNewProject, setShowNewProject] = useState(false);
  const clientViewer = isClientRole(orgRole);
  // «The one, if there is one». `find` — the first — was the whole of this, and
  // a customer may hold more than one project since 2026-09-01: `?new=1` would
  // then have opened the composer in whichever project happened to sort first,
  // and filed somebody's request against the wrong customer space. With several
  // the hop stops at «Огляд», where the reader picks.
  const clientProjects = useMemo(
    () => (projects || []).filter(project => project.status !== 'archived'),
    [projects],
  );
  const clientProject = clientProjects.length === 1 ? clientProjects[0] : null;
  // Real-time issues state

  // Filter states
  const searchQuery = useWorkspaceStore(s => s.workspaceSearch);
  const [selectedMember, setSelectedMember] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [sortOption, setSortOption] = useState('updated');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // `?new=1` is the second door into the composer and it has to be the same
  // door as the button. It was not: «Новий проєкт» asks `create:project`, which
  // a member does not hold, while the query opened the dialog for anybody who
  // arrived with it — and the empty state on the overview offered exactly that
  // address to every internal role. A member got a form the server was always
  // going to refuse. The address is still consumed either way, so a refused
  // `?new=1` cannot sit in the URL waiting for the next reload.
  useEffect(() => {
    if (!clientsRoute || !orgRole || searchParams?.get('new') !== '1') return;
    if (can(orgRole, 'create:project')) queueMicrotask(() => setShowNewProject(true));
    router.replace('/clients', { scroll: false });
  }, [clientsRoute, orgRole, searchParams, router]);

  // The old QuickTeam fork used the project grid as its front door. qTicket's
  // internal front door is the support overview; keep the inherited grid at a
  // named /clients destination so bookmarks to / remain safe while the product
  // gains a real information architecture.
  useEffect(() => {
    if (clientsRoute || !orgRole || clientViewer) return;
    router.replace(searchParams?.get('new') === '1' ? '/clients?new=1' : '/overview');
  }, [clientViewer, clientsRoute, orgRole, router, searchParams]);

  // `/` is not a screen for anybody — it is a door, and both roles now walk
  // through it to the same address. There used to be a second, bespoke screen
  // behind this branch: its own list, its own board, its own words for the same
  // records. The client opens the shared `[projectId]` route support opens, and
  // the role decides what is inside it rather than which one is rendered.
  //
  // `/overview` is the same story one level up: it was support's screen and a
  // client was bounced off it, so the product's front screen was something only
  // half its users had. It knows who is looking now, so a client lands there
  // too — the counters they are entitled to, and the button to open a request.
  //
  // The query string travels, and it decides the destination: `?new=1` from
  // Ctrl+K opens the composer, which lives in the space, so that one hop goes
  // straight to the space and the overview is skipped. Sending it to the
  // overview would have opened a screen with no composer on it and dropped the
  // request the reader had already asked for.
  useEffect(() => {
    if (!clientViewer || clientsRoute || !clientProjects.length) return;
    const wantsComposer = searchParams?.get('new') === '1';
    router.replace(wantsComposer && clientProject ? `/${clientProject.id}?new=1` : '/overview');
  }, [clientProject, clientProjects.length, clientViewer, clientsRoute, router, searchParams]);

  // This screen no longer reads tasks at all.
  //
  // It used to subscribe to every task of every project the account can open —
  // the widest read in the product, on the screen a sign-in lands on and the
  // one people come back to between every other screen — and it did that for
  // three things: a progress percentage used only to sort the list, three
  // activity lines on the featured card, and a count in one confirmation
  // sentence. Seven hundred documents for a sort, a caption and a number.
  //
  // All three now ask for what they actually need. The percentage comes off the
  // project document (`projectIssueCounts`, kept by the routes that write the
  // tasks); the three lines are a query with `limit(3)` in
  // `ProjectStatsSection`; the count is `count()` inside the dialog that shows
  // it. See docs/ARCHITECTURE.md → «Вартість читання».
  //
  // Nothing here is a filter over a task set any more, so there is no task set,
  // and `useOrganizationIssues` is not started by this screen. A board or
  // «Звернення» still opens it — those screens draw the records — but the front
  // door does not.

  // The percentage the sort options order by. Read, not computed: a project
  // whose counters no full recount has established yet returns `null` and sorts
  // as zero rather than as a number nobody stood behind.
  const progressByProject = useMemo(() => {
    const pct = {};
    for (const project of projects || []) {
      const counts = projectIssueCounts(project);
      if (counts) pct[project.id] = deliveredPercent(counts);
    }
    return pct;
  }, [projects]);

  // Filter & sort visible projects
  const filteredProjects = useMemo(() => {
    let list = (projects || []).filter(p => p.status !== 'archived');

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p => p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q));
    }

    // Member filter
    if (selectedMember !== 'all') {
      list = list.filter(p => Array.isArray(p.team) && p.team.includes(selectedMember));
    }

    // Date Filter (Created range)
    if (dateFilter !== 'all') {
      const limit = dateFilter === '7days' ? 7 * 86400000 : 30 * 86400000;
      list = list.filter(p => {
        const time = p.createdAt?.toMillis?.() || p.createdAt?.seconds * 1000 || (p.createdAt instanceof Date ? p.createdAt.getTime() : 0);
        return (now - time) <= limit;
      });
    }

    // Sorting
    return [...list].sort((a, b) => {
      if (sortOption === 'name') {
        return (a.name || '').localeCompare(b.name || '');
      }
      if (sortOption === 'progress-desc') {
        return (progressByProject[b.id] || 0) - (progressByProject[a.id] || 0);
      }
      if (sortOption === 'progress-asc') {
        return (progressByProject[a.id] || 0) - (progressByProject[b.id] || 0);
      }
      // Default: 'updated' (most recently updated/created)
      const aTime = a.updatedAt?.toMillis?.() || a.updatedAt?.seconds * 1000 || (a.updatedAt instanceof Date ? a.updatedAt.getTime() : 0);
      const bTime = b.updatedAt?.toMillis?.() || b.updatedAt?.seconds * 1000 || (b.updatedAt instanceof Date ? b.updatedAt.getTime() : 0);
      return bTime - aTime;
    });
  }, [projects, searchQuery, selectedMember, dateFilter, sortOption, progressByProject, now]);
  usePublishLocalSearchResults(searchQuery, filteredProjects.length);

  const archive = async (id) => {
    try {
      await archiveProject(id);
      showToast('Проєкт архівовано', 'success', {
        duration: 5000,
        action: {
          label: 'Скасувати',
          onClick: () => unarchive(id)
        }
      });
    } catch (err) {
      showToast(userFacingErrorMessage(err, 'Не вдалося архівувати проєкт'), 'error');
      return false;
    }
    return true;
  };

  const unarchive = async (id) => {
    try {
      await restoreProject(id);
      showToast('Проєкт повернуто з архіву');
    } catch (err) {
      showToast(userFacingErrorMessage(err, 'Не вдалося повернути проєкт з архіву'), 'error');
      return false;
    }
    return true;
  };

  const stats = useMemo(() => {
    const active = (projects || []).filter(p => p.status !== 'archived');
    return { total: active.length };
  }, [projects]);

  const supportMembers = useMemo(
    () => (members || []).filter(member => !isClientRole(member.role)),
    [members],
  );

  const memberOptions = useMemo(() => {
    return [
      { value: 'all', label: 'Уся команда підтримки' },
      ...supportMembers.map(m => ({
        value: m.id || m.uid,
        label: m.name || m.email?.split('@')[0] || 'Учасник',
        user: m,
      }))
    ];
  }, [supportMembers]);

  const dateOptions = [
    { value: 'all', label: 'За весь час' },
    { value: '7days', label: 'Додано за 7 днів' },
    { value: '30days', label: 'Додано за 30 днів' }
  ];

  const sortOptions = [
    { value: 'updated', label: 'Нещодавно оновлені' },
    { value: 'name', label: 'За назвою (А-Я)' }
  ];

  const workspaceLoadError = projectsError;
  const workspaceLoadErrorKind = organizationLoadErrorKind(workspaceLoadError);
  // Project/issue streams are narrower than organization membership. One of
  // them failing can mean a stale project team snapshot or a transient rules
  // read; only OrgContext may make the organization-level access decision.
  const workspaceScopeFailure = workspaceLoadErrorKind === 'permission-denied'
    || workspaceLoadErrorKind === 'not-found';

  if (clientViewer && !clientsRoute) {
    // Still on the way in: either the spaces have not arrived yet, or they
    // have and the redirect above is in flight.
    if (projectsLoading || clientProjects.length) {
      return (
        <div className="flex min-h-[320px] flex-1 items-center justify-center" role="status" aria-busy="true">
          <LoadingSpinner size="md" label="Завантажуємо ваші звернення…" />
        </div>
      );
    }
    // Invited, but nobody has prepared a space to invite them into. This is a
    // real state and not an error: it says who fixes it.
    return (
      <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
        <div className="workspace-page-layout min-h-full">
          <PageHeader title="Мої звернення" />
          <Surface preset="panel" padding="lg">
            <EmptyState
              icon={Inbox}
              title="Проєкт підтримки ще не налаштовано"
              description="Адміністратор має додати вас до підготовленого проєкту."
              context="page"
            />
          </Surface>
        </div>
      </div>
    );
  }

  if (!clientsRoute) {
    return (
      <div className="flex min-h-[320px] flex-1 items-center justify-center" role="status" aria-busy="true">
        <LoadingSpinner size="md" label="Відкриваємо огляд підтримки…" />
      </div>
    );
  }

  return (<>
    <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
      <div className="workspace-page-layout min-h-full">

        <PageHeader
          title="Проєкти"
          actions={
            can(orgRole, 'create:project') && (
              <Button
                onClick={() => setShowNewProject(true)}
                style="primary"
                color="dark"
                size="lg"
                icon={Plus}
                collapseAt="sm"
                title="Новий проєкт"
              >
                Новий проєкт
              </Button>
            )
          }
          filters={
            <FilterBar context="projects">
              {/* «За працівником» filters this grid by the support member a
                  project is staffed with, which is a question about the desk's
                  own roster. A customer holds a handful of projects and none of
                  that roster, so the control would offer them a list of other
                  people's names to slice their own two cards by. */}
              {!clientViewer && (
                <Select filterRole="member" options={memberOptions} value={selectedMember} onChange={setSelectedMember} variant="ghost" />
              )}
              <Select filterRole="date" options={dateOptions} value={dateFilter} onChange={setDateFilter} variant="ghost" />
              <Select filterRole="sort" options={sortOptions} value={sortOption} onChange={setSortOption} variant="ghost" />
            </FilterBar>
          }
        />

        {workspaceLoadError && (
          <div className="flex flex-col items-start gap-2">
            <Alert
              variant="error"
              title={workspaceScopeFailure
                ? 'Не вдалося прочитати частину робочого простору'
                : projectsError
                  ? 'Не вдалося завантажити проєкти'
                  : 'Не вдалося завантажити звернення'}
              description={workspaceScopeFailure
                ? 'Дані організації на місці. Оновіть доступ і спробуйте ще раз.'
                : 'Перевірте підключення до інтернету та спробуйте ще раз.'}
            />
            <Button onClick={() => window.location.reload()} style="secondary" size="sm">
              Спробувати ще раз
            </Button>
          </div>
        )}

        {/* Projects Panel */}
        <div className="w-full flex-1 flex flex-col">
          {projectsLoading ? (
            // A spinner, not a grid of placeholder cards. The cards never lined
            // up with the real ones — different height, different gaps — so the
            // moment the projects arrived the whole grid appeared to jump.
            <Surface preset="panel" padding="lg" composition="chart-panel" className="w-full flex-1 flex flex-col">
              <div role="status" aria-busy="true" className="flex min-h-[280px] flex-1 items-center justify-center">
                <LoadingSpinner size="md" />
                <span className="sr-only">Завантаження…</span>
              </div>
            </Surface>
          ) : filteredProjects.length === 0 ? (
            <Surface preset="panel" padding="md" className="w-full">
              <EmptyState
                icon={Folder}
                title={(projects || []).filter(project => project.status !== 'archived').length === 0 ? 'Ще немає проєктів' : 'Проєктів не знайдено'}
                description={(projects || []).filter(project => project.status !== 'archived').length === 0
                  ? can(orgRole, 'create:project')
                    ? 'Створіть перший проєкт, призначте підтримку та запросіть представника клієнта.'
                    : 'Попросіть адміністратора створити перший проєкт.'
                  : 'Спробуйте змінити параметри фільтрації.'}
                action={(projects || []).filter(project => project.status !== 'archived').length === 0 && can(orgRole, 'create:project') ? 'Створити проєкт' : null}
                onAction={(projects || []).filter(project => project.status !== 'archived').length === 0 && can(orgRole, 'create:project') ? () => setShowNewProject(true) : null}
                context="page"
              />
            </Surface>
          ) : (
            <Surface preset="panel" padding="lg" className="w-full">
              {/* Columns, gap and row height all live in `globals.css` behind
                  this name: the featured card is two of these rows tall and a
                  small one is exactly one, and that only holds while a single
                  place owns both numbers. */}
              <div className="ui-grid" data-ui-grid="project-cards">
                {filteredProjects.map((p, index) => (
                  <WorkspaceProjectCard
                    key={p.id}
                    project={p}
                    archive={archive}
                    unarchive={unarchive}
                    members={members}
                    allOrgMembers={members}
                    // The featured card is a desktop arrangement: it earns its
                    // extra weight by spanning two columns of a grid, and below
                    // md the grid is one column wide. All it did on a phone was
                    // make the first project taller, wordier and differently
                    // typeset than every project under it, for no reason a
                    // reader could see.
                    isLarge={!isMobile && index === 0 && selectedMember === 'all' && dateFilter === 'all'}
                    orgLoading={orgLoading}
                    now={now}
                  />
                ))}
              </div>
            </Surface>
          )}
        </div>

      </div>
    </div>

    {showNewProject && (
      <NewProjectModal
        onClose={() => setShowNewProject(false)}
        orgId={activeOrgId}
        members={supportMembers}
        statuses={statuses}
      />
    )}

  </>);
}
