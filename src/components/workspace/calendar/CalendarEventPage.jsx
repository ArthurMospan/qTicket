'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlignLeft,
  BellRing,
  Check,
  Clock3,
  Copy,
  CopyPlus,
  ExternalLink,
  Link2,
  LockKeyhole,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Maximize2,
  Pencil,
  Play,
  RefreshCw,
  Repeat2,
  Settings2,
  Square as StopIcon,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react';
import { CalendarIcon } from '@/lib/design/icons';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useCalendarEvents } from '@/lib/hooks/useCalendarEvents';
import { useCalendarEventTimeLogs } from '@/lib/hooks/useCalendarEventTimeLogs';
import {
  calendarEventHref,
  calendarEventSourceId,
  findCalendarEvent,
} from '@/lib/utils/calendarEventNavigation.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import LiveTimeTracking from '@/components/workspace/LiveTimeTracking';
import {
  AttributeTrigger,
  Button,
  ContextMenu,
  DatePicker,
  DetailLayout,
  DetailSection,
  Dialog,
  EmptyState,
  getTaskAttributeChrome,
  Input,
  LoadingSpinner,
  MetaTrigger,
  Pill,
  Popover,
  ResponseChoice,
  Select,
  TaskAttributesPanel,
  Textarea,
  TimeLogRow,
  TitleInput,
  ToggleSwitch,
  useConfirm,
} from '@/components/ui';
import { MultiSelect } from '@/components/ui/Select';
import {
  CALENDAR_EVENT_RECURRENCE_OPTIONS,
  CALENDAR_EVENT_REMINDER_OPTIONS,
  CALENDAR_EVENT_TYPE_OPTIONS,
  calendarEventFormInitialValue,
  calendarEventFormPayload,
  calendarEventFormWithType,
} from '@/components/workspace/calendar/CalendarEventDialog';
import {
  calendarEventHasDuration,
  calendarEventInvitesOthers,
  calendarEventSupportsPlace,
  calendarEventSupportsProject,
  calendarEventSupportsReminders,
  calendarEventSupportsRsvp,
  calendarEventSupportsTracking,
  calendarEventTypeLabel,
  calendarEventVisibilityOptionsFor,
} from '@/lib/utils/calendarEventTypes.mjs';
import { MAX_CALENDAR_REMINDERS } from '@/lib/utils/calendarReminders.mjs';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { safeExternalUrl } from '@/lib/utils/externalUrls.mjs';
import { plural } from '@/lib/utils/plural.mjs';
import { timerDraftNeedsDismissal, timerFeedbackVariant } from '@/lib/utils/timerState.mjs';
import { navigateAfterOverlayClose } from '@/lib/hooks/useOverlayHistory';

const VISIBILITY_OPTIONS = [
  { value: 'team', label: 'Уся команда' },
  { value: 'participants', label: 'Лише учасники' },
  { value: 'private', label: 'Лише я', icon: LockKeyhole },
];

const EVENT_MUTATION_SCOPE_OPTIONS = [
  { value: 'occurrence', label: 'Лише це входження' },
  { value: 'series', label: 'Уся серія' },
];

function memberLabel(member) {
  return member?.name || member?.displayName || member?.email || 'Учасник';
}

function responseLabel(value) {
  if (value === 'accepted') return 'буде';
  if (value === 'tentative') return 'можливо';
  if (value === 'declined') return 'не буде';
  return 'очікуємо';
}

function responseClass(value) {
  if (value === 'accepted') return 'text-success';
  if (value === 'declined') return 'text-danger';
  return 'text-muted';
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function relativeTime(value) {
  const date = asDate(value);
  if (!date) return '—';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'щойно';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} хв тому`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} год тому`;
  const days = Math.floor(diff / 86_400_000);
  return days === 1 ? 'вчора' : `${days} ${plural(days, ['день', 'дні', 'днів'])} тому`;
}

function formatTime(value) {
  const date = asDate(value);
  return date
    ? date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })
    : '—';
}

