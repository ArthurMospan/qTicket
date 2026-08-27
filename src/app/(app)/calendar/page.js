'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CakeSlice,
  ChevronLeft,
  ChevronRight,
  Flag,
  List,
  LockKeyhole,
  Plus,
  RefreshCw,
  Users,
} from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useCalendarEvents } from '@/lib/hooks/useCalendarEvents';
import { isCalendarEventOnDay } from '@/lib/utils/calendarEventDates.mjs';
import { MINUTES_PER_DAY, layoutDayEvents } from '@/lib/utils/calendarLayout.mjs';
import { calendarEventHref } from '@/lib/utils/calendarEventNavigation.mjs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { fromDateInput, toLocalDateInput } from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import {
  Button,
  CalendarDayCell,
  CalendarDayNumber,
  CalendarEntry,
  CalendarHourSlot,
  EmptyState,
  IconAction,
  FilterBar,
  LoadingSpinner,
  PageHeader,
  Select,
  Surface,
  TextAction,
} from '@/components/ui';
import { MultiSelect } from '@/components/ui/Select';
import CalendarEventDialog, {
  CALENDAR_EVENT_TYPE_OPTIONS,
} from '@/components/workspace/calendar/CalendarEventDialog';

const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
// The full day is rendered so nothing has to be clamped; the grid scrolls to
// the start of the working day on open.
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const WORKDAY_START_HOUR = 7;
// Сірий, яким календар відсуває клітинку на другий план: вихідні у тижні, рядок
// «Весь день» і дні поза поточним місяцем.
//
// Він був `bg-canvas` — тобто рівно те саме #f4f4f5, що й полотно застосунку
// навколо картки календаря. Затінена клітинка всередині картки читалася як
// продовження фону зовні, і на вихідних край календаря просто зникав. Півтону
// вистачає: клітинка досі помітно відсунута від білого сусіда, але вже світліша
// за полотно, тож картка знову має власну межу.
const RECESSED_CELL = 'bg-canvas/50';
const TYPE_CONFIG = {
  ...Object.fromEntries(CALENDAR_EVENT_TYPE_OPTIONS.map(option => [option.value, option])),
  birthday: { label: 'День народження', color: '#db2777', bg: '#fdf2f8', icon: CakeSlice },
};

function FilterDivider() {
  return <span className="mx-[2px] h-[16px] w-px shrink-0 bg-line" />;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return date;
}

function addDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function addMonths(value, amount) {
  const date = new Date(value);
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  return date;
}

function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function deadlineDayKey(deadline, timeZone) {
  return toLocalDateInput(deadline?.dueDate, { timeZone });
}

function deadlineLocalDate(deadline, timeZone) {
  return fromDateInput(deadlineDayKey(deadline, timeZone));
}

