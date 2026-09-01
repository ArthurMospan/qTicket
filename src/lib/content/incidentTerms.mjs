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

// The container a customer's requests live in is a **проєкт**, and the owner
// named it on 2026-08-31 after using the product: «Клієнти» over a list of
// workspaces read as a list of companies, and the thing being opened is a place
// to work, not a person. The word this file used to forbid is now the word.
//
// The reasoning it replaces is written down rather than deleted, because it was
// not silly: to a customer «проєкт» can read as somebody's portfolio, and the
// inherited task manager called every container that, which is how the fork
// kept leaking its old vocabulary. What settles it is that the two mistakes are
// not symmetrical — a customer who reads «проєкт» sees a place their requests
// live, and a support agent who reads «клієнт» over a board sees a person they
// are being asked to open. Only one of those is a screen nobody can name.
//
// A **клієнт** is still a person and a company: «Запросити клієнта», «Команда
// клієнта», «адміністратор клієнта», and the «клієнтський портал» they sign in
// to. The container is the проєкт. `projects` and `projectId` never changed.
//
// The stems no user-visible string in `src/` may contain, for any reader.
export const TASK_MANAGER_WORDS = Object.freeze([
  ...RECORD_WRONG_NAMES,
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

// The word for the reader themselves, banned only where the reader is known.
//
// «Клієнт» is the desk's word for the other side and it is the right word
// *there*: an agent looking at a queue is looking at their clients, and
// «Запросити клієнта», «Команда клієнта» and «Клієнт написав останнім» all stay.
// Turned around it says, to somebody who opened an account to write to their
// supplier, «you are the client» — on their own request, over their own
// colleagues, on the form they came to ask for help on. It was doing exactly
// that in three places at once: «Від клієнта» on the attribute strip, the same
// label on the composer only a customer ever opens, and «відповідальний
// клієнта» hovering over their own colleague's face on a board card.
//
// So it is not in the list above, which is scanned across whole files and
// cannot tell a staff branch from a client one — it would have condemned every
// correct use in the product. It belongs to the checks that *know* the reader:
// the record's own vocabulary, the catalogue a client role is handed, the
// palette built for that role, the titles their tabs carry. Where a label
// genuinely has to name one of two sides, it is named from the chair it is read
// in — «Ваша команда» opposite «Підтримка». That is not the two-vocabulary trap
// `incidentTerms()` refuses: that rule is about the name of the *record*, which
// stays «звернення» for everybody.
export const CLIENT_ADDRESSED_WORDS = Object.freeze([
  'клієнт',
]);

// What a client-readable surface is checked against: everything.
export const CLIENT_FORBIDDEN_WORDS = Object.freeze([
  ...TASK_MANAGER_WORDS,
  ...CLIENT_ONLY_FORBIDDEN_WORDS,
]);

// And what a surface addressed to a client is checked against: the above plus
// the word for the reader. Deliberately a second list rather than a wider
// `CLIENT_FORBIDDEN_WORDS` — that one is also asked of every staff article and
// of whole files, where «Запросити клієнта» names a button that exists.
export const CLIENT_ADDRESSED_FORBIDDEN_WORDS = Object.freeze([
  ...CLIENT_FORBIDDEN_WORDS,
  ...CLIENT_ADDRESSED_WORDS,
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
