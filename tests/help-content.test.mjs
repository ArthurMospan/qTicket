import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

import {
  CONTROLLED_HELP_FEATURES,
  HELP_ARTICLES,
  HELP_CATEGORIES,
  HELP_ROLE_ORDER,
  PUBLIC_HELP_ARTICLES,
  PUBLIC_HELP_ARTICLE_BY_SLUG,
  REQUIRED_HELP_COVERAGE,
  helpArticlesForRole,
} from '../src/lib/content/helpArticles.mjs';
import { LEGAL_DOCUMENTS } from '../src/lib/content/legalDocuments.mjs';
import { PRODUCT_VERSION } from '../src/lib/content/product.mjs';
import { NEWS_ARTICLES } from '../src/lib/content/releaseContent.mjs';
import { ONEB_SUPPORT_CONTACTS, isAllowedSupportHref } from '../src/lib/content/supportContacts.mjs';

const rootUrl = new URL('../', import.meta.url);
const flattenArticle = article => JSON.stringify(article).toLocaleLowerCase('uk-UA');

// Every sentence of an article, one at a time. The record-name check below reads
// these rather than the whole article, because one exemption in it has to be
// judged sentence by sentence: «завдання в QuickTeam» is the other product's
// word for the other product's record, and the button in qTicket says exactly
// that. A whole-article check could not tell that sentence from a sentence
// about a «звернення» that merely happens to share an article with it.
const articleSentences = article => {
  const out = [];
  const walk = value => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(article);
  return out;
};

test('help center has one valid article for every required critical area', () => {
  assert.equal(HELP_ARTICLES.length, 13);
  assert.equal(new Set(HELP_ARTICLES.map(article => article.id)).size, HELP_ARTICLES.length);
  assert.equal(new Set(HELP_ARTICLES.map(article => article.slug)).size, HELP_ARTICLES.length);

  const categories = new Set(HELP_CATEGORIES.map(category => category.id));
  const articleIds = new Set(HELP_ARTICLES.map(article => article.id));
  const coverage = new Map();
  for (const article of HELP_ARTICLES) {
    assert.ok(categories.has(article.category), `${article.id} has a valid category`);
    assert.ok(article.title && article.summary && article.updatedAt);
    assert.ok(article.sections.length > 0, `${article.id} has useful sections`);
    assert.ok(article.relatedRoutes.every(route => route.startsWith('/')));
    assert.ok(article.relatedIds.every(id => articleIds.has(id)), `${article.id} has valid related articles`);
    for (const id of article.coverage) {
      assert.equal(coverage.has(id), false, `${id} is owned by only one article`);
      coverage.set(id, article.id);
    }
  }
  assert.deepEqual([...coverage.keys()].toSorted(), [...REQUIRED_HELP_COVERAGE].toSorted());
});

test('qTicket help publishes only reachable support workflows', () => {
  const articleIds = HELP_ARTICLES.map(article => article.id).toSorted();
  assert.deepEqual(articleIds, [
    'attachments',
    'chat-and-mentions',
    'creating-issues',
    'issue-fields',
    'kanban-and-bulk-actions',
    'notifications',
    'organizations-and-roles',
    'profiles-and-activity',
    'projects-and-boards',
    'search-and-shortcuts',
    'security-and-access',
    'statuses-and-categories',
    'support',
  ]);

  // Not «no article names a deleted feature» — no article may name one at all,
  // in any sentence. Each of these was a whole published topic once.
  const catalogueText = HELP_ARTICLES.map(flattenArticle).join(' ');
  for (const deletedFeature of [
    'спринт', 'беклог', 'табел', 'рахунок', 'рахунк', 'аналітик', 'таймер',
    'списан', 'youtrack', 'telegram', 'quickteam+', 'календар', 'день народження',
    'перенесення даних', 'оцінк', 'внутрішня нотатка', 'внутрішні нотатки',
  ]) {
    assert.ok(!catalogueText.includes(deletedFeature), `"${deletedFeature}" is not a qTicket feature any more`);
  }
});

// One record, one name. The sidebar, the portal and the queue all say
// «звернення»; a help centre that says «інцидент» has told the reader there are
// two different things and left them to guess which one they have.
test('the help centre calls the record what the product calls it', () => {
  for (const article of HELP_ARTICLES) {
    for (const sentence of articleSentences(article)) {
      // The one exemption, and it is as narrow as the word it requires: a
      // sentence that names QuickTeam is describing QuickTeam's own records,
      // where a «завдання» really is a завдання. It is the same exemption the
      // source terminology test carries, for the same reason.
      if (sentence.includes('QuickTeam')) continue;
      const text = sentence.toLocaleLowerCase('uk-UA');
      for (const word of ['інцидент', 'завданн', 'задач', 'виконавц', 'виконавець']) {
        assert.ok(!text.includes(word), `${article.id} still says "${word}"`);
      }
    }
  }
});

