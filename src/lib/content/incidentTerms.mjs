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

// Every string about the record itself, in the one voice the product speaks.
//
// This file briefly held two vocabularies — «інцидент» for support, «звернення»
// for the client — and that was the mistake, not the fix. One record with two
// names is a product where the customer's list and the agent's queue are
// visibly not the same thing, and every shared screen has to remember which
// reader it is talking to. There is one name.
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

// The two old names still resolve, and to the same table: a caller that asks
// for the staff voice and a caller that asks for the client voice must not be
// able to get different words out of this file again.
export const INCIDENT_TERMS = Object.freeze({
  staff: INCIDENT_TERMS_TABLE,
  client: INCIDENT_TERMS_TABLE,
});

/**
 * The product's words for a support request.
 *
 * Keeps its argument so the call sites read honestly — a shared screen still
 * knows who is looking, for what it *shows* — but the vocabulary no longer
 * forks on it.
 */
export function incidentTerms() {
  return INCIDENT_TERMS_TABLE;
}
