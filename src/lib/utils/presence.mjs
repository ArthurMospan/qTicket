export const PRESENCE_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function presenceMillis(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isPresenceOnline(value, now = Date.now()) {
  const millis = presenceMillis(value);
  return Boolean(millis && now - millis < PRESENCE_ONLINE_WINDOW_MS);
}

export function formatLastSeenUk(value, { now = Date.now(), online = false } = {}) {
  if (online) return 'В мережі';
  const millis = presenceMillis(value);
  if (!millis) return 'Активність ще не зафіксована';
  const diff = Math.max(0, now - millis);
  if (diff < 60_000) return 'Остання активність: щойно';
  if (diff < 60 * 60_000) return `Остання активність: ${Math.floor(diff / 60_000)} хв тому`;
  if (diff < 24 * 60 * 60_000) return `Остання активність: ${Math.floor(diff / (60 * 60_000))} год тому`;

  const date = new Date(millis);
  const current = new Date(now);
  const time = new Intl.DateTimeFormat('uk-UA', { hour: '2-digit', minute: '2-digit' }).format(date);
  const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const seenDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((dayStart - seenDayStart) / 86_400_000);
  if (dayDiff === 0) return `Остання активність: сьогодні о ${time}`;
  if (dayDiff === 1) return `Остання активність: вчора о ${time}`;
  const calendarDate = new Intl.DateTimeFormat('uk-UA', {
    day: 'numeric',
    month: 'short',
  }).format(date);
  return `Остання активність: ${calendarDate} о ${time}`;
}
