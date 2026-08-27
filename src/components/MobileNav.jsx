'use client';
// src/components/MobileNav.jsx — mobile bottom tab bar + «Ще» sheet
// Renders only below md (the wrapper in workspace/layout.js is md:hidden).
// Primary destinations live in the bar; everything else from the desktop
// sidebar (команда, налаштування, список клієнтів, таймер) —
// у висувній шторці «Ще».
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { Button, Counter, IconAction } from '@/components/ui';
import { can, isClientRole } from '@/lib/utils/can';
import {
  Folder, PieChart, Menu, X,
  Users, Settings, Plus, Clock, Square as StopIcon, ChevronsUpDown, CircleHelp,
} from 'lucide-react';
import { TaskIcon } from '@/lib/design/icons';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import { useWorkspaceHelp } from '@/components/WorkspaceHelpMenu';
import WorkspacePlanLimitRail from '@/components/WorkspacePlanLimitRail';
import { computeSidebarTheme, computeTranslucentSidebarTheme, SIDEBAR_PRESETS } from '@/lib/utils/sidebarTheme';
import { useCachedOrgBranding, useSidebarThemeBoot } from '@/lib/hooks/useCachedOrgBranding';
import { timerTargetHref } from '@/lib/utils/timerNavigation.mjs';
import { useModalFocus } from '@/lib/hooks/useModalFocus';

// The bar is glass: the organization's colour at this much opacity over a blur
// of whatever is scrolling underneath. It is a request rather than a setting —
// `computeTranslucentSidebarTheme` hands back the opacity the brand colour can
// actually afford while its labels still clear AA, and that is the number the
// bar is painted with.
const NAV_OPACITY = 0.88;

const TABS = [
  { href: '/',           icon: Folder,        label: 'Клієнти', exact: true },
  { href: '/my',        icon: TaskIcon,      label: 'Мої інциденти' },
  { href: '/analytics', icon: PieChart,      label: 'Аналітика' },
];

const MORE_NAV = [
  { href: '/team',     icon: Users,    label: 'Команда' },
  { href: '/settings', icon: Settings, label: 'Налаштування' },
];

// Separate component so the store's 1-second timerElapsed tick re-renders
// only this capsule (rendered only inside the open sheet), not the whole nav.
function SheetTimerCapsule({ onNavigate, onStop }) {
  const activeTimer = useWorkspaceStore(s => s.activeTimer);
  const timerElapsed = useWorkspaceStore(s => s.timerElapsed);
  const formatElapsed = useWorkspaceStore(s => s.formatElapsed);
  if (!activeTimer) return null;
  return (
    <div className="px-[16px] pb-[8px]">
      <div
        onClick={() => onNavigate(activeTimer)}
        // The strip carries the stop button, so it is not a `<button>` itself.
        role="button"
        tabIndex={0}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onNavigate(activeTimer);
        }}
        // The bar paints itself from the sidebar's own tokens, so a brand
        // colour reaches the sheet too. `#333333` was a dark grey chosen when
        // the only rail was the dark one, and on a light brand it was a black
        // slab with white text sitting in a white sheet.
        className="bg-[var(--sb-active)] rounded-[12px] flex items-center justify-between pl-[12px] pr-[6px] py-[6px] cursor-pointer">
        <div className="flex items-center gap-[8px]">
          <Clock size={14} className="animate-pulse text-[var(--sb-text)]" />
          <span className="text-[var(--sb-text)] text-[13px] font-mono font-medium">{formatElapsed(timerElapsed)}</span>
        </div>
        <IconAction
          label="Зупинити та зберегти"
          icon={StopIcon}
          size="compact"
          appearance="danger"
          shape="compact"
          onClick={onStop}
        />
      </div>
    </div>
  );
}

/**
 * @param {boolean} props.keyboardOpen The on-screen keyboard is covering part of
 *   the viewport, so there is neither room for a tab bar nor a reason for one —
 *   the reader is typing, not navigating. Measured by the workspace layout,
 *   which watches for it on every route, including the two that render no bar.
 */
