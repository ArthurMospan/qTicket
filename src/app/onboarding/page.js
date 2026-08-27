'use client';
// src/app/onboarding/page.js
// Single-step premium onboarding matching the login style.
import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AuthLayout from '@/components/AuthLayout';
import { useAppContext } from '@/lib/context/AppContext';
import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { PlanCards } from '@/components/ui';
import { FREE_WORKSPACE, freeWorkspaceElsewhere, normalizePlan } from '@/lib/utils/plans.mjs';
import { normalizeTimeZone } from '@/lib/utils/timeZone.mjs';
import { createOrganization } from '@/lib/services/organizations';
import { switchOrganizationPlan } from '@/lib/services/organizationPlan';

function OnboardingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNewOrg = searchParams.get('new') === 'true';
  const { currentUser, activeOrg, activeOrgId, setActiveOrgId, switchOrg, orgRole, authLoading, orgLoading, allOrgs, orgRoles } = useAppContext();

  const [step, setStep] = useState(0); // 0: Name, 1: Plan
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  // Which plan is being created right now, if any. There is no «selected»
  // state any more: the card's own button is the choice and the action at
  // once, so nothing is held between them.
  const [creatingPlan, setCreatingPlan] = useState('');
  // What the server said when it refused. The screen greys the Free card out on
  // what it can see; the account's other workspaces are what the route counts,
  // and the two can disagree — another tab, another device, a stale list.
  const [createError, setCreateError] = useState('');

  // Auto-fill org name
  useEffect(() => {
    let nextName = '';
    if (isNewOrg) {
      if (currentUser?.email) {
        const prefix = currentUser.email.split('@')[0];
        const formatted = prefix.charAt(0).toUpperCase() + prefix.slice(1);
        nextName = `${formatted} Team`;
      }
    } else if (activeOrg?.name && activeOrg.name !== 'QuickTeam') {
      nextName = activeOrg.name;
    } else if (currentUser?.email) {
      const prefix = currentUser.email.split('@')[0];
      const formatted = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      nextName = `${formatted} Team`;
    }
    if (nextName) queueMicrotask(() => setOrgName(nextName));
  }, [activeOrg?.name, currentUser?.email, isNewOrg]);

  // Non-owner/admin → go to workspace (skip if creating new org)
  useEffect(() => {
    if (isNewOrg) return;
    if (!authLoading && !orgLoading && currentUser && orgRole && orgRole !== 'owner' && orgRole !== 'admin') {
      router.replace('/');
    }
  }, [authLoading, orgLoading, currentUser, orgRole, router, isNewOrg]);

  // Already onboarded → go to workspace (skip if creating new org)
  useEffect(() => {
    if (isNewOrg) return;
    if (!authLoading && !orgLoading && activeOrg?.onboarded === true) {
      router.replace('/');
    }
  }, [authLoading, orgLoading, activeOrg, router, isNewOrg]);

  if (authLoading || orgLoading) {
    return (
      <div className="w-full h-full min-h-screen flex items-center justify-center bg-[#f4f4f5]">
        <div className="w-[32px] h-[32px] border-[3px] border-[#e9e9e9] border-t-[#1f1f1f] rounded-full animate-spin" />
      </div>
    );
  }

  // One free workspace per account. The second one somebody creates is a second
  // workspace, and a free plan is what the first is for.
  //
  // This is the screen saying so; `/api/organizations` is what holds the line. A
  // Firestore rule cannot: «how many free organizations does this account
  // already own» is a count, and `allow create` only ever sees the one document
  // in front of it.
  //
  // Той самий підрахунок робить екран тарифів у налаштуваннях і маршрут, що
  // перемикає тариф, — звідси спільна функція: три копії однієї умови рано чи
  // пізно починають рахувати по-різному.
  const ownsFreeWorkspace = Boolean(freeWorkspaceElsewhere(
    (allOrgs || []).filter(organization => orgRoles?.[organization.id] === 'owner'),
    activeOrgId,
  ));
  const freeTaken = isNewOrg && ownsFreeWorkspace;

  const handleNext = () => {
    if (orgName.trim()) setStep(1);
  };

  const handleFinish = async (planId) => {
    const selectedPlan = normalizePlan(planId);
    if (!orgName.trim() || saving) return;
    setSaving(true);
    setCreatingPlan(selectedPlan);
    const isFreshOrganization = isNewOrg || !activeOrgId;
    // A fresh workspace is named by the server that writes it; there is
    // nothing left for the browser to invent here.
    const orgId = isFreshOrganization ? '' : activeOrgId;
    const detectedTimeZone = normalizeTimeZone(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );

    try {
      // A brand-new workspace and the owner's seat in it are two privileged
      // writes, so they are one server call — and the only place that can hold
      // «one free workspace per account», which is a count no rule can make.
      const createdId = isFreshOrganization
        ? await createOrganization({
          name: orgName.trim(),
          logo: logoUrl,
          plan: selectedPlan,
          timezone: activeOrg?.timezone || detectedTimeZone,
        })
        : orgId;

      // Finishing the onboarding of an organization that already exists: its
      // name and its timezone are an update by its owner, which the rules can
      // check on their own. Its plan is not — `plan` and `limits` are refused
      // from a browser now, because a plan change also decides which projects
      // the new ceiling no longer has room for.
      if (!isFreshOrganization) {
        await setDoc(doc(db, 'organizations', orgId), {
          id: orgId,
          name: orgName.trim(),
          logo: logoUrl,
          timezone: activeOrg?.timezone || detectedTimeZone,
          onboarded: true,
          onboardedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        await switchOrganizationPlan(orgId, selectedPlan);
      }

      // Force local state update immediately, bypassing switchOrg's allOrgs check
      if (setActiveOrgId) {
        setActiveOrgId(createdId);
      }
      sessionStorage.setItem('qt_active_org_id', createdId);
      localStorage.removeItem('qt_active_org_id');
      sessionStorage.setItem('qt_org_selected_this_session', '1');

      setTimeout(() => {
        router.replace('/');
      }, 100);
    } catch (err) {
      console.error('[Onboarding] saveOrg error:', err);
      // Said on the screen, not only in the console. A refusal nobody can read
      // is a button that quietly stopped working.
      setCreateError(err?.message || 'Не вдалося створити організацію');
      setSaving(false);
      setCreatingPlan('');
    }
  };

  return (
    <AuthLayout
      hideCreateOrg={true}
      onClose={isNewOrg ? () => router.replace('/') : undefined}
    >
      <div className={`w-full ${step === 1 ? 'max-w-[860px]' : 'max-w-[480px]'} flex flex-col items-center z-10 relative transition-all duration-500 pb-16`}>

        {step === 0 && (
          <div className="w-full flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Title */}
            <h1 className="text-white text-[32px] font-black tracking-tight mb-[6px] text-center">Створення організації</h1>
            <p className="text-white/50 text-[15px] leading-relaxed text-center mb-[32px]">
              Як називається ваша команда або організація?
            </p>

            {/* Form */}
            <div className="w-full mb-8 space-y-6">
              <div>
                <label className="block text-[14px] font-medium text-white mb-2">
                  Назва
                </label>
                <input
                  type="text"
                  autoFocus
                  placeholder="Введіть назву організації"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && orgName.trim()) handleNext(); }}
                  className="w-full bg-[#2a2a2a] border border-white/10 rounded-[12px] px-4 py-[14px] text-white text-[15px] placeholder:text-white/30 focus:outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20 transition-all"
                />
              </div>
            </div>

            <button
              onClick={handleNext}
              disabled={!orgName.trim()}
              className="w-full flex items-center justify-center gap-3 bg-white text-[#1f1f1f] py-[16px] px-6 rounded-[16px] text-[15px] font-bold hover:bg-[#e9e9e9] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all"
            >
              Далі
              <ArrowRight size={18} />
            </button>
            <p className="mt-[24px] text-white/30 text-[12px] leading-relaxed text-center">
              Назву організації можна буде змінити пізніше в Налаштуваннях.
            </p>
          </div>
        )}

        {step === 1 && (
          <div className="w-full flex flex-col animate-in fade-in slide-in-from-right-8 duration-500">

            <div className="relative mb-6 flex w-full flex-col items-center gap-4 sm:block">
              <button
                onClick={() => setStep(0)}
                className="flex self-start items-center gap-2 text-[13px] font-bold text-white/50 transition-colors hover:text-white sm:absolute sm:left-0 sm:top-1/2 sm:-translate-y-1/2"
              >
                <ArrowRight size={16} className="rotate-180" />
                Назад
              </button>
              <div className="w-full text-center sm:px-24">
                <h1 className="mb-[6px] text-[28px] font-black tracking-tight text-white sm:text-[32px]">Оберіть тариф</h1>
                <p className="text-white/50 text-[15px] leading-relaxed">
                  {freeTaken
                    ? FREE_WORKSPACE.hint
                    : `Оберіть тариф — і ${orgName} відкриється одразу. Змінити його можна будь-коли.`}
                </p>
              </div>
            </div>

            {/* The same price list the settings screen shows, and the same
                registry behind it. This step used to hand-build three cards
                with four invented bullet points each and an accent colour per
                plan, at prices the product had already moved on from — a
                person met that on the day they signed up and a different one
                the first time they went looking for the bill. */}
            <PlanCards
              activePlanId=""
              onChoose={handleFinish}
              busyPlanId={creatingPlan}
              lockedPlanIds={freeTaken ? ['free'] : []}
              lockedLabel={FREE_WORKSPACE.lockedLabel}
              className="mb-6"
            />

            {createError && (
              <p role="alert" className="mb-4 text-center text-[13px] leading-relaxed text-white/70">
                {createError}
              </p>
            )}

            <p className="text-white/30 text-[12px] leading-relaxed text-center">
              Оплата ще не підключена. Тариф можна змінити будь-коли в Налаштуваннях.
            </p>
          </div>
        )}

      </div>
    </AuthLayout>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="w-full h-screen bg-[#111111] flex items-center justify-center">
        <div className="w-[32px] h-[32px] border-[3px] border-[#333] border-t-white rounded-full animate-spin" />
      </div>
    }>
      <OnboardingPageContent />
    </Suspense>
  );
}
