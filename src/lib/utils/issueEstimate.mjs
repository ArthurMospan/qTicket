import { plural } from './plural.mjs';

export const MAX_ISSUE_ESTIMATE_HOURS = 10_000;
export const MAX_ISSUE_ESTIMATE_MINUTES = MAX_ISSUE_ESTIMATE_HOURS * 60;

export function issueEstimateHoursError(value) {
  if (value === '' || value == null) return '';
  const hours = Number(value);
  if (!Number.isFinite(hours)) return 'Вкажіть оцінку числом';
  if (hours < 0) return 'Оцінка не може бути відʼємною';
  if (hours > MAX_ISSUE_ESTIMATE_HOURS) {
    return `Максимальна оцінка — ${MAX_ISSUE_ESTIMATE_HOURS.toLocaleString('uk-UA')} ${plural(MAX_ISSUE_ESTIMATE_HOURS, ['година', 'години', 'годин'])}`;
  }
  if (!Number.isInteger(hours * 2)) return 'Використовуйте крок 0,5 години';
  return '';
}

export function clampIssueEstimateHours(value) {
  if (value === '') return { value: '', error: '' };
  const hours = Number(value);
  if (!Number.isFinite(hours)) return { value: '', error: 'Вкажіть оцінку числом' };
  if (hours < 0) {
    return { value: '0', error: 'Оцінка не може бути відʼємною' };
  }
  if (hours > MAX_ISSUE_ESTIMATE_HOURS) {
    return {
      value: String(MAX_ISSUE_ESTIMATE_HOURS),
      error: `Максимальна оцінка — ${MAX_ISSUE_ESTIMATE_HOURS.toLocaleString('uk-UA')} ${plural(MAX_ISSUE_ESTIMATE_HOURS, ['година', 'години', 'годин'])}`,
    };
  }
  return { value, error: issueEstimateHoursError(value) };
}
