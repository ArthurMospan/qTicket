'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import { Button } from '@/components/ui';
import { useAppContext } from '@/lib/context/AppContext';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';

function initialLaunchCode() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('code') || '';
}

export default function QuickTeamLoginPage() {
  const router = useRouter();
  const { signInWithAuthToken } = useAppContext();
  const [code] = useState(initialLaunchCode);
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!code) {
      queueMicrotask(() => setError('У посиланні немає одноразового коду входу.'));
      return;
    }

    (async () => {
      try {
        const response = await fetch('/api/integrations/quickteam/consume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
          cache: 'no-store',
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.customToken) {
          throw new Error(data.error || 'Не вдалося підтвердити вхід');
        }
        await signInWithAuthToken(data.customToken);
        sessionStorage.setItem('qt_active_org_id', data.organizationId);
        sessionStorage.setItem('qt_org_selected_this_session', '1');
        sessionStorage.setItem('just_logged_in', 'true');
        // `returnTo` arrives from QuickTeam and the contract only checks that it
        // is a same-origin path — `/login` and `/api/…` pass that and are then
        // refused by `normalizeNotificationLink`, which answers with an empty
        // string. `router.replace('')` is not a navigation: it resolves to the
        // page you are already on, and this page is a spinner that says
        // «Відкриваємо qTicket» for ever. A launch that names a destination we
        // will not open lands on the staff front door instead of nowhere.
        const destination = withNotificationOrganization(data.returnTo || '/overview', data.organizationId)
          || withNotificationOrganization('/overview', data.organizationId)
          || '/overview';
        router.replace(destination);
      } catch (launchError) {
        setError(launchError.message || 'Не вдалося відкрити qTicket через QuickTeam.');
      }
    })();
  }, [code, router, signInWithAuthToken]);

  return (
    <AuthLayout transitional>
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        {error ? (
          <>
            <CheckCircle2 size={42} className="mb-5 text-white/40" aria-hidden />
            <h1 className="ui-type-display-title text-white">Вхід не завершено</h1>
            <p className="mt-3 max-w-[360px] text-[13px] leading-relaxed text-white/60">{error}</p>
            <Button
              style="secondary"
              size="lg"
              icon={ArrowLeft}
              onClick={() => window.history.back()}
              className="mt-7"
            >
              Повернутися до QuickTeam
            </Button>
          </>
        ) : (
          <>
            {/* Знак продукту стоїть у шапці цієї ж картки. Ще один, удвічі
                більший, посеред екрана, який живе секунду й веде далі, — це
                не вітання, це затримка з логотипом. */}
            <h1 className="ui-type-display-title text-white">Відкриваємо qTicket</h1>
            <p className="mt-3 text-[13px] text-white/60">
              Підтверджуємо ваш доступ через QuickTeam. Повторно входити не потрібно.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
