'use client';

// The help centre, the release notes and the version history, read without
// leaving the workspace.
//
// These three lived on a separate public shell with its own header, its own
// navigation and its own "Увійти" button. Opening «Довідка» from inside the
// product therefore signed the impression of leaving the product: a different
// site, a different layout, and the back button as the only way home — with
// whatever was on screen (a filtered board, a half-written composer) gone.
//
// None of the three is a destination. They are things you glance at and close,
// which is what a dialog is for. The public routes stay exactly where they are
// for anyone arriving from a search engine or a shared link; this is the same
// content, read in place.
//
// The legal documents deliberately do NOT open here. A contract someone is
// agreeing to should have an address of its own that can be linked, printed and
// cited — so those stay full pages, with a way back.

import { useMemo, useState } from 'react';
import { ArrowLeft, Newspaper, Search, Tag } from 'lucide-react';
import { Button, Card, Dialog, EmptyState, Pill, Segmented } from '@/components/ui';
import { Input } from '@/components/ui/Input';
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  articleSearchText,
} from '@/lib/content/helpArticles.mjs';
import { NEWS_ARTICLES } from '@/lib/content/releaseContent.mjs';
import { useLocalization } from '@/lib/hooks/useLocalization';

export const INFO_CENTER_PANES = Object.freeze(['help', 'news']);

const PANE_OPTIONS = [
  { value: 'help', label: 'Довідка' },
  { value: 'news', label: 'Новини' },
];

const CATEGORY_LABEL = new Map(HELP_CATEGORIES.map(category => [category.id, category.label]));

// Built once at module load: the search index never changes at runtime, and
// rebuilding it on every keystroke made a 20-article filter feel like work.
const SEARCHABLE_ARTICLES = HELP_ARTICLES.map(article => ({
  ...article,
  categoryLabel: CATEGORY_LABEL.get(article.category) || '',
  searchText: articleSearchText(article),
}));

