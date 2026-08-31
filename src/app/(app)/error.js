'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, DatabaseZap, RotateCcw, Send } from 'lucide-react';
import Button from '@/components/ui/Button';
import TextAction from '@/components/ui/TextAction';
import { reportError } from '@/lib/services/errorReports';
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
  const [reportState, setReportState] = useState('idle');

  useEffect(() => {
    console.error('[WorkspaceError]', error);
    queueMicrotask(() => setQuotaSpent(
      isQuotaExceededError(error) || isQuotaExceededError(error?.cause) || isQuotaRefused(),
    ));
  }, [error]);

  // Until now this boundary's entire record of a failure was that
  // `console.error` above — a line in a browser nobody was watching. So the one
  // question anybody can ask about «qTicket не завантажився» («що саме впало?»)
  // had no answer anywhere, and the screen said «Дані не вдалося відрендерити»,
  // which is a guess about the cause and usually the wrong one.
  //
  // The product already has somewhere to put this: `reportError`, the route
  // behind it, and `/errors` where the reports are read. The toast has used it
  // for a while; the boundary — the one place that catches the failures nobody
  // can describe afterwards — did not.
  //
  // The organization comes from the same session storage the switcher writes,
  // because the context that would normally hold it is what just died. Without
  // one the route cannot authorize the report, and the button stands down
  // rather than failing on press.
  const organizationId = typeof window === 'undefined'
    ? ''
    : (() => {
      try { return window.sessionStorage.getItem('qt_active_org_id') || ''; } catch { return ''; }
    })();

  const sendReport = useCallback(async () => {
    setReportState('sending');
    try {
      await reportError({
        organizationId,
        message: 'qTicket не завантажився',
        // The stack is the whole point of sending it. `digest` is what a
        // production build gives instead, and it is what the server log can be
        // grepped for, so both go.
        detail: [error?.message, error?.digest, error?.stack].filter(Boolean).join('\n').slice(0, 4000),
        context: 'workspace-error-boundary',
        path: window.location.pathname + window.location.search,
      });
      setReportState('sent');
    } catch {
      setReportState('failed');
    }
  }, [error, organizationId]);

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
            : 'Щось на цьому екрані не завантажилось. Перезавантажте сторінку — якщо повториться, надішліть звіт, і ми побачимо, що саме впало.'}
        </p>
        <Button onClick={() => retry()} style="primary" size="md" icon={RotateCcw}>
          {quotaSpent ? QUOTA_FAILURE_COPY.action : 'Повторити'}
        </Button>

        {/* Only where a report can actually be sent, and never for a spent
            quota: that one is not a defect and there is nothing to look at. */}
        {!quotaSpent && organizationId && (
          <div className="mt-4">
            <TextAction
              tone="muted"
              size="lg"
              icon={reportState === 'sent' ? Check : Send}
              onClick={sendReport}
              disabled={reportState === 'sending' || reportState === 'sent'}
            >
              {reportState === 'sent'
                ? 'Звіт надіслано'
                : reportState === 'failed'
                  ? 'Не вдалося надіслати — спробувати ще раз'
                  : 'Надіслати звіт про помилку'}
            </TextAction>
          </div>
        )}
      </div>
    </div>
  );
}
