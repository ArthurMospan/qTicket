'use client';
// src/app/workspace/layout.js — Sidebar full-height, header only over main content
import { Suspense, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import WorkspaceHeader  from '@/components/WorkspaceHeader';
import MobileNav from '@/components/MobileNav';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useKeyboardOpen } from '@/lib/hooks/useKeyboardOpen';
import { useComposerFocus } from '@/lib/hooks/useComposerFocus';
import WorkspaceToastHost from '@/components/WorkspaceToastHost';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import ProfileModal from '@/components/profile/ProfileModal';
import WorkspaceQuickViewHost from '@/components/WorkspaceQuickViewHost';
import { useState } from 'react';
import WorkspaceNotificationBridge from '@/components/WorkspaceNotificationBridge';
import IssueReadStateBridge from '@/components/IssueReadStateBridge';
import WorkspaceDocumentTitle from '@/components/WorkspaceDocumentTitle';
import WorkspaceCommandPalette from '@/components/WorkspaceCommandPalette';
import { ConnectionBanner } from '@/components/ui';
import { useOnlineStatus } from '@/lib/hooks/useOnlineStatus';
import { useRecordAccountSession } from '@/lib/hooks/useAccountSessions';
import WorkspaceOrganizationRouteGuard from '@/components/WorkspaceOrganizationRouteGuard';
import Button from '@/components/ui/Button';
import { CloudOff, DatabaseZap, LockKeyhole } from 'lucide-react';
import { organizationLoadErrorKind } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaExceededError } from '@/lib/utils/errors';
import { isQuotaRefused, QUOTA_FAILURE_COPY } from '@/lib/utils/quotaState.mjs';
import { isClientRole } from '@/lib/utils/can';
import { isClientPortalRoute } from '@/lib/utils/clientPortalRoutes.mjs';
import { PRODUCT_NAME } from '@/lib/content/product.mjs';

// A spinner is a promise that something is coming. When nothing is, it is the
// worst screen the product has: it asks the reader to keep waiting and never
// tells them to stop. The workspace showed one for as long as `orgLoading` was
// true, and `orgLoading` stays true through every path that waits for a read it
// is not going to get — most often a Firestore refusal on the Firebase
// project's daily quota, which is a condition with a known cause and a known end.
//
// Twelve seconds is well past a slow phone on a slow network and well short of
// giving up on one. After that the screen says what it knows instead of
// spinning: the reader can retry, and if the quota is what refused the read,
// they are told so rather than left guessing.
const LOAD_STALL_MS = 12_000;

function useLoadStalled(loading) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!loading) {
      // The same deferral the org-selection effect below uses: a synchronous
      // setState in an effect body cascades a second render before paint.
      queueMicrotask(() => setStalled(false));
      return undefined;
    }
    const timer = window.setTimeout(() => setStalled(true), LOAD_STALL_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);
  return stalled;
}

/**
 * One card for every way the workspace can fail to open, so the three of them
 * cannot drift apart in what they claim. `error` decides which sentence it is.
 */
/**
 * The error `WorkspaceLoadFailure` is handed when there is no organization to
 * load at all — an account with no verified membership: a client taken off
 * their last project, an address that was never invited, a staff account that
 * did not arrive through QuickTeam. It reads as the same closed door as a
 * membership that was refused, because to the person in front of it that is
 * what it is. It used to be a screen of its own, with a paragraph explaining
 * how tenants are provisioned to somebody who had just lost access to one.
 */
const NO_ORGANIZATION_ACCESS = Object.freeze({ code: 'permission-denied', message: 'no organization' });

