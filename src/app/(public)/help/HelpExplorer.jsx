'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/Feedback/EmptyState';
import Surface from '@/components/ui/Surface';
import { Input } from '@/components/ui/Input';

// The workspace reads this content in a dialog (`WorkspaceInfoCenter`); this
// page is for people arriving from outside, and is set in the product's own
// type scale so it is recognisably the same product rather than a landing page
// wearing a different one.
export default function HelpExplorer({ articles, categories, initialCategory = 'all' }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(initialCategory);
  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('uk-UA').split(/\s+/).filter(Boolean);
    return articles.filter(article => {
      if (category !== 'all' && article.category !== category) return false;
      return words.length === 0 || words.every(word => article.searchText.includes(word));
    });
  }, [articles, category, query]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <p className="ui-type-eyebrow text-muted">Довідковий центр qTicket</p>
        <h1 className="ui-type-page-title mt-[8px] text-ink">Відповіді про реальну роботу сервісу</h1>
        <p className="mt-[10px] max-w-[680px] text-[13px] leading-[1.65] text-muted">
          Українські інструкції про звернення, розмову з підтримкою, файли, сповіщення й доступ.
        </p>
      </div>

      <Input
        icon={Search}
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Пошук за назвою, дією або помилкою"
        aria-label="Пошук у довідці"
        size="lg"
      />

      <div className="flex flex-wrap gap-[6px]" aria-label="Категорії довідки">
        {[{ id: 'all', label: 'Усі матеріали' }, ...categories].map(item => (
          <Button
            key={item.id}
            style={category === item.id ? 'primary' : 'secondary'}
            size="sm"
            shape="circle"
            aria-pressed={category === item.id}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      <p className="text-[12px] text-muted" aria-live="polite">
        Знайдено матеріалів: {filtered.length}
      </p>

      {filtered.length > 0 ? (
        <div className="grid gap-[10px] md:grid-cols-2">
          {filtered.map(article => (
            <Link key={article.id} href={`/help/${article.slug}`} className="group min-w-0">
              <Surface preset="bordered-card" padding="lg" className="h-full transition-colors group-hover:border-faint">
                <span className="text-[10px] font-bold uppercase tracking-wide text-faint">{article.categoryLabel}</span>
                <h2 className="ui-type-item-title mt-[6px] text-ink group-hover:underline">{article.title}</h2>
                <p className="mt-[6px] text-[13px] leading-[1.6] text-muted">{article.summary}</p>
              </Surface>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="Нічого не знайдено"
          description="Спробуйте коротший запит або оберіть усі категорії."
          context="inset"
          surface="card"
        />
      )}
    </div>
  );
}