function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} год ${rest} хв`;
  if (hours) return `${hours} год`;
  return `${rest} хв`;
}

function shiftDateValue(value, days) {
  const [year, month, date] = String(value || '').split('-').map(Number);
  if (!year || !month || !date) return value;
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return shifted.toISOString().slice(0, 10);
}

function AttributeValue({ children, muted = false }) {
  return (
    <div className={`flex h-[22px] min-w-0 items-center truncate text-[13px] font-medium ${muted ? 'text-muted' : 'text-ink'}`}>
      {children}
    </div>
  );
}

function CalendarEventTimeSheet({
  initialMinutes,
  logs,
  totalMinutes,
  loading,
  saving,
  members,
  currentUserId,
  canManage,
  error,
  onClose,
  onSave,
  onDelete,
}) {
  const [form, setForm] = useState({
    id: '',
    minutes: initialMinutes || 0,
    description: '',
  });

  const hours = Math.floor(form.minutes / 60);
  const minutes = form.minutes % 60;
  const updateDuration = (nextHours, nextMinutes) => {
    setForm(current => ({
      ...current,
      minutes: Math.max(0, nextHours * 60 + Math.min(59, Math.max(0, nextMinutes))),
    }));
  };

  const handleSubmit = async formEvent => {
    formEvent.preventDefault();
    const saved = await onSave(form);
    if (saved) setForm({ id: '', minutes: 0, description: '' });
  };

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Трекінг часу"
      description={`Загалом зафіксовано: ${formatMinutes(totalMinutes)}`}
      titleContext="dialog"
      size="md"
      bodyPadding="responsive"
      bodyClassName="custom-scrollbar flex flex-col gap-6"
    >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">
                {form.id ? 'Змінити витрачений час' : 'Зафіксувати час'}
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min="0"
                    composition="duration-hours"
                    value={hours || ''}
                    placeholder="0"
                    onChange={inputEvent => updateDuration(Number(inputEvent.target.value) || 0, minutes)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted">год</span>
                </div>
                <div className="relative flex-1">
                  <Input
                    type="number"
                    min="0"
                    max="59"
                    composition="duration-minutes"
                    value={minutes || ''}
                    placeholder="0"
                    onChange={inputEvent => updateDuration(hours, Number(inputEvent.target.value) || 0)}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-bold text-muted">хв</span>
                </div>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Коментар</p>
              <Textarea
                value={form.description}
                onChange={inputEvent => setForm(current => ({ ...current, description: inputEvent.target.value }))}
                placeholder="Над чим працювали?"
                rows={3}
              />
            </div>

            {error && <p className="text-[12px] font-medium text-danger">{error}</p>}

            <div className="flex items-center gap-2">
              <Button type="submit" size="md" loading={saving} disabled={form.minutes <= 0}>
                {form.id ? 'Зберегти зміни' : 'Зберегти'}
              </Button>
              {form.id && (
                <Button
                  type="button"
                  style="secondary"
                  size="md"
                  onClick={() => setForm({ id: '', minutes: 0, description: '' })}
                >
                  Скасувати
                </Button>
              )}
            </div>
          </form>

          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="ui-type-card-title text-ink">Журнал часу</h4>
              <span className="text-[11px] font-medium text-muted">
                {logs.length} {plural(logs.length, ['запис', 'записи', 'записів'])}
              </span>
            </div>

            {loading ? (
              <div className="flex min-h-[120px] items-center justify-center"><LoadingSpinner size="sm" /></div>
            ) : logs.length === 0 ? (
              <div data-ui-surface="local" className="rounded-[14px] bg-canvas px-4 py-8 text-center">
                <Clock3 size={20} className="mx-auto mb-2 text-faint" />
                <p className="text-[12px] font-medium text-muted">На цій події ще немає записів часу</p>
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map(log => {
                  const member = members.find(item => (item.id || item.uid) === log.userId);
                  const logDate = asDate(log.loggedAt || log.createdAt);
                  const canChange = canManage || log.userId === currentUserId;
                  return (
                    <TimeLogRow
                      key={log.id}
                      member={member || { name: memberLabel(member) }}
                      spentLabel={formatMinutes(log.spentMinutes)}
                      dateLabel={logDate ? logDate.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                      description={log.description}
                      canEdit={canChange}
                      onEdit={() => setForm({
                        id: log.id,
                        minutes: Number(log.spentMinutes) || 0,
                        description: log.description || '',
                      })}
                      onDelete={() => onDelete(log.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
    </Dialog>
  );
}

export default function CalendarEventPage({ eventId, occurrenceStartAt = '', isModal = false, onClose }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const { currentUser, projects = [], orgRole, activeOrgId } = useAppContext();
  const { members = [] } = useOrganization();
  const {
    events,
    loading,
    error: loadError,
    refresh,
    createEvent,
    updateEvent,
    removeEvent,
    respondToEvent,
  } = useCalendarEvents();
  const showToast = useWorkspaceStore(state => state.showToast);
  const activeTimer = useWorkspaceStore(state => state.activeTimer);
  const startTimer = useWorkspaceStore(state => state.startTimer);
  const stopTimer = useWorkspaceStore(state => state.stopTimer);
  const currentUserId = currentUser?.uid || currentUser?.id || '';
  const event = useMemo(
    () => findCalendarEvent(events, eventId, occurrenceStartAt),
    [eventId, events, occurrenceStartAt],
  );
  const sourceEventId = calendarEventSourceId(event) || eventId;
  const [mutationScope, setMutationScope] = useState(
    occurrenceStartAt ? 'occurrence' : 'series',
  );
  const occurrenceIdentity = event?.sourceEventId
    ? (occurrenceStartAt || event.startAt)
    : '';
  const occurrenceMutation = event?.sourceEventId && mutationScope === 'occurrence'
    ? { scope: 'occurrence', occurrenceStartAt: occurrenceIdentity }
    : {};
  const seriesOccurrenceCount = events.filter(candidate => (
    calendarEventSourceId(candidate) === sourceEventId
  )).length;
  const eventFormKey = event ? JSON.stringify([
    sourceEventId,
    mutationScope,
    event.startAt,
    event.endAt,
    event.title,
    event.type,
    event.projectId,
    event.visibility,
    event.participantIds,
    event.reminderMinutes,
    event.recurrence,
  ]) : '';
  const {
    logs: timeLogs,
    totalMinutes,
    loading: timeLoading,
    canTrackTime: serverCanTrackTime,
    trackingDisabledReason,
    addTimeLog,
    updateTimeLog,
    deleteTimeLog,
  } = useCalendarEventTimeLogs(
    event?.readOnly ? '' : sourceEventId,
    event?.startAt || '',
    event?.projectId || '',
  );

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(null);
  const [quickState, setQuickState] = useState({ eventKey: '', form: null });
  const [scheduleDraft, setScheduleDraft] = useState(null);
  const [detailsDraft, setDetailsDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [timeSaving, setTimeSaving] = useState(false);
  const [timePanelOpen, setTimePanelOpen] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(0);
  const [timerSessionId, setTimerSessionId] = useState('');
  const [actionError, setActionError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);

  const canManage = Boolean(event && !event.readOnly && (
    event.organizerId === currentUserId
    || (event.visibility !== 'private' && ['owner', 'admin'].includes(orgRole))
  ));
  const canTrackTime = Boolean(
    event
    && !event.readOnly
    && currentUserId
    && serverCanTrackTime
  );
  const trackingDisabledMessage = trackingDisabledReason === 'visibility'
    ? 'Трекінг часу доступний лише для командних подій'
    : 'Немає доступу до трекінгу часу цієї події або її проєкту';
  const response = event?.participantResponses?.[currentUserId] || 'pending';
  const isParticipant = event?.participantIds?.includes(currentUserId);
  const organizer = members.find(member => (member.id || member.uid) === event?.organizerId);
  const timerKey = event ? `calendar-event:${sourceEventId}:${event.startAt}` : '';
  const isTimerMine = activeTimer?.issueId === timerKey;
  const eventForm = event
    ? calendarEventFormInitialValue(event, event.startAt, currentUserId, [], {
      scope: mutationScope,
    })
    : null;
  const quickForm = quickState.eventKey === eventFormKey ? quickState.form : eventForm;
  const logTimeParam = searchParams.get('logTime');
  // Minutes from a timer stopped elsewhere (the sidebar capsule, the command
  // palette) are handed over through the store, which survives the reload or
  // remount that used to swallow a `logTime` query param before the user had
  // confirmed them. See `stopTimer` in the workspace store.
  const pendingTimeLog = useWorkspaceStore(state => state.pendingTimeLog);
  const clearPendingTimeLog = useWorkspaceStore(state => state.clearPendingTimeLog);
  const acknowledgePendingTimeLog = useWorkspaceStore(state => state.acknowledgePendingTimeLog);
  const pendingMinutesForThisEvent = (
    pendingTimeLog?.entityType === 'calendar_event'
    && pendingTimeLog.issueId === timerKey
    && pendingTimeLog.minutes > 0
  ) ? pendingTimeLog.minutes : 0;

  useEffect(() => {
    if (!canTrackTime || !pendingMinutesForThisEvent) return;
    queueMicrotask(() => {
      setTimerMinutes(current => current || pendingMinutesForThisEvent);
      setTimerSessionId(pendingTimeLog.id);
      setTimePanelOpen(true);
      setActionError('');
    });
  }, [canTrackTime, pendingMinutesForThisEvent, pendingTimeLog?.id]);

  // A stopped timer is a server-owned draft. Saving or discarding it in a
  // different tab invalidates this panel immediately instead of leaving a
  // stale form that could later be submitted as unrelated manual time.
  useEffect(() => {
    if (!timerDraftNeedsDismissal(timerSessionId, pendingTimeLog)) return;
    queueMicrotask(() => {
      setTimePanelOpen(false);
      setTimerMinutes(0);
      setTimerSessionId('');
      setActionError('');
    });
  }, [pendingTimeLog, timerSessionId]);

  useEffect(() => {
    if (!event || !logTimeParam) return;

    const minutes = Math.round(Number(logTimeParam));
    if (canTrackTime && !pendingMinutesForThisEvent && Number.isFinite(minutes) && minutes > 0) {
      queueMicrotask(() => {
        setTimerMinutes(current => current || minutes);
        setTimePanelOpen(true);
        setActionError('');
      });
    }

    if (isModal) return;
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete('logTime');
    const nextQuery = nextSearchParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [canTrackTime, event, isModal, logTimeParam, pathname, pendingMinutesForThisEvent, router, searchParams]);

  const projectOptions = useMemo(() => [
    { value: '', label: 'Без проєкту' },
    ...projects
      .filter(project => project.status !== 'archived')
      .map(project => ({ value: project.id, label: project.name })),
  ], [projects]);
  // Participants you can still invite. Someone who no longer has access keeps
  // appearing on the events they were already part of — see `members` above.
  const memberOptions = useMemo(() => activeMembers(members).map(member => ({
    value: member.id || member.uid,
    label: memberLabel(member),
    user: member,
  })), [members]);

  const copyEventLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Посилання на подію скопійовано');
    } catch {
      showToast('Не вдалося скопіювати посилання', 'error');
    }
  }, [showToast]);

  const duplicateEvent = useCallback(async () => {
    if (!event) return;
    try {
      const base = calendarEventFormInitialValue(event, event.startAt, currentUserId);
      // An expanded recurring occurrence is duplicated as the event currently
      // on screen, not as a second invisible series with the same schedule.
      const created = await createEvent(calendarEventFormPayload({
        ...base,
        title: `${base.title || 'Подія'} (копія)`,
        recurrenceFrequency: 'none',
        recurrenceInterval: 1,
        recurrenceUntil: '',
      }, currentUserId));
      showToast('Копію події створено', 'success');
      router.push(calendarEventHref(created));
    } catch (duplicateError) {
      showToast(duplicateError.message || 'Не вдалося дублювати подію', 'error');
    }
  }, [createEvent, currentUserId, event, router, showToast]);

  useEffect(() => {
    useWorkspaceStore.setState({
      breadcrumbs: [
        { label: 'Календар', href: '/calendar' },
        {
          label: event?.title || 'Подія',
          href: null,
          onClick: event ? copyEventLink : undefined,
          title: 'Копіювати посилання на подію',
        },
      ],
    });
    return () => useWorkspaceStore.setState({ breadcrumbs: [] });
  }, [copyEventLink, event]);

  const enterEdit = () => {
    if (!canManage || !event) return;
    setDraft({
      title: event.title || '',
      description: event.description || '',
      location: event.location || '',
      meetingUrl: event.meetingUrl || '',
    });
    setActionError('');
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setActionError('');
    setIsEditing(false);
  };

  const updateDraft = (key, value) => {
    setDraft(previous => ({ ...previous, [key]: value }));
  };

  const saveEdit = async () => {
    if (!draft || !canManage) return;
    const title = draft.title.trim();
    if (!title) {
      setActionError('Вкажіть назву події');
      return;
    }
    const rawMeetingUrl = typeof draft.meetingUrl === 'string' ? draft.meetingUrl.trim() : '';
    const meetingUrl = safeExternalUrl(rawMeetingUrl);
    if (rawMeetingUrl && !meetingUrl) {
      setActionError('Посилання має починатися з http:// або https://');
      return;
    }
    setSaving(true);
    setActionError('');
    try {
      const updated = await updateEvent(sourceEventId, {
        title,
        description: draft.description,
        location: draft.location,
        meetingUrl,
      }, occurrenceMutation);
      showToast('Подію оновлено', 'success');
      setIsEditing(false);
      setDraft(null);
      if (occurrenceMutation.scope === 'occurrence' && updated?.id && !isModal) {
        router.replace(calendarEventHref(updated));
      }
    } catch (saveError) {
      setActionError(saveError.message || 'Не вдалося зберегти подію');
    } finally {
      setSaving(false);
    }
  };

  const persistQuickForm = async nextForm => {
    if (!canManage || attributeSaving) return false;
    const previous = quickForm;
    setQuickState({ eventKey: eventFormKey, form: nextForm });
    setAttributeSaving(true);
    setActionError('');
    try {
      const updated = await updateEvent(
        sourceEventId,
        calendarEventFormPayload(nextForm, currentUserId),
        occurrenceMutation,
      );
      if (occurrenceMutation.scope === 'occurrence' && updated?.id && !isModal) {
        router.replace(calendarEventHref(updated));
      }
      return true;
    } catch (saveError) {
      setQuickState({ eventKey: eventFormKey, form: previous });
      setActionError(saveError.message || 'Не вдалося оновити атрибут події');
      showToast(saveError.message || 'Не вдалося оновити атрибут події', 'error');
      return false;
    } finally {
      setAttributeSaving(false);
    }
  };

  const updateQuickField = (key, value) => {
    const base = quickForm || calendarEventFormInitialValue(event, event.startAt, currentUserId, [], {
      scope: mutationScope,
    });
    // Changing the type rewrites everything the new type cannot hold, so the
    // attribute row cannot leave a project attached to a note.
    return persistQuickForm(key === 'type'
      ? calendarEventFormWithType(base, value, currentUserId)
      : { ...base, [key]: value });
  };

  const updateEventDate = value => {
    const base = quickForm || calendarEventFormInitialValue(event, event.startAt, currentUserId, [], {
      scope: mutationScope,
    });
    const oldStart = Date.parse(`${base.startDate}T00:00:00Z`);
    const nextStart = Date.parse(`${value}T00:00:00Z`);
    const dayDelta = Number.isFinite(oldStart) && Number.isFinite(nextStart)
      ? Math.round((nextStart - oldStart) / 86_400_000)
      : 0;
    return persistQuickForm({
      ...base,
      startDate: value,
      endDate: shiftDateValue(base.endDate, dayDelta),
    });
  };

  const handleDelete = async () => {
    if (!canManage) return;
    const deletesOccurrence = event.sourceEventId && mutationScope === 'occurrence';
    const approved = await confirm({
      title: deletesOccurrence ? 'Видалити це входження?' : 'Видалити всю серію?',
      message: deletesOccurrence
        ? 'З календаря зникне тільки ця подія. Кількість входжень: 1.'
        : `З календаря зникне вся серія. Кількість видимих входжень: ${Math.max(1, seriesOccurrenceCount)}.`,
      confirmText: 'Видалити',
      danger: true,
    });
    if (!approved) return;
    try {
      await removeEvent(sourceEventId, deletesOccurrence ? occurrenceMutation : {});
      showToast(deletesOccurrence ? 'Входження скасовано' : 'Серію скасовано', 'success');
      if (isModal) onClose?.();
      else router.push('/calendar');
    } catch (deleteError) {
      setActionError(deleteError.message || 'Не вдалося видалити подію');
    }
  };

  const handleRespond = async value => {
    setSaving(true);
    setActionError('');
    try {
      await respondToEvent(sourceEventId, value);
      showToast('Відповідь збережено', 'success');
    } catch (responseError) {
      setActionError(responseError.message || 'Не вдалося зберегти відповідь');
    } finally {
      setSaving(false);
    }
  };

  const handleTimerToggle = async () => {
    if (!canTrackTime) return;
    try {
      if (isTimerMine) {
        const result = await stopTimer();
        if (result?.queued) {
          showToast('Зупинку таймера збережено — час синхронізується після відновлення мережі', 'warning');
          return;
        }
        setTimerMinutes(result?.minutes || 0);
        setTimerSessionId(result?.id || '');
        setTimePanelOpen(true);
        return;
      }
      if (activeTimer) {
        showToast('Зупини поточний таймер спочатку', 'warning');
        return;
      }
      const started = await startTimer(timerKey, event.projectId || '', {
        entityType: 'calendar_event',
        organizationId: activeOrgId,
        eventId: sourceEventId,
        occurrenceStartAt: event.startAt,
      });
      if (!started) showToast('Спершу збережи або відхили попередній відстежений час', 'warning');
    } catch (error) {
      showToast(error.message || 'Не вдалося змінити таймер', timerFeedbackVariant(error));
    }
  };

  const handleSaveTime = async form => {
    setTimeSaving(true);
    setActionError('');
    try {
      if (form.id) {
        await updateTimeLog(form.id, {
          spentMinutes: form.minutes,
          description: form.description,
        });
        showToast('Запис часу оновлено', 'success');
      } else {
        await addTimeLog({
          userId: currentUserId,
          spentMinutes: form.minutes,
          description: form.description,
          timerSessionId: timerSessionId || undefined,
        });
        showToast('Час події додано в аналітику', 'success');
      }
      setTimerMinutes(0);
      setTimerSessionId('');
      // Written down — the stopped timer no longer owes the user anything.
      if (timerSessionId) acknowledgePendingTimeLog(timerSessionId);
      return true;
    } catch (timeError) {
      setActionError(timeError.message || 'Не вдалося зберегти час');
      return false;
    } finally {
      setTimeSaving(false);
    }
  };

  const handleDeleteTime = async logId => {
    const approved = await confirm({
      title: 'Видалити запис часу?',
      message: event?.projectId
        ? 'Цей час зникне з аналітики команди та рахунків.'
        : 'Цей час зникне з аналітики команди.',
      confirmText: 'Видалити',
      danger: true,
    });
    if (!approved) return;
    setActionError('');
    try {
      await deleteTimeLog(logId);
      showToast('Запис часу видалено', 'success');
    } catch (timeError) {
      setActionError(timeError.message || 'Не вдалося видалити запис часу');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[320px] flex-1 items-center justify-center">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="flex min-h-[420px] flex-1 items-center justify-center bg-white">
        <EmptyState
          icon={loadError ? RefreshCw : CalendarIcon}
          title={loadError ? 'Не вдалося завантажити подію' : 'Подію не знайдено'}
          description={loadError?.message || 'Можливо, подію видалили або у вас немає до неї доступу.'}
          action={loadError ? 'Спробувати ще раз' : 'Повернутися до календаря'}
          onAction={loadError ? refresh : () => router.push('/calendar')}
        />
      </div>
    );
  }

  const view = quickForm || calendarEventFormInitialValue(event, event.startAt, currentUserId, [], {
    scope: mutationScope,
  });
  const typeOption = CALENDAR_EVENT_TYPE_OPTIONS.find(option => option.value === view.type);
  const projectOption = projectOptions.find(option => option.value === view.projectId);
  const recurrenceOption = CALENDAR_EVENT_RECURRENCE_OPTIONS.find(option => option.value === view.recurrenceFrequency);
  const reminderLabels = view.reminderMinutes
    .map(value => CALENDAR_EVENT_REMINDER_OPTIONS.find(option => option.value === value)?.label)
    .filter(Boolean);
  const visibilityOption = VISIBILITY_OPTIONS.find(option => option.value === view.visibility);
  // What this kind of entry is allowed to carry. Everything below reads these
  // rather than testing the type string in place.
  const showsProject = calendarEventSupportsProject(view.type);
  const showsParticipants = calendarEventInvitesOthers(view.type);
  const showsTracking = calendarEventSupportsTracking(view.type);
  const showsPlace = calendarEventSupportsPlace(view.type);
  const safeMeetingUrl = safeExternalUrl(event.meetingUrl);
  const showsReminders = calendarEventSupportsReminders(view.type);
  const showsRsvp = calendarEventSupportsRsvp(view.type);
  const showsDuration = calendarEventHasDuration(view.type);
  const {
    attributeItemClass,
    attributeLabelClass,
    compactInputClass,
    compactSelectClass,
  } = getTaskAttributeChrome({ condensed: isHeaderScrolled });

  return (
    <>
      <DetailLayout
        context="event"
        standalone={!isModal}
        scrolled={isHeaderScrolled}
        onScrolledChange={setIsHeaderScrolled}
        header={(
          <div className="flex w-full flex-col items-stretch justify-between gap-[10px] pb-[12px] pt-[12px] sm:flex-row sm:items-start sm:gap-[16px]">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <TitleInput
                    autoFocus
                    value={draft.title}
                    onChange={inputEvent => updateDraft('title', inputEvent.target.value)}
                    placeholder="Назва події…"
                  />
                ) : (
                  <h1 className="ui-type-page-title leading-tight tracking-tight text-ink">{event.title}</h1>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] font-medium text-muted">
                  {/* The product's menu, exactly as the task page's «Автор:»
                      opens it — a person's name offers the same two things
                      wherever it is printed. */}
                  <ContextMenu
                    align="start"
                    dropdownClassName="w-[210px]"
                    trigger={(
                      <MetaTrigger
                        label="Організатор:"
                        user={organizer || { name: 'Учасник' }}
                        name={memberLabel(organizer)}
                      />
                    )}
                    items={[
                      {
                        label: 'Переглянути профіль',
                        icon: User,
                        onClick: () => {
                          const params = new URLSearchParams(searchParams.toString());
                          params.set('member', organizer?.id || organizer?.uid || event.organizerId);
                          router.push(`${pathname}?${params.toString()}`);
                        },
                      },
                      {
                        label: 'Написати в чат',
                        icon: MessageCircle,
                        onClick: () => router.push(`/chat?dm=${encodeURIComponent(organizer?.id || organizer?.uid || event.organizerId)}`),
                      },
                    ]}
                  />
                  <span className="h-[3px] w-[3px] rounded-full bg-faint" />
                  <span>створили <strong className="font-semibold text-ink">{relativeTime(event.createdAt)}</strong></span>
                  <span className="h-[3px] w-[3px] rounded-full bg-faint" />
                  <span>оновили <strong className="font-semibold text-ink">{relativeTime(event.updatedAt || event.createdAt)}</strong></span>
                  {event.sourceEventId && (
                    <>
                      <span className="h-[3px] w-[3px] rounded-full bg-faint" />
                      <span className="inline-flex items-center gap-1"><Repeat2 size={11} /> Серія подій</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 items-center self-end gap-2 pt-1 sm:self-auto">
                {isEditing ? (
                  <>
                    <Button style="secondary" size="md" icon={X} onClick={cancelEdit}>Скасувати</Button>
                    <Button size="md" icon={Check} onClick={saveEdit} loading={saving}>Зберегти</Button>
                  </>
                ) : (
                  <>
                    {canManage && (
                      <Button
                        style="secondary"
                        size="icon-lg"
                        icon={Pencil}
                        onClick={enterEdit}
                        aria-label="Редагувати текст події"
                        title="Редагувати назву й опис"
                      />
                    )}
                    <ContextMenu
                      trigger={(
                        <Button
                          style="secondary"
                          size="icon-lg"
                          icon={MoreHorizontal}
                          aria-label="Опції події"
                          title="Опції"
                        />
                      )}
                      dropdownClassName="w-[210px]"
                      items={[
                        { label: 'Копіювати посилання', icon: Copy, onClick: copyEventLink },
                        { label: 'Дублювати', icon: CopyPlus, onClick: duplicateEvent },
                        ...(canManage ? [
                          { label: 'Редагувати текст', icon: Pencil, onClick: enterEdit },
                          { label: 'Видалити', icon: Trash2, onClick: handleDelete, isDanger: true },
                        ] : []),
                      ]}
                    />
                    {isModal && onClose && (
                      <>
                        <Button
                          style="secondary"
                          size="icon-lg"
                          icon={Maximize2}
                          onClick={() => { onClose(); navigateAfterOverlayClose(() => router.push(calendarEventHref(event))); }}
                          aria-label="Відкрити на повній сторінці"
                          title="Відкрити на повній сторінці"
                        />
                        <Button
                          style="secondary"
                          size="icon-lg"
                          icon={X}
                          onClick={onClose}
                          aria-label="Закрити"
                          title="Закрити"
                        />
                      </>
                    )}
                  </>
                )}
              </div>
          </div>
        )}
        attributes={(
              <TaskAttributesPanel
                singleRow
                context="calendar"
                compact
                condensed={isHeaderScrolled}
                cardClassName="transition-[background-color,padding] duration-200"
                cardStyle={{
                  backgroundColor: isHeaderScrolled ? 'rgba(244,244,245,0.36)' : undefined,
                  backdropFilter: isHeaderScrolled ? 'blur(4px)' : undefined,
                  WebkitBackdropFilter: isHeaderScrolled ? 'blur(4px)' : undefined,
                }}
                primaryChildren={(
                  <>
                    {event.sourceEventId && canManage && (
                      <div
                        className={attributeItemClass}
                        onClick={clickEvent => {
                          if (clickEvent.target.closest('button')) return;
                          clickEvent.currentTarget.querySelector('button')?.click();
                        }}
                      >
                        <span className={attributeLabelClass}>Обсяг змін</span>
                        <Select
                          compact
                          disabled={attributeSaving || saving}
                          value={mutationScope}
                          onChange={value => {
                            setMutationScope(value);
                            setQuickState({ eventKey: '', form: null });
                            setScheduleDraft(null);
                            setDetailsDraft(null);
                            setActionError('');
                          }}
                          options={EVENT_MUTATION_SCOPE_OPTIONS}
                          buttonClassName={compactSelectClass}
                        />
                      </div>
                    )}
                    <div
                      className={attributeItemClass}
                      onClick={clickEvent => {
                        if (!canManage || clickEvent.target.closest('button')) return;
                        clickEvent.currentTarget.querySelector('button')?.click();
                      }}
                    >
                      <span className={attributeLabelClass}>Тип</span>
                      {canManage ? (
                        <Select
                          compact
                          disabled={attributeSaving}
                          value={view.type}
                          onChange={value => updateQuickField('type', value)}
                          options={CALENDAR_EVENT_TYPE_OPTIONS}
                          buttonClassName={compactSelectClass}
                        />
                      ) : (
                        <AttributeValue>
                          {typeOption?.icon && <typeOption.icon size={13} className="mr-1.5 shrink-0 text-muted" />}
                          {calendarEventTypeLabel(view.type)}
                        </AttributeValue>
                      )}
                    </div>

                    {showsProject && (
                    <div
                      className={attributeItemClass}
                      onClick={clickEvent => {
                        if (!canManage || clickEvent.target.closest('button')) return;
                        clickEvent.currentTarget.querySelector('button')?.click();
                      }}
                    >
                      <span className={attributeLabelClass}>Проєкт</span>
                      {canManage ? (
                        <Select
                          compact
                          disabled={attributeSaving}
                          value={view.projectId}
                          onChange={value => updateQuickField('projectId', value)}
                          options={projectOptions}
                          buttonClassName={compactSelectClass}
                        />
                      ) : (
                        <AttributeValue muted={!event.projectId}>{projectOption?.label || 'Без проєкту'}</AttributeValue>
                      )}
                    </div>
                    )}

                    <div
                      className={attributeItemClass}
                      onClick={clickEvent => {
                        if (!canManage || clickEvent.target.closest('input,button')) return;
                        clickEvent.currentTarget.querySelector('input')?.click();
                      }}
                    >
                      <span className={attributeLabelClass}>Дата</span>
                      {canManage ? (
                        <DatePicker
                          compact
                          hideIcon
                          disabled={attributeSaving}
                          value={view.startDate}
                          onChange={updateEventDate}
                          inputClassName={compactInputClass}
                        />
                      ) : (
                        <AttributeValue>{new Date(event.startAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' })}</AttributeValue>
                      )}
                    </div>

                    <Popover
                      position="bottom"
                      hideCloseIcon
                      className="h-full"
                      onOpenChange={open => {
                        if (open) setScheduleDraft({ ...view });
                      }}
                      trigger={(
                        <AttributeTrigger variant="cell" condensed={isHeaderScrolled}>
                          <span className={attributeLabelClass}>Час події</span>
                          <AttributeValue>
                            {event.allDay
                              ? 'Весь день'
                              : showsDuration
                                ? `${formatTime(event.startAt)}–${formatTime(event.endAt)}`
                                : formatTime(event.startAt)}
                          </AttributeValue>
                        </AttributeTrigger>
                      )}
                    >
                      {({ close }) => {
                        const schedule = scheduleDraft || view;
                        return (
                          <div className="w-[300px] max-w-full space-y-4">
                            <div className="flex items-center justify-between gap-4">
                              <div>
                                <p className="text-[12px] font-bold text-ink">Подія на весь день</p>
                                <p className="mt-0.5 text-[10px] text-muted">Без конкретної години</p>
                              </div>
                              <ToggleSwitch
                                checked={schedule.allDay}
                                onChange={value => setScheduleDraft(current => ({ ...current, allDay: value }))}
                                disabled={!canManage || attributeSaving}
                                size="sm"
                                ariaLabel="Подія на весь день"
                              />
                            </div>
                            <div className={`grid gap-2 ${showsDuration ? 'grid-cols-2' : 'grid-cols-1'}`}>
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                                  {showsDuration ? 'Початок' : 'Коли'}
                                </span>
                                <Input
                                  type="date"
                                  value={schedule.startDate}
                                  onChange={inputEvent => setScheduleDraft(current => ({ ...current, startDate: inputEvent.target.value }))}
                                  disabled={!canManage || attributeSaving}
                                />
                                {!schedule.allDay && (
                                  <Input
                                    type="time"
                                    value={schedule.startTime}
                                    onChange={inputEvent => setScheduleDraft(current => ({ ...current, startTime: inputEvent.target.value }))}
                                    disabled={!canManage || attributeSaving}
                                  />
                                )}
                              </div>
                              {showsDuration && (
                                <div className="space-y-1.5">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Завершення</span>
                                  <Input
                                    type="date"
                                    value={schedule.endDate}
                                    onChange={inputEvent => setScheduleDraft(current => ({ ...current, endDate: inputEvent.target.value }))}
                                    disabled={!canManage || attributeSaving}
                                  />
                                  {!schedule.allDay && (
                                    <Input
                                      type="time"
                                      value={schedule.endTime}
                                      onChange={inputEvent => setScheduleDraft(current => ({ ...current, endTime: inputEvent.target.value }))}
                                      disabled={!canManage || attributeSaving}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                            {canManage ? (
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  loading={attributeSaving}
                                  onClick={async () => {
                                    if (await persistQuickForm(schedule)) close();
                                  }}
                                >
                                  Застосувати
                                </Button>
                              </div>
                            ) : (
                              <p className="text-[11px] text-muted">Змінювати подію може організатор або адміністратор.</p>
                            )}
                          </div>
                        );
                      }}
                    </Popover>

                    {showsParticipants && (
                    <Popover
                      position="bottom"
                      hideCloseIcon
                      className="h-full"
                      trigger={(
                        <AttributeTrigger variant="cell" condensed={isHeaderScrolled}>
                          <span className={attributeLabelClass}>Учасники</span>
                          <AttributeValue>
                            <Users size={13} className="mr-1.5 shrink-0 text-muted" />
                            {event.participantIds?.length || 0} {plural(event.participantIds?.length || 0, ['учасник', 'учасники', 'учасників'])}
                          </AttributeValue>
                        </AttributeTrigger>
                      )}
                    >
                      <div className="w-[300px] max-w-full space-y-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Учасники події</p>
                        <MultiSelect
                          value={view.participantIds}
                          onChange={value => updateQuickField('participantIds', value)}
                          options={memberOptions}
                          placeholder="Додати учасників"
                          searchPlaceholder="Знайти учасника…"
                          disabled={!canManage || attributeSaving || view.visibility === 'private'}
                          className="w-full"
                          dropdownClassName="w-[280px]"
                        />
                        {!canManage && <p className="text-[11px] text-muted">Список доступний лише для перегляду.</p>}
                      </div>
                    </Popover>
                    )}

                    {showsTracking && (
                    <div
                      className={`${attributeItemClass} ${canTrackTime ? 'cursor-pointer hover:bg-line' : ''}`}
                      title={canTrackTime ? 'Відкрити трекінг часу' : trackingDisabledMessage}
                      onClick={clickEvent => {
                        if (!canTrackTime || clickEvent.target.closest('button')) return;
                        setTimerMinutes(0);
                        setTimerSessionId('');
                        setTimePanelOpen(true);
                      }}
                      // It opens the time panel and holds the timer buttons, so
                      // it is a control that cannot be a `<button>`.
                      role={canTrackTime ? 'button' : undefined}
                      tabIndex={canTrackTime ? 0 : undefined}
                      onKeyDown={canTrackTime ? (keyEvent => {
                        if (keyEvent.target !== keyEvent.currentTarget) return;
                        if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') return;
                        keyEvent.preventDefault();
                        setTimerMinutes(0);
                        setTimerSessionId('');
                        setTimePanelOpen(true);
                      }) : undefined}
                    >
                      <span className={attributeLabelClass}>Трекінг часу</span>
                      {/* The same control the task page renders. This screen
                          had its own byte-identical copy of it, right down to
                          the 1px nudge on the play triangle. */}
                      <LiveTimeTracking
                        running={isTimerMine}
                        spentMinutes={totalMinutes}
                        restingLabel={formatMinutes(totalMinutes)}
                        disabled={!canTrackTime}
                        onToggle={handleTimerToggle}
                        onOpen={() => {
                          setTimerMinutes(0);
                          setTimerSessionId('');
                          setTimePanelOpen(true);
                        }}
                      />
                    </div>
                    )}

                    <Popover
                      position="bottom"
                      hideCloseIcon
                      className="flex h-full items-center"
                      onOpenChange={open => {
                        setDetailsOpen(open);
                        if (open) setDetailsDraft({ ...view });
                      }}
                      trigger={(
                        <AttributeTrigger
                          variant="details"
                          condensed={isHeaderScrolled}
                          active={detailsOpen}
                          aria-expanded={detailsOpen}
                        >
                          <Settings2 size={14} />
                          <span>Деталі</span>
                        </AttributeTrigger>
                      )}
                    >
                      {({ close }) => {
                        const detailValues = detailsDraft || view;
                        return (
                          <div className="w-[300px] max-w-full space-y-4">
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Видимість</span>
                              <Select
                                disabled={!canManage || attributeSaving}
                                value={detailValues.visibility}
                                onChange={value => setDetailsDraft(current => ({ ...current, visibility: value }))}
                                options={calendarEventVisibilityOptionsFor(detailValues.type)}
                              />
                            </div>
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Повторення</span>
                              <Select
                                disabled={!canManage || attributeSaving}
                                value={detailValues.recurrenceFrequency}
                                onChange={value => setDetailsDraft(current => ({ ...current, recurrenceFrequency: value }))}
                                options={CALENDAR_EVENT_RECURRENCE_OPTIONS}
                              />
                              {detailValues.recurrenceFrequency !== 'none' && (
                                <div className="grid grid-cols-[100px_1fr] gap-2 pt-1">
                                  <Input
                                    type="number"
                                    min="1"
                                    max="12"
                                    value={detailValues.recurrenceInterval}
                                    onChange={inputEvent => setDetailsDraft(current => ({ ...current, recurrenceInterval: inputEvent.target.value }))}
                                    disabled={!canManage || attributeSaving}
                                    aria-label="Інтервал повторення"
                                  />
                                  <Input
                                    type="date"
                                    value={detailValues.recurrenceUntil}
                                    min={detailValues.startDate}
                                    onChange={inputEvent => setDetailsDraft(current => ({ ...current, recurrenceUntil: inputEvent.target.value }))}
                                    disabled={!canManage || attributeSaving}
                                    aria-label="Повторювати до дати"
                                  />
                                </div>
                              )}
                            </div>
                            {showsReminders && (
                              <div className="space-y-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Нагадування</span>
                                <MultiSelect
                                  value={detailValues.reminderMinutes}
                                  onChange={value => setDetailsDraft(current => ({ ...current, reminderMinutes: value }))}
                                  options={CALENDAR_EVENT_REMINDER_OPTIONS}
                                  placeholder="Додати нагадування"
                                  searchPlaceholder="Знайти інтервал…"
                                  maxSelected={MAX_CALENDAR_REMINDERS}
                                  disabled={!canManage || attributeSaving}
                                  className="w-full"
                                  dropdownClassName="w-[280px]"
                                />
                              </div>
                            )}
                            {canManage ? (
                              <div className="flex justify-end">
                                <Button
                                  size="sm"
                                  loading={attributeSaving}
                                  onClick={async () => {
                                    if (await persistQuickForm(detailValues)) close();
                                  }}
                                >
                                  Застосувати
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-1 text-[11px] text-muted">
                                <p>Видимість: {visibilityOption?.label}</p>
                                <p>Повторення: {recurrenceOption?.label}</p>
                                {showsReminders && (
                                  <p>Нагадування: {reminderLabels.length ? reminderLabels.join(', ') : 'немає'}</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    </Popover>
                  </>
                )}
              />
        )}
      >
            <DetailSection icon={AlignLeft} title="Опис">
              {isEditing ? (
                <Textarea
                  value={draft.description}
                  onChange={inputEvent => updateDraft('description', inputEvent.target.value)}
                  placeholder="Контекст, порядок денний або важливі деталі"
                  rows={7}
                composition="long-form"
                />
              ) : (
                <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface min-h-[140px] w-full whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                  {event.description || <span className="text-faint">Опис не додано</span>}
                </div>
              )}
            </DetailSection>

            {showsPlace && (
            <DetailSection icon={MapPin} title="Місце">
              {isEditing ? (
                <Input
                  value={draft.location}
                  onChange={inputEvent => updateDraft('location', inputEvent.target.value)}
                  placeholder="Офіс, кімната або адреса"
                />
              ) : (
                // Read mode draws the same field edit mode does. It used to be
                // a 16px grey block, so clicking it swapped one shape for
                // another 10px shorter — the value appeared to move when all
                // that happened was that it became editable.
                <Input
                  value={event.location || ''}
                  placeholder="Не вказано"
                  readOnly
                  onClick={canManage ? enterEdit : undefined}
                  aria-label="Місце події"
                />
              )}
            </DetailSection>
            )}

            {showsPlace && (
            <DetailSection icon={Link2} title="Посилання">
              {isEditing ? (
                <Input
                  type="url"
                  value={draft.meetingUrl}
                  onChange={inputEvent => updateDraft('meetingUrl', inputEvent.target.value)}
                  placeholder="https://meet…"
                />
              ) : (
                <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface w-full">
                  {safeMeetingUrl ? (
                    <a
                      href={safeMeetingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink hover:underline"
                    >
                      Приєднатися до мітингу <ExternalLink size={12} />
                    </a>
                  ) : (
                    <p className="text-[13px] text-faint">Не вказано</p>
                  )}
                </div>
              )}
            </DetailSection>
            )}

            {showsParticipants && (
            <DetailSection icon={Users} title="Учасники" count={event.participantIds?.length || 0}>
              <div data-ui-surface="panel" data-ui-padding="wide" className="ui-surface w-full">
                {event.participantIds?.length ? (
                  <div className="flex flex-wrap gap-2">
                    {event.participantIds.map(uid => {
                      const member = members.find(item => (item.id || item.uid) === uid);
                      const state = event.participantResponses?.[uid] || 'pending';
                      return (
                        <Pill key={uid} tone="surface-ink" size="lg" weight="medium">
                          <UserAvatar user={member || { name: memberLabel(member) }} size="xs" />
                          <span className="font-semibold">{memberLabel(member)}</span>
                          <span className={responseClass(state)}>· {responseLabel(state)}</span>
                        </Pill>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[13px] text-faint">Учасників не додано</p>
                )}

                {showsRsvp && isParticipant && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-black/[0.05] pt-3">
                    <span className="mr-1 text-[11px] font-bold text-muted">Ваша відповідь:</span>
                    <ResponseChoice size="md" surface="surface" value={response} onChange={handleRespond} disabled={saving} />
                  </div>
                )}
              </div>
            </DetailSection>
            )}

          {actionError && !timePanelOpen && (
            <p className="text-[12px] font-medium text-danger">{actionError}</p>
          )}
      </DetailLayout>

      {timePanelOpen && (
        <CalendarEventTimeSheet
          initialMinutes={timerMinutes}
          logs={timeLogs}
          totalMinutes={totalMinutes}
          loading={timeLoading}
          saving={timeSaving}
          members={members}
          currentUserId={currentUserId}
          canManage={canManage}
          error={actionError}
          onClose={() => {
            setTimePanelOpen(false);
            setTimerMinutes(0);
            setTimerSessionId('');
            setActionError('');
            // Closing the panel is the decision not to log those minutes;
            // without this the pending log would reopen it on every visit.
            if (timerSessionId) {
              clearPendingTimeLog(timerSessionId).catch(error => {
                setActionError(error.message || 'Не вдалося відхилити відстежений час');
              });
            }
          }}
          onSave={handleSaveTime}
          onDelete={handleDeleteTime}
        />
      )}
    </>
  );
}
