'use client';
// src/components/workspace/TimesheetTab.jsx — Табель (YouTrack-style timesheet)
// Data comes from the page-level useWorkspaceAnalytics (realtime, whole org),
// so admins/owners can see the whole team, not just their own logs.
// All controls (member, week/month, navigation) live in the page FilterBar;
// this component only renders the grid for the state it receives via props.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Clock, X } from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { Dialog, Button, CalendarDayCell, CalendarDayNumber, Card, FormGroup, Select, Input, EmptyState } from '@/components/ui';
import { DatePicker } from '@/components/ui/Forms/DatePicker';
import {
  calendarEventHref,
  calendarEventOccurrenceKey,
} from '@/lib/utils/calendarEventNavigation.mjs';
import { effectiveTimeLogDate } from '@/lib/utils/timeLogDates.mjs';
import { timesheetRange } from '@/lib/utils/analyticsWindow.mjs';
import { buildTimesheetExport, fileNameDate } from '@/lib/utils/analyticsExport.mjs';
import { createTaskTimeLogViaApi } from '@/lib/services/timeLogs';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { isArchivedIssue, withoutArchivedIssues } from '@/lib/utils/issueArchive.mjs';

// ── Working-time constants (like YouTrack: 1д = 8г, 1т = 5д) ────────────────
const DAY_MIN = 8 * 60;
const WEEK_MIN = 5 * DAY_MIN;
const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

