'use client';
// src/app/workspace/[projectId]/issue/[issueId]/page.js
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAppContext }        from '@/lib/context/AppContext';
import { useIssues }           from '@/lib/hooks/useIssues';
import { useTimeLogs }         from '@/lib/hooks/useTimeLogs';
import { useOrganization }     from '@/lib/hooks/useOrganization';
import { hasProjectAccess, hasRecordedTeam, isOnProjectTeam } from '@/lib/utils/projectAccess.mjs';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { useStagesForProject } from '@/lib/hooks/useStagesForProject';
import { useSprints } from '@/lib/hooks/useSprints';
import { usePortalSession }    from '@/lib/portal/usePortalSession';
import QtPlusChatPanel from '@/components/workspace/qtplus/chat/QtPlusChatPanel';
import { useWorkflowConfig }   from '@/lib/hooks/useWorkflowConfig';
import { resolveCategoryStatusId } from '@/lib/utils/statusCategories.mjs';
import { ISSUE_LINK_OPTIONS, issueLinkPerspective, useIssueLinks } from '@/lib/hooks/useIssueLinks';
import MarkdownEditor from '@/components/ui/Forms/MarkdownEditor';
import MarkdownViewer, { setTaskChecked } from '@/components/ui/DataDisplay/MarkdownViewer';
import AttachmentViewer from '@/components/ui/AttachmentViewer';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import Tag from '@/components/ui/DataDisplay/Tag';
import UnifiedTimeline from '@/components/workspace/UnifiedTimeline';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import AttachmentRow from '@/components/ui/TaskManagement/AttachmentRow';
import TimeLogRow from '@/components/ui/TaskManagement/TimeLogRow';
import LiveTimeTracking from '@/components/workspace/LiveTimeTracking';
import MetaTrigger from '@/components/ui/DataDisplay/MetaTrigger';
import IssueLinkRow from '@/components/ui/TaskManagement/IssueLinkRow';
import DescriptionPlaceholder from '@/components/ui/TaskManagement/DescriptionPlaceholder';
import TitleInput from '@/components/ui/Forms/TitleInput';
import TextAction from '@/components/ui/TextAction';
import { getMatFileUrl } from '@/lib/utils/issueAttachments.mjs';
import { useLocalization } from '@/lib/hooks/useLocalization';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import {
  fromDateInput,
  isDueDateOverdue,
  parseDueDate,
  toLocalDateInput,
} from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import { plural } from '@/lib/utils/plural.mjs';
import DatePicker from '@/components/ui/Forms/DatePicker';

import { can, canWhileRoleLoads, isClientRole } from '@/lib/utils/can';
import { isArchivedIssue, withoutArchivedIssues } from '@/lib/utils/issueArchive.mjs';
import { isCancelledIssue, withoutCancelledIssues } from '@/lib/utils/issueCancel.mjs';
import { setIssueArchived, setIssueCancelled } from '@/lib/services/issues';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { MultiSelect, Select } from '@/components/ui/Select';
import { Alert, AttributeTrigger, ContextMenu, DetailLayout, DetailSection, Dialog, getTaskAttributeChrome, IconAction, Pill, Popover, Segmented, StatusPill, Surface, TaskAttributesPanel, Tabs, Tooltip, useConfirm } from '@/components/ui';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import useWorkspaceStore       from '@/store/useWorkspaceStore';
import { sendNotification }    from '@/lib/hooks/useNotifications';
import {
  AlignLeft, Heart, Clock, History, PanelRightClose, PanelRightOpen, ExternalLink, X, Plus, Search, Settings2, Share2, Send, CheckSquare, Square, MoreHorizontal, Pencil, Check, Trash2, Paperclip, ChevronRight, Minus, Eye, EyeOff,
  Play, Square as StopIcon,
  Link2, Copy, CopyPlus, MessageCircle, Sparkles, Tag as TagIcon, Archive, ArchiveRestore,
  Maximize2, User, Users, CircleDot, Ban, Undo2,
} from 'lucide-react';
import { ParentTaskIcon, TaskIcon } from '@/lib/design/icons';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { auth, db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, deleteDoc, arrayRemove, arrayUnion } from 'firebase/firestore';
import { uploadFile } from '@/lib/utils/uploadFile';
import { deleteFileFromCloudinary } from '@/lib/services/fileUpload';
import { downloadMaterial } from '@/lib/portal/downloadMaterial';
import { buildTaskAiPrompt } from '@/lib/utils/taskPrompt.mjs';
import { existingParentIssueId } from '@/lib/utils/issueHierarchyModel.mjs';
import { issueCompletionBlockers } from '@/lib/utils/issueExecution.mjs';
import {
  cancelScheduledIssueSeen,
  markIssueUnread,
  scheduleIssueSeen,
} from '@/lib/services/issueReadState';
import { issueActivityCursor } from '@/lib/utils/issueReadState.mjs';
import { reportLoadError } from '@/lib/utils/errors';
import { organizationLoadErrorKind } from '@/lib/utils/organizationLoadErrors.mjs';
import {
  issueMatchesRouteIdentifier,
  issuePath,
  issueRouteIdentifier,
} from '@/lib/utils/issueKeys.mjs';
import { safeExternalUrl } from '@/lib/utils/externalUrls.mjs';
import { timerDraftNeedsDismissal, timerFeedbackVariant } from '@/lib/utils/timerState.mjs';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';

// ── Constants ──────────────────────────────────────────────────────

// Statuses are now loaded dynamically via useWorkflowConfig.

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || '';

// The same wording Settings uses when you walk away from an unsaved field.
const UNSAVED_EDIT_PROMPT = {
  title: 'Незбережені зміни',
  message: 'У вас є незбережені зміни в інциденті. Ви впевнені, що хочете піти без збереження?',
  confirmText: 'Піти',
  cancelText: 'Повернутись',
  danger: true,
};

// Таб «QuickTeam+» у чаті завдання. Окремий компонент, щоб usePortalSession
// (обмін токена з порталом) запускався лише коли таб реально відкрито.
function IssueQtPlusChat({ qtProjectId, currentUser }) {
  const { portalUser, loading } = usePortalSession();
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-[12px] text-muted">Підключаємо QuickTeam+…</p>
      </div>
    );
  }
  if (!portalUser) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <p className="text-[12px] text-muted">
          Підключіть свій акаунт QuickTeam+ у <Link href="/settings" className="font-semibold text-ink underline">Налаштуваннях</Link>, щоб бачити цей чат.
        </p>
      </div>
    );
  }
  return <QtPlusChatPanel qtProjectId={qtProjectId} portalUser={portalUser} currentUser={currentUser} embedded />;
}

// ── Helpers ────────────────────────────────────────────────────────

