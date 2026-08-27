'use client';
// src/app/workspace/layout.js — Sidebar full-height, header only over main content
import { Suspense, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import WorkspaceSidebar from '@/components/WorkspaceSidebar';
import WorkspaceHeader  from '@/components/WorkspaceHeader';
import MobileNav from '@/components/MobileNav';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import { useKeyboardOpen } from '@/lib/hooks/useKeyboardOpen';
import WorkspaceToastHost from '@/components/WorkspaceToastHost';
import { ConfirmProvider } from '@/components/ui/ConfirmProvider';
import OrgSwitcherScreen from '@/components/OrgSwitcherScreen';
import ProfileModal from '@/components/profile/ProfileModal';
import WorkspaceQuickViewHost from '@/components/WorkspaceQuickViewHost';
import WorkspacePlanUpgradeHost from '@/components/WorkspacePlanUpgradeHost';
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

// A spinner is a promise that something is coming. When nothing is, it is the
// worst screen the product has: it asks the reader to keep waiting and never
// tells them to stop. The workspace showed one for as long as `orgLoading` was
// true, and `orgLoading` stays true through every path that waits for a read it
// is not going to get — most often a Firestore refusal on the free plan's daily
// quota, which is a condition with a known cause and a known end.
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
function WorkspaceLoadFailure({ error, onRetry, onSignOut }) {
  const kind = organizationLoadErrorKind(error);
  const accessFailure = kind === 'permission-denied' || kind === 'not-found';
  const quotaSpent = isQuotaExceededError(error) || (!accessFailure && isQuotaRefused());

  const title = quotaSpent
    ? QUOTA_FAILURE_COPY.title
    : kind === 'permission-denied'
      ? 'Немає доступу до організації'
      : kind === 'not-found'
        ? 'Організацію не знайдено'
        : 'QuickTeam тимчасово недоступний';

  // Google, GitHub and OneB are three separate accounts unless they have been
  // linked in settings, so «no access» is far more often «signed in as somebody
  // else» than «removed from the team». The sentence says so, because the
  // reader is the only one who knows which button they pressed.
  const description = quotaSpent
    ? QUOTA_FAILURE_COPY.description
    : kind === 'permission-denied'
      ? 'Ваш обліковий запис не має доступу до цієї організації. Якщо ви входили іншим способом — Google, GitHub чи OneB — це інший акаунт, і дані організації на місці.'
      : kind === 'not-found'
        ? 'Організацію видалено або посилання застаріло.'
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
  const { currentUser, authLoading, activeOrgId, activeOrg, orgLoading, orgError, orgRole, noOrg, signOut, allOrgs, invitationChecked } = useAppContext();
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
  const isChat = pathname?.startsWith('/chat');
  const isSettings = pathname?.startsWith('/settings');
  const hideHeader = isSettings;

  // A task and an event are the two screens you open *into* rather than
  // navigate between: they carry their own breadcrumb back to the project, they
  // have their own tabs, and on a phone a task's chat is a place people sit and
  // type. The tab bar there costs 78px of a 660px screen for a destination
  // nobody is heading to mid-conversation, so those two do without it. Every
  // other screen keeps it.
  const isFocusedRoute = Boolean(pathname) && (
    /^\/[^/]+\/issue\/[^/]+/.test(pathname) || pathname.startsWith('/calendar/event/')
  );

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

  // Onboarding redirect: if owner/admin and org not yet onboarded
  useEffect(() => {
    if (authLoading || orgLoading) return;
    if (!currentUser) return;
    if (!activeOrg) return;
    // A workspace whose organization document has not been read yet is present
    // because its membership is — see buildOrganizationList. It has no fields,
    // so `onboarded` reads as missing, and sending its owner off to «створіть
    // організацію» over a read that has not finished is exactly the kind of
    // thing that must not follow from a slow network.
    if (activeOrg.pending) return;
    const requestedOrgId = new URLSearchParams(window.location.search).get('org');
    if (requestedOrgId && requestedOrgId !== activeOrgId) return;
    const isOwnerOrAdmin = orgRole === 'owner' || orgRole === 'admin';
    if (isOwnerOrAdmin && activeOrg.onboarded !== true) {
      router.replace('/onboarding');
    }
  }, [activeOrgId, authLoading, orgLoading, currentUser, activeOrg, orgRole, router]);

  // 3. Authenticated but not in any org → onboarding. Gated on invitationChecked
  //    so a freshly-invited user isn't bounced to "create an org" while their
  //    membership is still being created by the invite-acceptance call.
  useEffect(() => {
    if (noOrg && !orgLoading && !authLoading && invitationChecked) {
      router.replace('/onboarding');
    }
  }, [noOrg, orgLoading, authLoading, invitationChecked, router]);

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

  // 3. Authenticated but not in any org → redirect immediately to onboarding
  if (noOrg) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-canvas">
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
          Ви намагаєтесь увійти у внутрішній простір команди. Щоб керувати своїми проєктами, перейдіть на клієнтський портал.
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
    ); // No onClose provided, meaning they MUST select an org or create one
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
        the page instead of over a wall of its own. */}
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
        {/* Nothing between the shell and the content panel. A strip used to
            hang here saying which ceiling of the plan had filled up, and every
            screen under it was that much shorter for as long as it was there —
            including the two that size themselves from the window rather than
            from their own column. That notice lives at the foot of the sidebar
            now, where the workspace already talks about itself. */}
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
          <MobileNav keyboardOpen={keyboardOpen} />
        </div>
      )}

      <WorkspaceToastHost />
      <ProfileModal />
      <WorkspaceQuickViewHost />
      <WorkspacePlanUpgradeHost />
      <WorkspaceCommandPalette />
    </div>
    </WorkspaceOrganizationRouteGuard>
    </Suspense>
    </ConfirmProvider>
  );
}
