'use client';

import { useMemo, useState } from 'react';
import {
  BellRing,
  Clock3,
  ExternalLink,
  Flag,
  Link2,
  LockKeyhole,
  MapPin,
  Pencil,
  Repeat2,
  StickyNote,
  Trash2,
  Users,
  Video,
} from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Dialog,
  FormGroup,
  Input,
  Label,
  Pill,
  ResponseChoice,
  Select,
  Textarea,
  TimeLogRow,
  TimePicker,
  ToggleSwitch,
} from '@/components/ui';
import { MultiSelect } from '@/components/ui/Select';
import { useConfirm } from '@/components/ui/ConfirmProvider';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { useCalendarEventTimeLogs } from '@/lib/hooks/useCalendarEventTimeLogs';
import {
  POINT_EVENT_DURATION_MINUTES,
  applyCalendarEventTypeRules,
  calendarEventDefaultVisibility,
  calendarEventHasDuration,
  calendarEventInvitesOthers,
  calendarEventRequiresReminder,
  calendarEventSupportsPlace,
  calendarEventSupportsProject,
  calendarEventSupportsReminders,
  calendarEventSupportsRsvp,
  calendarEventSupportsTracking,
  calendarEventTypeLabel,
  calendarEventVisibilityOptionsFor,
  isKnownCalendarEventType,
  normalizeCalendarEventVisibility,
} from '@/lib/utils/calendarEventTypes.mjs';
import { MAX_CALENDAR_REMINDERS } from '@/lib/utils/calendarReminders.mjs';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { safeExternalUrl } from '@/lib/utils/externalUrls.mjs';
import {
  hasProjectAccess,
  hasRecordedTeam,
  isOnProjectTeam,
  isPrivilegedRole,
} from '@/lib/utils/projectAccess.mjs';
import { useAppContext } from '@/lib/context/AppContext';

// Only the presentation lives here — what each type *is* (and therefore which
// fields it may carry) is decided once in calendarEventTypes.mjs, which the
// server enforces too.
const TYPE_PRESENTATION = {
  meeting: { color: '#3b82f6', bg: '#eff6ff', icon: Video },
  event: { color: '#8b5cf6', bg: '#f5f3ff', icon: CalendarIcon },
  focus: { color: '#14b8a6', bg: '#f0fdfa', icon: Clock3 },
  absence: { color: '#f59e0b', bg: '#fffbeb', icon: Users },
  release: { color: '#ef4444', bg: '#fef2f2', icon: Flag },
  note: { color: '#64748b', bg: '#f8fafc', icon: StickyNote },
  reminder: { color: '#f97316', bg: '#fff7ed', icon: BellRing },
};

export const CALENDAR_EVENT_TYPE_OPTIONS = Object.entries(TYPE_PRESENTATION).map(
  ([value, presentation]) => ({ value, label: calendarEventTypeLabel(value), ...presentation }),
);

export const CALENDAR_EVENT_RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Не повторювати' },
  { value: 'daily', label: 'Щодня' },
  { value: 'weekly', label: 'Щотижня' },
  { value: 'monthly', label: 'Щомісяця' },
];

