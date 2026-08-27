// How a search term scores against a record. Pure, so the ranking can be
// argued with in a test instead of in production.
//
// There are two searches, and treating them as one is what made `#` unusable.
// The workspace search is a question — «where is the thing about billing» — and
// prose in a description is a legitimate answer. Picking a task to mention is
// not a question; it is naming one specific row. Typing `12` there searched
// every description in the organization for the characters «12» and returned
// every task that happened to mention a date, an hour or a price.

const WEIGHTS = { key: [100, 80, 50], name: [90, 60, 40], body: [0, 0, 20] };

const DIGITS_ONLY = /^\d+$/;

export function scoreField(value, term, ladder) {
  const text = String(value || '').toLowerCase();
  if (!text) return 0;
  if (text === term) return ladder[0];
  if (text.startsWith(term)) return ladder[1];
  if (text.includes(term)) return ladder[2];
  return 0;
}

/** The number at the end of `QT-142`, as text. */
export function issueKeyNumber(issueKey) {
  const match = String(issueKey || '').match(/(\d+)\s*$/);
  return match ? match[1] : '';
}

/** The general workspace search: a key, a title, a description, a project. */
export function scoreIssue(issue, term) {
  return Math.max(
    scoreField(issue.issueKey, term, WEIGHTS.key),
    scoreField(issue.storedIssueKey, term, WEIGHTS.key),
    scoreField(issue.title, term, WEIGHTS.name),
    scoreField(issue.description, term, WEIGHTS.body),
    scoreField(issue.projectId, term, [0, 0, 30]),
  );
}

/**
 * Picking a task to mention with `#`.
 *
 * A term of digits is a task number and nothing else: `12` means QT-12, then
 * QT-120, and never «the task whose description says “12 годин”». A term with
 * letters can still be a title — that is how you find a task whose number you
 * do not remember — but a description never is, because at this moment you are
 * naming a row rather than asking a question.
 */
export function scoreIssueMention(issue, term) {
  if (DIGITS_ONLY.test(term)) {
    const number = issueKeyNumber(issue.issueKey) || issueKeyNumber(issue.storedIssueKey);
    if (!number) return 0;
    if (number === term) return WEIGHTS.key[0];
    // `1` offering QT-1, QT-10 and QT-19 is the list you want; `1` offering
    // QT-31 because the character appears in it is not.
    return number.startsWith(term) ? WEIGHTS.key[1] : 0;
  }
  return Math.max(
    scoreField(issue.issueKey, term, WEIGHTS.key),
    scoreField(issue.storedIssueKey, term, WEIGHTS.key),
    scoreField(issue.title, term, WEIGHTS.name),
  );
}

/** The shortest term each search will act on. */
export function searchMinimumLength(mention) {
  // `#5` is a whole question when the answer is a task number, and demanding
  // two characters meant single-digit tasks could not be mentioned at all.
  return mention ? 1 : 2;
}
