import Link from 'next/link';
import Surface from '@/components/ui/Surface';
import { notFound } from 'next/navigation';
import { HELP_ARTICLES, HELP_ARTICLE_BY_ID, HELP_ARTICLE_BY_SLUG, HELP_CATEGORIES } from '@/lib/content/helpArticles.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export function generateStaticParams() {
  return HELP_ARTICLES.map(article => ({ slug: article.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const article = HELP_ARTICLE_BY_SLUG.get(slug);
  if (!article) return { title: 'Статтю не знайдено' };
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: canonicalUrl(`/help/${article.slug}`) },
  };
}

export default async function HelpArticlePage({ params }) {
  const { slug } = await params;
  const article = HELP_ARTICLE_BY_SLUG.get(slug);
  if (!article) notFound();
  const category = HELP_CATEGORIES.find(item => item.id === article.category);
  const related = article.relatedIds.map(id => HELP_ARTICLE_BY_ID.get(id)).filter(Boolean);

  return (
    <div className="grid min-w-0 gap-[16px] lg:grid-cols-[minmax(0,1fr)_260px]">
      <Surface preset="card" padding="xl" className="min-w-0">
        <Link href={`/help?category=${article.category}`} className="text-[12px] font-bold text-muted hover:text-ink">← {category?.label || 'Довідка'}</Link>
        <h1 className="ui-type-page-title mt-[10px] text-ink">{article.title}</h1>
        <p className="mt-[10px] max-w-[760px] text-[13px] leading-[1.65] text-muted">{article.summary}</p>
        <dl className="mt-[20px] flex flex-wrap gap-x-[24px] gap-y-[8px] border-y border-line py-[14px] text-[12px] text-muted">
          <div><dt className="inline font-bold text-ink">Актуально: </dt><dd className="inline"><time dateTime={article.updatedAt}>{article.updatedAt}</time></dd></div>
          <div><dt className="inline font-bold text-ink">Контекст: </dt><dd className="inline">від {article.minimumRole}</dd></div>
        </dl>
        <div className="mt-[28px] flex flex-col gap-[28px]">
          {article.sections.map(section => (
            <section key={section.id} id={section.id} className="scroll-mt-[24px]">
              <h2 className="ui-type-section-title text-ink">{section.title}</h2>
              <div className="mt-[10px] flex flex-col gap-[10px] text-[13px] leading-[1.75] text-muted">
                {(section.paragraphs || []).map(paragraph => <p key={paragraph}>{paragraph}</p>)}
                {section.bullets?.length > 0 && (
                  <ul className="flex list-disc flex-col gap-[6px] pl-[20px]">
                    {section.bullets.map(item => <li key={item}>{item}</li>)}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
        {related.length > 0 && (
          <section className="mt-[32px] border-t border-line pt-[20px]">
            <h2 className="ui-type-item-title text-ink">Пов’язані матеріали</h2>
            <div className="mt-[12px] grid gap-[8px] sm:grid-cols-2">
              {related.map(item => (
                <Link key={item.id} href={`/help/${item.slug}`} className="rounded-[12px] border border-line bg-canvas p-[12px] text-[13px] font-bold text-ink hover:border-faint">
                  {item.title} →
                </Link>
              ))}
            </div>
          </section>
        )}
      </Surface>
      <aside className="min-w-0 lg:sticky lg:top-[24px] lg:self-start">
        <Surface preset="bordered-card" padding="lg">
        <nav aria-label="Зміст статті">
          <h2 className="ui-type-item-title text-ink">Зміст</h2>
          <ol className="mt-[10px] flex flex-col gap-[6px] text-[13px] text-muted">
            {article.sections.map(section => <li key={section.id}><a href={`#${section.id}`} className="hover:text-ink hover:underline">{section.title}</a></li>)}
          </ol>
        </nav>
        </Surface>
      </aside>
    </div>
  );
}
