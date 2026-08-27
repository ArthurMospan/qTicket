import Link from 'next/link';
import Surface from '@/components/ui/Surface';
import { notFound } from 'next/navigation';
import { NEWS_ARTICLES, NEWS_BY_SLUG } from '@/lib/content/releaseContent.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export function generateStaticParams() {
  return NEWS_ARTICLES.map(article => ({ slug: article.slug }));
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const article = NEWS_BY_SLUG.get(slug);
  if (!article) return { title: 'Новину не знайдено' };
  return { title: article.title, description: article.summary, alternates: { canonical: canonicalUrl(`/news/${slug}`) } };
}

export default async function NewsArticlePage({ params }) {
  const { slug } = await params;
  const article = NEWS_BY_SLUG.get(slug);
  if (!article) notFound();
  return (
    <Surface preset="card" padding="xl" className="w-full">
      <Link href="/news" className="text-[12px] font-bold text-muted hover:text-ink">← Усі новини</Link>
      <div className="mt-[20px] flex flex-wrap gap-[12px] text-[11px] font-bold uppercase tracking-wide text-faint"><span>{article.category}</span><time dateTime={article.publishedAt}>{article.publishedAt}</time><span>Версія {article.version}</span></div>
      <h1 className="ui-type-page-title mt-[10px] text-ink">{article.title}</h1>
      <p className="mt-[10px] text-[13px] leading-[1.65] text-muted">{article.summary}</p>
      <div className="mt-[32px] flex flex-col gap-[28px]">
        {article.sections.map(section => <section key={section.title}><h2 className="ui-type-section-title text-ink">{section.title}</h2><div className="mt-[10px] flex flex-col gap-[10px] text-[13px] leading-[1.75] text-muted">{section.paragraphs.map(text => <p key={text}>{text}</p>)}</div></section>)}
      </div>
    </Surface>
  );
}
