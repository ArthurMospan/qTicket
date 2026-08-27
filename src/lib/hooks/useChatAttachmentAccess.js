'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { chatAttachmentUrl } from '@/lib/utils/chatAttachments.mjs';

const EMPTY_ACCESS = { url: '', downloadUrl: '' };

export function useChatAttachmentAccess(attachment) {
  const isPrivate = attachment?.deliveryType === 'authenticated';
  const directUrl = isPrivate ? '' : chatAttachmentUrl(attachment);
  const accessKey = JSON.stringify(attachment?.access || null);
  const [signedAccess, setSignedAccess] = useState({ key: '', ...EMPTY_ACCESS });

  useEffect(() => {
    if (!isPrivate) return undefined;
    const reference = JSON.parse(accessKey);
    if (!reference) return undefined;

    let cancelled = false;
    let refreshTimer;
    const refresh = async () => {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Authentication is required to open attachments');
      const response = await fetch('/api/chat/attachments/access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(reference),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('Attachment access was denied');
      const result = await response.json();
      if (cancelled) return;
      setSignedAccess({
        key: accessKey,
        url: result.url || '',
        downloadUrl: result.downloadUrl || result.url || '',
      });
      const refreshAfterMs = Math.max(30_000, (Number(result.expiresAt) * 1000) - Date.now() - 30_000);
      refreshTimer = window.setTimeout(() => {
        void refresh().catch(() => {
          if (!cancelled) setSignedAccess({ key: accessKey, ...EMPTY_ACCESS });
        });
      }, refreshAfterMs);
    };

    void refresh().catch(() => {
      if (!cancelled) setSignedAccess({ key: accessKey, ...EMPTY_ACCESS });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(refreshTimer);
    };
  }, [accessKey, isPrivate]);

  if (!isPrivate) {
    return directUrl ? { url: directUrl, downloadUrl: directUrl } : EMPTY_ACCESS;
  }
  return signedAccess.key === accessKey ? signedAccess : EMPTY_ACCESS;
}
