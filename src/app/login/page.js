'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AnimatedLogo from '@/components/AnimatedLogo';
import AuthLayout from '@/components/AuthLayout';
import { useAppContext } from '@/lib/context/AppContext';
import { getSafeAuthRedirect } from '@/lib/utils/authRedirect';
import { navigateToSameOrigin } from '@/lib/utils/browserNavigation.mjs';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

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

function getRequestedDestination() {
  if (typeof window === 'undefined') return '/';
  const params = new URLSearchParams(window.location.search);
  return getSafeAuthRedirect(params.get('next') || params.get('redirect'), '/');
}

function getInitialOneBLoading() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return Boolean(params.get('code')) || params.get('oneb') === 'success';
}

function authErrorMessage(code) {
  if (code === 'oauth') return 'Не вдалося увійти через OAuth. Спробуйте ще раз.';
  if (code === 'oneb_token') return 'Помилка авторизації в OneB: перевірте Client ID, Secret і redirect URI.';
  if (code === 'oneb_no_client_id') return 'OneB Client ID не налаштований.';
  if (code === 'oneb_no_client_secret') return 'OneB Client Secret не налаштований.';
  if (code === 'oneb_already_linked') return 'Цей OneB акаунт уже підключений до іншого користувача.';
  if (code === 'oneb_session') return 'Не вдалося підтвердити поточну сесію. Увійдіть ще раз і повторіть підключення OneB.';
  if (code === 'oneb_state') return 'Термін дії посилання для входу минув або воно відкрите не в тому браузері. Почніть вхід через OneB заново.';
  if (code?.startsWith('oneb_')) return 'Щось пішло не так під час входу через OneB.';
  return '';
}

function getInitialError() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return authErrorMessage(params.get('error'));
}

function getInitialClientLogin() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('mode') === 'client';
}

const GITHUB_LOGIN_ENABLED = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED === 'true';

function providerErrorMessage(error, providerName) {
  if (error?.code === 'custom/popup-blocked') return 'Дозвольте popup-вікно у браузері та спробуйте ще раз.';
  if (providerName === 'GitHub' && (
    error?.code === 'auth/invalid-credential' ||
    error?.message?.includes('api.github.com/user') ||
    error?.message?.includes('Bad credentials')
  )) {
    return 'GitHub відхилив OAuth-ключ. Потрібно оновити Client ID і Client Secret провайдера GitHub у Firebase.';
  }
  if (error?.code === 'auth/account-exists-with-different-credential') {
    return 'Акаунт із цією поштою уже має інший спосіб входу.';
  }
  if (error?.code === 'auth/operation-not-allowed') {
    return `${providerName} ще не увімкнений у Firebase Authentication.`;
  }
  return `Не вдалося увійти через ${providerName}. Спробуйте ще раз.`;
}

