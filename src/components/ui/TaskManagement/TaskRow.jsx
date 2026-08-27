'use client';
// src/components/ui/TaskManagement/TaskRow.jsx — Beautiful list-row representation of a task
import { Clock, Lock } from 'lucide-react';
import { CalendarIcon, TaskIcon } from '@/lib/design/icons';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import Tag from '@/components/ui/DataDisplay/Tag';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { isDueDateOverdue, parseDueDate } from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import { useAppContext } from '@/lib/context/AppContext';
import TypeBadge from '@/components/ui/DataDisplay/TypeBadge';
import Pill from '@/components/ui/DataDisplay/Pill';
import TaskCounters from './TaskCounters';
import TaskIdentity from './TaskIdentity';
import { existingParentIssueId } from '@/lib/utils/issueHierarchyModel.mjs';
import { openBlockerIssues } from '@/lib/utils/issueExecution.mjs';
import { isIssueUnread, unreadActivityLabel } from '@/lib/utils/issueReadState.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import PriorityIcon from '@/components/ui/DataDisplay/PriorityIcon';
import { priorityPresentation } from '@/lib/utils/priorities.mjs';
import Checkbox from '@/components/ui/Forms/Checkbox';

function fmtDate(raw, timeZone) {
  if (!raw) return null;
  const d = raw?.toDate ? raw.toDate() : new Date(raw);
  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', timeZone });
}

/**
 * One task as a row: key, title, type, status, assignee, labels, and the timer
 * dot when it is running.
 *
 * @param {object} props.issue The task this row shows.
 * @param {object[]} props.issues Its siblings, for resolving the parent key.
 * @param {object[]} props.allIssues Every task in scope, for links that leave the current list.
 * @param {object[]} props.members Workspace members, for the assignee avatar.
 * @param {object[]} props.labels Label definitions, for the chips.
 * @param {object[]} props.sprints Sprint definitions.
 * @param {object[]} props.issueLinks Relations, for the link count.
 * @param {boolean} props.isTimerActive A timer is running on this task.
 * @param {string} props.projectId Current project.
 * @param {string} props.projectName Its name.
 * @param {boolean} props.showProjectName Whether the row names its project — true only on cross-project lists.
 * @param {boolean} props.showStatusName Whether the row names its status — true only where the section heading cannot, i.e. a category holding several statuses.
 * @param {() => void} props.onClick Opens the task.
 * @param {boolean} props.selected Whether this task is part of the active bulk selection.
 * @param {boolean} props.selectionActive Whether the row is showing its selection control instead of priority.
 * @param {(issueId: string, options?: {shiftKey?: boolean}) => void} props.onSelect Toggles this task in the active selection.
 */
