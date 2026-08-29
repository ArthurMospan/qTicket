'use client';
// src/components/workspace/AgileBoard.jsx — 7-column kanban with DnD and Swimlanes
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import IssueCard from './IssueCard';
import { ChevronLeft, ChevronRight, MoreVertical, CheckSquare } from 'lucide-react';
import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import Button from '@/components/ui/Button';
import { BulkActionBar, ContextMenu } from '@/components/ui';
import Pill from '@/components/ui/DataDisplay/Pill';
import { columnOf, compareIssues } from '@/lib/utils/optimistic.mjs';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import PriorityIcon from '@/components/ui/DataDisplay/PriorityIcon';
import { NO_PRIORITY, ensureSystemPriorities, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { COLUMN_VIRTUALIZATION_THRESHOLD } from '@/lib/utils/boardRendering.mjs';
import VirtualDroppableColumn from './VirtualDroppableColumn';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { useIssueSelection } from '@/lib/hooks/useIssueSelection';
import {
  createUkrainianDndAnnouncements,
  UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS,
} from '@/lib/utils/dndAnnouncements.mjs';

// The drag context cannot render during SSR/hydration, so the first board of a
// session waits a tick before painting. Every later mount — a tab switch, a
// `loading` flip, coming back from an issue — is already client-side, and
// returning null for a paint there reads as the board blinking out and back.
// One module-level flag means only the very first mount pays that frame.
let dndReady = false;

// No «+» at the head of a column, and no inline title field under it. Only a
// client opens a request — support receives it, works it and closes it — so a
// board is a place requests arrive, never a place they are filed.
//
// The inline form that used to stand here called a create handler no shipped
// screen ever passed it, so the one column control promising to make something
// would have thrown had anybody finished typing into it.
export default function AgileBoard({
  issues,
  allIssues,
  members,
  projectId,
  project,
  projects = [],
  showProjectName = false,
  showAssignee = true,
  onMoveIssue,
  onBulkUpdate,
  swimlane = 'none',
  groupBy = 'status',
  hiddenColumns = [],
  showHiddenLane = false,
  issueLinks = [],
  isArchived,
  readOnly = false,
  canArchive = false,
  selectionScopeKey = '',
  compareIssueCards = compareIssues,
}) {
  const [mounted, setMounted] = useState(dndReady);
  const {
    statuses: globalStatuses,
    labels,
    types,
    categoryColumns,
    statusCategoryById,
    priorities,
  } = useWorkflowConfig();
  // A board of one project has that project's statuses as its columns. A board
  // that spans projects cannot: a status one project has switched off is not a
  // column the other's cards may be dropped into, which is the collision this
  // mode removes. Its columns are the five shared categories instead, so every
  // card on it has exactly one column it belongs to.
  const byCategory = groupBy === 'category';
  const contextIssues = allIssues || issues;
  // A subtask carries its own status, so it is a card of its own on every
  // board. IssueCard prints the parent's key on it, which is what keeps the
  // hierarchy readable without hiding work from the column it belongs to.
  const boardIssues = issues;

  // Both sources hand back a fresh array on every render, which would defeat
  // the memos below; collapse them to a value that only changes on content.
  const hiddenColsKey = (project ? (project.hiddenColumns || []) : hiddenColumns).join(',');
  const activeHiddenCols = useMemo(
    () => (hiddenColsKey ? hiddenColsKey.split(',') : []),
    [hiddenColsKey]
  );

  const columns = useMemo(() => {
    const allColumns = byCategory ? categoryColumns : globalStatuses;
    const visibleColumns = allColumns.filter(s => !activeHiddenCols.includes(s.id));
    const hiddenColIds = activeHiddenCols.filter(id => allColumns.some(s => s.id === id));
    const next = [...visibleColumns];
    if (showHiddenLane && hiddenColIds.length > 0) {
      next.push({
        id: '__hidden__',
        label: 'Приховані',
        color: '#cfcfcf',
        isHiddenContainer: true,
        colIds: hiddenColIds
      });
    }
    return next;
  }, [byCategory, categoryColumns, globalStatuses, activeHiddenCols, showHiddenLane]);

  // Which column a card belongs to. In category mode a card's own status is not
  // a column of this board — its category is.
  const columnIdOf = useMemo(() => (byCategory
    ? issue => statusCategoryById.get(columnOf(issue)) || ''
    : columnOf), [byCategory, statusCategoryById]);

  // Columns that hold more than one status: the card has to name its own status
  // there, otherwise a category column silently flattens «Код-ревʼю» and «QA»
  // into one indistinguishable pile.
  const multiStatusColumnIds = useMemo(() => {
    if (!byCategory) return new Set();
    const counts = new Map();
    for (const category of statusCategoryById.values()) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
    return new Set([...counts].filter(([, count]) => count > 1).map(([category]) => category));
  }, [byCategory, statusCategoryById]);

  // One definition of "the cards of this column, in this order", used to render
  // a column and to read back where a card was dropped into it. Two definitions
  // is what let the board show one order and write another.
  const columnCards = (laneIssues, column) => (laneIssues || [])
    .filter(issue => (column?.isHiddenContainer
      ? column.colIds.includes(columnIdOf(issue))
      : columnIdOf(issue) === column?.id))
    .sort(compareIssueCards);


  // Whether anything is currently hidden past the left or right edge of the
  // board, so the edge shadows only appear where a column has actually gone
  // under one. Read from the element rather than derived from column widths:
  // collapsing a column, resizing the window and dropping a card all change the
  // answer, and only the scroller itself knows all three.
  const boardScrollRef = useRef(null);
  // With swimlanes the column titles are a second row above the scroller, and
  // that row is not the scroller: it never moved, so every column past the
  // right edge kept a header that stayed put over the wrong cards — and the
  // chevron that folds and unfolds a column lives only in that header, which
  // made a column you could not bring into view a column you could not unfold.
  // The body scroller stays the one thing that scrolls; the header follows it.
  const columnHeaderRef = useRef(null);
  const [boardOverflow, setBoardOverflow] = useState({ start: false, end: false });
  const measureBoardOverflow = useCallback(() => {
    const node = boardScrollRef.current;
    if (!node) return;
    if (columnHeaderRef.current && columnHeaderRef.current.scrollLeft !== node.scrollLeft) {
      columnHeaderRef.current.scrollLeft = node.scrollLeft;
    }
    const maxScroll = node.scrollWidth - node.clientWidth;
    const next = {
      start: node.scrollLeft > 1,
      // One pixel of slack: fractional layout widths leave a sub-pixel of
      // scroll left at the far end, which kept the shadow lit forever.
      end: maxScroll > 1 && node.scrollLeft < maxScroll - 1,
    };
    setBoardOverflow(current => (
      current.start === next.start && current.end === next.end ? current : next
    ));
  }, []);

  useLayoutEffect(() => {
    const node = boardScrollRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(measureBoardOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureBoardOverflow]);

  // Collapsing a column or dropping a card changes the content width without
  // resizing the scroller, so the observer above never hears about it. Reading
  // two properties after each render is cheaper than tracking every cause, and
  // the setter bails when nothing changed.
  useLayoutEffect(measureBoardOverflow);

  const dndAnnouncements = useMemo(() => createUkrainianDndAnnouncements({
    itemLabel: draggableId => {
      const issue = boardIssues.find(candidate => candidate.id === draggableId);
      return issue?.issueKey || issue?.title || 'Звернення';
    },
    listLabel: droppableId => {
      const columnId = String(droppableId || '').split('::').at(-1);
      return columns.find(column => column.id === columnId)?.label || 'Колонка';
    },
  }), [boardIssues, columns]);
  // Which columns are folded, remembered per board *and per grouping*: the two
  // modes have different columns, and one key let a collapsed «У роботі» category
  // fold the unrelated status that happens to share its id.
  const collapsedKey = `qt_board_collapsed_${projectId || 'default'}${byCategory ? '_category' : ''}`;
  // Read from the key rather than copied into state on mount: switching grouping
  // changes the key, and a copy would keep showing the folds of the mode you
  // just left. The override is this session's edits to the key it belongs to, so
  // it stops applying the moment the key changes — no effect has to reset it.
  const storedCollapsedCols = useMemo(() => {
    if (typeof window === 'undefined') return ['__hidden__'];
    try {
      const saved = localStorage.getItem(collapsedKey);
      return saved ? JSON.parse(saved) : ['__hidden__'];
    } catch {
      return ['__hidden__'];
    }
  }, [collapsedKey]);
  const [collapsedOverride, setCollapsedOverride] = useState(null);
  const collapsedCols = collapsedOverride?.key === collapsedKey
    ? collapsedOverride.columnIds
    : storedCollapsedCols;

  const toggleColumnCollapse = (id) => {
    const next = collapsedCols.includes(id)
      ? collapsedCols.filter(c => c !== id)
      : [...collapsedCols, id];
    setCollapsedOverride({ key: collapsedKey, columnIds: next });
    if (typeof window !== 'undefined') {
      localStorage.setItem(collapsedKey, JSON.stringify(next));
    }
  };

  useEffect(() => {
    if (dndReady) return;
    queueMicrotask(() => {
      dndReady = true;
      setMounted(true);
    });
  }, []);

  const onDragEnd = (result) => {
    if (isArchived || readOnly || selectionActive || !onMoveIssue) return;
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    // If swimlanes are active, droppableId is "laneId::columnId"
    const destParts = destination.droppableId.split('::');
    const sourceParts = source.droppableId.split('::');
    const destColId = destParts.length > 1 ? destParts[1] : destination.droppableId;
    const destLaneId = destParts.length > 1 ? destParts[0] : null;
    const sourceLaneId = sourceParts.length > 1 ? sourceParts[0] : null;

    if (destColId === '__hidden__') return; // Cannot drop into the combined hidden container

    let updateFields = null;
    if (destLaneId !== sourceLaneId) {
      if (swimlane === 'assignee') {
        if (destLaneId === 'assignee-unassigned') {
          updateFields = { assigneeIds: [] };
        } else if (destLaneId && destLaneId.startsWith('assignee-')) {
          updateFields = { assigneeIds: [destLaneId.replace('assignee-', '')] };
        }
      }
    }

    // The column the user was looking at, not an index into rows they could not
    // see. Filters, swimlanes and the cross-project columns of «Звернення»
    // all mean the visible list is a subset of what `order` numbers, so the
    // caller resolves this against its own scope. It used to be resolved here,
    // against a list sorted by a rule of its own, and a card that was dropped
    // between two others landed wherever that other rule had put them.
    const destinationLane = destLaneId
      ? swimlanes.find(lane => lane.id === destLaneId)
      : swimlanes[0];
    const destinationColumn = columns.find(column => column.id === destColId);
    const visibleColumnIds = columnCards(destinationLane?.issues || boardIssues, destinationColumn)
      .filter(candidate => candidate.id !== draggableId)
      .map(candidate => candidate.id);

    onMoveIssue(
      draggableId,
      destColId,
      { visibleColumnIds, visibleIndex: destination.index },
      updateFields,
    );
  };

  const swimlanes = (() => {
    if (swimlane === 'none') {
      return [{ id: 'all', title: null, issues: boardIssues }];
    }
    if (swimlane === 'assignee') {
      const grouped = {};
      boardIssues.forEach(i => {
        const aIds = i.assigneeIds && i.assigneeIds.length > 0 ? i.assigneeIds : ['unassigned'];
        aIds.forEach(uid => {
          if (!grouped[uid]) grouped[uid] = [];
          grouped[uid].push(i);
        });
      });
      const lanes = Object.entries(grouped).map(([uid, uIssues]) => {
         const member = members.find(m => (m.id || m.uid) === uid);
         return {
           id: `assignee-${uid}`,
           title: member ? member.name : 'Без виконавця',
           issues: uIssues
         };
      });
      return lanes.sort((a,b) => a.id === 'assignee-unassigned' ? 1 : -1);
    }
    if (swimlane === 'priority') {
      const lanePriorities = [...ensureSystemPriorities(priorities), NO_PRIORITY];
      const grouped = Object.fromEntries(lanePriorities.map(priority => [priority.id, []]));
      boardIssues.forEach(i => {
         const p = i.priority || NO_PRIORITY.id;
         if(grouped[p]) grouped[p].push(i);
      });
      return lanePriorities.map(priority => ({
        id: `priority-${priority.id}`,
        title: (
          <span className="flex items-center gap-2">
            <PriorityIcon priority={priority} priorities={priorities} />
            <span>{priority.label}</span>
          </span>
        ),
        issues: grouped[priority.id],
      })).filter(lane => lane.issues.length > 0);
    }
    return [{ id: 'all', title: null, issues: boardIssues }];
  })();

  // Column-major order mirrors how the eye scans this board. De-duplicating is
  // important for assignee swimlanes, where one task can legitimately appear
  // in more than one lane.
  const selectionOrder = (() => {
    const seen = new Set();
    return columns.flatMap(column => swimlanes.flatMap(lane => (
      columnCards(lane.issues, column)
    ))).filter(issue => {
      if (seen.has(issue.id)) return false;
      seen.add(issue.id);
      return true;
    }).map(issue => issue.id);
  })();

  const {
    active: selectionActive,
    activeSelectedIds: activeSelectedIssueIds,
    selectedIssues,
    toggle: toggleIssueSelection,
    toggleScope: toggleIssueScope,
    clear: clearSelection,
  } = useIssueSelection({
    issues: boardIssues,
    order: selectionOrder,
    scopeKey: selectionScopeKey || `${projectId || 'default'}:${byCategory ? 'category' : 'status'}`,
  });

  const toggleColumnSelection = column => {
    const ids = columnCards(boardIssues, column).map(issue => issue.id);
    toggleIssueScope(ids);
  };
  const applyBulkAction = async (action, value) => {
    const normalizedValue = action === 'status'
      ? { mode: byCategory ? 'category' : 'status', id: value }
      : value;
    await onBulkUpdate?.(action, normalizedValue, selectedIssues);
  };

  const columnActionMenu = (column, columnIssues) => {
    if (isArchived || column.isHiddenContainer || !onBulkUpdate) return null;
    const allSelected = columnIssues.length > 0
      && columnIssues.every(issue => activeSelectedIssueIds.has(issue.id));
    return (
      // The kebab and the plus beside it are one pair of controls: same 28px
      // box, same ghost weight, same hover. They were 20px boxes with a 16px
      // glyph crammed inside — a size that reads as a stray icon next to every
      // real button on the page, and made the horizontal "meatball" look
      // nothing like the vertical kebab the rest of the product uses.
      <ContextMenu
        trigger={(
          <Button
            style="ghost"
            size="icon-xs"
            icon={MoreVertical}
            composition="section-kebab"
            className="hover:!bg-white"
            aria-label={`Дії з колонкою ${column.label}`}
            title="Дії з колонкою"
          />
        )}
        items={[{
          label: allSelected ? 'Зняти вибір у колонці' : 'Вибрати всі у колонці',
          icon: CheckSquare,
          onClick: () => toggleColumnSelection(column),
        }]}
      />
    );
  };

  if (!mounted) {
    return null; // Avoid SSR hydration mismatches and React 18 strict mode DnD bug
  }

  return (
    <DragDropContext
      dragHandleUsageInstructions={UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS}
      onDragStart={dndAnnouncements.onDragStart}
      onDragUpdate={dndAnnouncements.onDragUpdate}
      onDragEnd={(result, provided) => {
        dndAnnouncements.onDragEnd(result, provided);
        onDragEnd(result);
      }}
    >
      {/* The board is its own horizontal viewport: the clipping box reaches the
          panel edges (`bleed-edges`) and the gutter lives inside the scroller
          (`bleed-gutter`). Both on one element cancelled out — the parent clip
          ate the bleed and left the padding lying over the outer columns. */}
      <div
        className="relative flex flex-col h-full overflow-hidden bleed-edges"
        data-scrolled-start={boardOverflow.start ? 'true' : 'false'}
        data-scrolled-end={boardOverflow.end ? 'true' : 'false'}
      >
        {/* A column leaving the viewport used to simply stop existing against
            the same colour it was drawn on. These two hairline gradients give
            it something to go under, and each only appears once there is
            actually something hidden on that side. */}
        <span aria-hidden className="scroll-shadow scroll-shadow--start" />
        <span aria-hidden className="scroll-shadow scroll-shadow--end" />

        {/* Column Headers (fixed at top only for swimlanes) */}
        {swimlanes.length > 1 && (
          <div ref={columnHeaderRef} className="flex gap-4 pb-2 shrink-0 overflow-hidden bleed-gutter">
            {columns.map(col => {
              const isCollapsed = collapsedCols.includes(col.id);
              const colTotalIssues = columnCards(boardIssues, col);

              if (isCollapsed) {
                return (
                  <div
                    key={col.id}
                    data-ui-surface="local"
                    className="flex flex-col items-center justify-start w-[48px] shrink-0 pt-4 pb-2 bg-canvas rounded-t-[12px] cursor-pointer hover:bg-zone-hover transition-colors"
                    onClick={() => toggleColumnCollapse(col.id)}
                    // The strip holds the chevron button, so it is not a
                    // `<button>` itself; it still answers the same two keys.
                    role="button"
                    tabIndex={0}
                    aria-expanded={false}
                    onKeyDown={event => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      toggleColumnCollapse(col.id);
                    }}
                  >
                    {/* The mirror image of the collapse control in the open header:
                        same component, same ghost style, same icon-sm box —
                        only the arrow points the other way. It used to be an
                        IconAction at a different size and weight, so the two
                        halves of one gesture read as unrelated buttons. The
                        strip itself carries the click; this is its affordance. */}
                    <Button
                      style="ghost"
                      size="icon-xs"
                      icon={ChevronRight}
                      className="mb-4 hover:!bg-white"
                      title="Розгорнути колонку"
                    />
                    <span className="w-[8px] h-[8px] rounded-full shrink-0 mb-4" style={{ background: col.color }} />
                    <h2 className="ui-type-column-title text-ink uppercase tracking-wide whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{col.label}</h2>
                    <Pill tone="count" size="md" className="mt-4">{colTotalIssues.length}</Pill>
                  </div>
                );
              }
              return (
                <div key={col.id} className="flex items-center justify-between w-[82vw] max-w-[320px] md:w-[280px] md:max-w-none shrink-0 px-4 pt-2 pb-1 rounded-t-[12px]">
                  <div className="flex min-w-0 items-center gap-[6px]">
                    <Button
                      onClick={() => toggleColumnCollapse(col.id)}
                      style="ghost"
                      size="icon-xs"
                      icon={ChevronLeft}
                      className="-ml-2 hover:!bg-white"
                      title="Згорнути колонку"
                    />
                    <span className="w-[8px] h-[8px] rounded-full" style={{ background: col.color }} />
                    <h2 className="ui-type-column-title text-ink uppercase tracking-wide truncate" title={col.label}>{col.label}</h2>
                    <Pill tone="count" size="md" className="ml-1">{colTotalIssues.length}</Pill>
                  </div>
                  <div className="flex items-center gap-1">
                    {columnActionMenu(col, colTotalIssues)}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Scrollable swimlanes area. The gutter is padding *inside* the
            scroller, so the outer columns rest on the page margin and then
            travel all the way to the panel edge when the board is scrolled. */}
        <div
          ref={boardScrollRef}
          onScroll={measureBoardOverflow}
          className={`flex-1 overflow-auto snap-x snap-mandatory md:snap-none bleed-gutter ${swimlanes.length === 1 ? 'overflow-y-hidden pb-2 flex flex-col' : 'pb-6'}`}
        >
          {swimlanes.map(lane => (
            <div key={lane.id} className={`mb-4 ${swimlanes.length === 1 ? 'flex-1 min-h-0 flex flex-col' : ''}`}>

              {/* A sticky heading strip, not a card: it holds the swimlane's
                  name while the board scrolls sideways under it. Marked local
                  for the same reason the other structural one-offs are. */}
              {swimlanes.length > 1 && (
                <div data-ui-surface="local" className="sticky left-0 flex items-center bg-canvas rounded-[6px] px-3 py-[6px] mb-2 w-max min-w-[200px]">
                  <h3 className="ui-type-item-title text-ink">{lane.title}</h3>
                  <Pill tone="count" size="md" className="ml-2">{lane.issues.length}</Pill>
                </div>
              )}

              <div className={`flex gap-4 ${swimlanes.length === 1 ? 'flex-1 min-h-0' : ''}`}>
                {columns.map(col => {
                  const colIssues = columnCards(lane.issues, col);

                  const dropId = swimlanes.length > 1 ? `${lane.id}::${col.id}` : col.id;
                  const shouldVirtualize = swimlanes.length === 1
                    && colIssues.length > COLUMN_VIRTUALIZATION_THRESHOLD;

                  const isCollapsed = collapsedCols.includes(col.id);

                  if (isCollapsed) {
                    return (
                      <div
                        key={col.id}
                        // `snap-start`, and not merely "no snap point". Below md
                        // the board snaps one column at a time, and a mandatory
                        // scroller may only come to rest on a snap point: a
                        // folded strip that declared none was simply not a place
                        // the board could stop. Folding the first column threw
                        // the scroll to the centre of the second one and pinned
                        // it there, so the strip sat past the left edge of the
                        // screen with no gesture that could bring it back — and
                        // the strip is the only way to unfold the column again.
                        // Its start edge lands on the gutter, so the whole
                        // 48px reads. Above md the scroller does not snap at
                        // all and this changes nothing.
                        className={`flex flex-col w-[48px] shrink-0 snap-start bg-canvas ${swimlanes.length === 1 ? 'rounded-[16px] cursor-pointer hover:bg-zone-hover transition-colors items-center py-4 h-full' : 'rounded-[12px]'}`}
                        style={{ minHeight: swimlanes.length > 1 ? '100px' : undefined }}
                        onClick={swimlanes.length === 1 ? () => toggleColumnCollapse(col.id) : undefined}
                        // Only the single-swimlane strip is clickable at all;
                        // with swimlanes the chevron inside each one is.
                        role={swimlanes.length === 1 ? 'button' : undefined}
                        tabIndex={swimlanes.length === 1 ? 0 : undefined}
                        aria-expanded={swimlanes.length === 1 ? false : undefined}
                        onKeyDown={swimlanes.length === 1 ? (event => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          toggleColumnCollapse(col.id);
                        }) : undefined}
                      >
                        {swimlanes.length === 1 && (
                          <>
                            <Button
                              style="ghost"
                              size="icon-xs"
                              icon={ChevronRight}
                              className="mb-4 hover:!bg-white"
                              title="Розгорнути колонку"
                            />
                            <span className="w-[8px] h-[8px] rounded-full shrink-0 mb-4" style={{ background: col.color }} />
                            <h2 className="ui-type-column-title text-ink uppercase tracking-wide whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{col.label}</h2>
                            <Pill tone="count" size="md" className="mt-4">{colIssues.length}</Pill>
                          </>
                        )}
                        {swimlanes.length > 1 && (
                          <div className="flex-1 border-2 border-dashed border-line/50 rounded-[12px] m-1" />
                        )}
                      </div>
                    );
                  }

                  // Колонка під курсором тьмяніє на один крок, а не на два.
                  //
                  // Вона була `#f0f0f2`, а під час переїзду на токени стала
                  // `bg-line` — тобто рівно #e9e9e9, той самий колір, яким
                  // намальоване кільце ховера на картці. Курсор над карткою — це
                  // курсор і над колонкою, тож колонка зафарбовувалась у колір
                  // кільця й з'їдала його: наш фірмовий ховер картки просто
                  // зникав на дошці. `zone-hover` тримає крок між ними.
                  return (
                    <div key={col.id} className={`flex flex-col w-[82vw] max-w-[320px] md:w-[280px] md:max-w-none shrink-0 snap-center bg-canvas hover:bg-zone-hover transition-colors duration-200 ${swimlanes.length === 1 ? 'rounded-[16px] h-full overflow-hidden' : 'rounded-[12px]'}`} style={{ minHeight: swimlanes.length > 1 ? '100px' : undefined }}>

                      {/* Integrated header if no swimlanes */}
                      {swimlanes.length === 1 && (
                        <div className="flex items-center justify-between px-4 pt-4 pb-3 shrink-0">
                          <div className="flex min-w-0 items-center gap-[6px]">
                            <Button
                              onClick={() => toggleColumnCollapse(col.id)}
                              style="ghost"
                              size="icon-xs"
                              icon={ChevronLeft}
                              className="-ml-2 hover:!bg-white"
                              title="Згорнути колонку"
                            />
                            <span className="w-[8px] h-[8px] rounded-full" style={{ background: col.color }} />
                            <h2 className="ui-type-column-title text-ink uppercase tracking-wide truncate" title={col.label}>{col.label}</h2>
                            <Pill tone="count" size="md" className="ml-1">{colIssues.length}</Pill>
                          </div>
                          <div className="flex items-center gap-1">
                            {columnActionMenu(col, colIssues)}
                          </div>
                        </div>
                      )}

                      {/* Card spacing lives in a margin on the cards, never in
                          `gap` here: gap is invisible to the drag library, which
                          sizes its placeholder from each card's own box. With a
                          gap the slot freed by lifting a card was 8px taller
                          than the placeholder replacing it, so the whole column
                          hopped on every lift and again on every drop. */}
                      {(() => {
                        const renderIssueCard = (issue, index, virtualProps = {}) => (
                          <IssueCard
                            key={issue.id}
                            className="mb-[8px]"
                            issue={issue}
                            issues={issues}
                            allIssues={contextIssues}
                            members={members}
                            labels={labels}
                            index={index}
                            projectId={issue.projectId || projectId}
                            projectName={showProjectName
                              ? projects.find(item => item.id === issue.projectId)?.name || project?.name
                              : project?.name}
                            showProjectName={showProjectName}
                            showAssignee={showAssignee}
                            issueLinks={issueLinks}
                            isArchived={isArchived || readOnly}
                            selected={activeSelectedIssueIds.has(issue.id)}
                            selectionActive={selectionActive}
                            onSelect={onBulkUpdate ? toggleIssueSelection : undefined}
                            showStatusName={byCategory && (
                              col.isHiddenContainer || multiStatusColumnIds.has(col.id)
                            )}
                            {...virtualProps}
                          />
                        );

                        if (shouldVirtualize) {
                          return (
                            <VirtualDroppableColumn
                              dropId={dropId}
                              issues={colIssues}
                              isDropDisabled={col.isHiddenContainer || isArchived || readOnly || selectionActive}
                              className="qt-nav-scroll flex-1 p-[8px] transition-colors hide-scrollbar rounded-b-[16px] overflow-y-auto"
                              renderCard={renderIssueCard}
                            />
                          );
                        }

                        return (
                          <Droppable droppableId={dropId} isDropDisabled={col.isHiddenContainer || isArchived || readOnly || selectionActive}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.droppableProps}
                                className={`qt-nav-scroll flex-1 p-[8px] flex flex-col transition-colors hide-scrollbar ${swimlanes.length === 1 ? 'rounded-b-[16px] overflow-y-auto' : 'rounded-[12px]'} ${
                                  snapshot.isDraggingOver ? 'bg-chart-track/50' : ''
                                }`}
                              >
                                {colIssues.map((issue, index) => renderIssueCard(issue, index))}
                                {provided.placeholder}
                                <div className="shrink-0 h-[4px]" />
                              </div>
                            )}
                          </Droppable>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

            </div>
          ))}
        </div>
        <BulkActionBar
          count={onBulkUpdate ? activeSelectedIssueIds.size : 0}
          statusOptions={columns.filter(column => !column.isHiddenContainer).map(column => ({
            value: column.id,
            label: column.label,
            dotColor: column.color,
          }))}
          memberOptions={activeMembers(members).map(member => ({
            value: member.id || member.uid,
            label: member.name || member.email || 'Учасник',
            user: member,
          }))}
          priorityOptions={prioritySelectOptions(priorities)}
          labelOptions={labels.map(label => ({
            value: label.id,
            label: label.label,
            dotColor: label.color,
          }))}
          typeOptions={types.filter(type => type.id !== 'epic').map(taskTypeSelectOption)}
          canArchive={canArchive}
          onApply={applyBulkAction}
          onClear={clearSelection}
        />
      </div>
    </DragDropContext>
  );
}
