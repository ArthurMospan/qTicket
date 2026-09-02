import { issueActivity } from './issueReadState.mjs';

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

// What each recorded activity type reads as. `updated` is the fallback the
// document itself uses when nothing more specific was written.
const PHRASES = {
  created: 'відкрив звернення',
  comment: 'відповів у зверненні',
  status: 'змінив статус звернення',
  restored: 'відновив звернення',
  updated: 'оновив звернення',
};

// The same events with the desk as the subject, feminine to agree with
// «Підтримка».
//
// The first version of this was subjectless — «Нова відповідь у зверненні
// KER-4» — on the argument that naming the desk as an actor is how routing
// leaks one word at a time. Put on screen beside the support account, that
// argument fell over: a customer's own actions rendered bold with a face while
// support's rendered grey with a 7px dot, so the two lines they actually came
// for were the faintest things on the page and read as disabled rows.
//
// The rule being protected is «which member of support is answering», and
// «Підтримка» names no member. It says the desk acted, which the customer can
// see anyway from the reply sitting in their thread. Withholding the *fact*
// bought nothing and cost the feed its legibility.
const SUPPORT_PHRASES = {
  created: 'відкрила звернення',
  comment: 'відповіла у зверненні',
  status: 'змінила статус звернення',
  restored: 'відновила звернення',
  updated: 'оновила звернення',
};

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

  const type = PHRASES[activity.type] ? activity.type : 'updated';
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
    text: desk
      ? SUPPORT_PHRASES[type]
      : (withhold || !actorName ? SUPPORT_PHRASES[type] : PHRASES[type]),
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
