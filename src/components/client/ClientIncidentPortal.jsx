'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FilterBar,
  ListRow,
  LoadingSpinner,
  PageHeader,
  Pill,
  Select,
  StatusPill,
  Surface,
  TaskIdentity,
} from '@/components/ui';
import { ArrowRight, Inbox, Plus, UsersRound } from 'lucide-react';
import CreateTaskModal from '@/components/CreateTaskModal';
import { useIssues } from '@/lib/hooks/useIssues';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import { statusCategoryOf } from '@/lib/utils/statusCategories.mjs';
import { timestampMillis } from '@/lib/utils/issueReadState.mjs';
import useWorkspaceStore from '@/store/useWorkspaceStore';

function formatUpdatedAt(value) {
  const millis = timestampMillis(value);
  if (!millis) return 'дату не вказано';
  return new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(millis));
}

export default function ClientIncidentPortal({
  project,
  projectsLoading = false,
  currentUser,
  orgRole,
}) {
  const router = useRouter();
  const showToast = useWorkspaceStore(state => state.showToast);
  const workspaceSearch = useWorkspaceStore(state => state.workspaceSearch);
  const setWorkspaceSearch = useWorkspaceStore(state => state.setWorkspaceSearch);
  const [showComposer, setShowComposer] = useState(false);
  const [scope, setScope] = useState('open');
  const {
    issues,
    loading: issuesLoading,
    error: issuesError,
    createIssue,
  } = useIssues(project?.id || null, { includeLinks: false });
  const { statuses, loading: workflowLoading } = useWorkflowConfig();

  const statusById = useMemo(
    () => new Map((statuses || []).map(status => [status.id, status])),
    [statuses],
  );
  const visibleIssues = useMemo(() => {
    const query = workspaceSearch.trim().toLocaleLowerCase('uk-UA');
    return [...(issues || [])]
    .filter(issue => {
      const category = statusCategoryOf(issue.columnId || issue.status, statuses);
      if (scope === 'open') return category !== 'done';
      if (scope === 'resolved') return category === 'done';
      return true;
    })
    .filter(issue => {
      if (!query) return true;
      return [issue.issueKey, issue.title, issue.description]
        .some(value => String(value || '').toLocaleLowerCase('uk-UA').includes(query));
    })
    .sort((left, right) => (
      timestampMillis(right.updatedAt || right.createdAt)
      - timestampMillis(left.updatedAt || left.createdAt)
    ));
  }, [issues, scope, statuses, workspaceSearch]);

  usePublishLocalSearchResults(workspaceSearch, visibleIssues.length);

  const actor = useMemo(() => ({
    userId: currentUser?.uid || currentUser?.id,
    userName: currentUser?.name || currentUser?.displayName || currentUser?.email || '',
  }), [currentUser]);

  const handleCreate = async formData => {
    const created = await createIssue({
      title: formData.title,
      description: formData.description || '',
    }, actor);
    showToast('Інцидент створено');
    return { ...created, projectId: project.id };
  };

  if (projectsLoading || (project && (issuesLoading || workflowLoading))) {
    return (
      <div className="flex min-h-[420px] flex-1 items-center justify-center" role="status" aria-busy="true">
        <LoadingSpinner size="md" label="Завантажуємо ваші звернення…" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
        <div className="workspace-page-layout min-h-full">
          <PageHeader title="Мої звернення" />
          <Surface preset="panel" padding="lg">
            <EmptyState
              icon={Inbox}
              title="Простір підтримки ще не налаштовано"
              description="Адміністратор має запросити вас до підготовленого клієнтського проєкту."
              context="page"
            />
          </Surface>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent">
        <div className="workspace-page-layout min-h-full pb-[120px]">
          <PageHeader
            title="Мої звернення"
            actions={(
              <div className="flex items-center gap-2">
                {orgRole === 'client_admin' && (
                  <Button
                    onClick={() => router.push('/settings?section=team')}
                    icon={UsersRound}
                    style="secondary"
                    size="lg"
                    collapseAt="md"
                  >
                    Співробітники
                  </Button>
                )}
                <Button
                  onClick={() => setShowComposer(true)}
                  icon={Plus}
                  style="primary"
                  color="dark"
                  size="lg"
                  collapseAt="sm"
                >
                  Створити інцидент
                </Button>
              </div>
            )}
            filters={(
              <FilterBar>
                <Select
                  filterRole="status"
                  variant="ghost"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: 'open', label: 'Відкриті' },
                    { value: 'all', label: 'Усі звернення' },
                    { value: 'resolved', label: 'Вирішені' },
                  ]}
                />
              </FilterBar>
            )}
          />

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Pill tone="ink-subtle" size="md" shape="badge">{project.name}</Pill>
            <span className="text-[12px] text-muted">
              Тут видно звернення вашої компанії та відповіді команди підтримки.
            </span>
          </div>

          {issuesError ? (
            <Alert
              variant="error"
              title="Не вдалося завантажити звернення"
              description="Оновіть сторінку та спробуйте ще раз."
            />
          ) : visibleIssues.length === 0 ? (
            <Surface preset="panel" padding="lg">
              <EmptyState
                icon={Inbox}
                title={workspaceSearch.trim()
                  ? 'За вашим запитом нічого не знайдено'
                  : scope === 'open' ? 'Відкритих звернень немає' : 'Звернень не знайдено'}
                description={workspaceSearch.trim()
                  ? 'Перевірте номер або слова в темі звернення.'
                  : scope === 'open'
                    ? 'Якщо виникла проблема або запитання, створіть новий інцидент — команда підтримки відповість у ньому.'
                    : 'Змініть фільтр або створіть новий інцидент.'}
                action={workspaceSearch.trim() ? 'Очистити пошук' : 'Створити інцидент'}
                onAction={() => {
                  if (workspaceSearch.trim()) setWorkspaceSearch('');
                  else setShowComposer(true);
                }}
                context="page"
              />
            </Surface>
          ) : (
            <Surface preset="panel" padding="md">
              <Card preset="borderless" padding="none" className="overflow-hidden divide-y divide-line">
                {visibleIssues.map(issue => {
                  const status = statusById.get(issue.columnId || issue.status);
                  const category = statusCategoryOf(issue.columnId || issue.status, statuses);
                  return (
                    <ListRow
                      key={issue.id}
                      density="roomy"
                      onClick={() => router.push(issuePath(issue, project))}
                      className="flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <TaskIdentity issue={issue} project={project} done={category === 'done'} />
                        <p className="mt-1 truncate text-[14px] font-bold text-ink">
                          {issue.title || 'Інцидент без назви'}
                        </p>
                        <p className="mt-1 text-[11px] text-muted">
                          Оновлено {formatUpdatedAt(issue.updatedAt || issue.createdAt)}
                        </p>
                      </div>
                      <StatusPill label={status?.label || 'Новий'} color={status?.color} />
                      <ArrowRight size={16} className="shrink-0 text-faint" aria-hidden />
                    </ListRow>
                  );
                })}
              </Card>
            </Surface>
          )}
        </div>
      </div>

      <CreateTaskModal
        isOpen={showComposer}
        onClose={() => setShowComposer(false)}
        onSubmit={handleCreate}
        stages={project.stages || []}
        teamMembers={[]}
        projectContext={{
          id: project.id,
          name: project.name,
          hiddenColumns: project.hiddenColumns || [],
        }}
        sprints={[]}
        entity="incident"
        clientMode
      />
    </>
  );
}
