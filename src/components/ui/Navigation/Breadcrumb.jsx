import Link from 'next/link';
import { ChevronRight, Copy, Search } from 'lucide-react';
import { HeaderSearch } from '../Forms/HeaderSearch';

/**
 * The trail on the left of the workspace header, optionally with the search
 * that expands over it. Rendered by `TopHeader` on every screen — the product
 * never calls it directly, which is why it has no preview of its own.
 *
 * @param {{label: string, href?: string}[]} props.items The trail, root first; the last entry is the current page.
 * @param {boolean} props.showSearchButton Whether the trail offers a search toggle at all.
 * @param {boolean} props.isSearchActive Whether the search has replaced the trail.
 * @param {() => void} props.onSearchToggle Opens and closes the search.
 * @param {string} props.searchValue Current query.
 * @param {(value: string) => void} props.onSearchChange Fires with the new query.
 * @param {() => void} props.onSearchClear Clears the query.
 * @param {string} props.searchPlaceholder Placeholder for the search field.
 * @param {number|null} props.searchLocalResultCount Final local count from the current page.
 * @param {number} props.searchOutsideResultCount Broader count shown when local is empty.
 * @param {boolean} props.searchOutsideLoading Whether the broader count is loading.
 * @param {(query: string) => void} props.onSearchEscalate Opens the palette with the current query.
 * @param {string} props.className Placement in the parent only.
 */
export function Breadcrumb({
  items = [],
  className = '',
  // Search toggle configuration (Project mode)
  showSearchButton = false,
  isSearchActive = false,
  onSearchToggle = () => {},
  searchValue = '',
  onSearchChange = () => {},
  onSearchClear = () => {},
  onSearchEscalate = () => {},
  searchLocalResultCount = null,
  searchOutsideResultCount = 0,
  searchOutsideLoading = false,
  searchPlaceholder = 'Пошук...',
}) {
  if (!items || items.length === 0) {
    return null;
  }

  if (isSearchActive) {
    return (
      <div className={`flex items-center min-w-0 ${className}`}>
        <HeaderSearch
          autoFocus
          value={searchValue}
          onChange={onSearchChange}
          onClear={onSearchClear}
          onEscalate={onSearchEscalate}
          localResultCount={searchLocalResultCount}
          outsideResultCount={searchOutsideResultCount}
          outsideLoading={searchOutsideLoading}
          placeholder={searchPlaceholder}
          className="min-w-0 w-full max-w-[300px] border-ink"
        />
      </div>
    );
  }

  return (
    <nav className={`flex items-center gap-[6px] min-w-0 text-[13px] ${className}`} aria-label="Breadcrumb">
      <ol className="flex items-center gap-[6px] min-w-0">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          const isClickable = item.href && !isLast;
          const isAction = typeof item.onClick === 'function';

          return (
            <li key={index} className="flex items-center gap-[6px] min-w-0">
              {index > 0 && (
                <ChevronRight size={13} className="text-faint shrink-0" aria-hidden="true" />
              )}

              {showSearchButton && isLast && (
                <button
                  type="button"
                  onClick={onSearchToggle}
                  aria-label="Пошук"
                  className="p-[4px] text-muted hover:bg-canvas hover:text-ink rounded-[6px] transition-all shrink-0 mr-[2px]"
                  title="Пошук"
                >
                  <Search size={14} />
                </button>
              )}

              <span className="flex items-center min-w-0">
                {isClickable ? (
                  <Link
                    href={item.href}
                    className="text-muted hover:text-ink font-normal truncate transition-colors max-w-[140px]"
                  >
                    {item.label}
                  </Link>
                ) : isAction ? (
                  <button
                    type="button"
                    onClick={item.onClick}
                    title={item.title || 'Копіювати'}
                    aria-label={item.title || `Копіювати ${item.label}`}
                    className={`group flex min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 py-1 transition-colors hover:bg-canvas ${isLast ? 'font-medium text-ink' : 'font-normal text-muted hover:text-ink'}`}
                  >
                    <span className="max-w-[260px] truncate">{item.label}</span>
                    <Copy size={12} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 max-md:opacity-100" />
                  </button>
                ) : (
                  <span
                    className={`truncate max-w-[260px] ${
                      isLast ? 'font-medium text-ink' : 'text-muted font-normal'
                    }`}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Breadcrumb;
