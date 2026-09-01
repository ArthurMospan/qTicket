'use client';
// src/app/workspace/[projectId]/issue/[issueId]/page.js
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAppContext }        from '@/lib/context/AppContext';
import { useIssues }           from '@/lib/hooks/useIssues';
import { useOrganization }     from '@/lib/hooks/useOrganization';
import { hasProjectAccess, hasRecordedTeam, isOnProjectTeam } from '@/lib/utils/projectAccess.mjs';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { useWorkflowConfig }   from '@/lib/hooks/useWorkflowConfig';
import { resolveCategoryStatusId } from '@/lib/utils/statusCategories.mjs';
import { ISSUE_LINK_OPTIONS, issueLinkPerspective, useIssueLinks } from '@/lib/hooks/useIssueLinks';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import MarkdownEditor from '@/components/ui/Forms/MarkdownEditor';
import MarkdownViewer, { setTaskChecked } from '@/components/ui/DataDisplay/MarkdownViewer';
import AttachmentViewer from '@/components/ui/AttachmentViewer';
import Tag from '@/components/ui/DataDisplay/Tag';
import UnifiedTimeline from '@/components/workspace/UnifiedTimeline';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import AttachmentRow from '@/components/ui/TaskManagement/AttachmentRow';
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
import { incidentTerms } from '@/lib/content/incidentTerms.mjs';
import { isArchivedIssue, withoutArchivedIssues } from '@/lib/utils/issueArchive.mjs';
import { isCancelledIssue, withoutCancelledIssues } from '@/lib/utils/issueCancel.mjs';
import { setIssueArchived, setIssueCancelled } from '@/lib/services/issues';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { MultiSelect, Select } from '@/components/ui/Select';
import { Alert, AttributeTrigger, ContextMenu, DetailLayout, DetailSection, getTaskAttributeChrome, IconAction, Pill, Popover, Surface, TaskAttributesPanel, Tabs, Tooltip, useConfirm } from '@/components/ui';
import QuickTeamTransferDialog from '@/components/workspace/QuickTeamTransferDialog';
import { useQuickTeamTransfer } from '@/lib/hooks/useQuickTeamTransfer';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import useWorkspaceStore       from '@/store/useWorkspaceStore';
import { sendNotification }    from '@/lib/hooks/useNotifications';
import {
  AlignLeft, Heart, Clock, History, PanelRightClose, PanelRightOpen, X, Plus, Search, Settings2, Share2, Send, MoreHorizontal, Pencil, Check, Trash2, Paperclip, ChevronRight, Minus, Eye, EyeOff, ExternalLink,
  Play, Square as StopIcon,
  Link2, Copy, CopyPlus, MessageCircle, Sparkles, Tag as TagIcon, Archive, ArchiveRestore,
  Maximize2, User, Users, CircleDot, Ban, Undo2,
} from 'lucide-react';
import { ParentTaskIcon, TaskIcon } from '@/lib/design/icons';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, deleteDoc, arrayRemove, arrayUnion } from 'firebase/firestore';
import { uploadFile } from '@/lib/utils/uploadFile';
import { deleteFileFromCloudinary } from '@/lib/services/fileUpload';
import { downloadMaterial } from '@/lib/utils/downloadMaterial';
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
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';

// ── Constants ──────────────────────────────────────────────────────

// Statuses are now loaded dynamically via useWorkflowConfig.

const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || '';

// Two inherited task-manager surfaces stay dormant, and they are two constants
// because they are two decisions. One constant used to hold both of them *and*
// the links between requests, which is how a supported qTicket feature came to
// be switched off by a decision that was never about it: nobody flipping
// «hierarchy stays gone» to `false` meant to say «and no support agent may ever
// mark a duplicate».
//
// The hierarchy — «Основне звернення», «Дочірні звернення», and the parent
// picker and «Додати дочірнє звернення» that create them. It does not come
// back: splitting a customer's request into child records means the customer
// watches one record while the work happens in another.
const SHOW_INHERITED_TASK_HIERARCHY = false;

// Duplicating a record and copying an AI prompt about it. Neither is hierarchy
// and neither is a link — they arrived with the inherited task screen and no
// support workflow has asked for them — so they wait under their own name
// instead of borrowing somebody else's.
const SHOW_INHERITED_TASK_SHORTCUTS = false;

// Links between requests («Звʼязки») are deliberately absent from the two lists
// above. They are a qTicket feature and they ship: a duplicate is the single
// most common relation on a support desk, and until now the product had no way
// to record one. So their gate is who is looking rather than a constant —
// `internalViewer` fetches them, `!clientViewer` draws them, `canEditIssue`
// changes them — and a customer sees no section, no count and no control.

// The same wording Settings uses when you walk away from an unsaved field.
const UNSAVED_EDIT_PROMPT = {
  title: 'Незбережені зміни',
  message: 'У вас є незбережені зміни у зверненні. Ви впевнені, що хочете піти без збереження?',
  confirmText: 'Піти',
  cancelText: 'Повернутись',
  danger: true,
};

// ── Helpers ────────────────────────────────────────────────────────

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