export default function LoginPage() {
  const router = useRouter();
  const {
    signInWithGoogle,
    signInWithGitHub,
    signInWithAuthToken,
    currentUser,
    authLoading,
  } = useAppContext();

  const [githubLoading, setGithubLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [onebLoading, setOnebLoading] = useState(getInitialOneBLoading);
  const [error, setError] = useState(getInitialError);
  const [clientLogin] = useState(getInitialClientLogin);
  const hasForwardedOneBCode = useRef(false);
  const hasConsumedOauthToken = useRef(false);

  useEffect(() => {
    if (!authLoading && currentUser) {
      router.replace(getRequestedDestination());
    }
  }, [authLoading, currentUser, router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code || hasForwardedOneBCode.current) return;

    hasForwardedOneBCode.current = true;
    const callbackParams = new URLSearchParams({ code });
    // Forward `state` untouched: it is the only thing tying this code to a flow
    // this browser started. Inventing one when it is missing, as this used to
    // do, just forges a state the callback has to reject anyway.
    const state = params.get('state');
    if (state) callbackParams.set('state', state);
    navigateToSameOrigin(`/oauth2/result?${callbackParams.toString()}`, { replace: true });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('oneb') !== 'success' || hasConsumedOauthToken.current) return;
    hasConsumedOauthToken.current = true;

    (async () => {
      try {
        const response = await fetch('/api/auth/oauth-token', { credentials: 'include' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.customToken) throw new Error(data.error || 'Missing custom token');
        await signInWithAuthToken(data.customToken);
        sessionStorage.setItem('just_logged_in', 'true');
      } catch (err) {
        console.error('[Login] OneB token sign-in failed:', err);
        setError('Не вдалося завершити вхід через OneB. Спробуйте ще раз.');
      } finally {
        setOnebLoading(false);
      }
    })();
  }, [signInWithAuthToken]);

  const handleGitHub = async () => {
    try {
      setError('');
      setGithubLoading(true);
      await signInWithGitHub();
      sessionStorage.setItem('just_logged_in', 'true');
    } catch (err) {
      console.warn('[Login] GitHub sign-in failed:', err);
      setError(providerErrorMessage(err, 'GitHub'));
      setGithubLoading(false);
    }
  };

  const handleGoogle = async () => {
    try {
      setError('');
      setGoogleLoading(true);
      await signInWithGoogle();
      sessionStorage.setItem('just_logged_in', 'true');
    } catch (err) {
      console.error('[Login] Google sign-in failed:', err);
      setError(providerErrorMessage(err, 'Google'));
      setGoogleLoading(false);
    }
  };

  const handleOneB = () => {
    setError('');
    const clientId = process.env.NEXT_PUBLIC_ONEB_CLIENT_ID || 'dummy_client_id';
    if (clientId === 'dummy_client_id') {
      setError('OneB Client ID не налаштований.');
      return;
    }

    setOnebLoading(true);
    // The server builds the authorize URL: it is the only side that can set the
    // httpOnly nonce cookie the callback checks against.
    const params = new URLSearchParams({ r: getRequestedDestination() });
    navigateToSameOrigin(`/api/auth/oneb/start?${params.toString()}`);
  };

  const anyLoading = githubLoading || googleLoading || onebLoading;

  // Once Firebase has restored a valid account, the effect above only needs to
  // finish the navigation. Rendering the sign-in form during that gap creates
  // the familiar one-frame (or slow-network several-second) login flash.
  if (authLoading || currentUser) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#1c1c1c]">
        <div className="w-[32px] h-[32px] border-[3px] border-[#3a3a3a] border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <AuthLayout hideCreateOrg={true}>
      <div className="w-full max-w-[360px] flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
        <div className="mb-[24px]">
          <AnimatedLogo />
        </div>

        <h1 className="text-white text-[28px] font-black tracking-tight mb-[30px]">
          {clientLogin ? 'Увійти до qTicket' : 'Увійти або зареєструватися'}
        </h1>

        {clientLogin && (
          <p className="-mt-[18px] mb-[24px] text-[13px] leading-relaxed text-white/60">
            Увійдіть через акаунт із тією самою email-адресою, для якої вам підготували доступ.
          </p>
        )}

        <div className="w-full flex flex-col gap-3">
          {clientLogin && (
            <button
              type="button"
              onClick={handleGoogle}
              disabled={anyLoading}
              className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] py-[14px] px-6 rounded-full text-[15px] font-bold hover:bg-[#e9e9e9] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all shadow-xl"
            >
              <GoogleIcon />
              {googleLoading ? 'Перенаправлення...' : 'Увійти через Google'}
            </button>
          )}

          {GITHUB_LOGIN_ENABLED && <button
            type="button"
            onClick={handleGitHub}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] py-[14px] px-6 rounded-full text-[15px] font-bold hover:bg-[#e9e9e9] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all shadow-xl"
          >
            <GitHubIcon />
            {githubLoading ? 'Перенаправлення...' : 'Увійти через GitHub'}
          </button>}

          {!clientLogin && <button
            type="button"
            onClick={handleOneB}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] py-[14px] px-6 rounded-full text-[15px] font-bold hover:bg-[#e9e9e9] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all shadow-xl"
          >
            <Image src="/oneb-logo.png" alt="OneB" width={18} height={18} className="object-contain rounded-[4px]" />
            {onebLoading ? 'Перенаправлення...' : 'Увійти через OneB'}
          </button>}

          {!clientLogin && <button
            type="button"
            onClick={handleGoogle}
            disabled={anyLoading}
            className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] py-[14px] px-6 rounded-full text-[15px] font-bold hover:bg-[#e9e9e9] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all shadow-xl"
          >
            <GoogleIcon />
            {googleLoading ? 'Перенаправлення...' : 'Увійти через Google'}
          </button>}
        </div>

        {error && (
          <p className="mt-5 text-red-400 text-[13px] font-medium leading-relaxed bg-red-400/10 border border-red-400/20 px-4 py-3 rounded-[12px] w-full">
            {error}
          </p>
        )}

        {/* Two documents, not three.

            Consent given by pressing a sign-in button is consent to the rules
            of using the service and to what happens to your data — that pair is
            what every product asks for here, and it is what a person can
            actually be said to have agreed to by signing in. The offer is a
            commercial contract about paid access; §1 of the terms already binds
            it in by reference, and it is accepted when somebody buys something,
            not when they open the door. It stays one line below, in the footer,
            reachable from every screen of this shell.

            The links are the documents themselves. A sentence that names an
            agreement without linking it asks for consent on the one screen
            where the agreement cannot be read. */}
        <p className="mt-6 text-center text-xs leading-relaxed text-white/35">
          Продовжуючи, ви погоджуєтеся з{' '}
          <Link href="/terms" className="text-white/60 underline underline-offset-2 transition-colors hover:text-white">
            Умовами користування
          </Link>
          {' '}та{' '}
          <Link href="/privacy" className="text-white/60 underline underline-offset-2 transition-colors hover:text-white">
            Політикою конфіденційності
          </Link>
          .
        </p>
      </div>
    </AuthLayout>
  );
}
