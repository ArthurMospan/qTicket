'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { useAppContext } from '@/lib/context/AppContext';
import { acceptInviteLink, readInviteLinkPreview } from '@/lib/services/inviteLinks';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { organizationPortalBackground } from '@/lib/utils/organizationBranding.mjs';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';
import { computeSidebarTheme } from '@/lib/utils/sidebarTheme';

// Whoever opens this link is on their way into their supplier's support portal,
// and that is what the screen has to look like from the first frame. The token
// buys one narrow public read — organization name, logo, colour, client space
// and the role on offer — so the brand is on screen *before* sign-in rather
// than appearing once the account is created and it is too late to matter.
//
// Signing in happens here rather than at `/login`, which would drop the visitor
// on the anonymous «Портал підтримки» screen halfway through: the one thing
// this page knows is exactly the thing that screen cannot know.

// How long the «вітаємо» stays on screen before the workspace takes over.
const HANDOVER_MS = 2000;

const GITHUB_LOGIN_ENABLED = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED === 'true';
const INVALID_MESSAGE = 'Посилання недійсне або протерміноване';

// The auth shell's own control, the same white pill `/login` uses. A kit
// `Button` cannot be used here: its two colours are ink and red, and both are
// read against a light product surface — on a shell painted in an arbitrary
// organization colour, a dark button on a dark brand is a control nobody can
// see. This one stays legible on any background the tenant chooses.
const SHELL_BUTTON_CLASS = 'flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-[14px] text-[15px] font-bold text-[#1f1f1f] shadow-xl transition-all hover:bg-[#e9e9e9] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export default function InviteLandingClient() {
  const { token } = useParams();
  const router = useRouter();
  const { currentUser, authLoading, signInWithGoogle, signInWithGitHub } = useAppContext();

  const [preview, setPreview] = useState(null);
  const [phase, setPhase] = useState('loading'); // loading | ready | joining | done | error
  const [message, setMessage] = useState('');
  const [joined, setJoined] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const accepted = useRef(false);

  // The tenant's colour, resolved exactly as the workspace rail resolves it.
  const brand = useMemo(() => {
    if (!preview) return null;
    return {
      name: preview.organizationName,
      logo: preview.organizationLogo,
      theme: computeSidebarTheme(organizationPortalBackground(preview)),
    };
  }, [preview]);

  // The tab carries the tenant too. `WorkspaceDocumentTitle` owns the title
  // inside the workspace; this page is outside it, and the server metadata it
  // replaces deliberately never named the organization.
  useEffect(() => {
    if (!preview?.organizationName) return;
    document.title = `Запрошення · ${preview.organizationName}`;
  }, [preview]);

  useEffect(() => {
    let cancelled = false;
    readInviteLinkPreview(token)
      .then(result => {
        if (cancelled) return;
        setPreview(result);
        setPhase('ready');
      })
      .catch(error => {
        if (cancelled) return;
        setMessage(error.message || INVALID_MESSAGE);
        setPhase('error');
      });
    return () => { cancelled = true; };
  }, [token]);

  const enterWorkspace = useCallback(organizationId => {
    // The intent travels in the address, the way the organization switcher does
    // it: a membership created a moment ago is not in the loaded list yet, and a
    // bare `/` lets the route guard restore whichever organization was active
    // before. `?org=` is read by `WorkspaceOrganizationRouteGuard`, which waits
    // for the server directory to confirm the new membership.
    if (organizationId) {
      try {
        sessionStorage.setItem('qt_org_selected_this_session', '1');
        sessionStorage.removeItem('just_logged_in');
        sessionStorage.setItem('qt_active_org_id', organizationId);
      } catch {}
    }
    router.replace(withNotificationOrganization('/', organizationId) || '/');
  }, [router]);

  // Accept as soon as there is both a valid link and an account, and exactly
  // once: a second call would answer the same but spend a rate-limit slot.
  useEffect(() => {
    if (phase !== 'ready' || authLoading || !currentUser || accepted.current) return;
    accepted.current = true;
    setPhase('joining');
    acceptInviteLink(token)
      .then(result => {
        setJoined(result);
        setPhase('done');
        setTimeout(() => enterWorkspace(result.organizationId), HANDOVER_MS);
      })
      .catch(error => {
        setMessage(error.message || INVALID_MESSAGE);
        setPhase('error');
      });
  }, [authLoading, currentUser, enterWorkspace, phase, token]);

  const signIn = async provider => {
    try {
      setSigningIn(true);
      setMessage('');
      await (provider === 'github' ? signInWithGitHub() : signInWithGoogle());
    } catch {
      setMessage('Не вдалося увійти. Спробуйте ще раз.');
      setSigningIn(false);
    }
  };

  const roleLabel = preview ? organizationRoleLabel(preview.role) : '';
  // Unbranded — the link was not readable — the shell is qTicket's own dark
  // card, so the fallbacks below are the white it is drawn against.
  const inkColor = brand ? brand.theme.text : '#ffffff';
  const mutedColor = brand ? brand.theme.muted : 'rgba(255,255,255,0.6)';
  const ink = { color: inkColor };
  const muted = { color: mutedColor };

  const spinner = (
    <span
      role="status"
      aria-label="Завантаження"
      className="h-8 w-8 shrink-0 animate-spin rounded-full border-[3px]"
      style={{ borderColor: mutedColor, borderTopColor: inkColor }}
    />
  );

  return (
    <AuthLayout brand={brand}>
      <div className="flex w-full max-w-[380px] flex-col items-center text-center animate-in zoom-in-95 duration-500">
        {phase === 'loading' && (
          <>
            {spinner}
            <p className="mt-5 text-[13px] font-medium" style={muted}>Перевіряємо запрошення…</p>
          </>
        )}

        {(phase === 'ready' || phase === 'joining') && preview && (
          <>
            <h1 className="ui-type-display-title tracking-tight" style={ink}>
              {`Вас запрошено в «${preview.organizationName}»`}
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed" style={muted}>
              {preview.clientSpaceName
                ? <>Простір підтримки <strong style={ink}>{preview.clientSpaceName}</strong> · {roleLabel}</>
                : roleLabel}
            </p>

            {authLoading || phase === 'joining' ? (
              <div className="mt-10 flex flex-col items-center">
                {spinner}
                <p className="mt-3 text-[13px] font-medium" style={muted}>Відкриваємо доступ…</p>
              </div>
            ) : (
              <>
                <p className="mt-8 mb-5 text-[13px] leading-relaxed" style={muted}>
                  Увійдіть, щоб отримати доступ до звернень цього простору.
                </p>
                <div className="flex w-full flex-col gap-3">
                  <button
                    type="button"
                    data-ui-control="invite-shell-action"
                    onClick={() => signIn('google')}
                    disabled={signingIn}
                    className={SHELL_BUTTON_CLASS}
                  >
                    <GoogleIcon />
                    {signingIn ? 'Перенаправлення...' : 'Увійти через Google'}
                  </button>
                  {GITHUB_LOGIN_ENABLED && (
                    <button
                      type="button"
                      data-ui-control="invite-shell-action"
                      onClick={() => signIn('github')}
                      disabled={signingIn}
                      className={SHELL_BUTTON_CLASS}
                    >
                      Увійти через GitHub
                    </button>
                  )}
                </div>
                {/* The failure is written in the shell's own ink rather than in
                    a status colour: `danger` is derived to clear AA on white,
                    and this card is whatever colour the tenant chose. */}
                {message && (
                  <p
                    className="mt-5 w-full rounded-[12px] px-4 py-3 text-[13px] font-medium leading-relaxed"
                    style={{ color: inkColor, backgroundColor: brand ? brand.theme.active : 'rgba(255,255,255,0.08)' }}
                  >
                    {message}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {phase === 'done' && (
          <>
            <span className="mb-5 inline-flex items-center gap-1.5 text-[12px] font-semibold" style={ink}>
              <CheckCircle2 size={14} aria-hidden />
              {joined?.alreadyMember ? 'Ви вже маєте доступ' : 'Доступ відкрито'}
            </span>
            <h1 className="ui-type-display-title tracking-tight" style={ink}>
              {`Вітаємо в «${preview?.organizationName || ''}»`}
            </h1>
            <p className="mt-4 text-[13px] leading-relaxed" style={muted}>
              Переносимо вас до ваших звернень…
            </p>
            <button
              type="button"
              data-ui-control="invite-shell-action"
              onClick={() => enterWorkspace(joined?.organizationId)}
              className={`mt-6 ${SHELL_BUTTON_CLASS}`}
            >
              Перейти зараз
            </button>
          </>
        )}

        {phase === 'error' && (
          <>
            <XCircle className="mb-4 h-8 w-8" style={ink} aria-hidden />
            <h1 className="ui-type-section-title" style={ink}>
              Не вдалося відкрити запрошення
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed" style={muted}>
              {message || INVALID_MESSAGE}
            </p>
            <p className="mt-4 text-[12px] leading-relaxed opacity-80" style={muted}>
              Попросіть нове посилання в того, хто надіслав вам це.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
