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

// The same, with nobody to attribute it to. A client's half of the screen sees
// these for everything support does, and a subjectless sentence is the correct
// shape for it — «Підтримка змінила статус» would be a person if there were
// one, and naming the desk as an actor is how routing leaks one word at a time.
const IMPERSONAL_PHRASES = {
  created: 'Звернення відкрито',
  comment: 'Нова відповідь у зверненні',
  status: 'Статус звернення змінено',
  restored: 'Звернення відновлено',
  updated: 'Звернення оновлено',
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

  // A customer is never told which agent did something — that is the routing
  // withheld from them on every other surface, and a feed is the easiest place
  // in a product to leak it back. They read the event; the desk reads the
  // person.
  const withhold = clientViewer && (supportActor || !actorId);
  const member = memberById.get(actorId) || null;
  const actorName = member?.name || issue.lastActivityActorName || '';

  return {
    id: issue.id,
    issue,
    type,
    millis: activity.millis,
    at: activity.at,
    // `null` means «no face, no name»: the sentence carries the whole event.
    actor: withhold || !actorName ? null : (member || {
      id: actorId,
      name: actorName,
      avatar: issue.lastActivityActorAvatar || '',
    }),
    actorName: withhold || !actorName ? '' : actorName,
    text: withhold || !actorName
      ? IMPERSONAL_PHRASES[type]
      : PHRASES[type],
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
 */
export function issueActivityFeed(issues, options = {}, limit = 8) {
  return (issues || [])
    .map(issue => issueActivityEntry(issue, options))
    .filter(Boolean)
    .sort((left, right) => right.millis - left.millis)
    .slice(0, limit);
}

export { SUPPORT_ACTOR };