function WorkspaceLoadFailure({ error, email, onRetry, onSignOut }) {
  const kind = organizationLoadErrorKind(error);
  const accessFailure = kind === 'permission-denied' || kind === 'not-found';
  const quotaSpent = isQuotaExceededError(error) || (!accessFailure && isQuotaRefused());
  // The stall timer above renders this card with nothing to show for it: no
  // read was refused, the boot simply never finished. That is a different
  // sentence from a read that came back «no», and it used to borrow that one —
  // so a page that never got as far as asking about an organization announced
  // that it had failed to read one.
  const stalled = !error;

  // Whose outage this is. qTicket is opened from QuickTeam and its staff arrive
  // through it, but a customer signing in to a support desk has never heard of
  // QuickTeam, and this card is the one screen they are most likely to meet on
  // a bad day. It names the product they came to.
  const title = quotaSpent
    ? QUOTA_FAILURE_COPY.title
    : kind === 'permission-denied'
      ? 'Немає доступу до організації'
      : kind === 'not-found'
        ? 'Організацію не знайдено'
        : stalled
          ? `Не вдалося відкрити ${PRODUCT_NAME}`
          : `${PRODUCT_NAME} тимчасово недоступний`;

  // Google, GitHub and OneB are three separate accounts unless they have been
  // linked in settings, so «no access» is far more often «signed in as somebody
  // else» than «removed from the team». The sentence says so, because the
  // reader is the only one who knows which button they pressed.
  const description = quotaSpent
    ? QUOTA_FAILURE_COPY.description
    : kind === 'permission-denied'
      ? (email
        ? `Для акаунта ${email} доступу не знайдено. Якщо ви входили іншим способом — Google, GitHub чи OneB — це інший акаунт.`
        : 'Ваш обліковий запис не має доступу до цієї організації. Якщо ви входили іншим способом — Google, GitHub чи OneB — це інший акаунт, і дані організації на місці.')
      : kind === 'not-found'
        ? 'Організацію видалено або посилання застаріло.'
        : stalled
          ? 'Завантаження не завершилося. Перезавантажте сторінку — ваші дані на місці.'
          : 'Не вдалося прочитати дані організації. Ваші дані не видалені.';

  // The workspace's own shape, not a card floating on grey. Every other screen
  // in the product is a white pane inset from a grey shell, and this one dropped
  // both — so the day the free tier's read budget ran out, the product answered
  // with a sentence on a background nothing else in it uses, and the answer read
  // like a crash rather than like a condition. Same pane, same corners, same
  // gutter; the message stands in the middle of it, which is where an empty
  // state stands everywhere else.
  const Glyph = quotaSpent ? DatabaseZap : accessFailure ? LockKeyhole : CloudOff;
  return (
    <div className="w-full h-full bg-white p-0 md:bg-canvas md:p-[12px]">
      {/* The shell's own pane, class for class — the grey outside it and the
          white inside it are the two surfaces this product has, and a failure
          is not a third one. */}
      <div className="flex flex-col flex-1 h-full bg-white rounded-none md:rounded-[24px] overflow-hidden">
        <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
        <span className="mb-5 flex h-[56px] w-[56px] items-center justify-center rounded-full bg-canvas text-muted">
          <Glyph size={24} aria-hidden />
        </span>
        <h1 className="ui-type-section-title text-ink mb-2">{title}</h1>
        <p className="max-w-[420px] text-[13px] leading-relaxed text-muted mb-6">{description}</p>
        {/* Nobody is left on a dead end. The access card used to carry no
            action at all, so a person who had simply signed in with the wrong
            button had a sentence, a white box and no way out of it. */}
        {accessFailure && !quotaSpent ? (
          <Button onClick={onSignOut} size="lg" composition="workspace-guard">
            Увійти іншим акаунтом
          </Button>
        ) : (
          <Button onClick={onRetry} size="lg" composition="workspace-guard">
            {quotaSpent ? QUOTA_FAILURE_COPY.action : 'Спробувати ще раз'}
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceLayout({ children }) {
  const router = useRouter();
  const { currentUser, authLoading, activeOrgId, orgLoading, orgError, orgRole, noOrg, signOut, allOrgs, projects, projectsLoading } = useAppContext();
  const [needsOrgSelection, setNeedsOrgSelection] = useState(false);
  // null on first render, then the matching nav is mounted. This prevents the
  // hidden nav variant from briefly opening its own Firestore subscriptions.
  const isMobile = useIsMobile();
  // Watched here rather than inside the tab bar, because the bar is the one
  // thing on a phone that is sometimes not mounted: a task and an event do
  // without it, and those are the two screens with the most typing on them.
  // What the observation publishes — how much of the viewport the keyboard is
  // covering — is what keeps a composer above the keys, and it cannot be tied
  // to whether there is a bar.
  const keyboardOpen = useKeyboardOpen();
  const online = useOnlineStatus();
  // «Безпека» in settings can only list the devices somebody signed in on if
  // something records them, and the panel is the last place that should be
  // doing the recording — a device nobody opened settings from is exactly the
  // one worth seeing there.
  useRecordAccountSession(currentUser?.id || currentUser?.uid || null);
  const loadStalled = useLoadStalled(authLoading || orgLoading);
  const retryLoad = () => window.location.reload();
  const signOutAndReturn = async () => { await signOut(); router.replace('/login'); };

  const pathname = usePathname();
  // And the signal the keyboard measurement is a proxy for. A caret in a
  // composer is somebody writing, which is true before the keys arrive, stays
  // true when they are dismissed with the field still focused, and is true on a
  // tablet or an external keyboard where no overlap is ever measured. It sits
  // here rather than beside `useKeyboardOpen` only because it needs `pathname`,
  // and still above every early return, so hook order is stable.
  const composerFocused = useComposerFocus(pathname);
  // The spaces this person actually holds — the boundary needs the ids, not the
  // shape of the address. While they are still loading nothing is denied yet:
  // deciding on an empty list would bounce a client off their own space every
  // time the page is refreshed.
  const clientProjectIds = useMemo(
    () => (projects || []).map(project => project.id).filter(Boolean),
    [projects],
  );
  const clientRouteDenied = isClientRole(orgRole)
    && !projectsLoading
    && !isClientPortalRoute(pathname, clientProjectIds, orgRole);
  const isSettings = pathname?.startsWith('/settings');
  const hideHeader = isSettings;

  // An incident is the screen you open *into* rather than navigate between: it
  // carries its own breadcrumb back to the client, it has its own tabs, and on
  // a phone its conversation is a place people sit and type. The tab bar there costs
  // 78px of a 660px screen for a destination nobody is heading to
  // mid-conversation, so it does without one. Every other screen keeps it.
  //
  // The calendar event page used to be the second such screen. It is gone with
  // the rest of the planning calendar, and a rule for a route that no longer
  // resolves is a rule nobody can read the truth of.
  const isFocusedRoute = Boolean(pathname) && /^\/[^/]+\/issue\/[^/]+/.test(pathname);

  // Published on <body> so the CSS that reserves room for the bar can stop
  // reserving it, the same way the on-screen keyboard already does.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.body.dataset.mobileNav = isFocusedRoute ? 'hidden' : 'shown';
    return () => { delete document.body.dataset.mobileNav; };
  }, [isFocusedRoute]);

  useEffect(() => {
    if (!authLoading && !currentUser) {
      const currentLocation = `${window.location.pathname}${window.location.search}`;
      const returnTo = currentLocation.startsWith('/') ? currentLocation : '/';
      router.replace(`/login?next=${encodeURIComponent(returnTo)}`);
    }
  }, [currentUser, authLoading, pathname, router]);

  // A client role owns a portal session, not a reduced staff workspace. Menu
  // visibility is not an access boundary: a pasted `/overview`, `/my`, `/team`
  // or project-board URL must be canonicalized before that screen can paint.
  // Incident detail stays reachable because the client portal links to it and
  // the page/server still enforce the exact project scope.
  useEffect(() => {
    if (authLoading || orgLoading || !currentUser || !activeOrgId || !clientRouteDenied) return;
    router.replace(`/?org=${encodeURIComponent(activeOrgId)}`);
  }, [activeOrgId, authLoading, clientRouteDenied, currentUser, orgLoading, router]);

  // 4. Intercept for full-screen Org Selector
  useEffect(() => {
    if (authLoading || orgLoading || !currentUser || noOrg) return;

    if (allOrgs?.length > 1) {
      const justLoggedIn = sessionStorage.getItem('just_logged_in') === 'true';
      const hasRequestedOrg = new URLSearchParams(window.location.search).has('org');
      queueMicrotask(() => setNeedsOrgSelection(justLoggedIn && !hasRequestedOrg));
    } else {
      queueMicrotask(() => setNeedsOrgSelection(false));
    }
  }, [authLoading, orgLoading, currentUser, noOrg, allOrgs]);

  // 1. Auth loading — but not for ever. A read that is never going to arrive
  //    used to hold this spinner until the reader gave up on the product.
  if (authLoading || orgLoading) {
    if (loadStalled) {
      return <WorkspaceLoadFailure error={orgError} onRetry={retryLoad} onSignOut={signOutAndReturn} />;
    }
    return (
      <div className="w-full h-full flex items-center justify-center bg-canvas">
        <div className="w-8 h-8 border-[3px] border-line border-t-ink rounded-full animate-spin" />
      </div>
    );
  }

  // 2. Not authenticated
  if (!currentUser) return null;

  if (orgError) {
    return <WorkspaceLoadFailure error={orgError} onRetry={retryLoad} onSignOut={signOutAndReturn} />;
  }

  // An authenticated account without a verified membership is not a new
  // tenant. It is either an uninvited client, a client taken off their last
  // project, or a staff account that did not arrive through QuickTeam, so the
  // only safe result is a closed door — the same closed door as a refused
  // membership, not a screen of its own.
  if (noOrg) {
    return (
      <WorkspaceLoadFailure
        error={NO_ORGANIZATION_ACCESS}
        email={currentUser.email}
        onRetry={retryLoad}
        onSignOut={signOutAndReturn}
      />
    );
  }

  if (clientRouteDenied) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-canvas" role="status" aria-label="Повертаємо до порталу підтримки">
        <div className="w-8 h-8 border-[3px] border-line border-t-ink rounded-full animate-spin" />
      </div>
    );
  }


  // 4. Defensive fallback: the 'client' role is no longer assignable inside the
  //    team workspace (owner/admin/member only), but keep this guard so any legacy
  //    membership that still carries it lands on the client portal instead of here.
  const isClientOnly = orgRole === 'client';
  if (isClientOnly) {
    const portalUrl = process.env.NEXT_PUBLIC_PORTAL_URL;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-canvas p-8 text-center">
        <div className="w-[64px] h-[64px] bg-danger-soft text-danger rounded-full flex items-center justify-center mb-6">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </div>
        <h1 className="ui-type-page-title text-ink mb-2">Доступ заборонено</h1>
        <p className="text-[14px] text-muted max-w-[320px] mb-8">
          Ви намагаєтесь увійти у внутрішній простір команди. Щоб працювати зі своїми зверненнями, перейдіть на клієнтський портал.
        </p>
        {portalUrl ? (
          <a href={portalUrl}
             className="bg-ink text-white px-6 py-3 rounded-[12px] font-bold text-[14px] hover:bg-ink-hover transition-colors">
            Перейти на клієнтський портал
          </a>
        ) : (
          <p className="text-[13px] text-danger">URL клієнтського порталу не налаштовано. Зверніться до адміністратора.</p>
        )}
      </div>
    );
  }

  // 5. Needs org selection (Full screen Windows style login)
  if (needsOrgSelection) {
    return (
      <>
        <WorkspaceNotificationBridge />
        <IssueReadStateBridge />
        <WorkspaceDocumentTitle />
        <OrgSwitcherScreen />
      </>
    ); // No onClose provided, meaning they must select an existing organization.
  }

  return (
    <ConfirmProvider key={activeOrgId}>
    <WorkspaceNotificationBridge />
    <IssueReadStateBridge />
    <WorkspaceDocumentTitle />
    <Suspense fallback={<div className="w-full h-full bg-canvas" />}>
    <WorkspaceOrganizationRouteGuard>
    {/* The grey is the gutter *between* the floating panels, and on a phone
        there are no floating panels: the content fills the width edge to edge.
        Below md the shell is the same white as the pane, so the bar floats over
        the page instead of over a wall of its own. And the shell reserves
        nothing for the keyboard: it used to carry the overlap as `padding-bottom`
        a frame after WebKit had already panned the window down by that same
        overlap, which put the field you had just tapped above the top edge and
        left the vacated padding as the strip a drag finds. See useKeyboardOpen. */}
    <div className="w-full h-full flex overflow-hidden bg-white md:bg-canvas">
      {/* The first stop for Tab, invisible until it is focused. */}
      <a href="#qt-main" className="qt-skip-link rounded-[10px] bg-ink px-[14px] py-[8px] text-[13px] font-bold text-white">
        Перейти до вмісту
      </a>
      <ConnectionBanner offline={!online} />
      {/* Sidebar — full height, floating panel (desktop only; mobile uses MobileNav) */}
      {isMobile === false && (
        <div className="print:hidden shrink-0 h-full hidden md:flex p-[12px] pr-[6px]">
          <div className="h-full rounded-[24px] overflow-hidden flex">
            <WorkspaceSidebar />
          </div>
        </div>
      )}

      {/* Right column: absolute header + content floating panel */}
      {/* The column reserves nothing for the bottom bar. It used to reserve the
          bar's whole footprint, and below md that strip was shell — white,
          untouchable, and visibly not part of the page, so every screen ended
          in a dead band instead of ending under the navigation. The page runs
          the full height now; the room the last row needs is added by the
          screen's own scroller (`.qt-nav-scroll`), which is the only element
          that knows where its content actually ends. */}
      <div className="flex flex-col flex-1 overflow-hidden w-full p-0 md:p-[12px] md:pl-[6px] md:pb-[12px]">
        {/* Nothing between the shell and the content panel. Any shell strip
            here shortens every screen below it, including screens that size
            themselves from the window rather than their own column. */}
        <div className="flex flex-col flex-1 bg-white rounded-none md:rounded-[24px] overflow-hidden relative">
          {!hideHeader && (
            <div className="print:hidden absolute top-0 left-0 right-0 z-30">
              <WorkspaceHeader />
            </div>
          )}
          <main id="qt-main" tabIndex={-1} className="flex-1 flex flex-col overflow-hidden print:overflow-visible bg-transparent">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom navigation */}
      {isMobile === true && !isFocusedRoute && (
        <div className="print:hidden md:hidden">
          <MobileNav keyboardOpen={keyboardOpen} composerFocused={composerFocused} />
        </div>
      )}

      <WorkspaceToastHost />
      <ProfileModal />
      <WorkspaceQuickViewHost />
      <WorkspaceCommandPalette />
    </div>
    </WorkspaceOrganizationRouteGuard>
    </Suspense>
    </ConfirmProvider>
  );
}
