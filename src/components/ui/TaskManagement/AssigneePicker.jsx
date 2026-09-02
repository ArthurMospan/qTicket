'use client';

import { useEffect, useId, useState } from 'react';
import { Check } from 'lucide-react';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';

// ─── UI Kit: Assignee Picker ─────────────────────────────────────────────────
// Who takes this request, asked at the one moment the answer matters.
//
// It is the sibling of `StatusTransitionPicker` and deliberately reads like it:
// a request is mid-move, the move cannot finish until one question is answered,
// and the dialog answers it in the vocabulary of the thing being moved rather
// than in a form. There the choices are columns; here they are people, so they
// are faces — a support team is four to ten people who know each other, and a
// row of names in a select is the wrong shape for «хто вільний».
//
// The selected state is the outline the brand colour picker uses — 2px of ink,
// offset by 2 — because that is what «this one is chosen» already looks like in
// this product, and a tick on the face says the same thing a second way for
// anybody who cannot separate the ring from the ground.
//
// Multi-select, and that is not a hedge: a request can genuinely be two
// people's, and the field behind it is an array on every other screen.

/**
 * Picks one or more people from the support team.
 *
 * @param {boolean} props.isOpen Whether the dialog is visible.
 * @param {string} props.issueKey The request being moved, named in the title.
 * @param {string} props.statusLabel Where it is going, named in the confirm button.
 * @param {object[]} props.members Who may be chosen — the desk, already filtered by the caller. Each row shows `positionName`, then `title`, then the role.
 * @param {string[]} props.initialSelected Anyone already on the request.
 * @param {(userIds: string[]) => void} props.onConfirm Confirms the people and lets the move finish.
 * @param {() => void} props.onClose Abandons the move; the request stays where it was.
 * @param {boolean} props.busy Whether the move is being saved.
 */
export default function AssigneePicker({
  isOpen,
  issueKey = 'Звернення',
  statusLabel = '',
  members = [],
  initialSelected = [],
  onConfirm,
  onClose,
  busy = false,
}) {
  const groupName = useId();
  const [selected, setSelected] = useState(initialSelected);

  useEffect(() => {
    if (!isOpen) return;
    queueMicrotask(() => setSelected(initialSelected));
    // Reopening the dialog is a fresh question; the array identity of the
    // caller's list is not what decides that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const toggle = userId => setSelected(current => (
    current.includes(userId)
      ? current.filter(id => id !== userId)
      : [...current, userId]
  ));

  return (
    <Dialog
      isOpen={isOpen}
      onClose={busy ? undefined : onClose}
      presentation="dialog"
      titleContext="dialog"
      title={`Хто візьме ${issueKey}?`}
      description={statusLabel
        ? `Звернення переходить у «${statusLabel}» — оберіть, хто за нього відповідає.`
        : 'Звернення виходить із «Новий» — оберіть, хто за нього відповідає.'}
      size="lg"
      bodyPadding="flush"
      footer={(
        <>
          <Button style="secondary" size="md" disabled={busy} onClick={onClose}>
            Скасувати
          </Button>
          <Button
            style="primary"
            size="md"
            loading={busy}
            disabled={selected.length === 0}
            onClick={() => selected.length > 0 && onConfirm?.(selected)}
          >
            {selected.length > 1 ? `Призначити (${selected.length})` : 'Призначити'}
          </Button>
        </>
      )}
    >
      <div className="px-5 py-5 sm:px-6">
        {members.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted">
            У цьому проєкті ще немає працівників підтримки.
          </p>
        ) : (
          <div
            className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-5"
            role="group"
            aria-label="Відповідальні за звернення"
          >
            {members.map(member => {
              const userId = member.id || member.uid;
              const active = selected.includes(userId);
              return (
                <label
                  key={userId}
                  className={`flex flex-col items-center text-center ${busy ? 'cursor-wait' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    name={groupName}
                    value={userId}
                    checked={active}
                    disabled={busy}
                    onChange={() => toggle(userId)}
                    className="peer sr-only"
                  />
                  <span
                    data-ui-control="assignee-choice"
                    data-ui-state={active ? 'selected' : 'idle'}
                    className="ui-native-control"
                  >
                    <UserAvatar user={member} size="assignee-choice" />
                    <span data-ui-part="tick">{active ? <Check size={13} /> : null}</span>
                  </span>
                  <span className="mt-[10px] block w-full truncate text-[13px] font-semibold text-ink">
                    {member.name || member.email || 'Учасник'}
                  </span>
                  {/* Their job, and the role is the floor of it: a desk of
                      four «Учасник»s is not a useful line, but a desk where two
                      people have filled «Посада» in and two have not must not
                      show two blank rows and shuffle the grid. Resolved here so
                      both call sites say the same thing. */}
                  <span className="mt-[2px] block w-full truncate text-[11px] text-muted">
                    {member.positionName || member.title || organizationRoleLabel(member.role)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