function ArticleBody({ sections }) {
  return (
    <div className="flex flex-col gap-[20px]">
      {sections.map(section => (
        <section key={section.id || section.title}>
          <h4 className="ui-type-card-title text-ink">{section.title}</h4>
          <div className="mt-[8px] flex flex-col gap-[8px]">
            {(section.paragraphs || []).map(text => (
              <p key={text} className="text-[13px] leading-[1.65] text-muted">{text}</p>
            ))}
            {section.bullets?.length > 0 && (
              <ul className="flex list-disc flex-col gap-[6px] pl-[18px] text-[13px] leading-[1.65] text-muted">
                {section.bullets.map(item => <li key={item}>{item}</li>)}
              </ul>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * One openable entry in a list — an article, a news post. `Card` with a handler
 * renders a real `<button>` wearing the kit's surface, so this list is neither
 * a hand-drawn bordered box nor a `div` pretending to be a control.
 */
function ClickableRow({ onOpen, children }) {
  return (
    <Card preset="bordered-compact" padding="sm" interactive onClick={onOpen}>
      {children}
    </Card>
  );
}

function BackRow({ label, onClick }) {
  return (
    <Button style="ghost" size="sm" icon={ArrowLeft} onClick={onClick} className="-ml-[8px] self-start">
      {label}
    </Button>
  );
}

function HelpPane({ openArticle, onOpenArticle, onCloseArticle }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const { formatDate } = useLocalization();

  const filtered = useMemo(() => {
    const words = query.trim().toLocaleLowerCase('uk-UA').split(/\s+/).filter(Boolean);
    return SEARCHABLE_ARTICLES.filter(article => {
      if (category !== 'all' && article.category !== category) return false;
      return words.every(word => article.searchText.includes(word));
    });
  }, [category, query]);

  if (openArticle) {
    return (
      <div className="flex flex-col gap-[16px]">
        <BackRow label="Усі матеріали" onClick={onCloseArticle} />
        <div>
          <Pill tone="neutral" size="sm" shape="badge" weight="medium">
            {CATEGORY_LABEL.get(openArticle.category)}
          </Pill>
          <h3 className="mt-[10px] ui-type-section-title text-ink">{openArticle.title}</h3>
          <p className="mt-[6px] text-[13px] leading-[1.6] text-muted">{openArticle.summary}</p>
        </div>
        <ArticleBody sections={openArticle.sections} />
        <p className="border-t border-line pt-[12px] text-[11px] text-faint">
          Оновлено: {formatDate(openArticle.updatedAt)}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      <Input
        icon={Search}
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="Пошук за назвою, дією або помилкою"
        aria-label="Пошук у довідці"
        size="lg"
      />

      <div className="flex flex-wrap gap-[6px]" aria-label="Категорії довідки">
        {[{ id: 'all', label: 'Усі' }, ...HELP_CATEGORIES].map(item => (
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

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Нічого не знайдено"
          description="Спробуйте коротший запит або оберіть усі категорії."
          context="inset"
          surface="card"
        />
      ) : (
        <div className="flex flex-col gap-[6px]">
          {filtered.map(article => (
            <ClickableRow key={article.id} onOpen={() => onOpenArticle(article)}>
              <span className="flex items-center gap-[6px] text-[10px] font-bold uppercase tracking-wide text-faint">
                <Tag size={11} aria-hidden />
                {article.categoryLabel}
              </span>
              <span className="mt-[4px] block text-[13px] font-bold text-ink">{article.title}</span>
              <span className="mt-[2px] block text-[12px] leading-[1.55] text-muted">{article.summary}</span>
            </ClickableRow>
          ))}
        </div>
      )}
    </div>
  );
}

function NewsPane({ openArticle, onOpenArticle, onCloseArticle }) {
  // A date inside the workspace is written the way this organization writes
  // dates. These three read `2026-08-17` straight out of the content module,
  // which is the one date format the settings screen offers and nobody picked.
  const { formatDate } = useLocalization();
  if (openArticle) {
    return (
      <div className="flex flex-col gap-[16px]">
        <BackRow label="Усі новини" onClick={onCloseArticle} />
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wide text-faint">
            {openArticle.category} · {formatDate(openArticle.publishedAt)}
          </span>
          <h3 className="mt-[8px] ui-type-section-title text-ink">{openArticle.title}</h3>
          <p className="mt-[6px] text-[13px] leading-[1.6] text-muted">{openArticle.summary}</p>
        </div>
        <ArticleBody sections={openArticle.sections} />
      </div>
    );
  }

  if (NEWS_ARTICLES.length === 0) {
    return (
      <EmptyState
        icon={Newspaper}
        title="Новин ще немає"
        description="Тут з’являтимуться оновлення продукту."
        context="inset"
        surface="card"
      />
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {NEWS_ARTICLES.map(article => (
        <ClickableRow key={article.id} onOpen={() => onOpenArticle(article)}>
          <span className="text-[10px] font-bold uppercase tracking-wide text-faint">
            {formatDate(article.publishedAt)} · v{article.version}
          </span>
          <span className="mt-[4px] block text-[13px] font-bold text-ink">{article.title}</span>
          <span className="mt-[2px] block text-[12px] leading-[1.55] text-muted">{article.summary}</span>
        </ClickableRow>
      ))}
    </div>
  );
}


/**
 * @param {'help'|'news'|'versions'|null} props.pane Which pane to show; `null` keeps the dialog closed.
 * @param {(pane: string) => void} props.onPaneChange Switches pane from the tab strip.
 * @param {() => void} props.onClose Closes the dialog.
 */
export default function WorkspaceInfoCenter({ pane, onPaneChange, onClose }) {
  const [openHelpArticle, setOpenHelpArticle] = useState(null);
  const [openNewsArticle, setOpenNewsArticle] = useState(null);

  // Reopening from the menu starts at the list, not on whatever was last read.
  // Done on the way out rather than in an effect watching `pane`: `Dialog`
  // routes Escape, the backdrop and the close button through this one callback.
  const closeCentre = () => {
    setOpenHelpArticle(null);
    setOpenNewsArticle(null);
    onClose();
  };

  return (
    <Dialog
      isOpen={Boolean(pane)}
      onClose={closeCentre}
      title="Довідковий центр"
      titleContext="dialog"
      size="lg"
      presentation="dialog"
      bodyPadding="responsive"
      bodyClassName="custom-scrollbar flex flex-col gap-[16px]"
    >
      <Segmented
        value={pane || 'help'}
        onChange={next => {
          setOpenHelpArticle(null);
          setOpenNewsArticle(null);
          onPaneChange(next);
        }}
        surface="canvas"
        composition="dialog-tabs"
        options={PANE_OPTIONS}
      />

      {pane === 'help' && (
        <HelpPane
          openArticle={openHelpArticle}
          onOpenArticle={setOpenHelpArticle}
          onCloseArticle={() => setOpenHelpArticle(null)}
        />
      )}
      {pane === 'news' && (
        <NewsPane
          openArticle={openNewsArticle}
          onOpenArticle={setOpenNewsArticle}
          onCloseArticle={() => setOpenNewsArticle(null)}
        />
      )}
    </Dialog>
  );
}
