import { QUOTA_FAILURE_COPY } from './quotaState.mjs';

export function organizationLoadErrorKind(error) {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (code.includes('permission-denied') || message.includes('insufficient permissions')) {
    return 'permission-denied';
  }
  if (code.includes('not-found')) return 'not-found';
  if (
    code.includes('unavailable')
    || code.includes('deadline-exceeded')
    || code.includes('network')
    || code.includes('resource-exhausted')
    || code.includes('quota')
    || message.includes('offline')
    || message.includes('network')
    || message.includes('failed to fetch')
    || message.includes('resource_exhausted')
    || message.includes('quota exceeded')
  ) {
    return 'retryable';
  }
  return 'unexpected';
}

export function shouldRetryOrganizationLoad(error) {
  const kind = organizationLoadErrorKind(error);
  // A permission denial is retried, not believed on sight.
  //
  // Signing out and signing back in swaps the Firestore credential underneath
  // listeners that are already attached, and the first snapshot to arrive
  // across that swap is routinely rejected: the reader has not lost anything,
  // the listener is simply a moment older than the account holding it. Taking
  // that first rejection at face value is how an ordinary re-login ends on
  // «Ваш обліковий запис більше не має доступу до цієї організації» — a
  // terminal sentence about data that is sitting there intact.
  //
  // The retry budget bounds it: an account that really has been removed says
  // so a couple of hundred milliseconds later, and says it once it is true.
  return kind === 'retryable' || kind === 'permission-denied';
}

export function organizationLoadRetryDelay(attempt) {
  return [250, 750, 1_500][Math.max(0, Math.min(2, attempt - 1))];
}

/**
 * Що сказати на екрані, коли слухач даних відмовив.
 *
 * Три екрани — «Мої звернення», дошка клієнта і «Команда» — говорили одне
 * речення на всі випадки: «Перевірте зʼєднання та спробуйте ще раз». Для
 * обриву мережі це
 * правда. Для відмови в доступі це неправда, яка ще й веде не туди: людина
 * перевіряє вайфай, поки насправді протух токен сесії. А для вичерпаної денної
 * квоти безкоштовного плану — це вже втретє інша річ, і про неї продукт уміє
 * говорити нормально (`QUOTA_FAILURE_COPY`), просто не тут.
 *
 * Оболонка робочого простору класифікує це давно; ці три екрани — ні. Тепер
 * питання одне на всіх.
 *
 * @param {unknown} error що впало
 * @param {boolean} quotaRefused чи бачив цей браузер щойно відмову за квотою
 * @returns {{title: string, description: string}}
 */
/**
 * Чи це відмова, яку ще рано показувати.
 *
 * Довідник організацій приходить двічі: спершу з кешу браузера, потім із
 * сервера. Поки другий не відповів, застосунок уже обрав активну організацію з
 * першого й підписав на неї слухачів — і якщо кеш пам'ятає простір, членства в
 * якому цей акаунт не має, кожен із них повертає `permission-denied`. Звідси
 * «Немає доступу до цих даних» одразу після входу, яке зникає після F5: до
 * перезавантаження сервер уже відповів, і вибір цього разу правильний.
 *
 * Тобто в цьому вікні `permission-denied` означає не «вам відмовлено», а «ще
 * не вирішилось». Вікно скінченне: воно закривається, щойно сервер відповість,
 * — і тоді справжня відмова показується як завжди.
 *
 * @param {unknown} error що впало
 * @param {boolean} directoryVerified чи відповів сервер про склад організацій
 */
export function isUnresolvedAccessError(error, directoryVerified) {
  if (directoryVerified) return false;
  return organizationLoadErrorKind(error) === 'permission-denied';
}

export function workspaceDataFailureCopy(error, quotaRefused = false) {
  const kind = organizationLoadErrorKind(error);
  if (kind === 'permission-denied') {
    return {
      title: 'Немає доступу до цих даних',
      description: 'Сесія могла завершитися або доступ змінився. Перезавантажте сторінку; '
        + 'якщо не допоможе — вийдіть і зайдіть знову. Дані на місці й нічого не втрачено.',
    };
  }
  if (quotaRefused) {
    return { title: QUOTA_FAILURE_COPY.title, description: QUOTA_FAILURE_COPY.description };
  }
  return {
    title: 'Не вдалося оновити дані',
    description: 'Попередні дані не видалені. Перевірте зʼєднання та спробуйте ще раз.',
  };
}
