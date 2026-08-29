'use client';
// src/components/workspace/IssueCard.jsx
import { Draggable } from '@hello-pangea/dnd';
import { useRouter } from 'next/navigation';
import { useRef } from 'react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { Lock } from 'lucide-react';
import { CalendarIcon, TaskIcon } from '@/lib/design/icons';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { isDueDateOverdue, parseDueDate } from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import Tag from '@/components/ui/DataDisplay/Tag';
import { useLocalization } from '@/lib/hooks/useLocalization';
import { useAppContext } from '@/lib/context/AppContext';
import TypeBadge from '@/components/ui/DataDisplay/TypeBadge';
import Pill from '@/components/ui/DataDisplay/Pill';
import { issueDisplayParticipants } from '@/lib/utils/issueParticipants.mjs';
import { existingParentIssueId } from '@/lib/utils/issueHierarchyModel.mjs';
import { openBlockerIssues } from '@/lib/utils/issueExecution.mjs';
import { isIssueUnread, unreadActivityLabel } from '@/lib/utils/issueReadState.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import TaskCounters from '@/components/ui/TaskManagement/TaskCounters';
import TaskIdentity from '@/components/ui/TaskManagement/TaskIdentity';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';
import PriorityIcon from '@/components/ui/DataDisplay/PriorityIcon';
import Checkbox from '@/components/ui/Forms/Checkbox';
import { priorityPresentation } from '@/lib/utils/priorities.mjs';
import { plural } from '@/lib/utils/plural.mjs';

function hexToRgba(hex, alpha) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.substring(1, 3), 16);
    g = parseInt(hex.substring(3, 5), 16);
    b = parseInt(hex.substring(5, 7), 16);
  }
  return `rgba(${r},${g},${b},${alpha})`;
}


