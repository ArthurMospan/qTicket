'use client';

// src/app/workspace/team/page.js
import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { isActiveMember, organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';
import { can, isClientRole } from '@/lib/utils/can';
import { isOnProjectTeam } from '@/lib/utils/projectAccess.mjs';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useMobilePaneBack } from '@/lib/hooks/useMobilePaneBack';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { Plus, User } from 'lucide-react';
import {
  Surface,
  EmptyState,
  Button,
  Alert,
  MobilePaneBack,
  SidebarLayout,
  MemberRail,
} from '@/components/ui';
import ProfileView from '@/components/profile/ProfileView';
import InviteMemberDialog from '@/components/InviteMemberDialog';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';

// ── Main Page ────────────────────────────────────────────────────────────────
// One roster screen, and it knows who is looking.
//
// For the support team it is a roster and only a roster. Who holds a qTicket
// seat is decided in QuickTeam — «Налаштування» → «Інтеграції» → «qTicket» —
// and re-sent whole on the next provisioning sync, so this screen has no
// invite, no role picker and no way to take a seat away: every one of them
// would be a second place to change one setting, and the qTicket copy is the
// one the next snapshot overwrites.
//
// For a `client_admin` the same screen lists their own employees, and there it
// does carry an invitation, because that directory is qTicket's own: nobody
// else administers a customer's people. It used to be «Налаштування» →
// «Співробітники клієнта», reached from a rail entry that also said
// «Співробітники» — one address, named twice on one screen. A `client_member`
// never arrives here at all; the client boundary in `clientPortalRoutes.mjs`
// answers that, so this file holds no second opinion about it.
export default function TeamPage() {
  const { currentUser, orgRole, projects } = useAppContext();
  const { members, loading, error: membersError, inviteMember } = useOrganization();
  const { positions = [] } = useWorkflowConfig();

  const clientViewer = isClientRole(orgRole);
  const currentUserId = currentUser?.uid || currentUser?.id;
  // A client belongs to exactly one space, and that space is the roster's
  // scope: the directory a `client_admin` administers is the people on it, not
  // every client role the member API happened to answer with.
  const clientSpace = useMemo(() => (clientViewer
    ? (projects || []).find(project => (
      project.status !== 'archived' && isOnProjectTeam(project, currentUserId)
    )) || null
    : null), [clientViewer, currentUserId, projects]);
  const canInviteEmployees = orgRole === 'client_admin'
    && can(orgRole, 'invite:client_member')
    && Boolean(clientSpace);
  const [showInvite, setShowInvite] = useState(false);

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

  // The roster of record, and the whole of it. Somebody whose seat QuickTeam
  // switched off keeps their name on every request they answered, every comment
  // they wrote and every audit line they caused, so a directory that lists only
  // active people turns all of that into an unknown id — which is why this list
  // is deliberately not `activeMembers`. They sort last and the row says so.
  // Pickers stay on `activeMembers`: you cannot hand work to somebody who can
  // no longer sign in. This screen is not a picker. The client's half of the
  // directory is filtered the same way, for the same reason.
  const teamMembers = useMemo(() => (Array.isArray(members) ? members : [])
    .filter(member => (clientViewer
      ? isClientRole(member.role) && isOnProjectTeam(clientSpace, member.id || member.uid)
      : !isClientRole(member.role)))
    .map(member => ({
      ...member,
      inactive: !isActiveMember(member),
      positionName: positions.find(position => position.id === member.positionId)?.label
        || member.title
        || organizationRoleLabel(member.role),
    }))
    .sort((left, right) => Number(left.inactive) - Number(right.inactive)),
  [clientSpace, clientViewer, members, positions]);

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
      sidebar={(
          <MemberRail
            title={clientViewer ? 'Співробітники' : 'Команда'}
            members={filteredMembers}
            activeId={selectedUid}
            onSelect={member => { setSelectedUid(member.id || member.uid); setMobilePane('detail'); }}
            loading={loading}
            emptyTitle={clientViewer ? 'Ще нікого немає' : 'Нікого не знайдено'}
            emptyDescription={clientViewer
              ? 'Запросіть співробітника — і він побачить звернення цього простору.'
              : 'Спробуйте змінити пошуковий запит.'}
            action={canInviteEmployees ? (
              <Button
                style="ghost"
                size="icon-xs"
                icon={Plus}
                onClick={() => setShowInvite(true)}
                title="Запросити співробітника"
                aria-label="Запросити співробітника"
              />
            ) : null}
          />
      )}
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
          <MobilePaneBack
            onClick={requestPaneClose}
            label={clientViewer ? 'До списку співробітників' : 'До списку команди'}
            className="absolute left-[16px] top-[16px] z-20"
          />
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
                title={clientViewer ? 'Оберіть співробітника' : 'Оберіть учасника'}
                description={canInviteEmployees && teamMembers.length === 0
                  ? 'Поки що у вашому просторі немає інших співробітників. Натисніть «+» біля заголовка, щоб запросити першого.'
                  : 'Виберіть когось зі списку ліворуч, щоб переглянути його профіль.'}
              />
            </div>
          )}
        </Surface>
      </div>

      {/* The employee invitation, in the one place that administers employees.
          The same dialog the client space uses for its administrator: an email
          on one tab and a link with its QR code on the other, and the role it
          may issue is fixed to `client_member` by the dialog, by the invitation
          route and by `firestore.rules` — not by this screen. */}
      {canInviteEmployees && (
        <InviteMemberDialog
          isOpen={showInvite}
          onClose={() => setShowInvite(false)}
          inviteMember={inviteMember}
          clientMode
          projectIds={[clientSpace.id]}
          spaceName={clientSpace.name}
        />
      )}
    </SidebarLayout>
  );
}
