'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Link2, Loader2, QrCode } from 'lucide-react';
import { Button, Surface, TextAction } from '@/components/ui';
import { createInviteLink, revokeInviteLink } from '@/lib/services/inviteLinks';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { organizationRoleLabel } from '@/lib/utils/orgMembership.mjs';

/**
 * The «Посилання» half of the invitation dialog — the same two-panel shape
 * QuickTeam has shown for a year: the address on the left, its QR code on the
 * right, one tab away from the email field rather than a second control sitting
 * somewhere else on the page.
 *
 * The email invitation needs the invitee's exact Google address up front, which
 * is the wrong shape for a client administrator adding four colleagues they
 * only know by name. This is the same access, offered the other way round:
 * minted when the tab is first opened, copied into a messenger, expiring on its
 * own, and countable.
 *
 * It is deliberately not a listing. The raw token exists only in the response
 * that created it, so a link that is not copied while it is on screen is gone;
 * a list of links nobody can copy would be a control that does not work.
 * Revoking works from here because the id does come back.
 *
 * @param {'client_admin'|'client_member'} props.role The seat the link opens. The server re-derives it from the author's own membership and refuses anything internal; this only labels it.
 * @param {string} props.projectId The one client space the link is fixed to.
 * @param {string} props.spaceName The client space's own name, for the downloaded QR file.
 */
export default function InviteLinkSection({ role, projectId, spaceName = '' }) {
  const { activeOrgId } = useAppContext();
  const showToast = useWorkspaceStore(state => state.showToast);
  const [link, setLink] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);

  const create = useCallback(async () => {
    if (!activeOrgId || !projectId) return;
    setCreating(true);
    setLink(null);
    setQrDataUrl('');
    setCopied(false);
    try {
      const created = await createInviteLink({ organizationId: activeOrgId, projectId, role });
      setLink(created);
      // Imported here rather than at the top: a QR code is drawn once, after a
      // link exists, and this function was already async.
      const { default: QRCode } = await import('qrcode');
      setQrDataUrl(await QRCode.toDataURL(created.url, {
        width: 560,
        margin: 2,
        color: { dark: '#1f1f1f', light: '#ffffff' },
      }));
    } catch (error) {
      showToast(error.message || 'Не вдалося створити посилання', 'error');
    } finally {
      setCreating(false);
    }
  }, [activeOrgId, projectId, role, showToast]);

  // Minted when this tab is first shown, not when the dialog opens: somebody
  // who only wanted the email field should not leave a live link behind them.
  useEffect(() => {
    queueMicrotask(create);
    // A fixed role or a different client space is a different link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, projectId, role]);

  const revoke = useCallback(async () => {
    if (!activeOrgId || !link?.id || revoking) return;
    setRevoking(true);
    try {
      await revokeInviteLink({ organizationId: activeOrgId, linkId: link.id });
      setLink(null);
      setQrDataUrl('');
      showToast('Посилання відкликано', 'success');
    } catch (error) {
      showToast(error.message || 'Не вдалося відкликати посилання', 'error');
    } finally {
      setRevoking(false);
    }
  }, [activeOrgId, link, revoking, showToast]);

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

  const downloadQr = () => {
    if (!qrDataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = qrDataUrl;
    anchor.download = `invite-${String(spaceName || 'client').replace(/\s+/g, '-')}.png`;
    anchor.click();
  };

  if (creating || !link) {
    return (
      <div className="flex min-h-[250px] items-center justify-center rounded-[16px] bg-canvas">
        <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <Loader2 size={16} className="animate-spin" />
          Створюємо безпечне запрошення…
        </div>
      </div>
    );
  }

  const expiryLabel = new Date(link.expiresAt)
    .toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <Surface preset="panel" padding="md" className="flex min-w-0 flex-col justify-between gap-5">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink">
              <Link2 size={15} />
            </span>
            <div>
              <p className="text-[13px] font-bold text-ink">Посилання-запрошення</p>
              <p className="text-[11px] text-muted">Діє до {expiryLabel} · до {link.maxUses} входів</p>
            </div>
          </div>
          {/* The address itself, selectable and wrapping: it is long, and a
              truncated link somebody cannot read is a link they cannot check
              before they paste it into a client's chat. */}
          <Surface preset="nested-card" padding="sm" className="mt-4">
            <p className="break-all px-2 py-1 text-[12px] font-medium text-muted select-all">{link.url}</p>
            <Button
              style="primary"
              size="lg"
              icon={copied ? Check : Copy}
              onClick={copy}
              className="mt-1 w-full"
            >
              {copied ? 'Скопійовано' : 'Копіювати посилання'}
            </Button>
          </Surface>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] leading-5 text-muted">
            Роль зафіксована: <strong className="text-ink">{organizationRoleLabel(link.role)}</strong>.
            Змінити роль або проєкт після створення неможливо.
          </p>
          <TextAction tone="danger" size="md" onClick={revoke} disabled={revoking}>
            Відкликати
          </TextAction>
        </div>
      </Surface>

      <Surface preset="bordered-card" padding="md" className="flex flex-col items-center justify-center">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-ink">
          <QrCode size={14} />
          QR-код
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt="QR-код запрошення до проєкту" className="h-[172px] w-[172px]" />
        <TextAction tone="muted" size="sm" icon={Download} onClick={downloadQr} className="mt-2">
          Завантажити PNG
        </TextAction>
      </Surface>
    </div>
  );
}
