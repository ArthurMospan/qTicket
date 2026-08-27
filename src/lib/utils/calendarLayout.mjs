export const MINUTES_PER_DAY = 24 * 60;
// Enough height that a 15-minute meeting is still readable.
const MIN_EVENT_MINUTES = 20;

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

// Where a timed event sits inside one day column, in minutes from midnight.
//
// The grid used to render only 07:00–22:00 and clamp everything else with
// Math.max(0, …): a 03:00 meeting was drawn at 07:00 and a 23:00 one got a
// negative height and escaped the container. Events are now placed against the
// full day and clipped to it, and an event spanning midnight appears on every
// day it covers rather than only on the day it started.
export function dayEventBounds(event, day) {
  const dayStart = startOfLocalDay(day).getTime();
  const dayEnd = dayStart + MINUTES_PER_DAY * 60_000;
  const start = new Date(event.startAt).getTime();
  const rawEnd = new Date(event.endAt).getTime();
  if (!Number.isFinite(start)) return null;
  // A missing or inverted end is treated as a zero-length event rather than
  // producing a negative box.
  const end = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start;
  if (start >= dayEnd || end <= dayStart) return null;

  const startMinutes = Math.max(0, Math.round((start - dayStart) / 60_000));
  const endMinutes = Math.min(MINUTES_PER_DAY, Math.round((end - dayStart) / 60_000));
  const height = Math.max(MIN_EVENT_MINUTES, endMinutes - startMinutes);
  return {
    startMinutes,
    endMinutes,
    top: startMinutes,
    height: Math.min(height, MINUTES_PER_DAY - startMinutes),
    continuesBefore: start < dayStart,
    continuesAfter: end > dayEnd,
  };
}

// Side-by-side placement for events that overlap in time. Previously every
// event was absolutely positioned across the full column width, so concurrent
// meetings were stacked on top of each other and only the last one was visible.
//
// Events are grouped into clusters of transitively overlapping items; within a
// cluster each event takes the first free lane, and the cluster is split into
// as many columns as its widest overlap needs.
export function layoutDayEvents(events, day) {
  const placed = (Array.isArray(events) ? events : [])
    .map(event => ({ event, bounds: dayEventBounds(event, day) }))
    .filter(item => item.bounds !== null)
    .sort((a, b) => a.bounds.startMinutes - b.bounds.startMinutes
      || b.bounds.height - a.bounds.height);

  const result = [];
  let cluster = [];
  let clusterEnd = -1;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds = [];
    for (const item of cluster) {
      let lane = laneEnds.findIndex(end => end <= item.bounds.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = item.bounds.startMinutes + item.bounds.height;
      item.lane = lane;
    }
    const lanes = laneEnds.length;
    for (const item of cluster) {
      result.push({
        event: item.event,
        top: item.bounds.top,
        height: item.bounds.height,
        continuesBefore: item.bounds.continuesBefore,
        continuesAfter: item.bounds.continuesAfter,
        lane: item.lane,
        lanes,
        widthPercent: 100 / lanes,
        leftPercent: (100 / lanes) * item.lane,
      });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of placed) {
    if (cluster.length && item.bounds.startMinutes >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bounds.startMinutes + item.bounds.height);
  }
  flush();
  return result;
}
