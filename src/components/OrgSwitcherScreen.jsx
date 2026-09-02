'use client';
// src/components/OrgSwitcherScreen.jsx
// Full-screen org picker — Windows account-switcher style.
import { useState, useEffect } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { Counter, OrganizationMark } from '@/components/ui';
import { useModalFocus } from '@/lib/hooks/useModalFocus';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { withNotificationOrganization } from '@/lib/utils/notificationNavigation.mjs';
import { useOrganizationUnreadCounts } from '@/lib/hooks/useOrganizationUnreadCounts';
import { isClientRole } from '@/lib/utils/can';
import { resolveOrganizationPortalBrand } from '@/lib/utils/organizationBranding.mjs';

// Логотипи бувають темні/прозорі (png, svg) і зливаються з темним фоном
// пікера. Тому під лого завжди є підложка: біла за замовчуванням, або колір
// бренду, якщо власник обрав свій колір рейки.
//
// Один tenant — один бренд, і це той самий, що читає рейка.
//
// Тут довго стояла власна відповідь: `org.customBranding`, `org.sidebarTheme`,
// `org.sidebarColor` — поля, які писав успадкований таск-менеджер, коли хтось
// колись обрав у ньому колір. Рейку з них зняли (див. `useCachedOrgBranding`:
// «та сама організація була білою в QuickTeam і фіолетовою в рейці qTicket»),
// а цей екран лишився єдиним місцем, що їх читає. Тому під час кліку кружок
// на мить наливався кольором, якого більше немає ніде в продукті — вибором,
// зробленим роки тому й скасованим усюди, крім цієї анімації.
//
// `resolveOrganizationPortalBrand` — та сама одна відповідь: спершу знімок,
// який підписує й надсилає QuickTeam, і лише потім власні поля організації,
// що передують синхронізації.
function orgLogoBackdrop(org) {
  const brand = resolveOrganizationPortalBrand(org);
  if (brand.sidebarTheme === 'custom' && brand.sidebarColor) return brand.sidebarColor;
  return '#ffffff';
}

function OrgBigCard({ org, role, unreadCount, onClick }) {
  const portalBrand = resolveOrganizationPortalBrand(org);
  // Одне обличчя для обох читачів. Назву тут обирала роль — клієнт бачив назву
  // служби підтримки, працівник назву власної організації, — тоді як логотип
  // уже був спільний. Назва служби — та, яку власник задає в інтеграції qTicket
  // у QuickTeam; з 2026-09-02 її показують усім і ця картка, і рейка, і вкладка.
  const displayName = portalBrand.name;
  const logoSrc = portalBrand.logo;

  return (
    <button
      onClick={(e) => onClick(e, org.id)}
      className="flex flex-col items-center gap-4 transition-all duration-300 group/item w-[160px] group-hover/list:opacity-30 hover:!opacity-100"
    >
      <div className="relative">
        {/* Обгортка кругла, бо тінь, яку вона відкидає, кругла.
            `shadow-xl` стояв на `block`-спані без радіуса — знак усередині
            круглий, а тінь під ним квадратна, і на темному тлі пікера це
            читалось як прямокутна пластина, підкладена під логотип. Сам спан
            лишається тим, чим є: якорем для `getBoundingClientRect`, з якого
            стартує анімація розкриття. */}
        <span
          id={`org-circle-${org.id}`}
          className="relative z-10 inline-block rounded-full shadow-xl transition-transform duration-300 group-hover/item:scale-[1.02]"
        >
          <OrganizationMark
            name={displayName}
            logo={logoSrc}
            size="picker"
            appearance="inverse"
            background={orgLogoBackdrop(org)}
          />
        </span>
        {unreadCount > 0 && (
          <Counter
            value={unreadCount}
            size="md"
            appearance="inverse-outline"
            className="absolute -right-1 -top-1 z-20"
          />
        )}
      </div>
      <div className="flex flex-col items-center min-w-0 w-full text-center mt-2">
        <p className="text-[16px] font-bold text-white w-full truncate transition-transform group-hover/item:scale-105">{displayName}</p>
        <span className="text-[13px] font-medium text-white/50 mt-1 transition-transform group-hover/item:scale-105">{role}</span>
      </div>
    </button>
  );
}