export const CALENDAR_EVENT_REMINDER_OPTIONS = [
  { value: 0, label: 'У момент початку' },
  { value: 5, label: 'За 5 хвилин' },
  { value: 10, label: 'За 10 хвилин' },
  { value: 15, label: 'За 15 хвилин' },
  { value: 30, label: 'За 30 хвилин' },
  { value: 60, label: 'За 1 годину' },
  { value: 120, label: 'За 2 години' },
  { value: 1440, label: 'За 1 день' },
  { value: 2880, label: 'За 2 дні' },
  { value: 10080, label: 'За 1 тиждень' },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function localDateValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localTimeValue(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function calendarEventFormInitialValue(event, initialStart, currentUserId, initialParticipantIds = [], { scope = 'series' } = {}) {
  const editSeries = event?.sourceEventId && scope !== 'occurrence';
  const editableStart = editSeries ? event.seriesStartAt : event?.startAt;
  const editableEnd = editSeries ? event.seriesEndAt : event?.endAt;
  const start = editableStart ? new Date(editableStart) : new Date(initialStart || Date.now());
  if (!event?.startAt) {
    start.setMinutes(start.getMinutes() < 30 ? 30 : 0, 0, 0);
    if (start.getMinutes() === 0) start.setHours(start.getHours() + 1);
  }
  const end = editableEnd ? new Date(editableEnd) : new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: event?.title || '',
    // A stored type is kept as it is, including the read-only `birthday` one and
    // the legacy `milestone` alias, so the screen describes the event it is
    // actually showing rather than falling back to a generic "Подія".
    type: isKnownCalendarEventType(event?.type) ? event.type : 'meeting',
    description: event?.description || '',
    location: event?.location || '',
    meetingUrl: event?.meetingUrl || '',
    projectId: event?.projectId || '',
    visibility: event?.visibility || 'team',
    // A new event opened from a colleague's profile starts with the two of you
    // on it; an existing event keeps whoever it already has.
    participantIds: event?.participantIds
      || [...new Set([currentUserId, ...initialParticipantIds].filter(Boolean))],
    allDay: event?.allDay === true,
    startDate: localDateValue(start),
    startTime: localTimeValue(start),
    endDate: localDateValue(end),
    endTime: localTimeValue(end),
    recurrenceFrequency: event?.recurrence?.frequency || 'none',
    recurrenceInterval: event?.recurrence?.interval || 1,
    recurrenceUntil: event?.recurrence?.until || '',
    reminderMinutes: event?.reminderMinutes || [15],
  };
}

export function calendarEventFormPayload(form, currentUserId) {
  const title = form.title.trim();
  if (!title) throw new Error('Вкажіть назву події');

  let startAt;
  let endAt;
  if (form.allDay) {
    startAt = new Date(`${form.startDate}T00:00:00`);
    endAt = new Date(`${form.endDate}T00:00:00`);
    if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);
  } else {
    startAt = new Date(`${form.startDate}T${form.startTime}:00`);
    endAt = new Date(`${form.endDate}T${form.endTime}:00`);
  }
  // A type with no duration of its own never asked for an end, so it does not
  // have one to validate — the server derives the same value.
  if (!calendarEventHasDuration(form.type) && Number.isFinite(startAt.getTime())) {
    endAt = new Date(startAt.getTime() + (form.allDay
      ? 24 * 60 * 60 * 1000
      : POINT_EVENT_DURATION_MINUTES * 60 * 1000));
  }
  if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
    throw new Error('Вкажіть коректні дату й час');
  }
  if (endAt <= startAt) throw new Error('Завершення має бути пізніше за початок');

  const typed = applyCalendarEventTypeRules({
    type: form.type,
    projectId: form.projectId,
    location: form.location,
    meetingUrl: form.meetingUrl,
    participantIds: form.visibility === 'private'
      ? (currentUserId ? [currentUserId] : [])
      : form.participantIds,
    reminderMinutes: form.reminderMinutes,
  }, { ownerId: currentUserId });
  const meetingUrl = safeExternalUrl(typed.meetingUrl);
  if (typed.meetingUrl && !meetingUrl) {
    throw new Error('Посилання має починатися з http:// або https://');
  }

  return {
    title,
    type: form.type,
    description: form.description,
    location: typed.location,
    meetingUrl,
    projectId: typed.projectId,
    visibility: normalizeCalendarEventVisibility(form.type, form.visibility),
    participantIds: typed.participantIds,
    allDay: form.allDay,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    recurrence: {
      frequency: form.recurrenceFrequency,
      interval: Number(form.recurrenceInterval) || 1,
      until: form.recurrenceUntil,
    },
    reminderMinutes: typed.reminderMinutes,
  };
}

// Switching the type mid-edit rewrites the fields the new type cannot hold, so
// the form never shows a project on a note or a guest list on an absence — and
// never silently submits one that is merely hidden.
export function calendarEventFormWithType(form, type, currentUserId) {
  const typed = applyCalendarEventTypeRules({
    type,
    projectId: form.projectId,
    location: form.location,
    meetingUrl: form.meetingUrl,
    participantIds: form.participantIds,
    reminderMinutes: form.reminderMinutes,
  }, { ownerId: currentUserId });
  return {
    ...form,
    ...typed,
    // The old type's visibility only survives if the new one can honour it;
    // otherwise the new type's own default applies.
    visibility: normalizeCalendarEventVisibility(type, form.visibility) === form.visibility
      ? form.visibility
      : calendarEventDefaultVisibility(type),
  };
}