// ── Helpers ──────────────────────────────────────────────────────────────────
// The week and the month this grid lays out are the same week and month the
// page bounded its Firestore query with — one definition, in
// `analyticsWindow.mjs`, so the range that was read and the range that is drawn
// cannot become two different answers.
function getWeekStart(date) {
  return timesheetRange('week', date).start;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function fmtMin(min) {
  if (!min) return '0г';
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return `${m}хв`;
  if (m === 0) return `${h}г`;
  return `${h}г ${m}хв`;
}

// Work-duration format: 500хв → "1д 20хв" (1д = 8 робочих годин)
function fmtWork(min) {
  if (!min) return '0г';
  const d = Math.floor(min / DAY_MIN);
  const h = Math.floor((min % DAY_MIN) / 60);
  const m = min % 60;
  const parts = [];
  if (d) parts.push(`${d}д`);
  if (h) parts.push(`${h}г`);
  if (m) parts.push(`${m}хв`);
  return parts.join(' ');
}

// ── Timesheet accent palette ─────────────────────────────────────────────────
// Saturated emerald/orange read badly against the grey canvas — the chips
// fought the content instead of ranking it. Muted, warm equivalents below keep
// text contrast above 4.5:1 on their own fill:
//   норма виконана  #e6f2ea / #2f6b4b   частково  #fdf0e3 / #9a5b18
//
// Green means one thing here and it is not «today»: it is «the day's norm is
// met». Today used to be a pale green wash too — a whole column of it in the
// team table — which spent the same colour on two unrelated facts and made a
// Thursday look like a Thursday everybody had finished. Today is marked the way
// the calendar marks it: the date in an ink circle, and nothing else.

// The day of the week over the date, with today's date in the calendar's ink
// circle. Every view in this file draws this line, and each used to draw it in
// its own green.
function DayHeading({ label, day, isToday, size = 'md' }) {
  return (
    <span className={`inline-flex items-center gap-[4px] font-bold uppercase ${
      size === 'sm' ? 'text-[9px]' : 'text-[11px]'
    } ${isToday ? 'text-ink' : 'text-muted'}`}>
      {label}
      <CalendarDayNumber state={isToday ? 'today' : 'default'} size={size}>
        {day.getDate()}
      </CalendarDayNumber>
    </span>
  );
}

// Colored capacity chip: "6г 20хв з 8г"
function DayChip({ minutes, capacity = DAY_MIN, compact = false }) {
  const cls = minutes >= capacity
    ? 'bg-success-soft text-success'
    : minutes > 0
      ? 'bg-warning-soft text-warning'
      : 'bg-line text-muted';
  return (
    <span className={`inline-flex items-center text-[11px] font-bold px-[8px] py-[3px] rounded-[6px] whitespace-nowrap ${cls}`}>
      {compact ? fmtMin(minutes) : `${fmtMin(minutes)} з ${capacity / 60}г`}
    </span>
  );
}

function logDate(log) {
  return effectiveTimeLogDate(log);
}

// ── Week view: one member — day columns with task cards (YouTrack style) ─────
function MemberWeek({ days, logs, issuesById, eventsByKey, todayKey }) {
  // Keep a small source snapshot beside the sum. A deleted task or event may
  // temporarily outlive its source while the undo/purge job catches up; the
  // timesheet must still name what the hours belonged to instead of drawing a
  // blank title.
  const byDay = useMemo(() => {
    const map = {};
    days.forEach(d => { map[dayKey(d)] = new Map(); });
    logs.forEach(log => {
      const d = logDate(log);
      if (!d) return;
      const key = dayKey(d);
      if (!map[key]) return;
      const targetKey = log.issueId || calendarEventOccurrenceKey(log.eventId, log.occurrenceStartAt);
      const current = map[key].get(targetKey) || {
        minutes: 0,
        sourceKey: '',
        sourceTitle: '',
      };
      map[key].set(targetKey, {
        minutes: current.minutes + (log.spentMinutes || 0),
        sourceKey: current.sourceKey || log.sourceKey || '',
        sourceTitle: current.sourceTitle || log.sourceTitle || log.description || '',
      });
    });
    return map;
  }, [days, logs]);

  return (
    <div className="overflow-x-auto hide-scrollbar full-bleed-mobile">
    <div className="grid grid-cols-7 gap-[10px] min-w-[840px] md:min-w-0">
      {days.map((d, i) => {
        const key = dayKey(d);
        const entries = [...(byDay[key]?.entries() || [])];
        const total = entries.reduce((sum, [, entry]) => sum + entry.minutes, 0);
        const isToday = key === todayKey;
        const isWeekend = i >= 5;
        return (
          <div key={key}
            className={`rounded-[16px] border p-[8px] flex flex-col gap-[8px] min-h-[260px] transition-colors ${
              isToday ? 'border-ink bg-white' : 'border-black/[0.05] bg-white'
            }`}>
            {/* Day header */}
            <div className="flex items-center justify-between px-[4px] pt-[2px]">
              <DayHeading label={DAY_LABELS[i]} day={d} isToday={isToday} />
              <DayChip minutes={total} capacity={isWeekend ? 0 : DAY_MIN} compact={isWeekend && total === 0} />
            </div>
            {/* Task cards */}
            {entries.map(([targetKey, entry]) => {
              const issue = issuesById[targetKey];
              const event = eventsByKey[targetKey];
              const href = issue ? issuePath(issue) : event ? calendarEventHref(event) : null;
              // The whole card, not the six characters of the key. It already
              // lit up on hover — a border that changes under the pointer is a
              // promise that the thing is clickable — and then only the
              // identifier answered, while the title right under it, which is
              // what a person actually reads and aims at, did nothing.
              const body = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    {issue ? (
                      <span
                        className={`text-[12px] font-bold truncate uppercase ${isArchivedIssue(issue) ? 'text-muted' : 'text-ink'}`}
                        title={isArchivedIssue(issue) ? 'Завдання в архіві' : undefined}>
                        {issue.issueKey || entry.sourceKey || targetKey.slice(0, 6)}
                      </span>
                    ) : event ? (
                      <span className="flex min-w-0 items-center gap-1 text-[12px] font-bold text-ink">
                        <CalendarIcon size={12} className="shrink-0 text-muted" />
                        <span className="truncate">Подія</span>
                      </span>
                    ) : (
                      // Nothing to open: the task behind this hour is not in the
                      // set this screen was handed. That used to be routine on a
                      // member's own page, which was given only their assigned
                      // tasks; it now means the task was deleted for real.
                      <span className="text-[12px] font-bold text-faint uppercase" title="Джерело запису більше не існує">
                        {entry.sourceKey || 'Видалено'}
                      </span>
                    )}
                    <span className="text-[12px] font-bold text-ink shrink-0">{fmtMin(entry.minutes)}</span>
                  </span>
                  {(issue?.title || event?.title || entry.sourceTitle) && (
                    <span className="block text-[11px] text-muted mt-[2px] line-clamp-2 leading-snug">
                      {issue?.title || event?.title || entry.sourceTitle}
                    </span>
                  )}
                </>
              );
              const cardClass = `block bg-white border border-line rounded-[12px] px-[10px] py-[8px] transition-colors ${
                href ? 'hover:border-faint' : ''
              }`;
              return href ? (
                <Link key={targetKey} href={href} data-ui-surface="local" className={cardClass}>
                  {body}
                </Link>
              ) : (
                <span key={targetKey} data-ui-surface="local" className={cardClass}>
                  {body}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
    </div>
  );
}

// ── Week view: whole team — rows per member (admin/owner) ────────────────────
/**
 * Один день однієї людини, розкладений по задачах.
 *
 * Сітка команди відповідала «скільки», і на цьому зупинялася: щоб дізнатися,
 * на що саме пішли ці чотири години, доводилось міняти весь екран на тиждень
 * цієї людини й шукати потрібний день очима. Питання ж майже завжди про одну
 * клітинку — ось вона й відповідає.
 *
 * @param {object} props.cell Кого й за який день відкрили; `null` — нічого.
 * @param {object[]} props.logs Записи часу вибраного діапазону.
 * @param {object} props.issuesById Задачі, щоб назвати рядок.
 * @param {object} props.eventsByKey Події календаря — час фіксують і на них.
 * @param {() => void} props.onClose Закриває панель.
 */
function DayBreakdownDialog({ cell, logs, members = [], issuesById, eventsByKey, onClose }) {
  const entries = useMemo(() => {
    if (!cell) return [];
    const wanted = dayKey(cell.day);
    const byTarget = new Map();
    logs.forEach(log => {
      // `uid` порожній — питають про весь день команди, а не про одну людину:
      // так відкривається клітинка місяця, де рядків на людину немає взагалі.
      if (cell.uid && log.userId !== cell.uid) return;
      const d = logDate(log);
      if (!d || dayKey(d) !== wanted) return;
      const targetKey = log.issueId || calendarEventOccurrenceKey(log.eventId, log.occurrenceStartAt);
      const current = byTarget.get(targetKey) || {
        minutes: 0,
        sourceKey: '',
        sourceTitle: '',
        descriptions: [],
        userIds: new Set(),
      };
      if (log.userId) current.userIds.add(log.userId);
      byTarget.set(targetKey, {
        minutes: current.minutes + (log.spentMinutes || 0),
        sourceKey: current.sourceKey || log.sourceKey || '',
        sourceTitle: current.sourceTitle || log.sourceTitle || '',
        descriptions: log.description
          ? [...current.descriptions, log.description]
          : current.descriptions,
        userIds: current.userIds,
      });
    });
    return [...byTarget.entries()]
      .map(([targetKey, entry]) => ({ targetKey, ...entry }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [cell, logs]);

  // Чиї це години — питання лише тоді, коли їх могло бути кілька людей.
  const contributorsOf = entry => (cell?.uid ? [] : [...entry.userIds]
    .map(uid => members.find(candidate => (candidate.id || candidate.uid) === uid))
    .filter(Boolean));

  const total = entries.reduce((sum, entry) => sum + entry.minutes, 0);

  return (
    <Dialog
      isOpen={Boolean(cell)}
      onClose={onClose}
      size="md"
      title={cell
        ? `${cell.member ? (cell.member.name || cell.member.email) : 'Уся команда'} · ${cell.day.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}`
        : ''}
      description={cell ? `Зафіксовано ${fmtMin(total)}` : ''}
      footer={<Button style="secondary" size="md" onClick={onClose}>Закрити</Button>}
    >
      {entries.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-faint">За цей день записів немає</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entries.map(entry => {
            const issue = issuesById[entry.targetKey];
            const event = eventsByKey[entry.targetKey];
            const href = issue ? issuePath(issue) : event ? calendarEventHref(event) : null;
            const title = issue?.title || event?.title || entry.sourceTitle || '';
            const label = issue?.issueKey || entry.sourceKey || (event ? 'Подія' : 'Видалено');
            const body = (
              <>
                <span className="flex items-center justify-between gap-3">
                  <span className="truncate text-[12px] font-bold uppercase text-ink">{label}</span>
                  <span className="shrink-0 text-[13px] font-bold text-ink">{fmtMin(entry.minutes)}</span>
                </span>
                {title && (
                  <span className="mt-[2px] block text-[12px] leading-snug text-muted line-clamp-2">{title}</span>
                )}
                {entry.descriptions.length > 0 && (
                  <span className="mt-1 block text-[11px] leading-snug text-faint line-clamp-2">
                    {entry.descriptions.join(' · ')}
                  </span>
                )}
                {contributorsOf(entry).length > 0 && (
                  <span className="mt-1.5 flex items-center gap-1.5">
                    {contributorsOf(entry).map(person => (
                      <UserAvatar key={person.id || person.uid} user={person} size="xs" tooltip />
                    ))}
                  </span>
                )}
              </>
            );
            const cardClass = `block rounded-[12px] border border-line bg-white px-3 py-2.5 transition-colors ${href ? 'hover:border-faint' : ''}`;
            return href ? (
              <Link key={entry.targetKey} href={href} data-ui-surface="local" className={cardClass} onClick={onClose}>
                {body}
              </Link>
            ) : (
              <div key={entry.targetKey} data-ui-surface="local" className={cardClass}>{body}</div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

function TeamWeek({ days, logs, members, todayKey, onSelectMember, onSelectCell }) {
  const rows = useMemo(() => {
    const perMember = {};
    logs.forEach(log => {
      const d = logDate(log);
      if (!d) return;
      const key = dayKey(d);
      if (!perMember[log.userId]) perMember[log.userId] = {};
      perMember[log.userId][key] = (perMember[log.userId][key] || 0) + (log.spentMinutes || 0);
    });
    return members
      .map(m => {
        const uid = m.id || m.uid;
        const byDay = perMember[uid] || {};
        const total = days.reduce((s, d) => s + (byDay[dayKey(d)] || 0), 0);
        return { m, uid, byDay, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [days, logs, members]);

  const dayTotals = days.map(d => rows.reduce((s, r) => s + (r.byDay[dayKey(d)] || 0), 0));

  return (
    <>
      <div className="space-y-3 lg:hidden">
        {rows.map(({ m, uid, byDay, total }) => (
          <Card
            key={uid}
            preset="bordered"
            padding="md"
            interactive
            onClick={() => onSelectMember?.(uid)}
            className="w-full"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={m} size="sm" />
                <span className="truncate text-[13px] font-bold text-ink">{m.name || m.email}</span>
              </div>
              <span className="shrink-0 text-[13px] font-bold text-ink">{total > 0 ? fmtMin(total) : '—'}</span>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {days.map((day, index) => {
                const minutes = byDay[dayKey(day)] || 0;
                const isToday = dayKey(day) === todayKey;
                // Те саме, що й у таблиці: день із годинами відповідає, на що
                // вони пішли. На телефоні картка учасника лишається натисною
                // сама по собі, тож клік по дню зупиняється тут.
                const pressable = minutes > 0 ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `Показати, на що витрачено цей час — ${m.name || m.email}`,
                  onClick: event => {
                    event.stopPropagation();
                    onSelectCell?.({ uid, member: m, day });
                  },
                  onKeyDown: event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectCell?.({ uid, member: m, day });
                  },
                } : {};
                return (
                  <div
                    key={dayKey(day)}
                    {...pressable}
                    className={`w-full rounded-[10px] px-1.5 py-2 text-center ${isToday ? 'border border-ink bg-white' : 'bg-canvas'} ${minutes > 0 ? 'cursor-pointer transition-colors hover:bg-line' : ''}`}
                  >
                    <DayHeading label={DAY_LABELS[index]} day={day} isToday={isToday} size="sm" />
                    <p className={`mt-1 text-[10px] font-bold ${minutes > 0 ? 'text-ink' : 'text-faint'}`}>
                      {minutes > 0 ? fmtMin(minutes) : '—'}
                    </p>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
        <Card preset="bordered-compact" padding="md">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Разом по команді</span>
            <span className="text-[14px] font-bold text-ink">{fmtMin(dayTotals.reduce((a, b) => a + b, 0))}</span>
          </div>
        </Card>
      </div>
      {/* Not the analytics table's chrome, and deliberately not. A week of days
          across the top and a person down the side is a calendar — the same
          week the «Календар» screen draws — and dressing it as a panel of
          figures with a canvas header band made it read as a report about the
          week instead of the week itself. The only thing it borrows from the
          calendar is how today is marked. */}
      <div className="hidden overflow-x-auto rounded-[16px] bg-white lg:block">
        <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-white">
            <th className="px-5 py-3 text-[11px] font-bold text-muted uppercase tracking-wider w-[24%]">Учасник</th>
            {days.map((d, i) => (
              <th key={i} className="border-l border-black/[0.04] bg-white px-2 py-3 text-center w-[9%]">
                <DayHeading label={DAY_LABELS[i]} day={d} isToday={dayKey(d) === todayKey} />
              </th>
            ))}
            <th className="px-4 py-3 text-center text-[11px] font-bold text-ink uppercase tracking-wider w-[13%]">Всього</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ m, uid, byDay, total }) => (
            // Ховер на весь рядок, а не на дві крайні колонки.
            //
            // Підсвітка стояла на `<tr>`, а кожна денна клітинка мала власний
            // `bg-white` — і перемальовувала її поверх. Виходило, що під
            // курсором сіріли тільки «Учасник» і «Всього», а сім колонок між
            // ними лишалися білими: рядок ніби розривався навпіл.
            //
            // Підпис теж інший. «Відкрити табель учасника» звучить як перехід
            // на чужу сторінку; насправді це і є відповідь на питання «на що
            // пішли ці години» — тиждень цієї людини розкладається по задачах.
            <tr key={uid} onClick={() => onSelectMember?.(uid)}
              className="group bg-white transition-colors cursor-pointer" title="Показати, на що витрачено цей час">
              <td className="px-5 py-3 transition-colors group-hover:bg-canvas/50">
                <div className="flex items-center gap-2 min-w-0">
                  <UserAvatar user={m} size="sm" />
                  <span className="text-[13px] font-semibold text-ink truncate">{m.name || m.email}</span>
                </div>
              </td>
              {days.map((d, i) => {
                const min = byDay[dayKey(d)] || 0;
                return (
                  <td key={i} className="border-l border-black/[0.04] bg-white px-2 py-3 text-center transition-colors group-hover:bg-canvas/50">
                    {/* Години в клітинці — це питання «на що саме», і тепер на
                        нього можна натиснути. Доти єдиною відповіддю був клік
                        по рядку, який міняв увесь екран на тиждень цієї людини;
                        а питають зазвичай про один день, а не про тиждень. */}
                    {min > 0 ? (
                      // Роль і клавіші на самій клітинці, а не вкладена
                      // кнопка: рядок навколо вже натисний, і контрол
                      // усередині контрола — це те, чого продукт скрізь
                      // уникає (`TaskRow`, рядок рахунку роблять так само).
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Показати, на що витрачено цей час — ${m.name || m.email}`}
                        onClick={event => {
                          event.stopPropagation();
                          onSelectCell?.({ uid, member: m, day: d });
                        }}
                        onKeyDown={event => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          event.stopPropagation();
                          onSelectCell?.({ uid, member: m, day: d });
                        }}
                        className="inline-flex cursor-pointer rounded-full transition-transform hover:scale-110"
                      >
                        <DayChip minutes={min} capacity={i >= 5 ? 0 : DAY_MIN} compact />
                      </span>
                    ) : <span className="text-[12px] text-faint">—</span>}
                  </td>
                );
              })}
              <td className="px-4 py-3 text-center transition-colors group-hover:bg-canvas/50">
                <span className="text-[13px] font-bold text-ink">{total > 0 ? fmtMin(total) : '—'}</span>
              </td>
            </tr>
          ))}
          {/* Team totals */}
          <tr className="border-t border-line bg-white">
            <td className="px-5 py-3 text-right text-[11px] font-bold text-ink uppercase tracking-wider">Разом</td>
            {dayTotals.map((min, i) => (
              <td key={i} className="border-l border-black/[0.04] bg-white px-2 py-3 text-center">
                <span className={`text-[12px] font-bold ${min > 0 ? 'text-ink' : 'text-muted'}`}>{min > 0 ? fmtMin(min) : '—'}</span>
              </td>
            ))}
            <td className="px-4 py-3 text-center">
              <span className="text-[14px] font-bold text-ink">{fmtMin(dayTotals.reduce((a, b) => a + b, 0))}</span>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
    </>
  );
}

// ── Month view: calendar grid with day totals ────────────────────────────────
function MonthGrid({ anchor, logs, todayKey, onSelectDay, onSelectCell, selectedMember }) {
  const weeks = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    const rows = [];
    let cursor = getWeekStart(first);
    while (cursor <= last) {
      rows.push(Array.from({ length: 7 }, (_, i) => addDays(cursor, i)));
      cursor = addDays(cursor, 7);
    }
    return rows;
  }, [anchor]);

  const byDay = useMemo(() => {
    const map = {};
    logs.forEach(log => {
      const d = logDate(log);
      if (!d) return;
      const key = dayKey(d);
      if (!map[key]) map[key] = { minutes: 0, issues: new Set() };
      map[key].minutes += log.spentMinutes || 0;
      if (log.issueId) map[key].issues.add(log.issueId);
    });
    return map;
  }, [logs]);

  return (
    <div className="overflow-x-auto hide-scrollbar full-bleed-mobile">
    <div className="flex flex-col gap-[10px] min-w-[560px] md:min-w-0">
      <div className="grid grid-cols-7 gap-[10px]">
        {DAY_LABELS.map(l => (
          <span key={l} className="text-[11px] font-bold text-muted uppercase text-center">{l}</span>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} className="grid grid-cols-7 gap-[10px]">
          {week.map((d, i) => {
            const key = dayKey(d);
            const cell = byDay[key];
            const inMonth = d.getMonth() === anchor.getMonth();
            const isToday = key === todayKey;
            const isWeekend = i >= 5;
            return (
              // День із годинами відповідає, на що вони пішли — так само, як
              // клітинка тижня. День без годин показувати нічого; там клік
              // лишається тим, чим був: перейти в цей тиждень.
              <CalendarDayCell
                key={key}
                state={!inMonth ? 'outside' : isToday ? 'today' : isWeekend ? 'weekend' : 'default'}
                onClick={() => (cell?.minutes > 0
                  ? onSelectCell?.({ uid: selectedMember ? (selectedMember.id || selectedMember.uid) : '', member: selectedMember || null, day: d })
                  : onSelectDay?.(d))}
                title={cell?.minutes > 0 ? 'Показати, на що витрачено цей час' : 'Відкрити тиждень'}
              >
                <CalendarDayNumber state={isToday ? 'today' : inMonth ? 'default' : 'outside'}>
                  {d.getDate()}
                </CalendarDayNumber>
                {cell?.minutes > 0 && (
                  <>
                    <DayChip minutes={cell.minutes} capacity={isWeekend ? 0 : DAY_MIN} compact />
                    <span className="text-[10px] text-muted font-medium">
                      {cell.issues.size} завд.
                    </span>
                  </>
                )}
              </CalendarDayCell>
            );
          })}
        </div>
      ))}
    </div>
    </div>
  );
}

// ── "Зафіксувати час" modal ───────────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function LogTimeModal({ isOpen, onClose, projects, issues }) {
  const { activeOrgId } = useAppContext();
  const showToast = useWorkspaceStore(s => s.showToast);
  const [projectId, setProjectId] = useState('');
  const [issueId, setIssueId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const effectiveProjectId = projectId || projects[0]?.id || '';
  // `issues` is the whole record, archived included, so that a card can name
  // the task an old entry belongs to. New time is a different matter: you do
  // not book hours against something that has been put aside.
  const projectIssues = useMemo(
    () => withoutArchivedIssues(issues)
      .filter(i => i.projectId === effectiveProjectId)
      .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0)),
    [issues, effectiveProjectId]
  );

  const handleSave = async () => {
    const parsedHours = hours.trim() ? Number(hours) : 0;
    const parsedMinutes = mins.trim() ? Number(mins) : 0;
    const validDurationParts = (
      Number.isSafeInteger(parsedHours)
      && parsedHours >= 0
      && Number.isSafeInteger(parsedMinutes)
      && parsedMinutes >= 0
      && parsedMinutes <= 59
    );
    const spentMinutes = validDurationParts
      ? (parsedHours * 60) + parsedMinutes
      : Number.NaN;
    const targetIssue = issues.find(i => i.id === issueId);
    if (!targetIssue) { showToast('Оберіть завдання', 'error'); return; }
    if (
      !Number.isSafeInteger(spentMinutes)
      || spentMinutes <= 0
      || spentMinutes > 525_600
    ) {
      showToast('Вкажіть коректний витрачений час', 'error');
      return;
    }
    if (
      !activeOrgId
      || targetIssue.organizationId !== activeOrgId
      || !targetIssue.projectId
    ) {
      showToast('Завдання не належить активній організації', 'error');
      return;
    }
    setSaving(true);
    try {
      const [y, m, d] = date.split('-').map(Number);
      const loggedAt = new Date(y, m - 1, d, 12, 0, 0);
      if (
        !Number.isSafeInteger(y)
        || !Number.isSafeInteger(m)
        || !Number.isSafeInteger(d)
        || !Number.isFinite(loggedAt.getTime())
        || loggedAt.getFullYear() !== y
        || loggedAt.getMonth() !== m - 1
        || loggedAt.getDate() !== d
      ) {
        throw new Error('Некоректна дата');
      }
      await createTaskTimeLogViaApi({
        organizationId: activeOrgId,
        projectId: targetIssue.projectId,
        issueId: targetIssue.id,
        spentMinutes,
        description: desc,
        loggedAt: loggedAt.toISOString(),
      });
      showToast('Час зафіксовано');
      setIssueId(''); setHours(''); setMins(''); setDesc('');
      onClose();
    } catch (err) {
      showToast('Помилка: ' + err.message, 'error');
    }
    setSaving(false);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Зафіксувати час"
      size="sm"
      footer={
        <>
          <Button style="secondary" size="md" onClick={onClose}>Скасувати</Button>
          <Button style="primary" size="md" onClick={handleSave} loading={saving}>Зберегти</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormGroup label="Проєкт" gap="md">
            <Select
              value={effectiveProjectId}
              onChange={val => { setProjectId(val); setIssueId(''); }}
              options={projects.map(p => ({ value: p.id, label: p.name }))}
            />
          </FormGroup>
          <FormGroup label="Дата" gap="md">
            <DatePicker value={date} onChange={val => setDate(val || todayStr())} />
          </FormGroup>
        </div>

        {/* Проєкт має сотні завдань, і людина, яка фіксує час, знає або номер
            із чату, або кілька слів із назви. Список без пошуку означав
            прокрутку до потрібного рядка — тому тут селектор із пошуком, а
            підпис опції починається з номера, щоб «142» знаходило QT-142. */}
        <FormGroup label="Завдання" gap="md">
          <Select
            searchable
            searchPlaceholder="Пошук за назвою або номером"
            value={issueId}
            onChange={setIssueId}
            options={[
              { value: '', label: projectIssues.length ? 'Оберіть завдання...' : 'У проєкті немає завдань' },
              ...projectIssues.map(i => ({ value: i.id, label: `${i.issueKey || ''} ${i.title}`.trim() })),
            ]}
          />
        </FormGroup>

        {/* Та сама пара полів, що й у трекінгу часу всередині завдання: ті самі
            composition-и, та сама висота, ті самі підписи. Це одна дія, і
            виглядати вона має однаково, де б людина її не робила. */}
        <FormGroup label="Час" gap="md">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input size="lg" type="number" min="0" placeholder="0" value={hours} onChange={e => setHours(e.target.value)} composition="duration-hours" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted pointer-events-none">год</span>
            </div>
            <div className="relative flex-1">
              <Input size="lg" type="number" min="0" max="59" placeholder="0" value={mins} onChange={e => setMins(e.target.value)} composition="duration-minutes" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted pointer-events-none">хв</span>
            </div>
          </div>
        </FormGroup>

        <FormGroup label="Опис (необовʼязково)" gap="md">
          <Input
            placeholder="Що було зроблено?"
            value={desc}
            maxLength={2000}
            onChange={e => setDesc(e.target.value)}
          />
        </FormGroup>
      </div>
    </Dialog>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TimesheetTab({
  issues = [],
  events = [],
  timeLogs = [],
  members = [],
  projects = [],
  member = 'all',          // 'all' | uid
  mode = 'week',           // 'week' | 'month'
  anchor = new Date(),
  onSelectMember,
  onSelectDay,
  logModalOpen = false,
  onCloseLogModal,
  // Only the workspace screen passes these: the same grid is rendered again
  // inside a member's own page, and the tab that owns the header is the one
  // that owns the export.
  onExportReady,
  formatDate,
}) {
  const todayKey = dayKey(new Date());
  const isTeam = member === 'all';
  // Яку клітинку сітки зараз читають: кого й за який день. `null` — жодну.
  const [dayBreakdown, setDayBreakdown] = useState(null);

  const issuesById = useMemo(() => {
    const map = {};
    issues.forEach(i => { map[i.id] = i; });
    return map;
  }, [issues]);
  const eventsByKey = useMemo(() => {
    const map = {};
    events.forEach(event => {
      map[calendarEventOccurrenceKey(event.sourceEventId || event.id, event.startAt)] = event;
    });
    return map;
  }, [events]);

  // Range for the current view
  const { rangeStart, rangeEnd, days, rangeLabel, capacity } = useMemo(() => {
    if (mode === 'week') {
      const { start, end } = timesheetRange('week', anchor);
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const endDay = addDays(start, 6);
      const sameMonth = start.getMonth() === endDay.getMonth();
      const label = `${start.toLocaleDateString('uk-UA', { day: 'numeric', month: sameMonth ? undefined : 'long' })} – ${endDay.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })}`;
      return { rangeStart: start, rangeEnd: end, days, rangeLabel: label, capacity: WEEK_MIN };
    }
    const { start, end } = timesheetRange('month', anchor);
    let workdays = 0;
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const wd = d.getDay();
      if (wd !== 0 && wd !== 6) workdays++;
    }
    const label = start.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' });
    return {
      rangeStart: start, rangeEnd: end, days: [],
      rangeLabel: label.charAt(0).toUpperCase() + label.slice(1),
      capacity: workdays * DAY_MIN,
    };
  }, [mode, anchor]);

  // Logs inside range, for selected member (or the whole team)
  const rangeLogs = useMemo(() => {
    return timeLogs.filter(log => {
      const d = logDate(log);
      if (!d || d < rangeStart || d >= rangeEnd) return false;
      if (!isTeam && log.userId !== member) return false;
      return true;
    });
  }, [timeLogs, rangeStart, rangeEnd, isTeam, member]);

  const totalMin = rangeLogs.reduce((s, l) => s + (l.spentMinutes || 0), 0);
  const selectedMember = !isTeam ? members.find(m => (m.id || m.uid) === member) : null;
  const teamCapacity = isTeam ? capacity * Math.max(members.length, 1) : capacity;

  // The grid is a reading; the file is the same records laid out one per row,
  // because a matrix has to be taken apart before it can be summed, pivoted or
  // attached to an invoice. The totals are identical either way.
  const buildExport = useCallback(() => buildTimesheetExport({
    logs: rangeLogs,
    members,
    issues,
    events,
    projects,
    rangeLabel,
    memberLabel: isTeam
      ? 'Вся команда'
      : (selectedMember?.name || selectedMember?.email || 'Учасник'),
    formatDate,
    dateOf: logDate,
    eventKeyOf: (source, isLog) => (isLog
      ? calendarEventOccurrenceKey(source.eventId, source.occurrenceStartAt)
      : calendarEventOccurrenceKey(source.sourceEventId || source.id, source.startAt)),
    fileDates: [fileNameDate(rangeStart), fileNameDate(addDays(rangeEnd, -1))],
  }), [
    events, formatDate, isTeam, issues, members, projects,
    rangeEnd, rangeLabel, rangeLogs, rangeStart, selectedMember,
  ]);
  useEffect(() => {
    onExportReady?.(buildExport);
    return () => onExportReady?.(null);
  }, [buildExport, onExportReady]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="w-full pb-16">

        {/* Range heading + spent summary */}
        <div className="flex items-end justify-between gap-4 flex-wrap mb-5 pt-1">
          <div className="flex items-center gap-3 min-w-0">
            {/* Куди ви потрапили — і як звідси вийти.
                Вибір учасника мовчки підміняв сітку команди тижнем однієї
                людини, і фішка з обличчям читалась як заголовок чужої
                сторінки — «якогось хуя відкрився профіль». Це не профіль, це
                той самий табель, звужений до одного учасника; тепер фішка про
                це каже й має вихід назад до всієї команди. */}
            {selectedMember && (
              <div data-ui-surface="local" className="flex items-center gap-2 bg-canvas rounded-full pl-[4px] pr-[6px] py-[4px]">
                <UserAvatar user={selectedMember} size="sm" />
                <span className="text-[13px] font-bold text-ink truncate">{selectedMember.name || selectedMember.email}</span>
                {onSelectMember && (
                  <Button
                    style="ghost"
                    size="icon-sm"
                    icon={X}
                    onClick={() => onSelectMember('all')}
                    aria-label="Показати всю команду"
                    title="Показати всю команду"
                  />
                )}
              </div>
            )}
            <h2 className="ui-type-detail-title text-ink tracking-tight">{rangeLabel}</h2>
          </div>
          <p className="text-[13px] text-muted font-medium">
            {/* Коли на екрані одна людина, тиждень розкладено по задачах — і про
                це варто сказати, бо клік по рядку команди виглядав як «кудись
                перекинуло», а не як «ось на що пішли ці години». */}
            {selectedMember && <span className="mr-2 text-faint">На що витрачено ·</span>}
            Витрачений час{' '}
            <span className="text-ink font-bold">{fmtWork(totalMin)}</span>
            {' '}з <span className="font-semibold">{fmtWork(teamCapacity)}</span>
            {isTeam && <span className="text-faint"> · {members.length} учасн.</span>}
          </p>
        </div>

        {/* Grid */}
        {timeLogs.length === 0 ? (
          <EmptyState icon={Clock} title="Даних ще немає" description="Логи часу з’являться після трекінгу завдань або подій" />
        ) : mode === 'week' ? (
          isTeam
            ? <TeamWeek days={days} logs={rangeLogs} members={members} todayKey={todayKey} onSelectMember={onSelectMember} onSelectCell={setDayBreakdown} />
            : <MemberWeek days={days} logs={rangeLogs} issuesById={issuesById} eventsByKey={eventsByKey} todayKey={todayKey} />
        ) : (
          <MonthGrid
            anchor={anchor}
            logs={rangeLogs}
            todayKey={todayKey}
            onSelectDay={onSelectDay}
            onSelectCell={setDayBreakdown}
            selectedMember={selectedMember}
          />
        )}

        {mode === 'week' && !isTeam && rangeLogs.length === 0 && (
          <p className="text-center text-[13px] text-muted mt-6">Немає залогованого часу за цей тиждень</p>
        )}
      </div>

      <DayBreakdownDialog
        cell={dayBreakdown}
        logs={rangeLogs}
        members={members}
        issuesById={issuesById}
        eventsByKey={eventsByKey}
        onClose={() => setDayBreakdown(null)}
      />

      <LogTimeModal
        isOpen={logModalOpen}
        onClose={onCloseLogModal}
        projects={projects}
        issues={issues}
      />
    </div>
  );
}
