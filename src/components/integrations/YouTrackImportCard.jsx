'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Search, Upload } from 'lucide-react';
import { Alert, Button, Checkbox, IconAction, Input, Pill, Select, useConfirm } from '@/components/ui';
import IntegrationCard, { IntegrationNote, IntegrationSteps } from '@/components/integrations/IntegrationCard';
import { authenticatedRequest } from '@/lib/services/authenticatedRequest';
import {
  sourceUserId,
  suggestUserMappings,
  suggestYouTrackStatusMappings,
} from '@/lib/utils/youtrackImport.mjs';
import { statusCategoryLabel } from '@/lib/utils/statusCategories.mjs';
import { plural } from '@/lib/utils/plural.mjs';

const ACTIVE_JOB_STATUSES = new Set(['prepared', 'running']);

function memberId(member) {
  return member?.id || member?.uid || member?.userId || '';
}

function statusLabel(status) {
  return {
    prepared: 'Перевірено',
    running: 'Імпортується',
    completed: 'Завершено',
    cancelled: 'Скасовано',
  }[status] || status || 'Не розпочато';
}

// Стан імпорту носить бейдж, а не зелений напис: у продукту одна темна гама, і
// «йде» чи «завершено» — це те, що сталося, а не привід світитися.
const JOB_TONES = {
  prepared: 'neutral',
  running: 'dark',
  completed: 'dark',
  cancelled: 'neutral',
};

function progressFor(job) {
  if (!job?.totalIssues) return job?.status === 'completed' ? 100 : 0;
  return Math.min(100, Math.round(((job.processedIssues + job.failedIssues) / job.totalIssues) * 100));
}

// Підсумок називає лише те, що справді сталося. «Успішно: 0 · Помилок: 0 ·
// Зв'язків: 0» — три нулі, які нічого не повідомляють; кількість перенесених
// задач лишається завжди, бо це і є відповідь на питання «скільки вже».
function jobSummaryParts(job) {
  if (!job) return [];
  const parts = [`Успішно: ${job.processedIssues || 0}`];
  if (job.failedIssues > 0) parts.push(`Помилок: ${job.failedIssues}`);
  if (job.processedLinks > 0) parts.push(`Зв’язків: ${job.processedLinks}`);
  return parts;
}