function shortTime(value) {
  return new Date(value).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function monthTitle(date) {
  return titleCase(date.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' }));
}

// Everything one day holds, in the order it happens. The month grid, the phone
// picker and the day list all ask the same question, so they ask it once.
function dayItems(day, events, deadlines, timeZone) {
  const key = toLocalDateInput(day);
  return [
    ...events
      .filter(event => isCalendarEventOnDay(event, day))
      .map(item => ({ kind: 'event', item, time: new Date(item.startAt).getTime() })),
    ...deadlines
      .filter(deadline => deadlineDayKey(deadline, timeZone) === key)
      .map(item => ({ kind: 'deadline', item, time: deadlineLocalDate(item, timeZone)?.getTime() || 0 })),
  ].sort((a, b) => a.time - b.time);
}

function periodTitle(anchor, view) {
  if (view === 'month') return monthTitle(anchor);
  if (view === 'day') {
    return anchor.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  if (view === 'agenda') return 'Найближчі події';
  const start = startOfWeek(anchor);
  const end = addDays(start, 6);
  if (start.getMonth() === end.getMonth()) {
    return `${start.getDate()}–${end.getDate()} ${end.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })}`;
  }
  return `${start.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })} – ${end.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function eventTimeLabel(event) {
  if (event.allDay) return 'Весь день';
  return `${shortTime(event.startAt)}–${shortTime(event.endAt)}`;
}

function EventCard({ event, compact = false, onClick }) {
  const config = TYPE_CONFIG[event.type] || TYPE_CONFIG.event;
  const Icon = config.icon;
  return (
    <CalendarEntry
      tone="event"
      compact={compact}
      accent={config.color}
      background={config.bg}
      title={event.title}
      leading={<Icon size={compact ? 11 : 12} style={{ color: config.color }} className="shrink-0" />}
      trailing={event.visibility === 'private'
        ? <LockKeyhole size={10} className="ml-auto shrink-0 text-muted" aria-label="Приватна подія" />
        : null}
      meta={compact ? null : eventTimeLabel(event)}
      onClick={clickEvent => {
        clickEvent.stopPropagation();
        onClick(event);
      }}
    />
  );
}

function DeadlineCard({ deadline, compact = false, onClick }) {
  return (
    <CalendarEntry
      tone="deadline"
      compact={compact}
      dimmed={deadline.completed}
      leading={<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger-solid" />}
      title={`${deadline.issueKey ? `${deadline.issueKey} · ` : ''}${deadline.title}`}
      onClick={clickEvent => {
        clickEvent.stopPropagation();
        onClick(deadline);
      }}
    />
  );
}

// One day's entries, as a list. The «Порядок денний» view is built from these
// per day, and on a phone the month, the week and the day views all end in the
// same list — there is one shape for «what is on that day», not three.
function DayEntryList({ items, onEventClick, onDeadlineClick }) {
  return (
    <div className="space-y-[7px]">
      {items.map(({ kind, item }) => (
        kind === 'event' ? (
          <div key={`e-${item.id}`} className="flex items-center gap-[10px]">
            <span className="w-[70px] text-[11px] font-semibold text-muted shrink-0">{eventTimeLabel(item)}</span>
            <EventCard event={item} onClick={onEventClick} />
          </div>
        ) : (
          <div key={`d-${item.id}`} className="flex items-center gap-[10px]">
            <span className="w-[70px] text-[11px] font-semibold text-muted shrink-0">Дедлайн</span>
            <DeadlineCard deadline={item} onClick={onDeadlineClick} />
          </div>
        )
      ))}
    </div>
  );
}

function AllDayRow({ days, events, deadlines, timeZone, onEventClick, onDeadlineClick }) {
  return (
    <div className={`grid border-b border-line ${RECESSED_CELL}`} style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(120px, 1fr))` }}>
      <div className="px-2 py-2 text-[10px] font-semibold text-muted border-r border-line">Весь день</div>
      {days.map(day => {
        const dayEvents = events.filter(event => event.allDay && isCalendarEventOnDay(event, day));
        const dayDeadlines = deadlines.filter(deadline => (
          deadlineDayKey(deadline, timeZone) === toLocalDateInput(day)
        ));
        return (
          <div key={dateKey(day)} className="min-h-[48px] p-[5px] border-r last:border-r-0 border-line space-y-[4px]">
            {dayEvents.map(event => <EventCard key={event.id} event={event} compact onClick={onEventClick} />)}
            {dayDeadlines.map(deadline => <DeadlineCard key={deadline.id} deadline={deadline} compact onClick={onDeadlineClick} />)}
          </div>
        );
      })}
    </div>
  );
}

