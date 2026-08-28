import HelpExplorer from './HelpExplorer';
import { articleSearchText, HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/content/helpArticles.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export const metadata = {
  title: 'Довідка',
  description: 'Український довідковий центр qTicket: інциденти, клієнтські простори, обговорення, доступ та безпека.',
  alternates: { canonical: canonicalUrl('/help') },
};

export default async function HelpPage({ searchParams }) {
  const query = await searchParams;
  const categoryById = new Map(HELP_CATEGORIES.map(category => [category.id, category]));
  const initialCategory = categoryById.has(query?.category) ? query.category : 'all';
  const articles = HELP_ARTICLES.map(article => ({
    id: article.id,
    slug: article.slug,
    title: article.title,
    category: article.category,
    categoryLabel: categoryById.get(article.category)?.label || article.category,
    summary: article.summary,
    searchText: articleSearchText(article),
  }));
  return <HelpExplorer articles={articles} categories={HELP_CATEGORIES} initialCategory={initialCategory} />;
}
