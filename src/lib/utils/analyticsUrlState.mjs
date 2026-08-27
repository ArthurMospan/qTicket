import { ANALYTICS_PERIOD_DAYS } from './analyticsWindow.mjs';

export const WORKSPACE_ANALYTICS_TABS = ['overview', 'timesheet', 'velocity', 'workload', 'billing'];
export const MEMBER_ANALYTICS_VIEWS = ['overview', 'work', 'timesheet'];
export const TIMESHEET_MODES = ['week', 'month'];

export function commaListParam(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean))];
}

export function analyticsPeriodParam(value, fallback = 30) {
  const period = Number(value);
  return ANALYTICS_PERIOD_DAYS.includes(period) ? period : fallback;
}

export function analyticsTabParam(value, { billing = false } = {}) {
  if (!WORKSPACE_ANALYTICS_TABS.includes(value)) return 'overview';
  if (value === 'billing' && !billing) return 'overview';
  return value;
}

export function memberViewParam(value) {
  return MEMBER_ANALYTICS_VIEWS.includes(value) ? value : 'overview';
}

export function timesheetModeParam(value) {
  return TIMESHEET_MODES.includes(value) ? value : 'week';
}

export function analyticsDateParam(value, fallback = new Date()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return new Date(fallback);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) return new Date(fallback);
  return date;
}

export function analyticsDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function setSearchParam(params, name, value, defaultValue = '') {
  const normalized = Array.isArray(value) ? value.join(',') : String(value ?? '');
  if (!normalized || normalized === String(defaultValue ?? '')) params.delete(name);
  else params.set(name, normalized);
}