function ScheduleView({ anchor, view, events, deadlines, timeZone, onEventClick, onDeadlineClick, onCreate }) {
  const days = view === 'day'
    ? [startOfDay(anchor)]
    : Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index));
  const today = new Date();
  const rootRef = useRef(null);

  // The grid covers all 24 hours so nothing needs clamping; open it on the
  // working day instead of at midnight.
  useEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-auto');
    if (scroller) scroller.scrollTop = WORKDAY_START_HOUR * 60;
  }, [view]);

  return (
    <div ref={rootRef} className="min-w-[780px]">
      {/* The dates row is a sticky header, and it had the same hairline as the
          grid lines inside it — so nothing said where the header ended and the
          days began, and the only separation you ever saw was a stripe that
          appeared under the cursor and read as a rendering fault. A header that
          content scrolls under gets a real edge: a darker rule and the shadow
          that explains why it is still on screen. */}
      <div className="grid border-b border-ink/10 shadow-[0_2px_4px_-2px_rgba(0,0,0,0.08)] bg-white sticky top-0 z-10" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <div className="border-r border-line" />
        {days.map((day, index) => (
          <div key={dateKey(day)} className="h-[58px] flex items-center justify-center gap-2 border-r last:border-r-0 border-line">
            <span className="text-[10px] uppercase font-bold text-muted">{DAY_NAMES[day.getDay() === 0 ? 6 : day.getDay() - 1]}</span>
            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${
              sameDay(day, today) ? 'bg-ink text-white' : 'text-ink'
            }`}>{day.getDate()}</span>
            {view === 'week' && index > 4 && <span className="sr-only">Вихідний</span>}
          </div>
        ))}
      </div>

      <AllDayRow
        days={days}
        events={events}
        deadlines={deadlines}
        timeZone={timeZone}
        onEventClick={onEventClick}
        onDeadlineClick={onDeadlineClick}
      />

      <div className="grid" style={{ gridTemplateColumns: `64px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <div className="relative border-r border-line" style={{ height: MINUTES_PER_DAY }}>
          {HOURS.map(hour => (
            <span
              key={hour}
              // Every label is centred on its own hour line — except midnight,
              // which has no line above it to be centred on. Translated up like
              // the rest, half of "00:00" left the column and landed in the
              // all-day row, which is what made that row look crooked.
              className={`absolute right-2 text-[10px] font-medium text-muted ${hour === 0 ? '' : '-translate-y-1/2'}`}
              style={{ top: hour === 0 ? 4 : hour * 60 }}
            >
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {days.map(day => {
          // Laid out against the full 24 hours: a night-time event used to be
          // clamped onto the 07:00 row or pushed outside the container, and
          // concurrent events were drawn on top of each other.
          const timedEvents = events.filter(event => !event.allDay);
          const boxes = layoutDayEvents(timedEvents, day);
          return (
            <div
              key={dateKey(day)}
              className={`relative border-r last:border-r-0 border-line ${day.getDay() === 0 || day.getDay() === 6 ? RECESSED_CELL : 'bg-white'}`}
              style={{ height: MINUTES_PER_DAY }}
            >
              {HOURS.map(hour => (
                <CalendarHourSlot
                  key={hour}
                  label={`Створити подію о ${hour}:00`}
                  style={{ top: hour * 60, height: 60 }}
                  onClick={() => {
                    const start = new Date(day);
                    start.setHours(hour, 0, 0, 0);
                    onCreate(start);
                  }}
                />
              ))}
              {boxes.map(box => (
                <div
                  key={box.event.id}
                  className="absolute z-[2] px-[2px]"
                  style={{
                    top: box.top + 2,
                    height: Math.max(26, box.height - 4),
                    left: `${box.leftPercent}%`,
                    width: `${box.widthPercent}%`,
                  }}
                >
                  <EventCard event={box.event} compact={box.lanes > 2} onClick={onEventClick} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({ anchor, events, deadlines, timeZone, onEventClick, onDeadlineClick, onCreate, onSelectDay }) {
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const today = new Date();
  return (
    <div className="min-w-[760px]">
      <div className="grid grid-cols-7 border-b border-line bg-white">
        {DAY_NAMES.map(name => (
          <div key={name} className="h-[38px] flex items-center justify-center text-[10px] font-bold uppercase text-muted border-r last:border-r-0 border-line">{name}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map(day => {
          const items = dayItems(day, events, deadlines, timeZone);
          return (
            <div
              key={dateKey(day)}
              className={`min-h-[128px] p-[7px] border-r border-b border-line last:border-r-0 group ${
                day.getMonth() !== anchor.getMonth() ? RECESSED_CELL : 'bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-[6px]">
                <CalendarDayNumber
                  state={sameDay(day, today)
                    ? 'today'
                    : day.getMonth() === anchor.getMonth() ? 'default' : 'outside'}
                  onClick={() => onSelectDay(day)}
                >
                  {day.getDate()}
                </CalendarDayNumber>
                {/* The one control in the month grid with a relative in the
                    kit. `xs` is a 24px box at 7px radius, which is what this
                    was drawing by hand; the fade-in on cell hover stays here
                    because it is this grid's behaviour, not the button's. */}
                <IconAction
                  label="Додати подію"
                  icon={Plus}
                  size="xs"
                  appearance="quiet"
                  onClick={() => onCreate(day)}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                />
              </div>
              <div className="space-y-[4px]">
                {items.slice(0, 3).map(({ kind, item }) => kind === 'event'
                  ? <EventCard key={`e-${item.id}`} event={item} compact onClick={onEventClick} />
                  : <DeadlineCard key={`d-${item.id}`} deadline={item} compact onClick={onDeadlineClick} />)}
                {items.length > 3 && (
                  <TextAction tone="muted" size="xs" onClick={() => onSelectDay(day)} className="pl-1">
                    ще {items.length - 3}
                  </TextAction>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgendaView({ anchor, events, deadlines, timeZone, onEventClick, onDeadlineClick, onCreate }) {
  const start = startOfDay(anchor);
  const end = addDays(start, 60);
  const grouped = new Map();
  const addItem = (date, entry) => {
    const key = dateKey(date);
    if (!grouped.has(key)) grouped.set(key, { date: startOfDay(date), items: [] });
    grouped.get(key).items.push(entry);
  };
  events.forEach(event => {
    const startDate = new Date(event.startAt);
    if (startDate >= start && startDate < end) addItem(startDate, { kind: 'event', item: event, time: startDate.getTime() });
  });
  deadlines.forEach(deadline => {
    const dueDate = deadlineLocalDate(deadline, timeZone);
    if (dueDate && dueDate >= start && dueDate < end) {
      addItem(dueDate, { kind: 'deadline', item: deadline, time: dueDate.getTime() });
    }
  });
  const groups = [...grouped.values()].sort((a, b) => a.date - b.date);

  if (!groups.length) {
    return (
      <EmptyState
        icon={CalendarIcon}
        title="У найближчі 60 днів нічого немає"
        description="Створіть мітинг, подію або командне нагадування."
        action="Створити подію"
        onAction={() => onCreate(new Date())}
      />
    );
  }

  return (
    <div className="max-w-[920px] mx-auto p-[12px] md:p-[20px] space-y-[20px]">
      {groups.map(group => (
        <section key={dateKey(group.date)} className="grid grid-cols-1 md:grid-cols-[140px_1fr] gap-[8px] md:gap-[18px]">
          <div>
            <p className="text-[12px] font-bold text-ink">
              {sameDay(group.date, new Date()) ? 'Сьогодні' : group.date.toLocaleDateString('uk-UA', { weekday: 'long' })}
            </p>
            <p className="text-[11px] text-muted mt-0.5">{group.date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</p>
          </div>
          <DayEntryList
            items={group.items.sort((a, b) => a.time - b.time)}
            onEventClick={onEventClick}
            onDeadlineClick={onDeadlineClick}
          />
        </section>
      ))}
    </div>
  );
}

// ─── Телефон ────────────────────────────────────────────────────────────────
// Місячна сітка на телефоні — не зменшений десктоп. У 44 пікселях ширини
// вміщується число і кілька крапок, а не назви подій, тому сітка тут стає
// вибиралкою дня: тап відкриває день, а день читається тим самим списком, що
// й «Порядок денний». Тижневий вигляд — та сама вибиралка на один рядок,
// денний — сам список. Годинна сітка лишається десктопу: сім колонок по
// 120 пікселів у долоню не влазять ніяк.

// Скільки крапок вміщується під числом, перш ніж вони перестануть читатись.
const DAY_DOT_LIMIT = 3;

function entryDotColor(entry) {
  if (entry.kind === 'deadline') return '#ef4444';
  return (TYPE_CONFIG[entry.item.type] || TYPE_CONFIG.event).color;
}

function MobileDayTile({ day, items, selected, isToday, outside, onSelect }) {
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  const state = selected
    ? 'selected'
    : outside ? 'outside' : isToday ? 'today' : weekend ? 'weekend' : 'default';
  return (
    <CalendarDayCell
      density="compact"
      state={state}
      onClick={() => onSelect(day)}
      aria-label={`${day.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}${
        items.length ? `, записів: ${items.length}` : ', нічого не заплановано'
      }`}
    >
      <span className={`text-[13px] font-bold leading-none ${
        selected ? 'text-white' : outside ? 'text-faint' : 'text-ink'
      }`}>{day.getDate()}</span>
      <span className="flex h-[5px] items-center justify-center gap-[3px]">
        {items.slice(0, DAY_DOT_LIMIT).map((entry, index) => (
          <span
            key={index}
            className="h-[5px] w-[5px] rounded-full"
            style={{ backgroundColor: selected ? 'rgba(255,255,255,0.92)' : entryDotColor(entry) }}
          />
        ))}
      </span>
    </CalendarDayCell>
  );
}

function MobileCalendar({
  anchor,
  view,
  events,
  deadlines,
  timeZone,
  onSelectDay,
  onEventClick,
  onDeadlineClick,
  onCreate,
}) {
  const today = new Date();
  const selected = startOfDay(anchor);
  const rootRef = useRef(null);
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridDays = view === 'month'
    ? Array.from({ length: 42 }, (_, index) => addDays(startOfWeek(monthStart), index))
    : view === 'week'
      ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(anchor), index))
      : [];
  const selectedItems = dayItems(selected, events, deadlines, timeZone);

  // `useIsMobile` answers null on the first client render, so the hour grid
  // mounts for one frame before this does — and its opening scroll to the start
  // of the working day is left behind in the shared scroller. The phone layout
  // starts at its own top.
  useEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-auto');
    if (scroller) scroller.scrollTop = 0;
  }, []);

  return (
    <div ref={rootRef} className="flex flex-col">
      {gridDays.length > 0 && (
        <div className="border-b border-line px-[6px] py-[10px]">
          <div className="mb-[6px] grid grid-cols-7 gap-[3px]">
            {DAY_NAMES.map(name => (
              <span key={name} className="text-center text-[10px] font-bold uppercase text-muted">{name}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-[3px]">
            {gridDays.map(day => (
              <MobileDayTile
                key={dateKey(day)}
                day={day}
                items={dayItems(day, events, deadlines, timeZone)}
                selected={sameDay(day, selected)}
                isToday={sameDay(day, today)}
                outside={view === 'month' && day.getMonth() !== anchor.getMonth()}
                onSelect={onSelectDay}
              />
            ))}
          </div>
        </div>
      )}

      <section className="px-[10px] pb-[12px] pt-[14px]">
        <div className="mb-[10px] flex items-center justify-between gap-[8px]">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-ink">
              {sameDay(selected, today)
                ? 'Сьогодні'
                : titleCase(selected.toLocaleDateString('uk-UA', { weekday: 'long' }))}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              {selected.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}
            </p>
          </div>
          <Button style="secondary" size="sm" icon={Plus} onClick={() => onCreate(selected)}>Подія</Button>
        </div>
        {selectedItems.length > 0 ? (
          <DayEntryList
            items={selectedItems}
            onEventClick={onEventClick}
            onDeadlineClick={onDeadlineClick}
          />
        ) : (
          <EmptyState
            icon={CalendarIcon}
            density="compact"
            title="Цього дня нічого немає"
            description="Ні подій, ні дедлайнів задач."
          />
        )}
      </section>
    </div>
  );
}

export default function CalendarPage() {
  const router = useRouter();
  const { currentUser, projects, activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const { members } = useOrganization();
  const {
    events,
    deadlines,
    loading,
    error,
    refresh,
    createEvent,
  } = useCalendarEvents();
  const isMobile = useIsMobile();
  const showToast = useWorkspaceStore(state => state.showToast);
  const openEventQuickView = useWorkspaceStore(state => state.openEventQuickView);
  const calendarSearch = useWorkspaceStore(state => state.calendarSearch);
  const currentUserId = currentUser?.uid || currentUser?.id;
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [typeFilter, setTypeFilter] = useState('all');
  const [projectFilters, setProjectFilters] = useState([]);
  const [memberFilter, setMemberFilter] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialStart, setInitialStart] = useState(null);
  // A member profile can ask for a new event with that member already invited.
  const searchParams = useSearchParams();
  const requestedParticipant = searchParams.get('with') || '';
  const dialogParticipantIds = useMemo(
    () => (requestedParticipant ? [requestedParticipant] : []),
    [requestedParticipant],
  );
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    queueMicrotask(() => {
      setInitialStart(new Date());
      setDialogOpen(true);
    });
    const next = new URLSearchParams(searchParams.toString());
    next.delete('new');
    router.replace(next.size ? `/calendar?${next}` : '/calendar', { scroll: false });
  }, [router, searchParams]);

  const filteredEvents = useMemo(() => events.filter(event => {
    const search = calendarSearch.trim().toLowerCase();
    if (search && !`${event.title || ''} ${event.description || ''} ${event.location || ''}`.toLowerCase().includes(search)) return false;
    if (typeFilter !== 'all' && typeFilter !== event.type) return false;
    if (projectFilters.length && !projectFilters.includes(event.projectId)) return false;
    if (memberFilter !== 'all' && !event.participantIds?.includes(memberFilter)) return false;
    return true;
  }), [calendarSearch, events, memberFilter, projectFilters, typeFilter]);
  const filteredDeadlines = useMemo(() => deadlines.filter(deadline => {
    const search = calendarSearch.trim().toLowerCase();
    if (search && !`${deadline.issueKey || ''} ${deadline.title || ''}`.toLowerCase().includes(search)) return false;
    if (typeFilter !== 'all' && typeFilter !== 'deadline') return false;
    if (projectFilters.length && !projectFilters.includes(deadline.projectId)) return false;
    if (memberFilter !== 'all' && !deadline.assigneeIds?.includes(memberFilter)) return false;
    return true;
  }), [calendarSearch, deadlines, memberFilter, projectFilters, typeFilter]);
  usePublishLocalSearchResults(
    calendarSearch,
    filteredEvents.length + filteredDeadlines.length,
  );

  useEffect(() => {
    if (!events.length) return;
    const eventId = new URLSearchParams(window.location.search).get('event');
    if (!eventId) return;
    const matching = events.find(event => event.id === eventId || event.sourceEventId === eventId);
    if (matching) {
      router.replace(calendarEventHref(matching));
    }
  }, [events, router]);

  const movePeriod = direction => {
    setAnchor(previous => {
      if (view === 'month') return addMonths(previous, direction);
      if (view === 'week') return addDays(previous, direction * 7);
      if (view === 'agenda') return addDays(previous, direction * 30);
      return addDays(previous, direction);
    });
  };

  const openCreate = date => {
    setInitialStart(date || new Date());
    setDialogOpen(true);
  };

  // Reading an event should not cost you the month you were looking at. The
  // panel opens over the grid, and carries «на повній сторінці» for the times
  // the answer is «now edit the series».
  const openEvent = event => openEventQuickView(event);
  const openDeadline = deadline => router.push(
    issuePath(deadline, projects.find(project => project.id === deadline.projectId) || deadline.projectId),
  );

  const handleSave = async data => {
    await createEvent(data);
    setDialogOpen(false);
    showToast('Подію створено, запрошення надіслано', 'success');
  };

  const filterOptions = [
    { value: 'all', label: 'Усі типи', icon: CalendarIcon },
    ...Object.entries(TYPE_CONFIG).map(([value, config]) => ({ value, label: config.label, icon: config.icon })),
    { value: 'deadline', label: 'Дедлайни задач', icon: Flag },
  ];
  const projectOptions = [
    ...projects.filter(project => project.status !== 'archived').map(project => ({ value: project.id, label: project.name })),
  ];
  const memberOptions = [
    { value: 'all', label: 'Уся команда', icon: Users },
    ...members.map(member => ({
      value: member.id || member.uid,
      label: member.name || member.displayName || member.email || 'Учасник',
      user: member,
    })),
  ];

  return (
    <div className="flex-1 h-full overflow-hidden bg-transparent">
      <div className="workspace-page-layout h-full pb-[24px]">
        <PageHeader
          title="Календар"
          tabs={[
            { id: 'day', label: 'День' },
            { id: 'week', label: 'Тиждень' },
            { id: 'month', label: 'Місяць' },
            { id: 'agenda', label: 'Порядок денний', icon: List },
          ]}
          activeTab={view}
          onTabChange={setView}
          actions={<Button icon={Plus} collapseAt="sm" onClick={() => openCreate(new Date())}>Нова подія</Button>}
          filters={
            <>
              <FilterBar className="overflow-visible">
                <Select filterRole="type" variant="ghost" value={typeFilter} onChange={setTypeFilter} options={filterOptions} />
                <MultiSelect
                  variant="ghost"
                  value={projectFilters}
                  onChange={setProjectFilters}
                  options={projectOptions}
                  placeholder="Всі проєкти"
                  searchPlaceholder="Пошук проєкту..."
                  filterRole="project"
                />
                <Select filterRole="member" variant="ghost" value={memberFilter} onChange={setMemberFilter} options={memberOptions} />
                {/* Який тиждень ти дивишся — не фільтр. Нижче md рядок фільтрів
                    цілком їде в модалку, і разом із ним їхала єдина навігація
                    календаря: щоб перегорнути день, доводилось відкривати
                    «Фільтри». Тут вони ховаються, а власний рядок нижче їх
                    показує. */}
                <span className="contents max-md:hidden">
                  <FilterDivider />
                  <Button style="ghost" size="icon-sm" icon={ChevronLeft} onClick={() => movePeriod(-1)} aria-label="Попередній період" />
                  <Button style="ghost" size="sm" onClick={() => setAnchor(new Date())}>Сьогодні</Button>
                  <Button style="ghost" size="icon-sm" icon={ChevronRight} onClick={() => movePeriod(1)} aria-label="Наступний період" />
                  <FilterDivider />
                  <span className="max-w-[260px] truncate px-2 text-[12px] font-bold text-ink">{periodTitle(anchor, view)}</span>
                </span>
              </FilterBar>
            </>
          }
        />

        {/* Період, на телефоні: назва посередині, стрілки по краях. */}
        <div className="mb-[12px] flex items-center gap-[8px] md:hidden">
          <Button style="secondary" size="icon" icon={ChevronLeft} onClick={() => movePeriod(-1)} aria-label="Попередній період" />
          <span className="min-w-0 flex-1 truncate text-center text-[13px] font-bold text-ink">{periodTitle(anchor, view)}</span>
          <Button style="secondary" size="sm" onClick={() => setAnchor(new Date())}>Сьогодні</Button>
          <Button style="secondary" size="icon" icon={ChevronRight} onClick={() => movePeriod(1)} aria-label="Наступний період" />
        </div>

        <div className="flex flex-col gap-[12px] min-h-0 flex-1">
          <Surface preset="panel" padding="sm" className="min-h-0 flex-1 overflow-hidden">
            <div className="qt-nav-scroll h-full bg-white rounded-[12px] overflow-auto custom-scrollbar">
              {loading ? (
                <div className="h-full min-h-[320px] flex items-center justify-center"><LoadingSpinner size="md" /></div>
              ) : error ? (
                <EmptyState
                  icon={RefreshCw}
                  title="Не вдалося завантажити календар"
                  description={error.message}
                  action="Спробувати ще раз"
                  onAction={refresh}
                />
              ) : isMobile === true && view !== 'agenda' ? (
                <MobileCalendar
                  anchor={anchor}
                  view={view}
                  events={filteredEvents}
                  deadlines={filteredDeadlines}
                  timeZone={timeZone}
                  onSelectDay={setAnchor}
                  onEventClick={openEvent}
                  onDeadlineClick={openDeadline}
                  onCreate={openCreate}
                />
              ) : view === 'month' ? (
                <MonthView
                  anchor={anchor}
                  events={filteredEvents}
                  deadlines={filteredDeadlines}
                  timeZone={timeZone}
                  onEventClick={openEvent}
                  onDeadlineClick={openDeadline}
                  onCreate={openCreate}
                  onSelectDay={day => { setAnchor(day); setView('day'); }}
                />
              ) : view === 'agenda' ? (
                <AgendaView
                  anchor={anchor}
                  events={filteredEvents}
                  deadlines={filteredDeadlines}
                  timeZone={timeZone}
                  onEventClick={openEvent}
                  onDeadlineClick={openDeadline}
                  onCreate={openCreate}
                />
              ) : (
                <ScheduleView
                  anchor={anchor}
                  view={view}
                  events={filteredEvents}
                  deadlines={filteredDeadlines}
                  timeZone={timeZone}
                  onEventClick={openEvent}
                  onDeadlineClick={openDeadline}
                  onCreate={openCreate}
                />
              )}
            </div>
          </Surface>
        </div>
      </div>

      {dialogOpen && (
        <CalendarEventDialog
          isOpen
          initialStart={initialStart}
          initialParticipantIds={dialogParticipantIds}
          members={members}
          projects={projects}
          currentUserId={currentUserId}
          canManage
          onClose={() => {
            setDialogOpen(false);
            if (!requestedParticipant) return;
            const next = new URLSearchParams(searchParams.toString());
            next.delete('with');
            router.replace(next.size ? `/calendar?${next}` : '/calendar', { scroll: false });
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