// The «?» button is in the rail for every role, so the catalogue behind it is
// read by role or it is the support team's manual handed to a customer.
test('a client role cannot reach a staff-only article', () => {
  for (const article of HELP_ARTICLES) {
    assert.ok(HELP_ROLE_ORDER.includes(article.minimumRole), `${article.id} has a real minimumRole`);
  }

  const staffOnly = HELP_ARTICLES.filter(article => article.minimumRole === 'member').map(article => article.id);
  assert.ok(staffOnly.length > 0, 'the support manual is not empty');

  for (const role of ['client_member', 'client_admin']) {
    const readable = new Set(helpArticlesForRole(role).map(article => article.id));
    for (const id of staffOnly) {
      assert.equal(readable.has(id), false, `${role} must not reach ${id}`);
    }
    // And a related-article link never points at one either.
    for (const article of helpArticlesForRole(role)) {
      assert.ok(article.relatedIds.every(id => readable.has(id)), `${article.id} links only where ${role} may go`);
    }
  }

  // Support reads everything; nothing is hidden from the people answering.
  assert.equal(helpArticlesForRole('member').length, HELP_ARTICLES.length);
  assert.equal(helpArticlesForRole('owner').length, HELP_ARTICLES.length);
});

test('the public pages publish the client catalogue and nothing above it', async () => {
  // `/help` is prerendered and served before anyone signs in, so its reader is
  // the least privileged one there is.
  assert.deepEqual(
    PUBLIC_HELP_ARTICLES.map(article => article.id),
    helpArticlesForRole('client_member').map(article => article.id),
  );
  assert.ok(PUBLIC_HELP_ARTICLES.length > 0 && PUBLIC_HELP_ARTICLES.length < HELP_ARTICLES.length);
  for (const article of HELP_ARTICLES) {
    if (article.minimumRole === 'client_member') continue;
    assert.equal(PUBLIC_HELP_ARTICLE_BY_SLUG.has(article.slug), false, `${article.slug} has no public page`);
  }

  // A published page must never print an internal role id at a customer.
  const articlePage = await readFile(new URL('../src/app/(public)/help/[slug]/page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(articlePage, /minimumRole/);
});

test('the public help shell introduces qTicket rather than the inherited task manager', async () => {
  const explorer = await readFile(new URL('../src/app/(public)/help/HelpExplorer.jsx', import.meta.url), 'utf8');
  assert.match(explorer, /інструкції про звернення, розмову з підтримкою/);
  assert.doesNotMatch(explorer, /задачі, команду, спринти, час, інтеграції/);
});

test('controlled product features cannot exist without a valid help article', async () => {
  const covered = new Set(HELP_ARTICLES.flatMap(article => article.coverage));
  assert.deepEqual(
    CONTROLLED_HELP_FEATURES.map(feature => feature.coverage).toSorted(),
    [...REQUIRED_HELP_COVERAGE].toSorted(),
  );
  for (const feature of CONTROLLED_HELP_FEATURES) {
    assert.ok(covered.has(feature.coverage), `${feature.id} has help coverage`);
    for (const source of feature.sources) await access(new URL(source, rootUrl));
  }
});

test('public content contains no placeholder promises', () => {
  const publicText = [
    ...HELP_ARTICLES.map(flattenArticle),
    JSON.stringify(NEWS_ARTICLES).toLocaleLowerCase('uk-UA'),
    JSON.stringify(LEGAL_DOCUMENTS).toLocaleLowerCase('uk-UA'),
  ].join(' ');
  assert.doesNotMatch(publicText, /tbd|coming soon|lorem ipsum|скоро буде|заповнити пізніше/);
});

test('the version is one number, and the news is empty until there is a release', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', rootUrl), 'utf8'));
  assert.equal(PRODUCT_VERSION, packageJson.version);
  // The version history is gone: it was a changelog written for whoever built
  // the product. «Що нового» is answered by the news, in the words of somebody
  // using it — and while the product is in beta there is nothing to announce,
  // because every entry described a build nobody outside the team had seen.
  const releaseContent = await readFile(new URL('src/lib/content/releaseContent.mjs', rootUrl), 'utf8');
  assert.doesNotMatch(releaseContent, /VERSION_HISTORY/);
  assert.equal(NEWS_ARTICLES.length, 0);
  // Whatever arrives after the release still has to be a whole article.
  assert.ok(NEWS_ARTICLES.every(article => article.slug && article.publishedAt && article.sections.length));
});

// The help centre is for somebody using qTicket, not for somebody who built
// it. None of these words describe anything a person can see on a screen, and
// every one of them was in an article a new user was expected to read.
test('the help centre explains the product, not its plumbing', () => {
  const forbidden = [
    'firestore', 'firebase', 'cloudinary', 'api', 'endpoint', 'серверний маршрут',
    'cascade', 'audit', 'aria-live', 'snapshot', 'оптимістичн', 'ascii',
    'scope', 'sdk', 'token', 'sprintid', 'isdone', 'workflow організації',
    'rules', 'outbox', 'materialise', 'cron', 'hierarchy', 'soft-delete',
  ];
  for (const article of HELP_ARTICLES) {
    const text = flattenArticle(article);
    for (const word of forbidden) {
      assert.ok(!text.includes(word), `${article.id} still says "${word}"`);
    }
  }
});

test('support contacts are centralized, unique and safe to open', () => {
  assert.deepEqual(ONEB_SUPPORT_CONTACTS.map(contact => contact.id).toSorted(), ['email', 'telegram', 'viber']);
  assert.equal(new Set(ONEB_SUPPORT_CONTACTS.map(contact => contact.href)).size, ONEB_SUPPORT_CONTACTS.length);
  assert.ok(ONEB_SUPPORT_CONTACTS.every(contact => contact.label && contact.value && isAllowedSupportHref(contact.href)));
});
