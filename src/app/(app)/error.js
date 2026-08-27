'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, DatabaseZap, RotateCcw } from 'lucide-react';
import Button from '@/components/ui/Button';
import { isQuotaExceededError } from '@/lib/utils/errors';
import { isQuotaRefused, QUOTA_FAILURE_COPY } from '@/lib/utils/quotaState.mjs';

// «Дані не вдалося відрендерити» is true of a component that threw and false of
// almost everything that gets a person here. The commonest way this boundary is
// reached in production is a read that Firestore refused because the day's free
// quota is spent: a hook publishes nothing, something downstream reads a field
// off it, and the sentence the reader is shown blames the rendering for a
// database that answered «no».
//
// The boundary asks twice, because the error it was handed is rarely the one
// that started it: the thrown error itself may carry the refusal, and if it
// does not, `reportLoadError` recorded that a read was refused moments ago.
export default function WorkspaceError({ error, unstable_retry, reset }) {
  // Read after mount, never during render: the same boundary is rendered on the
  // server, where this module-level flag is not this browser's, and a value
  // that differs between the two passes is a hydration mismatch.
  const [quotaSpent, setQuotaSpent] = useState(false);

  useEffect(() => {
    console.error('[WorkspaceError]', error);
    queueMicrotask(() => setQuotaSpent(
      isQuotaExceededError(error) || isQuotaExceededError(error?.cause) || isQuotaRefused(),
    ));
  }, [error]);

  const retry = unstable_retry || reset || (() => window.location.reload());
  const Icon = quotaSpent ? DatabaseZap : AlertTriangle;

  return (
    <div className="flex-1 h-full bg-canvas flex items-center justify-center p-6">
      <div data-ui-surface="local" className="w-full max-w-[420px] bg-white border border-line rounded-[16px] p-6 shadow-[0_8px_30px_rgba(0,0,0,0.06)] text-center">
        <div className={`w-[48px] h-[48px] rounded-[14px] flex items-center justify-center mx-auto mb-4 ${
          quotaSpent ? 'bg-warning-soft text-warning' : 'bg-danger-soft text-danger'
        }`}>
          <Icon size={24} />
        </div>
        <h1 className="ui-type-detail-title text-ink mb-2">
          {quotaSpent ? QUOTA_FAILURE_COPY.title : 'qTicket не завантажився'}
        </h1>
        <p className="text-[14px] text-muted leading-relaxed mb-5">
          {quotaSpent
            ? QUOTA_FAILURE_COPY.description
            : 'Дані не вдалося відрендерити. Спробуйте повторити завантаження сторінки.'}
        </p>
        <Button onClick={() => retry()} style="primary" size="md" icon={RotateCcw}>
          {quotaSpent ? QUOTA_FAILURE_COPY.action : 'Повторити'}
        </Button>
      </div>
    </div>
  );
}
