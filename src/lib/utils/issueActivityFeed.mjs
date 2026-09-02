import { issueActivity } from './issueReadState.mjs';
import { ISSUE_BULK_ACTION_BY_ID } from '../bulk/issueBulkActions.mjs';
import { CUSTOMER_WITHHELD_FIELDS } from './issueAuditEvents.mjs';

/**
 * «Останні дії» — what happened, rather than what was touched.
 *
 * «Нещодавно оновлені» sorted requests by their activity timestamp and then
 * printed the request. It is a useful list and it answers the wrong question:
 * a reader arriving at the front screen wants to know *what happened* since
 * they were last here, and a title with a status pill beside it says only that
 * something did.
 *
 * The whole feed is derived from fields the request document already carries
 * and the overview already streams — `lastActivityType`, `lastActivityAt`,
 * `lastActivityActorId`, `lastActivityActorName`, `lastActivityText` — so this
 * costs no extra read, no new collection and no Firestore rule. Deliberately
 * so: the other way to build an activity feed is a collection-group query over
 * every request's `audit/`, which needs an index, a rule, and a fan-out read on
 * the one screen everybody opens first.
 *
 * What it therefore cannot say is anything the request does not remember. There
 * is one `lastActivity*` per request, so a request that was answered and then
 * reassigned reports the reassignment and not both. That is the honest limit of
 * a feed with no cost, and it is the right trade for a summary: this screen is
 * «як ідуть справи», and the request's own thread is where every step is.
 */

const SUPPORT_ACTOR = 'Підтримка';

// Every `lastActivityType` the product writes, in the three voices a feed row
// needs: a named person did it, the desk did it, or nobody is named.
//
// The desk's voice is feminine, to agree with «Підтримка». That subject exists
// at all because the first version of this file was subjectless — «Нова
// відповідь у зверненні KER-4» — on the argument that naming the desk is how
// routing leaks one word at a time. Put on screen beside the support account,
// that argument fell over: a customer's own actions rendered bold with a face
// while support's rendered grey with a dot, so the two lines they actually came
// for were the faintest things on the page. The rule being protected is «which
// member of support is answering», and «Підтримка» names no member.
//
// The table used to be five rows long, and everything missing from it fell
// through to «оновив звернення» — so cancelling a request, archiving one,
// restoring one from «Нещодавно видалене» and all twenty-two bulk actions
// announced themselves on «Огляд» as a generic edit. The request's own thread
// said what actually happened; the feed above it did not, which is the one
// thing the feed is for.
//
// It is also the only such table now. The project card kept its own pair —
// `ISSUE_ACTIVITY_VERBS` and `ISSUE_ACTIVITY_EVENTS` — for the same events in
// slightly different words, so one product described one event two ways
// depending on which screen you were standing on.
export const ISSUE_ACTIVITY_PHRASES = Object.freeze({
  created: { actor: 'відкрив звернення', desk: 'відкрила звернення', event: 'Створено звернення' },
  comment: { actor: 'відповів у зверненні', desk: 'відповіла у зверненні', event: 'Нове повідомлення у зверненні' },
  status: { actor: 'змінив статус звернення', desk: 'змінила статус звернення', event: 'Змінено статус звернення' },
  restored: { actor: 'відновив звернення', desk: 'відновила звернення', event: 'Відновлено звернення' },
  archived: { actor: 'заархівував звернення', desk: 'заархівувала звернення', event: 'Заархівовано звернення' },
  unarchived: { actor: 'розархівував звернення', desk: 'розархівувала звернення', event: 'Розархівовано звернення' },
  cancelled: { actor: 'скасував звернення', desk: 'скасувала звернення', event: 'Скасовано звернення' },
  uncancelled: { actor: 'повернув звернення в роботу', desk: 'повернула звернення в роботу', event: 'Звернення повернуто в роботу' },
  imported: { actor: 'імпортував звернення', desk: 'імпортувала звернення', event: 'Звернення імпортовано' },
  updated: { actor: 'оновив звернення', desk: 'оновила звернення', event: 'Оновлено звернення' },
});

const BULK_ACTIVITY_PREFIX = 'bulk_';

/**
 * What one recorded event reads as, in the voice the row needs.
 *
 * A bulk operation writes `bulk_<actionId>`, and there are twenty-two of those.
 * The registry that already names every one of them for the menu and the help
 * article names them here too — a second list would be a second place for
 * «Скасувати» to be called something else.
 *
 * @param {string} type The `lastActivityType` on the request.
 * @param {'actor'|'desk'|'event'} voice Who the sentence is about.
 */
export function issueActivityPhrase(type, voice = 'actor') {
  const known = ISSUE_ACTIVITY_PHRASES[type];
  if (known) return known[voice] || known.actor;
  if (typeof type === 'string' && type.startsWith(BULK_ACTIVITY_PREFIX)) {
    const action = ISSUE_BULK_ACTION_BY_ID.get(type.slice(BULK_ACTIVITY_PREFIX.length));
    if (action) {
      const label = action.label.toLocaleLowerCase('uk-UA');
      if (voice === 'event') return `Масова дія «${action.label}»`;
      return voice === 'desk'
        ? `виконала масову дію «${label}»`
        : `виконав масову дію «${label}»`;
    }
  }
  return ISSUE_ACTIVITY_PHRASES.updated[voice] || ISSUE_ACTIVITY_PHRASES.updated.actor;
}

