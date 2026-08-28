'use client';

import { useCallback, useState } from 'react';
import { Check, Copy, Link2 } from 'lucide-react';
import { Button, Surface, TextAction } from '@/components/ui';
import { createInviteLink, revokeInviteLink } from '@/lib/services/inviteLinks';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';

/**
 * A link into one client space, for people whose address you do not have.
 *
 * The email invitation needs the invitee's exact Google address up front, which
 * is the wrong shape for a client administrator adding four colleagues they
 * only know by name. This is the same access, offered the other way round:
 * created on demand, copied into a messenger, expiring on its own, and
 * countable — the tenant knows how many seats it can still open.
 *
 * It is deliberately not a listing. The raw token exists only in the response
 * that created it, so a link that is not copied while it is on screen is gone;
 * showing a list of links nobody can copy would be showing a control that does
 * not work. Revoking works from here because the id does come back.
 *
 * @param {'client_admin'|'client_member'} props.role The seat the link opens. The server re-derives it from the author's own membership and refuses anything internal; this only labels it.
 * @param {string} props.projectId The one client space the link is fixed to.
 * @param {string} props.description What this particular link is for, in the words of the screen it sits on.
 * @param {'card'|'nested-card'} props.surface Which concentric step this sits on: `card` beside the settings directory, `nested-card` inside the client space's «Люди» panel.
 */
export default function InviteLinkSection({
  role,
  projectId,
  description,
  surface = 'card',
}) {
  const { activeOrgId } = useAppContext();
  const showToast = useWorkspaceStore(state => state.showToast);
  const [link, setLink] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = useCallback(async () => {
    if (!activeOrgId || !projectId || busy) return;
    setBusy(true);
    try {
      setLink(await createInviteLink({ organizationId: activeOrgId, projectId, role }));
      setCopied(false);
    } catch (error) {
      showToast(error.message || 'Не вдалося створити посилання', 'error');
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, busy, projectId, role, showToast]);

  const revoke = useCallback(async () => {
    if (!activeOrgId || !link?.id || busy) return;
    setBusy(true);
    try {
      await revokeInviteLink({ organizationId: activeOrgId, linkId: link.id });
      setLink(null);
      showToast('Посилання відкликано', 'success');
    } catch (error) {
      showToast(error.message || 'Не вдалося відкликати посилання', 'error');
    } finally {
      setBusy(false);
    }
  }, [activeOrgId, busy, link, showToast]);

  const copy = useCallback(async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      showToast('Посилання скопійовано', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Не вдалося скопіювати — виділіть адресу вручну', 'error');
    }
  }, [link, showToast]);

  const expiryLabel = link
    ? new Date(link.expiresAt).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })
    : '';

  return (
    <Surface preset={surface} padding="md" className="mt-4">
      <div className="flex items-start gap-3">
        <span className="mt-[2px] shrink-0 text-muted" aria-hidden>
          <Link2 size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-ink">Посилання-запрошення</p>
          <p className="mt-1 text-[12px] leading-5 text-muted">{description}</p>

          {link ? (
            <>
              {/* The address itself, selectable and wrapping: it is long, and a
                  truncated link somebody cannot read is a link they cannot check
                  before they paste it into a client's chat. */}
              <p className="mt-3 break-all rounded-[10px] border border-dashed border-line bg-canvas px-3 py-2 text-[12px] font-medium text-muted select-all">
                {link.url}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  style="primary"
                  size="md"
                  icon={copied ? Check : Copy}
                  onClick={copy}
                >
                  {copied ? 'Скопійовано' : 'Копіювати посилання'}
                </Button>
                <TextAction tone="danger" size="md" onClick={revoke} disabled={busy}>
                  Відкликати
                </TextAction>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Роль зафіксована: <strong className="text-ink">{organizationRoleLabel(link.role)}</strong>.
                Діє до {expiryLabel} · до {link.maxUses} входів.
                Змінити роль або простір після створення неможливо.
              </p>
            </>
          ) : (
            <Button
              style="secondary"
              size="md"
              icon={Link2}
              onClick={create}
              loading={busy}
              className="mt-3"
            >
              Створити посилання
            </Button>
          )}
        </div>
      </div>
    </Surface>
  );
}
