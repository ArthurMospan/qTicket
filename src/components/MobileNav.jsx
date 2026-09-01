'use client';
// src/components/MobileNav.jsx — mobile bottom tab bar + «Ще» sheet
// Renders only below md (the wrapper in workspace/layout.js is md:hidden).
// Primary destinations live in the bar; everything else from the desktop
// sidebar (команда, налаштування, список клієнтів) —
// у висувній шторці «Ще».
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { Button, Counter, IconAction, OrganizationMark } from '@/components/ui';
import { can, isClientRole } from '@/lib/utils/can';
import {
  Folder, LayoutDashboard, Menu, X,
  Users, Settings, Plus, ChevronsUpDown, CircleHelp, UserRound,
} from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import { useWorkspaceHelp } from '@/components/WorkspaceHelpMenu';
import { computeSidebarTheme, computeTranslucentSidebarTheme, SIDEBAR_PRESETS } from '@/lib/utils/sidebarTheme';
import { useCachedOrgBranding, useSidebarThemeBoot } from '@/lib/hooks/useCachedOrgBranding';
import { useModalFocus } from '@/lib/hooks/useModalFocus';
import { resolveOrganizationPortalBrand } from '@/lib/utils/organizationBranding.mjs';

// The bar is glass: the organization's colour at this much opacity over a blur
// of whatever is scrolling underneath. It is a request rather than a setting —
// `computeTranslucentSidebarTheme` hands back the opacity the brand colour can
// actually afford while its labels still clear AA, and that is the number the
// bar is painted with.
const NAV_OPACITY = 0.88;

const TABS = [
  { href: '/overview', icon: LayoutDashboard, label: 'Огляд' },
  { href: '/my',       icon: TaskIcon,        label: 'Звернення' },
  { href: '/clients',  icon: Folder,          label: 'Проєкти' },
];

const MORE_NAV = [
  { href: '/team',     icon: Users,    label: 'Команда' },
  { href: '/settings', icon: Settings, label: 'Налаштування' },
];

/**
 * @param {boolean} props.keyboardOpen The on-screen keyboard is covering part of
 *   the viewport, so there is neither room for a tab bar nor a reason for one —
 *   the reader is typing, not navigating. Measured by the workspace layout,
 *   which watches for it on every route, including the two that render no bar.
 */