// `showProjectName` is opt-in: cross-project lists (Мої звернення) need
// the project after the key to tell two identical-looking cards apart, but on a
// project's own board every card would repeat the project you are already in.
// `projectName` is still always accepted — the issue key prefix is derived from
// it below, which has to work whether or not the badge is shown.
// `showStatusName` is for a column that is not a status: on «Звернення» the
// columns are the five shared categories, so a card in «У роботі» could be in
// «Код-ревʼю» or in «QA» and the column no longer says which.
// `showAssignee` is off for a customer reading their own board: who a request is
// routed to is how support organises itself, not a fact about the request. It
// was already fed an empty `members`, so no name or face leaked — but the slot
// stayed, printing «Без учасників», which tells a customer a routing decision
// exists and is empty. The row has to be absent, not empty.
export default function IssueCard({ issue, issues = [], allIssues, issueLinks = [], members = [], labels = [], index, projectId, projectName, showProjectName = false, showStatusName = false, showAssignee = true, isArchived, interactive = true, selected = false, selectionActive = false, onSelect, className = '', cardRef, virtualStyle, dragProvided, dragSnapshot }) {
  const router   = useRouter();
  const { currentUser, projects = [], activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const project = projects.find(candidate => candidate.id === projectId);
  const currentUserId = currentUser?.uid || currentUser?.id;
  const lastSeenAt = useWorkspaceStore(state => state.issueReadState[issue.id] || 0);
  const hasUnreadActivity = isIssueUnread(issue, lastSeenAt, currentUserId);
  const { formatDate } = useLocalization();
  const isDraggingRef = useRef(false);
  const { types, priorities, statuses, closedStatusIds, statusCategoryById } = useWorkflowConfig();
  const statusObj = showStatusName
    ? statuses.find(status => status.id === (issue.columnId || issue.status)) || null
    : null;
  // The category, not the closed set: a struck key means «зроблено», and only
  // «Готово» means that. Asking the category also keeps a renamed status right.
  const isDelivered = statusCategoryById.get(issue.columnId || issue.status) === 'done';

  const typeObj = types.find(t => t.id === issue.type) || {
    id: issue.type || 'task',
    label: issue.type === 'epic' ? 'Застарілий тип' : 'Звернення',
    color: issue.type === 'epic' ? '#8b5cf6' : '#9a9a9a',
  };
  const typeLabel = typeObj.label;

  const priorityConfig = priorityPresentation(issue.priority, priorities);
  const pri = {
    restGlow: priorityConfig.isNoPriority
      ? 'transparent'
      : hexToRgba(priorityConfig.color, 0.10),
    hoverGlow: priorityConfig.isNoPriority
      ? 'transparent'
      : hexToRgba(priorityConfig.color, 0.15),
  };

  const participantRoles = issueDisplayParticipants(issue);
  const participants = participantRoles
    .map(participant => {
      const member = members.find(candidate => (candidate.id || candidate.uid) === participant.id);
      return member ? { ...participant, member } : null;
    })
    .filter(Boolean);

  const due       = parseDueDate(issue.dueDate, { timeZone });
  const isOverdue = isDueDateOverdue(issue.dueDate, { timeZone })
    && !closedStatusIds.includes(issue.columnId || issue.status);

  const contextIssues = allIssues || issues;
  const parentIssueId = existingParentIssueId(issue);
  const parentIssue = contextIssues.find(candidate => candidate.id === parentIssueId);
  const childIssues = contextIssues.filter(candidate => existingParentIssueId(candidate) === issue.id);
  const childAll = childIssues.length;
  const childDone = childIssues.filter(child => closedStatusIds.includes(child.columnId || child.status)).length;
  const checklistAll = (issue.subtasks || []).length;
  const checklistDone = (issue.subtasks || []).filter(item => item.done).length;
  const attachCount = (issue.attachments || []).length;

  const isDraggable = typeof index === 'number';

  const isBlocked = openBlockerIssues(
    issue.id,
    contextIssues,
    issueLinks,
    closedStatusIds,
  ).length > 0;

  const renderCardContent = (provided = {}, snapshot = {}) => {
    const { isDragging = false, isDropAnimating = false } = snapshot;
    const libraryTransition = provided.draggableProps?.style?.transition;
    const libraryTransform = provided.draggableProps?.style?.transform;
    const lifted = isDragging && !isDropAnimating;
    // `transition-all` would put `transform` under a CSS transition, but the
    // library drives the card's transform frame by frame during a drag. The two
    // fight each other and the card drifts after the drop, so only paint
    // properties ease here.
    // The hover ring is an `!important` box-shadow, so it outranks the inline
    // lift shadow below — and the cursor is by definition over the card being
    // dragged. Dropping the ring while lifted lets the lift actually show, and
    // stops the shadow swapping abruptly the moment the card is released.
    const hoverRing = lifted || !interactive || selected ? '' : 'hover:!ring-4 hover:!ring-line';
    const cardClassName = `relative group overflow-hidden rounded-[16px] bg-white ${interactive ? 'cursor-pointer' : ''} select-none transition-[box-shadow,border-color] duration-200 flex flex-col justify-between ${hoverRing} ${selected ? 'ring-2 ring-ink' : ''} shrink-0 ${className}`;
    // `none` is the library asking for an instant snap and cannot be combined
    // with further entries — appending to it would void the whole declaration.
    const cardTransition = !libraryTransition || libraryTransition === 'none'
      ? libraryTransition || undefined
      : `${libraryTransition}, box-shadow 0.2s ease, border-color 0.2s ease`;
    const msgCount = issue.commentCount || issue.commentsCount || issue.comments?.length || (issue.hasUnreadChat ? 1 : 0);
    const hasUnreadChat = Boolean(
      issue.lastCommentAt &&
      issue.lastCommentAuthorId !== currentUserId &&
      !(issue.lastCommentReadBy || []).includes(currentUserId)
    );
    // How many unread messages have named you, kept per person on the task and
    // cleared when that person reads the chat. It used to be a bare «@» taken
    // from the last message alone, so being named three times and being named
    // once looked the same, and the second message hid the first.
    const mentionCount = Number(issue.unreadMentions?.[currentUserId]) || 0;

    return (
      <div
        ref={node => {
          provided.innerRef?.(node);
          if (typeof cardRef === 'function') cardRef(node);
          else if (cardRef) cardRef.current = node;
        }}
        {...provided.draggableProps}
        {...provided.dragHandleProps}
        onDragStart={() => { isDraggingRef.current = true; }}
        onDragEnd={() => { isDraggingRef.current = false; }}
        onClick={interactive
          ? event => {
            if (isDraggingRef.current) return;
            // Shift+click starts a selection as well as extending one, so the
            // board has the same door into selection mode the list has.
            if (onSelect && (selectionActive || event.shiftKey)) {
              event.preventDefault();
              onSelect(issue.id, { shiftKey: event.shiftKey });
              return;
            }
            router.push(issuePath(issue, project || projectId));
          }
          : undefined}
        className={cardClassName}
        style={{
          ...virtualStyle,
          ...provided.draggableProps?.style,
          borderWidth: '1px',
          borderStyle: 'solid',
          borderColor: lifted ? 'var(--color-line)' : 'var(--color-surface)',
          // A deeper shadow now carries the "lifted" feel on its own. There used
          // to be a scale(1.015) here too, but the library measures a Draggable
          // once at drag start and derives every placeholder and displacement
          // offset from that box — visually resizing the card afterwards puts it
          // a few pixels out of step with the slot it is heading for.
          boxShadow: lifted
            ? '0 18px 26px -12px rgba(0, 0, 0, 0.22), 0 6px 8px -4px rgba(0, 0, 0, 0.10)'
            : 'none',
          // The DnD library injects `cursor: grab` on every resting drag
          // handle. The whole card is also a link-like control, so at rest it
          // uses the standard pointer and only the active drag uses grabbing.
          cursor: lifted ? 'grabbing' : (interactive ? 'pointer' : 'default'),
          transform: libraryTransform,
          // Hand the transition straight back to the library while it owns the
          // card. The previous version appended `ring 0.2s ease` — not an
          // animatable property — and that inline value silently overrode the
          // `transition-all duration-200` class, so nothing on the card eased
          // at rest either. Leaving it undefined lets the class do its job.
          transition: cardTransition,
        }}
      >
        {/* ── Priority glow blob ─────────────────────────── */}
        {pri.restGlow !== 'transparent' && (
          <>
            {/* Resting state: bottom-right */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[16px] transition-opacity duration-300 opacity-100 group-hover:opacity-0"
              style={{
                background: `radial-gradient(ellipse at 90% 100%, ${pri.restGlow} 0%, transparent 45%)`,
              }}
            />
            {/* Hover state: top-right */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[16px] transition-opacity duration-300 opacity-0 group-hover:opacity-100"
              style={{
                background: `radial-gradient(ellipse at 88% 5%, ${pri.hoverGlow} 0%, transparent 45%)`,
              }}
            />
          </>
        )}

        <div className="relative z-10 p-[14px] flex flex-col flex-1">
          {/* Row 1: Code + Project (merged, original mono bold font, separated by •) + Priority */}
          <div className="flex items-center gap-[8px] mb-[10px] flex-wrap">
            <TaskIdentity
              issue={issue}
              projectName={projectName}
              showProjectName={showProjectName}
              parentIssue={parentIssueId ? (parentIssue || { issueKey: '' }) : null}
              done={isDelivered}
              className="max-w-[220px]"
            />

            {selectionActive && onSelect ? (
              <span
                className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center"
                onClick={event => event.stopPropagation()}
                onMouseDown={event => event.stopPropagation()}
                onTouchStart={event => event.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  onChange={() => onSelect(issue.id)}
                  size="sm"
                  ariaLabel={`Вибрати звернення ${issue.issueKey || issue.title}`}
                />
              </span>
            ) : (
              <PriorityIcon priority={priorityConfig} size="md" className="ml-auto" />
            )}
          </div>

          {/* Row 2: Title */}
          <p className="text-[13px] font-bold text-ink leading-[1.35] line-clamp-3 mb-[12px]">
            {issue.title}
          </p>

          {/* Real child issues roll up into the parent card. */}
          {childAll > 0 && (
            <div className="mb-[12px] flex items-center gap-[8px] select-none text-[10px] text-muted font-medium">
              <span className="shrink-0">
                <strong className="text-ink font-semibold">{childDone}/{childAll}</strong> дочірніх звернень
              </span>
              <div className="flex items-center gap-[3px] shrink-0">
                {Array.from({ length: childAll }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-[2.5px] w-[12px] rounded-full transition-all duration-300 ${
                      idx < childDone ? 'bg-ink' : 'bg-chart-track'
                    }`}
                  />
                ))}
              </div>
            </div>
          )}

          {checklistAll > 0 && (
            <div className="mb-[12px] flex items-center gap-[5px] text-[10px] font-medium text-muted">
              <TaskIcon size={11} />
              <span><strong className="text-ink">{checklistDone}/{checklistAll}</strong> старий чекліст</span>
            </div>
          )}

          {/* Row 4: Type + Labels (Using strict UI Kit Tag atom styling) */}
          <div className="flex flex-wrap gap-[6px] mb-[12px] items-center">
            {typeObj && (
              <TypeBadge
                label={typeLabel}
                color={typeObj.color || '#9a9a9a'}
                icon={taskTypeIcon(typeObj)}
              />
            )}

            {/* Only where the column cannot say it — see `showStatusName`. */}
            {statusObj && (
              <Pill
                color={statusObj.color || '#9a9a9a'}
                size="sm"
                shape="badge"
                weight="medium"
                title={`Статус: ${statusObj.label}`}
              >
                {statusObj.label}
              </Pill>
            )}

            {isBlocked && (
              <Pill
                tone="danger"
                size="sm"
                shape="badge"
                weight="medium"
                title="Заблоковано іншим зверненням"
              >
                <Lock size={10} />
                Заблоковано
              </Pill>
            )}

            {/* Labels */}
            {issue.labelIds && issue.labelIds.map(id => {
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
            })}
          </div>

          {/* Row 5: Due date (thinner medium weight, lighter text, thinner stroke width)

              Прострочене звернення друкує лише «Прострочено». Дата, яка вже
              минула, не додає нічого до цього слова — вона лише подвоює рядок
              і забирає ширину в мітках поруч. Точний термін лишається на
              сторінці звернення, де він є полем, а не присудом. */}
          {due && (
            <div className={`flex items-center gap-[5px] mb-[12px] text-[11px] font-medium ${
              isOverdue ? 'text-danger' : 'text-muted'
            }`}>
              <CalendarIcon size={11} strokeWidth={1.8} className="shrink-0" />
              {isOverdue
                ? <span className="font-semibold">Прострочено</span>
                : <span>{formatDate(due, { timeZone })}</span>}
            </div>
          )}

          {/* Row 6: Footer with task participants and flat modern indigo chat indicator.
              The counters keep the right edge whether or not the faces are
              drawn — `justify-end` when they are not, so a customer's card ends
              in its message count rather than in a hole where the routing was. */}
          <div className={`border-t border-line pt-[10px] flex items-center gap-2 mt-auto ${showAssignee ? 'justify-between' : 'justify-end'}`}>
            {showAssignee && (
              <div className="flex -space-x-[8px] overflow-visible" aria-label="Учасники звернення">
                {participants.length > 0 ? (
                  participants.slice(0, 5).map(({ id, member, roles }) => {
                    const roleLabels = roles.map(role => ({
                      assignee: 'відповідальний',
                      author: 'автор',
                      subscriber: 'підписник',
                    })[role]);
                    return (
                      <div
                        key={id}
                        title={`${member.name || member.email?.split('@')[0]} · ${roleLabels.join(', ')}`}
                        className="relative group/avatar"
                      >
                        <UserAvatar user={member} size="sm" stacked className="hover:scale-110 hover:z-20 transition-all cursor-pointer" />
                      </div>
                    );
                  })
                ) : (
                  <span className="text-[11px] text-faint italic">Без учасників</span>
                )}
                {participants.length > 5 ? (
                  <Pill
                    tone="neutral"
                    size="md"
                    preset="avatar-counter"
                    title={`Ще ${participants.length - 5} ${plural(participants.length - 5, ['учасник', 'учасники', 'учасників'])}`}
                  >
                    +{participants.length - 5}
                  </Pill>
                ) : null}
              </div>
            )}

            <TaskCounters
              attachments={attachCount}
              mentions={mentionCount}
              messages={msgCount}
              unread={hasUnreadActivity || hasUnreadChat}
              unreadLabel={hasUnreadChat && !hasUnreadActivity
                ? 'Нове: повідомлення'
                : unreadActivityLabel(issue)}
            />
          </div>

        </div>
      </div>
    );
  };

  if (dragProvided) {
    return renderCardContent(dragProvided, dragSnapshot);
  }

  if (isDraggable) {
    return (
      <Draggable draggableId={issue.id} index={index} isDragDisabled={isArchived || selectionActive}>
        {(provided, snapshot) => renderCardContent(provided, snapshot)}
      </Draggable>
    );
  }

  return renderCardContent();
}
