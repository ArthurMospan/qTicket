'use client';

import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';
import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import {
  Button,
  Dialog,
  Label,
  ProjectSettingsForm,
  useConfirm,
} from '@/components/ui';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { updateProjectSettings } from '@/lib/services/projects';
import { sendProjectInvitations } from '@/lib/services/projectInvitations';
import {
  failedInvitesMessage,
  malformedEmailsMessage,
  parseInviteEmails,
  undeliveredEmailsMessage,
} from '@/lib/utils/inviteEmails';
import { userFacingErrorMessage } from '@/lib/utils/errors';

// How many tasks are sitting in the columns about to be hidden.
//
// This is a count, so it is asked as a count. It used to be `issues.filter(…)`
// over a prop, which meant every screen that could open this dialog had to be
// holding every task of the project before the dialog existed — and on the home
// screen that was every task of every project, subscribed to permanently, so
// that one confirmation sentence could say a number.
//
// `count()` costs one read per thousand documents and is asked once, when
// somebody presses Save with a column hidden. The set it counts is the set the
// server actually moves (`/api/projects/[projectId]`): everything in those
// columns, archived and cancelled included, because hiding a column moves them
// too.
async function countIssuesInColumns(project, statusIds) {
  if (!project?.id || !project?.organizationId || !statusIds.length) return 0;
  const columns = statusIds.slice(0, 30);
  const snapshot = await getCountFromServer(query(
    collection(db, 'issues'),
    where('organizationId', '==', project.organizationId),
    where('projectId', '==', project.id),
    where('columnId', 'in', columns),
  ));
  return snapshot.data().count || 0;
}

