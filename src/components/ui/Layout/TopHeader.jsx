import React from 'react';
import { Search, ChevronDown, ChevronRight, X, Bell, Hash } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { HeaderSearch } from '../Forms/HeaderSearch';
import { Breadcrumb } from '../Navigation/Breadcrumb';
import Popover from '../Navigation/Popover';
import Pill from '../DataDisplay/Pill';

/**
 * The workspace header: breadcrumbs on the left, notifications on the right.
 * It renders `Breadcrumb` and `HeaderSearch`, which is why neither appears
 * anywhere else — the product reaches both only through here.
 *
 * @param {{label: string, href?: string}[]} props.breadcrumbs The trail for the current screen.
 * @param {string} props.mode Which header this is; screens differ in what the right side carries.
 * @param {string} props.projectName Current client space, where the header names one.
 * @param {boolean} props.showParentCrumb Whether the trail starts at «Проєкти». False for an external client, who cannot open that screen.
 * @param {object} props.currentUser The signed-in user, for the avatar.
 * @param {() => void} props.onUserClick Opens the user menu.
 * @param {boolean} props.showNotifications Whether the bell is drawn.
 * @param {number} props.unreadCount Number on the bell.
 * @param {() => void} props.onBellClick Opens notifications.
 * @param {string} props.searchValue Current query in the header search.
 * @param {(value: string) => void} props.onSearchChange Fires with the new query.
 * @param {() => void} props.onSearchClear Clears the query.
 * @param {string} props.searchPlaceholder Placeholder for the search field.
 * @param {number|null} props.searchLocalResultCount Final local count from the current page.
 * @param {number} props.searchOutsideResultCount Broader count shown when local is empty.
 * @param {boolean} props.searchOutsideLoading Whether the broader count is loading.
 * @param {(query: string) => void} props.onSearchEscalate Opens the palette with the current query.
 * @param {boolean} props.projectSearchActive Whether the project search has replaced the trail.
 * @param {() => void} props.onProjectSearchToggle Opens and closes that search.
 * @param {React.ReactNode} props.rightContent Extra controls for the right side.
 * @param {boolean} props.hideBorder Drops the bottom divider where the page draws its own.
 */
export default function TopHeader({
  mode = 'search', // 'search', 'project', 'breadcrumbs', 'minimal'

  // Search Props
  searchValue = '',
  searchPlaceholder = 'Пошук...',
  onSearchChange = () => {},
  onSearchClear = () => {},
  onSearchEscalate = () => {},
  searchLocalResultCount = null,
  searchOutsideResultCount = 0,
  searchOutsideLoading = false,

  // Client-space Props. The implementation keeps the historical prop name so
  // callers and generated UI Kit reports do not need a second source of truth.
  projectName = 'Назва проєкту',
  showParentCrumb = true,
  projectSearchActive = false,
  onProjectSearchToggle = () => {},

  // Breadcrumbs Props
  breadcrumbs = [],

  // Project team props

  // Right Side Props
  showNotifications = true,
  unreadCount = 0,
  onBellClick = () => {},

  currentUser = null,
  onUserClick = () => {},

  // Right Side Override
  rightContent = null,

  // Styling
  hideBorder = false,
}) {
  const renderLeft = () => {
    if (mode === 'breadcrumbs') {
      return (
        <Breadcrumb items={breadcrumbs} />
      );
    }

    if (mode === 'project') {
      // A customer's trail is the space they are in and nothing above it.
      // «Проєкти ›» was drawn for everybody, and for a customer it named a
      // screen they may not open — the route boundary bounces them off
      // `/clients` — so the one crumb offering a way back led out of the
      // product and into a redirect. `showParentCrumb` is passed by the header,
      // which is the only place that knows who is looking.
      const projectCrumbs = [
        ...(showParentCrumb ? [{ label: 'Проєкти', href: '/clients' }] : []),
        { label: projectName, href: null },
      ];
      return (
        <Breadcrumb
          items={projectCrumbs}
          showSearchButton={true}
          isSearchActive={projectSearchActive}
          onSearchToggle={onProjectSearchToggle}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onSearchClear={onSearchClear}
          onSearchEscalate={onSearchEscalate}
          searchLocalResultCount={searchLocalResultCount}
          searchOutsideResultCount={searchOutsideResultCount}
          searchOutsideLoading={searchOutsideLoading}
          searchPlaceholder={`Пошук звернень проєкту "${projectName}"...`}
        />
      );
    }

    // Default: SEARCH mode
    return (
      <HeaderSearch
        value={searchValue}
        onChange={onSearchChange}
        onClear={onSearchClear}
        onEscalate={onSearchEscalate}
        localResultCount={searchLocalResultCount}
        outsideResultCount={searchOutsideResultCount}
        outsideLoading={searchOutsideLoading}
        placeholder={searchPlaceholder}
      />
    );
  };

  return (
    <header className={`h-[56px] shrink-0 bg-white flex items-center pl-[12px] pr-[8px] sm:pl-[16px] sm:pr-[10px] justify-between z-30 w-full ${!hideBorder ? 'border-b border-line' : ''}`}>
      <div className="flex-1 min-w-0 flex items-center">
        {renderLeft()}
      </div>

      {rightContent ? rightContent : (
        <div className="ml-2 flex shrink-0 items-center gap-[6px] z-50 sm:ml-4">
          {showNotifications && (
            <button
              type="button"
              onClick={onBellClick}
              aria-label={unreadCount > 0 ? `Сповіщення: ${unreadCount} непрочитаних` : 'Сповіщення'}
              title="Сповіщення"
              className={`relative w-[36px] h-[36px] flex items-center justify-center rounded-[10px] transition-all text-muted hover:bg-canvas hover:text-ink`}
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute top-[6px] right-[6px] min-w-[12px] h-[12px] bg-ink text-white text-[8px] font-bold rounded-full flex items-center justify-center px-[2px]">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onUserClick}
            aria-label="Відкрити меню користувача"
            title="Меню користувача"
            className="flex items-center justify-center w-[36px] h-[36px] rounded-[10px] hover:bg-canvas transition-all overflow-hidden"
          >
            {currentUser ? (
              <UserAvatar user={currentUser} size="sm" />
            ) : (
              <div className="w-[28px] h-[28px] rounded-full bg-line flex items-center justify-center">
                <span className="text-[12px] text-ink-soft font-bold">U</span>
              </div>
            )}
          </button>
        </div>
      )}
    </header>
  );
}