export default function MobileNav({ keyboardOpen = false }) {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, activeOrg, activeOrgId, orgRole } = useAppContext();
  const clientViewer = isClientRole(orgRole);
  const visibleTabs = clientViewer
    ? [{ href: '/', icon: Folder, label: 'Інциденти', exact: true }]
    : TABS;
  const visibleMoreNav = clientViewer
    ? [{ href: '/settings', icon: Settings, label: 'Налаштування' }]
    : MORE_NAV;
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false);
  const moreDialogRef = useModalFocus({ isOpen: moreOpen, onClose: () => setMoreOpen(false) });
  // Довідка, підтримка, новини та правові документи — той самий список, що
  // висить на кебабі бічної рейки. Його діалоги живуть поза шторкою: шторка
  // закривається від дотику, а діалог має лишитися на екрані.
  const { items: helpItems, overlays: helpOverlays } = useWorkspaceHelp();

  const activeTimer = useWorkspaceStore(s => s.activeTimer);
  const stopTimer = useWorkspaceStore(s => s.stopTimer);
  const showToast = useWorkspaceStore(s => s.showToast);
  const unreadByOrganization = useWorkspaceStore(s => s.notificationUnreadByOrg);
  const otherOrgUnreadCount = Object.entries(unreadByOrganization).reduce(
    (total, [organizationId, count]) => organizationId === activeOrgId ? total : total + count,
    0,
  );

  // Close the sheet on navigation
  const sidebarPreview = useWorkspaceStore(s => s.sidebarPreview);
  // Кеш брендингу — без мигання стандартної теми, поки org завантажується.
  const orgBrand = useCachedOrgBranding(activeOrgId, activeOrg);
  const isBranded = sidebarPreview
    ? Boolean(sidebarPreview.customBranding && sidebarPreview.logo)
    : Boolean(orgBrand?.customBranding && orgBrand?.logo);

  const theme = useMemo(() => {
    const source = sidebarPreview || (isBranded ? {
      theme: orgBrand?.sidebarTheme || 'dark',
      color: orgBrand?.sidebarColor || SIDEBAR_PRESETS.dark,
    } : null);

    if (!source) return computeSidebarTheme(SIDEBAR_PRESETS.dark);

    const bgColor = source.theme === 'light' ? SIDEBAR_PRESETS.light
      : source.theme === 'custom' ? (source.color || SIDEBAR_PRESETS.dark)
      : SIDEBAR_PRESETS.dark;

    return computeSidebarTheme(bgColor);
  }, [isBranded, orgBrand?.sidebarTheme, orgBrand?.sidebarColor, sidebarPreview]);

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


  const isActive = (href, exact) => (exact ? pathname === href : pathname.startsWith(href));
  // «Ще» is highlighted when the current page lives in the sheet
  const moreActive = visibleMoreNav.some(i => isActive(i.href));

  const handleStopTimer = async e => {
    e.stopPropagation();
    // The minutes ride in the store, not in the URL — see `stopTimer`.
    try {
      const result = await stopTimer();
      if (result?.queued) showToast('Зупинку таймера збережено до відновлення мережі', 'warning');
      setMoreOpen(false);
      const targetHref = timerTargetHref(result);
      if (targetHref) router.push(targetHref);
    } catch (error) {
      showToast(error.message || 'Не вдалося зупинити таймер', 'error');
    }
  };

  const handleTimerNavigate = (timer) => {
    setMoreOpen(false);
    const targetHref = timerTargetHref(timer);
    if (targetHref) router.push(targetHref);
  };

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
        {visibleTabs.map(({ href, icon: Icon, label, exact }) => {
          const active = isActive(href, exact);
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
          {!clientViewer && activeTimer && (
            <span className="absolute top-[8px] left-[calc(50%+6px)] w-[8px] h-[8px] bg-danger-solid rounded-full animate-pulse" />
          )}
          {otherOrgUnreadCount > 0 && !activeTimer && (
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
                <button
                  onClick={() => setShowOrgSwitcher(true)}
                  className="flex items-center gap-[6px] text-[var(--sb-text)] min-w-0">
                  <span className="text-[15px] font-bold truncate">{activeOrg?.name || 'qTicket'}</span>
                  {otherOrgUnreadCount > 0 && (
                    <Counter variant="dot" size="sm" appearance="sidebar" />
                  )}
                  <ChevronsUpDown size={14} className="shrink-0 text-[var(--sb-muted)]" />
                </button>
                <IconAction label="Закрити" icon={X} size="sm" appearance="quiet" onClick={() => setMoreOpen(false)} className="-mr-[6px]" />
              </div>
            </div>

            {/* Active timer capsule (subscribes to the 1s tick internally) */}
            {!clientViewer && (
              <SheetTimerCapsule onNavigate={handleTimerNavigate} onStop={handleStopTimer} />
            )}

            {/* The rail's ceiling notice, in the drawer that stands in for the
                rail on a phone. The sheet already carries every `--sb-*` the
                row mixes its colours from, so it is the same component with
                nothing said twice. */}
            {!clientViewer && <WorkspacePlanLimitRail />}

            {/* Secondary nav */}
            <div className="flex flex-col gap-[2px] px-[8px]">
              {visibleMoreNav.map(({ href, icon: Icon, label }) => {
                const active = isActive(href);
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

            <div className="mx-[16px] border-t border-white/[0.08] my-[10px]" />

            {/* Client projects */}
            <div className="flex items-center justify-between px-[20px] pb-[8px]">
              <p className="text-[11px] font-bold text-[var(--sb-muted)] uppercase tracking-wider">
                {clientViewer ? 'Простір підтримки' : 'Клієнти'}
              </p>
              {can(orgRole, 'create:project') && (
                <IconAction
                  label="Новий клієнт"
                  icon={Plus}
                  size="sm"
                  appearance="quiet"
                  onClick={() => { setMoreOpen(false); router.push('/?new=1'); }}
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