export default function OrgSwitcherScreen({ onClose }) {
  const { allOrgs, orgRoles, currentUser, orgRole } = useAppContext();
  const clientPortal = isClientRole(orgRole);
  const router = useRouter();
  const [expandingOrg, setExpandingOrg] = useState(null);
  const dialogRef = useModalFocus({ isOpen: Boolean(onClose), onClose });
  const { counts: unreadByOrg } = useOrganizationUnreadCounts();

  const handleSelect = (e, org) => {
    const circle = document.getElementById(`org-circle-${org.id}`);
    if (circle) {
      const rect = circle.getBoundingClientRect();
      setExpandingOrg({
        org,
        rect: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
        active: false,
      });

      // Trigger the animation in the next frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setExpandingOrg(prev => prev ? { ...prev, active: true } : null);
        });
      });
    }

    setTimeout(() => {
      sessionStorage.setItem('qt_org_selected_this_session', '1');
      sessionStorage.removeItem('just_logged_in');
      // The URL is the navigation intent and the route guard applies it. Doing
      // a state switch first let the guard render once with the previous
      // search params and immediately switch the state back to the old org.
      sessionStorage.setItem('qt_active_org_id', org.id);
      onClose?.();
      // The destination carries the selection itself. Relying on React state to
      // settle before a bare `/` navigation let the route guard restore the
      // organization that was active one render earlier.
      router.push(withNotificationOrganization('/', org.id));
    }, 700); // 700ms for smooth transition
  };

  // The role comes from this user's membership documents, which is where
  // access lives. It used to come from a `members` array denormalized onto the
  // organization document — a field nothing maintains any more, so the lookup
  // missed and quietly fell back to «member»: the owner of a workspace was
  // labelled a participant in it, in English, because the raw id was printed
  // with `capitalize`.
  const roleLabel = (org) => organizationRoleLabel(orgRoles?.[org.id]);

  const isExpanding = !!expandingOrg;
  const expandingPortalBrand = expandingOrg
    ? resolveOrganizationPortalBrand(expandingOrg.org)
    : null;
  const expandingLogo = expandingOrg ? expandingPortalBrand.logo : '';
  const expandingName = expandingOrg ? expandingPortalBrand.name : '';

  return (
    <div
      ref={dialogRef}
      tabIndex={onClose ? -1 : undefined}
      role={onClose ? 'dialog' : undefined}
      aria-modal={onClose ? 'true' : undefined}
      aria-label={onClose ? 'Вибір організації' : undefined}
      data-ui-overlay="workspace-mode"
      className={`fixed inset-0 z-[200] ${onClose ? 'bg-transparent' : 'bg-canvas'}`}
    >
      <AuthLayout portalMode={clientPortal} onClose={onClose}>

        <div className={`flex flex-col items-center w-full max-w-[800px] transition-opacity duration-300 ${isExpanding ? 'opacity-0' : 'opacity-100'} animate-in slide-in-from-bottom-8 duration-500 pb-16`}>
          <h1 className="ui-type-display-title text-white mb-2 text-center tracking-tight">
            {clientPortal ? 'Оберіть службу підтримки' : 'Оберіть організацію'}
          </h1>
          <p className="text-[14px] font-medium text-white/50 mb-12 text-center">
            Ви увійшли як {currentUser?.email}
          </p>

          <div className="flex flex-wrap justify-center gap-8 items-start group/list">
            {allOrgs.map(org => (
              <OrgBigCard
                key={org.id}
                org={org}
                role={roleLabel(org)}
                unreadCount={unreadByOrg[org.id] || 0}
                onClick={(e) => handleSelect(e, org)}
              />
            ))}
          </div>
        </div>

        {/* Expanding White Border Animation */}
        {expandingOrg && (
          <div
            className="fixed z-[1000] rounded-full flex items-center justify-center overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{
              left: expandingOrg.active ? '50%' : expandingOrg.rect.x,
              top: expandingOrg.active ? '50%' : expandingOrg.rect.y,
              width: 110,
              height: 110,
              transform: `translate(-50%, -50%) scale(${expandingOrg.active ? 1.2 : 1})`,
              boxShadow: expandingOrg.active ? '0 0 0 150vw #ffffff' : '0 0 0 3px #ffffff',
              backgroundColor: expandingLogo
                ? orgLogoBackdrop(expandingOrg.org)
                : '#2a2a2a',
            }}
          >
            {expandingLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={expandingLogo} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-[40px] font-medium text-white">{expandingName[0].toUpperCase()}</span>
            )}
          </div>
        )}
      </AuthLayout>
    </div>
  );
}