/** Whether the feed has a sentence for this type, bulk actions included. */
function hasPhrase(type) {
  if (ISSUE_ACTIVITY_PHRASES[type]) return true;
  return typeof type === 'string'
    && type.startsWith(BULK_ACTIVITY_PREFIX)
    && ISSUE_BULK_ACTION_BY_ID.has(type.slice(BULK_ACTIVITY_PREFIX.length));
}

/**
 * One line of the feed, or `null` where the request remembers nothing.
 *
 * @param {object} issue The request.
 * @param {Set<string>} options.supportUserIds Who counts as the desk.
 * @param {boolean} options.clientViewer Whether the reader is the customer.
 * @param {Map<string, object>} options.memberById Roster, for a live name and face.
 */
export function issueActivityEntry(issue, {
  supportUserIds = new Set(),
  clientViewer = false,
  memberById = new Map(),
} = {}) {
  const activity = issueActivity(issue);
  if (!activity.millis || !issue?.id) return null;

  // An edit the reader cannot see is not news for them.
  //
  // The resolution date is withheld from a customer everywhere — the strip, the
  // card, and now their half of the history — and the feed was the last place
  // still announcing it, as «Підтримка оновила звернення» about a field they
  // cannot find. Which is worse than showing the date: the only way to act on
  // «something changed, and you may not know what» is to ask.
  //
  // `lastActivityFields` is written by the route that made the change. An older
  // request has none, and none means «we do not know», which is not grounds to
  // hide a row.
  if (clientViewer && Array.isArray(issue.lastActivityFields) && issue.lastActivityFields.length > 0) {
    const anythingTheyCanSee = issue.lastActivityFields
      .some(field => !CUSTOMER_WITHHELD_FIELDS.includes(field));
    if (!anythingTheyCanSee) return null;
  }

  const type = hasPhrase(activity.type) ? activity.type : 'updated';
  const actorId = issue.lastActivityActorId || issue.createdBy || issue.reporterId || '';
  const supportActor = Boolean(actorId) && supportUserIds.has(actorId);

  // The customer reads the person too, as of 2026-09-01.
  //
  // This branch used to anonymise every support action for them, on a rule that
  // the product itself never obeyed: the request's own strip has always shown a
  // read-only «Підтримка» cell with the agent's name, and their name and face
  // are on every reply in the shared conversation. So the feed said «Підтримка
  // відповіла» about a message signed «Артур Моспан» directly underneath —
  // which is the card-versus-request disagreement this file exists downstream
  // of, in a third place. The owner retired the rule; see docs/ROADMAP.md.
  //
  // What is still withheld is unchanged and is not about people: no resolution
  // date, ever.
  const withhold = false;
  const member = memberById.get(actorId) || null;
  const actorName = member?.name || issue.lastActivityActorName || '';

  // Three subjects, not two. A named person (with their face), the desk (with
  // a mark rather than a face, because it is not a person), or — only where
  // even the desk is not the actor — nobody at all.
  // «Підтримка» remains the subject for an event with no actor recorded at all
  // — a server-side status write, say — because «something happened» with a
  // dash where the subject goes is not a sentence. It is a fallback now, not a
  // policy.
  const desk = !actorName && (supportActor || !actorId);
  return {
    id: issue.id,
    issue,
    type,
    millis: activity.millis,
    at: activity.at,
    // `null` means «no face»: either the desk, which gets a mark, or nobody.
    actor: withhold || !actorName ? null : (member || {
      id: actorId,
      name: actorName,
      avatar: issue.lastActivityActorAvatar || '',
    }),
    // `true` where the row is the desk's: `ActivityRow` draws its mark in the
    // avatar's place, so the line keeps the weight of a named one.
    fromSupport: desk,
    actorName: desk ? SUPPORT_ACTOR : (withhold || !actorName ? '' : actorName),
    text: issueActivityPhrase(type, desk || withhold || !actorName ? 'desk' : 'actor'),
    // The message itself, where the event was one. Trimmed by the writer
    // already; trimmed again here because a feed row is one line.
    detail: type === 'comment' ? String(issue.lastActivityText || '').trim() : '',
    issueKey: issue.issueKey || '',
    title: issue.title || '',
    projectId: issue.projectId || '',
  };
}

/**
 * The feed, newest first.
 *
 * Requests with no recorded activity fall out rather than sorting to the
 * bottom: a row that cannot say what happened is not an entry in a list of what
 * happened.
 *
 * @param {number} limit How many entries to keep, or 0 for all of them. It used
 *   to default to eight and there was no way to ask for the ninth: a desk with
 *   a busy morning read «Останні дії» and saw a fixed window with nothing
 *   saying it was a window. Paging belongs to the screen, which now takes the
 *   whole feed and reveals it in batches, so the cap here is opt-in.
 */
export function issueActivityFeed(issues, options = {}, limit = 0) {
  const feed = (issues || [])
    .map(issue => issueActivityEntry(issue, options))
    .filter(Boolean)
    .sort((left, right) => right.millis - left.millis);
  return limit > 0 ? feed.slice(0, limit) : feed;
}

export { SUPPORT_ACTOR };
