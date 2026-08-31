import { noteQuotaRefusal } from './quotaState.mjs';

export function isQuotaExceededError(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return code === '8'
    || code.includes('resource-exhausted')
    || code.includes('quota')
    || message.includes('resource_exhausted')
    || message.includes('quota exceeded');
}

// Every load failure in the workspace already comes through here, which makes
// it the one place that can notice the daily free quota being spent — and the
// read that gets refused is usually not the one whose failure reaches a screen,
// so noticing has to happen where the failure is, not where it surfaces.
export function reportLoadError(scope, error) {
  if (isQuotaExceededError(error) || error?.status === 503) {
    noteQuotaRefusal();
    console.warn(`${scope} temporarily unavailable:`, error);
    return;
  }
  console.error(scope, error);
}

export function createResponseError(response, result, fallbackMessage) {
  const error = new Error(result?.error || fallbackMessage);
  error.status = response.status;
  error.code = result?.code || null;
  return error;
}

const API_ERROR_MESSAGES = Object.freeze({
  // The two codes an external client can actually receive — both from
  // POST /api/issues, both rendered verbatim in their composer. qTicket calls
  // a project a проєкт everywhere anybody can read, so these do
  // too; «проєкт» named a thing no screen of this product shows.
  INVALID_PROJECT_SCOPE: 'Обраний проєкт недоступний у цій організації',
  INVALID_ESTIMATE: 'Оцінка звернення виходить за допустимі межі',
  INVALID_SCOPE: 'Оберіть доступні організацію та проєкт',
  LEGACY_EPIC_TYPE: 'Цей тип застарілий: нові звернення з ним створювати не можна',
  LEGACY_PARENT_FIELD: 'Оновіть форму й повторіть створення звернення',
  RATE_LIMITED: 'Забагато спроб. Зачекайте хвилину й повторіть',
});

/** Prefer a stable localized API code, then the server's actionable message. */
export function userFacingErrorMessage(error, fallbackMessage) {
  const mapped = API_ERROR_MESSAGES[error?.code];
  if (mapped) return mapped;
  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  return message || fallbackMessage;
}