function fmtMin(min) {
  if (!min && min !== 0) return '—';
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m}хв`;
  if (m === 0) return `${h}г`;
  return `${h}г ${m}хв`;
}

function timeAgo(ts) {
  if (!ts) return '';
  const d    = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 60000)    return 'щойно';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)} хв тому`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} год тому`;
  const days = Math.floor(diff / 86400000);
  if (days === 1) return 'вчора';
  return `${days} ${plural(days, ['день', 'дні', 'днів'])} тому`;
}

// Module-level id factory — keeps the impure Date.now()/Math.random() calls out
// of component render scope (react-compiler lint), while staying unique enough
// for an array element key on the issue document.
let _attSeq = 0;
function makeAttachmentId() {
  _attSeq += 1;
  return `att_${Date.now().toString(36)}_${_attSeq}`;
}
function nowMs() { return Date.now(); }

async function copyIssueUrl(path, showToast) {
  const issueUrl = `${window.location.origin}${path}`;
  try {
    await navigator.clipboard.writeText(issueUrl);
    showToast('Посилання на інцидент скопійовано');
  } catch {
    showToast('Не вдалося скопіювати посилання', 'error');
  }
}

// ── The metadata line under the title ──────────────────────────────
// «Автор … створили … оновили …» rides in the sticky box with the title, so on
// a phone it holds two of the twelve lines the screen has for as long as you
// read — to say three things that do not change while you read them.
//
// Below md it folds shut the moment the column leaves the top, on the same flag
// the attribute strip condenses on, and unfolds when you come back to it. The
// fold is a one-row grid going from `1fr` to `0fr`, so nothing has to know the
// height of a line that wraps to two on a narrow screen; `inert` takes the
// author's menu out of reach while it is shut, since a fold is not a hide.
//
// Above md there is no wrapper at all — the strip is returned as it was.
function TitleMeta({ collapsible, folded, children }) {
  if (!collapsible) return children;
  return (
    <div
      inert={folded}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ${
        folded ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

// ── Circular ring progress ─────────────────────────────────────────
function Ring({ pct, color, size = 36, stroke = 3.5 }) {
  const r    = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct, 100) / 100 * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f0f0f0" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
    </svg>
  );
}

// ── Attachment rows ────────────────────────────────────────────────
// Lives on the description's canvas panel, so each row is a white surface —
// the same card-on-canvas relationship the rest of the workspace uses. There
// is deliberately no rule above the list: the panel edge already separates
// attachments from the description text.
function AttachmentRows({ attachments, isEditing, isArchived, onOpen, onInsert, onDelete }) {
  if (attachments.length === 0) return null;
  return (
    <DetailSection density="group" icon={Paperclip} title="Вкладення" count={attachments.length}>
      <div className="flex flex-col gap-1.5">
        {attachments.map(attachment => (
          <AttachmentRow
            key={attachment.id || getMatFileUrl(attachment)}
            attachment={attachment}
            isEditing={isEditing}
            isArchived={isArchived}
            onOpen={onOpen}
            onInsert={onInsert}
            onDelete={onDelete}
            onDownload={downloadMaterial}
          />
        ))}
      </div>
    </DetailSection>
  );
}

// ── Media viewer (lightbox) ────────────────────────────────────────
function MediaViewer({ mat, onClose }) {
  return (
    <AttachmentViewer
      attachment={{
        ...mat,
        name: mat.name || mat.title,
        previewUrl: getMatFileUrl(mat),
      }}
      onClose={onClose}
    />
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════

export default function IssueDetail({ issueId: issueLocator, projectId, isModal, onClose }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { formatDate } = useLocalization();
  const { projects, currentUser, activeOrg, activeOrgId, orgRole } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  const internalViewer = Boolean(orgRole) && !clientViewer;
  const canEditIssue = can(orgRole, 'edit:issue');
  const timeZone = organizationTimeZone(activeOrg);
  const {
    issues,
    loading: issuesLoading,
    error: issuesError,
    createIssue,
    updateIssue,
    setIssueParent,
    deleteIssue,
    restoreIssue,
    moveIssue,
    // A task put aside — archived or cancelled — keeps its own link working.
    // This is the one reader that asks for them, so «Архів» can open a task and
    // put it back.
  } = useIssues(projectId, { includeLinks: false, includeSetAside: true });
  const project = projects?.find(candidate => candidate.id === projectId);
  const issue = issues.find(candidate => issueMatchesRouteIdentifier(candidate, issueLocator, project));
  const issueId = issue?.id || '';
  const canonicalIssuePath = issuePath(issue, project || projectId);
  const issueLoadErrorKind = organizationLoadErrorKind(issuesError);
  const issueAccessFailure = issueLoadErrorKind === 'permission-denied' || issueLoadErrorKind === 'not-found';

  const showToast      = useWorkspaceStore(s => s.showToast);
  const confirmDialog  = useConfirm();
  const setBreadcrumbs = useWorkspaceStore(s => s.setBreadcrumbs);
  const startTimer     = useWorkspaceStore(s => s.startTimer);
  const stopTimer      = useWorkspaceStore(s => s.stopTimer);
  // `timerElapsed` is deliberately not among these. The store ticks it once a
  // second while a timer runs, and a screen that reads it in its own body
  // re-renders whole once a second — this one is two thousand lines of screen.
  // LiveTimeTracking reads it instead, so the tick reaches the clock and stops.
  const activeTimer    = useWorkspaceStore(s => s.activeTimer);

  const teamUids = Array.isArray(project?.team) ? project.team : [];
  // Resolve author/assignee names from ALL organization members, not just the
  // project team. Scoping this to `project.team` was the "Автор: Невідомо" /
  // blank-assignee bug: anyone off the team (e.g. the creator of a task in a
  // project they aren't a team member of) was unresolvable and rendered empty.
  const { members } = useOrganization();

  // Кого можна покликати в цій задачі.
  //
  // `members` вище — це вся організація, і для розвʼязування імен так і треба.
  // Але пікер згадок — не довідник імен, а пропозиція: «покликати цю людину
  // сюди». Він працював з того самого списку, тож у задачі одного проєкту можна
  // було тегнути людину, якої в цьому проєкті немає, — для неї ця задача просто
  // не існує, і сповіщення вело б у нікуди.
  //
  // Склад проєкту — це `project.team`, і саме його продукт показує скрізь, де
  // питання «хто тут» (`isOnProjectTeam`). До нього додається тільки той, хто
  // вже в цій розмові: виконавці, автор і підписники. Вони в ній за фактом, і
  // зникнути з пікера посеред обговорення вони не можуть, навіть якщо в
  // складі проєкту їх ніхто не записав.
  // Проєкт, у якому склад ніхто не записував, не може відповісти на питання
  // «хто тут» — і мовчання тут означало б порожній пікер, а не звужений.
  const mentionInvolved = new Set([
    ...(Array.isArray(issue?.assigneeIds) ? issue.assigneeIds : []),
    ...(Array.isArray(issue?.watcherIds) ? issue.watcherIds : []),
    issue?.authorId,
    issue?.createdBy,
  ].filter(Boolean));
  const mentionMembers = hasRecordedTeam(project)
    ? members.filter(member => {
        const uid = member.id || member.uid;
        return Boolean(uid) && (isOnProjectTeam(project, uid) || mentionInvolved.has(uid));
      })
    : members;
  // A task in the archive is read-only for the same reason an archived project
  // is: it has been put aside, and the one action it offers is coming back. A
  // cancelled task is read-only on the same terms — editing work that has been
  // called off is how it quietly comes back to life in somebody's list.
  const isIssueArchived = isArchivedIssue(issue);
  const isIssueCancelled = isCancelledIssue(issue);
  const isArchived = project?.status === 'archived' || isIssueArchived || isIssueCancelled;

  const { stages }   = useStagesForProject(projectId);
  const { sprints = [] } = useSprints({ enabled: internalViewer });

  // Чат завдання отримує другий таб «QuickTeam+», коли проєкт звʼязано з
  // проєктом порталу — портальний чат просто як додатковий (IssueQtPlusChat
  // монтується лише при відкритті таба, щоб не смикати сесію QT+ даремно).
  const qtplusLink = clientViewer ? null : project?.qtplusLink || null;
  const [chatView, setChatView] = useState('chat');
  const requestedTaskPane = searchParams.get('view') === 'chat' ? 'chat' : 'task';
  const [taskPaneSelection, setTaskPaneSelection] = useState(null);
  const [isCompactTaskLayout, setIsCompactTaskLayout] = useState(true);
  const [taskChatUnreadState, setTaskChatUnreadState] = useState({ issueId: '', count: 0 });
  const taskPane = taskPaneSelection?.issueId === issueId
    ? taskPaneSelection.pane
    : requestedTaskPane;
  const unreadTaskChatCount = taskChatUnreadState.issueId === issueId
    ? taskChatUnreadState.count
    : 0;
  const handleTaskPaneChange = (pane) => {
    setTaskPaneSelection({ issueId, pane });
  };
  // Below lg the page shows one pane at a time, so the pane switch is the whole
  // navigation of this screen — and QuickTeam+ was not on it. It was a second
  // pair of tabs *inside* the chat pane, which meant reaching the portal
  // conversation on a phone took two switches on two different strips. One
  // strip now: Завдання · Чат · QuickTeam+, the last only when the project is
  // actually linked.
  const compactTaskTab = taskPane === 'chat' && chatView === 'qtplus' && qtplusLink?.projectId
    ? 'qtplus'
    : taskPane;
  const handleCompactTabChange = (id) => {
    if (id === 'qtplus') {
      setChatView('qtplus');
      handleTaskPaneChange('chat');
      return;
    }
    if (id === 'chat') setChatView('chat');
    handleTaskPaneChange(id);
  };
  const handleTaskChatUnreadChange = (count) => {
    setTaskChatUnreadState(current => (
      current.issueId === issueId && current.count === count
        ? current
        : { issueId, count }
    ));
  };

  const { logs: timeLogs, totalMinutes: loggedMinutes, addTimeLog, updateTimeLog, deleteTimeLog } = useTimeLogs(
    internalViewer ? issueId : null,
    projectId,
  );
  const {
    links = [],
    refresh: refreshLinks,
    addLink,
    removeLink,
  } = useIssueLinks(internalViewer ? issueId : null);

  const {
    types: rawTypes, priorities: rawPriorities, statuses: STATUSES, labels: availableLabels = [], closedStatusIds
  } = useWorkflowConfig();

  const activeHiddenCols = project?.hiddenColumns || [];
  const visibleStatuses = STATUSES.filter(s => !activeHiddenCols.includes(s.id));

  // Build type metadata while priority visuals stay in the shared PriorityIcon.
  const TYPES = rawTypes.map(t => ({
    ...t,
    icon: taskTypeIcon(t),
    color: t.color || DEFAULT_TYPES.find(d => d.id === t.id)?.color || '#9a9a9a',
  }));
  const PRIORITIES = rawPriorities.map(p => ({
    ...p,
    color: p.color || DEFAULT_PRIORITIES.find(d => d.id === p.id)?.color || '#9a9a9a',
  }));

  // ── UI state ──────────────────────────────────────────────────────
  const [showSubInput, setShowSubInput] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');
  const [creatingSubtask, setCreatingSubtask] = useState(false);
  const [showDetailsDropdown, setShowDetailsDropdown] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkRelation, setLinkRelation] = useState('relates-to');
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkSaving, setLinkSaving] = useState(false);
  const [migratingChecklist, setMigratingChecklist] = useState(false);
  const [parentSaving, setParentSaving] = useState(false);
  const [timeLogsPage, setTimeLogsPage] = useState(1);
  const [logForm,      setLogForm]      = useState(null);
  const [logTab, setLogTab] = useState('spend');
  const [viewerMat,    setViewerMat]    = useState(null); // lightbox
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  // Which layout is on screen, resolved in JS: the metadata line folds only on
  // a phone, and a media query cannot tell a component to render less.
  const isMobile = useIsMobile();
  const TIME_LOGS_PER_PAGE = 5;

  // ── Edit mode state ───────────────────────────────────────────────
  const [isEditing,    setIsEditing]   = useState(false);
  // Local editable fields (draft while in edit mode)
  const [draft, setDraft] = useState({});

  // Phone and tablet layouts use one pane at a time. Keeping this query in JS
  // as well as CSS lets the timeline defer read receipts while its pane is
  // hidden; on desktop the split view remains continuously active.
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const updateLayout = () => setIsCompactTaskLayout(media.matches);
    updateLayout();
    media.addEventListener('change', updateLayout);
    return () => media.removeEventListener('change', updateLayout);
  }, []);

  const issueActivityAt = issueActivityCursor(issue);
  const currentUserId = currentUser?.uid || currentUser?.id || null;
  const lastActivityActorId = issue?.lastActivityActorId || issue?.updatedBy || issue?.createdBy || null;

  // Who this task can be given to: the project's team, exactly as the create
  // dialog already offers. Offering the whole organization made assigning
  // someone the side door into the project — picking a non-member silently
  // added them to `project.team`, because an assignee who cannot open their own
  // task is worse still. Anyone already assigned stays on the list even if they
  // have since left the team; otherwise they could never be un-assigned.
  const assignableIds = new Set([...teamUids, ...(issue?.assigneeIds || [])]);
  // Assignees the project's roster does not name.
  //
  // This asked the *access* question until it turned out to be the wrong one:
  // an admin reaches every project of the organization, so an admin assigned a
  // task here passed the check and the notice stayed silent — while the project
  // card, which draws `project.team` and nothing else, showed an empty seat
  // where they should have been. Being able to open a project and being on it
  // are two facts, and this is the second.
  const assigneesOffProjectRoster = !project || !hasRecordedTeam(project)
    ? []
    : (issue?.assigneeIds || [])
      .map(uid => members.find(member => (member.id || member.uid) === uid) || { id: uid, name: uid })
      .filter(member => !isOnProjectTeam(project, member.id || member.uid));
  // The subset who cannot open the project either — for them this is a task
  // they will never find, not merely a missing face. The organization directory
  // carries each colleague's role, so a missing role here is a member's.
  const assigneesLockedOutOfProject = assigneesOffProjectRoster.filter(
    member => !hasProjectAccess(project, member.role || null, member.id || member.uid),
  );

  const handleGrantProjectAccess = async () => {
    const uids = assigneesOffProjectRoster.map(member => member.id || member.uid).filter(Boolean);
    if (uids.length === 0) return;
    try {
      await updateDoc(doc(db, 'projects', projectId), { team: arrayUnion(...uids) });
      showToast('Додано до складу проєкту');
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося додати до складу проєкту'), 'error');
    }
  };
  // Deactivated colleagues stay in `members` so their name and face still
  // render on everything they did; they are simply not people you can hand new
  // work to, here or in any other picker.
  const assignableMembers = assignableIds.size === 0
    // A project with no team recorded at all is legacy data, not a project
    // nobody may be assigned to.
    ? activeMembers(members)
    : activeMembers(members).filter(member => assignableIds.has(member.id || member.uid));

  // Leaving a task consumes it, not opening it.
  //
  // The cursor used to advance the moment the detail rendered, which made the
  // boundary in the timeline useless in the one case it exists for: open a task,
  // get called away, come back — and nothing was marked as new any more, because
  // the render had already answered for you. What is on screen when you walk
  // away is the revision you are recorded as having seen.
  //
  // The revision itself is read from a ref rather than from the effect's
  // dependencies: activity arriving while the task is open must not restart this
  // effect, or leaving would consume whatever the last render happened to hold.
  const consumeRef = useRef({ millis: 0, suppressed: false });
  useEffect(() => {
    consumeRef.current.millis = issueActivityAt;
  }, [issueActivityAt]);
  useEffect(() => {
    if (!activeOrgId || !currentUserId || !issueId) return undefined;
    // Arriving cancels a consume scheduled by the visit that just ended — the
    // canonical-key redirect below remounts this component a beat after a task
    // opens, and that remount is not a reader walking away.
    cancelScheduledIssueSeen(issueId);
    consumeRef.current.suppressed = false;
    return () => {
      // Reading the ref *at cleanup time* is the point: the value the reader is
      // recorded as having seen is the one on screen when they walked away, not
      // the one this effect happened to start with.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const { millis, suppressed } = consumeRef.current;
      if (suppressed || !millis) return;
      scheduleIssueSeen({
        organizationId: activeOrgId,
        issueId,
        userId: currentUserId,
        lastSeenAt: new Date(millis),
        onError: error => reportLoadError('[IssueDetail] mark issue seen', error),
      });
    };
  }, [activeOrgId, currentUserId, issueId]);

  // Putting a task back into your own inbox. The cursor goes to just before the
  // newest activity, so the dot returns on the board and the boundary in the
  // timeline lands on the change that made you want to come back — and this
  // visit stops consuming, or closing the task would immediately undo it.
  const lastSeenMillis = useWorkspaceStore(state => state.issueReadState[issueId] || 0);
  const handleMarkUnread = async () => {
    consumeRef.current.suppressed = true;
    try {
      await markIssueUnread({
        organizationId: activeOrgId,
        issueId,
        userId: currentUserId,
        activityMillis: issueActivityAt,
        currentSeenMillis: lastSeenMillis,
      });
      showToast('Інцидент позначено непрочитаним');
    } catch (error) {
      consumeRef.current.suppressed = false;
      reportLoadError('[IssueDetail] mark issue unread', error);
      showToast('Не вдалося позначити непрочитаною', 'error');
    }
  };

  useEffect(() => {
    if (isModal || !canonicalIssuePath || issueLocator === issueRouteIdentifier(issue, project)) return;
    const query = searchParams.toString();
    router.replace(`${canonicalIssuePath}${query ? `?${query}` : ''}`, { scroll: false });
  }, [canonicalIssuePath, isModal, issue, issueLocator, project, router, searchParams]);

  // Minutes a stopped timer produced and nobody has written down yet. They live
  // in the server-backed store, not in the URL: the canonical-key redirect
  // above remounts this component a beat after the task loads, and a `logTime`
  // query param consumed into local state did not survive that — the dialog
  // vanished a second after it appeared and the tracked time went with it.
  const pendingTimeLog = useWorkspaceStore(s => s.pendingTimeLog);
  const clearPendingTimeLog = useWorkspaceStore(s => s.clearPendingTimeLog);
  const acknowledgePendingTimeLog = useWorkspaceStore(s => s.acknowledgePendingTimeLog);
  const pendingForThisIssue = Boolean(
    issueId
    && pendingTimeLog
    && pendingTimeLog.entityType !== 'calendar_event'
    && pendingTimeLog.minutes > 0
    && pendingTimeLog.issueId === issueId,
  );

  useEffect(() => {
    if (!pendingForThisIssue) return;
    const minutes = pendingTimeLog.minutes;
    queueMicrotask(() => setLogForm(current => (current || {
      minutes,
      desc: '',
      fromTimer: true,
      timerSessionId: pendingTimeLog.id,
    })));
  }, [pendingForThisIssue, pendingTimeLog?.id, pendingTimeLog?.minutes, pendingTimeLog?.stoppedAt]);

  // The server pending record is authoritative across tabs and devices. A
  // dialog opened from it cannot remain saveable after another client has
  // saved or discarded that same timer session.
  useEffect(() => {
    const timerSessionId = logForm?.timerSessionId;
    if (!timerDraftNeedsDismissal(timerSessionId, pendingTimeLog)) return;
    queueMicrotask(() => setLogForm(current => (
      current?.timerSessionId === timerSessionId ? null : current
    )));
  }, [logForm?.timerSessionId, pendingTimeLog]);

  // Legacy `?logTime=` links (bookmarks, the older mobile nav) still work; the
  // param is only stripped once its minutes are safely in the store.
  useEffect(() => {
    const logTimeParam = searchParams.get('logTime');
    if (!logTimeParam) return;
    const minutes = Math.round(Number(logTimeParam));
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    if (!pendingForThisIssue) {
      queueMicrotask(() => setLogForm(current => current || { minutes, desc: '', fromTimer: true }));
    }
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('logTime');
    const nextQuery = nextSearchParams.toString();
    const nextPath = canonicalIssuePath || pathname;
    router.replace(nextQuery ? `${nextPath}?${nextQuery}` : nextPath, { scroll: false });
  }, [canonicalIssuePath, pendingForThisIssue, searchParams, pathname, router]);

  // Closing the dialog on time that is not saved anywhere else has to be a
  // decision, not an accident — a stray Escape used to be indistinguishable
  // from throwing the hours away.
  const closeLogForm = async () => {
    if (logForm?.fromTimer && logForm.minutes > 0) {
      const discard = await confirmDialog({
        title: 'Не зберігати відстежений час?',
        message: `${logForm.minutes} хв з таймера ще не зафіксовано. Якщо закрити зараз, цей час буде втрачено.`,
        confirmText: 'Не зберігати',
        cancelText: 'Повернутись',
        danger: true,
      });
      if (!discard) return;
      try {
        await clearPendingTimeLog(logForm.timerSessionId);
      } catch (error) {
        showToast(error.message || 'Не вдалося відхилити відстежений час', 'error');
        return;
      }
    }
    setLogForm(null);
  };

  const copyIssueLink = () => copyIssueUrl(canonicalIssuePath, showToast);

  const copyAiPrompt = async () => {
    if (!issue) return;
    const taskUrl = `${window.location.origin}${canonicalIssuePath}`;
    const prompt = buildTaskAiPrompt({
      issue,
      projectName: project?.name || '',
      statusName: (() => {
        const item = STATUSES.find(
          option => option.id === (issue.status || issue.columnId),
        );
        return item?.label || item?.name || '';
      })(),
      priorityName: (() => {
        const item = PRIORITIES.find(option => option.id === issue.priority);
        return item?.label || item?.name || '';
      })(),
      typeName: (() => {
        const item = TYPES.find(option => option.id === issue.type);
        return item?.label || item?.name || '';
      })(),
      assigneeNames: (issue.assigneeIds || [])
        .map(uid => members.find(member => (member.id || member.uid) === uid))
        .filter(Boolean)
        .map(member => member.name || member.displayName || member.email || ''),
      taskUrl,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      showToast('AI-промпт скопійовано');
    } catch {
      showToast('Не вдалося скопіювати AI-промпт', 'error');
    }
  };

  // ── Breadcrumbs ───────────────────────────────────────────────────
  useEffect(() => {
    if (isModal) return;
    useWorkspaceStore.setState({
      breadcrumbs: [
        { label: 'Проєкти', href: '/' },
        { label: project?.name || '...', href: `/${projectId}` },
        { label: issue?.issueKey || '...', href: null, onClick: () => copyIssueUrl(canonicalIssuePath, showToast), title: 'Копіювати посилання на інцидент' },
      ]
    });
    return () => useWorkspaceStore.setState({ breadcrumbs: [] });
  }, [canonicalIssuePath, project?.name, issue?.issueKey, projectId, isModal, showToast]);

  // Whether the open draft says anything the task does not. Everything that can
  // be edited in place (status, sprint, labels…) writes straight through, so the
  // draft is exactly the six fields `enterEdit` copies.
  const draftIsDirty = Boolean(isEditing && issue && (
    (draft.title ?? '') !== (issue.title ?? '')
    || (draft.type || '') !== (issue.type || '')
    || (draft.priority || '') !== (issue.priority || '')
    || (draft.estimateMinutes || 0) !== (issue.estimateMinutes || 0)
    || (draft.description || '') !== (issue.description || '')
    || (draft.dueDate || '') !== toLocalDateInput(parseDueDate(issue.dueDate, { timeZone }), { timeZone })
  ));

  // Walking off the page mid-edit used to take the draft with it silently. The
  // same guard Settings uses: `beforeunload` for a reload or a closed tab, and
  // in-app <Link> clicks caught in the capture phase so we run before Next's own
  // handler and can still cancel the navigation.
  useEffect(() => {
    if (!draftIsDirty) return;

    const onBeforeUnload = event => {
      event.preventDefault();
      event.returnValue = '';
    };

    const onClickCapture = event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target?.closest?.('a[href]');
      if (!anchor) return;
      if (anchor.target && anchor.target !== '_self') return;      // opens a new tab
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin !== window.location.origin) return;           // external → beforeunload handles it
      if (url.pathname === window.location.pathname) return;        // same page / in-page anchor
      event.preventDefault();
      event.stopPropagation();
      confirmDialog(UNSAVED_EDIT_PROMPT).then(leave => {
        if (!leave) return;
        setIsEditing(false); // discarded → the guard stops prompting
        router.push(url.pathname + url.search + url.hash);
      });
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [confirmDialog, draftIsDirty, router]);

  useEffect(() => {
    const fn = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-qt-floating-overlay]')) return;
      if (showLinkInput) { setShowLinkInput(false); return; }
      if (showSubInput) { setShowSubInput(false); return; }
      if (isEditing) {
        // A stray Escape is the other accidental way out of edit mode.
        if (!draftIsDirty) { setIsEditing(false); return; }
        void confirmDialog(UNSAVED_EDIT_PROMPT).then(discard => {
          if (discard) setIsEditing(false);
        });
        return;
      }

      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      router.push(`/${projectId}`);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [router, projectId, isEditing, showLinkInput, showSubInput, draftIsDirty, confirmDialog]);

  if (!issue) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        {issuesLoading ? (
          <div className="w-7 h-7 border-[3px] border-line border-t-ink rounded-full animate-spin" />
        ) : issuesError ? (
          <div className="max-w-[360px] px-6 text-center">
            <p className="text-[16px] font-bold text-ink mb-2">
              {issueAccessFailure ? 'Немає доступу до інциденту' : 'Не вдалося завантажити інцидент'}
            </p>
            <p className={`text-[13px] text-muted ${issueAccessFailure ? '' : 'mb-4'}`}>
              {issueAccessFailure
                ? 'Інцидент видалено або у вас більше немає доступу до його проєкту.'
                : 'Дані не видалені. Сервіс бази тимчасово недоступний.'}
            </p>
            {!issueAccessFailure && (
              <TextAction size="lg" onClick={() => window.location.reload()}>Спробувати ще раз</TextAction>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-[16px] font-bold text-ink mb-2">Інцидент не знайдено</p>
            <Link href={`/${projectId}`} className="text-[13px] text-ink hover:underline">← Повернутись</Link>
          </div>
        )}
      </div>
    );
  }

  // ── Derived ───────────────────────────────────────────────────────
  const sorted = [...issues].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx    = sorted.findIndex(i => i.id === issueId);
  const prev   = idx > 0 ? sorted[idx - 1] : null;
  const next   = idx < sorted.length - 1 ? sorted[idx + 1] : null;

  const selectedTypeId = isEditing ? draft.type : issue.type;
  const legacyEpicType = {
    id: 'epic',
    label: 'Епік (legacy)',
    color: '#8b5cf6',
    icon: taskTypeIcon('epic'),
  };
  const creatableTypes = TYPES.filter(type => type.id !== 'epic');
  const EDITABLE_TYPES = issue.type === 'epic'
    ? [
        ...creatableTypes,
        TYPES.find(type => type.id === 'epic') || legacyEpicType,
      ]
    : creatableTypes;
  const typeCfg = EDITABLE_TYPES.find(t => t.id === selectedTypeId)
    || EDITABLE_TYPES.find(t => t.id === 'task')
    || EDITABLE_TYPES[0]
    || legacyEpicType;
  const statusCfg   = STATUSES.find(s => s.id === issue.columnId)                             || STATUSES[0];
  const TypeIcon    = typeCfg.icon;

  const due       = parseDueDate(issue.dueDate, { timeZone });
  const isOverdue = isDueDateOverdue(issue.dueDate, { timeZone })
    && !closedStatusIds.includes(issue.columnId || issue.status);
  const dueStr    = due ? formatDate(due, { timeZone }) : null;
  const {
    attributeItemClass,
    attributeLabelClass,
    compactInputClass,
    compactSelectClass,
    detailsButtonClass,
  } = getTaskAttributeChrome({ condensed: isHeaderScrolled });

  const assignees     = (issue.assigneeIds || []).map(uid => members.find(m => (m.id || m.uid) === uid)).filter(Boolean);
  const reporterMatchByEmail = issue.reporterName ? members.find(m => m.email && m.email.toLowerCase() === issue.reporterName.toLowerCase()) : null;
  const reporterMember = members.find(m => (m.id || m.uid) === issue.reporterId) || reporterMatchByEmail || null;
  const telegramUsername = String(issue.sourceMeta?.telegramUsername || '').replace(/^@/, '').trim();
  const externalReporterName = issue.source === 'telegram'
    ? telegramUsername
      ? `QuickTeam (@${telegramUsername})`
      : `QuickTeam (${issue.reporterName || 'користувач Telegram'})`
    : issue.source === 'buggybag'
      ? 'BuggyBag'
      : issue.reporterName || 'Зовнішній автор';
  const reporter = reporterMember || { name: externalReporterName };
  const isExternalReporter = !reporterMember;
  const externalReporterSource = issue.source === 'telegram'
    ? 'Цей інцидент створено через Telegram-бота QuickTeam.'
    : issue.source === 'youtrack'
      ? 'Автора перенесено разом з інцидентом із YouTrack.'
      : issue.source === 'buggybag'
        ? 'Цей інцидент створено через інтеграцію BuggyBag.'
        : 'Цей інцидент створено зовнішньою інтеграцією.';
  const youTrackSourceUrl = issue.source === 'youtrack'
    ? safeExternalUrl(issue.importMetadata?.sourceUrl)
    : '';
  const checklistDone = (issue.subtasks || []).filter(s => s.done).length;
  const checklistAll = (issue.subtasks || []).length;
  const parentIssueId = existingParentIssueId(issue);
  const parentIssue = issues.find(candidate => candidate.id === parentIssueId) || null;
  const childIssues = issues
    .filter(candidate => existingParentIssueId(candidate) === issueId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const childIssuesDone = childIssues.filter(child => closedStatusIds.includes(child.columnId || child.status)).length;
  // This screen subscribes with `includeSetAside`, so its own link keeps
  // working. The pickers below must not inherit that: you do not hang new work
  // under a task that has been put aside, or link one to it.
  const openIssues = withoutCancelledIssues(withoutArchivedIssues(issues));
  const parentCandidates = openIssues.filter(candidate => (
    candidate.id !== issueId
    && !existingParentIssueId(candidate)
  ));
  // Only labels that still exist in the workflow. A label deleted in settings
  // leaves its id behind on every task that wore it, and counting the *ids*
  // meant the block kept announcing «Мітки 3» above an empty row forever.
  const issueLabels = (issue.labelIds || [])
    .map(id => availableLabels.find(label => label.id === id))
    .filter(Boolean);
  const visibleAttachments = issue.attachments || [];
  const currentIssueLinks = links
    .map(link => ({ link, perspective: issueLinkPerspective(link, issueId) }))
    .filter(item => item.perspective);
  const linkedIssueIds = new Set(currentIssueLinks.map(item => item.perspective.otherIssueId));
  const availableLinkIssues = openIssues.filter(item => (
    item.id !== issueId
    && !linkedIssueIds.has(item.id)
  ));

  // Does the description panel have anything to say below the editor? While
  // reading there is always the description or its placeholder; while writing
  // the padded half of the panel is drawn only when something is actually in it,
  // so an empty task edits as the editor alone with no grey strip under it.
  const hasSecondaryBlocks = issueLabels.length > 0
    || childIssues.length > 0 || showSubInput
    || checklistAll > 0
    || currentIssueLinks.length > 0 || showLinkInput;
  const hasPanelBody = !isEditing || visibleAttachments.length > 0 || hasSecondaryBlocks;

  const spentMin  = loggedMinutes;
  const estimMin  = isEditing ? (draft.estimateMinutes ?? issue.estimateMinutes ?? 0) : (issue.estimateMinutes || 0);
  const timePct   = estimMin > 0 ? Math.round((spentMin / estimMin) * 100) : 0;
  // Over the estimate, close to it, or within it — the two warnings are the
  // status scale, and the third is the product's own ink, because "within the
  // estimate" is not a status, it is the ordinary case.
  const timeColor = timePct >= 100
    ? 'var(--color-danger)'
    : timePct >= 75 ? 'var(--color-warning)' : 'var(--color-ink)';

  const isTimerMine    = activeTimer?.issueId === issueId;
  const allMaterials   = stages.flatMap(s => (s.materials || []).map(m => ({ ...m, stageName: s.title || s.name })));
  const actor          = { userId: currentUser?.id || currentUser?.uid, userName: currentUser?.name };

  // ── Edit mode helpers ─────────────────────────────────────────────
  const enterEdit = () => {
    setDraft({
      title:           issue.title,
      type:            issue.type     || 'task',
      priority:        issue.priority || NO_PRIORITY_ID,
      estimateMinutes: issue.estimateMinutes || 0,
      dueDate:         toLocalDateInput(due, { timeZone }),
      description:     issue.description || '',
    });
    setIsEditing(true);
  };

  const cancelEdit = () => setIsEditing(false);

  const saveEdit = async () => {
    const patch = {};
    if (draft.title           !== issue.title)           patch.title = draft.title.trim();
    if (draft.type            !== issue.type)             patch.type = draft.type;
    if (draft.priority        !== issue.priority)         patch.priority = draft.priority;
    if (draft.estimateMinutes !== issue.estimateMinutes)  patch.estimateMinutes = draft.estimateMinutes;
    if (draft.description     !== (issue.description||''))patch.description = draft.description;
    // dueDate
    const originalDueInput = toLocalDateInput(due, { timeZone });
    if ((draft.dueDate || '') !== originalDueInput) {
      patch.dueDate = draft.dueDate
        ? fromDateInput(draft.dueDate, { endOfDay: true, timeZone })
        : null;
    }
    if (Object.keys(patch).length > 0) {
      try { await updateIssue(issueId, patch, actor); showToast('Збережено'); }
      catch (err) { showToast(err.message, 'error'); }
    }
    setIsEditing(false);
  };

  // ── Handlers ──────────────────────────────────────────────────────
  const update = async (patch) => {
    try { await updateIssue(issueId, patch, actor); }
    catch (err) { showToast(err.message || 'Помилка', 'error'); }
  };

  const handleStatusChange = async (s) => {
    if (closedStatusIds.includes(s)) {
      const freshLinks = await refreshLinks();
      if (!freshLinks) {
        showToast('Не вдалося перевірити залежності. Оновіть сторінку й повторіть.', 'error');
        return;
      }
      const blockers = issueCompletionBlockers({
        issueId,
        issues,
        issueLinks: freshLinks,
        closedStatusIds,
      });
      if (blockers.dependencies.length > 0) {
        showToast(`Інцидент ще блокують: ${blockers.dependencies.length}`, 'error');
        return;
      }
    }
    // A status changed here comes with no board and no slot, so it is stated as
    // one: the top of its new column. It used to pass `issue.order` — the
    // card's position *number* — where an insert *index* was expected, so a
    // task landed at whatever row its old number happened to name, and the
    // negative number every freshly created task carries always clamped to the
    // very top.
    try { await moveIssue(issueId, s, { index: 0 }, actor); }
    catch (err) { showToast(err.message, 'error'); }
  };

  // Writes the whole assignee list in one go, then replays the per-person side
  // effects for everyone newly added. Doing it list-first (instead of once per
  // toggle) is what lets the multi-select hand over several changes at a time
  // without each write clobbering the previous one.
  const setAssignees = async (next) => {
    const cur = issue.assigneeIds || [];
    const added = next.filter(uid => !cur.includes(uid));
    if (added.length === 0 && next.length === cur.length) return;
    await update({ assigneeIds: next });

    // Under team-gated project visibility, an assignee who isn't on the
    // project team could not open the task they were just given. Add them to
    // the team so the assignment is actually usable.
    //
    // And say which of the two happened. Only owners and admins may write
    // `team` (Firestore rules), so a member's grant is refused — and it used to
    // be refused into a `catch {}`, which left the assignment standing beside a
    // person who still could not open it and nobody told either of them. Both
    // outcomes are now something the assigner reads.
    const missingFromTeam = added.filter(uid => !teamUids.includes(uid));
    if (missingFromTeam.length > 0) {
      const named = missingFromTeam
        .map(uid => members.find(m => (m.id || m.uid) === uid))
        .map((member, index) => member?.name || member?.email || missingFromTeam[index])
        .join(', ');
      try {
        await updateDoc(doc(db, 'projects', projectId), { team: arrayUnion(...missingFromTeam) });
        showToast(`${named} — додано до команди проєкту`);
      } catch {
        showToast(`${named} не входить до команди проєкту — попросіть власника або адміністратора додати`, 'warning');
      }
    }

    const myId = currentUser?.id || currentUser?.uid;
    const notifyIds = added.filter(uid => uid !== myId);
    if (notifyIds.length > 0) {
      await sendNotification({ userIds: notifyIds, type: 'assigned',
        title: `${currentUser?.name || 'Колега'} призначив вам ${issue.issueKey}`, body: issue.title,
        link: canonicalIssuePath, issueId, projectId,
        organizationId: activeOrg?.id || activeOrg?.organizationId || '',
        // `actor` is resolved server-side from the ID token; passing it here
        // was silently dropped by /api/notifications.
      }).catch(() => {});
    }
  };

  const toggleAssignee = async (uid) => {
    const cur = issue.assigneeIds || [];
    await setAssignees(cur.includes(uid) ? cur.filter(a => a !== uid) : [...cur, uid]);
  };

  // ── Watchers (follow a task you're not assigned to, to get its notifications) ──
  const myUid = currentUser?.id || currentUser?.uid;
  const isWatching = (issue.watcherIds || []).includes(myUid);
  const toggleWatch = async () => {
    if (!myUid) return;
    await update({ watcherIds: isWatching ? arrayRemove(myUid) : arrayUnion(myUid) });
  };

  const handleTimerToggle = async () => {
    try {
      if (isTimerMine) {
        const result = await stopTimer();
        if (result?.queued) {
          showToast('Зупинку таймера збережено — час синхронізується після відновлення мережі', 'warning');
        } else if (result?.minutes > 0) {
          setLogForm({
            minutes: result.minutes,
            desc: '',
            fromTimer: true,
            timerSessionId: result.id,
          });
        }
      } else {
        if (activeTimer) { showToast('Зупини поточний таймер спочатку', 'warning'); return; }
        const started = await startTimer(issueId, projectId, {
          entityType: 'issue',
          organizationId: activeOrgId,
        });
        if (!started) showToast('Спершу збережи або відхили попередній відстежений час', 'warning');
      }
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити таймер', timerFeedbackVariant(error));
    }
  };

  const handleParentChange = async nextParentIssueId => {
    if (parentSaving) return;
    if (nextParentIssueId && childIssues.length > 0) {
      showToast('Інцидент із дочірніми інцидентами не можна зробити дочірнім', 'error');
      return;
    }
    try {
      setParentSaving(true);
      await setIssueParent(issueId, nextParentIssueId || null);
      showToast(nextParentIssueId ? 'Основний інцидент змінено' : 'Інцидент став самостійним');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити основний інцидент', 'error');
    } finally {
      setParentSaving(false);
    }
  };

  const handleLogTime = async () => {
    if (!logForm) return;

    if (logForm.estim !== undefined && logForm.estim !== (estimMin || 0)) {
      await update({ estimateMinutes: logForm.estim });
    }

    // The issue's denormalised `spentMinutes` mirror is maintained inside
    // useTimeLogs, in the same batch as the log itself — writing it here as
    // well raced with concurrent logs and could drop one of them.
    if (logForm.minutes > 0) {
      try {
        if (logForm.id) {
          await updateTimeLog(logForm.id, { spentMinutes: logForm.minutes, description: logForm.desc });
          showToast('Запис оновлено');
        } else {
          const uid = currentUser?.id || currentUser?.uid;
          await addTimeLog(issueId, projectId, uid, logForm.minutes, logForm.desc, {
            timerSessionId: logForm.timerSessionId,
          });
          showToast(`${logForm.minutes} хв зафіксовано`);
        }
      } catch (err) {
        showToast(err.message || 'Не вдалося зберегти час', 'error');
        return;
      }
    } else if (logForm.minutes === 0 && logForm.estim !== undefined && logForm.estim !== (estimMin || 0)) {
      showToast('Оцінку часу оновлено');
    }
    // Saved — the stopped timer's minutes now live in a time log.
    if (logForm.timerSessionId) acknowledgePendingTimeLog(logForm.timerSessionId);
    setLogForm(null);
  };

  const handleDeleteTimeLog = async (log) => {
    if (!(await confirmDialog({
      title: 'Видалити запис часу?',
      message: 'Ви впевнені, що хочете видалити цей запис часу?',
      confirmText: 'Видалити', danger: true,
    }))) return;
    try {
      await deleteTimeLog(log.id);
      showToast('Запис часу видалено');
    } catch (err) {
      showToast('Помилка видалення: ' + err.message, 'error');
    }
  };

  // ── Attachments (first-class files on the task, separate from comments) ──
  const handleUploadAttachments = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadingAttach(true);
    try {
      const orgId = project?.organizationId || '';
      // Uploaded in parallel, and appended with arrayUnion so two people
      // attaching files at the same time cannot overwrite each other's list.
      const uploaded = await Promise.all(files.map(async file => ({
        id: makeAttachmentId(),
        ...await uploadFile(file, `organizations/${orgId}/attachments`), // { name, url, size, type }
        uploadedById: currentUser?.id || currentUser?.uid || '',
        uploadedByName: currentUser?.name || currentUser?.email || '',
        uploadedAt: nowMs(),
      })));
      await update({ attachments: arrayUnion(...uploaded) });
      showToast(`Додано вкладень: ${uploaded.length}`);
      return uploaded;
    } catch (err) {
      showToast('Помилка завантаження файлу', 'error');
      return [];
    } finally {
      setUploadingAttach(false);
    }
  };

  const handleDeleteAttachment = async (id) => {
    const target = (issue.attachments || []).find(a => a.id === id);
    if (!(await confirmDialog({
      title: 'Видалити вкладення?',
      message: `${target?.name || 'Файл'} буде видалено з інциденту і зі сховища. Це не можна скасувати.`,
      confirmText: 'Видалити',
      danger: true,
    }))) return;
    const removed = target;
    await update({ attachments: (issue.attachments || []).filter(a => a.id !== id) });
    // Release the stored file too — dropping only the metadata left the upload
    // in Cloudinary forever, still being paid for.
    if (removed?.storagePath) {
      await deleteFileFromCloudinary(removed.storagePath, removed.resourceType).catch(() => {});
    }
  };

  const handleAddSubtask = async () => {
    const title = subtaskText.trim();
    if (!title || creatingSubtask) return;
    if (parentIssueId) {
      showToast('Дочірній інцидент не може мати власні дочірні інциденти', 'error');
      return;
    }
    // A new subtask starts where planned work starts — the category says which
    // column that is, instead of hoping the project still has one called 'todo'.
    const initialStatus = resolveCategoryStatusId('todo', STATUSES, {
      hiddenStatusIds: activeHiddenCols,
    })
      || visibleStatuses.find(status => !closedStatusIds.includes(status.id))?.id
      || visibleStatuses[0]?.id
      || 'backlog';
    const childTypeId = creatableTypes.find(type => type.id === 'task')?.id || creatableTypes[0]?.id;
    if (!childTypeId) {
      showToast('Спершу додайте активний тип інциденту в налаштуваннях', 'error');
      return;
    }
    try {
      setCreatingSubtask(true);
      const created = await createIssue({
        title,
        description: '',
        type: childTypeId,
        priority: issue.priority || NO_PRIORITY_ID,
        status: initialStatus,
        columnId: initialStatus,
        parentIssueId: issueId,
        assigneeIds: issue.assigneeIds || [],
        labelIds: [],
        estimateMinutes: 0,
      }, actor);
      setSubtaskText('');
      setShowSubInput(false);
      showToast(`${created.issueKey || 'Дочірній інцидент'} створено`);
    } catch (error) {
      showToast(error.message || 'Не вдалося створити дочірній інцидент', 'error');
    } finally {
      setCreatingSubtask(false);
    }
  };

  const handleMoveLegacyChecklistToDescription = async () => {
    if (migratingChecklist) return;
    try {
      setMigratingChecklist(true);
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Потрібна авторизація');
      const response = await fetch(`/api/issues/${encodeURIComponent(issueId)}/legacy-checklist`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не вдалося перенести чекліст');
      showToast('Чекліст перенесено в опис');
    } catch (error) {
      showToast(error.message || 'Не вдалося перенести чекліст', 'error');
    } finally {
      setMigratingChecklist(false);
    }
  };

  const handleDuplicate = async () => {
    if (!issue || isArchived) return;
    try {
      const duplicateStatus = issue.columnId || issue.status || resolveCategoryStatusId('backlog', STATUSES, {
        hiddenStatusIds: activeHiddenCols,
      }) || 'backlog';
      const duplicateSprint = sprints.find(sprint => (
        sprint.id === issue.sprintId && sprint.status !== 'completed'
      ));
      const created = await createIssue({
        title: `${issue.title || 'Інцидент'} (копія)`,
        description: issue.description || '',
        type: issue.type || 'task',
        priority: issue.priority || NO_PRIORITY_ID,
        status: duplicateStatus,
        columnId: duplicateStatus,
        assigneeIds: Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [],
        labelIds: Array.isArray(issue.labelIds) ? issue.labelIds : [],
        dueDate: parseDueDate(issue.dueDate, { timeZone })?.toISOString() || null,
        estimateMinutes: Number(issue.estimateMinutes) || 0,
        sprintId: duplicateSprint?.id || null,
        parentIssueId: existingParentIssueId(issue),
      }, actor);
      showToast('Копію інциденту створено');
      if (isModal && onClose) onClose();
      navigateAfterOverlayClose(() => router.push(issuePath(created, project || projectId)));
    } catch (error) {
      showToast(error.message || 'Не вдалося дублювати інцидент', 'error');
    }
  };

  const handleArchive = async (archived) => {
    if (archived && !(await confirmDialog({
      title: `Архівувати ${issue.issueKey}?`,
      message: 'Інцидент зникне з дошки, списків і підрахунку відкритої роботи, але лишиться в «Архіві» — без строку і без втрати даних. Записаний час нікуди не дінеться: він і далі буде в таймшиті та в рахунках. Повернути можна будь-коли.',
      confirmText: 'Архівувати',
    }))) return;
    try {
      await setIssueArchived(issueId, archived);
      showToast(archived ? 'Інцидент в архіві' : 'Інцидент повернуто з архіву');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити стан архіву', 'error');
    }
  };

  const handleCancel = async (cancelled) => {
    if (cancelled && !(await confirmDialog({
      title: `Скасувати ${issue.issueKey}?`,
      message: 'Скасування означає, що цієї роботи не буде. Інцидент зникне не лише з дошки й списків, а й з усього обліку: з прогресу проєкту, зі звітів, з навантаження, з рахунків і з дедлайнів — так, ніби його не планували. Дані лишаються, він чекає в «Архіві» → «Скасовані», і повернути можна будь-коли. Якщо робота відбулася і просто завершена — архівуйте, тоді вона лишиться у звітах.',
      confirmText: 'Так, скасувати',
      // The dismiss button is «Скасувати» everywhere else, and here that is the
      // name of the action itself — two buttons side by side, one meaning "do
      // it" and one meaning "don't". This is the only dialog where the word
      // has to be taken away from the one that closes it.
      cancelText: 'Ні, лишити',
    }))) return;
    try {
      await setIssueCancelled(issueId, cancelled);
      showToast(cancelled ? 'Інцидент скасовано' : 'Інцидент повернуто');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити стан скасування', 'error');
    }
  };

  const handleDelete = async () => {
    if (!(await confirmDialog({
      title: `Видалити ${issue.issueKey}?`,
      message: childIssues.length > 0
        ? `Інцидент буде прибрано з ${childIssues.length} дочірніми інцидентами в ієрархії. Одразу після видалення дію можна скасувати.`
        : 'Інцидент буде прибрано. Одразу після видалення дію можна скасувати.',
      confirmText: 'Видалити', danger: true,
    }))) return;
    try {
      const deletion = await deleteIssue(issueId, childIssues.length > 0 ? { childPolicy: 'promote' } : undefined);
      router.push(`/${projectId}`);
      showToast('Інцидент видалено', 'success', {
        duration: 30000,
        action: {
          label: 'Скасувати',
          onClick: () => {
            void restoreIssue(issueId, deletion.organizationId).then(() => {
              showToast('Інцидент відновлено');
              router.push(canonicalIssuePath);
            }).catch(error => {
              showToast(error.message || 'Не вдалося відновити інцидент', 'error');
            });
          },
        },
      });
    } catch (error) {
      showToast(error.message || 'Не вдалося видалити інцидент', 'error');
    }
  };

  // Built once and placed by the description block below — inside the canvas
  // panel when there is a description, in its own panel otherwise (and while
  // editing, where the per-row "Вставити в опис" action lives).
  const attachmentRows = (
    <AttachmentRows
      attachments={visibleAttachments}
      isEditing={isEditing}
      isArchived={isArchived || !canEditIssue}
      onOpen={setViewerMat}
      onInsert={(attachment, fileType, url) => {
        const markdown = fileType === 'image' ? `![${attachment.name}](${url})` : `[${attachment.name}](${url})`;
        setDraft(current => ({ ...current, description: `${current.description || ''}${current.description ? '\n\n' : ''}${markdown}` }));
      }}
      onDelete={handleDeleteAttachment}
    />
  );

  // What you can do to this task, as one block. It is rendered in two places —
  // beside the title on a phone, at the far right of the header row from `sm`
  // up — because on a narrow screen these buttons used to fall to a line of
  // their own *below* the author/created/updated strip: three rows of chrome
  // before the description, and the two controls people actually reach for
  // parked furthest from the thing they act on.
  const headerActions = (
    <>
      {isEditing ? (
        // Beside the title on a phone there is room for the title or for two
        // labelled buttons, not both — so below sm they collapse to the two
        // glyphs everything else in the product uses for these two answers.
        <>
          <Button style="secondary" size="md" icon={X} collapseAt="sm" onClick={cancelEdit}>Скасувати</Button>
          <Button style="primary" size="md" icon={Check} collapseAt="sm" onClick={saveEdit}>Зберегти</Button>
        </>
      ) : (
        <>
          {!isArchived && canEditIssue && <Button style="secondary" size="icon-lg" icon={Pencil} onClick={enterEdit} aria-label="Редагувати інцидент" title="Редагувати інцидент" />}
          <ContextMenu
            trigger={(
              <Button
                style="secondary"
                size="icon-lg"
                icon={MoreHorizontal}
                aria-label="Опції інциденту"
                title="Опції"
              />
            )}
            dropdownClassName="w-[210px]"
            items={[
              { label: 'Копіювати посилання', icon: Copy, onClick: copyIssueLink },
              ...(!isArchived && canEditIssue ? [{ label: 'Дублювати', icon: CopyPlus, onClick: handleDuplicate }] : []),
              ...(canEditIssue ? [{ label: 'Скопіювати AI-промпт', icon: Sparkles, onClick: copyAiPrompt }] : []),
              // Only offered when there is somebody else's activity to un-see.
              // Marking a task you were the last to touch as unread would light
              // no dot: your own change is never new to you, on a card or here.
              ...(issueActivityAt && lastActivityActorId !== currentUserId
                ? [{ label: 'Позначити непрочитаним', icon: CircleDot, onClick: handleMarkUnread }]
                : []),
              ...(!isArchived ? [
                {
                  label: isWatching ? 'Не стежити' : 'Стежити',
                  icon: isWatching ? EyeOff : Eye,
                  onClick: toggleWatch,
                },
                // Two different things, and they finally read as two: putting a
                // task aside for good, and deleting it with a clock running.
                ...(canWhileRoleLoads(orgRole, 'edit:issue')
                  ? [
                    { label: 'Архівувати', icon: Archive, onClick: () => handleArchive(true) },
                    { label: 'Скасувати', icon: Ban, onClick: () => handleCancel(true) },
                  ]
                  : []),
                ...(canWhileRoleLoads(orgRole, 'delete:issue')
                  ? [{ label: 'Видалити', icon: Trash2, onClick: handleDelete, isDanger: true }]
                  : []),
              ] : []),
              ...(isIssueArchived && canWhileRoleLoads(orgRole, 'edit:issue')
                ? [{ label: 'Повернути з архіву', icon: ArchiveRestore, onClick: () => handleArchive(false) }]
                : []),
              ...(isIssueCancelled && canWhileRoleLoads(orgRole, 'edit:issue')
                ? [{ label: 'Повернути інцидент', icon: Undo2, onClick: () => handleCancel(false) }]
                : []),
            ]}
          />
        </>
      )}
      {isModal && onClose && (
        <>
          <Button
            style="secondary"
            size="icon"
            icon={Maximize2}
            onClick={() => {
              onClose();
              navigateAfterOverlayClose(() => router.push(canonicalIssuePath));
            }}
            aria-label="Відкрити на повній сторінці"
            title="Відкрити на повній сторінці"
          />
          <Button style="secondary" size="icon" icon={X} onClick={onClose} aria-label="Закрити" title="Закрити" />
        </>
      )}
    </>
  );

  // ════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════
  return (
    <>
      {/* Lightbox */}
      {viewerMat && <MediaViewer mat={viewerMat} onClose={() => setViewerMat(null)} />}

      <DetailLayout
        context="task"
        standalone={!isModal}
        scrolled={isHeaderScrolled}
        onScrolledChange={setIsHeaderScrolled}
        mobilePane={!isModal && taskPane === 'chat' ? 'aside' : 'content'}
        lead={!isModal ? (
          // The kit's standard strip, not the stepper. `underline` says "you are
          // at step two of a sequence"; these are three views of one record, and
          // a third of them only exists on some projects — which a stretched
          // stepper cannot express without the tabs changing width under you.
          <div className="page-gutter shrink-0 overflow-x-auto hide-scrollbar bg-white pb-1 pt-2 lg:hidden">
            <Tabs
              composition="pane-switch"
              tabs={[
                { id: 'task', label: 'Інцидент', icon: TaskIcon },
                { id: 'chat', label: 'Чат', icon: MessageCircle, count: unreadTaskChatCount },
                ...(qtplusLink?.projectId ? [{ id: 'qtplus', label: 'QuickTeam+' }] : []),
              ]}
              activeTab={compactTaskTab}
              onTabChange={handleCompactTabChange}
            />
          </div>
        ) : null}
        header={(
             <div className="flex w-full flex-col gap-[10px] pb-[12px] pt-[12px] sm:flex-row sm:items-start sm:justify-between sm:gap-[16px]">
               <div className="flex flex-col gap-[4px] flex-1 min-w-0">
            {!clientViewer && parentIssueId && (
              <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted">
                {/* The same arrow the board card and the list row draw for this
                    relation. This line used to be `Layers`, so the one fact
                    "this hangs under that" had two glyphs depending on which
                    screen you happened to be reading it on. */}
                <ParentTaskIcon size={12} strokeWidth={2} className="shrink-0" />
                <span className="shrink-0">Дочірній інцидент для</span>
                <Link
                  href={issuePath(parentIssue || { id: parentIssueId }, project || projectId)}
                  className="min-w-0 truncate font-semibold text-ink hover:underline"
                >
                  {/* Never the raw document id. A cancelled parent — like one
                      in another sprint or past the loaded page — is not in the
                      issues this screen was handed, and printing the fallback
                      put a 20-character Firestore id where a task key belongs.
                      The child records its parent's key when the link is made,
                      which is what names it in every one of those cases. */}
                  {parentIssue?.issueKey || issue?.parentIssueKey || 'Основний інцидент'}
                  {parentIssue?.title ? ` — ${parentIssue.title}` : ''}
                </Link>
                {!isArchived && canEditIssue && (
                  <Button
                    style="ghost"
                    size="icon-xs"
                    icon={X}
                    onClick={() => handleParentChange(null)}
                    disabled={parentSaving}
                    aria-label="Відв’язати від основного інциденту"
                    title="Зробити самостійним інцидентом"
                    className="shrink-0"
                  />
                )}
              </div>
            )}
            {/* Below sm the actions ride here, level with the title they act
                on. From sm up they sit at the end of the header row instead —
                see `headerActions`. */}
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <TitleInput autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Назва інциденту..." />
                ) : (
                  <h1 className="ui-type-page-title text-ink tracking-tight leading-tight">{issue.title}</h1>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:hidden">
                {headerActions}
              </div>
            </div>

            {/* Why every control on this task is inert. A task that simply
                disappeared from the board with no explanation on the task itself
                is what made the old «Архівувати» feel like a loss. */}
            {isIssueArchived && (
              <div className="mt-3">
                <Alert variant="info" title="Інцидент в архіві">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Воно прибране з дошки, списків і підрахунку відкритої роботи. У звітах, таймшиті та рахунках лишається — записаний час нікуди не дівся. Строку немає.</span>
                    {canWhileRoleLoads(orgRole, 'edit:issue') && (
                      <Button
                        style="primary"
                        size="sm"
                        icon={ArchiveRestore}
                        onClick={() => handleArchive(false)}
                      >
                        Повернути з архіву
                      </Button>
                    )}
                  </div>
                </Alert>
              </div>
            )}

            {/* The other half of the same explanation. A cancelled task is out
                of the numbers as well as out of the way, and that difference is
                the only reason both actions exist — so it is said here, on the
                task, rather than left to be inferred from an empty chart. */}
            {isIssueCancelled && (
              <div className="mt-3">
                <Alert variant="warning" title="Інцидент скасовано">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Цієї роботи не буде. Інцидент не рахується ніде: ні в прогресі, ні у звітах, ні в навантаженні, ні в рахунках. Дані збережені — строку немає.</span>
                    {canWhileRoleLoads(orgRole, 'edit:issue') && (
                      <Button
                        style="primary"
                        size="sm"
                        icon={Undo2}
                        onClick={() => handleCancel(false)}
                      >
                        Повернути інцидент
                      </Button>
                    )}
                  </div>
                </Alert>
              </div>
            )}

            {/* An assignee the project does not list. Two shapes of the same
                fact, and the task is where both are visible at once:

                  a member — cannot open the project at all, so the task sits in
                  their «Мої завдання» pointing at a 404;
                  an owner or an admin — opens it fine, but nothing records that
                  they work here, so the project card draws no face for them.

                The second used to be silent, because the check asked whether
                they had access rather than whether the project named them. */}
            {assigneesOffProjectRoster.length > 0 && (
              <div className="mt-3">
                <Alert
                  variant="warning"
                  title={assigneesOffProjectRoster.length === 1
                    ? 'Цього учасника немає в проєкті'
                    : 'Цих учасників немає в проєкті'}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      {assigneesOffProjectRoster.map(member => member.name || member.email).join(', ')} — не у складі проєкту
                      {project?.name ? ` «${project.name}»` : ''}.
                    </span>
                    {can(orgRole, 'manage:team') && (
                      <Button
                        style="primary"
                        size="sm"
                        icon={Users}
                        onClick={handleGrantProjectAccess}
                      >
                        Додати до проєкту
                      </Button>
                    )}
                  </div>
                </Alert>
              </div>
            )}

            {/* Metadata strip for non-editable details */}
            <TitleMeta collapsible={isMobile === true} folded={isHeaderScrolled}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-muted font-medium mt-1.5">
                {/* A member's name opens the two things you can do with a person,
                    so it opens the product's menu — the same panel, rows and icons
                    the kebab beside the title drops. An external author has no
                    profile and no chat, so that one stays an explanation. */}
                {isExternalReporter ? (
                  <Popover
                    position="bottom"
                    align="start"
                    gap={4}
                    hideCloseIcon
                    hideArrow
                    minWidth="200px"
                    padding="default"
                    triggerClassName="inline-flex"
                    trigger={(
                      <MetaTrigger label="Автор:" user={reporter} name={reporter.name} />
                    )}
                  >
                    <div className="w-[260px]">
                      <p className="text-[13px] font-bold text-ink">Зовнішній автор</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-muted">{externalReporterSource}</p>
                      <p className="mt-2 text-[11px] leading-relaxed text-faint">
                        Це не учасник організації, тому профіль та особистий чат недоступні.
                      </p>
                      {youTrackSourceUrl && (
                        <a
                          href={youTrackSourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-ink hover:underline"
                        >
                          Відкрити в YouTrack <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </Popover>
                ) : (
                  <ContextMenu
                    align="start"
                    dropdownClassName="w-[210px]"
                    trigger={(
                      <MetaTrigger label="Автор:" user={reporter} name={reporter.name} />
                    )}
                    items={[
                      {
                        label: 'Переглянути профіль',
                        icon: User,
                        onClick: () => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set('member', reporterMember.id || reporterMember.uid);
                          router.push(`${pathname}?${params.toString()}`);
                        },
                      },
                      {
                        label: 'Написати в чат',
                        icon: MessageCircle,
                        onClick: () => router.push(`/chat?dm=${encodeURIComponent(reporterMember.id || reporterMember.uid)}`),
                      },
                    ]}
                  />
                )}
                <span className="w-[3px] h-[3px] rounded-full bg-faint" />

                {/* Created relative time */}
                <Tooltip
                  content={`Створено: ${issue.createdAt?.toDate ? issue.createdAt.toDate().toLocaleString('uk-UA') : issue.createdAt ? new Date(issue.createdAt).toLocaleString('uk-UA') : '—'}`}
                  position="bottom"
                >
                  <div className="flex items-center gap-1 cursor-help border-b border-dashed border-transparent hover:border-faint transition-colors">
                    <span>створили</span>
                    <span className="text-ink font-semibold">{timeAgo(issue.createdAt)}</span>
                  </div>
                </Tooltip>
                <span className="w-[3px] h-[3px] rounded-full bg-faint" />
                <Tooltip
                  content={`Оновлено: ${(issue.updatedAt || issue.createdAt)?.toDate ? (issue.updatedAt || issue.createdAt).toDate().toLocaleString('uk-UA') : (issue.updatedAt || issue.createdAt) ? new Date(issue.updatedAt || issue.createdAt).toLocaleString('uk-UA') : '—'}`}
                  position="bottom"
                >
                  <div className="flex items-center gap-1 cursor-help border-b border-dashed border-transparent hover:border-faint transition-colors">
                    <span>оновили</span>
                    <span className="text-ink font-semibold">{timeAgo(issue.updatedAt || issue.createdAt)}</span>
                  </div>
                </Tooltip>
                {isOverdue && (
                  <>
                    <span className="w-[3px] h-[3px] rounded-full bg-faint" />
                    <Pill tone="danger" size="sm">Прострочено</Pill>
                  </>
                )}
              </div>
            </TitleMeta>
          </div>
          <div className="hidden shrink-0 items-center gap-2 pt-1 sm:flex">
            {headerActions}
          </div>
            </div>
        )}
        attributes={(
            <TaskAttributesPanel
              singleRow
              context="task"
              compact
              condensed={isHeaderScrolled}
              cardClassName="transition-[background-color,padding] duration-200"
              cardStyle={{
                backgroundColor: isHeaderScrolled ? 'rgba(244,244,245,0.36)' : undefined,
                backdropFilter: isHeaderScrolled ? 'blur(4px)' : undefined,
                WebkitBackdropFilter: isHeaderScrolled ? 'blur(4px)' : undefined,
              }}
              primaryChildren={clientViewer ? (
                <>
                  <div className={attributeItemClass}>
                    <span className={attributeLabelClass}>Статус</span>
                    <StatusPill
                      label={statusCfg?.label || 'Новий'}
                      color={statusCfg?.color}
                    />
                  </div>
                  <div className={attributeItemClass}>
                    <span className={attributeLabelClass}>Виконавці</span>
                    {assignees.length > 0 ? (
                      <div className="flex items-center -space-x-[6px]" aria-label="Виконавці інциденту">
                        {assignees.slice(0, 4).map(member => (
                          <UserAvatar key={member.id || member.uid} user={member} size="xs" stacked tooltip />
                        ))}
                        {assignees.length > 4 && <Pill tone="neutral" size="sm">+{assignees.length - 4}</Pill>}
                      </div>
                    ) : (
                      <Pill tone="neutral" size="sm">Ще не призначено</Pill>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Status */}
                  <div className={attributeItemClass} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Статус</span>
                    <Select compact disabled={isArchived} value={issue.columnId || issue.status || visibleStatuses[0]?.id} onChange={val => handleStatusChange(val)} options={visibleStatuses.map(s => ({ value: s.id, label: s.label, dotColor: s.color }))} buttonClassName={compactSelectClass} />
                  </div>

                  {/* Assignees — the task model has always been multi-assignee;
                      the single Select silently hid everyone past the first. */}
                  <div className={attributeItemClass} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Виконавці</span>
                    <MultiSelect
                      compact
                      showSelectedAvatars
                      ariaLabel="Виконавці інциденту"
                      disabled={isArchived}
                      value={issue.assigneeIds || []}
                      onChange={setAssignees}
                      options={assignableMembers.map(m => ({ value: m.id || m.uid, label: m.name, user: m }))}
                      placeholder="Не призначено"
                      searchPlaceholder="Знайти учасника..."
                      buttonClassName={compactSelectClass}
                      dropdownClassName="w-[260px]"
                    />
                  </div>

                  {/* Sprint */}
                  <div className={`max-sm:hidden ${attributeItemClass}`} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Спринт</span>
                      <Select
                        compact
                      disabled={isArchived}
                      value={issue.sprintId || ''}
                      onChange={val => update({ sprintId: val || null })}
                      options={[
                        { value: '', label: 'Без спринта' },
                        ...sprints.map(s => ({ value: s.id, label: s.name }))
                      ]}
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  {/* Due date */}
                  <div className={`max-sm:hidden ${attributeItemClass}`}>
                    <span className={attributeLabelClass}>Дедлайн</span>
                    <DatePicker
                      compact
                      disabled={isArchived}
                      hideIcon
                      inputClassName={`${compactInputClass} ${isOverdue ? 'text-danger' : dueStr ? 'text-ink' : 'text-faint'}`}
                      value={isEditing ? (draft.dueDate || '') : (issue.dueDate || '')}
                      onChange={(val) => {
                        if (isEditing) setDraft(d => ({ ...d, dueDate: val }));
                        else update({
                          dueDate: val
                            ? fromDateInput(val, { endOfDay: true, timeZone })
                            : null,
                        });
                      }}
                      placeholder="Без дедлайну"
                    />
                  </div>

                  {/* Time tracking */}
                  <div
                    className={`${attributeItemClass} max-sm:px-1.5`}
                    onClick={event => {
                      if (isArchived || event.target.closest('button')) return;
                      setLogForm({ minutes: 0, estim: estimMin || 0, desc: '' });
                      setLogTab('spend');
                    }}
                    // It opens the time log and holds the timer buttons, so it
                    // is a control that cannot be a `<button>`.
                    role={isArchived ? undefined : 'button'}
                    tabIndex={isArchived ? undefined : 0}
                    onKeyDown={isArchived ? undefined : (keyEvent => {
                      if (keyEvent.target !== keyEvent.currentTarget) return;
                      if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
                      keyEvent.preventDefault();
                      setLogForm({ minutes: 0, estim: estimMin || 0, desc: '' });
                      setLogTab('spend');
                    })}
                  >
                    <span className={attributeLabelClass}><span className="sm:hidden">Час</span><span className="max-sm:hidden">Трекінг часу</span></span>
                    <LiveTimeTracking
                      running={isTimerMine}
                      spentMinutes={spentMin}
                      restingLabel={fmtMin(spentMin)}
                      disabled={isArchived}
                      onToggle={handleTimerToggle}
                      onOpen={() => {
                        setLogForm({ minutes: 0, estim: estimMin || 0, desc: '' });
                        setLogTab('spend');
                      }}
                      estimateLabel={estimMin > 0 ? fmtMin(estimMin) : null}
                    />
                  </div>

                  {/* Less frequently changed fields */}
                  <Popover
                    position="bottom"
                    hideCloseIcon
                    className="flex h-full items-center"
                    // Without this the wrapper Popover puts around a trigger is
                    // a bare block in a flex row, so it shrinks to the glyph:
                    // «Деталі» was a 14px-wide hit area inside a 44px column,
                    // which is why it took three tries to hit with a thumb.
                    // …and `h-full` alone left the button at the top of a
                    // wrapper it had just been told to fill, so «Деталі» sat
                    // ten pixels above the row it shares. The wrapper centres
                    // what it stretched around.
                    triggerClassName="flex h-full w-full items-center justify-center"
                    onOpenChange={setShowDetailsDropdown}
                    trigger={(
                      <AttributeTrigger
                        condensed={isHeaderScrolled}
                        active={showDetailsDropdown}
                        className="max-sm:px-0"
                        aria-expanded={showDetailsDropdown}
                        aria-label="Деталі інциденту"
                        title={`Пріоритет: ${PRIORITIES.find(item => item.id === issue.priority)?.label || 'не вказано'} · Тип: ${TYPES.find(item => item.id === issue.type)?.label || 'не вказано'}`}
                      >
                        <Settings2 size={14} />
                        <span className="max-sm:hidden">Деталі</span>
                      </AttributeTrigger>
                    )}
                  >
                      <div className="flex w-[248px] max-w-full flex-col gap-4">
                        <div className="flex flex-col gap-1.5 sm:hidden">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Спринт</span>
                          <Select
                            disabled={isArchived}
                            value={issue.sprintId || ''}
                            onChange={val => update({ sprintId: val || null })}
                            options={[{ value: '', label: 'Без спринта' }, ...sprints.map(item => ({ value: item.id, label: item.name }))]}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 sm:hidden">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Дедлайн</span>
                          <DatePicker
                            compact
                            disabled={isArchived}
                            textTone={isOverdue ? 'danger' : dueStr ? 'default' : 'faint'}
                            value={isEditing ? (draft.dueDate || '') : (issue.dueDate || '')}
                            onChange={val => {
                              if (isEditing) setDraft(current => ({ ...current, dueDate: val }));
                              else update({
                                dueDate: val
                                  ? fromDateInput(val, { endOfDay: true, timeZone })
                                  : null,
                              });
                            }}
                            placeholder="Без дедлайну"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Пріоритет</span>
                          <Select
                            disabled={isArchived}
                            value={draft.priority || issue.priority || ''}
                            onChange={val => {
                              update({ priority: val });
                              if (isEditing) setDraft(current => ({ ...current, priority: val }));
                            }}
                            options={prioritySelectOptions(PRIORITIES)}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Тип</span>
                          <Select
                            disabled={isArchived}
                            value={draft.type || issue.type || ''}
                            onChange={val => {
                              update({ type: val });
                              if (isEditing) setDraft(current => ({ ...current, type: val }));
                            }}
                            options={EDITABLE_TYPES.map(item => ({ value: item.id, label: item.label, icon: item.icon }))}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Основний інцидент</span>
                          <Select
                            disabled={isArchived || childIssues.length > 0 || parentSaving}
                            value={parentIssueId || ''}
                            onChange={handleParentChange}
                            options={[
                              { value: '', label: 'Самостійний інцидент' },
                              ...parentCandidates.map(candidate => ({
                                value: candidate.id,
                                label: `${candidate.issueKey || candidate.id} — ${candidate.title}`,
                              })),
                            ]}
                            placeholder={childIssues.length > 0 ? 'Це основний інцидент' : 'Самостійний інцидент'}
                          />
                          {childIssues.length > 0 && (
                            <span className="text-[10px] leading-relaxed text-faint">
                              Спершу відв’яжіть дочірні інциденти, щоб змінити рівень.
                            </span>
                          )}
                        </div>
                      </div>
                  </Popover>
                </>
              )}
            />
        )}
        aside={!isModal ? (
          // Chat is only useful on the full task page.
          <div className="flex h-full flex-col overflow-hidden rounded-[16px] bg-canvas">
            {/* Звʼязаний QT+ проєкт → маленькі таби над чатом */}
            {/* Below lg the pane switch at the top of the page already carries
                the QuickTeam+ tab, so this strip stops being a second place to
                choose from and keeps only the way out to the portal. */}
            {qtplusLink?.projectId && (
              <div className={`relative flex min-h-[36px] shrink-0 items-center justify-center bg-canvas px-4 pb-2 pt-3 ${
                chatView === 'qtplus' ? '' : 'max-lg:hidden'
              }`}>
                <div className="max-lg:hidden">
                  <Tabs
                    tabs={[{ id: 'chat', label: 'Чат' }, { id: 'qtplus', label: 'QuickTeam+' }]}
                    activeTab={chatView}
                    onTabChange={setChatView}
                  />
                </div>
                {chatView === 'qtplus' && process.env.NEXT_PUBLIC_QTPLUS_URL && (
                  <a
                    href={`${process.env.NEXT_PUBLIC_QTPLUS_URL}/project/${qtplusLink.projectId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="absolute right-4 top-1/2 -translate-y-1/2 rounded-[8px] p-2 text-muted transition-colors hover:bg-white hover:text-ink"
                    title="Відкрити проєкт у QuickTeam+"
                    aria-label="Відкрити проєкт у QuickTeam+"
                  >
                    <ExternalLink size={13} />
                  </a>
                )}
              </div>
            )}
            <div className="flex min-h-0 flex-1 flex-col">
              {chatView === 'qtplus' && qtplusLink?.projectId ? (
                <IssueQtPlusChat qtProjectId={qtplusLink.projectId} currentUser={currentUser} />
              ) : (
                <UnifiedTimeline
                  issueId={issueId}
                  projectId={projectId}
                  issue={issue}
                  isArchived={isArchived}
                  org={activeOrg}
                  members={members}
                  mentionMembers={mentionMembers}
                  sprints={sprints}
                  isActive={!isCompactTaskLayout || taskPane === 'chat'}
                  onUnreadCountChange={handleTaskChatUnreadChange}
                />
              )}
            </div>
          </div>
        ) : null}
      >

            {/* LOG TIME FORM MODAL */}
            {!clientViewer && logForm && (
              <Dialog
                isOpen
                onClose={closeLogForm}
                title="Трекінг часу"
                titleContext="dialog"
                size="md"
                bodyPadding="responsive"
                bodyClassName="custom-scrollbar flex flex-col gap-5"
              >
                  <Segmented
                    value={logTab}
                    onChange={setLogTab}
                    surface="canvas"
                    composition="dialog-tabs"
                    options={[
                      { value: 'spend', label: 'Зафіксувати час' },
                      ...(!logForm.id ? [{ value: 'estim', label: 'Оцінка часу' }] : []),
                    ]}
                  />

                  {logTab === 'spend' ? (
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">Зафіксувати час</p>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input size="lg" type="number" min="0" placeholder="0" value={Math.floor(logForm.minutes / 60) || ''} onChange={e => {
                               const hrs = parseInt(e.target.value) || 0;
                               const mins = logForm.minutes % 60;
                               setLogForm(f => ({ ...f, minutes: hrs * 60 + mins }));
                            }} composition="duration-hours" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted pointer-events-none">год</span>
                          </div>
                          <div className="relative flex-1">
                            <Input size="lg" type="number" min="0" max="59" placeholder="0" value={logForm.minutes % 60 || ''} onChange={e => {
                               const mins = parseInt(e.target.value) || 0;
                               const hrs = Math.floor(logForm.minutes / 60);
                               setLogForm(f => ({ ...f, minutes: hrs * 60 + Math.min(mins, 59) }));
                            }} composition="duration-minutes" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted pointer-events-none">хв</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-4">
                      <div className="flex-1">
                        <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">Запланувати час</p>
                        <div className="flex gap-2">
                          <div className="relative flex-1">
                            <Input size="lg" type="number" min="0" placeholder="0" value={Math.floor((logForm.estim || 0) / 60) || ''} onChange={e => {
                               const hrs = parseInt(e.target.value) || 0;
                               const mins = (logForm.estim || 0) % 60;
                               setLogForm(f => ({ ...f, estim: hrs * 60 + mins }));
                            }} composition="duration-hours" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted pointer-events-none">год</span>
                          </div>
                          <div className="relative flex-1">
                            <Input size="lg" type="number" min="0" max="59" placeholder="0" value={(logForm.estim || 0) % 60 || ''} onChange={e => {
                               const mins = parseInt(e.target.value) || 0;
                               const hrs = Math.floor((logForm.estim || 0) / 60);
                               setLogForm(f => ({ ...f, estim: hrs * 60 + Math.min(mins, 59) }));
                            }} composition="duration-minutes" />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted pointer-events-none">хв</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {logTab === 'spend' && (
                    <div>
                      <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">Опис (необовʼязково)</p>
                      <Input size="lg" type="text" composition="metric-text" placeholder="Що було зроблено?" value={logForm.desc} onChange={e => setLogForm(f => ({ ...f, desc: e.target.value }))} />
                    </div>
                  )}

                  <div className="flex gap-3 justify-end mt-2">
                    <Button style="secondary" size="md" onClick={closeLogForm}>Скасувати</Button>
                    <Button style="primary" size="md" onClick={handleLogTime}>{logForm.id ? 'Зберегти зміни' : 'Зберегти'}</Button>
                  </div>

                  <div className="border-t border-line pt-5">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <h4 className="ui-type-item-title text-ink">Журнал часу</h4>
                      {timeLogs.length > 0 && (
                        <span className="text-[11px] font-semibold text-muted">
                          {timeLogs.length} {plural(timeLogs.length, ['запис', 'записи', 'записів'])}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {timeLogs.slice(0, timeLogsPage * TIME_LOGS_PER_PAGE).map(log => {
                        const logMember = members.find(member => (member.id || member.uid) === log.userId);
                        const isLogAuthor = log.userId === currentUser?.uid || log.userId === currentUser?.id;
                        return (
                          <TimeLogRow
                            key={log.id}
                            member={logMember}
                            spentLabel={fmtMin(log.spentMinutes)}
                            dateLabel={log.loggedAt?.toDate ? formatDate(log.loggedAt.toDate()) : log.loggedAt ? formatDate(new Date(log.loggedAt)) : ''}
                            description={log.description}
                            canEdit={canEditIssue && isLogAuthor && !isArchived}
                            onEdit={() => { setLogForm({ id: log.id, minutes: log.spentMinutes, desc: log.description || '' }); setLogTab('spend'); }}
                            onDelete={() => handleDeleteTimeLog(log)}
                          />
                        );
                      })}
                      {timeLogs.length === 0 && <p className="rounded-[10px] bg-canvas px-3 py-5 text-center text-[12px] text-muted">Час ще не списували</p>}
                      {timeLogs.length > timeLogsPage * TIME_LOGS_PER_PAGE && (
                        <Button style="secondary" size="sm" onClick={() => setTimeLogsPage(page => page + 1)}>Показати ще</Button>
                      )}
                    </div>
                  </div>
              </Dialog>
            )}

              {/* DESCRIPTION */}
              <DetailSection icon={AlignLeft} title="Опис">
                {/* The panel carries no padding of its own: the editor *is* the
                    panel while you write, filling it corner to corner instead of
                    sitting inside it as a second bordered, rounded box. Everything
                    that reads rather than writes gets the padding back below.

                    Reading, the panel's own grey *is* its edge. Writing, the
                    editor paints that grey over in white and the block loses its
                    sides into the white page — so the edge gets drawn instead of
                    filled, and only then. */}
                <div
                  data-ui-surface={isEditing ? 'bordered-panel' : 'panel'}
                  data-ui-padding="none"
                  className="ui-surface flex w-full min-w-0 flex-col overflow-hidden"
                >
                  {isEditing && (
                    <MarkdownEditor
                      frame="flush"
                      value={draft.description}
                      onChange={description => setDraft(d => ({ ...d, description }))}
                      onUploadFiles={handleUploadAttachments}
                      uploading={uploadingAttach}
                      placeholder="Додай детальний опис інциденту..."
                      minHeight="320px"
                    />
                  )}
                  {hasPanelBody && (
                  <div className="flex w-full min-w-0 flex-col gap-4 px-4 py-3">
                  {isEditing ? (
                    visibleAttachments.length > 0 ? attachmentRows : null
                  ) : (issue.description || visibleAttachments.length > 0) ? (
                    <>
                      {issue.description && (
                        <MarkdownViewer
                          content={issue.description}
                          size="lg"
                          onTaskToggle={isArchived || !canEditIssue ? undefined : (taskLine, checked) => update({ description: setTaskChecked(issue.description, taskLine, checked) })}
                        />
                      )}
                      {visibleAttachments.length > 0 && (
                        <div className={issue.description ? 'mt-4' : ''}>{attachmentRows}</div>
                      )}
                    </>
                  ) : (
                    <DescriptionPlaceholder onClick={canEditIssue ? enterEdit : undefined} disabled={!canEditIssue}>
                      {canEditIssue ? 'Натисни Редагувати щоб додати опис...' : 'Опис звернення ще не додано.'}
                    </DescriptionPlaceholder>
                  )}

                {issueLabels.length > 0 && (
                  <DetailSection density="group" icon={TagIcon} title="Мітки" count={issueLabels.length} className="pt-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {issueLabels.map(label => (
                        <Tag
                          key={label.id}
                          label={label.label || label.name}
                          color={label.color}
                          onRemove={canEditIssue ? () => update({ labelIds: (issue.labelIds || []).filter(item => item !== label.id) }) : undefined}
                        />
                      ))}
                    </div>
                  </DetailSection>
                )}

              {/* REAL CHILD ISSUES */}
              {!clientViewer && (childIssues.length > 0 || showSubInput) && (
                <DetailSection
                  density="group"
                  icon={TaskIcon}
                  title="Дочірні інциденти"
                  count={childIssues.length}
                  // At the right edge, over the bar it reads — not trailing the
                  // count Pill, where it read as part of the title and said one
                  // fact twice: «0/1 · 1 ще в роботі» is a ratio and then the
                  // same ratio's remainder.
                  action={childIssues.length > 0 ? (
                    <span className="ml-auto shrink-0 text-[11px] font-medium text-muted">
                      Готово: {childIssuesDone}/{childIssues.length}
                    </span>
                  ) : null}
                  className="pt-2"
                >
                  {childIssues.length > 0 && (
                    <div className="mb-1 h-[4px] overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-success-solid transition-all"
                        style={{ width: `${(childIssuesDone / childIssues.length) * 100}%` }}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    {/* Subtasks are real issues, so they get the same shared row the
                        list view uses instead of a lookalike built here. */}
                    {childIssues.map(child => (
                      <TaskRow
                        key={child.id}
                        issue={child}
                        issues={issues}
                        allIssues={issues}
                        issueLinks={links}
                        members={members}
                        labels={availableLabels}
                        sprints={sprints}
                        projectId={child.projectId || projectId}
                        projectName={project?.name}
                        isTimerActive={activeTimer?.issueId === child.id}
                      />
                    ))}
                    {showSubInput && (
                      <Surface preset="compact-bordered-card" padding="md" className="mt-2 flex flex-col gap-3">
                        <Input
                          autoFocus
                          size="md"
                          value={subtaskText}
                          onChange={event => setSubtaskText(event.target.value)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') handleAddSubtask();
                            if (event.key === 'Escape') {
                              setShowSubInput(false);
                              setSubtaskText('');
                            }
                          }}
                          placeholder="Назва дочірнього інциденту"
                        />
                        <p className="text-[10px] leading-relaxed text-muted">
                          Дочірній інцидент отримає власний ключ, статус, виконавців, час і аналітику.
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button style="secondary" size="sm" onClick={() => { setShowSubInput(false); setSubtaskText(''); }}>Скасувати</Button>
                          <Button
                            style="primary"
                            size="sm"
                            disabled={!subtaskText.trim() || creatingSubtask}
                            loading={creatingSubtask}
                            onClick={handleAddSubtask}
                          >
                            Створити дочірній інцидент
                          </Button>
                        </div>
                      </Surface>
                    )}
                  </div>
                </DetailSection>
              )}

              {/* LEGACY CHECKLIST — new lightweight steps live in description Markdown */}
              {!clientViewer && checklistAll > 0 && (
              <DetailSection
                density="group"
                icon={CheckSquare}
                title="Старий чекліст"
                meta={`${checklistDone}/${checklistAll}`}
                className="pt-2"
                action={!isArchived && canEditIssue ? (
                  <Button
                    style="ghost"
                    size="sm"
                    onClick={handleMoveLegacyChecklistToDescription}
                    loading={migratingChecklist}
                    disabled={migratingChecklist}
                    className="ml-auto"
                  >
                    Перенести в опис
                  </Button>
                ) : null}
              >
              <p className="text-[10px] leading-relaxed text-muted">
                Це старий формат. Нові чеклісти додавайте як checkbox в описі інциденту.
              </p>
              <div className="h-[4px] bg-line rounded-full mb-1 overflow-hidden">
                <div className="h-full bg-success-solid rounded-full transition-all" style={{ width: `${(checklistDone / checklistAll) * 100}%` }} />
              </div>
              <div className="flex flex-col gap-[6px]">
                 {(issue.subtasks || []).map((s, i) => (
                  <div
                    key={s.id || i}
                    data-ui-surface="nested-card"
                    data-ui-padding="row"
                    className="ui-surface flex items-center gap-3 border border-line"
                  >
                    {s.done
                      ? <CheckSquare size={16} className="shrink-0 text-success" />
                      : <Square size={16} className="shrink-0 text-faint" />}
                    <span className={`text-[13px] font-medium ${s.done ? 'line-through text-faint' : 'text-ink'}`}>
                      {s.title}
                    </span>
                  </div>
                ))}
              </div>
              </DetailSection>
              )}
              {/* ISSUE LINKS */}
              {!clientViewer && (currentIssueLinks.length > 0 || showLinkInput) && (
              <DetailSection density="group" icon={Link2} title="Зв’язки" count={currentIssueLinks.length} className="pt-2">
              <div className="flex flex-col gap-[6px]">
                {currentIssueLinks.map(({ link, perspective }) => {
                    const otherIssue = issues.find(candidate => candidate.id === perspective.otherIssueId)
                      || perspective.otherIssue;
                    const otherProjectId = otherIssue?.projectId || projectId;
                    const otherProject = projects?.find(candidate => candidate.id === otherProjectId);
                    const otherKey = otherIssue?.issueKey || perspective.otherIssueId;
                    const otherTitle = otherIssue?.title || 'Пов’язаний інцидент';
                    const requiresReview = link.requiresReview || link.legacyRelationType === 'subtask-of';

                    return (
                      <IssueLinkRow
                        key={link.id}
                        label={perspective.label}
                        requiresReview={requiresReview}
                        canRemove={!isArchived && canEditIssue}
                        onRemove={async () => {
                          try {
                            await removeLink(link.id);
                            showToast('Звʼязок видалено');
                          } catch (err) {
                            showToast('Помилка видалення: ' + err.message, 'error');
                          }
                        }}
                      >
                        <Link
                          href={issuePath(otherIssue || { id: perspective.otherIssueId }, otherProject || otherProjectId)}
                          // `IssueLinkRow` fills and rings under the pointer,
                          // so the title needs no line of its own.
                          className="text-[13px] font-semibold text-ink truncate"
                        >
                          <span className="text-muted font-medium mr-1 uppercase">{otherKey}</span>
                          {otherTitle}
                        </Link>
                      </IssueLinkRow>
                    );
                  })}

                {showLinkInput && (
                  <div data-ui-surface="compact-bordered-card" data-ui-padding="md" className="ui-surface mt-2 flex flex-col gap-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                        <Select
                          ariaLabel="Тип зв’язку"
                          value={linkRelation}
                          onChange={setLinkRelation}
                          className="w-full"
                          dropdownClassName="w-full max-w-none"
                          options={ISSUE_LINK_OPTIONS}
                        />
                        <Select
                          ariaLabel="Пов’язаний інцидент"
                          value={linkTargetId}
                          onChange={setLinkTargetId}
                          className="w-full"
                          dropdownClassName="w-full max-w-none"
                          disabled={availableLinkIssues.length === 0}
                          placeholder="Немає доступних інцидентів у проєкті"
                          options={availableLinkIssues
                            .map(item => ({
                              value: item.id,
                              label: `${item.issueKey} — ${item.title}`,
                            }))}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button style="secondary" size="sm" onClick={() => { setShowLinkInput(false); }}>Скасувати</Button>
                      <Button
                        style="primary"
                        size="sm"
                        disabled={!linkTargetId || linkSaving}
                        loading={linkSaving}
                        onClick={async () => {
                          if (!linkTargetId || linkSaving) return;
                          try {
                            setLinkSaving(true);
                            await addLink(issueId, linkTargetId, linkRelation, currentUser?.uid || currentUser?.id);
                            showToast('Звʼязок додано');
                            setShowLinkInput(false);
                            setLinkTargetId('');
                          } catch (err) {
                            showToast('Помилка: ' + err.message, 'error');
                          } finally {
                            setLinkSaving(false);
                          }
                        }}
                      >Додати зв’язок</Button>
                    </div>
                  </div>
                )}
              </div>
            </DetailSection>
            )}
                  </div>
                  )}
                </div>
                {!isArchived && canEditIssue && (
                  <div className="relative flex flex-wrap items-center gap-1.5">
                    <ContextMenu
                      trigger={(
                        <Button
                          aria-label="Додати мітку"
                          style="secondary"
                          size="sm"
                          composition="inline-add-action"
                          icon={Plus}
                          disabled={availableLabels.length === 0}
                          title={availableLabels.length === 0 ? 'Немає доступних міток' : undefined}
                        >
                          <span className="sm:hidden">Мітка</span><span className="hidden sm:inline">Додати мітку</span>
                        </Button>
                      )}
                      dropdownClassName="w-[220px]"
                      closeOnSelect={false}
                      items={availableLabels.map(label => {
                        const active = (issue.labelIds || []).includes(label.id);
                        return {
                          label: label.label || label.name,
                          icon: TagIcon,
                          color: active ? label.color : undefined,
                          selected: active,
                          onClick: () => {
                            const current = issue.labelIds || [];
                            update({ labelIds: active ? current.filter(id => id !== label.id) : [...current, label.id] });
                          },
                        };
                      })}
                    />
                    {!parentIssueId && <Button
                      aria-label="Додати дочірній інцидент"
                      style="secondary"
                      size="sm"
                      composition="inline-add-action"
                      icon={Plus}
                      onClick={() => setShowSubInput(value => !value)}
                    >
                      <span className="sm:hidden">Дочірній</span><span className="hidden sm:inline">Додати дочірній інцидент</span>
                    </Button>}
                    <Button
                      aria-label="Додати зв’язок"
                      style="secondary"
                      size="sm"
                      composition="inline-add-action"
                      icon={Plus}
                      onClick={() => {
                        setShowLinkInput(value => !value);
                        setLinkTargetId(availableLinkIssues[0]?.id || '');
                      }}
                    >
                      <span className="sm:hidden">Зв’язок</span><span className="hidden sm:inline">Додати зв’язок</span>
                    </Button>
                  </div>
                )}
            </DetailSection>
      </DetailLayout>
    </>
  );
}
