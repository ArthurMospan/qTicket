'use client';

import { UserPlus, Users } from 'lucide-react';
import FormGroup from '@/components/ui/Forms/FormGroup';
import LoadingSpinner from '@/components/ui/Feedback/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Forms/Textarea';
import Label from '@/components/ui/Forms/Label';
import { MultiSelect } from '@/components/ui/Select';
import StatusVisibilityPicker from './StatusVisibilityPicker';

// Shared body for creating and configuring a client space. Both dialogs edit
// exactly the same project fields, so they render the same form — only the title,
// the footer buttons and the optional danger zone differ.
/**
 * Shared body for «Новий проєкт» and «Налаштування проєкту». Both dialogs edit
 * the same project fields, so they render the same form — only the title, the
 * footer buttons and the optional danger zone differ.
 *
 * @param {string} props.name Project name.
 * @param {(value: string) => void} props.onNameChange Fires with the new name.
 * @param {string} props.nameError Validation message under the name field.
 * @param {string} props.description Project description.
 * @param {(value: string) => void} props.onDescriptionChange Fires with the new description.
 * @param {object[]} props.statuses The workflow's statuses.
 * @param {string[]} props.hiddenStatusIds Statuses folded away on the board.
 * @param {(ids: string[]) => void} props.onHiddenStatusIdsChange Fires with the new hidden list.
 * @param {string} props.backlogStatusId The status that may never be hidden.
 * @param {object[]} props.teamMembers Everybody who could be added to the project.
 * @param {string[]} props.teamMemberIds Who is on it now.
 * @param {(ids: string[]) => void} props.onTeamMemberIdsChange Fires with the new team; the owner is put back if dropped.
 * @param {string} props.ownerId The project's author, who cannot be removed from it.
 * @param {string} props.teamHint Sentence under the team picker.
 * @param {string} props.teamPlaceholder Placeholder for that picker.
 * @param {string} props.inviteEmails Inline invitations, one email per line, sent with the form.
 * @param {(value: string) => void} props.onInviteEmailsChange Fires with the edited list; its presence is what enables inline invites.
 * @param {string} props.inviteEmailsError Validation message for that list.
 * @param {string} props.inviteEmailsHint Sentence under that list; says when the invitations go out.
 * @param {boolean} props.loading Busy: the form is saving and its controls are blocked.
 * @param {React.ReactNode} props.dangerZone Delete-project block; only the settings dialog passes one.
 */
export default function ProjectSettingsForm({
  name,
  onNameChange,
  nameError,
  description,
  onDescriptionChange,
  statuses = [],
  hiddenStatusIds = [],
  onHiddenStatusIdsChange,
  backlogStatusId,
  teamMembers = [],
  teamMemberIds = [],
  onTeamMemberIdsChange,
  ownerId,
  teamHint = 'Власник проєкту буде доданий до команди підтримки автоматично.',
  teamPlaceholder = 'Оберіть працівників підтримки',
  // Inline invitations, one email per line, sent when the surrounding form is
  // submitted. This is the only way either dialog invites anybody. Project
  // settings used to open the full invite dialog on top of itself instead — so
  // the same form offered two different affordances for the same act depending
  // on which dialog was hosting it, and the settings one could not attach the
  // project the user was standing in.
  inviteEmails,
  onInviteEmailsChange,
  inviteEmailsError = '',
  inviteEmailsHint = 'Клієнтів запрошують після створення проєкту у вкладці «Учасники».',
  loading = false,
  dangerZone = null,
}) {
  const showTeamSettings = teamMembers.length > 0 && typeof onTeamMemberIdsChange === 'function';
  const showInlineInvite = typeof onInviteEmailsChange === 'function';

  const memberOptions = teamMembers.flatMap(member => {
    const userId = member.id || member.uid;
    if (!userId) return [];
    return [{
      value: userId,
      label: member.name || member.displayName || member.email || 'Учасник',
      user: member,
    }];
  });

  // The owner can never be dropped from their own project, so a deselect that
  // would remove them is silently corrected instead of rejected.
  const handleTeamChange = next => {
    onTeamMemberIdsChange(
      ownerId && !next.includes(ownerId) && teamMemberIds.includes(ownerId)
        ? [...next, ownerId]
        : next,
    );
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <FormGroup label="Назва клієнта" required error={nameError}>
        <Input
          value={name}
          onChange={event => onNameChange?.(event.target.value)}
          placeholder="Наприклад: ТОВ «Альфа»"
          composition="project-name"
          error={Boolean(nameError)}
        />
      </FormGroup>

      <FormGroup label="Контекст клієнта">
        <Textarea
          value={description}
          onChange={event => onDescriptionChange?.(event.target.value)}
          rows={3}
          placeholder="Коротко про клієнта, його продукт і домовленості підтримки..."
          composition="project-description"
        />
      </FormGroup>

      {showTeamSettings ? (
        <FormGroup label="Команда підтримки">
          <div className="flex items-center gap-2">
            <MultiSelect
              value={teamMemberIds}
              onChange={handleTeamChange}
              options={memberOptions}
              placeholder={teamPlaceholder}
              searchPlaceholder="Знайти учасника..."
              className="min-w-0 flex-1"
              dropdownClassName="w-full max-w-none"
              triggerIcon={Users}
              selectAllLabel="Вибрати всіх учасників"
              showSelectedAvatars
              footer={showInlineInvite ? (
                <div className="flex flex-col gap-[6px]">
                  <Label icon={UserPlus}>Запросити по email</Label>
                  <Textarea
                    value={inviteEmails}
                    onChange={event => onInviteEmailsChange(event.target.value)}
                    rows={3}
                    placeholder={'ivan@company.com\nolena@company.com'}
                    error={Boolean(inviteEmailsError)}
                  />
                  <p className={`text-[11px] ${inviteEmailsError ? 'text-danger' : 'text-muted'}`}>
                    {inviteEmailsError || inviteEmailsHint}
                  </p>
                </div>
              ) : null}
            />
          </div>
          {teamHint ? <p className="mt-1.5 text-[11px] text-muted">{teamHint}</p> : null}
        </FormGroup>
      ) : null}

      <FormGroup label="Етапи звернень">
        <p className="text-[11px] text-muted">
          Оберіть етапи, потрібні цьому клієнту. «Новий» залишається видимим завжди.
          Звернення з прихованих етапів будуть перенесені у «Новий» після підтвердження.
        </p>
        {loading ? (
          <div className="flex justify-center py-4">
            <LoadingSpinner size="sm" />
          </div>
        ) : (
          <StatusVisibilityPicker
            statuses={statuses}
            hiddenStatusIds={hiddenStatusIds}
            onChange={onHiddenStatusIdsChange}
            backlogStatusId={backlogStatusId}
          />
        )}
      </FormGroup>

      {dangerZone}
    </div>
  );
}
