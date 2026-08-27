import Link from 'next/link';
import Surface from '@/components/ui/Surface';
import { NEWS_ARTICLES } from '@/lib/content/releaseContent.mjs';
import { canonicalUrl } from '@/lib/content/product.mjs';

export const metadata = {
  title: 'Новини',
  description: 'Оновлення qTicket і пояснення видимих змін продукту.',
  alternates: { canonical: canonicalUrl('/news') },
};

// Read in the workspace through `WorkspaceInfoCenter`; this route exists for
// people arriving from outside, and is set in the product's own type scale so
// it is recognisably the same product.
export default function NewsPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <p className="ui-type-eyebrow text-muted">qTicket</p>
        <h1 className="ui-type-page-title mt-[8px] text-ink">Новини продукту</h1>
      </div>
      {NEWS_ARTICLES.length === 0 && (
        <Surface preset="bordered-card" padding="lg">
          <p className="text-[13px] leading-[1.65] text-muted">
            Продукт у беті. Щойно вийде реліз, тут з’являться описи нових можливостей.
          </p>
        </Surface>
      )}
      <div className="flex flex-col gap-[10px]">
        {NEWS_ARTICLES.map(article => (
          <Surface key={article.id} preset="bordered-card" padding="lg">
            <div className="flex flex-wrap gap-[12px] text-[11px] font-bold uppercase tracking-wide text-faint">
              <span>{article.category}</span>
              <time dateTime={article.publishedAt}>{article.publishedAt}</time>
            </div>
            <h2 className="ui-type-card-title mt-[8px] text-ink">
              <Link href={`/news/${article.slug}`} className="hover:underline">{article.title}</Link>
            </h2>
            <p className="mt-[8px] text-[13px] leading-[1.65] text-muted">{article.summary}</p>
            <Link href={`/news/${article.slug}`} className="mt-[12px] inline-block text-[12px] font-bold text-ink hover:underline">
              Читати →
            </Link>
          </Surface>
        ))}
      </div>
    </div>
  );
}
