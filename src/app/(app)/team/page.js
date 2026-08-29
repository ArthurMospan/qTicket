'use client';

// src/app/workspace/team/page.js
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { activeMembers, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { isClientRole } from '@/lib/utils/can';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useMobilePaneBack } from '@/lib/hooks/useMobilePaneBack';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { User } from 'lucide-react';
import {
  Surface,
  LoadingSpinner,
  EmptyState,
  Button,
  Alert,
  MobilePaneBack,
  SidebarLayout,
  MemberRail,
} from '@/components/ui';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import ProfileView from '@/components/profile/ProfileView';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';

// ── Invite Modal ─────────────────────────────────────────────────────────────
// ── Main Page ────────────────────────────────────────────────────────────────
export default function TeamPage() {
  const { members, loading, error: membersError } = useOrganization();
  const { positions = [] } = useWorkflowConfig();

  // QUI-104. Search can now answer with a person, and an answer has to land on
  // that person rather than on whoever happens to be first in the list.
  const searchParams = useSearchParams();
  const requestedMemberId = searchParams.get('member') || '';
  const teamSearch = useWorkspaceStore(s => s.teamSearch) || '';
  const [selectedUid, setSelectedUid] = useState(null);
  // Mobile single-pane mode: 'list' (учасники) або 'detail' (профіль); md+ показує обидві
  const [mobilePane, setMobilePane] = useState('list');
  // Системний «назад» на телефоні повертає до списку команди
  const requestPaneClose = useMobilePaneBack(mobilePane === 'detail', () => setMobilePane('list'));

  const teamMembers = useMemo(() => activeMembers(members)
    .filter(member => !isClientRole(member.role))
    .map(member => ({
      ...member,
      positionName: positions.find(position => position.id === member.positionId)?.label
        || member.title
        || organizationRoleLabel(member.role),
    })), [members, positions]);

  const filteredMembers = useMemo(() => teamMembers.filter(m =>
    (m.name || '').toLowerCase().includes(teamSearch.toLowerCase()) ||
    (m.email || '').toLowerCase().includes(teamSearch.toLowerCase())
  ), [teamMembers, teamSearch]);
  usePublishLocalSearchResults(teamSearch, filteredMembers.length);

  useEffect(() => {
    if (loading || !requestedMemberId) return;
    if (!teamMembers.some(member => (member.id || member.uid) === requestedMemberId)) return;
    queueMicrotask(() => {
      setSelectedUid(requestedMemberId);
      setMobilePane('detail');
    });
  }, [loading, teamMembers, requestedMemberId]);

  // Auto-select first member on initial load
  useEffect(() => {
    if (!loading && teamMembers.length > 0 && !selectedUid) {
      queueMicrotask(() => setSelectedUid(filteredMembers[0]?.id || filteredMembers[0]?.uid));
    }
  }, [loading, teamMembers.length, selectedUid, filteredMembers]);

  const selectedMember = teamMembers.find(m => (m.id || m.uid) === selectedUid);


  // Одне питання на три екрани: відмова в доступі, вичерпана квота й обрив
  // мережі — це три різні речі, і всі три казали «перевірте зʼєднання».
  const dataFailure = workspaceDataFailureCopy(membersError, isQuotaRefused());
  return (
    <SidebarLayout
      context="team"
      mobilePane={mobilePane === 'detail' ? 'content' : 'sidebar'}
      sidebar={
        <MemberRail
          members={filteredMembers}
          activeId={selectedUid}
          onSelect={member => { setSelectedUid(member.id || member.uid); setMobilePane('detail'); }}
          loading={loading}
          action={null}
        />
      }
    >
      {/* RIGHT PANEL — mobile: shown only when a member is selected */}
      <div
        data-ui-surface="panel"
        data-ui-padding="sm"
        className={`ui-surface ${mobilePane === 'list' ? 'hidden' : 'flex'} md:flex flex-1 flex-col h-full overflow-hidden`}
      >
        {/* The arrow rides on the profile itself, opposite the close button
            the modal version of this view draws — it used to be a labelled
            text button on its own line above the card, which spent a row of a
            phone screen saying what an arrow says. */}
        <Surface preset="nested-card" className="relative flex-1 w-full overflow-hidden flex flex-col">
          <MobilePaneBack onClick={requestPaneClose} label="До списку команди" className="absolute left-[16px] top-[16px] z-20" />
          {membersError ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="flex w-full max-w-[460px] flex-col gap-3">
                <Alert
                  variant="error"
                  title={dataFailure.title}
                  description={dataFailure.description}
                />
                <Button onClick={() => window.location.reload()} style="secondary" size="sm">
                  Спробувати ще раз
                </Button>
              </div>
            </div>
          ) : selectedMember ? (
            <ProfileView user={selectedMember} />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-white h-full">
              <EmptyState
                icon={User}
                title="Оберіть учасника"
                description="Виберіть когось зі списку ліворуч, щоб переглянути його профіль."
              />
            </div>
          )}
        </Surface>
      </div>
    </SidebarLayout>
  );
}
