// src/lib/utils/inviteEmails.mjs
// The inline "invite by email" list, shared by «Новий проєкт» and «Налаштування
// проєкту». Both dialogs render the same form, so both parse and report the
// same way — the two used to differ in what they even offered, which is how one
// of them could invite somebody into the project being edited and the other
// could not.

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a textarea's worth of addresses into the ones worth sending and the
 * ones worth complaining about.
 *
 * Blank lines are ignored so a trailing newline — what pasting a spreadsheet
 * column gives you — is not an error, and addresses are lower-cased and
 * de-duplicated so the same person is not invited twice by capitalisation.
 *
 * @param {string} value Raw textarea contents.
 * @returns {{ emails: string[], malformed: string[] }}
 */
export function parseInviteEmails(value) {
  const entries = [...new Set(
    String(value || '')
      .split(/[\n,;]+/)
      .map(line => line.trim().toLowerCase())
      .filter(Boolean),
  )];
  return {
    emails: entries.filter(entry => EMAIL_PATTERN.test(entry)),
    malformed: entries.filter(entry => !EMAIL_PATTERN.test(entry)),
  };
}

/**
 * The message for addresses that are not addresses.
 *
 * @param {string[]} malformed
 * @returns {string} Empty when there is nothing to say.
 */
export function malformedEmailsMessage(malformed) {
  if (!malformed.length) return '';
  return `Не схоже на email: ${malformed.slice(0, 3).join(', ')}`;
}

/**
 * The message for invitations that were created but whose letter never left.
 * An invitation still works without its email — it is accepted on the invitee's
 * first login with that address — so this is a warning, not a failure, and it
 * has to say what to do instead.
 *
 * @param {string[]} undelivered
 * @returns {string} Empty when every letter went out.
 */
export function undeliveredEmailsMessage(undelivered) {
  if (!undelivered.length) return '';
  return `Запрошення створено, але лист не пішов (${undelivered.join(', ')}). `
    + 'Пошту не налаштовано — надішліть посилання-запрошення зі сторінки «Команда».';
}

/**
 * The message for invitations the server refused outright.
 *
 * @param {{ email: string, message: string }[]} failures
 * @returns {string} Empty when every invitation was accepted.
 */
export function failedInvitesMessage(failures) {
  if (!failures.length) return '';
  return `Не вдалося запросити: ${failures.map(item => `${item.email} — ${item.message}`).join('; ')}`;
}
