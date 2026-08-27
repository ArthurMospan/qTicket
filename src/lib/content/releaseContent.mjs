// What shipped, told to the people who use it.
//
// Two lists used to live here. The version history is gone: it was a changelog
// written for whoever built the thing, and a person asking «що нового» does not
// want a list of releases grouped by area — they want to be told what changed
// for them. That is what the news is for, and it says it once.
//
// The news is deliberately empty while the product is in beta. Everything in it
// described a build nobody outside the team had ever seen, which made «Новини»
// a diary rather than an announcement. It fills up from the release onward: one
// entry per user-visible feature, in the words of somebody using it.

export const NEWS_ARTICLES = Object.freeze([]);

export const NEWS_BY_SLUG = new Map(NEWS_ARTICLES.map(article => [article.slug, article]));