export default function YouTrackImportCard({
  organizationId,
  currentUserId = '',
  isOrganizationOwner = false,
  members = [],
  projects = [],
  showToast,
  presentation = 'integration',
}) {
  const [connection, setConnection] = useState({ connected: false });
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState('');
  const [discovery, setDiscovery] = useState(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [projectMappings, setProjectMappings] = useState({});
  const [statusFilters, setStatusFilters] = useState({});
  const [statusMappings, setStatusMappings] = useState({});
  const [userMappings, setUserMappings] = useState({});
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [setupOpen, setSetupOpen] = useState(false);
  const keepRunning = useRef(false);
  const confirmDialog = useConfirm();

  const request = useCallback(async (path, options = {}) => {
    return authenticatedRequest(path, {
      ...options,
      cache: 'no-store',
    }, 'Не вдалося виконати запит до інтеграції YouTrack');
  }, []);

  const refresh = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const encodedOrg = encodeURIComponent(organizationId);
      const [nextConnection, imports] = await Promise.all([
        request(`/api/integrations/youtrack?organizationId=${encodedOrg}`),
        request(`/api/integrations/youtrack/import?organizationId=${encodedOrg}`),
      ]);
      setConnection(nextConnection);
      setBaseUrl(nextConnection.baseUrl || '');
      setJob((imports.jobs || []).find(item => ACTIVE_JOB_STATUSES.has(item.status)) || imports.jobs?.[0] || null);
      if (nextConnection.connected) setSetupOpen(false);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [organizationId, request, showToast]);

  useEffect(() => {
    keepRunning.current = false;
    const timer = window.setTimeout(refresh, 0);
    return () => {
      window.clearTimeout(timer);
      keepRunning.current = false;
    };
  }, [refresh]);

  const activeProjects = useMemo(
    () => projects.filter(project => project.status !== 'archived'),
    [projects],
  );
  const memberOptions = useMemo(() => [
    { value: 'external', label: 'Залишити зовнішнім користувачем' },
    ...members.flatMap(member => {
      const id = memberId(member);
      if (!id) return [];
      return [{
        value: id,
        label: member.name || member.displayName || member.email || id,
        user: member,
      }];
    }),
  ], [members]);

  const targetStatusesFor = useCallback((sourceProjectId, targetOverride) => {
    const targetProjectId = targetOverride ?? projectMappings[sourceProjectId] ?? 'create';
    const hiddenStatusIds = new Set(
      targetProjectId === 'create'
        ? []
        : activeProjects.find(project => project.id === targetProjectId)?.hiddenColumns || [],
    );
    return (discovery?.targetStatuses || []).filter(status => !hiddenStatusIds.has(status.id));
  }, [activeProjects, discovery, projectMappings]);

  const updateProjectMapping = (sourceProject, targetProjectId) => {
    const availableStatuses = targetStatusesFor(sourceProject.id, targetProjectId);
    const availableIds = new Set(availableStatuses.map(status => status.id));
    const suggestions = suggestYouTrackStatusMappings([sourceProject], availableStatuses)[sourceProject.id] || {};
    setProjectMappings(current => ({ ...current, [sourceProject.id]: targetProjectId }));
    setStatusMappings(current => ({
      ...current,
      [sourceProject.id]: Object.fromEntries((sourceProject.statuses || []).flatMap(status => {
        const currentTarget = current[sourceProject.id]?.[status.name];
        const targetStatusId = availableIds.has(currentTarget)
          ? currentTarget
          : suggestions[status.name];
        return targetStatusId ? [[status.name, targetStatusId]] : [];
      })),
    }));
  };

  const connect = async () => {
    if (!baseUrl.trim() || !token.trim()) {
      showToast('Вкажіть адресу та постійний токен YouTrack', 'error');
      return;
    }
    setAction('connect');
    try {
      const next = await request('/api/integrations/youtrack', {
        method: 'POST',
        body: JSON.stringify({ organizationId, baseUrl, token }),
      });
      setConnection(next);
      setBaseUrl(next.baseUrl || baseUrl);
      setToken('');
      setSetupOpen(false);
      showToast('YouTrack підключено');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setAction('');
    }
  };

  const disconnect = async () => {
    if (ACTIVE_JOB_STATUSES.has(job?.status)) {
      showToast('Спочатку зупиніть активний імпорт', 'error');
      return false;
    }
    if (!(await confirmDialog({
      title: 'Відключити YouTrack?',
      message: 'Збережений токен буде видалено. Уже перенесені проєкти та задачі залишаться у QuickTeam.',
      confirmText: 'Відключити',
      danger: true,
    }))) return false;

    keepRunning.current = false;
    setAction('disconnect');
    try {
      await request(`/api/integrations/youtrack?organizationId=${encodeURIComponent(organizationId)}`, {
        method: 'DELETE',
      });
      setConnection({ connected: false });
      setDiscovery(null);
      setSelectedProjectIds([]);
      setProjectMappings({});
      setStatusFilters({});
      setStatusMappings({});
      setUserMappings({});
      setJob(null);
      setSetupOpen(false);
      showToast('YouTrack відключено');
      return true;
    } catch (error) {
      showToast(error.message, 'error');
      return false;
    } finally {
      setAction('');
    }
  };

  const toggleConnection = async enabled => {
    if (enabled) {
      setSetupOpen(true);
      return;
    }
    if (connection.connected) {
      await disconnect();
      return;
    }
    setSetupOpen(false);
    setToken('');
  };

  const discover = async () => {
    setAction('discover');
    try {
      const result = await request('/api/integrations/youtrack/discover', {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      const projectIds = result.projects
        .filter(project => (project.statuses || []).length > 0)
        .map(project => project.id);
      setDiscovery(result);
      setSelectedProjectIds(projectIds);
      setProjectMappings(Object.fromEntries(projectIds.map(id => [id, 'create'])));
      // Only projects whose statuses were actually discovered get a filter. A
      // project whose state bundle is unreadable has nothing to choose from,
      // and sending it an empty list would read as "import no statuses".
      setStatusFilters(Object.fromEntries(result.projects.flatMap(project => (
        (project.statuses || []).length
          ? [[project.id, project.statuses.map(status => status.name)]]
          : []
      ))));
      setStatusMappings(suggestYouTrackStatusMappings(result.projects, result.targetStatuses));
      setUserMappings(suggestUserMappings(result.users, members));
      showToast(`Знайдено ${result.projects.length} ${plural(result.projects.length, ['проєкт', 'проєкти', 'проєктів'])} YouTrack`);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setAction('');
    }
  };

  const toggleProject = projectId => {
    setSelectedProjectIds(current => (
      current.includes(projectId)
        ? current.filter(id => id !== projectId)
        : [...current, projectId]
    ));
  };

  const toggleSourceStatus = (projectId, sourceStatus) => {
    setStatusFilters(current => {
      const selected = current[projectId] || [];
      return {
        ...current,
        [projectId]: selected.includes(sourceStatus)
          ? selected.filter(status => status !== sourceStatus)
          : [...selected, sourceStatus],
      };
    });
  };

  const prepare = async () => {
    if (!selectedProjectIds.length) {
      showToast('Оберіть хоча б один проєкт YouTrack', 'error');
      return;
    }
    const projectWithoutStatuses = discovery?.projects?.find(project => (
      selectedProjectIds.includes(project.id)
      && (project.statuses || []).length > 0
      && (statusFilters[project.id] || []).length === 0
    ));
    if (projectWithoutStatuses) {
      showToast(`Оберіть хоча б один статус для проєкту ${projectWithoutStatuses.name}`, 'error');
      return;
    }
    const unmappedStatus = discovery?.projects?.flatMap(project => (
      selectedProjectIds.includes(project.id)
        ? (statusFilters[project.id] || []).flatMap(sourceStatus => (
          statusMappings[project.id]?.[sourceStatus]
            ? []
            : [{ project, sourceStatus }]
        ))
        : []
    ))[0];
    if (unmappedStatus) {
      showToast(`Оберіть статус QuickTeam для ${unmappedStatus.sourceStatus}`, 'error');
      return;
    }
    setAction('prepare');
    try {
      const result = await request('/api/integrations/youtrack/import', {
        method: 'POST',
        body: JSON.stringify({
          action: 'prepare',
          organizationId,
          selectedProjectIds,
          projectMappings,
          userMappings,
          statusFilters,
          statusMappings,
        }),
      });
      setJob(result.job);
      showToast(
        result.job.totalIssues
          ? `Перевірено: до імпорту готово ${result.job.totalIssues} ${plural(result.job.totalIssues, ['задача', 'задачі', 'задач'])}`
          : 'Перевірено, але жодна задача не підпала під вибір. Перевірте обрані статуси.',
        result.job.totalIssues ? 'success' : 'error',
      );
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setAction('');
    }
  };

  const run = async () => {
    if (!job?.id || !ACTIVE_JOB_STATUSES.has(job.status)) return;
    keepRunning.current = true;
    setAction('run');
    try {
      let current = job;
      while (keepRunning.current && ACTIVE_JOB_STATUSES.has(current.status)) {
        const result = await request('/api/integrations/youtrack/import', {
          method: 'POST',
          body: JSON.stringify({
            action: 'run',
            organizationId,
            jobId: current.id,
          }),
        });
        current = result.job;
        setJob(current);
        if (current.stepInProgress) {
          await new Promise(resolve => setTimeout(resolve, 750));
        }
      }
      if (current.status === 'completed') {
        showToast(`Імпорт завершено: ${current.processedIssues} ${plural(current.processedIssues, ['задача', 'задачі', 'задач'])}`);
      }
    } catch (error) {
      showToast(`${error.message}. Імпорт можна продовжити тією ж кнопкою.`, 'error');
    } finally {
      keepRunning.current = false;
      setAction('');
    }
  };

  const cancel = async () => {
    if (!job?.id) return;
    keepRunning.current = false;
    setAction('cancel');
    try {
      const result = await request('/api/integrations/youtrack/import', {
        method: 'POST',
        body: JSON.stringify({ action: 'cancel', organizationId, jobId: job.id }),
      });
      setJob(result.job);
      showToast('Імпорт зупинено');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setAction('');
    }
  };

  const visibleUsers = discovery?.users?.filter(user => !user.banned).slice(0, 250) || [];
  const progress = progressFor(job);
  const jobSummary = jobSummaryParts(job);
  const activeJob = ACTIVE_JOB_STATUSES.has(job?.status);
  // A migration belongs to whoever started it — see `assertImportControl` on the
  // server, which refuses the same calls this hides. Everyone who can open this
  // screen still sees the job and its progress: the point is not to conceal that
  // an import is running, it is that stepping and stopping it are not theirs.
  const jobOwner = job?.createdBy
    ? members.find(member => memberId(member) === job.createdBy) || null
    : null;
  const jobIsMine = !job?.createdBy || job.createdBy === currentUserId;
  const jobOwnerName = jobOwner?.name || jobOwner?.displayName || jobOwner?.email || 'інший учасник';
  const cardEnabled = connection.connected || setupOpen;
  const migrationPresentation = presentation === 'migration';
  const cardStatus = loading
    ? 'pending'
    : connection.connected
      ? 'connected'
      : setupOpen
        ? 'pending'
        : 'off';

  useEffect(() => {
    if (action !== 'run') return undefined;
    const warnBeforeClose = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeClose);
    return () => window.removeEventListener('beforeunload', warnBeforeClose);
  }, [action]);

  return (
    <IntegrationCard
      title="YouTrack"
      description="Перенесіть проєкти, задачі, коментарі, вкладення, облік часу, зв’язки та користувачів без дублів."
      logoSrc="/integrations/youtrack.svg"
      logoAlt="YouTrack"
      enabled={cardEnabled}
      onToggle={toggleConnection}
      toggleDisabled={loading || Boolean(action) || activeJob}
      actionLabel={migrationPresentation
        ? connection.connected
          ? 'Відключити'
          : setupOpen
            ? 'Закрити'
            : 'Налаштувати'
        : undefined}
      onAction={() => toggleConnection(!cardEnabled)}
      actionIcon={!connection.connected && !setupOpen ? Upload : undefined}
      actionStyle={connection.connected || setupOpen ? 'ghost' : 'secondary'}
      actionAriaLabel={connection.connected ? 'Відключити джерело YouTrack' : 'Налаштувати імпорт із YouTrack'}
      status={cardStatus}
      statusLabel={loading
        ? 'Перевіряємо'
        : connection.connected
          ? migrationPresentation ? 'Готово до імпорту' : 'Підключено'
          : setupOpen
            ? 'Налаштування'
            : migrationPresentation ? 'Не налаштовано' : 'Вимкнено'}
      statusMeta={connection.connected ? (
        <span className="min-w-0 truncate text-[12px] text-muted">
          {connection.account?.name || connection.account?.login || 'YouTrack'} · {connection.baseUrl}
        </span>
      ) : null}
    >
      {!connection.connected ? (
        setupOpen ? (
          <div className="space-y-3">
            <IntegrationSteps
              steps={[
                {
                  title: 'Створіть постійний токен у YouTrack',
                  description: 'Відкрийте Profile → Account Security → New token і виберіть scope «YouTrack». Токен матиме ті самі права доступу, що й ваш акаунт.',
                  content: (
                    <a
                      href="https://www.jetbrains.com/help/youtrack/devportal/Manage-Permanent-Token.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-ink hover:underline"
                    >
                      Відкрити офіційну інструкцію JetBrains <ExternalLink size={10} />
                    </a>
                  ),
                },
                {
                  title: 'Вкажіть адресу та токен',
                  description: 'Використовуйте адресу вашого YouTrack без шляху до конкретного проєкту або задачі.',
                  content: (
                    <div className="mt-2 grid max-w-[760px] gap-2 md:grid-cols-2">
                      <Input
                        type="url"
                        value={baseUrl}
                        onChange={event => setBaseUrl(event.target.value)}
                        placeholder="https://company.youtrack.cloud"
                        aria-label="Адреса YouTrack"
                        disabled={loading}
                      />
                      <Input
                        type="password"
                        value={token}
                        onChange={event => setToken(event.target.value)}
                        placeholder="Постійний токен YouTrack"
                        aria-label="Постійний токен YouTrack"
                        autoComplete="new-password"
                        disabled={loading}
                      />
                    </div>
                  ),
                },
                {
                  title: 'Перевірте доступ',
                  description: 'QuickTeam перевірить токен і збереже його для цієї організації. Після цього можна вибрати проєкти та зіставити людей.',
                  content: (
                    <Button
                      style="secondary"
                      size="sm"
                      icon={Search}
                      className="mt-2"
                      onClick={connect}
                      loading={action === 'connect'}
                      disabled={!baseUrl.trim() || !token.trim()}
                    >
                      Перевірити й підключити
                    </Button>
                  ),
                },
              ]}
            />
            <IntegrationNote>
              <p>
                Підключення виконується один раз для організації. Токен зберігається у зашифрованому вигляді й після збереження не повертається у браузер.
              </p>
            </IntegrationNote>
          </div>
        ) : null
      ) : (
        <div className="space-y-4">
              {/* Одна підписана дія, а не три речі поспіль.
                  «Знайти проєкти» — те, по що сюди приходять, тож воно
                  лишається кнопкою з назвою; «Оновити» перечитує той самий
                  стан і не заслуговує на другу підпис-кнопку поруч. А речення
                  про світчер було просто неправдою в цьому вигляді: у
                  «Перенесенні даних» угорі стоїть кнопка «Відключити», ніякого
                  світчера там немає — він є лише в «Інтеграціях». */}
              <div className="flex flex-wrap items-center gap-2">
                <Button style="secondary" size="md" icon={Search} onClick={discover} loading={action === 'discover'}>
                  Знайти проєкти
                </Button>
                <IconAction
                  label="Оновити стан"
                  tooltip
                  icon={RefreshCw}
                  size="compact"
                  appearance="surface"
                  onClick={refresh}
                  disabled={loading}
                />
                {!migrationPresentation && (
                  <p className="text-[12px] text-muted">Вимкнути інтеграцію можна світчером угорі.</p>
                )}
              </div>

              {discovery && (
                <div data-ui-surface="compact-bordered-panel" data-ui-padding="sm" className="ui-surface space-y-4">
                  <div>
                    <p className="text-[12px] font-semibold text-ink">1. Проєкти та місце імпорту</p>
                    <p className="mt-1 text-[11px] text-muted">
                      Оберіть проєкти й статуси задач, які переносимо. Повторний запуск оновлює вже
                      імпортовані записи без дублів.
                    </p>
                    <p className="mt-1 text-[11px] text-muted">
                      Разом із задачами переносяться коментарі, вкладення, зв’язки та work items:
                      затрачений час зʼявиться у записах часу і в сумі витраченого часу задачі.
                    </p>
                  </div>
                  {/* The import is driven step by step from this tab, so the tab has to
                      stay open. Warning only once a job exists came too late — by then
                      the page had already been closed once. */}
                  <Alert
                    variant="info"
                    title="Імпорт іде з цієї вкладки — тримайте її відкритою"
                    description="Закрита або перезавантажена сторінка призупиняє перенесення. Продовжити можна тією ж кнопкою й без дублів, але процес не рухається, доки вкладка закрита."
                  />
                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {discovery.projects.map(project => {
                      const checked = selectedProjectIds.includes(project.id);
                      return (
                        <div key={project.id} data-ui-surface="local" className="rounded-[10px] bg-white p-2">
                          <div className="grid items-center gap-2 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)]">
                            {/* The kit's checkbox, not a native one with an
                                accent colour: this screen was the last place
                                drawing its own. */}
                            <div className="flex min-w-0 items-center gap-2">
                              <Checkbox
                                size="sm"
                                checked={checked}
                                onChange={() => toggleProject(project.id)}
                                disabled={(project.statuses || []).length === 0}
                                ariaLabel={project.name}
                              />
                              <span className="min-w-0 truncate text-[12px] font-semibold text-ink">
                                {project.name} <span className="font-normal text-muted">({project.shortName})</span>
                              </span>
                            </div>
                            <Select
                              value={projectMappings[project.id] || 'create'}
                              onChange={value => updateProjectMapping(project, value)}
                              disabled={!checked}
                              options={[
                                { value: 'create', label: 'Створити новий проєкт' },
                                ...activeProjects.map(target => ({ value: target.id, label: `Додати в: ${target.name}` })),
                              ]}
                            />
                          </div>
                          {(project.statuses || []).length > 0 ? (
                            <div className="mt-2 space-y-2 border-t border-line pt-2">
                              <div>
                                <p className="text-[11px] font-semibold text-ink">Статуси YouTrack → QuickTeam</p>
                                <p className="text-[10px] text-muted">
                                  Відмітьте, які задачі імпортувати, і оберіть їхній статус у QuickTeam. Необрані залишаться в YouTrack.
                                </p>
                              </div>
                              {project.statuses.map(sourceStatus => {
                                const selected = (statusFilters[project.id] || []).includes(sourceStatus.name);
                                const targetStatuses = targetStatusesFor(project.id);
                                return (
                                  <div
                                    key={sourceStatus.id || sourceStatus.name}
                                    className="grid items-center gap-2 rounded-[8px] border border-line p-2 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)]"
                                  >
                                    <div className="flex min-w-0 items-center gap-2">
                                      <Checkbox
                                        size="sm"
                                        checked={selected}
                                        onChange={() => toggleSourceStatus(project.id, sourceStatus.name)}
                                        disabled={!checked}
                                        ariaLabel={`Імпортувати ${sourceStatus.name}`}
                                      />
                                      <p className="min-w-0 truncate text-[11px] text-ink">
                                        {sourceStatus.name}
                                        {sourceStatus.issueCount > 0 ? <span className="text-muted"> · {sourceStatus.issueCount}</span> : null}
                                        {sourceStatus.archived ? <span className="text-muted"> · архівний</span> : null}
                                      </p>
                                    </div>
                                    <Select
                                      value={statusMappings[project.id]?.[sourceStatus.name] || ''}
                                      onChange={value => setStatusMappings(current => ({
                                        ...current,
                                        [project.id]: {
                                          ...current[project.id],
                                          [sourceStatus.name]: value,
                                        },
                                      }))}
                                      disabled={!checked || !selected}
                                      options={targetStatuses.map(status => ({
                                        value: status.id,
                                        label: `${status.label} · ${statusCategoryLabel(status.category)}`,
                                      }))}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <Alert className="mt-2" variant="warning">
                              У доступних задачах цього проєкту не знайдено жодного статусу, тому імпорт для нього вимкнено.
                            </Alert>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-line pt-3">
                    <p className="text-[12px] font-semibold text-ink">2. Зіставлення користувачів</p>
                    <p className="mt-1 text-[11px] text-muted">
                      Точний збіг email уже підставлено. Решта збережуться як зовнішні автори, доки ви не оберете учасника.
                    </p>
                  </div>
                  <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                    {visibleUsers.map(user => {
                      const id = sourceUserId(user);
                      return (
                        <div key={id} data-ui-surface="local" className="grid items-center gap-2 rounded-[10px] bg-white p-2 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)]">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-ink">{user.name}</p>
                            <p className="truncate text-[11px] text-muted">{user.email || user.login || id}</p>
                          </div>
                          <Select
                            value={userMappings[id] || 'external'}
                            onChange={value => setUserMappings(current => ({ ...current, [id]: value }))}
                            options={memberOptions}
                          />
                        </div>
                      );
                    })}
                    {(discovery.users?.length || 0) > visibleUsers.length && (
                      <p className="px-2 text-[11px] text-muted">
                        Показано перші {visibleUsers.length} активних користувачів; інші імпортуються як зовнішні.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    <Button
                      style="secondary"
                      size="md"
                      icon={Search}
                      onClick={prepare}
                      loading={action === 'prepare'}
                      disabled={action === 'run'}
                    >
                      Перевірити імпорт
                    </Button>
                    <p className="text-[11px] text-muted">Цей крок лише рахує задачі й нічого не змінює.</p>
                  </div>
                </div>
              )}

              {job && (
                <div data-ui-surface="compact-bordered-card" data-ui-padding="sm" className="ui-surface">
                  {ACTIVE_JOB_STATUSES.has(job.status) && (
                    <Alert
                      variant="warning"
                      title="Не закривайте цю сторінку під час імпорту"
                      description="Імпорт виконується послідовними кроками з браузера. Якщо закрити або оновити сторінку, процес призупиниться; його можна буде продовжити без дублів."
                      className="mb-3"
                    />
                  )}
                  {/* Стан імпорту — один рядок, а не чотири.
                      Тут стояли назва стану, лічильник задач, три підсумкові
                      числа й відсоток — п'ять написів про те саме, набраних
                      11–12-м кеглем, з яких три завжди були нулями. Стан бере
                      бейдж, обсяг — читабельне число, а підсумок називає лише
                      те, що справді сталося. */}
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Pill tone={JOB_TONES[job.status] || 'neutral'} size="md">{statusLabel(job.status)}</Pill>
                      <span className="text-[13px] font-semibold text-ink">
                        {job.processedIssues + job.failedIssues} / {job.totalIssues} {plural(job.totalIssues, ['задача', 'задачі', 'задач'])}
                      </span>
                    </div>
                    <span className="text-[13px] font-bold tabular-nums text-ink">{progress}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas">
                    <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${progress}%` }} />
                  </div>
                  {jobSummary.length > 0 && (
                    <p className="mt-2 text-[12px] text-muted">{jobSummary.join(' · ')}</p>
                  )}
                  {job.lastError && (
                    <Alert variant="danger" className="mt-3">{job.lastError}</Alert>
                  )}
                  {job.warnings?.length > 0 && (
                    <p className="mt-2 text-[12px] text-warning">
                      {job.warnings.length} {plural(job.warnings.length, ['попередження', 'попередження', 'попереджень'])}. Дані без помилок продовжують імпортуватися.
                    </p>
                  )}
                  {!jobIsMine && (
                    <p className="mt-2 text-[12px] leading-relaxed text-muted">
                      Цей імпорт запустив(ла) {jobOwnerName}
                      {isOrganizationOwner
                        ? '. Продовжити його може лише той, хто розпочав; ви як власник можете його зупинити.'
                        : '. Продовжити або зупинити його може той, хто розпочав, або власник організації.'}
                    </p>
                  )}
                  {ACTIVE_JOB_STATUSES.has(job.status) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {jobIsMine && (
                        <Button size="md" icon={Upload} onClick={run} loading={action === 'run'}>
                          {job.status === 'running' ? 'Продовжити імпорт' : 'Почати імпорт'}
                        </Button>
                      )}
                      {(jobIsMine || isOrganizationOwner) && (
                        <Button style="ghost" color="red" size="md" onClick={cancel} loading={action === 'cancel'}>
                          Зупинити
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
    </IntegrationCard>
  );
}
