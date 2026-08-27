'use client';

import { Briefcase, Crown, Shield, UserRound, UserRoundCheck, UserRoundX } from 'lucide-react';
import Dialog from '@/components/ui/Dialog';
import Button from '@/components/ui/Button';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import Pill from '@/components/ui/DataDisplay/Pill';
import OptionCard from '@/components/ui/Forms/OptionCard';
import { isActiveMember } from '@/lib/utils/orgMembership.mjs';

const ROLES = [
  { value: 'member', label: 'Учасник', description: 'Працює з інцидентами та проєктами.', icon: UserRound },
  { value: 'admin', label: 'Адміністратор', description: 'Керує командою та налаштуваннями.', icon: Shield },
];

export default function TeamMemberSettingsDialog({
  member,
  positions = [],
  currentUserId,
  isOwner,
  isAdmin,
  canManageRoles = isAdmin,
  canTransferOwnership = isOwner,
  onClose,
  onRoleChange,
  onPositionChange,
  onTransferOwnership,
  onDeactivate,
  onReactivate,
}) {
  if (!member) return null;
  const uid = member.id || member.uid;
  const isMe = uid === currentUserId;
  // Administrators promote and demote, the owner seat moves only by transfer,
  // and nobody edits their own role — that last one is what stops the last
  // administrator from locking the organization out of its own settings.
  // A deactivated seat has no membership document to write to, so its role and
  // position are frozen until the access comes back carrying them.
  const isDeactivated = !isActiveMember(member);
  const canChangeRole = canManageRoles && !isMe && member.role !== 'owner' && !isDeactivated;
  const roleHint = member.role === 'owner'
    ? 'Роль власника фіксована'
    : isDeactivated ? 'Спершу поверніть доступ'
    : isMe ? 'Свою роль змінити не можна' : 'Потрібні права адміністратора';
  const canChangePosition = isAdmin && !isDeactivated;

  return (
    <Dialog isOpen onClose={onClose} title="Налаштування учасника" size="md">
      <div className="flex flex-col gap-7">
        <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface flex items-center gap-3">
          <UserAvatar user={member} size="xl" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">{member.name || member.email}</p>
            <p className="truncate text-[12px] text-muted">{member.email}</p>
          </div>
          {isMe && <Pill tone="surface" size="lg" uppercase className="ml-auto">Ви</Pill>}
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Роль і доступ</p>
            {!canChangeRole && <span className="text-[10px] text-faint">{roleHint}</span>}
          </div>
          <div className="grid gap-2">
            {member.role === 'owner' ? (
              <OptionCard selected icon={Crown} title="Власник" description="Повний контроль над організацією." disabled />
            ) : ROLES.map(role => (
              <OptionCard
                key={role.value}
                selected={member.role === role.value}
                icon={role.icon}
                title={role.label}
                description={role.description}
                disabled={!canChangeRole}
                onClick={() => onRoleChange(uid, role.value)}
              />
            ))}
          </div>
          {canTransferOwnership && !isMe && member.role !== 'owner' && (
            <Button
              style="secondary"
              size="md"
              icon={Crown}
              onClick={() => onTransferOwnership(uid)}
              className="mt-3 w-full"
            >
              Передати права власника
            </Button>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted">Посада</p>
            {!canChangePosition && <span className="text-[10px] text-faint">{isDeactivated ? 'Спершу поверніть доступ' : 'Потрібні права адміністратора'}</span>}
          </div>
          <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            <OptionCard
              selected={!member.positionId}
              icon={Briefcase}
              title="Без посади"
              disabled={!canChangePosition}
              onClick={() => onPositionChange(uid, '')}
            />
            {positions.map(position => (
              <OptionCard
                key={position.id}
                selected={member.positionId === position.id}
                icon={Briefcase}
                title={position.label}
                disabled={!canChangePosition}
                onClick={() => onPositionChange(uid, position.id)}
              />
            ))}
          </div>
        </section>

        {isAdmin && !isMe && member.role !== 'owner' && (
          <div className="border-t border-line pt-5">
            {isDeactivated ? (
              <>
                <p className="mb-3 text-[12px] leading-relaxed text-muted">
                  Доступ забрано. Задачі, коментарі й записаний час лишились за цією людиною —
                  повернення віддає ту саму роль, посаду і проєкти.
                </p>
                <Button
                  style="outline"
                  size="md"
                  icon={UserRoundCheck}
                  onClick={() => onReactivate(uid)}
                  className="w-full"
                >
                  Повернути доступ
                </Button>
              </>
            ) : (
              <>
                <p className="mb-3 text-[12px] leading-relaxed text-muted">
                  Людина втратить доступ до організації та її проєктів. Усе, що вона зробила,
                  лишиться на місці — доступ можна повернути будь-коли.
                </p>
                <Button
                  style="outline"
                  color="red"
                  size="md"
                  icon={UserRoundX}
                  onClick={() => onDeactivate(uid)}
                  className="w-full"
                >
                  Забрати доступ
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