function memberLabel(member) {
  return member.name || member.displayName || member.email || 'Учасник';
}

function responseLabel(value) {
  if (value === 'accepted') return 'Буде';
  if (value === 'tentative') return 'Можливо';
  if (value === 'declined') return 'Не буде';
  return 'Очікуємо';
}

export function CalendarEventDetails({
  event,
  members,
  projects,
  currentUserId,
  response,
  isParticipant,
  saving,
  error,
  timeLogs,
  totalMinutes,
  timeLoading,
  timeSaving,
  canTrackTime,
  trackingDisabledReason,
  onAddTime,
  onDeleteTime,
  onRespond,
  showOverview = true,
}) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const project = projects.find(item => item.id === event.projectId);
  const recurrence = CALENDAR_EVENT_RECURRENCE_OPTIONS.find(option => option.value === event.recurrence?.frequency);
  const reminderLabels = (event.reminderMinutes || [])
    .map(minutes => CALENDAR_EVENT_REMINDER_OPTIONS.find(option => option.value === minutes)?.label)
    .filter(Boolean);
  const safeMeetingUrl = safeExternalUrl(event.meetingUrl);
  return (
    <div className="space-y-[18px]">
      {showOverview && (
        <>
      <div data-ui-surface="local" className="overflow-hidden rounded-[18px] border border-black/[0.05] bg-white">
        <div className="bg-gradient-to-br from-black/[0.035] to-transparent p-[18px]">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Pill tone="dark" size="wide-sm">
              {calendarEventTypeLabel(event.type)}
            </Pill>
            {project && <Pill tone="surface" size="wide-sm" appearance="soft-outline">{project.name}</Pill>}
            {event.recurrence?.frequency !== 'none' && <Pill tone="surface" size="wide-sm" appearance="soft-outline" icon={Repeat2}>{recurrence?.label}</Pill>}
          </div>
          <h2 className="ui-type-detail-title leading-tight text-ink">{event.title}</h2>
          <div className="mt-4 grid gap-2 text-[12px] text-muted sm:grid-cols-2">
            <div data-ui-surface="local" className="flex items-start gap-2 rounded-[12px] bg-white p-3 ring-1 ring-black/[0.04]">
              <CalendarIcon size={15} className="mt-0.5 shrink-0 text-ink" />
              <span>{event.allDay ? start.toLocaleDateString('uk-UA', { weekday: 'long', day: 'numeric', month: 'long' }) : `${start.toLocaleDateString('uk-UA', { weekday: 'short', day: 'numeric', month: 'long' })}, ${start.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`}</span>
            </div>
            {(event.location || safeMeetingUrl) && (
              <div data-ui-surface="local" className="flex items-start gap-2 rounded-[12px] bg-white p-3 ring-1 ring-black/[0.04]">
                {safeMeetingUrl ? <Link2 size={15} className="mt-0.5 shrink-0 text-ink" /> : <MapPin size={15} className="mt-0.5 shrink-0 text-ink" />}
                <span className="truncate">{event.location || 'Онлайн-мітинг'}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {event.description && (
        <div>
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">Опис</p>
          <p className="whitespace-pre-wrap rounded-[14px] bg-canvas p-4 text-[13px] leading-relaxed text-ink">{event.description}</p>
        </div>
      )}

      {reminderLabels.length > 0 && (
        <div className="flex items-start gap-2 rounded-[12px] border border-line px-3 py-2.5 text-[12px] text-muted">
          <BellRing size={15} className="mt-0.5 shrink-0 text-ink" />
          <span>Нагадування: {reminderLabels.join(', ').toLocaleLowerCase('uk-UA')}</span>
        </div>
      )}
        </>
      )}

      {/* A self-audience entry has exactly one participant — you — so a
          "Учасники" list of one is noise rather than information. */}
      {calendarEventInvitesOthers(event.type) && (
      <div>
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Учасники</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {(event.participantIds || []).map(uid => {
            const member = members.find(item => (item.id || item.uid) === uid);
            const state = event.participantResponses?.[uid] || 'pending';
            return (
              <div key={uid} data-ui-surface="local" className="flex items-center gap-2.5 rounded-[12px] border border-black/[0.05] bg-white p-2.5">
                <span className="h-8 w-8 overflow-hidden rounded-full"><UserAvatar user={member || { name: memberLabel(member || {}) }} size="md" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-bold text-ink">{memberLabel(member || {})}</p>
                  <p className={`text-[10px] font-semibold ${state === 'accepted' ? 'text-success' : state === 'declined' ? 'text-danger' : state === 'tentative' ? 'text-warning' : 'text-muted'}`}>{responseLabel(state)}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Only a type that actually invites people asks whether you are coming.
          "Буду / Не буду" on a reminder you set for yourself was the clearest
          case of the form ignoring what the event is. */}
      {calendarEventSupportsRsvp(event.type) && isParticipant && event.organizerId !== currentUserId && (
        <div data-ui-surface="panel" data-ui-padding="compact-md" className="ui-surface">
          <p className="mb-2 text-[12px] font-bold text-ink">Ви приєднаєтесь?</p>
          <ResponseChoice size="tile" value={response} onChange={onRespond} disabled={saving} />
        </div>
      )}

      {safeMeetingUrl && (
        <a href={safeMeetingUrl} target="_blank" rel="noopener noreferrer" className="flex h-[42px] w-full items-center justify-center gap-2 rounded-[12px] bg-ink px-4 text-[13px] font-bold text-white hover:bg-ink-hover">
          <ExternalLink size={15} /> Приєднатися до мітингу
        </a>
      )}

      {!event.readOnly && calendarEventSupportsTracking(event.type) && (
        <div data-ui-surface="bordered-card" data-ui-padding="compact-md" className="ui-surface">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <p className="text-[12px] font-bold text-ink">Фактично витрачений час</p>
              <p className="mt-0.5 text-[11px] text-muted">
                {timeLoading ? 'Завантаження…' : totalMinutes > 0 ? `Всього ${Math.floor(totalMinutes / 60)} год ${totalMinutes % 60} хв` : 'Час ще не списували'}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-faint">
                {event.projectId
                  ? 'Потрапляє в аналітику команди та в рахунок обраного проєкту.'
                  : 'Потрапляє в аналітику команди. Щоб додати час у рахунок, прив’яжіть подію до проєкту.'}
              </p>
            </div>
            {!event.allDay && (
              <Pill tone="neutral" size="wide-sm">
                План: {Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000))} хв
              </Pill>
            )}
          </div>
          {canTrackTime ? (
            <form className="grid gap-2 sm:grid-cols-[110px_1fr_auto]" noValidate onSubmit={onAddTime}>
              <Input name="minutes" type="number" min="1" max="10080" placeholder="Хвилини" aria-label="Витрачено хвилин" />
              <Input name="description" maxLength={2000} placeholder="Що зроблено (необов’язково)" aria-label="Опис роботи" />
              <Button type="submit" size="sm" loading={timeSaving}>Додати</Button>
            </form>
          ) : (
            <p className="rounded-[10px] bg-canvas px-3 py-2 text-[11px] text-muted">
              {trackingDisabledReason === 'visibility'
                ? 'Трекінг часу доступний лише для командних подій, щоб деталі подій з обмеженою видимістю не потрапили в командну аналітику.'
                : 'У вас немає доступу до трекінгу часу цієї події або її проєкту.'}
            </p>
          )}
          {timeLogs.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {timeLogs.map(log => {
                const member = members.find(item => (item.id || item.uid) === log.userId);
                return (
                  <TimeLogRow
                    key={log.id}
                    member={member || { name: memberLabel(member || {}) }}
                    spentLabel={`${log.spentMinutes} хв`}
                    description={log.description}
                    canEdit={log.userId === currentUserId}
                    onDelete={() => onDeleteTime(log.id)}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-[12px] font-medium text-danger">{error}</p>}
    </div>
  );
}

export default function CalendarEventDialog({
  isOpen,
  event,
  initialStart,
  initialParticipantIds,
  members,
  projects,
  currentUserId,
  canManage,
  onClose,
  onSave,
  onDelete,
  onRespond,
  initialMode,
  onCancelEdit,
}) {
  const confirm = useConfirm();
  const { orgRole } = useAppContext();
  const [form, setForm] = useState(() => calendarEventFormInitialValue(event, initialStart, currentUserId, initialParticipantIds));
  const [mode, setMode] = useState(initialMode || (event ? 'details' : 'edit'));
  // Whether this save may also put the guests on the event's project. Off until
  // somebody says otherwise, and reset the moment the project changes.
  const [addToProjectTeam, setAddToProjectTeam] = useState(false);
  const [saving, setSaving] = useState(false);
  const [timeSaving, setTimeSaving] = useState(false);
  const [error, setError] = useState('');
  const [titleError, setTitleError] = useState('');
  const eventId = event?.sourceEventId || event?.id || '';
  const occurrenceStartAt = event?.startAt || '';
  const {
    logs: timeLogs,
    totalMinutes,
    loading: timeLoading,
    canTrackTime,
    trackingDisabledReason,
    addTimeLog,
    deleteTimeLog,
  } = useCalendarEventTimeLogs(
    event?.readOnly ? '' : eventId,
    occurrenceStartAt,
    event?.projectId || '',
  );

  // Participants you can still invite. Someone who no longer has access keeps
  // appearing on the events they were already part of — see `members` above.
  const memberOptions = useMemo(() => activeMembers(members).map(member => ({
    value: member.id || member.uid,
    label: memberLabel(member),
    user: member,
  })), [members]);
  const projectOptions = useMemo(() => [
    { value: '', label: 'Без проєкту' },
    ...projects.filter(project => project.status !== 'archived').map(project => ({
      value: project.id,
      label: project.name,
    })),
  ], [projects]);
  const response = event?.participantResponses?.[currentUserId] || 'pending';
  const isParticipant = event?.participantIds?.includes(currentUserId);

  const update = (key, value) => {
    setForm(previous => ({ ...previous, [key]: value }));
    // Consent was about one project; this is now a different one.
    if (key === 'projectId') setAddToProjectTeam(false);
  };

  // An event that names a project has the same two questions a task does: can
  // each guest open that project, and does the project name them. Neither was
  // asked here — this route only ever checked that a participant was in the
  // organization — so a guest could be invited to an event whose project 404s
  // for them, and an admin guest left no trace on the project at all.
  const eventProject = useMemo(
    () => (form.projectId ? projects.find(item => item.id === form.projectId) || null : null),
    [projects, form.projectId],
  );
  const mayGrantProjectAccess = isPrivilegedRole(orgRole);
  const participantsOffProjectRoster = useMemo(() => {
    if (!eventProject || !hasRecordedTeam(eventProject)) return [];
    if (form.visibility === 'private') return [];
    return (form.participantIds || [])
      .filter(uid => !isOnProjectTeam(eventProject, uid))
      .map(uid => members.find(item => (item.id || item.uid) === uid) || { id: uid, name: uid });
  }, [eventProject, form.participantIds, form.visibility, members]);
  const participantsLockedOutOfProject = useMemo(
    () => participantsOffProjectRoster.filter(
      member => !hasProjectAccess(eventProject, member.role || null, member.id || member.uid),
    ),
    [participantsOffProjectRoster, eventProject],
  );
  const changeType = value => setForm(previous =>
    calendarEventFormWithType(previous, value, currentUserId));
  const invitesOthers = calendarEventInvitesOthers(form.type);
  const hasDuration = calendarEventHasDuration(form.type);

  const submit = async eventObject => {
    eventObject.preventDefault();
    if (!canManage) return;
    if (!form.title.trim()) {
      setTitleError('Вкажіть назву події');
      return;
    }
    let payload;
    try {
      // Validate before onSave starts the request. With noValidate enabled this
      // is the single, localized client-side error path for an inverted range.
      payload = calendarEventFormPayload(form, currentUserId);
    } catch (validationError) {
      setError(validationError.message || 'Перевірте дату й час події');
      return;
    }
    // A guest who cannot open the event's project is invited to a link that
    // 404s for them. The server refuses this too; saying so here means the
    // answer arrives without a round trip.
    if (participantsLockedOutOfProject.length > 0 && !addToProjectTeam) {
      setError(mayGrantProjectAccess
        ? 'Позначте «Додати до складу проєкту» або приберіть учасника, який не має доступу.'
        : 'Приберіть учасника, який не входить до складу проєкту.');
      return;
    }
    setTitleError('');
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...payload,
        // True only because the box above was ticked. The server writes
        // `project.team` on this and on nothing else.
        addParticipantsToProjectTeam: addToProjectTeam && participantsOffProjectRoster.length > 0,
      });
    } catch (saveError) {
      setError(saveError.message || 'Не вдалося зберегти подію');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!await confirm({
      title: 'Видалити подію?',
      message: 'Усі запрошені отримають сповіщення про скасування.',
      confirmText: 'Видалити',
      danger: true,
    })) return;
    setSaving(true);
    try {
      await onDelete();
    } catch (deleteError) {
      setError(deleteError.message || 'Не вдалося видалити подію');
      setSaving(false);
    }
  };

  const handleResponse = async value => {
    setSaving(true);
    setError('');
    try {
      await onRespond(value);
    } catch (responseError) {
      setError(responseError.message || 'Не вдалося зберегти відповідь');
    } finally {
      setSaving(false);
    }
  };

  const handleAddTime = async formEvent => {
    formEvent.preventDefault();
    const formElement = formEvent.currentTarget;
    const data = new FormData(formElement);
    const minutes = Number(data.get('minutes'));
    // Checked here rather than by the browser, so the message reads like the
    // rest of the product instead of an untranslated native bubble.
    if (!Number.isFinite(minutes) || minutes < 1) {
      setError('Вкажіть, скільки хвилин зафіксувати');
      return;
    }
    setTimeSaving(true);
    setError('');
    try {
      await addTimeLog({
        userId: currentUserId,
        spentMinutes: minutes,
        description: data.get('description'),
      });
      formElement.reset();
    } catch (timeError) {
      setError(timeError.message || 'Не вдалося додати час');
    } finally {
      setTimeSaving(false);
    }
  };

  const handleDeleteTime = async logId => {
    try {
      await deleteTimeLog(logId);
    } catch (timeError) {
      setError(timeError.message || 'Не вдалося видалити запис часу');
    }
  };

  if (event && mode === 'details') {
    return (
      <Dialog
        isOpen={isOpen}
        onClose={onClose}
        title="Деталі події"
        size="lg"
        footer={(
          <>
            {canManage && !event.readOnly && <Button style="secondary" size="md" icon={Pencil} onClick={() => setMode('edit')}>Редагувати</Button>}
            <Button style="secondary" size="md" onClick={onClose}>Закрити</Button>
          </>
        )}
      >
        <CalendarEventDetails
          event={event}
          members={members}
          projects={projects}
          currentUserId={currentUserId}
          response={response}
          isParticipant={isParticipant}
          saving={saving}
          error={error}
          timeLogs={timeLogs}
          totalMinutes={totalMinutes}
          timeLoading={timeLoading}
          timeSaving={timeSaving}
          canTrackTime={canTrackTime}
          trackingDisabledReason={trackingDisabledReason}
          onAddTime={handleAddTime}
          onDeleteTime={handleDeleteTime}
          onRespond={handleResponse}
        />
      </Dialog>
    );
  }

  const footer = canManage ? (
    <>
      {event && (
        <Button
          style="ghost"
          color="red"
          size="md"
          icon={Trash2}
          className="mr-auto"
          onClick={handleDelete}
          disabled={saving}
        >
          Видалити
        </Button>
      )}
      <Button
        style="secondary"
        size="md"
        onClick={() => {
          if (event && onCancelEdit) onCancelEdit();
          else if (event) setMode('details');
          else onClose();
        }}
      >
        Скасувати
      </Button>
      <Button type="submit" form="calendar-event-form" size="md" loading={saving}>
        {event ? 'Зберегти' : 'Створити подію'}
      </Button>
    </>
  ) : (
    <Button style="secondary" size="md" onClick={onClose}>Закрити</Button>
  );

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={event ? (canManage ? 'Редагування події' : 'Деталі події') : 'Нова подія'}
      size="lg"
      footer={footer}
    >
      {/* `noValidate`: the browser's own "Please fill out this field" bubble is
          untranslated, unstyled and appears in a different place than every
          other message in the product. Required fields are checked on submit and
          reported under the field, like the project dialog does. */}
      <form id="calendar-event-form" noValidate onSubmit={submit} className="flex flex-col gap-[20px]">
        <FormGroup label="Назва" required error={titleError}>
          <Input
            autoFocus
            value={form.title}
            onChange={e => {
              update('title', e.target.value);
              if (titleError) setTitleError('');
            }}
            placeholder="Наприклад, синхронізація команди"
            disabled={!canManage}
            error={Boolean(titleError)}
          />
        </FormGroup>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
          <div className="flex flex-col gap-[6px]">
            <Label>Тип</Label>
            <Select
              value={form.type}
              onChange={changeType}
              options={CALENDAR_EVENT_TYPE_OPTIONS}
              disabled={!canManage}
            />
          </div>
          {calendarEventSupportsProject(form.type) && (
            <div className="flex flex-col gap-[6px]">
              <Label>Проєкт</Label>
              <Select
                value={form.projectId}
                onChange={value => update('projectId', value)}
                options={projectOptions}
                disabled={!canManage}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <div className="flex flex-col gap-[6px]">
            <Label icon={Repeat2}>Повторення</Label>
            <Select value={form.recurrenceFrequency} onChange={value => update('recurrenceFrequency', value)} options={CALENDAR_EVENT_RECURRENCE_OPTIONS} />
            {form.recurrenceFrequency !== 'none' && (
              <div className="grid grid-cols-[110px_1fr] gap-2">
                <Input type="number" min="1" max="12" value={form.recurrenceInterval} onChange={eventObject => update('recurrenceInterval', eventObject.target.value)} aria-label="Інтервал повторення" />
                <DatePicker
                  value={form.recurrenceUntil}
                  minDate={form.startDate}
                  onChange={value => update('recurrenceUntil', value)}
                  aria-label="Повторювати до дати"
                />
              </div>
            )}
          </div>
          {calendarEventSupportsReminders(form.type) && (
            <div className="flex flex-col gap-[6px]">
              <Label icon={BellRing} required={calendarEventRequiresReminder(form.type)}>Нагадування</Label>
              <MultiSelect
                value={form.reminderMinutes}
                onChange={value => update('reminderMinutes', value)}
                options={CALENDAR_EVENT_REMINDER_OPTIONS}
                placeholder="Додати нагадування"
                searchPlaceholder="Знайти інтервал..."
                maxSelected={MAX_CALENDAR_REMINDERS}
                className="w-full"
                dropdownClassName="w-full"
              />
              <p className="text-[10px] text-muted">
                {calendarEventRequiresReminder(form.type)
                  ? 'Нагадування прийде вам — навіть якщо ви створили його собі самі.'
                  : 'Можна вибрати до п’яти нагадувань.'}
              </p>
            </div>
          )}
        </div>

        <div data-ui-surface="local" className="overflow-hidden rounded-[14px] border border-line bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-line bg-canvas px-[14px] py-[12px]">
            <span>
              <span className="block text-[12px] font-bold text-ink">Подія на весь день</span>
              <span className="block text-[11px] text-muted mt-0.5">Без прив’язки до конкретної години</span>
            </span>
            <ToggleSwitch
              checked={form.allDay}
              onChange={value => update('allDay', value)}
              disabled={!canManage}
              size="sm"
            />
          </div>
          <div className={`grid grid-cols-1 gap-[12px] p-[14px] ${hasDuration ? 'sm:grid-cols-2' : ''}`}>
            <div className="flex flex-col gap-[6px]">
              {/* A reminder, a note and a release happen *at* a time rather than
                  *between* two, so they are asked for one. */}
              <Label icon={CalendarIcon}>{hasDuration ? 'Початок' : 'Коли'}</Label>
              <div className="flex gap-[8px]">
                <DatePicker
                  value={form.startDate}
                  onChange={value => update('startDate', value)}
                  disabled={!canManage}
                  aria-label={hasDuration ? 'Дата початку' : 'Дата'}
                />
                {!form.allDay && (
                  <TimePicker
                    value={form.startTime}
                    onChange={value => update('startTime', value)}
                    disabled={!canManage}
                    aria-label={hasDuration ? 'Час початку' : 'Час'}
                  />
                )}
              </div>
            </div>
            {hasDuration && (
              <div className="flex flex-col gap-[6px]">
                <Label icon={Clock3}>Завершення</Label>
                <div className="flex gap-[8px]">
                  <DatePicker
                    value={form.endDate}
                    onChange={value => update('endDate', value)}
                    disabled={!canManage}
                    aria-label="Дата завершення"
                  />
                  {!form.allDay && (
                    <TimePicker
                      value={form.endTime}
                      onChange={value => update('endTime', value)}
                      disabled={!canManage}
                      aria-label="Час завершення"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <Label icon={!invitesOthers || form.visibility === 'private' ? LockKeyhole : Users}>
            {!invitesOthers
              ? 'Лише для вас'
              : form.visibility === 'private'
                ? 'Приватна подія'
                : 'Учасники'}
          </Label>
          {!invitesOthers ? (
            // No guest list, because the entry belongs to one day: yours. It can
            // still be visible to the team — that is the visibility control
            // below, not a participant list.
            <div data-ui-surface="compact-bordered-panel" data-ui-padding="row" className="ui-surface text-[12px] text-muted">
              Цей запис стосується лише вас: інших учасників не запрошують і відповіді не збирають.
            </div>
          ) : form.visibility === 'private' ? (
            <div data-ui-surface="compact-bordered-panel" data-ui-padding="row" className="ui-surface text-[12px] text-muted">
              Цю подію бачите лише ви. Запрошення та командні сповіщення не надсилаються.
            </div>
          ) : (
            <MultiSelect
              value={form.participantIds}
              onChange={value => update('participantIds', value)}
              options={memberOptions}
              placeholder="Додати учасників"
              searchPlaceholder="Знайти учасника..."
              disabled={!canManage}
              className="w-full"
              dropdownClassName="w-full"
            />
          )}
          {invitesOthers && participantsOffProjectRoster.length > 0 && (
            // One colour and one sentence, the same as the task composer and
            // the task page now say. The branch that explained the access model
            // («доступ є за роллю, але на картці проєкту його не видно») was
            // answering a question nobody in this dialog had asked.
            <Alert
              variant="warning"
              title={participantsOffProjectRoster.length === 1
                ? 'Цього учасника немає в проєкті'
                : 'Цих учасників немає в проєкті'}
              className="mt-1"
            >
              <div className="flex flex-col gap-2">
                <span>
                  {participantsOffProjectRoster.map(member => memberLabel(member)).join(', ')} — не у складі проєкту
                  {eventProject?.name ? ` «${eventProject.name}»` : ''}.
                </span>
                {mayGrantProjectAccess ? (
                  <Checkbox
                    size="sm"
                    checked={addToProjectTeam}
                    onChange={setAddToProjectTeam}
                    label={`Додати до проєкту${eventProject?.name ? ` «${eventProject.name}»` : ''}`}
                  />
                ) : (
                  <span>Зберегти не вдасться — попросіть власника або адміністратора додати до проєкту.</span>
                )}
              </div>
            </Alert>
          )}
          {event && invitesOthers && form.visibility !== 'private' && form.participantIds.length > 0 && (
            <div className="flex flex-wrap gap-[6px] pt-[2px]">
              {form.participantIds.map(uid => {
                const member = members.find(item => (item.id || item.uid) === uid);
                const state = event.participantResponses?.[uid] || 'pending';
                return (
                  <Pill key={uid} tone="neutral" size="wide-sm" weight="medium">
                    {memberLabel(member || {})}
                    <span className={state === 'accepted' ? 'text-success' : state === 'declined' ? 'text-danger' : 'text-muted'}>
                      · {state === 'accepted' ? 'буде' : state === 'tentative' ? 'можливо' : state === 'declined' ? 'не буде' : 'очікуємо'}
                    </span>
                  </Pill>
                );
              })}
            </div>
          )}
        </div>

        {calendarEventSupportsPlace(form.type) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-[12px]">
            <div className="flex flex-col gap-[6px]">
              <Label icon={MapPin}>Місце</Label>
              <Input value={form.location} onChange={e => update('location', e.target.value)} placeholder="Офіс або кімната" disabled={!canManage} />
            </div>
            <div className="flex flex-col gap-[6px]">
              <Label icon={Link2}>Посилання</Label>
              <Input type="url" value={form.meetingUrl} onChange={e => update('meetingUrl', e.target.value)} placeholder="https://meet..." disabled={!canManage} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-[6px]">
          <Label>Опис</Label>
          <Textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="Контекст, порядок денний або важливі деталі" disabled={!canManage} rows={4} />
        </div>

        <div className="flex flex-col gap-[6px]">
          <Label>Видимість</Label>
          <Select
            value={form.visibility}
            onChange={value => update('visibility', value)}
            options={calendarEventVisibilityOptionsFor(form.type).map(option => (
              option.value === 'private' ? { ...option, icon: LockKeyhole } : option
            ))}
            disabled={!canManage}
          />
        </div>

        {error && <p className="text-[12px] font-medium text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}
