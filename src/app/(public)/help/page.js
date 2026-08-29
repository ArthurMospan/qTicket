import HelpExplorer from './HelpExplorer';
import { articleSearchText, HELP_CATEGORIES, PUBLIC_HELP_ARTICLES } from '@/lib/content/helpArticles.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export const metadata = {
  title: 'Довідка',
  description: 'Український довідковий центр qTicket: звернення, розмова з підтримкою, файли, доступ та безпека.',
  alternates: { canonical: canonicalUrl('/help') },
};

// This page is served before anybody signs in, so its reader is unknown and it
// publishes the catalogue a client may read. The support team's own articles
// live in the same help centre, opened from inside the workspace — where the
// product knows the role of whoever is asking.
export default async function HelpPage({ searchParams }) {
  const query = await searchParams;
  const categoryById = new Map(HELP_CATEGORIES.map(category => [category.id, category]));
  const articles = PUBLIC_HELP_ARTICLES.map(article => ({
    id: article.id,
    slug: article.slug,
    title: article.title,
    category: article.category,
    categoryLabel: categoryById.get(article.category)?.label || article.category,
    summary: article.summary,
    searchText: articleSearchText(article),
  }));
  // Only the categories the published set has something in: a chip that can
  // only answer «Нічого не знайдено» is a category the product is pretending
  // to have.
  const present = new Set(articles.map(article => article.category));
  const categories = HELP_CATEGORIES.filter(category => present.has(category.id));
  const initialCategory = present.has(query?.category) ? query.category : 'all';
  return <HelpExplorer articles={articles} categories={categories} initialCategory={initialCategory} />;
}
