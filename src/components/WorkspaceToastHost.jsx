'use client';
// src/components/WorkspaceToastHost.jsx
// Store connector: reads the toast from useWorkspaceStore and renders it
// through the ui-kit Toast (single source of truth for the toast visuals).
import { useCallback } from 'react';
import { useAppContext } from '@/lib/context/AppContext';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import UiToast from '@/components/ui/Feedback/Toast';
import { reportError } from '@/lib/services/errorReports';

export default function WorkspaceToastHost() {
  const toast = useWorkspaceStore(s => s.toast);
  const clearToast = useWorkspaceStore(s => s.clearToast);
  const showToast = useWorkspaceStore(s => s.showToast);
  const { activeOrgId } = useAppContext();

  const message = typeof toast === 'string' ? toast : toast?.message;
  const detail = typeof toast === 'string' ? '' : toast?.detail;
  const context = typeof toast === 'string' ? '' : toast?.context;

  // What the reader saw, what actually happened, and where. Sending it is one
  // click because a failure the user has to describe is a failure that never
  // gets described.
  const send = useCallback(async () => {
    try {
      await reportError({
        organizationId: activeOrgId,
        message,
        detail,
        context,
        path: typeof window === 'undefined' ? '' : window.location.pathname + window.location.search,
      });
      // Nowhere to send anybody afterwards: the reports are read on /errors,
      // which is not a workspace screen and belongs to whoever holds its
      // password rather than to a role inside this organization.
      showToast('Дякуємо — звіт надіслано', 'success');
    } catch {
      showToast('Не вдалося надіслати звіт', 'error', { context: 'error-report' });
    }
  }, [activeOrgId, context, detail, message, showToast]);

  if (!toast) return null;

  const variant = toast.type || 'success';

  return (
    <UiToast
      key={toast.id || message}
      variant={variant}
      message={message}
      action={toast.action?.label}
      onAction={toast.action?.onClick}
      // Only where there is somewhere to send it, and never for the toast that
      // confirms a report — otherwise a failed report offers to report itself.
      onReport={activeOrgId && context !== 'error-report' ? send : undefined}
      autoClose={false}
      onClose={clearToast}
    />
  );
}