export default function MobileNav({ keyboardOpen = false }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projects, activeOrg, activeOrgId, orgRole, allOrgs } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  // The address the rail already points at, read the same way. `/` is a door
  // into the client's space and not the space itself, so a tab aimed at `/`
  // stopped being the current route the moment the redirect landed and could
  // never light up. Two navigations disagreeing about where «Мої звернення»
  // lives is the seam; there is one answer and both read it.
  // «The one, if there is one», exactly as the desktop rail answers it. This
  // said «the first», which is a different answer as soon as a customer holds
  // two projects — and they can since 2026-09-01. A phone would have picked one
  // of them silently and offered no way to reach the other.
  const clientProjects = useMemo(
    () => (projects || []).filter(project => project.status !== 'archived'),
    [projects],
  );
  const clientSpaceHref = clientProjects.length === 1 ? `/${clientProjects[0].id}` : '/';
  const visibleTabs = clientViewer
    ? [
        // The rail's first entry, in the bar's first slot. `/overview` serves
        // both audiences now, so the phone and the desktop open the same front
        // screen for a customer.
        { href: '/overview', icon: LayoutDashboard, label: 'Огляд' },
        // The same name and the same mark the desktop rail uses. The bar said
        // «Звернення» with a `Folder` — the icon this product gives a project —
        // while the rail two hundred pixels wider said «Мої звернення» with the
        // record's own icon. One product, one record, two navigations that
        // disagreed about both.
        ...(clientProjects.length === 1
          ? [{ href: clientSpaceHref, icon: TaskIcon, label: 'Мої звернення', exact: false }]
          // The desktop rail's answer to the same problem, in the bar: several
          // projects have no single address, so the entry becomes the screen
          // that lists them. The bar and the rail name the same places.
          : [{ href: '/clients', icon: Folder, label: 'Проєкти' }]),
        // «Співробітники» stood here and pointed at `/settings?section=team` —
        // the settings rail names that same destination again on the screen it
        // opens. The client roster lives at `/team` now.
      ]
    : TABS;
  // «Налаштування», not «Мій профіль»: the desktop rail already dropped the
  // second name for this screen and the sheet kept it, which left one address
  // with two labels across the two navigations of one product.
  const visibleMoreNav = clientViewer
    ? [
        // The roster is a screen of its own now rather than a section of
        // «Налаштування», and it belongs to a `client_admin` alone — the route
        // boundary refuses `/team` to a `client_member`, and a navigation must
        // not offer an address that answers with a redirect. It lives in the
        // sheet rather than the bar because the bar holds the two places a
        // customer is actually in all day.
        ...(orgRole === 'client_admin'
          ? [{ href: '/team', icon: Users, label: 'Співробітники' }]
          : []),
        { href: '/settings?section=profile', icon: UserRound, label: 'Налаштування', section: 'profile' },
      ]
    : MORE_NAV;
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const moreDialogRef = useModalFocus({ isOpen: moreOpen, onClose: () => setMoreOpen(false) });
  // Довідка, підтримка, новини та правові документи — той самий список, що
  // висить на кебабі бічної рейки. Його діалоги живуть поза шторкою: шторка
  // закривається від дотику, а діалог має лишитися на екрані.
  const { items: helpItems, overlays: helpOverlays } = useWorkspaceHelp();

  const unreadByOrganization = useWorkspaceStore(s => s.notificationUnreadByOrg);
  const otherOrgUnreadCount = Object.entries(unreadByOrganization).reduce(
    (total, [organizationId, count]) => organizationId === activeOrgId ? total : total + count,
    0,
  );

  // Close the sheet on navigation
  const sidebarPreview = useWorkspaceStore(s => s.sidebarPreview);
  const portalBrand = useMemo(
    () => resolveOrganizationPortalBrand(activeOrg),
    [activeOrg],
  );
  // Кеш брендингу — без мигання стандартної теми, поки org завантажується.
  const orgBrand = useCachedOrgBranding(activeOrgId, activeOrg);
  const isBranded = sidebarPreview
    ? Boolean(sidebarPreview.customBranding && sidebarPreview.logo)
    : Boolean(orgBrand?.customBranding && orgBrand?.logo);

  const theme = useMemo(() => {
    if (clientViewer) {
      const bgColor = portalBrand.sidebarTheme === 'light' ? SIDEBAR_PRESETS.light
        : portalBrand.sidebarTheme === 'custom'
          ? (portalBrand.sidebarColor || SIDEBAR_PRESETS.dark)
          : SIDEBAR_PRESETS.dark;
      return computeSidebarTheme(bgColor);
    }

    const source = sidebarPreview || (isBranded ? {
      theme: orgBrand?.sidebarTheme || 'dark',
      color: orgBrand?.sidebarColor || SIDEBAR_PRESETS.dark,
    } : null);

    if (!source) return computeSidebarTheme(SIDEBAR_PRESETS.dark);

    const bgColor = source.theme === 'light' ? SIDEBAR_PRESETS.light
      : source.theme === 'custom' ? (source.color || SIDEBAR_PRESETS.dark)
      : SIDEBAR_PRESETS.dark;

    return computeSidebarTheme(bgColor);
  }, [clientViewer, isBranded, orgBrand?.sidebarTheme, orgBrand?.sidebarColor, portalBrand, sidebarPreview]);

  // The sheet is opaque and wears `theme`; the bar is glass and wears this.
  // Same organization colour, tokens derived from what it looks like through
  // the page rather than from what it is.
  const barTheme = useMemo(
    () => computeTranslucentSidebarTheme(theme.bg, { opacity: NAV_OPACITY }),
    [theme.bg],
  );

  // Кеш теми + зняття boot-стилю з layout.js, щойно тема справжня.
  useSidebarThemeBoot(theme, Boolean(activeOrg), activeOrgId);

  useEffect(() => { queueMicrotask(() => setMoreOpen(false)); }, [pathname]);


  const isActive = (href, exact, section) => {
    const targetPath = href.split('?')[0];
    const pathActive = exact ? pathname === targetPath : pathname.startsWith(targetPath);
    if (!pathActive || !section) return pathActive;
    return (searchParams.get('section') || 'profile') === section;
  };
  // «Ще» is highlighted when the current page lives in the sheet
  const moreActive = visibleMoreNav.some(i => isActive(i.href, i.exact, i.section));

  return (
    <>
      {/* The last of the page, dissolving. The bar is glass and the content
          runs underneath it, so what needed handling was the edge: a row cut
          flat at the bottom of the screen, and the 10px beside the pill where
          nothing covered it at all. Behind the bar, never in front of it, and
          never in the way of a thumb. */}
      <div
        aria-hidden="true"
        className={`qt-nav-veil transition-opacity duration-200 ${keyboardOpen ? 'opacity-0' : 'opacity-100'}`}
      />

      {/* ── Bottom tab bar ─────────────────────────────────────────────
          A floating capsule rather than a strip welded to the bottom edge:
          inset from all three sides, so the corner radius is real and the bar
          never has to share an edge with the browser's own chrome. The
          geometry, the glass and the two shadows live in globals.css
          (--qt-nav-*, .qt-nav-bar); what this file supplies is the colour and
          how much of it the page is allowed to show through. */}
      <nav
        data-app-sb
        data-nav-tone={barTheme.isDark ? 'dark' : 'light'}
        aria-label="Основна навігація"
        aria-hidden={keyboardOpen}
        className={`qt-nav-bar fixed z-40 flex items-stretch overflow-hidden transition-[transform,opacity] duration-200 ${
          keyboardOpen ? 'pointer-events-none translate-y-[140%] opacity-0' : 'translate-y-0 opacity-100'
        }`}
        style={{
          left: 'var(--qt-nav-gap)',
          right: 'var(--qt-nav-gap)',
          bottom: 'var(--qt-nav-inset)',
          height: 'var(--qt-nav-height)',
          '--qt-nav-opacity': `${barTheme.opacity * 100}%`,
          '--sb-bg': barTheme.bg,
          '--sb-text': barTheme.text,
          '--sb-muted': barTheme.muted,
          '--sb-hover': barTheme.hover,
          '--sb-active': barTheme.active,
          '--sb-border': barTheme.border,
        }}
      >
        {visibleTabs.map(({ href, icon: Icon, label, exact, section }) => {
          const active = isActive(href, exact, section);
          return (
            <Link key={href} href={href}
              aria-current={active ? 'page' : undefined}
              className={`relative flex-1 flex flex-col items-center justify-center gap-[3px] transition-colors active:bg-[var(--sb-active)] ${
                active ? 'text-[var(--sb-text)]' : 'text-[var(--sb-muted)] hover:text-[var(--sb-hover)]'
              }`}>
              <Icon size={20} />
              <span className="text-[10px] font-semibold leading-none">{label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          // The help list is closed every time the sheet is opened: it is the
          // answer to a question somebody asked once, not a section that stays
          // expanded behind them.
          onClick={() => { setHelpOpen(false); setMoreOpen(o => !o); }}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          className={`relative flex-1 flex flex-col items-center justify-center gap-[3px] transition-colors active:bg-[var(--sb-active)] ${
            moreOpen || moreActive ? 'text-[var(--sb-text)]' : 'text-[var(--sb-muted)] hover:text-[var(--sb-hover)]'
          }`}>
          <Menu size={20} />
          <span className="text-[10px] font-semibold leading-none">Ще</span>
          {otherOrgUnreadCount > 0 && (
            <span className="absolute top-[6px] left-[calc(50%+4px)]">
              <Counter variant="dot" size="sm" appearance="sidebar" />
            </span>
          )}
        </button>
      </nav>

      {/* ── «Ще» bottom sheet ──────────────────────────────────────── */}
      {moreOpen && (
        <div data-ui-overlay="navigation-sheet" className="fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            ref={moreDialogRef}
            tabIndex={-1}
            onClick={e => e.stopPropagation()}
            // A sheet is a dialog: it covers the page, it traps the reader's
            // attention, and it says so. Without the role it was an anonymous
            // box, and the layer behind it an anonymous click target.
            role="dialog"
            aria-modal="true"
            aria-label="Більше розділів"
            // Inset and rounded on every corner, like the bar it replaces —
            // a full-bleed sheet under a floating pill read as two different
            // apps. dvh, not vh, so the cap is the space that actually exists
            // once the browser's toolbars are counted.
            className="qt-sheet-in absolute bg-[var(--sb-bg)] rounded-[24px] max-h-[78dvh] overflow-y-auto overscroll-contain"
            style={{
              left: 'var(--qt-nav-gap)',
              right: 'var(--qt-nav-gap)',
              bottom: 'var(--qt-nav-inset)',
              paddingBottom: '12px',
              '--sb-bg': theme.bg,
              '--sb-text': theme.text,
              '--sb-muted': theme.muted,
              '--sb-hover': theme.hover,
              '--sb-active': theme.active,
              '--sb-border': theme.border,
            }}
          >
            {/* Handle + org row */}
            <div className="sticky top-0 bg-[var(--sb-bg)] pt-[10px] pb-[4px]">
              <div className="w-[36px] h-[4px] bg-[var(--sb-text)] opacity-20 rounded-full mx-auto mb-[12px]" />
              <div className="flex items-center justify-between px-[20px] pb-[8px]">
                <div className="flex min-w-0 items-center gap-[10px] text-[var(--sb-text)]">
                  <OrganizationMark
                    name={clientViewer ? portalBrand.name : (activeOrg?.name || 'qTicket')}
                    logo={clientViewer ? portalBrand.logo : (activeOrg?.logo || activeOrg?.logoUrl || '')}
                    size="sm"
                    appearance="sidebar"
                  />
                  {(allOrgs || []).length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setShowOrgSwitcher(true)}
                      className="flex min-w-0 items-center gap-[6px] text-left"
                    >
                      <span className="truncate text-[15px] font-bold">
                        {clientViewer ? portalBrand.name : (activeOrg?.name || 'qTicket')}
                      </span>
                      {otherOrgUnreadCount > 0 && (
                        <Counter variant="dot" size="sm" appearance="sidebar" />
                      )}
                      <ChevronsUpDown size={14} className="shrink-0 text-[var(--sb-muted)]" />
                    </button>
                  ) : (
                    <span className="truncate text-[15px] font-bold">
                      {clientViewer ? portalBrand.name : (activeOrg?.name || 'qTicket')}
                    </span>
                  )}
                </div>
                <IconAction label="Закрити" icon={X} size="sm" appearance="quiet" onClick={() => setMoreOpen(false)} className="-mr-[6px]" />
              </div>
            </div>

            {/* Secondary nav */}
            <div className="flex flex-col gap-[2px] px-[8px]">
              {visibleMoreNav.map(({ href, icon: Icon, label, exact, section }) => {
                const active = isActive(href, exact, section);
                return (
                  <Link key={href} href={href}
                    className={`flex items-center gap-[14px] h-[44px] px-[12px] rounded-[12px] transition-colors ${
                      active ? 'bg-[var(--sb-active)] text-[var(--sb-text)]' : 'text-[var(--sb-muted)] hover:text-[var(--sb-hover)]'
                    }`}>
                    <Icon size={19} />
                    <span className="text-[14px] font-medium">{label}</span>
                  </Link>
                );
              })}
            </div>

            {(!clientViewer || clientProjects.length > 1) && (
              <>
            <div className="mx-[16px] border-t border-white/[0.08] my-[10px]" />

            {/* Support's client list — and, since a customer may hold more than
                one project, theirs too. Without this a customer with two
                projects had a bar entry that could not name either and no list
                anywhere on a phone to reach the second one. */}
            <div className="flex items-center justify-between px-[20px] pb-[8px]">
              <p className="text-[11px] font-bold text-[var(--sb-muted)] uppercase tracking-wider">
                Проєкти
              </p>
              {can(orgRole, 'create:project') && (
                <IconAction
                  label="Новий проєкт"
                  icon={Plus}
                  size="sm"
                  appearance="quiet"
                  onClick={() => { setMoreOpen(false); router.push('/clients?new=1'); }}
                  className="-mr-[4px]"
                />
              )}
            </div>
            <div className="flex flex-col gap-[2px] px-[8px]">
              {(projects || [])
                .filter(p => p.status !== 'archived')
                .map(p => {
                  const active = pathname.startsWith(`/${p.id}`);
                  return (
                    <Link key={p.id} href={`/${p.id}`}
                      className={`flex items-center gap-[14px] h-[40px] px-[12px] rounded-[10px] transition-colors ${
                        active ? 'bg-[var(--sb-active)] text-[var(--sb-text)]' : 'text-[var(--sb-muted)]'
                      }`}>
                      <Folder size={16} className="shrink-0" />
                      <span className="text-[13px] font-medium truncate">{p.name}</span>
                    </Link>
                  );
                })}
            </div>
              </>
            )}

            {/* Довідка. На десктопі вона висить на кебабі внизу рейки; на
                телефоні рейки немає, тож підтримка, довідка, новини й правові
                документи не мали жодного входу взагалі. */}
            <div className="mx-[16px] border-t border-white/[0.08] my-[10px]" />
            {helpOpen && (
              <div className="flex flex-col gap-[2px] px-[8px] pb-[6px]">
                {helpItems.filter(item => !item.isDivider).map(({ label, icon: Icon, onClick }) => (
                  <button
                    key={label}
                    type="button"
                    // The sheet's own row, wearing the sidebar theme variables the
                    // two lists above it wear. Those are `Link`s because they go
                    // somewhere; these open a dialog in place, which is the one
                    // difference — so the element differs and nothing else does.
                    data-ui-control="navigation-sheet-row"
                    onClick={() => { setMoreOpen(false); onClick(); }}
                    className="flex items-center gap-[14px] h-[40px] px-[12px] rounded-[10px] text-left text-[var(--sb-muted)] transition-colors hover:text-[var(--sb-hover)] active:bg-[var(--sb-active)]"
                  >
                    <Icon size={17} className="shrink-0" />
                    <span className="text-[13px] font-medium truncate">{label}</span>
                  </button>
                ))}
              </div>
            )}
            {/* The same quiet circle the rail carries, in the same place: last,
                small, and closed until it is asked. Seven legal-and-support
                rows printed under the client list made the sheet's longest section
                the one nobody opened it for. */}
            <div className="flex items-center px-[13px]">
              <Button
                style="ghost"
                size="icon"
                icon={CircleHelp}
                composition="sidebar-help-action"
                onClick={() => setHelpOpen(open => !open)}
                aria-expanded={helpOpen}
                aria-label="Допомога та інформація"
                title="Допомога та інформація"
              />
            </div>
          </div>
        </div>
      )}

      {helpOverlays}

      {showOrgSwitcher && <OrgSwitcherScreen onClose={() => setShowOrgSwitcher(false)} />}
    </>
  );
}
