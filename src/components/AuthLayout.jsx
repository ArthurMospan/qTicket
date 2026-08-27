'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAppContext } from '@/lib/context/AppContext';
import { Plus, X, LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { IconAction } from '@/components/ui';
import SupportDialog from '@/components/SupportDialog';

// Everything QuickTeam owes a reader who is not inside a workspace yet: the
// help it publishes, a way to reach a person, and the three documents.
//
// The footer used to carry one of them. The privacy policy alone is the
// convention of a cookie banner, not of a product's front door — and this shell
// is not only the front door: it is also the screen you land on between two
// organizations, and the one you are left on when something has gone wrong,
// which is exactly when «write to support» has to be on screen rather than
// three clicks inside a workspace you cannot currently open.
const AUTH_FOOTER_DOCUMENTS = [
  { href: '/help', label: 'Довідка' },
  { href: '/terms', label: 'Умови користування' },
  { href: '/privacy', label: 'Конфіденційність' },
  { href: '/offer', label: 'Публічна оферта' },
];

const AUTH_FOOTER_LINK_CLASS = 'text-white/30 hover:text-white/70 transition-colors text-[12px] font-medium';

export default function AuthLayout({ children, hideCreateOrg = false, onClose }) {
  const { currentUser, signOut } = useAppContext();
  const router = useRouter();
  const [showDropdown, setShowDropdown] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  const handleCreateOrg = () => {
    router.push('/onboarding?new=true');
  };

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  const firstLetter = currentUser?.email ? currentUser.email[0].toUpperCase() : 'U';
  const hasPhoto = !!(currentUser?.avatar || currentUser?.photoURL);
  const photo = currentUser?.avatar || currentUser?.photoURL;

  // Animation depends on if it's opened from sidebar or fullscreen
  const animationClass = onClose
    ? 'animate-in slide-in-from-left-8 fade-in duration-[500ms] origin-left ease-[cubic-bezier(0.16,1,0.3,1)]'
    : 'animate-in fade-in duration-500 ease-out';

  return (
    <div className={`w-full h-[100dvh] bg-[#f5f5f5] p-[12px] flex flex-col overflow-hidden select-none ${animationClass}`}>
      <div className="w-full h-full bg-[#1c1c1c] rounded-[24px] overflow-hidden flex flex-col relative text-white">

        {/* Header - Padding matches WorkspaceSidebar: pt-24px, px-20px */}
        <div className="w-full flex items-center justify-between pt-[24px] px-[20px] pb-[16px] shrink-0 relative z-50">
          <div className="flex items-center gap-[12px]">
            <Image src="/logo-min.svg" alt="qTicket" width={32} height={32} loading="eager" className="object-contain" />
            <h1 className="ui-type-section-title text-white tracking-tight leading-tight truncate">qTicket</h1>
          </div>

          <div className="flex items-center gap-6">
            {currentUser && !hideCreateOrg && (
              <button
                onClick={handleCreateOrg}
                className="hidden md:flex items-center gap-2 text-white/70 hover:text-white transition-colors text-[13px] font-medium"
              >
                <Plus size={16} />
                Створити організацію
              </button>
            )}

            {onClose ? (
              <IconAction
                label="Закрити"
                icon={X}
                size="md"
                composition="auth-close"
                appearance="auth-close"
                shape="circle"
                onClick={onClose}
              />
            ) : currentUser ? (
              <div className="relative">
                <button
                  data-ui-action="avatar-menu"
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="w-8 h-8 rounded-full bg-[#2a2a2a] border border-white/10 flex items-center justify-center overflow-hidden shrink-0 hover:border-white/30 transition-colors cursor-pointer"
                >
                  {hasPhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[14px] font-bold text-white">{firstLetter}</span>
                  )}
                </button>
                {showDropdown && (
                  <div className="absolute top-full right-0 mt-2 w-[160px] bg-[#2a2a2a] border border-[#3a3a3a] rounded-[12px] shadow-2xl py-1 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                    <div className="px-3 py-2 border-b border-[#3a3a3a]">
                      <p className="text-[11px] font-bold text-white/50 truncate">{currentUser.email}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-medium text-red-400 hover:bg-white/5 transition-colors text-left"
                    >
                      <LogOut size={14} />
                      Вийти
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* Main Content
            `my-auto` on the child, not `justify-center` on the scroller. A
            centred flex column that overflows pushes its first child *above*
            the scroll origin, and there is no scroll position that brings it
            back — so the top of anything taller than this card was cut off and
            unreachable. That is what the price list on «Оберіть тариф» ran
            into. Auto margins centre what fits and collapse to zero for what
            does not. */}
        <div className="flex-1 w-full flex flex-col items-center px-4 overflow-y-auto custom-scrollbar relative z-10">
          <div className="my-auto flex w-full flex-col items-center">
            {children}
          </div>
        </div>

        {/* Footer. Wraps rather than scrolls: on a phone this is five short
            words on two lines, not a row that runs off the edge of the card. */}
        <div className="w-full flex flex-wrap items-center gap-x-[20px] gap-y-[8px] p-6 md:p-8 shrink-0 relative z-50">
          {/* A word in a row of words, and the only one that opens something
              rather than navigating. A kit `Button` here would put a control
              box in a line of quiet 12px links and make support the loudest
              thing on a screen whose job is the sign-in buttons above it.
              Marked `data-ui-control="auth-footer-support"`. */}
          <button
            type="button"
            data-ui-control="auth-footer-support"
            onClick={() => setSupportOpen(true)}
            className={AUTH_FOOTER_LINK_CLASS}
          >
            Підтримка
          </button>
          {AUTH_FOOTER_DOCUMENTS.map(document => (
            <Link key={document.href} href={document.href} className={AUTH_FOOTER_LINK_CLASS}>
              {document.label}
            </Link>
          ))}
          <span className="text-white/30 text-[12px] font-medium ml-auto">
            Українська
          </span>
        </div>

      </div>

      <SupportDialog isOpen={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}
