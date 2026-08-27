'use client';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { asDate } from '@/lib/utils/timeZone.mjs';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const DEFAULT_LOCALIZATION = {
  dateFormat: 'DD.MM.YYYY',
  firstDayOfWeek: 'Monday',
  timeFormat: '24h',
  timezone: 'Europe/Kyiv',
};

export function useLocalization() {
  const storeLoc = useWorkspaceStore(s => s.localization);
  const settings = storeLoc || DEFAULT_LOCALIZATION;

  const {
    dateFormat = 'DD.MM.YYYY',
    firstDayOfWeek = 'Monday',
    timeFormat = '24h',
    timezone = 'Europe/Kyiv',
  } = settings;

  // Format Date object or YYYY-MM-DD string to localized format
  const formatLocalDate = (date, { timeZone: timeZoneOverride = timezone } = {}) => {
    if (!date) return '';
    const dateOnly = typeof date === 'string' ? DATE_ONLY.exec(date) : null;
    if (dateOnly) {
      const [, year, month, day] = dateOnly;
      switch (dateFormat) {
        case 'DD.MM.YYYY': return `${day}.${month}.${year}`;
        case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
        case 'YYYY-MM-DD':
        default: return `${year}-${month}-${day}`;
      }
    }
    // Not `date` itself: a caller may hand over a Firestore Timestamp, and it
    // answers none of the `Date` methods below.
    const d = asDate(date);
    if (!d) return '';

    let year = String(d.getFullYear());
    let month = String(d.getMonth() + 1).padStart(2, '0');
    let day = String(d.getDate()).padStart(2, '0');
    if (timeZoneOverride) {
      try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: timeZoneOverride,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(d)
          .filter(part => part.type !== 'literal')
          .map(part => [part.type, part.value]));
        year = parts.year;
        month = parts.month;
        day = parts.day;
      } catch {
        // Invalid legacy preference: preserve the browser-local fallback.
      }
    }

    switch (dateFormat) {
      case 'DD.MM.YYYY':
        return `${day}.${month}.${year}`;
      case 'MM/DD/YYYY':
        return `${month}/${day}/${year}`;
      case 'YYYY-MM-DD':
      default:
        return `${year}-${month}-${day}`;
    }
  };

  // Format HH:MM string to 12h or 24h format
  const formatLocalTime = (timeStr) => {
    if (!timeStr) return '';
    if (timeFormat === '24h') return timeStr;

    // Convert 24h to 12h
    const [hoursStr, minutes] = timeStr.split(':');
    const hours = parseInt(hoursStr, 10);
    if (isNaN(hours)) return timeStr;

    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    return `${hours12}:${minutes} ${ampm}`;
  };

  // Get weekdays array ordered by firstDayOfWeek
  // Ukrainian abbreviations
  const getWeekdays = () => {
    const uaDays = ['Нд', 'Пн', 'Вв', 'Ср', 'Чт', 'Пт', 'Сб'];
    if (firstDayOfWeek === 'Monday') {
      // Rotate array to start on Monday (index 1)
      return ['Пн', 'Вв', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
    }
    return uaDays; // Sunday first
  };

  // Get offset for first day of month calendar positioning
  // If Monday is first, offset Monday (1) to 0, Sunday (0) to 6, etc.
  const getFirstDayOffset = (date) => {
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay(); // 0=Sunday, 1=Monday...
    if (firstDayOfWeek === 'Monday') {
      return firstDay === 0 ? 6 : firstDay - 1;
    }
    return firstDay;
  };

  return {
    dateFormat,
    firstDayOfWeek,
    timeFormat,
    timezone,
    formatDate: formatLocalDate,
    formatTime: formatLocalTime,
    getWeekdays,
    getFirstDayOffset,
  };
}
