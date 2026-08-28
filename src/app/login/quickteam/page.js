'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import AnimatedLogo from '@/components/AnimatedLogo';
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
        router.replace(withNotificationOrganization(data.returnTo || '/overview', data.organizationId));
      } catch (launchError) {
        setError(launchError.message || 'Не вдалося відкрити qTicket через QuickTeam.');
      }
    })();
  }, [code, router, signInWithAuthToken]);

  return (
    <AuthLayout>
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
            <AnimatedLogo />
            <h1 className="ui-type-display-title mt-6 text-white">Відкриваємо qTicket</h1>
            <p className="mt-3 text-[13px] text-white/60">
              Підтверджуємо ваш доступ через QuickTeam. Повторно входити не потрібно.
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