export default function BoardConfigModal({
  project,
  organizationMembers = [],
  canManageTeam = false,
  canInvite = false,
  onArchive,
  onUnarchive,
  onDelete,
  onClose,
}) {
  const showToast = useWorkspaceStore(state => state.showToast);
  const confirm = useConfirm();
  const { statuses, loading } = useWorkflowConfig();
  const { inviteMember } = useOrganization();
  const [name, setName] = useState(project?.name || '');
  const [nameError, setNameError] = useState('');
  const [description, setDescription] = useState(project?.description || '');
  const [hiddenColumns, setHiddenColumns] = useState(
    (project?.hiddenColumns || []).filter(statusId => statusId !== 'backlog'),
  );
  const [teamMemberIds, setTeamMemberIds] = useState(
    Array.isArray(project?.team) ? project.team : [],
  );
  // What the roster was when this dialog opened, kept so the save can be sent
  // as the change it is rather than as the whole list. Both are read once, at
  // mount: a dialog that re-seeded itself from a live project would move the
  // ticks under the reader's hand.
  const [teamBaseline] = useState(
    () => (Array.isArray(project?.team) ? project.team : []),
  );
  const [saving, setSaving] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviteEmailsError, setInviteEmailsError] = useState('');
  const isArchived = project?.status === 'archived';
  const backlogStatusId = statuses.some(status => status.id === 'backlog')
    ? 'backlog'
    : statuses[0]?.id;
  const statusesToHide = useMemo(
    () => hiddenColumns.filter(statusId => statusId !== backlogStatusId),
    [backlogStatusId, hiddenColumns],
  );
  const handleSave = async () => {
    if (!name.trim()) {
      setNameError('Вкажіть назву проєкту');
      return;
    }
    if (statuses.length > 0 && statusesToHide.length >= statuses.length) {
      showToast('Дошка повинна мати хоча б одну видиму колонку', 'error');
      return;
    }
    const { emails: invitees, malformed } = parseInviteEmails(inviteEmails);
    if (malformed.length) {
      setInviteEmailsError(malformedEmailsMessage(malformed));
      return;
    }
    setInviteEmailsError('');

    const newlyHidden = statusesToHide.filter(
      statusId => !(project?.hiddenColumns || []).includes(statusId),
    );
    // Asked here and nowhere else: this is the only moment the number is needed,
    // and asking earlier would mean asking on every checkbox somebody ticks.
    // A failure is not a reason to refuse the save — the sentence loses its
    // number, the confirmation still asks the question.
    let affectedCount = 0;
    if (statusesToHide.length > 0) {
      affectedCount = await countIssuesInColumns(project, statusesToHide)
        .catch(() => 0);
    }
    if (newlyHidden.length > 0 || affectedCount > 0) {
      const hiddenLabels = statuses
        .filter(status => newlyHidden.includes(status.id))
        .map(status => status.label)
        .join(', ');
      const accepted = await confirm({
        title: 'Приховати колонки проєкту?',
        message: affectedCount > 0
          ? `${affectedCount} завд. із прихованих колонок буде перенесено в Беклог. ${hiddenLabels ? `Колонки: ${hiddenLabels}.` : ''}`
          : `Колонки ${hiddenLabels || 'буде приховано'}. Нові завдання з них не залишатимуться поза дошкою.`,
        confirmText: affectedCount > 0 ? 'Приховати й перенести' : 'Приховати',
      });
      if (!accepted) return;
    }

    setSaving(true);
    try {
      const result = await updateProjectSettings(project.id, {
        name: name.trim(),
        description: description.trim(),
        hiddenColumns: statusesToHide,
        // Sent with the baseline it was edited against. Saving the array on its
        // own overwrote the roster with a snapshot taken when the dialog
        // opened, so anybody added to the project in the meantime — from a task
        // that just granted them access, or by somebody else in another tab —
        // was silently dropped by a save that never meant to touch them.
        ...(canManageTeam ? { team: teamMemberIds, teamBaseline } : {}),
      });

      // Settings are already saved, so a refused address is reported in place
      // rather than thrown — it must never read as "the changes were not saved".
      if (invitees.length) {
        const { failures, undelivered } = await sendProjectInvitations(inviteMember, {
          emails: invitees,
          projectId: project.id,
        });
        const problem = failedInvitesMessage(failures) || undeliveredEmailsMessage(undelivered);
        if (problem) {
          setInviteEmailsError(problem);
          setSaving(false);
          return;
        }
      }

      showToast(
        result.movedIssues > 0
          ? `Налаштування збережено, ${result.movedIssues} завд. перенесено в Беклог ✓`
          : 'Налаштування проєкту збережено ✓',
      );
      onClose();
    } catch (error) {
      console.error(error);
      showToast(userFacingErrorMessage(error, 'Помилка збереження'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const accepted = await confirm({
      title: 'Видалити проєкт?',
      message: `Ви видаляєте «${project?.name}». Цю дію неможливо скасувати.`,
      confirmText: 'Видалити',
      danger: true,
    });
    if (!accepted) return;
    try {
      await onDelete(project.id);
      onClose();
    } catch (error) {
      showToast(userFacingErrorMessage(error, 'Не вдалося видалити проєкт'), 'error');
    }
  };

  // Archiving and deleting live at the bottom of the same dialog: they belong to
  // the project's settings, and hiding them behind a separate kebab menu was the
  // reason the settings dialog and the create dialog drifted apart.
  const dangerZone = (onArchive || onDelete) ? (
    <section className="mt-2 border-t border-line pt-4">
      <div className="mb-1"><Label>Небезпечна зона</Label></div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        Архівований проєкт зникає зі списків, але його завдання та історія зберігаються.
        Видалення незворотне.
      </p>
      <div className="flex flex-wrap gap-2">
        {onArchive && !isArchived ? (
          <Button
            style="secondary"
            size="md"
            icon={Archive}
            onClick={async () => {
              if (await onArchive(project.id) !== false) onClose();
            }}
          >
            Архівувати
          </Button>
        ) : null}
        {onUnarchive && isArchived ? (
          <Button
            style="secondary"
            size="md"
            icon={ArchiveRestore}
            onClick={async () => {
              if (await onUnarchive(project.id) !== false) onClose();
            }}
          >
            Розархівувати
          </Button>
        ) : null}
        {onDelete ? (
          <Button style="secondary" color="red" size="md" icon={Trash2} onClick={handleDelete}>
            Видалити проєкт
          </Button>
        ) : null}
      </div>
    </section>
  ) : null;

  return (
    <>
      <Dialog
        isOpen
        onClose={onClose}
        title="Налаштування проєкту"
        size="sm"
        footer={(
          <>
            <Button style="secondary" size="md" onClick={onClose}>
              Скасувати
            </Button>
            <Button
              style="primary"
              size="md"
              onClick={handleSave}
              disabled={saving || loading}
              loading={saving}
            >
              Зберегти зміни
            </Button>
          </>
        )}
      >
        <ProjectSettingsForm
          name={name}
          onNameChange={value => { setName(value); if (nameError) setNameError(''); }}
          nameError={nameError}
          description={description}
          onDescriptionChange={setDescription}
          statuses={statuses}
          hiddenStatusIds={statusesToHide}
          onHiddenStatusIdsChange={setHiddenColumns}
          backlogStatusId={backlogStatusId}
          teamMembers={canManageTeam ? activeMembers(organizationMembers) : []}
          teamMemberIds={teamMemberIds}
          onTeamMemberIdsChange={canManageTeam ? setTeamMemberIds : undefined}
          ownerId={project?.createdBy}
          teamHint="Учасники поза цим списком не бачитимуть проєкт."
          inviteEmails={inviteEmails}
          onInviteEmailsChange={canManageTeam && canInvite ? value => {
            setInviteEmails(value);
            if (inviteEmailsError) setInviteEmailsError('');
          } : undefined}
          inviteEmailsError={inviteEmailsError}
          inviteEmailsHint="Кожен рядок — окрема адреса. Запрошення підуть при збереженні; хто прийме — одразу потрапить і в організацію, і в цей проєкт."
          loading={loading}
          dangerZone={dangerZone}
        />
      </Dialog>
    </>
  );
}
