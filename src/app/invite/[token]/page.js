'use client';

// Invite-link landing: /invite/<token>. Not under the (app) group on purpose —
// the visitor may have no organization yet, and the workspace shell assumes
// one. Unauthenticated visitors go to /login and come back via ?next=.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useAppContext } from '@/lib/context/AppContext';
import { Button, LoadingSpinner, UserAvatar } from '@/components/ui';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';
import { auth } from '@/lib/firebase';

// Скільки людина встигає прочитати «вітаємо», перш ніж її переносить у
// воркспейс. Названо, бо цифра стоїть у двох реченнях — тут і в підписі нижче.
const HANDOVER_MS = 2200;

export default function InvitePage() {
  const { token } = useParams();
  const router = useRouter();
  const { currentUser, authLoading } = useAppContext();
  const [state, setState] = useState({ phase: 'working' }); // working | done | error
  const requested = useRef(false);

  // Приєднався — і опинився в тій організації, до якої приєднався.
  //
  // Раніше тут стояли `switchOrg(id)` і перехід на голий `/`, і жодне з двох не
  // спрацьовувало: `switchOrg` шукає організацію в уже завантаженому списку, а
  // членство щойно створене й до списку ще не доїхало, тож виклик тихо виходив
  // ні з чим; далі голий `/` не ніс жодного наміру, і сторожовий маршрут
  // відновлював ту організацію, яка була активна досі. Людина натискала
  // запрошення й лишалася там, де була.
  //
  // Намір несе адреса — рівно так, як це робить перемикач організацій: `?org=`
  // читає `WorkspaceOrganizationRouteGuard` і чекає, доки серверний довідник
  // підтвердить нове членство, а не покладається на стан, який ще не приїхав.
  const enterWorkspace = useCallback((organizationId) => {
    if (organizationId) {
      try {
        sessionStorage.setItem('qt_org_selected_this_session', '1');
        sessionStorage.removeItem('just_logged_in');
        sessionStorage.setItem('qt_active_org_id', organizationId);
      } catch {}
    }
    router.replace(withNotificationOrganization('/', organizationId) || '/');
  }, [router]);


  useEffect(() => {
    if (authLoading) return;
    if (!currentUser) {
      router.replace(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
      return;
    }
    if (requested.current) return;
    requested.current = true;

    const accept = async () => {
      try {
        const idToken = await auth.currentUser?.getIdToken();
        const response = await fetch('/api/invitations/link/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ token }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Посилання недійсне або протерміноване');
        setState({
          phase: 'done',
          organizationId: result.organizationId,
          orgName: result.organizationName,
          orgLogo: result.organizationLogo,
          invitedBy: result.invitedBy,
          alreadyMember: result.alreadyMember,
        });
        setTimeout(() => enterWorkspace(result.organizationId), HANDOVER_MS);
      } catch (error) {
        setState({ phase: 'error', message: error.message });
      }
    };
    accept();
  }, [authLoading, currentUser, token, router, enterWorkspace]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-dark px-4">
      <div data-ui-surface="local" className="w-full max-w-[380px] rounded-[20px] bg-white p-8 text-center shadow-2xl">
        {state.phase === 'working' && (
          <>
            {/* Спінер продукту, а не фіолетовий з lucide: індиго не входить у
                нашу гаму й не зустрічається більше ніде. */}
            <LoadingSpinner size="lg" className="mx-auto mb-5" />
            <h1 className="ui-type-section-title text-ink">Приєднуємо вас до команди…</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">Перевіряємо запрошення.</p>
          </>
        )}

        {state.phase === 'done' && (
          <>
            {/* Обличчя організації, до якої людина щойно приєдналася. Екран
                казав саму назву в дужках усередині речення — вона й лишалася
                найменш помітним словом на сторінці, хоча це єдине, заради чого
                сюди прийшли. */}
            <div className="mb-5 flex flex-col items-center gap-3">
              {state.orgLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={state.orgLogo}
                  alt=""
                  className="h-16 w-16 rounded-[18px] border border-line bg-white object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-ink text-[24px] font-bold text-white">
                  {(state.orgName || 'О')[0].toUpperCase()}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
                <CheckCircle2 size={14} aria-hidden />
                {state.alreadyMember ? 'Ви вже учасник' : 'Запрошення прийнято'}
              </span>
            </div>

            <h1 className="ui-type-section-title text-ink">
              {state.orgName ? `Вітаємо в «${state.orgName}»` : 'Вітаємо в команді'}
            </h1>

            {/* Хто вас покликав. Запрошення від людини, а не від системи —
                і одне обличчя каже це краще, ніж будь-яке речення. */}
            {state.invitedBy?.name && (
              <div
                data-ui-surface="local"
                className="mt-5 flex items-center justify-center gap-2.5 rounded-[12px] bg-canvas px-4 py-3"
              >
                <UserAvatar
                  user={{ name: state.invitedBy.name, avatar: state.invitedBy.avatar }}
                  size="sm"
                />
                <span className="min-w-0 text-left">
                  <span className="block text-[11px] font-bold uppercase tracking-wider text-muted">Вас запросив(ла)</span>
                  <span className="block truncate text-[13px] font-bold text-ink">{state.invitedBy.name}</span>
                </span>
              </div>
            )}

            <p className="mt-5 text-[13px] leading-relaxed text-muted">Переносимо у ваш новий воркспейс…</p>
            <Button
              onClick={() => enterWorkspace(state.organizationId)}
              style="primary"
              size="lg"
              className="mt-4 w-full"
            >
              Перейти зараз
            </Button>
          </>
        )}

        {state.phase === 'error' && (
          <>
            <XCircle className="mx-auto mb-4 h-8 w-8 text-danger" aria-hidden />
            <h1 className="ui-type-section-title text-ink">Не вдалося приєднатися</h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{state.message}</p>
            <Button
              onClick={() => router.replace('/')}
              style="primary"
              size="lg"
              className="mt-6 w-full"
            >
              На головну
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
