'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Dialog, EmptyState, LoadingSpinner, Select } from '@/components/ui';
import { FolderKanban } from 'lucide-react';
import { fetchQuickTeamProjects, transferIssueToQuickTeam } from '@/lib/services/quickTeamTransfer';
import { userFacingErrorMessage } from '@/lib/utils/errors';

// Where the work goes, asked once, of the person who knows.
//
// The list is QuickTeam's answer about this person, fetched when the dialog
// opens rather than kept: qTicket holds no copy of the neighbouring product's
// projects, and a stale copy is how somebody is offered a place they can no
// longer write to. Nothing is preselected — a default here would put a
// customer's request into whichever project happened to sort first.
export default function QuickTeamTransferDialog({
  isOpen,
  onClose,
  organizationId,
  issueId,
  issueKey,
  onTransferred,
}) {
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState([]);
  const [state, setState] = useState({ configured: true, linked: true });
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!isOpen || !organizationId) return undefined;
    let cancelled = false;
    // Off the render pass: this component's state is downstream of a request,
    // not of the render that started it.
    queueMicrotask(() => {
      if (cancelled) return;
      setLoading(true);
      setError('');
    });
    fetchQuickTeamProjects(organizationId)
      .then(answer => {
        if (cancelled) return;
        setProjects(Array.isArray(answer.projects) ? answer.projects : []);
        setState({ configured: answer.configured !== false, linked: answer.linked !== false });
      })
      .catch(loadError => {
        if (!cancelled) setError(userFacingErrorMessage(loadError, 'Не вдалося отримати список із QuickTeam'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [isOpen, organizationId]);

  useEffect(() => {
    if (isOpen) return;
    queueMicrotask(() => {
      setProjectId('');
      setError('');
      setSending(false);
    });
  }, [isOpen]);

  const submit = useCallback(async () => {
    if (!projectId || sending) return;
    setSending(true);
    setError('');
    try {
      const answer = await transferIssueToQuickTeam(issueId, projectId);
      onTransferred?.(answer);
      onClose?.();
    } catch (submitError) {
      setError(userFacingErrorMessage(submitError, 'Не вдалося перенести звернення'));
      setSending(false);
    }
  }, [issueId, onClose, onTransferred, projectId, sending]);

  const unavailable = !state.configured
    ? 'Звʼязок із QuickTeam не налаштовано на сервері.'
    : !state.linked
      ? 'Ваш акаунт не звʼязаний із QuickTeam.'
      : '';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Перенести в QuickTeam"
      description={issueKey ? `Звернення ${issueKey} лишиться тут і відкритим.` : undefined}
      size="sm"
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button style="secondary" size="md" onClick={onClose}>Скасувати</Button>
          <Button
            style="primary"
            size="md"
            onClick={submit}
            disabled={!projectId || sending || loading || Boolean(unavailable)}
          >
            {sending ? 'Створюємо…' : 'Створити'}
          </Button>
        </div>
      )}
    >
      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <LoadingSpinner size="md" label="Питаємо QuickTeam…" />
        </div>
      ) : unavailable ? (
        <Alert variant="info" title="Перенесення недоступне" description={unavailable} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="Немає куди перенести"
          description="У QuickTeam вас не додано до жодного проєкту, тому створити там завдання нікуди."
          density="compact"
          surface="card"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Select
            value={projectId}
            onChange={setProjectId}
            options={projects.map(project => ({ value: project.id, label: project.name }))}
            placeholder="Оберіть проєкт QuickTeam"
            ariaLabel="Проєкт QuickTeam"
          />
          <p className="text-[12px] leading-5 text-muted">
            У QuickTeam зʼявиться завдання з назвою та описом цього звернення й посиланням на нього.
            Повторне натискання не створює друге — воно відкриє те саме.
          </p>
        </div>
      )}
      {error && <Alert variant="error" title="Не вдалося" description={error} className="mt-3" />}
    </Dialog>
  );
}