// `copiedMessage` rather than a literal: every string about the record comes
// out of `incidentTerms`, so this helper cannot grow a second name for it.
async function copyIssueUrl(path, showToast, copiedMessage) {
  const issueUrl = `${window.location.origin}${path}`;
  try {
    await navigator.clipboard.writeText(issueUrl);
    showToast(copiedMessage);
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
  // The cell opposite «Підтримка», named from the chair it is read in.
  //
  // «Від клієнта» is what the desk calls that side and it is the right word
  // there. It was drawn for the customer too — so a person who opened an
  // account to write to their supplier was told, on their own request, above
  // their own colleagues, that they are the клієнт. The rule this product does
  // keep is that the *record* has one name for everybody; a label that names
  // one of two sides has to name it from somewhere, and there is no word that
  // is «them» from both chairs. One expression, three call sites — the strip,
  // its narrow variant, and the mobile sheet.
  const clientSideLabel = clientViewer ? 'Ваша команда' : 'Від клієнта';
  const clientSideAriaLabel = clientViewer
    ? 'Відповідальні з вашого боку'
    : 'Відповідальні з боку клієнта';
  // This screen is shared: support works a «звернення» here and the client
  // whose portal is «Мої звернення» reads about the same one. Every string
  // about the record itself comes from here, so the screen cannot grow a
  // second name for it.
  const terms = incidentTerms();
  const canEditIssue = can(orgRole, 'edit:issue');
  // What the request itself says, as opposed to how the desk is handling it:
  // the subject, the description, the attachments, the type, the priority, the
  // labels, the links, and who on the customer's side is answering. Both sides
  // of the desk hold it — a customer who cannot correct a typo in the request
  // they just filed is not being protected from anything.
  //
  // `canEditIssue` above keeps everything that is the desk's own: the status,
  // support's assignees, the resolution date, the archive and cancel stamps,
  // hierarchy and deletion. The split is the whole difference between the two
  // copies of this screen.
  const canEditContent = canWhileRoleLoads(orgRole, 'edit:issue_content');
  // Where «назад» goes from this screen: the space this request is in, for
  // both sides of the desk. It used to be `/` for a client, from when their
  // portal was a screen of its own and `/{projectId}` was the staff board that
  // would have bounced them — and that has not been true since the two became
  // one screen. `/` is now the door rather than the room, so every way out of a
  // request went through a redirect; a client whose space is archived went
  // through it to «простір ще не налаштовано», because the door picks the first
  // active space rather than the one they were reading.
  const backHref = `/${projectId}`;
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

  const teamUids = Array.isArray(project?.team) ? project.team : [];
  // Resolve author/assignee names from ALL organization members, not just the
  // project team. Scoping this to `project.team` was the "Автор: Невідомо" /
  // blank-assignee bug: anyone off the team (e.g. the creator of a task in a
  // project they aren't a team member of) was unresolvable and rendered empty.
  const { members } = useOrganization();

  // Кого можна покликати в цьому зверненні.
  //
  // `members` вище — це вся організація, і для розвʼязування імен так і треба.
  // Але пікер згадок — не довідник імен, а пропозиція: «покликати цю людину
  // сюди». Він працював з того самого списку, тож у зверненні одного клієнта
  // можна було тегнути людину, якої в цьому просторі немає, — для неї це звернення просто
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
    ...(Array.isArray(issue?.assigneeIds) ? issue?.assigneeIds : []),
    ...(Array.isArray(issue?.watcherIds) ? issue?.watcherIds : []),
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
  // The transfer overlay, and the answer it comes back with. The stored
  // document is the truth on the next open; this is what redraws the menu now.
  // Both are staff-only: the customer reads the incident, and where their
  // supplier tracks the work is not part of it.
  const [showQuickTeamTransfer, setShowQuickTeamTransfer] = useState(false);
  const [quickTeamTask, setQuickTeamTask] = useState(null);
  const storedQuickTeamTask = useQuickTeamTransfer(internalViewer ? issueId : null);
  const transferredTask = quickTeamTask || storedQuickTeamTask || null;
  const isIssueArchived = isArchivedIssue(issue);
  const isIssueCancelled = isCancelledIssue(issue);
  const isArchived = project?.status === 'archived' || isIssueArchived || isIssueCancelled;

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
  // navigation of this screen. The first tab is named by `terms.record` rather
  // than by a literal, because the strip is this screen's whole navigation and
  // its first word is the first word anybody reads here.
  const compactTaskTab = taskPane;
  const handleCompactTabChange = (id) => {
    handleTaskPaneChange(id);
  };
  const handleTaskChatUnreadChange = (count) => {
    setTaskChatUnreadState(current => (
      current.issueId === issueId && current.count === count
        ? current
        : { issueId, count }
    ));
  };

  const {
    links = [],
    refresh: refreshLinks,
    addLink,
    removeLink,
  } = useIssueLinks(issueId);

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
  const [parentSaving, setParentSaving] = useState(false);
  const [viewerMat,    setViewerMat]    = useState(null); // lightbox
  const [uploadingAttach, setUploadingAttach] = useState(false);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  // Which layout is on screen, resolved in JS: the metadata line folds only on
  // a phone, and a media query cannot tell a component to render less.
  const isMobile = useIsMobile();

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
      showToast('Додано до команди підтримки клієнта');
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося додати до команди підтримки клієнта'), 'error');
    }
  };
  // Deactivated colleagues stay in `members` so their name and face still
  // render on everything they did; they are simply not people you can hand new
  // work to, here or in any other picker.
  const supportDirectory = activeMembers(members).filter(member => !isClientRole(member.role));
  // Who the customer is told is answering, named from the directory they are
  // allowed to read — which is the people on their own space's team.
  //
  // Built from the assignees rather than from the directory, because the two
  // are not the same set: an owner or an admin reaches every space without
  // being listed on one, so they can hold a request the customer's copy of the
  // directory does not name. A cell that answered «Ще не призначено» over
  // somebody's work would be telling them the opposite of the truth, so an
  // assignee this reader cannot name is still an assignee, under the only word
  // that is certainly true about them.
  const supportAssigneeOptions = (issue?.assigneeIds || []).map(uid => {
    const member = supportDirectory.find(candidate => (candidate.id || candidate.uid) === uid);
    return member
      ? {
        value: uid,
        label: member.name || member.displayName || member.email || 'Спеціаліст підтримки',
        user: member,
      }
      : { value: uid, label: 'Спеціаліст підтримки' };
  });
  // The customer's own people on this space. `assigneeIds` is support's routing
  // and a client never sees it; this is the mirror that belongs to them —
  // whichever of their colleagues is answering for this request. Support reads
  // it because "who do we talk to over there" is the most useful thing about a
  // queue of somebody else's problems, and may correct it; the customer owns it.
  const clientDirectory = activeMembers(members).filter(member => (
    isClientRole(member.role) && isOnProjectTeam(project, member.id || member.uid)
  ));
  const clientAssigneeIds = Array.isArray(issue?.clientAssigneeIds) ? issue?.clientAssigneeIds : [];
  const clientAssignees = clientAssigneeIds
    .map(uid => members.find(member => (member.id || member.uid) === uid))
    .filter(Boolean);
  const canEditClientAssignees = !isArchived && canEditContent;
  const assignableMembers = assignableIds.size === 0
    // A project with no team recorded at all is legacy data, not a project
    // nobody may be assigned to.
    ? supportDirectory
    : supportDirectory.filter(member => assignableIds.has(member.id || member.uid));

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
      showToast(terms.markedUnread);
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

  const copyIssueLink = () => copyIssueUrl(canonicalIssuePath, showToast, terms.linkCopied);

  const copyAiPrompt = async () => {
    if (!issue) return;
    const taskUrl = `${window.location.origin}${canonicalIssuePath}`;
    const prompt = buildTaskAiPrompt({
      issue,
      projectName: project?.name || '',
      statusName: (() => {
        const item = STATUSES.find(
          option => option.id === (issue?.status || issue?.columnId),
        );
        return item?.label || item?.name || '';
      })(),
      priorityName: (() => {
        const item = PRIORITIES.find(option => option.id === issue?.priority);
        return item?.label || item?.name || '';
      })(),
      typeName: (() => {
        const item = TYPES.find(option => option.id === issue?.type);
        return item?.label || item?.name || '';
      })(),
      assigneeNames: (issue?.assigneeIds || [])
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
  // The trail is where you came from, and the two readers came from different
  // places. Support walked «Клієнти» → this client → this incident. A client
  // has exactly one space and cannot open either of those routes, so their
  // trail was two crumbs that bounced them back to the portal, the first of
  // them labelled with somebody else's word for their own company.
  useEffect(() => {
    if (isModal) return;
    const leaf = {
      label: issue?.issueKey || '...',
      href: null,
      onClick: () => copyIssueUrl(canonicalIssuePath, showToast, terms.linkCopied),
      title: terms.copyLink,
    };
    useWorkspaceStore.setState({
      breadcrumbs: clientViewer
        ? [{ label: 'Мої звернення', href: backHref }, leaf]
        : [
          { label: 'Проєкти', href: '/clients' },
          { label: project?.name || '...', href: `/${projectId}` },
          leaf,
        ]
    });
    return () => useWorkspaceStore.setState({ breadcrumbs: [] });
  }, [backHref, canonicalIssuePath, clientViewer, project?.name, issue?.issueKey, projectId, isModal, showToast, terms.copyLink, terms.linkCopied]);

  // Whether the open draft says anything the task does not. Everything that can
  // be edited in place (status, sprint, labels…) writes straight through, so the
  // draft is exactly the six fields `enterEdit` copies.
  const draftIsDirty = Boolean(isEditing && issue && (
    (draft.title ?? '') !== (issue?.title ?? '')
    || (draft.type || '') !== (issue?.type || '')
    || (draft.priority || '') !== (issue?.priority || '')
    || (draft.description || '') !== (issue?.description || '')
    || (draft.dueDate || '') !== toLocalDateInput(parseDueDate(issue?.dueDate, { timeZone }), { timeZone })
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
      router.push(backHref);
    };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [router, backHref, isEditing, showLinkInput, showSubInput, draftIsDirty, confirmDialog]);

  // Everything above this point runs while `issue` is still `undefined`, and
  // that is not a rare case — it is every first paint. `issues.find(...)` has
  // nothing to find until the Firestore stream arrives, so on a page load or a
  // refresh of a request's own URL this component renders once with no request
  // at all.
  //
  // The guard cannot move up to meet that: hooks run between here and there,
  // and React requires them unconditionally. So the reads above are optional,
  // every one of them. They were not, and `supportAssigneeOptions` — two
  // hundred lines before this line — did `(issue.assigneeIds || []).map(...)`,
  // which threw `TypeError: can't access property "assigneeIds"` on every
  // refresh and put the whole workspace behind «qTicket не завантажився».
  // That is the error the owner had been reporting since 2026-08-31; the
  // console from production named this property exactly.
  if (!issue) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        {issuesLoading ? (
          <div className="w-7 h-7 border-[3px] border-line border-t-ink rounded-full animate-spin" />
        ) : issuesError ? (
          <div className="max-w-[360px] px-6 text-center">
            <p className="text-[16px] font-bold text-ink mb-2">
              {issueAccessFailure ? terms.accessDeniedTitle : terms.loadFailedTitle}
            </p>
            <p className={`text-[13px] text-muted ${issueAccessFailure ? '' : 'mb-4'}`}>
              {issueAccessFailure
                ? terms.accessDeniedText
                : 'Дані не видалені. Сервіс бази тимчасово недоступний.'}
            </p>
            {!issueAccessFailure && (
              <TextAction size="lg" onClick={() => window.location.reload()}>Спробувати ще раз</TextAction>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-[16px] font-bold text-ink mb-2">{terms.notFound}</p>
            {/* Back to the space the request is in — the same screen both
                sides of the desk read it from. */}
            <Link href={backHref} className="text-[13px] text-ink hover:underline">← Повернутись</Link>
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
    label: 'Застарілий тип',
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
  // The customer's half of the same strip. Their cells carry facts, not
  // controls, so they take the width of their own words instead of stretching
  // to fill a grid column, and they stop claiming to be clickable.
  const { attributeItemClass: readOnlyItemClass } = getTaskAttributeChrome({
    condensed: isHeaderScrolled,
    readOnly: true,
  });

  const assignees     = (issue.assigneeIds || []).map(uid => members.find(m => (m.id || m.uid) === uid)).filter(Boolean);
  const reporterMatchByEmail = issue.reporterName ? members.find(m => m.email && m.email.toLowerCase() === issue.reporterName.toLowerCase()) : null;
  const reporterMember = members.find(m => (m.id || m.uid) === issue.reporterId) || reporterMatchByEmail || null;
  const reporter = reporterMember || { name: issue.reporterName || 'Зовнішній автор' };
  const isExternalReporter = !reporterMember;
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
    || (SHOW_INHERITED_TASK_HIERARCHY && (childIssues.length > 0 || showSubInput))
    || (currentIssueLinks.length > 0 || showLinkInput);
  const hasPanelBody = !isEditing || visibleAttachments.length > 0 || hasSecondaryBlocks;

  const actor          = { userId: currentUser?.id || currentUser?.uid, userName: currentUser?.name };

  // ── Edit mode helpers ─────────────────────────────────────────────
  const enterEdit = () => {
    setDraft({
      title:           issue.title,
      type:            issue.type     || 'task',
      priority:        issue.priority || NO_PRIORITY_ID,
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
        // Named, not counted. `useIssues.moveIssue` has always said which
        // requests are in the way; this screen said «2» and left the agent to
        // find them. That was survivable while nothing could create a blocking
        // link — the only ones left were imported — and stops being survivable
        // the moment «Блокує» is back in the picker.
        const names = blockers.dependencies
          .slice(0, 2)
          .map(blocker => blocker.issueKey || blocker.title)
          .filter(Boolean)
          .join(', ');
        showToast(`Звернення ще блокують: ${names || blockers.dependencies.length}`, 'error');
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

  const handleParentChange = async nextParentIssueId => {
    if (parentSaving) return;
    if (nextParentIssueId && childIssues.length > 0) {
      showToast('Звернення з дочірніми не можна зробити дочірнім', 'error');
      return;
    }
    try {
      setParentSaving(true);
      await setIssueParent(issueId, nextParentIssueId || null);
      showToast(nextParentIssueId ? 'Основне звернення змінено' : 'Звернення стало самостійним');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити основне звернення', 'error');
    } finally {
      setParentSaving(false);
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
      message: `${target?.name || 'Файл'} буде видалено зі звернення і зі сховища. Це не можна скасувати.`,
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
      showToast('Дочірнє звернення не може мати власні дочірні', 'error');
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
      showToast('Спершу додайте активний тип звернення в налаштуваннях', 'error');
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
      }, actor);
      setSubtaskText('');
      setShowSubInput(false);
      showToast(`${created.issueKey || 'Дочірнє звернення'} створено`);
    } catch (error) {
      showToast(error.message || 'Не вдалося створити дочірнє звернення', 'error');
    } finally {
      setCreatingSubtask(false);
    }
  };

  const handleDuplicate = async () => {
    if (!issue || isArchived) return;
    try {
      const duplicateStatus = issue.columnId || issue.status || resolveCategoryStatusId('backlog', STATUSES, {
        hiddenStatusIds: activeHiddenCols,
      }) || 'backlog';
      const created = await createIssue({
        title: `${issue.title || 'Звернення'} (копія)`,
        description: issue.description || '',
        type: issue.type || 'task',
        priority: issue.priority || NO_PRIORITY_ID,
        status: duplicateStatus,
        columnId: duplicateStatus,
        assigneeIds: Array.isArray(issue.assigneeIds) ? issue.assigneeIds : [],
        labelIds: Array.isArray(issue.labelIds) ? issue.labelIds : [],
        dueDate: parseDueDate(issue.dueDate, { timeZone })?.toISOString() || null,
        parentIssueId: existingParentIssueId(issue),
      }, actor);
      showToast('Копію звернення створено');
      if (isModal && onClose) onClose();
      navigateAfterOverlayClose(() => router.push(issuePath(created, project || projectId)));
    } catch (error) {
      showToast(error.message || 'Не вдалося дублювати звернення', 'error');
    }
  };

  const handleArchive = async (archived) => {
    if (archived && !(await confirmDialog({
      title: `Архівувати ${issue.issueKey}?`,
      message: 'Звернення зникне з активної черги, але вся його історія, чат і файли залишаться в «Архіві». Повернути його можна будь-коли.',
      confirmText: 'Архівувати',
    }))) return;
    try {
      await setIssueArchived(issueId, archived);
      showToast(archived ? 'Звернення в архіві' : 'Звернення повернуто з архіву');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити стан архіву', 'error');
    }
  };

  const handleCancel = async (cancelled) => {
    if (cancelled && !(await confirmDialog({
      title: `Скасувати ${issue.issueKey}?`,
      message: 'Скасоване звернення зникає з активної черги й не рахується як вирішене. Його історія зберігається в «Архіві» → «Скасовані», а повернути його можна будь-коли.',
      confirmText: 'Так, скасувати',
      // The dismiss button is «Скасувати» everywhere else, and here that is the
      // name of the action itself — two buttons side by side, one meaning "do
      // it" and one meaning "don't". This is the only dialog where the word
      // has to be taken away from the one that closes it.
      cancelText: 'Ні, лишити',
    }))) return;
    try {
      await setIssueCancelled(issueId, cancelled);
      showToast(cancelled ? 'Звернення скасовано' : 'Звернення повернуто');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити стан скасування', 'error');
    }
  };

  const handleDelete = async () => {
    if (!(await confirmDialog({
      title: `Видалити ${issue.issueKey}?`,
      message: childIssues.length > 0
        ? `Звернення буде прибрано з ${childIssues.length} дочірніми зверненнями в ієрархії. Одразу після видалення дію можна скасувати.`
        : 'Звернення буде прибрано. Одразу після видалення дію можна скасувати.',
      confirmText: 'Видалити', danger: true,
    }))) return;
    try {
      const deletion = await deleteIssue(issueId, childIssues.length > 0 ? { childPolicy: 'promote' } : undefined);
      router.push(`/${projectId}`);
      showToast('Звернення видалено', 'success', {
        duration: 30000,
        action: {
          label: 'Скасувати',
          onClick: () => {
            void restoreIssue(issueId, deletion.organizationId).then(() => {
              showToast('Звернення відновлено');
              router.push(canonicalIssuePath);
            }).catch(error => {
              showToast(error.message || 'Не вдалося відновити звернення', 'error');
            });
          },
        },
      });
    } catch (error) {
      showToast(error.message || 'Не вдалося видалити звернення', 'error');
    }
  };

  // Built once and placed by the description block below — inside the canvas
  // panel when there is a description, in its own panel otherwise (and while
  // editing, where the per-row "Вставити в опис" action lives).
  const attachmentRows = (
    <AttachmentRows
      attachments={visibleAttachments}
      isEditing={isEditing}
      isArchived={isArchived || !canEditContent}
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
          {!isArchived && canEditContent && <Button style="secondary" size="icon-lg" icon={Pencil} onClick={enterEdit} aria-label="Редагувати звернення" title="Редагувати звернення" />}
          <ContextMenu
            trigger={(
              <Button
                style="secondary"
                size="icon-lg"
                icon={MoreHorizontal}
                aria-label={terms.options}
                title="Опції"
              />
            )}
            dropdownClassName="w-[210px]"
            items={[
              { label: 'Копіювати посилання', icon: Copy, onClick: copyIssueLink },
              ...(SHOW_INHERITED_TASK_SHORTCUTS && !isArchived && canEditIssue
                ? [{ label: 'Дублювати', icon: CopyPlus, onClick: handleDuplicate }]
                : []),
              ...(SHOW_INHERITED_TASK_SHORTCUTS && canEditIssue
                ? [{ label: 'Скопіювати AI-промпт', icon: Sparkles, onClick: copyAiPrompt }]
                : []),
              // Only offered when there is somebody else's activity to un-see.
              // Marking a task you were the last to touch as unread would light
              // no dot: your own change is never new to you, on a card or here.
              ...(issueActivityAt && lastActivityActorId !== currentUserId
                ? [{ label: 'Позначити непрочитаним', icon: CircleDot, onClick: handleMarkUnread }]
                : []),
              ...(!isArchived ? [
                // «Стежити» writes `watcherIds` on the incident, which is a
                // support-side field: the rule that authorizes it is the
                // internal-contributor one, so for a client this row was a
                // button that could only ever end in a raw permission error.
                // Hidden rather than widened, and this is the deliberate half:
                // a customer has one client space, every incident of it is
                // already listed in «Мої звернення», and they are a participant
                // of their own incidents — so notifications already reach them,
                // and the portal has no «стежу» surface for the answer to show
                // up in. The gate mirrors the rule exactly: `internalViewer` is
                // owner/admin/member, which is `isInternalContributor`.
                ...(internalViewer ? [{
                  label: isWatching ? 'Не стежити' : 'Стежити',
                  icon: isWatching ? EyeOff : Eye,
                  onClick: toggleWatch,
                }] : []),
                // Two different things, and they finally read as two: putting a
                // task aside for good, and deleting it with a clock running.
                // Moving the work is not moving the request: it stays here,
                // open, and the customer keeps writing in it. Once it has been
                // transferred the row stops offering to do it again and starts
                // pointing at what was made — pressing it twice would return
                // the same task anyway, and a menu that hides that is a menu
                // that invites the second press.
                ...(internalViewer && canWhileRoleLoads(orgRole, 'edit:issue')
                  ? [transferredTask?.url
                    ? {
                      label: 'Відкрити завдання в QuickTeam',
                      icon: ExternalLink,
                      onClick: () => window.open(transferredTask.url, '_blank', 'noopener,noreferrer'),
                    }
                    : {
                      label: 'Створити завдання в QuickTeam',
                      icon: ExternalLink,
                      onClick: () => setShowQuickTeamTransfer(true),
                    }]
                  : []),
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
                ? [{ label: 'Повернути звернення', icon: Undo2, onClick: () => handleCancel(false) }]
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
          // at step two of a sequence"; these are two views of one record.
          <div className="page-gutter shrink-0 overflow-x-auto hide-scrollbar bg-white pb-1 pt-2 lg:hidden">
            <Tabs
              composition="pane-switch"
              tabs={[
                { id: 'task', label: terms.record, icon: TaskIcon },
                { id: 'chat', label: 'Чат', icon: MessageCircle, count: unreadTaskChatCount },
              ]}
              activeTab={compactTaskTab}
              onTabChange={handleCompactTabChange}
            />
          </div>
        ) : null}
        header={(
             <div className="flex w-full flex-col gap-[10px] pb-[12px] pt-[12px] sm:flex-row sm:items-start sm:justify-between sm:gap-[16px]">
               <div className="flex flex-col gap-[4px] flex-1 min-w-0">
            {SHOW_INHERITED_TASK_HIERARCHY && !clientViewer && parentIssueId && (
              <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted">
                {/* The same arrow the board card and the list row draw for this
                    relation. This line used to be `Layers`, so the one fact
                    "this hangs under that" had two glyphs depending on which
                    screen you happened to be reading it on. */}
                <ParentTaskIcon size={12} strokeWidth={2} className="shrink-0" />
                <span className="shrink-0">Дочірнє звернення для</span>
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
                  {parentIssue?.issueKey || issue?.parentIssueKey || 'Основне звернення'}
                  {parentIssue?.title ? ` — ${parentIssue.title}` : ''}
                </Link>
                {!isArchived && canEditIssue && (
                  <Button
                    style="ghost"
                    size="icon-xs"
                    icon={X}
                    onClick={() => handleParentChange(null)}
                    disabled={parentSaving}
                    aria-label="Відв’язати від основного звернення"
                    title="Зробити самостійним зверненням"
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
                  <TitleInput autoFocus value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Назва звернення..." />
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
                <Alert variant="info" title={terms.archivedTitle}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span>{terms.archivedText}</span>
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
                <Alert variant="warning" title={terms.cancelledTitle}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span>{terms.cancelledText}</span>
                    {canWhileRoleLoads(orgRole, 'edit:issue') && (
                      <Button
                        style="primary"
                        size="sm"
                        icon={Undo2}
                        onClick={() => handleCancel(false)}
                      >
                        Повернути звернення
                      </Button>
                    )}
                  </div>
                </Alert>
              </div>
            )}

            {/* An assignee the project does not list. Two shapes of the same
                fact, and the task is where both are visible at once:

                  a member — cannot open the project at all, so the task sits in
                  their «Звернення» pointing at a 404;
                  an owner or an admin — opens it fine, but nothing records that
                  they work here, so the project card draws no face for them.

                The second used to be silent, because the check asked whether
                they had access rather than whether the project named them. */}
            {!clientViewer && assigneesOffProjectRoster.length > 0 && (
              <div className="mt-3">
                <Alert
                  variant="warning"
                  title={assigneesOffProjectRoster.length === 1
                    ? 'Цього працівника немає в команді підтримки клієнта'
                    : 'Цих працівників немає в команді підтримки клієнта'}
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      {assigneesOffProjectRoster.map(member => member.name || member.email).join(', ')} — не в команді підтримки клієнта
                      {project?.name ? ` «${project.name}»` : ''}.
                    </span>
                    {can(orgRole, 'manage:team') && (
                      <Button
                        style="primary"
                        size="sm"
                        icon={Users}
                        onClick={handleGrantProjectAccess}
                      >
                        Додати до підтримки клієнта
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
                {clientViewer ? (
                  /* The same face and name the agent's copy shows, minus the
                     menu behind it. A customer has nothing to do with a profile
                     or a direct chat, so the identity is not a control here —
                     but it was not a face either, and the author line was the
                     one place on their own request where a person appeared as
                     bare text while everybody else on the screen had a picture. */
                  <span className="inline-flex items-center gap-1">
                    <span>Автор:</span>
                    <span className="inline-flex items-center gap-[6px]">
                      <UserAvatar user={reporter} size="xs" />
                      <span className="font-semibold text-ink">{reporter.name}</span>
                    </span>
                  </span>
                ) : isExternalReporter ? (
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
                      <p className="mt-2 text-[11px] leading-relaxed text-faint">
                        Це не учасник організації, тому профіль та особистий чат недоступні.
                      </p>
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
                {!clientViewer && isOverdue && (
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
            /* The five-column grid belongs to the five controls an agent works
               with; it lines them up so the same field sits in the same place on
               every request. A customer has three facts and no controls, so they
               get the wrapping row instead — a fixed grid would only reserve
               columns nothing arrives to fill, which is the whole reason their
               strip read as one status pill adrift in a grey bar. */
            <TaskAttributesPanel
              context={clientViewer ? 'clientTask' : 'task'}
              compact
              condensed={isHeaderScrolled}
              cardClassName="transition-[background-color,padding] duration-200"
              cardStyle={{
                backgroundColor: isHeaderScrolled ? 'rgba(244,244,245,0.36)' : undefined,
                backdropFilter: isHeaderScrolled ? 'blur(4px)' : undefined,
                WebkitBackdropFilter: isHeaderScrolled ? 'blur(4px)' : undefined,
              }}
              primaryChildren={clientViewer ? (
                /* The customer's copy of the same strip: the same cells, in the
                   same order, in the same grid. One of them is a fact rather
                   than a control, and that is the whole of the difference —
                   moving a request through support's workflow is support's
                   work, so «Статус» is read here and set there.

                   Everything else on it is the customer's own: what kind of
                   problem this is, how urgent they judge it, and which of their
                   people is answering — plus, since 2026-09-01, which agent has
                   it, read-only. What stays off the strip is the one thing this
                   product does not promise: the date it is due. */
                <>
                  {/* The same cell the agent has, without the caret. A pill
                      here was a second way of drawing one fact: their strip
                      lined up with the agent's everywhere except the one place
                      the two are supposed to be read side by side. */}
                  <div className={readOnlyItemClass}>
                    <span className={attributeLabelClass}>Статус</span>
                    <Select
                      compact
                      readOnly
                      value={issue.columnId || issue.status || visibleStatuses[0]?.id}
                      options={visibleStatuses.map(status => ({
                        value: status.id,
                        label: status.label,
                        dotColor: status.color,
                      }))}
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  <div className={`max-sm:hidden ${attributeItemClass}`} onClick={e => { if (isArchived || !canEditContent) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Тип</span>
                    <Select
                      compact
                      disabled={isArchived || !canEditContent}
                      value={draft.type || issue.type || ''}
                      onChange={val => {
                        update({ type: val });
                        if (isEditing) setDraft(current => ({ ...current, type: val }));
                      }}
                      options={EDITABLE_TYPES.map(item => ({ value: item.id, label: item.label, icon: item.icon }))}
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  <div className={`max-sm:hidden ${attributeItemClass}`} onClick={e => { if (isArchived || !canEditContent) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Пріоритет</span>
                    <Select
                      compact
                      disabled={isArchived || !canEditContent}
                      value={draft.priority || issue.priority || ''}
                      onChange={val => {
                        update({ priority: val });
                        if (isEditing) setDraft(current => ({ ...current, priority: val }));
                      }}
                      options={prioritySelectOptions(PRIORITIES)}
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  {/* Who is answering, on the supplier's side. It used to be
                      withheld as support's own routing — and the customer reads
                      the name and the face of the agent who replies to them, in
                      the conversation on this very screen. Withholding the cell
                      hid nothing; it only left their strip a column short of
                      the one it is meant to line up with. Read-only, because
                      who takes a request is still the desk's decision. */}
                  {/* Not `max-lg:hidden`. It was, and that is how a customer on
                      a laptop narrower than 1024px lost the answer to «хто цим
                      займається» while the agent looking at the same request
                      kept theirs — the two strips had the same *number* of
                      cells below that width and not the same content, which is
                      the kind of parity that looks fine in the code and fails
                      on the screen. Below `lg` both readers now keep Статус,
                      Тип, Пріоритет and Відповідальні; what folds away on each
                      side is the other column. */}
                  <div className={readOnlyItemClass}>
                    {/* Both cells name a side, and neither names the reader.
                        «Відповідальні» used to mean `assigneeIds` on the agent's
                        strip and `clientAssigneeIds` on the customer's — one
                        word, two fields, so the two of them on a call saying
                        «відповідальні» were talking about different people.
                        The first attempt at fixing that put ROADMAP's
                        «Відповідальні клієнта» on both, which told the customer
                        «the client's responsibles» about themselves. A side is
                        the same side from either chair. */}
                    <span className={attributeLabelClass}>Підтримка</span>
                    <MultiSelect
                      compact
                      readOnly
                      showSelectedAvatars
                      ariaLabel="Відповідальні з боку підтримки"
                      value={issue.assigneeIds || []}
                      options={supportAssigneeOptions}
                      placeholder="Ще не призначено"
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  {/* Their own people. On this side of the desk «відповідальні»
                      without a qualifier means theirs; support's cell above
                      says whose it is. */}
                  <div className={`max-lg:hidden ${attributeItemClass}`} onClick={e => { if (isArchived || !canEditContent) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>{clientSideLabel}</span>
                    <MultiSelect
                      compact
                      showSelectedAvatars
                      ariaLabel={clientSideAriaLabel}
                      disabled={!canEditClientAssignees}
                      value={clientAssigneeIds}
                      onChange={ids => update({ clientAssigneeIds: ids })}
                      options={clientDirectory.map(member => ({
                        value: member.id || member.uid,
                        label: member.name || member.displayName || member.email || 'Учасник',
                        user: member,
                      }))}
                      placeholder="Нікого не призначено"
                      searchPlaceholder="Знайти співробітника…"
                      buttonClassName={compactSelectClass}
                      dropdownClassName="w-[260px]"
                    />
                  </div>

                  {/* Five cells, so the overflow follows the agent's rule:
                      «Деталі» holds what the width cannot. */}
                  <Popover
                    position="bottom"
                    hideCloseIcon
                    className="flex h-full items-center lg:hidden"
                    triggerClassName="flex h-full w-full items-center justify-center"
                    onOpenChange={setShowDetailsDropdown}
                    trigger={(
                      <AttributeTrigger
                        condensed={isHeaderScrolled}
                        active={showDetailsDropdown}
                        className="max-sm:px-0"
                        aria-expanded={showDetailsDropdown}
                        aria-label="Деталі звернення"
                      >
                        <Settings2 size={14} />
                        <span className="max-sm:hidden">Деталі</span>
                      </AttributeTrigger>
                    )}
                  >
                    <div className="flex w-[248px] max-w-full flex-col gap-4">
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Підтримка</span>
                        <MultiSelect
                          readOnly
                          showSelectedAvatars
                          ariaLabel="Відповідальні з боку підтримки"
                          value={issue.assigneeIds || []}
                          options={supportAssigneeOptions}
                          placeholder="Ще не призначено"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:hidden">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Пріоритет</span>
                        <Select
                          disabled={isArchived || !canEditContent}
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
                          disabled={isArchived || !canEditContent}
                          value={draft.type || issue.type || ''}
                          onChange={val => {
                            update({ type: val });
                            if (isEditing) setDraft(current => ({ ...current, type: val }));
                          }}
                          options={EDITABLE_TYPES.map(item => ({ value: item.id, label: item.label, icon: item.icon }))}
                        />
                      </div>
                    </div>
                  </Popover>
                </>
              ) : (
                <>
                  {/* Status */}
                  <div className={attributeItemClass} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Статус</span>
                    <Select compact disabled={isArchived} value={issue.columnId || issue.status || visibleStatuses[0]?.id} onChange={val => handleStatusChange(val)} options={visibleStatuses.map(s => ({ value: s.id, label: s.label, dotColor: s.color }))} buttonClassName={compactSelectClass} />
                  </div>

                  {/* Type and priority. They used to live behind «Деталі», a
                      popover built when this strip had seven inherited fields
                      and room for three. It has five now, and these are the two
                      an agent reads on every request — what kind of problem this
                      is, and how urgent somebody judged it. A control you open a
                      panel to reach is a control you check less often than you
                      should. Below `sm` they fold back into «Деталі», which is
                      the only place the overflow is still real. */}
                  <div className={`max-sm:hidden ${attributeItemClass}`} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Тип</span>
                    <Select
                      compact
                      disabled={isArchived}
                      value={draft.type || issue.type || ''}
                      onChange={val => {
                        update({ type: val });
                        if (isEditing) setDraft(current => ({ ...current, type: val }));
                      }}
                      options={EDITABLE_TYPES.map(item => ({ value: item.id, label: item.label, icon: item.icon }))}
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  <div className={`max-sm:hidden ${attributeItemClass}`} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Пріоритет</span>
                    <Select
                      compact
                      disabled={isArchived}
                      value={draft.priority || issue.priority || ''}
                      onChange={val => {
                        update({ priority: val });
                        if (isEditing) setDraft(current => ({ ...current, priority: val }));
                      }}
                      options={prioritySelectOptions(PRIORITIES)}
                      buttonClassName={compactSelectClass}
                    />
                  </div>

                  {/* Assignees — the task model has always been multi-assignee;
                      the single Select silently hid everyone past the first. */}
                  <div className={attributeItemClass} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>Підтримка</span>
                    <MultiSelect
                      compact
                      showSelectedAvatars
                      ariaLabel="Відповідальні за звернення"
                      disabled={isArchived}
                      value={issue.assigneeIds || []}
                      onChange={setAssignees}
                      options={assignableMembers.map(m => ({ value: m.id || m.uid, label: m.name, user: m }))}
                      placeholder="Не призначено"
                      searchPlaceholder="Знайти працівника підтримки..."
                      buttonClassName={compactSelectClass}
                      dropdownClassName="w-[260px]"
                    />
                  </div>

                  {/* Who is answering on the customer's side. It used to be a
                      section under the description — an attribute of the
                      request, parked below the body text, while the strip that
                      carries every other attribute had a column to spare. It
                      reads far more often than it changes, which is an argument
                      for putting it where the reader already looks, not for
                      putting it last. */}
                  <div className={`max-lg:hidden ${attributeItemClass}`} onClick={e => { if (isArchived) return; if (e.target.tagName === 'SPAN' || e.target === e.currentTarget) e.currentTarget.querySelector('button')?.click(); }}>
                    <span className={attributeLabelClass}>{clientSideLabel}</span>
                    <MultiSelect
                      compact
                      showSelectedAvatars
                      ariaLabel={clientSideAriaLabel}
                      disabled={!canEditClientAssignees}
                      value={clientAssigneeIds}
                      onChange={ids => update({ clientAssigneeIds: ids })}
                      options={clientDirectory.map(member => ({
                        value: member.id || member.uid,
                        label: member.name || member.displayName || member.email || 'Учасник',
                        user: member,
                      }))}
                      placeholder="Нікого не призначено"
                      searchPlaceholder="Знайти співробітника…"
                      buttonClassName={compactSelectClass}
                      dropdownClassName="w-[260px]"
                    />
                  </div>

                  {/* Due date */}
                  <div className={`max-lg:hidden ${attributeItemClass}`}>
                    <span className={attributeLabelClass}>Термін вирішення</span>
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
                      placeholder="Без терміну"
                    />
                  </div>

                  {/* The overflow, and only where there is one. Six cells fit
                      from `lg` up and this button goes away there; between
                      `sm` and `lg` it carries the two that did not fit, and
                      the two that did are hidden inside it rather than shown
                      twice. */}
                  <Popover
                    position="bottom"
                    hideCloseIcon
                    className="flex h-full items-center lg:hidden"
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
                        aria-label="Деталі звернення"
                        title={`Пріоритет: ${PRIORITIES.find(item => item.id === issue.priority)?.label || 'не вказано'} · Тип: ${TYPES.find(item => item.id === issue.type)?.label || 'не вказано'}`}
                      >
                        <Settings2 size={14} />
                        <span className="max-sm:hidden">Деталі</span>
                      </AttributeTrigger>
                    )}
                  >
                      <div className="flex w-[248px] max-w-full flex-col gap-4">
                        <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Термін вирішення</span>
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
                            placeholder="Без терміну"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 sm:hidden">
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
                        <div className="flex flex-col gap-1.5 sm:hidden">
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{clientSideLabel}</span>
                          <MultiSelect
                            showSelectedAvatars
                            ariaLabel={clientSideAriaLabel}
                            disabled={!canEditClientAssignees}
                            value={clientAssigneeIds}
                            onChange={ids => update({ clientAssigneeIds: ids })}
                            options={clientDirectory.map(member => ({
                              value: member.id || member.uid,
                              label: member.name || member.displayName || member.email || 'Учасник',
                              user: member,
                            }))}
                            placeholder="Нікого не призначено"
                            searchPlaceholder="Знайти співробітника…"
                            dropdownClassName="w-[260px]"
                          />
                        </div>
                        {SHOW_INHERITED_TASK_HIERARCHY && <div className="flex flex-col gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Основне звернення</span>
                          <Select
                            disabled={isArchived || childIssues.length > 0 || parentSaving}
                            value={parentIssueId || ''}
                            onChange={handleParentChange}
                            options={[
                              { value: '', label: 'Самостійне звернення' },
                              ...parentCandidates.map(candidate => ({
                                value: candidate.id,
                                label: `${candidate.issueKey || candidate.id} — ${candidate.title}`,
                              })),
                            ]}
                            placeholder={childIssues.length > 0 ? 'Це основне звернення' : 'Самостійне звернення'}
                          />
                          {childIssues.length > 0 && (
                            <span className="text-[10px] leading-relaxed text-faint">
                              Спершу відв’яжіть дочірні звернення, щоб змінити рівень.
                            </span>
                          )}
                        </div>}
                      </div>
                  </Popover>
                </>
              )}
            />
        )}
        aside={!isModal ? (
          // Chat is only useful on the full task page.
          <div className="flex h-full flex-col overflow-hidden rounded-[16px] bg-canvas">
            <div className="flex min-h-0 flex-1 flex-col">
              <UnifiedTimeline
                issueId={issueId}
                projectId={projectId}
                issue={issue}
                isArchived={isArchived}
                org={activeOrg}
                members={members}
                mentionMembers={mentionMembers}
                isActive={!isCompactTaskLayout || taskPane === 'chat'}
                onUnreadCountChange={handleTaskChatUnreadChange}
              />
            </div>
          </div>
        ) : null}
      >

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
                      placeholder="Додай детальний опис звернення..."
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
                          onTaskToggle={isArchived || !canEditContent ? undefined : (taskLine, checked) => update({ description: setTaskChecked(issue.description, taskLine, checked) })}
                        />
                      )}
                      {visibleAttachments.length > 0 && (
                        <div className={issue.description ? 'mt-4' : ''}>{attachmentRows}</div>
                      )}
                    </>
                  ) : (
                    <DescriptionPlaceholder onClick={canEditContent ? enterEdit : undefined} disabled={!canEditContent}>
                      {canEditContent ? 'Натисни Редагувати щоб додати опис...' : terms.descriptionEmpty}
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
                          onRemove={canEditContent ? () => update({ labelIds: (issue.labelIds || []).filter(item => item !== label.id) }) : undefined}
                        />
                      ))}
                    </div>
                  </DetailSection>
                )}

              {/* REAL CHILD ISSUES */}
              {SHOW_INHERITED_TASK_HIERARCHY && !clientViewer && (childIssues.length > 0 || showSubInput) && (
                <DetailSection
                  density="group"
                  icon={TaskIcon}
                  title="Дочірні звернення"
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
                        projectId={child.projectId || projectId}
                        projectName={project?.name}
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
                          placeholder="Назва дочірнього звернення"
                        />
                        <p className="text-[10px] leading-relaxed text-muted">
                          Дочірнє звернення отримає власний ключ, статус, відповідальних і власну історію.
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
                            Створити дочірнє звернення
                          </Button>
                        </div>
                      </Surface>
                    )}
                  </div>
                </DetailSection>
              )}

              {/* ISSUE LINKS. «Це те саме, що я писав учора» and «оце чекає на
                  те» are facts about the requests themselves, and the customer
                  knows them as often as the desk does. Both ends of a link stay
                  inside one client space — the server route scopes the picker
                  and the write to it — so this discloses nothing a client
                  cannot already open. */}
              {(currentIssueLinks.length > 0 || showLinkInput) && (
              <DetailSection density="group" icon={Link2} title="Зв’язки" count={currentIssueLinks.length} className="pt-2">
              <div className="flex flex-col gap-[6px]">
                {currentIssueLinks.map(({ link, perspective }) => {
                    const otherIssue = issues.find(candidate => candidate.id === perspective.otherIssueId)
                      || perspective.otherIssue;
                    const otherProjectId = otherIssue?.projectId || projectId;
                    const otherProject = projects?.find(candidate => candidate.id === otherProjectId);
                    const otherKey = otherIssue?.issueKey || perspective.otherIssueId;
                    const otherTitle = otherIssue?.title || 'Пов’язане звернення';
                    const requiresReview = link.requiresReview || link.legacyRelationType === 'subtask-of';

                    return (
                      <IssueLinkRow
                        key={link.id}
                        label={perspective.label}
                        requiresReview={requiresReview}
                        canRemove={!isArchived && canEditContent}
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
                          ariaLabel="Пов’язане звернення"
                          value={linkTargetId}
                          onChange={setLinkTargetId}
                          className="w-full"
                          dropdownClassName="w-full max-w-none"
                          disabled={availableLinkIssues.length === 0}
                          placeholder="Немає доступних звернень"
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
                            await addLink(issueId, linkTargetId, linkRelation);
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
                {!isArchived && canEditContent && (
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
                    {SHOW_INHERITED_TASK_HIERARCHY && !parentIssueId && <Button
                      aria-label="Додати дочірнє звернення"
                      style="secondary"
                      size="sm"
                      composition="inline-add-action"
                      icon={Plus}
                      onClick={() => setShowSubInput(value => !value)}
                    >
                      <span className="sm:hidden">Дочірнє</span><span className="hidden sm:inline">Додати дочірнє звернення</span>
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

      {internalViewer && (
        <QuickTeamTransferDialog
          isOpen={showQuickTeamTransfer}
          onClose={() => setShowQuickTeamTransfer(false)}
          organizationId={activeOrgId}
          issueId={issueId}
          issueKey={issue?.issueKey || ''}
          onTransferred={answer => {
            setQuickTeamTask(answer?.quickTeamTask || null);
            showToast(answer?.status === 'existing'
              ? 'Це звернення вже перенесено — відкрийте його в QuickTeam'
              : 'Створено в QuickTeam');
          }}
        />
      )}
    </>
  );
}