export default function TaskRow({
  issue,
  issues = [],
  allIssues,
  issueLinks = [],
  members = [],
  labels = [],
  sprints = [],
  projectId,
  projectName,
  showProjectName = false,
  showStatusName = false,
  isTimerActive,
  onClick,
  selected = false,
  selectionActive = false,
  onSelect,
}) {
  const router = useRouter();
  const { currentUser, projects = [], activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const project = projects.find(candidate => candidate.id === projectId);
  const currentUserId = currentUser?.uid || currentUser?.id;
  const isDraggingRef = useRef(false);
  const { types, priorities, statuses, closedStatusIds, statusCategoryById } = useWorkflowConfig();
  // The same read cursor a board card reads, from the same organization-wide
  // stream. A row used to light its dot for an unread message only, so the list
  // and the board disagreed about the very same task the moment somebody changed
  // a field instead of writing one.
  const lastSeenAt = useWorkspaceStore(state => (
    issue?.id ? state.issueReadState[issue.id] || 0 : 0
  ));

  const task = issue;
  if (!task) return null;

  // Only where the section heading cannot say it — see `showStatusName`.
  const statusObj = showStatusName
    ? statuses.find(status => status.id === (task.columnId || task.status)) || null
    : null;
  // The category, not the closed set: a struck key means «зроблено», and only
  // «Готово» means that. Asking the category also keeps a renamed status right.
  const isDelivered = statusCategoryById.get(task.columnId || task.status) === 'done';

  const typeObj = types.find(t => t.id === task.type) || {
    id: task.type || 'task',
    label: task.type === 'epic' ? 'Епік (legacy)' : 'Інцидент',
    color: task.type === 'epic' ? '#8b5cf6' : '#9a9a9a',
  };
  const typeLabel = typeObj.label;

  const priorityConfig = priorityPresentation(task.priority, priorities);

  const assignees = (task.assigneeIds || task.assignees || [])
    .map(uid => members.find(m => (m.id || m.uid) === uid))
    .filter(Boolean);

  const due = parseDueDate(task.dueDate, { timeZone });
  const isOverdue = isDueDateOverdue(task.dueDate, { timeZone })
    && !closedStatusIds.includes(task.columnId)
    && !closedStatusIds.includes(task.status);

  const contextIssues = allIssues || issues;
  const parentIssueId = existingParentIssueId(task);
  const parentIssue = contextIssues.find(candidate => candidate.id === parentIssueId);
  const childIssues = contextIssues.filter(candidate => existingParentIssueId(candidate) === task.id);
  const childAll = childIssues.length;
  const childDone = childIssues.filter(child => closedStatusIds.includes(child.columnId || child.status)).length;
  const checklistAll = (task.subtasks || []).length;
  const checklistDone = (task.subtasks || []).filter(item => item.done).length;

  const msgCount = task.commentCount || task.commentsCount || task.comments?.length || (task.hasUnreadChat ? 1 : 0);
  const hasUnreadChat = Boolean(
    task.lastCommentAt &&
    task.lastCommentAuthorId !== currentUserId &&
    !(task.lastCommentReadBy || []).includes(currentUserId)
  );
  const mentionCount = Number(task.unreadMentions?.[currentUserId]) || 0;
  const hasUnreadActivity = isIssueUnread(task, lastSeenAt, currentUserId);

  const isBlocked = openBlockerIssues(
    task.id,
    contextIssues,
    issueLinks,
    closedStatusIds,
  ).length > 0;

  const handleRowClick = (e) => {
    // Shift reaches the selection even before there is one: it is how a list
    // starts selecting without going through the kebab. Without the shift the
    // row keeps opening the task, exactly as before.
    if (onSelect && (selectionActive || e.shiftKey)) {
      e.preventDefault();
      onSelect(task.id, { shiftKey: e.shiftKey });
      return;
    }
    if (onClick) {
      onClick(e);
      return;
    }
    if (projectId && task.id) {
      router.push(issuePath(task, project || projectId));
    }
  };

  // ── The parts of a row, built once ──────────────────────────────────────────
  //
  // A row is arranged twice below: as one line for a desktop track wide enough
  // to hold it, and as a small card for a phone that is not. The facts are
  // assembled here so the two arrangements cannot drift apart — the phone used
  // to get the desktop line with `flex-wrap` on it, which is not an adaptation,
  // it is the same line folded until it fits.
  //
  // What differs between them is scale, and only where scale is the point: the
  // meta figures are 9px on a desktop row because they share it with everything
  // else, and nobody reads 9px on a phone held at arm's length.

  const priorityMark = (
    // The priority mark leads the row, because the selection checkbox takes its
    // place and a checkbox belongs at the start of a row, not floating in the
    // middle of the badges. The box is always drawn so a task with no priority
    // does not shift the title left.
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      {selectionActive && onSelect ? (
        <span
          className="flex h-5 w-5 items-center justify-center"
          onClick={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
          onTouchStart={event => event.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onChange={() => onSelect(task.id)}
            size="sm"
            ariaLabel={`Вибрати інцидент ${task.issueKey || task.title}`}
          />
        </span>
      ) : (
        <PriorityIcon priority={priorityConfig} size="md" />
      )}
    </span>
  );

  // The same three counts, in the same order and the same shapes as on a board
  // card. A count of messages is a quantity you read, not an identifier you
  // retype — it was set in the same monospace as the task key, which is what
  // made a bare number beside an icon look like a code fragment rather than
  // "12 повідомлень".
  const countersNode = (
    <TaskCounters
      mentions={mentionCount}
      messages={msgCount}
      unread={hasUnreadActivity || hasUnreadChat}
      unreadLabel={hasUnreadChat && !hasUnreadActivity
        ? 'Нове: повідомлення'
        : unreadActivityLabel(task)}
      size="sm"
    />
  );

  const typeBadge = typeObj ? (
    <TypeBadge
      label={typeLabel}
      color={typeObj.color || '#9a9a9a'}
      icon={taskTypeIcon(typeObj)}
    />
  ) : null;

  const statusBadge = statusObj ? (
    <Pill
      color={statusObj.color || '#9a9a9a'}
      size="sm"
      shape="badge"
      weight="medium"
      title={`Статус: ${statusObj.label}`}
    >
      {statusObj.label}
    </Pill>
  ) : null;

  const blockedBadge = isBlocked ? (
    <span
      className="flex items-center gap-[4px] text-[10px] font-medium px-[6px] py-[1.5px] rounded-[4px] shrink-0 bg-danger-soft text-danger"
      title="Заблоковано іншим інцидентом"
    >
      <Lock size={10} />
      Заблоковано
    </span>
  ) : null;

  const sprintBadge = task.sprintId ? (
    <span className="inline-flex items-center px-[6px] py-[1.5px] bg-canvas text-muted rounded-[4px] text-[10px] font-medium shrink-0">
      {sprints.find(s => s.id === task.sprintId)?.name || 'Спринт'}
    </span>
  ) : null;

  const labelTags = (task.labelIds || []).map(id => {
    const l = labels.find(lbl => lbl.id === id);
    if (!l) return null;
    return (
      <Tag
        key={id}
        label={l.label}
        color={l.color}
        size="small"
        className="shrink-0"
      />
    );
  }).filter(Boolean);

  // `dense` is the desktop line, where nine pixels buy the room the badges to
  // the right of them need. The phone gets the readable scale instead.
  const renderDue = dense => (due ? (
    <div className={dense
      ? `flex items-center gap-[3px] text-[9px] font-bold shrink-0 ml-1 ${isOverdue ? 'text-danger' : 'text-muted'}`
      : `flex items-center gap-[4px] text-[11px] font-semibold shrink-0 ${isOverdue ? 'text-danger' : 'text-muted'}`}>
      <CalendarIcon size={dense ? 10 : 12} strokeWidth={2} className="shrink-0" />
      {/* Прострочене завдання друкує лише «Прострочено» — так само, як картка
          на дошці. Дата, яка вже минула, нічого не додає до цього слова, а
          два написи поспіль коштували рядку ширини, якої йому бракує. */}
      {isOverdue
        ? <span className="font-bold uppercase">Прострочено</span>
        : <span>{fmtDate(due, timeZone)}</span>}
    </div>
  ) : null);

  const renderChildProgress = dense => (childAll > 0 ? (
    <div className={dense
      ? 'flex items-center gap-[4px] text-[9px] text-muted font-bold shrink-0 ml-1'
      : 'flex items-center gap-[5px] text-[11px] text-muted font-semibold shrink-0'}>
      <span className="text-ink">{childDone}/{childAll} дочірніх інцидентів</span>
      <div className="flex gap-[2px]">
        {Array.from({ length: childAll }).map((_, idx) => (
          <div
            key={idx}
            className={`${dense ? 'h-[1.5px] w-[6px]' : 'h-[2px] w-[8px]'} rounded-full transition-all duration-300 ${
              idx < childDone ? 'bg-ink' : 'bg-chart-track'
            }`}
          />
        ))}
      </div>
    </div>
  ) : null);

  const renderChecklist = dense => (checklistAll > 0 ? (
    <div className={dense
      ? 'flex items-center gap-[3px] text-[9px] font-bold text-muted'
      : 'flex items-center gap-[4px] text-[11px] font-semibold text-muted shrink-0'}>
      <TaskIcon size={dense ? 9 : 11} />
      <span>{checklistDone}/{checklistAll} чекліст</span>
    </div>
  ) : null);

  const assigneeFaces = assignees.length > 0 ? (
    <>
      {assignees.slice(0, 3).map((m, idx) => (
        <span key={idx} title={m.name || m.email?.split('@')[0]} className="relative">
          <UserAvatar user={m} size="xs" className="ring-2 ring-white hover:scale-110 hover:z-20 transition-all" />
        </span>
      ))}
      {assignees.length > 3 && (
        <Pill
          tone="neutral"
          size="md"
          preset="avatar-counter-xs"
          title={assignees.slice(3).map(m => m.name || m.email?.split('@')[0]).join(', ')}
        >
          +{assignees.length - 3}
        </Pill>
      )}
    </>
  ) : null;

  return (
    <div
      onClick={handleRowClick}
      // The row carries controls of its own — the timer, the assignee picker —
      // so it cannot be a `<button>` without nesting them inside one. It gets
      // the three things a button would have given it instead: a role, a place
      // in the tab order, and the two keys that activate a button.
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleRowClick(event);
      }}
      // Обводка, і тільки обводка.
      //
      // Рядок під курсором ще й заливався сірим, і це була не задумка, а
      // побічний ефект переїзду на токени: заливка була #fcfcfc — три одиниці
      // від білого, тобто майже непомітна, — а `bg-canvas` це #f4f4f5, тобто
      // повноцінний сірий. Рядок сірішав цілком, і кільце, яке й є нашим
      // ховером, губилося в ньому. Кільце робить цю роботу саме.
      className={`relative group overflow-hidden rounded-[12px] bg-white cursor-pointer select-none border border-line transition-all duration-200 flex items-center justify-between p-[12px] ${selected ? 'ring-2 ring-ink' : 'hover:!ring-4 hover:!ring-line'} ${isTimerActive ? 'ring-2 ring-ink/30' : ''}`}
    >
      {/* ── One line, from md up ───────────────────────────────────────────── */}
      <div className="hidden items-center justify-between w-full gap-[16px] min-w-0 md:flex">

        {priorityMark}

        {/* Left Section: Title & ID (2 lines) */}
        <div className="flex flex-col gap-[2px] min-w-0 flex-1">
          {/* Issue Key, Project, Due Date, Subtasks (Top Row) */}
          <div className="flex items-center gap-[8px] flex-wrap">
            <TaskIdentity
              issue={task}
              projectName={projectName}
              showProjectName={showProjectName}
              parentIssue={parentIssueId ? (parentIssue || { issueKey: '' }) : null}
              done={isDelivered}
              className="max-w-full"
            />

            {renderDue(true)}
            {renderChildProgress(true)}
            {renderChecklist(true)}

            {isTimerActive && (
              <span className="w-[5px] h-[5px] bg-ink rounded-full animate-pulse shrink-0" />
            )}
          </div>

          {/* Title & Chat Indicator (Bottom Row) */}
          <div className="flex items-center gap-[8px] min-w-0">
            <p className="text-[13px] font-bold text-ink truncate" title={task.title}>
              {task.title}
            </p>
            {countersNode}
          </div>
        </div>

        {/* Right Section: Metadata, Badges, Assignees.
            The assignee stack gets a floor, not a fixed width: it used to
            follow the number of faces and drag every badge left of it along,
            which is what made a list of ten read as ten ragged lines. The
            badges keep their natural widths — giving them a fixed track too
            opened a wide hole in front of the avatars on every row without
            labels. */}
        <div className="flex w-auto shrink-0 flex-nowrap items-center justify-end gap-x-[12px] gap-y-[6px]">
          {/* Type Badge */}
          <span className="flex min-w-0 shrink-0 items-center">
            {typeBadge}
          </span>

          <span className="flex min-w-0 items-center gap-[8px] overflow-hidden">
            {statusBadge}
            {blockedBadge}
            {sprintBadge}
            {labelTags.length > 0 && (
              <span className="flex items-center gap-[4px] overflow-hidden">
                {labelTags}
              </span>
            )}
          </span>

          {/* Assignees — a floor, so three faces and none take the same room.
              The floor is the widest the cluster can be, measured rather than
              guessed: three 16px faces overlapping by 6 is 36px, and the fourth
              bubble carrying the remainder adds ten more — 46px for «+9», 50
              for «+12». It was 76px, a number sized for nothing in particular,
              and every row with one assignee spent thirty of them on a hole
              between the badges and the face. A remainder in the hundreds is
              allowed to widen its own row rather than be clipped. */}
          <span className="flex min-w-[52px] shrink-0 items-center justify-end -space-x-[6px] overflow-visible">
            {assigneeFaces || <span className="text-[10px] text-faint italic">Н/В</span>}
          </span>

        </div>

      </div>

      {/* ── A small card, below md ──────────────────────────────────────────
          Not the line above with `flex-wrap` on it. Folding one line whose left
          half grows and whose right half is right-aligned gives two ragged
          edges and a badge cluster clipped at the card border, which is what a
          phone actually showed: the title squeezed into a third of the width,
          the sprint chip and the labels cut off the right edge, and every
          figure set at nine pixels.

          Here the three things a task is — what it is called, what it says, and
          what it carries — get a line each. Nothing is cut except the identity
          line, the one fragment that can lose its tail without losing its
          meaning; the title wraps to a second line instead of being clipped. */}
      <div className="flex w-full min-w-0 flex-col gap-[8px] md:hidden">

        <div className="flex min-w-0 items-center gap-[8px]">
          {priorityMark}
          <span className="flex min-w-0 flex-1 items-center gap-[6px]">
            <TaskIdentity
              issue={task}
              projectName={projectName}
              showProjectName={showProjectName}
              parentIssue={parentIssueId ? (parentIssue || { issueKey: '' }) : null}
              className="min-w-0 flex-1"
            />
            {isTimerActive && (
              <span className="h-[6px] w-[6px] shrink-0 animate-pulse rounded-full bg-ink" />
            )}
          </span>
          {countersNode}
          {/* No «Н/В» placeholder here. On a desktop row the empty slot is what
              keeps ten rows aligned down one edge; in a stack of cards it is a
              label that says nothing, taking the place of the faces. */}
          {assigneeFaces && (
            <span className="flex shrink-0 items-center -space-x-[6px]">
              {assigneeFaces}
            </span>
          )}
        </div>

        <p
          className="line-clamp-2 text-[14px] font-bold leading-[19px] text-ink [overflow-wrap:anywhere]"
          title={task.title}
        >
          {task.title}
        </p>

        <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[6px]">
          {typeBadge}
          {statusBadge}
          {blockedBadge}
          {sprintBadge}
          {labelTags}
          {renderDue(false)}
          {renderChildProgress(false)}
          {renderChecklist(false)}
        </div>

      </div>
    </div>
  );
}
