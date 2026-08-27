'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, Link2, Loader2, QrCode } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { Button, TextAction } from '@/components/ui';

export default function InviteLinkSection({ role = 'member' }) {
  const { activeOrgId, activeOrg } = useAppContext();
  const showToast = useWorkspaceStore(state => state.showToast);
  const [link, setLink] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const createLink = useCallback(async () => {
    if (!activeOrgId || creating) return;
    setCreating(true);
    setLink(null);
    setQrDataUrl('');
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/invitations/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ organizationId: activeOrgId, role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не вдалося створити посилання');
      setLink(result);
      // Imported here rather than at the top: a QR code is drawn once, after a
      // link has been created, and this function was already async.
      const { default: QRCode } = await import('qrcode');
      setQrDataUrl(await QRCode.toDataURL(result.url, {
        width: 560,
        margin: 2,
        color: { dark: '#1f1f1f', light: '#ffffff' },
      }));
    } catch (error) {
      showToast(error.message || 'Не вдалося створити посилання', 'error');
    } finally {
      setCreating(false);
    }
  }, [activeOrgId, creating, role, showToast]);

  useEffect(() => {
    queueMicrotask(createLink);
    // A fresh link must be generated when the fixed role changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, role]);

  const copyLink = async () => {
    if (!link?.url) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      showToast('Посилання скопійовано', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Не вдалося скопіювати посилання', 'error');
    }
  };

  const downloadQr = () => {
    if (!qrDataUrl) return;
    const anchor = document.createElement('a');
    anchor.href = qrDataUrl;
    anchor.download = `quickteam-invite-${(activeOrg?.name || 'team').replace(/\s+/g, '-')}.png`;
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

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
      <div data-ui-surface="panel" data-ui-padding="md" className="ui-surface flex min-w-0 flex-col justify-between gap-5">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-ink">
              <Link2 size={15} />
            </span>
            <div>
              <p className="text-[13px] font-bold text-ink">Посилання для запрошення</p>
              <p className="text-[11px] text-muted">Діє 7 днів · до {link.maxUses} використань</p>
            </div>
          </div>
          <div data-ui-surface="local" className="mt-4 rounded-[12px] border border-dashed border-faint bg-white p-2">
            <p className="truncate px-2 py-1 text-[12px] font-medium text-muted">{link.url}</p>
            {/* The confirmation used to be a green fill. The kit's Button has
                two colours — dark and red — and painting a third one on from
                here is exactly the chrome override the drift guard forbids, so
                the confirmation is carried by the tick and the label instead. */}
            <Button
              style="primary"
              size="lg"
              icon={copied ? Check : Copy}
              onClick={copyLink}
              className="mt-1 w-full"
            >
              {copied ? 'Скопійовано' : 'Копіювати посилання'}
            </Button>
          </div>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          Роль зафіксована: <strong className="text-ink">{link.role === 'admin' ? 'Адміністратор' : 'Учасник'}</strong>.
          Змінити її після надсилання посилання неможливо.
        </p>
      </div>

      <div data-ui-surface="bordered-card" data-ui-padding="md" className="ui-surface flex flex-col items-center justify-center">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-bold text-ink">
          <QrCode size={14} />
          QR-код
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrDataUrl} alt="QR-код запрошення до команди" className="h-[172px] w-[172px]" />
        <TextAction tone="muted" size="sm" icon={Download} onClick={downloadQr} className="mt-2">
          Завантажити PNG
        </TextAction>
      </div>
    </div>
  );
}
