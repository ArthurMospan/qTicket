// src/lib/content/incidentTerms.mjs
// One record, one name: «звернення».
//
// qTicket runs on an inherited task engine and keeps it: the collection is
// `issues`, the composer is still `CreateTaskModal`, and none of that is going
// to be renamed for the sake of a label. What a person reads is a different
// question, and the answer is the same for everybody. The client's portal is
// «Мої звернення», the support queue is «Звернення», the settings section is
// «Статуси звернень» and the audit line says «Створено звернення». One word.
//
// This file used to hold two vocabularies picked by role — «інцидент» for
// support, «звернення» for the client — and that was the mistake, not the fix.
// A record with two names is a product where the customer's list and the
// agent's queue are visibly not the same thing: every shared screen had to
// remember which reader it was addressing, an email or a bell row that reaches
// both could name neither, and three sessions in a row let one of the two win
// by accident on a screen that belonged to the other.
//
// So this table is the only place the noun is spelled, and there is only one
// table. A screen that wants the word asks for it here; a screen that hardcodes
// it is what `tests/product-terminology.test.mjs` fails on.

// Every other name the record has been called. Stems, not words: Ukrainian
// declines, and «завдання» hides in «завданням» exactly as «інцидент» hides in
// «в інциденті».
//
// «завдан» rather than «завданн» on purpose — the double-н stem misses the
// genitive plural «завдань», and that is exactly where a leak survived the
// previous sweep of this vocabulary.
export const RECORD_WRONG_NAMES = Object.freeze([
  'інцидент',
  'завдан',
  'задач',
  'таск',
  'спринт',
  'беклог',
  'епік',
]);

// A client's support space is theirs, not a «проєкт» of somebody's portfolio,
// and to support it is the client. Both spellings, because the inherited copy
// used both. Internally the collection is still `projects` and the field is
// still `projectId` — this list is about what a person reads, not about what
// the database calls it.
export const CLIENT_SPACE_WRONG_NAMES = Object.freeze([
  'проєкт',
  'проект',
]);

// The stems no user-visible string in `src/` may contain, for any reader.
export const TASK_MANAGER_WORDS = Object.freeze([
  ...RECORD_WRONG_NAMES,
  ...CLIENT_SPACE_WRONG_NAMES,
]);

// Forbidden on top of the above wherever an external client can read. These are
// not a second name for the record; they are the inherited task manager showing
// through the walls of somebody else's support desk. Support still says
// «Виконавці» among themselves, and that is a separate question from this one.
export const CLIENT_ONLY_FORBIDDEN_WORDS = Object.freeze([
  'виконавець',
  'виконавц',
  'трекер',
]);

// What a client-readable surface is checked against: everything.
export const CLIENT_FORBIDDEN_WORDS = Object.freeze([
  ...TASK_MANAGER_WORDS,
  ...CLIENT_ONLY_FORBIDDEN_WORDS,
]);

// Every string about the record itself, in the one voice the product speaks.
export const INCIDENT_TERMS_TABLE = Object.freeze({
  record: 'Звернення',
  untitled: 'Звернення без назви',
  created: 'Звернення створено',

  linkCopied: 'Посилання на звернення скопійовано',
  copyLink: 'Копіювати посилання на звернення',
  markedUnread: 'Звернення позначено непрочитаним',
  options: 'Опції звернення',

  notFound: 'Звернення не знайдено',
  accessDeniedTitle: 'Немає доступу до звернення',
  accessDeniedText: 'Звернення видалено або у вас більше немає до нього доступу.',
  loadFailedTitle: 'Не вдалося завантажити звернення',

  archivedTitle: 'Звернення в архіві',
  archivedText: 'Звернення закрито й прибрано зі списку активних. Листування та файли збережені без обмеження строку.',
  cancelledTitle: 'Звернення скасовано',
  cancelledText: 'Звернення не вважається вирішеним і не показується серед активних. Листування та файли збережені без обмеження строку.',

  descriptionEmpty: 'Опис звернення ще не додано.',
  unreadDivider: 'Нове у зверненні',
  mentionMenuHeading: 'Згадати звернення',

  composerTitle: 'Нове звернення',
  composerSubmit: 'Створити звернення',
  composerFailed: 'Не вдалося створити звернення',
  composerSubjectLabel: 'Тема звернення',
  composerSubjectRequired: 'Вкажіть тему звернення',
  composerDescriptionLabel: 'Опис звернення',
});

/**
 * The product's words for a support request.
 *
 * Takes nothing. It used to take the reader's role, and a function that asks
 * who is looking before it tells you what something is called is a two-name
 * product waiting to happen again.
 */
export function incidentTerms() {
  return INCIDENT_TERMS_TABLE;
}
