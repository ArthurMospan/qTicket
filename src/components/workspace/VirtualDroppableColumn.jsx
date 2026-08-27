'use client';
// src/components/workspace/VirtualDroppableColumn.jsx — one scrolling, droppable
// column that keeps only a viewport-sized window of cards in the DOM.
//
// It lives beside the board because the board is where it was written, but it is
// not a board part: any long single-column list of draggable tasks needs the
// same thing, and the sprint backlog needs it most — an organization with four
// hundred unplanned tasks used to mount four hundred cards, each of which scans
// every task on the page for its parent and its children.
//
// Every task stays inside the scroll range and inside the drag model. This is
// virtualization, not pagination: there is no "show more" and nothing is hidden
// behind a control.
import { Droppable } from '@hello-pangea/dnd';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

const ESTIMATED_CARD_HEIGHT = 178;
const CARD_GUTTER = 8;
const VIRTUAL_OVERSCAN = 2;

function MeasuredVirtualCard({ issue, index, top, onMeasure, renderCard }) {
  const [cardNode, setCardNode] = useState(null);

  useLayoutEffect(() => {
    if (!cardNode) return undefined;
    const report = () => onMeasure(
      issue.id,
      Math.ceil(cardNode.getBoundingClientRect().height) + CARD_GUTTER,
    );
    report();
    const observer = new ResizeObserver(report);
    observer.observe(cardNode);
    return () => observer.disconnect();
  }, [cardNode, issue.id, onMeasure]);

  return renderCard(issue, index, {
    cardRef: setCardNode,
    virtualStyle: {
      position: 'absolute',
      insetInline: 0,
      top,
    },
  });
}

// @hello-pangea/dnd's virtual mode expects the list to own its scroll height,
// render an overscanned window and provide a clone for the lifted card. Card
// heights are measured because task metadata makes them intentionally variable.
export default function VirtualDroppableColumn({
  dropId,
  issues,
  isDropDisabled,
  className,
  renderCard,
}) {
  const scrollRef = useRef(null);
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map());
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 600 });

  const measureViewport = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setViewport(current => {
      const next = { scrollTop: node.scrollTop, height: node.clientHeight || 600 };
      return current.scrollTop === next.scrollTop && current.height === next.height
        ? current
        : next;
    });
  }, []);

  useLayoutEffect(() => {
    measureViewport();
    const node = scrollRef.current;
    if (!node) return undefined;
    const observer = new ResizeObserver(measureViewport);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measureViewport]);

  const handleMeasure = useCallback((issueId, height) => {
    setMeasuredHeights(current => {
      if (current.get(issueId) === height) return current;
      const next = new Map(current);
      next.set(issueId, height);
      return next;
    });
  }, []);

  const layout = useMemo(() => {
    const rows = [];
    for (const issue of issues) {
      const height = measuredHeights.get(issue.id) || ESTIMATED_CARD_HEIGHT;
      const previous = rows.at(-1);
      rows.push({
        top: previous ? previous.top + previous.height : 0,
        height,
      });
    }
    const last = rows.at(-1);
    return { rows, totalHeight: last ? last.top + last.height : 0 };
  }, [issues, measuredHeights]);

  const visibleRange = useMemo(() => {
    if (issues.length === 0) return { start: 0, end: 0 };
    const viewportStart = viewport.scrollTop;
    const viewportEnd = viewportStart + viewport.height;
    let start = 0;
    while (
      start < layout.rows.length
      && layout.rows[start].top + layout.rows[start].height < viewportStart
    ) start += 1;
    let end = start;
    while (end < layout.rows.length && layout.rows[end].top < viewportEnd) end += 1;
    return {
      start: Math.max(0, start - VIRTUAL_OVERSCAN),
      end: Math.min(issues.length, end + VIRTUAL_OVERSCAN),
    };
  }, [issues.length, layout.rows, viewport.height, viewport.scrollTop]);

  return (
    <Droppable
      droppableId={dropId}
      isDropDisabled={isDropDisabled}
      mode="virtual"
      renderClone={(provided, snapshot, rubric) => {
        const issue = issues[rubric.source.index];
        return issue ? renderCard(issue, undefined, {
          dragProvided: provided,
          dragSnapshot: snapshot,
        }) : null;
      }}
    >
      {(provided, snapshot) => (
        <div
          ref={node => {
            scrollRef.current = node;
            provided.innerRef(node);
          }}
          {...provided.droppableProps}
          onScroll={measureViewport}
          className={`${className} ${snapshot.isDraggingOver ? 'bg-chart-track/50' : ''}`}
        >
          <div
            className="relative shrink-0"
            style={{
              height: layout.totalHeight + (snapshot.isUsingPlaceholder ? ESTIMATED_CARD_HEIGHT : 0),
              minHeight: '4px',
            }}
          >
            {issues.slice(visibleRange.start, visibleRange.end).map((issue, offset) => {
              const index = visibleRange.start + offset;
              return (
                <MeasuredVirtualCard
                  key={issue.id}
                  issue={issue}
                  index={index}
                  top={layout.rows[index].top}
                  onMeasure={handleMeasure}
                  renderCard={renderCard}
                />
              );
            })}
          </div>
        </div>
      )}
    </Droppable>
  );
}
