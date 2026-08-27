export const MAX_CALENDAR_REMINDERS = 5;
export const CALENDAR_REMINDER_MINUTES = Object.freeze([
  0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080,
]);

const ALLOWED_REMINDERS = new Set(CALENDAR_REMINDER_MINUTES);

export function normalizeCalendarReminderMinutes(input, fallback = [15]) {
  const value = [...new Set(
    (Array.isArray(input) ? input : fallback)
      .map(minutes => Number(minutes))
      .filter(minutes => ALLOWED_REMINDERS.has(minutes)),
  )].sort((a, b) => a - b);

  if (value.length > MAX_CALENDAR_REMINDERS) {
    return { error: 'Можна вибрати не більше п’яти нагадувань' };
  }
  return { value };
}
