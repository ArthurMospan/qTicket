'use client';

import { auth } from '@/lib/firebase';
import { localizedIssueAuthorizationMessage } from '@/lib/utils/issueApiMessages.mjs';

const AUTH_REQUIRED_MESSAGE = 'Потрібно увійти в акаунт';

function requestError(result, fallbackMessage, status) {
  const rawMessage = result?.error || result?.message || fallbackMessage;
  const error = new Error(
    status === 401
      ? localizedIssueAuthorizationMessage(rawMessage)
      : rawMessage,
  );
  error.status = status;
  error.code = result?.code || null;
  if (result && typeof result === 'object') {
    Object.entries(result).forEach(([key, value]) => {
      if (!['error', 'message', 'code'].includes(key)) error[key] = value;
    });
  }
  return error;
}

async function responsePayload(response) {
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

/**
 * Calls a protected client API and repairs the one recoverable authentication
 * failure automatically. Firebase normally refreshes an expired ID token, but
 * the server also checks revocation; a cached token can therefore receive 401
 * while the browser still has a valid refresh session. In that case we force a
 * refresh and retry exactly once. A second 401 is a real expired session.
 */
export async function authenticatedRequest(url, options = {}, fallbackMessage = 'Не вдалося виконати запит') {
  await auth.authStateReady?.();
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) {
    const error = new Error(AUTH_REQUIRED_MESSAGE);
    error.status = 401;
    throw error;
  }

  const send = async forceRefresh => {
    let token;
    try {
      token = await firebaseUser.getIdToken(forceRefresh);
    } catch {
      const error = new Error('Сесія завершилася. Увійдіть знову');
      error.status = 401;
      throw error;
    }

    return fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  };

  let response = await send(false);
  if (response.status === 401) response = await send(true);

  const result = await responsePayload(response);
  if (!response.ok) throw requestError(result, fallbackMessage, response.status);
  return result;
}
