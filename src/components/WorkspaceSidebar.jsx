'use client';
// src/components/WorkspaceSidebar.jsx
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import Image from 'next/image';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import { Counter, IconAction, OrganizationMark, Skeleton } from '@/components/ui';
import {
  Blocks,
  Folder, Users, Settings, ChevronsUpDown,
  Plus, LayoutDashboard, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { useProjectUnreadIndicators } from '@/lib/hooks/useProjectUnreadIndicators';
import Tooltip from '@/components/ui/Navigation/Tooltip';
import { computeSidebarTheme, SIDEBAR_PRESETS } from '@/lib/utils/sidebarTheme';
import { useCachedOrgBranding, useSidebarThemeBoot } from '@/lib/hooks/useCachedOrgBranding';
import WorkspaceHelpMenu from '@/components/WorkspaceHelpMenu';

import { can, isClientRole } from '@/lib/utils/can';
import {
  organizationPortalBackground,
  resolveOrganizationPortalBrand,
} from '@/lib/utils/organizationBranding.mjs';

/**
 * The two lines beside the mark, and there is one of them.
 *
 * The big line names the space you are in; the small line says what that space
 * is. A client's corner has always read that way — the provider's name over
 * «Портал підтримки» — and the staff rail read the other way round, in two
 * arrangements: «qTicket» big over the tenant's name small when the tenant had
 * no branding, the two swapped when it did. Three shapes for one corner, and in
 * one of them the organization somebody actually works in was the small print
 * above their vendor's name.
 *
 * The column is 36px and the words sit on the logo's axis rather than on the
 * text box's: for rows of ink 14 and 12, `nameRow = 18 + (14 − 12) / 2` gives
 * 19 + 17. Whoever changes a font size here re-measures — the split is derived
 * in `tests/sidebar-brand-lockup.test.mjs`.
 *
 * `canSwitch` is the whole of the switcher's presence. One organization is not
 * a choice, and a control that opens a picker of one is an invitation to find
 * out there was nothing to pick.
 */
function SidebarBrandLockup({
  href,
  name,
  label,
  switchLabel,
  canSwitch,
  unreadElsewhere,
  onSwitch,
  theme,
}) {
  return (
    <>
      <Link href={href} className="hover:opacity-80 transition-opacity">
        <h1
          data-ui-type="branding-title"
          className="h-[19px] truncate text-[16px] font-bold leading-[19px] tracking-tight"
          style={{ color: theme.text }}
        >
          {name}
        </h1>
      </Link>
      {canSwitch ? (
        <button
          type="button"
          onClick={onSwitch}
          aria-label={switchLabel}
          // The row takes the width it is given and the name is the part that
          // yields: `w-fit` plus a 120px name, a counter and a chevron adds up
          // to 156px in a column that is 140px wide, so the row simply hung
          // over the collapse button the moment a second organization had
          // anything unread.
          className="flex h-[17px] w-full min-w-0 items-center gap-[4px] text-left text-[12px] font-medium leading-[17px] transition-colors"
          style={{ color: theme.muted }}
        >
          <span className="min-w-0 truncate">{label}</span>
          {unreadElsewhere > 0 && (
            <Counter variant="dot" size="sm" appearance="sidebar" />
          )}
          <ChevronsUpDown size={12} className="shrink-0" aria-hidden />
        </button>
      ) : (
        <span
          className="h-[17px] truncate text-[12px] font-medium leading-[17px]"
          style={{ color: theme.muted }}
        >
          {label}
        </span>
      )}
    </>
  );
}

export default function WorkspaceSidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const searchParams = useSearchParams();
  const { projects, activeOrg, activeOrgId, orgRole, currentUser, orgLoading, allOrgs } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  // Особиста преференція цього браузера/пристрою — НЕ дані організації, тому
  // ніяк не синхронізується і не видно іншим учасникам команди.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return localStorage.getItem('qt_sidebar_collapsed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem('qt_sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  // Read, not subscribed. The rail used to count unread itself, which opened a
  // second pair of organization-wide listeners beside the pair the notification
  // bridge already keeps, so every page in the workspace paid for that list
  // twice. One publisher, many readers: the bridge publishes the number,
  // everything else reads it.
  const userId = currentUser?.id || currentUser?.uid;
  const { unreadProjectIds, markProjectRead } = useProjectUnreadIndicators(userId, activeOrgId);
  // Число публікує `WorkspaceNotificationBridge` — і воно вже готове. Тут
  // стояла друга копія тієї самої підміни «сповіщення або курсори», накладена
  // поверх опублікованого числа, у якому підміна вже відбулася: та сама умова
  // застосовувалась двічі, а дві копії одного правила рано чи пізно починають
  // відповідати по-різному. Сайдбар читає, як і нижня панель.
  const unreadByOrganization = useWorkspaceStore(s => s.notificationUnreadByOrg);
  const otherOrgUnreadCount = Object.entries(unreadByOrganization).reduce(
    (total, [organizationId, count]) => organizationId === activeOrgId ? total : total + count,
    0,
  );

  // ── Sidebar theme & Preview ──
  const sidebarPreview = useWorkspaceStore(s => s.sidebarPreview);
  const portalBrand = useMemo(
    () => resolveOrganizationPortalBrand(activeOrg),
    [activeOrg],
  );

  // ── Custom branding ──
  // orgBrand віддає кешований брендинг, поки документ організації ще
  // завантажується — без мигання стандартної теми при перезавантаженні.
  const orgBrand = useCachedOrgBranding(activeOrgId, activeOrg);
  const isBranded = sidebarPreview
    ? Boolean(sidebarPreview.customBranding && sidebarPreview.logo)
    : Boolean(orgBrand?.customBranding && orgBrand?.logo);

  const orgLogoToUse = sidebarPreview?.logo || orgBrand?.logo;


  const theme = useMemo(() => {
    // The external portal always carries the support provider's identity. It
    // is not the inherited paid "replace qTicket in the staff sidebar"
    // feature: it is how a client knows who receives their incident. A later
    // QuickTeam activation writes this snapshot under `portalBranding`.
    // The invitation landing page paints itself from the same two functions,
    // so the front door and the rail are the same shade of the same company.
    if (clientViewer) return computeSidebarTheme(organizationPortalBackground(portalBrand));

    // Priority: live preview from settings > org data (or its cache) > default dark
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

  // Кеш теми + зняття boot-стилю з layout.js, щойно тема справжня.
  useSidebarThemeBoot(theme, Boolean(activeOrg), activeOrgId);

  // Поки не приїхали живі дані (чи live-preview з налаштувань) — лого й назва
  // організації невідомі. Замість того щоб на мить показати "Company name" /
  // биту картинку, показуємо скелетон; логотип рендериться лише коли готово.
  const brandingReady = Boolean(sidebarPreview) || Boolean(activeOrg);

  useEffect(() => {
    const match = pathname.match(/^\/([^/]+)/);
    const projectId = match?.[1];
    if (projectId && projects?.some(project => project.id === projectId)) {
      markProjectRead(projectId).catch(error => console.error('[WorkspaceSidebar] mark project read', error));
    }
  }, [pathname, projects, markProjectRead]);

  const isActive = (href, exact, section) => {
    const targetPath = href.split('?')[0];
    const pathActive = exact ? pathname === targetPath : pathname.startsWith(targetPath);
    if (!pathActive || !section) return pathActive;
    return (searchParams.get('section') || 'profile') === section;
  };

  // Staff arrive through a signed QuickTeam launch, which replaces the entry it
  // came from — so the browser's own «back» is not a way back. The rail carries
  // the return instead. Only for an internal seat of a QuickTeam-provisioned
  // organization, and only when the workspace address is configured: a link to
  // a guessed origin would be worse than no link at all. A client never sees
  // it — they have no QuickTeam side to return to.
  const quickTeamUrl = (process.env.NEXT_PUBLIC_QUICKTEAM_URL || '').trim();
  const showQuickTeamReturn = Boolean(
    quickTeamUrl && !clientViewer && activeOrg?.quickTeam?.sourceOrganizationId,
  );

  const internalNav = [
    { href: '/overview',   icon: LayoutDashboard, label: 'Огляд' },
    { href: '/my',         icon: TaskIcon,        label: 'Звернення' },
    { href: '/clients',    icon: Folder,          label: 'Клієнти' },
    { href: '/team',       icon: Users,           label: 'Команда' },
    // A destination, listed where destinations are, rather than a footnote
    // under the client list. It used to sit at the very bottom of the rail
    // behind a divider — below every customer's name, which is a strange place
    // to look for the product you came from — and it was drawn with an
    // `ArrowUpRight` as its own icon: the row said «leaving» twice and never
    // said «QuickTeam». It carries a mark now, like every other row, and the
    // fact that it leaves is carried by the tooltip and by the anchor itself.
    ...(showQuickTeamReturn
      ? [{ href: quickTeamUrl, icon: Blocks, label: 'QuickTeam', external: true }]
      : []),
    { href: '/settings',   icon: Settings,      label: 'Налаштування' },
  ];
  // A client has exactly one space, and it is a real address — the same
  // `[projectId]` screen support opens. `/` only redirects into it, so a rail
  // entry pointing at `/` went inactive the moment the redirect landed. It
  // points at the space itself as soon as the spaces are known.
  const clientSpaceHref = useMemo(() => {
    const space = (projects || []).find(project => project.status !== 'archived');
    return space ? `/${space.id}` : '/';
  }, [projects]);
  const topNav = clientViewer
    ? [
        // The same first entry the internal rail has, leading to the same
        // address. `/overview` knows who is looking, so a customer's front
        // screen is the product's front screen and not a second one built for
        // them — see src/app/(app)/overview/page.js.
        { href: '/overview', icon: LayoutDashboard, label: 'Огляд' },
        // `TaskIcon`, the same mark «Звернення» carries on the support rail.
        // It was `Folder` — the icon this rail uses for a *client space* — so
        // the customer's entry drew a container beside the word «звернення»,
        // and the two halves of the product named one record with two glyphs.
        { href: clientSpaceHref, icon: TaskIcon, label: 'Мої звернення', exact: clientSpaceHref === '/' },
        // «Співробітники» used to point at `/settings?section=team` — an address
        // the settings rail named a second time on the screen it opened, so one
        // destination was named twice on one screen. The duplicate is gone from
        // the other end: the roster is a screen of its own now, and this entry
        // leads to it. It stays `client_admin`-only, because the route boundary
        // refuses `/team` to a `client_member` and a rail must not offer an
        // address that answers with a redirect.
        ...(orgRole === 'client_admin'
          ? [{ href: '/team', icon: Users, label: 'Співробітники' }]
          : []),
        //
        // The same destination the internal rail ends with, under the same
        // name. «Мій профіль» was a third word for one screen.
        { href: '/settings', icon: Settings, label: 'Налаштування', section: 'profile' },
      ]
    : internalNav;
  // One front door for both roles now that `/overview` serves both.
  const homeHref = '/overview';

  return (
    <aside
      data-app-sb
      style={{
        width: collapsed ? 68 : 260,
        // Painted from the variable, not from the value. The boot script in
        // src/app/layout.js overrides `--sb-bg` with `!important` before the
        // first frame, and an important stylesheet declaration beats a normal
        // inline one — which is what keeps the branded rail from flashing dark
        // now that the script no longer writes `background-color` itself.
        backgroundColor: 'var(--sb-bg)',
        '--sb-bg': theme.bg,
        '--sb-text': theme.text,
        '--sb-muted': theme.muted,
        '--sb-hover': theme.hover,
        '--sb-active': theme.active,
        '--sb-border': theme.border,
        '--sb-muted-project': theme.mutedProject || theme.muted,
        '--sb-muted-header': theme.mutedHeader || theme.muted,
      }}
      className="h-full flex flex-col transition-[width] duration-200 shrink-0 overflow-hidden hide-scrollbar relative group"
    >
      {/* Top Logo & Org Switcher */}
      <div className={`flex flex-col pt-[24px] pb-[16px] shrink-0 ${collapsed ? 'px-0 items-center' : 'px-[20px]'}`}>
        <div className={`flex items-start ${collapsed ? 'justify-center w-full' : 'justify-between w-full'}`}>
          {!collapsed ? (
            <>
              <div className="flex items-center min-w-0 flex-1">
                {!brandingReady ? (
                  /* ── Skeleton: доки не приїхали дані організації, краще
                     нічого не показувати, ніж "Company name" / бите лого ── */
                  <>
                    {/* `--sb-hover` is rgba(255,255,255,0.04) on a dark sidebar
                        — four percent of white, which is a hover tint and not
                        a shape. Drawn with it, the skeleton was invisible often
                        enough that the corner just looked empty. The kit's
                        `sidebar` tone mixes from the sidebar's own text colour,
                        so it stays legible on the dark, light and custom
                        themes alike. */}
                    <Skeleton preset="logo" tone="sidebar" className="shrink-0" />
                    {/* Той самий розклад висот (16px + 20px), що й у реального
                        контенту нижче — щоб перехід скелетон → справжні дані
                        не смикав layout ні на піксель. */}
                    <div className="flex flex-1 flex-col min-w-0 ml-[12px]">
                      <div className="h-[16px] flex items-center">
                        <Skeleton preset="caption" width="wide" tone="sidebar" />
                      </div>
                      <div className="h-[20px] flex items-center">
                        <Skeleton preset="caption" width="half" tone="sidebar" style={{ animationDelay: '120ms' }} />
                      </div>
                    </div>
                  </>
                ) : clientViewer ? (
                  <Link href={homeHref} className="shrink-0 transition-opacity hover:opacity-80" aria-label="На головну">
                    <OrganizationMark
                      name={portalBrand.name}
                      logo={portalBrand.logo}
                      size="sm"
                      appearance="sidebar"
                    />
                  </Link>
                ) : isBranded ? (
                  /* The tenant's mark, and only the tenant's. This used to be
                     a card that flipped on hover to show the qTicket logo on
                     its back: a white-label rail that revealed its vendor to
                     anybody who moved a pointer across the corner. A brand the
                     tenant chose does not turn over — on either side. */
                  <Link
                    href={homeHref}
                    className="block w-[32px] h-[32px] shrink-0 transition-opacity hover:opacity-80"
                    title="На головну"
                    aria-label="На головну"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={orgLogoToUse}
                      alt={activeOrg?.name || 'Logo'}
                      className="w-[32px] h-[32px] rounded-[8px] object-cover"
                    />
                  </Link>
                ) : (
                  <Link href={homeHref} className="flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity">
                    <Image src={theme.isDark ? '/logo-min.svg' : '/logo-min-dark.svg'} alt="QT" width={32} height={32} loading="eager" className="object-contain" />
                  </Link>
                )}
                {brandingReady && (
                  <div className="flex flex-col min-w-0 ml-[12px]">
                    {/* A client is in the support provider's portal, not in
                        qTicket, so the provider is the primary identity and the
                        product name does not appear in their corner at all. A
                        member of staff is in their own organization, inside
                        qTicket. Two readers, two pairs of words, one lockup. */}
                    <SidebarBrandLockup
                      href={homeHref}
                      name={clientViewer
                        ? portalBrand.name
                        : (activeOrg?.name || 'Company name')}
                      label={clientViewer ? 'Портал підтримки' : 'qTicket'}
                      switchLabel={clientViewer
                        ? 'Змінити портал підтримки'
                        : 'Змінити організацію'}
                      canSwitch={(allOrgs || []).length > 1}
                      unreadElsewhere={otherOrgUnreadCount}
                      onSwitch={() => setShowOrgSwitcher(true)}
                      theme={theme}
                    />
                  </div>
                )}
              </div>
              {/* The hit area used to be a bare pseudo-element inset around a
                  20px glyph: bigger to click, but nothing answered the cursor,
                  so it read as decoration. It is a real 32px control now — its
                  own box, its own hover tint, its own pointer. */}
              {/* The quiet tier, not the navigation tier. Folding the rail away
                  is chrome around the rail, and drawn at `--sb-muted` it was as
                  loud as the destinations it sits above. It brightens to
                  `--sb-text` on hover like everything else here, so it is still
                  obviously a control once you are pointing at it. */}
              <button
                onClick={() => setCollapsed(true)}
                data-ui-control="branding-action"
                data-ui-action="sidebar-collapse"
                className="flex h-[36px] w-[36px] shrink-0 cursor-pointer items-center justify-center rounded-[10px] transition-colors"
                style={{ color: 'var(--sb-muted-header)' }}
                onMouseEnter={e => {
                  e.currentTarget.style.backgroundColor = 'var(--sb-hover)';
                  e.currentTarget.style.color = 'var(--sb-text)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = 'var(--sb-muted-header)';
                }}
                title="Сховати панель"
                aria-label="Згорнути бічну панель"
              >
                <PanelLeftClose size={20} />
              </button>
            </>
          ) : (
            <div className="flex items-center justify-center w-full h-[36px]">
              <Tooltip content="Розгорнути панель" position="right" className="flex items-center justify-center w-full h-full">
                <button
                  onClick={() => setCollapsed(false)}
                  aria-label="Розгорнути бічну панель"
                  data-ui-control="branding-action"
                  data-ui-action="sidebar-collapse"
                  className="flex h-[36px] w-[36px] cursor-pointer items-center justify-center rounded-[10px] transition-colors"
                  style={{ color: 'var(--sb-muted-header)' }}
                  onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = 'var(--sb-hover)';
                    e.currentTarget.style.color = 'var(--sb-text)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                    e.currentTarget.style.color = 'var(--sb-muted-header)';
                  }}
                >
                  <PanelLeftOpen size={20} />
                </button>
              </Tooltip>
            </div>
          )}
        </div>
      </div>

      {/* Main Navigation (y=88 in Figma) */}
      <nav className="pt-[8px] flex flex-col gap-[4px] shrink-0">
        {topNav.map(({ href, icon: Icon, label, exact, section, external }) => {
          // A neighbouring product is not a route of this one: it gets a real
          // anchor rather than a client-side navigation, and it is never the
          // active row, because you are never on it while you are reading this.
          const active = external ? false : isActive(href, exact, section);
          const Row = external ? 'a' : Link;
          // The rail says «QuickTeam»; the hover says what pressing it does.
          const rowLabel = external ? 'Повернутися в QuickTeam' : label;
          return (
            <Row key={href} href={href} {...(external ? { rel: 'noopener' } : null)}
              title={collapsed ? undefined : rowLabel}
              className="flex items-center mx-[8px] h-[40px] rounded-[12px] transition-all"
              style={{
                backgroundColor: active ? 'var(--sb-active)' : 'transparent',
                color: active ? 'var(--sb-text)' : 'var(--sb-muted)',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.backgroundColor = 'var(--sb-hover)'; e.currentTarget.style.color = 'var(--sb-text)'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--sb-muted)'; } }}
            >
              <Tooltip content={collapsed ? rowLabel : null} position="right" className="w-full h-full flex items-center">
                <div className={`flex items-center w-full h-full ${collapsed ? 'justify-center' : 'pl-[12px] gap-[16px] pr-[12px]'}`}>
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && <span className="text-[13px] font-medium">{label}</span>}
                </div>
              </Tooltip>
            </Row>
          );
        })}
      </nav>

      {clientViewer ? (
        // External users have one portal surface. Listing the underlying
        // project here exposed an implementation detail and linked straight
        // back to a route that immediately redirected to «Мої звернення».
        <div className="flex-1" />
      ) : (
        <>
      <div className="mx-[12px] mt-[16px] mb-[16px]" style={{ borderTop: '1px solid var(--sb-border)' }} />

      {/* Client workspaces are internal support navigation. */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {!collapsed && (
          <div className="flex items-center justify-between px-[16px] mb-[16px]">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--sb-muted-header)' }}>
              КЛІЄНТИ
            </p>
            {can(orgRole, 'create:project') && (
              <button
                onClick={() => router.push('/clients?new=1')}
                data-ui-control="branding-action"
                className="transition-colors" title="Новий клієнт"
                style={{ color: 'var(--sb-muted-header)' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--sb-text)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--sb-muted-header)'; }}
              >
                <Plus size={16} />
              </button>
            )}
          </div>
        )}
        <div className="flex flex-col gap-[4px]">
          {(projects || [])
            .filter(p => p.status !== 'archived')
            .map(p => {
              const active = pathname.startsWith(`/${p.id}`);
              return (
                <Link key={p.id} href={`/${p.id}`} title={collapsed ? undefined : p.name}
                  className="flex items-center mx-[8px] h-[32px] rounded-[8px] transition-all"
                  style={{
                    backgroundColor: active ? 'var(--sb-active)' : 'transparent',
                    color: active ? 'var(--sb-text)' : 'var(--sb-muted-project)',
                  }}
                  onMouseEnter={e => { if (!active) { e.currentTarget.style.backgroundColor = 'var(--sb-hover)'; e.currentTarget.style.color = 'var(--sb-text)'; } }}
                  onMouseLeave={e => { if (!active) { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--sb-muted-project)'; } }}
                >
                  <Tooltip content={collapsed ? p.name : null} position="right" className="w-full h-full flex items-center">
                    <div className={`flex items-center w-full h-full ${collapsed ? 'justify-center' : 'pl-[12px] gap-[16px] pr-[12px]'}`}>
                      <Folder size={15} className="shrink-0" />
                      {!collapsed && <span className="text-[12px] font-medium truncate">{p.name}</span>}
                      {!collapsed && !active && unreadProjectIds.has(p.id) && (
                        <Counter variant="dot" size="sm" status="info" className="ml-auto" dark={theme.isDark} />
                      )}
                    </div>
                  </Tooltip>
                </Link>
              );
            })}
        </div>
      </div>
        </>
      )}

      <WorkspaceHelpMenu collapsed={collapsed} />

      {/* Org switcher modal */}
      {showOrgSwitcher && (
        <OrgSwitcherScreen onClose={() => setShowOrgSwitcher(false)} />
      )}
    </aside>
  );
}
