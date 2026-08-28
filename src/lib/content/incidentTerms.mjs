// src/lib/content/incidentTerms.mjs
// One record, two readers, two words for it.
//
// qTicket runs on an inherited task engine and keeps it: the collection is
// `issues`, the composer is still `CreateTaskModal`, and none of that is going
// to be renamed for the sake of a label. What a client reads is a different
// question. To an external `client_admin`/`client_member` this product is their
// supplier's support desk — they opened an account to send a problem, not to be
// handed somebody else's project tracker — so a «завдання», a «спринт» or a
// «виконавець» on their screen is not jargon, it is the wrong product.
//
// The portal the owner accepted is titled «Мої звернення», so «звернення» is
// the client's word for the record and everything a client can read says it.
// Internal support keeps «інцидент», which is what the queue, the settings and
// the help centre call the same document. The two vocabularies met on the
// screens both audiences share — the incident page, its conversation, the
// composer, the palette — and that is exactly where one of them used to win by
// accident. They live here instead, side by side, so a shared surface has to
// name which reader it is talking to.
//
// `tests/client-terminology.test.mjs` holds the client half clean.

// The stems a client must never meet. Stems, not words: Ukrainian declines, and
// «завдання» hides in «завданням» exactly as «проєкт» hides in «у проєкті».
export const TASK_MANAGER_WORDS = Object.freeze([
  'завданн',
  'задач',
  'таск',
  'спринт',
  'беклог',
  'виконавець',
  'виконавц',
  'трекер',
  'епік',
  // The client's own support space is theirs, not a «проєкт» of somebody's
  // portfolio. Both spellings, because the inherited copy uses both.
  'проєкт',
  'проект',
]);

// Every string about the record itself that a screen renders for both readers.
// Same keys on both sides on purpose — a key that exists in one voice and not
// the other is a screen that silently falls back to the wrong vocabulary.
export const INCIDENT_TERMS = Object.freeze({
  staff: Object.freeze({
    record: 'Інцидент',
    untitled: 'Інцидент без назви',
    created: 'Інцидент створено',

    linkCopied: 'Посилання на інцидент скопійовано',
    copyLink: 'Копіювати посилання на інцидент',
    markedUnread: 'Інцидент позначено непрочитаним',
    options: 'Опції інциденту',

    notFound: 'Інцидент не знайдено',
    accessDeniedTitle: 'Немає доступу до інциденту',
    accessDeniedText: 'Інцидент видалено або у вас більше немає доступу до клієнтського простору.',
    loadFailedTitle: 'Не вдалося завантажити інцидент',

    archivedTitle: 'Інцидент в архіві',
    archivedText: 'Інцидент прибрано з активної черги. Історія звернення, чат і файли збережені без обмеження строку.',
    cancelledTitle: 'Інцидент скасовано',
    cancelledText: 'Інцидент не рахується як вирішений і не показується в активній черзі. Історія звернення збережена без обмеження строку.',

    descriptionEmpty: 'Опис інциденту ще не додано.',
    unreadDivider: 'Нове в інциденті',
    mentionMenuHeading: 'Згадати інцидент',

    composerTitle: 'Новий інцидент',
    composerSubmit: 'Створити інцидент',
    composerFailed: 'Не вдалося створити інцидент',
    composerSubjectLabel: 'Тема інциденту',
    composerSubjectRequired: 'Вкажіть тему інциденту',
    composerDescriptionLabel: 'Опис інциденту',
  }),
  client: Object.freeze({
    record: 'Звернення',
    untitled: 'Звернення без назви',
    created: 'Звернення створено',

    linkCopied: 'Посилання на звернення скопійовано',
    copyLink: 'Копіювати посилання на звернення',
    markedUnread: 'Звернення позначено непрочитаним',
    options: 'Опції звернення',

    notFound: 'Звернення не знайдено',
    accessDeniedTitle: 'Немає доступу до звернення',
    // A client has one support space and never chose it, so «клієнтський
    // простір» names nothing they can act on. What they need to know is that
    // the link no longer opens for them.
    accessDeniedText: 'Звернення видалено або у вас більше немає до нього доступу.',
    loadFailedTitle: 'Не вдалося завантажити звернення',

    archivedTitle: 'Звернення в архіві',
    archivedText: 'Звернення закрито й прибрано зі списку активних. Листування та файли збережені без обмеження строку.',
    cancelledTitle: 'Звернення скасовано',
    cancelledText: 'Команда підтримки скасувала це звернення, тож воно не вважається вирішеним. Листування та файли збережені без обмеження строку.',

    descriptionEmpty: 'Опис звернення ще не додано.',
    unreadDivider: 'Нове у зверненні',
    mentionMenuHeading: 'Згадати звернення',

    composerTitle: 'Нове звернення',
    composerSubmit: 'Створити звернення',
    composerFailed: 'Не вдалося створити звернення',
    composerSubjectLabel: 'Тема звернення',
    composerSubjectRequired: 'Вкажіть тему звернення',
    composerDescriptionLabel: 'Опис звернення',
  }),
});

/**
 * Which vocabulary a shared screen is speaking.
 *
 * Takes the answer, not the role: the callers already hold `clientViewer` from
 * `isClientRole`, and a second copy of the role model in a content file is a
 * second place for it to go stale.
 *
 * @param {boolean} clientAudience Whether an external client is reading.
 */
export function incidentTerms(clientAudience = false) {
  return clientAudience ? INCIDENT_TERMS.client : INCIDENT_TERMS.staff;
}
