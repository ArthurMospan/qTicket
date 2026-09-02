'use client';
// src/components/WorkspaceSidebar.jsx
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import { Counter, IconAction, OrganizationMark, Skeleton } from '@/components/ui';
import {
  Blocks,
  Folder, Users, Settings, ChevronsUpDown,
  LayoutDashboard, PanelLeftClose, PanelLeftOpen,
} from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { useProjectUnreadIndicators } from '@/lib/hooks/useProjectUnreadIndicators';
import Tooltip from '@/components/ui/Navigation/Tooltip';
import { computeSidebarTheme } from '@/lib/utils/sidebarTheme';
import { useCachedOrgBranding, useSidebarThemeBoot } from '@/lib/hooks/useCachedOrgBranding';
import WorkspaceHelpMenu from '@/components/WorkspaceHelpMenu';

import { isClientRole } from '@/lib/utils/can';
import {
  organizationPortalBackground,
  resolveOrganizationPortalBrand,
} from '@/lib/utils/organizationBranding.mjs';

/**
 * The two lines beside the mark, and there is one of them.
 *
 * The small line says what this place is; the big line under it names which one
 * you are in — «Портал підтримки» over the desk's own name, the one brand
 * QuickTeam sends, read the same by a customer and by the member of staff who
 * runs the desk. It is the arrangement the QuickTeam rail already draws for a
 * branded workspace, so the same corner of two products is not laid out two
 * ways. It read the other way round here, which put the switcher — a control
 * that changes the *organization* — on the row that named the product, one
 * line below the organization it changes.
 *
 * The numbers are QuickTeam's, to the pixel, and that is a requirement rather
 * than a coincidence: one corner in two products cannot be two corners. That
 * rail derives its split from the ink too — it simply measured this pair
 * differently, 10 for the leading 12px/500 label and 17 for the 16px/700 name
 * under it, which gives `labelRow = 18 + (10 − 17) / 2` and a split of
 * 15 + 21. What stood here was a second measurement of the same two lines, and
 * two measurements of one pair are not both right; the one tuned against the
 * rendered rail is the one that stays.
 *
 * So the sizes, weights, heights and colours below are copied from
 * `qt-workspace/src/components/WorkspaceSidebar.jsx` as they are. The one thing
 * not copied is the switcher's element: there it is a `div role="button"`, here
 * a real button behind `canSwitch`. That is invisible on screen and held by a
 * test. `tests/sidebar-brand-lockup.test.mjs` recomputes the split.
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
  const nameStyle = { fontSize: 16, lineHeight: '21px', fontWeight: 700 };

  return (
    <>
      <Link href={href} className="hover:opacity-80 transition-opacity">
        <h1
          data-ui-type="branding-title"
          className="tracking-tight truncate transition-all"
          style={{
            color: theme.mutedHeader || theme.muted,
            fontSize: 12,
            height: 15,
            lineHeight: '15px',
            fontWeight: 500,
          }}
        >
          {label}
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
          className="flex w-full min-w-0 items-center gap-[4px] text-left cursor-pointer transition-colors"
          style={{ color: theme.text, height: 21 }}
        >
          <span className="min-w-0 truncate transition-all" style={nameStyle}>{name}</span>
          {unreadElsewhere > 0 && (
            <Counter variant="dot" size="sm" appearance="sidebar" />
          )}
          <ChevronsUpDown size={12} className="shrink-0" style={{ color: theme.muted }} aria-hidden />
        </button>
      ) : (
        <span
          className="flex w-full min-w-0 items-center transition-colors"
          style={{ color: theme.text, height: 21 }}
        >
          <span className="min-w-0 truncate transition-all" style={nameStyle}>{name}</span>
        </span>
      )}
    </>
  );
}

export default function WorkspaceSidebar() {
  const pathname  = usePathname();
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
  // Крапка біля проєкту гасне, коли прочитано записи за ним — відкривши ті
  // звернення або в дзвонику. Не при вході в проєкт: раніше URL проєкту гасив
  // усі його записи разом, і сповіщення про звернення, яких людина не
  // відкривала, зникали, щойно вона зайшла в сусіднє.
  const { unreadProjectIds } = useProjectUnreadIndicators(userId, activeOrgId);
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

  // ── One brand, one rail ──
  // `portalBrand` is the brand QuickTeam sends, resolved from the live
  // organization document; `orgBrand` is the same brand, or its cached copy
  // for the second before that document arrives — which is what keeps a
  // branded rail from flashing dark on a reload. There is no `clientViewer`
  // anywhere in this corner: the theme, the mark and the name were each chosen
  // by role, and the owner set a desk name in QuickTeam's qTicket integration
  // and saw it on the client's rail only. The invitation landing page paints
  // itself from the same two functions, so the front door and the rail are the
  // same shade of the same company.
  const portalBrand = useMemo(
    () => resolveOrganizationPortalBrand(activeOrg),
    [activeOrg],
  );
  const orgBrand = useCachedOrgBranding(activeOrgId, activeOrg);
  const { sidebarTheme, sidebarColor } = orgBrand || portalBrand;
  const theme = useMemo(
    () => computeSidebarTheme(organizationPortalBackground({ sidebarTheme, sidebarColor })),
    [sidebarTheme, sidebarColor],
  );

  // Кеш теми + зняття boot-стилю з layout.js, щойно тема справжня.
  useSidebarThemeBoot(theme, Boolean(activeOrg), activeOrgId);

  // Поки не приїхав документ організації — лого й назва невідомі. Замість
  // того щоб на мить показати биту картинку чи чужу назву, показуємо скелетон;
  // знак рендериться лише коли готово.
  const brandingReady = Boolean(activeOrg);

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
    { href: '/clients',    icon: Folder,          label: 'Проєкти' },
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
  // A client's projects, and there may be more than one.
  //
  // One is the ordinary case and keeps the rail it had: «Мої звернення»
  // pointing straight at that project, which is a real address — the same
  // `[projectId]` screen support opens. Several, and a single entry cannot
  // name them, so the entry becomes «Проєкти» and the rail lists them below the
  // divider exactly as it lists a support seat's projects. Nothing about that
  // group is client-specific; it is the same block, drawn for a shorter list.
  const clientProjects = useMemo(
    () => (projects || []).filter(project => project.status !== 'archived'),
    [projects],
  );
  const clientSpaceHref = clientProjects.length === 1 ? `/${clientProjects[0].id}` : '/';
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
        ...(clientProjects.length === 1
          ? [{ href: clientSpaceHref, icon: TaskIcon, label: 'Мої звернення', exact: false }]
          // Several, and «Мої звернення» has no single address to point at. The
          // entry the support rail calls «Проєкти» is the one that does, and it
          // opens the same grid scoped to the projects this person holds — a
          // customer working with two suppliers' desks, or with two of one
          // supplier's spaces, was told they had access and shown one of them.
          : [{ href: '/clients', icon: Folder, label: 'Проєкти' }]),
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
                     нічого не показувати, ніж чужу назву чи бите лого ── */
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
                ) : (
                  /* The tenant's mark, drawn once for both readers. It was
                     three branches — the client's `OrganizationMark` in a bare
                     anchor, a raw `<img>` for staff of a tenant with a logo,
                     and qTicket's own glyph for staff of one without — and the
                     fork is where the corner came apart: the client read the
                     desk name QuickTeam sends and staff the organization's own,
                     so the owner set a desk name and saw it on the client's
                     rail only.
                     The link is a 32px block on purpose. The mark is an
                     inline-flex span, and a blockified anchor holding one grows
                     a line box with the strut's descent under it: measured, the
                     client's anchor was 38px tall against the staff link's 32,
                     so the logo sat 2px higher, the two lines 1px lower, and
                     everything under the header 2px down. A 32px block puts
                     the mark and the words on one axis, as in QuickTeam's rail.
                     A tenant without a logo shows its initial to staff as it
                     already did to clients — one corner, not two — and the
                     product no longer marks itself here: a white-label rail
                     that names its vendor in the corner is not white-label.
                     The card that flipped on hover to show the qTicket logo on
                     its back went earlier, for the same reason. */
                  <Link
                    href={homeHref}
                    className="block h-[32px] w-[32px] shrink-0 transition-opacity hover:opacity-80"
                    title="На головну"
                    aria-label="На головну"
                  >
                    <OrganizationMark
                      name={portalBrand.name}
                      logo={portalBrand.logo}
                      size="sm"
                      appearance="sidebar"
                    />
                  </Link>
                )}
                {brandingReady && (
                  <div className="flex flex-col min-w-0 ml-[12px]">
                    {/* One pair of words and one name for both readers,
                        because both are in the same place: the small line
                        says what this is and the big line under it names
                        whose it is. The name is the desk's — `portalBranding`,
                        the one the owner sets in QuickTeam's qTicket
                        integration, and the organization's own name only where
                        no desk name was set. Staff read `activeOrg.name` here
                        until 2026-09-02 while a client read the desk name, so
                        the owner who set one saw it on the client's rail alone.
                        The staff line used to say «qTicket» instead, which
                        named the software rather than the place and put the
                        vendor's name over an organization that white-labels the
                        whole rail below it. */}
                    <SidebarBrandLockup
                      href={homeHref}
                      name={portalBrand.name}
                      label="Портал підтримки"
                      switchLabel="Змінити організацію"
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

      {clientViewer && clientProjects.length < 2 ? (
        // One project needs no list: «Мої звернення» in the navigation above
        // already points at it, so a divider and a single row below it would
        // be the same address drawn twice.
        <div className="flex-1" />
      ) : (
        <>
      <div className="mx-[12px] mt-[16px] mb-[16px]" style={{ borderTop: '1px solid var(--sb-border)' }} />

      {/* Client workspaces are internal support navigation.

          Без заголовка «ПРОЄКТИ» і без «+», як у QuickTeam: список папок під
          розділювачем — це і є проєкти, підпис до нього нічого не додавав, а
          новий проєкт створюють із «Проєктів», де для цього стоїть підписана
          кнопка. Дві половини одного продукту не малюють один і той самий рейл
          двома способами. */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
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
