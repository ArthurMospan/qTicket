'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, AtSign } from 'lucide-react';
import AnimatedLogo from '@/components/AnimatedLogo';
import AuthLayout from '@/components/AuthLayout';
import { useAppContext } from '@/lib/context/AppContext';
import { getSafeAuthRedirect } from '@/lib/utils/authRedirect';

function getRequestedDestination() {
  if (typeof window === 'undefined') return '/';
  const params = new URLSearchParams(window.location.search);
  return getSafeAuthRedirect(params.get('next') || params.get('redirect'), '/');
}

function methodsUrl() {
  const destination = getRequestedDestination();
  const params = new URLSearchParams();
  if (destination !== '/') params.set('next', destination);
  return params.size ? `/login?${params.toString()}` : '/login';
}

export default function EmailLoginPage() {
  const router = useRouter();
  const { currentUser, authLoading } = useAppContext();

  useEffect(() => {
    if (!authLoading && currentUser) {
      router.replace(getRequestedDestination());
    }
  }, [authLoading, currentUser, router]);

  if (authLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#1c1c1c]">
        <div className="w-[32px] h-[32px] border-[3px] border-[#3a3a3a] border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <AuthLayout hideCreateOrg={true}>
      <div className="w-full max-w-[360px] flex flex-col items-center text-center animate-in slide-in-from-right-4 fade-in duration-300">
        <button
          type="button"
          onClick={() => router.push(methodsUrl())}
          className="self-start mb-5 inline-flex items-center gap-2 text-[13px] font-semibold text-white/60 hover:text-white transition-colors"
        >
          <ArrowLeft size={16} />
          Назад
        </button>

        <div className="mb-[24px]">
          <AnimatedLogo />
        </div>

        <div className="w-[52px] h-[52px] rounded-[16px] bg-white/10 border border-white/10 flex items-center justify-center text-white/70 mb-5">
          <AtSign size={23} strokeWidth={2.4} />
        </div>

        <h1 className="text-white text-[28px] font-black tracking-tight mb-[10px]">
          Email - Soon
        </h1>
        <p className="text-white/50 text-[15px] leading-relaxed max-w-[300px] mb-[30px]">
          Вхід по коду на email тимчасово вимкнений. Зараз використовуйте GitHub, OneB або Google.
        </p>

        <button
          type="button"
          onClick={() => router.push(methodsUrl())}
          className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] py-[14px] px-6 rounded-full text-[15px] font-bold hover:bg-[#e9e9e9] active:scale-[0.98] transition-all shadow-xl"
        >
          До способів входу
        </button>
      </div>
    </AuthLayout>
  );
}
