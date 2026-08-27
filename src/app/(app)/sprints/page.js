'use client';
// src/app/workspace/sprints/page.js — Global Sprints & Planning styled like Project page
import { useCallback, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import { useOrganization } from '@/lib/hooks/useOrganization';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { useSprints } from '@/lib/hooks/useSprints';
import { useOptimisticPatch } from '@/lib/hooks/useOptimisticPatch';
import { useWorkspaceAnalytics } from '@/lib/hooks/useWorkspaceAnalytics';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import IssueCard from '@/components/workspace/IssueCard';
import VirtualDroppableColumn from '@/components/workspace/VirtualDroppableColumn';
import TaskRow from '@/components/ui/TaskManagement/TaskRow';
import CreateTaskModal from '@/components/CreateTaskModal';
import IssueModal from '@/components/workspace/IssueModal';
import { Alert, BulkActionBar, ContextMenu, DatePicker, FormGroup, PageHeader, Pill, useConfirm, Dialog, Input, Textarea, StatusPill } from '@/components/ui';
import { workspaceDataFailureCopy } from '@/lib/utils/organizationLoadErrors.mjs';
import { isQuotaRefused } from '@/lib/utils/quotaState.mjs';
import { can, canWhileRoleLoads } from '@/lib/utils/can';
import { activeMembers } from '@/lib/utils/orgMembership.mjs';
import { createIssueViaApi } from '@/lib/services/issues';
import { useLocalization } from '@/lib/hooks/useLocalization';
import { useIsMobile } from '@/lib/hooks/useIsMobile';
import {
  Plus, Play, Check, Trash2, Edit2, Calendar,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  AlertCircle, CheckSquare, Filter, MoreVertical, ListPlus, Search
} from 'lucide-react';
import { Select, MultiSelect } from '@/components/ui/Select';
import FilterBar from '@/components/ui/FilterBar';
import Surface from '@/components/ui/Surface';
import Button from '@/components/ui/Button';
import { fromDateInput, toLocalDateInput } from '@/lib/utils/date';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { usePublishLocalSearchResults } from '@/lib/hooks/usePublishLocalSearchResults';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { useViewState } from '@/lib/hooks/useViewState';
import { SPRINTS_VIEW_SCHEMA } from '@/lib/utils/viewState.mjs';
import {
  createUkrainianDndAnnouncements,
  UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS,
} from '@/lib/utils/dndAnnouncements.mjs';
import { plural } from '@/lib/utils/plural.mjs';
import { useBulkIssueActions } from '@/lib/hooks/useBulkIssueActions';
import { resolveCategoryStatusId } from '@/lib/utils/statusCategories.mjs';
import { useIssueSelection } from '@/lib/hooks/useIssueSelection';
import { nextSectionExpansion } from '@/lib/utils/sectionExpansion.mjs';
import { COLUMN_VIRTUALIZATION_THRESHOLD } from '@/lib/utils/boardRendering.mjs';
import { sprintCandidateIssues } from '@/lib/utils/sprintPlanning.mjs';

function SprintEditModal({ sprint, onClose, onSave }) {
  const [name, setName] = useState(sprint.name || '');
  const [goal, setGoal] = useState(sprint.goal || '');
  const [startDate, setStartDate] = useState(() => toLocalDateInput(sprint.startDate));
  const [endDate, setEndDate] = useState(() => toLocalDateInput(sprint.endDate));

  const [nameError, setNameError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Вкажіть назву спринта');
      return;
    }
    onSave({
      name,
      goal,
      startDate: fromDateInput(startDate),
      endDate: fromDateInput(endDate, { endOfDay: true })
    });
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title="Редагувати спринт"
      size="sm"
      footer={
        <>
          <Button style="secondary" size="md" onClick={onClose} type="button">Скасувати</Button>
          <Button style="primary" size="md" type="submit" form="sprint-edit-form">Зберегти</Button>
        </>
      }
    >
        <form id="sprint-edit-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormGroup label="Назва спринта" required error={nameError}>
            <Input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); if (nameError) setNameError(''); }}
              error={Boolean(nameError)}
            />
          </FormGroup>
          <FormGroup label="Ціль спринта">
            <Textarea value={goal} onChange={e => setGoal(e.target.value)} rows={2} />
          </FormGroup>
          <div className="flex gap-4">
            <FormGroup label="Дата початку" className="flex-1">
              <DatePicker value={startDate} onChange={setStartDate} aria-label="Дата початку" />
            </FormGroup>
            <FormGroup label="Дата завершення" className="flex-1">
              <DatePicker value={endDate} onChange={setEndDate} aria-label="Дата завершення" />
            </FormGroup>
          </div>
        </form>
    </Dialog>
  );
}

function SprintCreateModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [nameError, setNameError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError('Вкажіть назву спринта');
      return;
    }
    onSave({
      name,
      goal,
      startDate: fromDateInput(startDate),
      endDate: fromDateInput(endDate, { endOfDay: true })
    });
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title="Створити спринт"
      size="sm"
      footer={
        <>
          <Button style="secondary" size="md" onClick={onClose} type="button">Скасувати</Button>
          <Button style="primary" size="md" type="submit" form="sprint-create-form">Створити</Button>
        </>
      }
    >
        <form id="sprint-create-form" noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormGroup label="Назва спринта" required error={nameError}>
            <Input
              type="text"
              placeholder="Наприклад: Спринт 1"
              value={name}
              onChange={e => { setName(e.target.value); if (nameError) setNameError(''); }}
              error={Boolean(nameError)}
            />
          </FormGroup>
          <FormGroup label="Ціль спринта">
            <Textarea value={goal} placeholder="Опишіть ціль цього спринта..." onChange={e => setGoal(e.target.value)} rows={2} />
          </FormGroup>
          <div className="flex gap-4">
            <FormGroup label="Дата початку" className="flex-1">
              <DatePicker value={startDate} onChange={setStartDate} aria-label="Дата початку" />
            </FormGroup>
            <FormGroup label="Дата завершення" className="flex-1">
              <DatePicker value={endDate} onChange={setEndDate} aria-label="Дата завершення" />
            </FormGroup>
          </div>
        </form>
    </Dialog>
  );
}

function SprintCompleteModal({ sprint, sprints, incompleteIssues, onClose, onConfirm }) {
  const [moveToSprintId, setMoveToSprintId] = useState('backlog');

  const upcomingSprints = sprints.filter(s => s.status === 'planned');

  const handleSubmit = (e) => {
    e.preventDefault();
    onConfirm(moveToSprintId === 'backlog' ? null : moveToSprintId);
  };

  return (
    <Dialog
      isOpen={true}
      onClose={onClose}
      title={`Завершити спринт: ${sprint.name}`}
      size="sm"
      presentation="dialog"
      footer={
        <>
          <Button style="secondary" size="md" onClick={onClose} type="button">Скасувати</Button>
          <Button style="primary" size="md" type="submit" form="sprint-complete-form">Завершити спринт</Button>
        </>
      }
    >
        <p className="text-[13px] text-muted mb-4">
          У цьому спринті залишилося <strong className="text-ink">{incompleteIssues.length} {plural(incompleteIssues.length, ['завдання', 'завдання', 'завдань'])}</strong>. Куди їх перенести?
        </p>
        <form id="sprint-complete-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <FormGroup label="Перенести завдання в">
            <Select
              value={moveToSprintId}
              onChange={setMoveToSprintId}
              options={[
                { value: 'backlog', label: 'Беклог' },
                ...upcomingSprints.map(s => ({ value: s.id, label: s.name })),
              ]}
              className="w-full"
            />
          </FormGroup>
        </form>
    </Dialog>
  );
}

// Планування без перетягування. Картку з беклогу у спринт тягнуть мишею — на
// телефоні цього жесту немає взагалі (два списки стоять один під одним, і
// довге натискання конкурує зі скролом), а на чотирьохстах завданнях він
// повільний і на десктопі. Тому «+» у шапці спринта питає, що саме додати, і
// другий варіант відкриває цей діалог. Дія одна для обох ширин: інакше в
// продукті було б два різні способи зробити те саме.
function AddExistingIssuesDialog({
  sprint,
  issues,
  sprints,
  members,
  labels,
  issueLinks,
  projects,
  closedStatusIds,
  onClose,
  onAdd,
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);

  const offered = sprintCandidateIssues(issues, {
    sprintId: sprint.id,
    query,
    closedStatusIds,
    pickedIds: picked,
  });

  const toggle = (issueId) => setPicked(current => (
    current.includes(issueId)
      ? current.filter(item => item !== issueId)
      : [...current, issueId]
  ));

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title="Додати існуюче завдання"
      description={sprint.name}
      size="lg"
      bodyPadding="sticky-head"
      footer={
        <>
          <Button style="secondary" size="md" onClick={onClose} type="button">Скасувати</Button>
          <Button
            style="primary"
            size="md"
            disabled={picked.length === 0 || saving}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onAdd(picked);
              } finally {
                setSaving(false);
              }
            }}
          >
            {picked.length > 0 ? `Додати (${picked.length})` : 'Додати'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        {/* Поле лишається на місці, поки список під ним їде. Верхній відступ
            належить йому, а не тілу діалогу (`bodyPadding="sticky-head"`) —
            саме тому воно прилипає до самого верху й нічого не ріже. Раніше
            воно накривало чужий відступ через `-mt-5`: у потоці смуга
            піднімалась на 20px, але нижчою не ставала, тож перше завдання
            стояло рівно на 20px під білим тлом і виглядало обрубаним ще до
            будь-якої прокрутки. По горизонталі відʼємний відступ лишається —
            він робить тло на всю ширину і нічого не зсуває. */}
        <div className="sticky top-0 z-10 -mx-5 bg-white px-5 pb-3 pt-5 sm:-mx-6 sm:px-6">
          <Input
            value={query}
            onChange={event => setQuery(event.target.value)}
            icon={Search}
            placeholder="Пошук за назвою або номером"
            aria-label="Пошук завдання"
          />
        </div>

        {offered.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-faint">
            {query.trim()
              ? 'За цим запитом нічого не знайдено'
              : 'Усі завдання вже розкладені по спринтах'}
          </p>
        ) : (
          // `pt-1` is the hover ring, not a margin. A row draws `ring-4` outside
          // its own box when the pointer is on it, and with the pinned field
          // ending exactly where the first row begins those four pixels were
          // painted under white: the top task looked sliced off the moment you
          // reached for it. The gap between two rows is 8px for the same
          // reason — four for each ring — so the top one gets its four too.
          <div className="flex flex-col gap-[8px] pt-1">
            {offered.map(issue => (
              <TaskRow
                key={issue.id}
                issue={issue}
                allIssues={issues}
                issueLinks={issueLinks}
                members={members}
                labels={labels}
                sprints={sprints}
                projectId={issue.projectId}
                projectName={projects.find(project => project.id === issue.projectId)?.name || ''}
                showProjectName
                selected={picked.includes(issue.id)}
                selectionActive
                onSelect={toggle}
              />
            ))}
          </div>
        )}

        {!query.trim() && offered.length > 0 && (
          <p className="pt-3 text-center text-[11px] text-faint">
            Показані останні незаплановані завдання. Решту знайдете пошуком — за номером або назвою.
          </p>
        )}
      </div>
    </Dialog>
  );
}

export default function GlobalSprintsPage() {
  const router = useRouter();
  const { currentUser, projects, activeOrgId, orgRole } = useAppContext();
  const { members } = useOrganization();
  const { labels, statuses, priorities, types, closedStatusIds, categoryColumns } = useWorkflowConfig();
  const statusOrder = statuses.map(s => s.id);
  const priorityOrder = Object.fromEntries(priorities.map((priority, index) => [priority.id, index]));
  priorityOrder[NO_PRIORITY_ID] = priorities.length;
  const isClosedCol = (id) => closedStatusIds.includes(id);
  const { formatDate } = useLocalization();
  const showToast = useWorkspaceStore(s => s.showToast);
  const sprintSearch = useWorkspaceStore(s => s.sprintSearch);
  const confirmDialog = useConfirm();

  // No breadcrumbs for main pages
  useEffect(() => {
    return () => useWorkspaceStore.setState({ breadcrumbs: [] });
  }, []);

  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  // Який спринт відкрив діалог створення — «Додати завдання» у шапці спринта
  // одразу підставляє його, а «+» над беклогом лишає порожнім.
  const [createTaskSprintId, setCreateTaskSprintId] = useState(null);
  // Спринт, для якого відкрито вибір уже наявних завдань.
  const [addExistingSprint, setAddExistingSprint] = useState(null);
  const [showCreateSprintModal, setShowCreateSprintModal] = useState(false);
  const [showCompleteSprintModal, setShowCompleteSprintModal] = useState(null); // sprint object
  const [editingSprint, setEditingSprint] = useState(null);
  const [activeIssue, setActiveIssue] = useState(null);
  const [sectionExpansion, setSectionExpansion] = useState({});
  // Filters live in the address, so a sprint board can be bookmarked and sent.
  const [sprintFilters, setSprintFilters] = useViewState(SPRINTS_VIEW_SCHEMA, {
    storageKey: `qt:view:${activeOrgId}:sprints`,
  });
  const {
    projects: projectFilters,
    assignee: assigneeFilter,
    priority: priorityFilter,
    type: typeFilter,
  } = sprintFilters;
  const [sortKey, setSortKey]  = useState('order');
  const [sortDir, setSortDir]  = useState('asc');
  const [backlogCollapsed, setBacklogCollapsed] = useState(false);

  const isManager = can(orgRole, 'manage:sprints');

  // ?new=1 — те саме прохання, що вже розуміють «Мої завдання», календар і
  // список проєктів: «Новий спринт» у командній палітрі не має власної кнопки
  // на цій сторінці, він відкриває цю. Прапорець одразу знімається з адреси,
  // щоб оновлення сторінки не відкрило діалог удруге.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete('new');
    router.replace(next.size ? `/sprints?${next}` : '/sprints', { scroll: false });
    if (!can(orgRole, 'manage:sprints')) return;
    queueMicrotask(() => setShowCreateSprintModal(true));
  }, [orgRole, router, searchParams]);
  // `null` on the first render means desktop, which is the layout that has
  // room either way.
  const isPhone = useIsMobile() === true;
  const projectIds = (projects || []).map(p => p.id);
  const {
    issues: snapshotIssues,
    issueLinks,
    loading: issuesLoading,
    error: issuesError,
  } = useWorkspaceAnalytics(projectIds, { includeTimeLogs: false });
  // Sprint reassignment is painted locally first; without it the dropped card
  // animates back into its old sprint and only then hops to the new one.
  const [dndIssues, applyPatch, revertPatch] = useOptimisticPatch(snapshotIssues);
  const resolveBulkStatusId = useCallback((issue, value) => {
    if (value?.mode !== 'category') return value?.id || null;
    const project = (projects || []).find(item => item.id === issue.projectId);
    return resolveCategoryStatusId(value.id, statuses, {
      currentStatusId: issue.columnId || issue.status,
      hiddenStatusIds: project?.hiddenColumns || [],
    });
  }, [projects, statuses]);
  const { issues, applyBulkAction, bulkProgress } = useBulkIssueActions({
    issues: dndIssues,
    organizationId: activeOrgId,
    showToast,
    resolveStatusId: resolveBulkStatusId,
  });
  const {
    sprints,
    loading: sprintsLoading,
    error: sprintsError,
    createSprint,
    updateSprint,
    deleteSprint,
    startSprint,
    completeSprint,
  } = useSprints();

  const loading = issuesLoading || sprintsLoading;
  const dndAnnouncements = createUkrainianDndAnnouncements({
    itemLabel: draggableId => {
      const issue = issues.find(candidate => candidate.id === draggableId);
      return issue?.issueKey || issue?.title || 'Завдання';
    },
    listLabel: droppableId => (
      droppableId === 'backlog'
        ? 'Без спринта'
        : sprints.find(sprint => sprint.id === droppableId)?.name || 'Спринт'
    ),
  });

  const onDragEnd = async ({ draggableId, source, destination }) => {
    if (selectionActive) return;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const issueId = draggableId;
    const targetSprintId = destination.droppableId === 'backlog' ? null : destination.droppableId;

    // Move the card first, write second. Firestore was also imported lazily
    // right here, so the first drop of a session paid a chunk fetch on top of
    // the round-trip before anything on screen moved.
    applyPatch({ [issueId]: { sprintId: targetSprintId } });

    try {
      await updateDoc(doc(db, 'issues', issueId), {
        sprintId: targetSprintId,
        updatedAt: serverTimestamp()
      });
      showToast('Спринт оновлено');
    } catch (err) {
      revertPatch([issueId]);
      console.error(err);
      showToast('Не вдалося перемістити завдання — відновлено попередній стан', 'error');
    }
  };

  // Той самий контракт, що й у drop: оптимістичне накладення першим, запис
  // другим, відкат при помилці.
  const handleAddExistingIssues = async (sprintId, issueIds) => {
    if (!issueIds.length) return;
    applyPatch(Object.fromEntries(issueIds.map(id => [id, { sprintId }])));
    setAddExistingSprint(null);

    try {
      await Promise.all(issueIds.map(id => updateDoc(doc(db, 'issues', id), {
        sprintId,
        updatedAt: serverTimestamp(),
      })));
      showToast(issueIds.length === 1
        ? 'Завдання додано до спринта'
        : `Додано ${issueIds.length} ${plural(issueIds.length, ['завдання', 'завдання', 'завдань'])} до спринта`);
    } catch (err) {
      revertPatch(issueIds);
      console.error(err);
      showToast('Не вдалося додати завдання — відновлено попередній стан', 'error');
    }
  };

  const handleCreateSprint = async (sprintData) => {
    try {
      await createSprint(sprintData);
      setShowCreateSprintModal(false);
      showToast('Спринт створено');
    } catch (e) {
      console.error(e);
      showToast('Помилка створення спринта');
    }
  };

  const handleStartSprint = async (sprintId) => {
    try {
      await startSprint(sprintId);
      showToast('Спринт розпочато');
    } catch (error) {
      showToast(error.message || 'Помилка запуску спринта', 'error');
    }
  };

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  // Filter & Sort issues
  const filteredIssues = issues.filter(i => {
    const normalizedSearch = sprintSearch.trim().toLowerCase();
    if (normalizedSearch) {
      const projectName = projects.find(project => project.id === i.projectId)?.name || '';
      const sprintName = sprints.find(sprint => sprint.id === i.sprintId)?.name || '';
      const matches = [i.issueKey, i.title, i.description, projectName, sprintName]
        .some(value => String(value || '').toLowerCase().includes(normalizedSearch));
      if (!matches) return false;
    }
    if (projectFilters.length > 0 && !projectFilters.includes(i.projectId)) return false;
    if (assigneeFilter !== 'all') {
      if (assigneeFilter === 'unassigned') {
        if (i.assigneeIds && i.assigneeIds.length > 0) return false;
      } else {
        if (!i.assigneeIds || !i.assigneeIds.includes(assigneeFilter)) return false;
      }
    }
    if (priorityFilter !== 'all' && (i.priority || NO_PRIORITY_ID) !== priorityFilter) return false;
    if (typeFilter !== 'all' && i.type !== typeFilter) return false;
    return true;
  });
  usePublishLocalSearchResults(sprintSearch, filteredIssues.length);

  const getSortedIssues = (issueList) => {
    return [...issueList].sort((a, b) => {
      let av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
      if (sortKey === 'priority') {
        av = priorityOrder[a.priority || NO_PRIORITY_ID] ?? priorities.length + 1;
        bv = priorityOrder[b.priority || NO_PRIORITY_ID] ?? priorities.length + 1;
      }
      if (sortKey === 'columnId') {
        av = statusOrder.indexOf(a.columnId);
        bv = statusOrder.indexOf(b.columnId);
      }
      const res = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? res : -res;
    });
  };

  const selectionOrder = getSortedIssues(filteredIssues).map(issue => issue.id);
  const selectionScopeKey = [
    activeOrgId,
    sprintSearch,
    projectFilters.join(','),
    assigneeFilter,
    priorityFilter,
    typeFilter,
    sortKey,
    sortDir,
  ].join('|');
  const {
    active: selectionActive,
    activeSelectedIds: activeSelectedIssueIds,
    selectedIssues,
    toggle: toggleIssueSelection,
    toggleScope: toggleIssueScope,
    clear: clearSelection,
  } = useIssueSelection({
    issues: filteredIssues,
    order: selectionOrder,
    scopeKey: selectionScopeKey || 'sprints',
  });
  const toggleSectionSelection = sectionIssues => toggleIssueScope(
    sectionIssues.map(issue => issue.id),
  );
  const handleBulkUpdate = (action, value) => applyBulkAction(
    action,
    action === 'status' ? { mode: 'category', id: value } : value,
    selectedIssues,
  );

  const activeSprintList = (sprints || []).filter(s => s.status === 'active');
  const plannedSprintList = (sprints || []).filter(s => s.status === 'planned');
  const completedSprintList = (sprints || []).filter(s => s.status === 'completed');

  const sprintMap = (sprints || []).reduce((acc, s) => {
    acc[s.id] = s;
    return acc;
  }, {});

  const backlogIssues = filteredIssues.filter(i => !i.sprintId || !sprintMap[i.sprintId]);

  const formatSprintDates = (startDate, endDate) => {
    if (!startDate || !endDate) return null;
    const start = startDate.toDate ? startDate.toDate() : new Date(startDate);
    const end = endDate.toDate ? endDate.toDate() : new Date(endDate);
    return `${formatDate(start)} - ${formatDate(end)}`;
  };

  const toggleSection = (id, isExpanded) => {
    setSectionExpansion(prev => nextSectionExpansion(prev, id, isExpanded));
  };

  const isSectionExpanded = (sprintId, def = true) => {
    if (sectionExpansion[sprintId] !== undefined) {
      return sectionExpansion[sprintId];
    }
    return def;
  };

  const SortIcon = ({ k }) => {
    if (sortKey !== k) return null;
    return sortDir === 'asc' ? <ChevronUp size={11} className="inline ml-1" /> : <ChevronDown size={11} className="inline ml-1" />;
  };

  const renderIssueTable = (issueList, droppableId) => {
    const sorted = getSortedIssues(issueList);
    return (
      <Droppable droppableId={droppableId} isDropDisabled={selectionActive}>
        {(provided, snapshot) => (
          <div
            className="flex min-h-[60px] flex-col px-2 pb-4 pt-1 sm:px-4"
            ref={provided.innerRef}
            {...provided.droppableProps}
          >
            {sorted.map((issue, index) => {
              const pName = projects.find(p => p.id === issue.projectId)?.name || '';
              return (
                <Draggable key={issue.id} draggableId={issue.id} index={index} isDragDisabled={selectionActive}>
                  {(draggableProvided, draggableSnapshot) => (
                    <div
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      {...draggableProvided.dragHandleProps}
                      className="mb-[8px]"
                      style={{
                        ...draggableProvided.draggableProps.style,
                        opacity: draggableSnapshot.isDragging ? 0.8 : 1,
                      }}
                    >
                      <TaskRow
                        issue={issue}
                        // The same context the card beside it gets: the parent
                        // key and the blocked mark are read from these two.
                        allIssues={issues}
                        issueLinks={issueLinks}
                        members={members}
                        labels={labels}
                        sprints={sprints}
                        projectId={issue.projectId}
                        projectName={pName}
                        showProjectName
                        onClick={() => setActiveIssue(issue)}
                        selected={activeSelectedIssueIds.has(issue.id)}
                        selectionActive={selectionActive}
                        onSelect={toggleIssueSelection}
                      />
                    </div>
                  )}
                </Draggable>
              );
            })}
            {issueList.length === 0 && (
              <div className="py-8 text-center text-[12px] text-faint">
                У цьому спринті ще немає задач — додайте їх кнопкою «+» у шапці спринта або перетягніть зі списку «Без спринта»
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    );
  };

  const renderBacklogCard = (issue, index, virtualProps = {}) => (
    <IssueCard
      key={issue.id}
      className="mb-[8px]"
      issue={issue}
      // Every task on the page, not this one column: the parent a subtask
      // hangs under is usually in another sprint, and a card handed only its
      // own list cannot find it — the key slot then falls back to the words
      // «Батьківське завдання».
      allIssues={issues}
      sprints={sprints}
      members={members}
      labels={labels}
      index={index}
      projectId={issue.projectId}
      projectName={projects.find(project => project.id === issue.projectId)?.name || ''}
      showProjectName
      issueLinks={issueLinks}
      selected={activeSelectedIssueIds.has(issue.id)}
      selectionActive={selectionActive}
      onSelect={toggleIssueSelection}
      {...virtualProps}
    />
  );

  // «Без спринта» — та сама довга колонка, що й на дошці, тільки тут вона
  // збирає беклог усієї організації: чотири сотні карток монтувались разом, і
  // кожна з них ще й перебирала весь список у пошуках батька та підзавдань.
  // Механізм узятий з дошки без змін — у DOM живе лише вікно завширшки з
  // екран, а завдання всі до одного лишаються і в скролі, і в drag-моделі.
  // Скролером тепер є сам Droppable: вимірювати вікно може тільки той, хто
  // ним володіє.
  const renderBacklogList = () => {
    const sorted = getSortedIssues(backlogIssues);
    const listClass = 'flex-1 overflow-y-auto hide-scrollbar px-[8px] pb-4 pt-1';

    if (sorted.length > COLUMN_VIRTUALIZATION_THRESHOLD) {
      return (
        <VirtualDroppableColumn
          dropId="backlog"
          issues={sorted}
          isDropDisabled={selectionActive}
          className={listClass}
          renderCard={renderBacklogCard}
        />
      );
    }

    return (
      <Droppable droppableId="backlog" isDropDisabled={selectionActive}>
        {provided => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`${listClass} flex min-h-[60px] flex-col`}
          >
            {sorted.map((issue, index) => renderBacklogCard(issue, index))}
            {sorted.length === 0 && (
              <div className="py-8 text-center text-[12px] text-faint">
                Завдань без спринта не знайдено
              </div>
            )}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    );
  };


  // Одне питання на три екрани: відмова в доступі, вичерпана квота й обрив
  // мережі — це три різні речі, і всі три казали «перевірте зʼєднання».
  const dataFailure = workspaceDataFailureCopy(issuesError || sprintsError, isQuotaRefused());
  return (
    // Below lg the two columns become one stack, and a stack is taller than the
    // viewport — so the page itself has to scroll. It did not: the shell was
    // `overflow-hidden` and the only scroller was the sprint column's own, which
    // is `lg:` and therefore absent on a phone. Everything past the first screen
    // was simply clipped, which is what made planning on a phone impossible
    // rather than merely cramped.
    <div className="qt-nav-scroll flex-1 h-full overflow-y-auto overflow-x-hidden custom-scrollbar bg-transparent lg:overflow-hidden">
      <div className="workspace-page-layout min-h-full pb-[24px] lg:h-full">

      <PageHeader
        title="Спринти"
        actions={
          <>
            {isManager && (
              <Button
                style="primary"
                size="lg"
                icon={Plus}
                onClick={() => setShowCreateSprintModal(true)}
                collapseAt="sm"
                title="Створити спринт"
              >
                Створити спринт
              </Button>
            )}
          </>
        }
        filters={
          <FilterBar>
            <MultiSelect
              value={projectFilters}
                onChange={value => setSprintFilters({ projects: value })}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="Всі проєкти"
                searchPlaceholder="Пошук проєкту..."
                filterRole="project"
                variant="ghost"
              />
              <Select
                filterRole="member"
                value={assigneeFilter}
                onChange={value => setSprintFilters({ assignee: value })}
                options={[
                  { value: 'all', label: 'Всі виконавці' },
                  { value: 'unassigned', label: 'Без виконавця' },
                  ...members.map(m => ({ value: m.id || m.uid, label: m.name || m.email, user: m }))
                ]}
                variant="ghost"
              />
              <Select
                filterRole="priority"
                value={priorityFilter}
                onChange={value => setSprintFilters({ priority: value })}
                options={[
                  { value: 'all', label: 'Всі пріоритети' },
                  ...prioritySelectOptions(priorities),
                ]}
                variant="ghost"
              />
              <Select
                filterRole="type"
                value={typeFilter}
                onChange={value => setSprintFilters({ type: value })}
                options={[
                  { value: 'all', label: 'Всі типи' },
                  ...types.map(taskTypeSelectOption),
                ]}
                variant="ghost"
              />
            </FilterBar>
        }
      />

      {/* ── Content area ── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center bg-transparent">
          <div className="w-[28px] h-[28px] border-[3px] border-line border-t-ink rounded-full animate-spin" />
        </div>
      ) : issuesError || sprintsError ? (
        <div className="flex min-h-[360px] flex-1 items-center justify-center p-6">
          <div className="flex w-full max-w-[480px] flex-col gap-3">
            <Alert
              variant="error"
              title={dataFailure.title}
              description={dataFailure.description}
            />
            <Button onClick={() => window.location.reload()} style="secondary" size="sm">
              Спробувати ще раз
            </Button>
          </div>
        </div>
      ) : (
        /* PLANNING TAB */
        <div className="flex-1 flex flex-col min-h-[600px]">

          <DragDropContext
            dragHandleUsageInstructions={UKRAINIAN_DRAG_HANDLE_USAGE_INSTRUCTIONS}
            onDragStart={dndAnnouncements.onDragStart}
            onDragUpdate={dndAnnouncements.onDragUpdate}
            onDragEnd={(result, provided) => {
              dndAnnouncements.onDragEnd(result, provided);
              onDragEnd(result);
            }}
          >
            <div className="flex-1 flex flex-col lg:flex-row gap-6 lg:min-h-0 items-stretch">

              {/* Left Column: Sprints (65%) */}
              <div className="flex-1 flex flex-col gap-4 overflow-visible lg:overflow-y-auto custom-scrollbar lg:pr-2 lg:min-h-0">
                {sprints.map(sprint => {
                  const sprintIssues = filteredIssues.filter(i => i.sprintId === sprint.id);
                  const isExpanded = isSectionExpanded(sprint.id, sprint.status !== 'completed');

                  return (
                    <div key={sprint.id} data-ui-surface="local" className="bg-canvas rounded-[16px] border border-transparent shadow-none overflow-hidden shrink-0">
                      <div className="flex items-center justify-between px-3 py-3 sm:px-5 sm:py-4">
                        {/* The bare 16px chevron was the only reliable target and
                            the row shrank to its content, so the empty space beside
                            the title did nothing. Now the whole strip toggles and
                            the chevron is the same control the board and the task
                            list use to fold a section: ghost, `icon-sm`, a 28px
                            box that lines up with the `sm` buttons beside it. It
                            was a 20px box, which made the one
                            accordion in the product that collapses a group of
                            tasks look like a different kind of control from the
                            two others that do exactly that. */}
                        <div
                          className="-my-2 -ml-2 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-[10px] py-2 pl-2 pr-3 transition-colors hover:bg-line"
                          onClick={() => toggleSection(sprint.id, isExpanded)}
                          role="button"
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          onKeyDown={event => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            toggleSection(sprint.id, isExpanded);
                          }}
                        >
                          <Button
                            style="ghost"
                            size="icon-xs"
                            icon={isExpanded ? ChevronDown : ChevronRight}
                            className="shrink-0 hover:!bg-white"
                            aria-expanded={isExpanded}
                            title={isExpanded ? 'Згорнути спринт' : 'Розгорнути спринт'}
                            aria-label={`${isExpanded ? 'Згорнути' : 'Розгорнути'} спринт ${sprint.name}`}
                          />
                          <h3 className="ui-type-card-title text-ink truncate">{sprint.name}</h3>
                          {sprint.status === 'active' && <StatusPill label="Активний" color="#10b981" />}
                          {sprint.status === 'planned' && <StatusPill label="Запланований" color="#9a9a9a" />}
                          {/* QUI-135. `#cbd5e1` on its own 9% tint scored ~1.5:1 —
                              the label was there but unreadable. A finished sprint
                              is closed, so it takes the ink tone: definitive, and
                              distinct from active green and planned grey. */}
                          {sprint.status === 'completed' && <StatusPill label="Завершено" color="#1f1f1f" />}
                          <span className="text-[11px] text-muted shrink-0 max-sm:hidden">
                            {sprintIssues.length} {plural(sprintIssues.length, ['завдання', 'завдання', 'завдань'])}
                          </span>
                          {sprint.startDate && (
                            <span className="text-[11px] text-muted hidden sm:inline ml-2">
                              {formatSprintDates(sprint.startDate, sprint.endDate)}
                            </span>
                          )}
                        </div>

                        {/* Дві квадратні кнопки на обох ширинах. Рядок колись
                            просив у телефона заголовок, статус, лічильник,
                            кебаб, підписану головну кнопку і ще два квадрати —
                            тепер кожна управлінська дія живе в кебабі, і на
                            десктопі теж: шапка спринта скрізь читається
                            однаково.

                            «+» не створює завдання одразу, а питає, що саме
                            додати: створити нове чи взяти вже наявне. Другий
                            варіант — це те саме перетягування з «Без спринта»,
                            сказане словами; на телефоні цього жесту немає, а на
                            чотирьохстах завданнях він повільний і на десктопі. */}
                        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
                          <ContextMenu
                            trigger={(
                              <Button
                                style="ghost"
                                size="icon-xs"
                                icon={Plus}
                                className="hover:!bg-white"
                                aria-label={`Додати завдання у спринт ${sprint.name}`}
                                title="Додати завдання у спринт"
                              />
                            )}
                            items={[
                              {
                                label: 'Створити завдання',
                                icon: Plus,
                                onClick: () => { setCreateTaskSprintId(sprint.id); setShowCreateTaskModal(true); },
                              },
                              {
                                label: 'Додати існуюче',
                                icon: ListPlus,
                                onClick: () => setAddExistingSprint(sprint),
                              },
                            ]}
                          />
                          <ContextMenu
                            trigger={(
                              <Button
                                style="ghost"
                                size="icon-xs"
                                icon={MoreVertical}
                                composition="section-kebab"
                                className="hover:!bg-white"
                                aria-label={`Дії зі списком ${sprint.name}`}
                                title="Дії зі списком"
                              />
                            )}
                            items={[
                              {
                                label: sprintIssues.length > 0 && sprintIssues.every(issue => activeSelectedIssueIds.has(issue.id))
                                  ? 'Зняти вибір у списку'
                                  : 'Вибрати всі у списку',
                                icon: CheckSquare,
                                onClick: () => toggleSectionSelection(sprintIssues),
                              },
                              ...(isManager ? [
                                { isDivider: true },
                                ...(sprint.status === 'planned' ? [{
                                  label: 'Почати спринт',
                                  icon: Play,
                                  onClick: () => handleStartSprint(sprint.id),
                                }] : []),
                                ...(sprint.status === 'active' ? [{
                                  label: 'Завершити спринт',
                                  icon: Check,
                                  onClick: () => setShowCompleteSprintModal(sprint),
                                }] : []),
                                { label: 'Редагувати', icon: Edit2, onClick: () => setEditingSprint(sprint) },
                                ...(sprint.status !== 'active' ? [{
                                  label: 'Видалити',
                                  icon: Trash2,
                                  isDanger: true,
                                  onClick: async () => {
                                    if (await confirmDialog({ title: 'Видалити спринт?', confirmText: 'Видалити', danger: true })) deleteSprint(sprint.id);
                                  },
                                }] : []),
                              ] : []),
                            ]}
                          />
                        </div>
                      </div>

                      {/* The count moves under the title on a phone, where the
                          header line has no room for it, and takes the dates
                          with it. */}
                      <p className="px-3 pb-1 text-[11px] text-muted sm:hidden">
                        {sprintIssues.length} {plural(sprintIssues.length, ['завдання', 'завдання', 'завдань'])}
                        {sprint.startDate ? ` · ${formatSprintDates(sprint.startDate, sprint.endDate)}` : ''}
                      </p>

                      {isExpanded && sprint.goal && (
                        <p className="px-3 pb-2 text-[12px] text-muted italic sm:px-5">Ціль: {sprint.goal}</p>
                      )}

                      {isExpanded && (
                        renderIssueTable(sprintIssues, sprint.id)
                      )}
                    </div>
                  );
                })}
                {sprints.length === 0 && (
                  <div data-ui-surface="local" className="py-12 text-center text-[13px] text-faint bg-canvas rounded-[16px]">
                    {isManager
                      ? 'Немає запланованих або активних спринтів. Створіть новий спринт, щоб розпочати планування.'
                      : 'Немає запланованих або активних спринтів. Попросіть адміністратора створити спринт для планування роботи.'}
                  </div>
                )}
              </div>

              {/* Right column mirrors the global board column contract.
                  Collapsing it is a two-column idea: below lg the list is not
                  beside anything, so a 48px vertical spine of text would be a
                  stranger sitting under the sprints rather than a folded
                  column. */}
              {backlogCollapsed && !isPhone ? (
                <div
                  data-ui-surface="local"
                  className="flex w-[48px] shrink-0 cursor-pointer flex-col items-center justify-start rounded-[16px] bg-canvas pb-2 pt-4 transition-colors hover:bg-line"
                  onClick={() => setBacklogCollapsed(false)}
                  role="button"
                  tabIndex={0}
                  aria-expanded={false}
                  onKeyDown={event => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setBacklogCollapsed(false);
                  }}
                >
                  <Button
                    style="ghost"
                    size="icon-xs"
                    icon={ChevronRight}
                    className="mb-4 hover:!bg-white"
                    title="Розгорнути колонку завдань"
                  />
                  <span className="mb-4 h-[8px] w-[8px] shrink-0 rounded-full bg-muted" />
                  <h3
                    className="ui-type-column-title whitespace-nowrap text-ink"
                    style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
                  >
                    Без спринта
                  </h3>
                  <Pill tone="count" size="md" className="mt-4">{backlogIssues.length}</Pill>
                </div>
              ) : (
                <Surface
                  preset="panel"
                  padding="none"
                  composition="scroll-pane"
                  className="flex w-full shrink-0 flex-col overflow-hidden lg:w-[280px]"
                >
                  {/* A board column header, drawn exactly as the board draws
                      one: no rule under it. The panel already separates the
                      column from the page, so the line only announced that this
                      one column came from somewhere else. */}
                  <div className="flex shrink-0 items-center justify-between px-4 pb-3 pt-4">
                    <div className="flex items-center gap-[6px]">
                      <Button
                        onClick={() => setBacklogCollapsed(true)}
                        style="ghost"
                        size="icon-xs"
                        icon={ChevronLeft}
                        className="-ml-2 hover:!bg-white max-lg:hidden"
                        title="Згорнути колонку завдань"
                      />
                      <span className="h-[8px] w-[8px] rounded-full bg-muted" />
                      <h3 className="ui-type-column-title text-ink">Без спринта</h3>
                      <Pill tone="count" size="md" className="ml-1">{backlogIssues.length}</Pill>
                    </div>
                    <div className="flex items-center gap-1">
                      <ContextMenu
                        trigger={(
                          <Button
                            style="ghost"
                            size="icon-xs"
                            icon={MoreVertical}
                            composition="section-kebab"
                            className="hover:!bg-white"
                            aria-label="Дії зі списком без спринта"
                            title="Дії зі списком"
                          />
                        )}
                        items={[{
                          label: backlogIssues.length > 0 && backlogIssues.every(issue => activeSelectedIssueIds.has(issue.id))
                            ? 'Зняти вибір у списку'
                            : 'Вибрати всі у списку',
                          icon: CheckSquare,
                          onClick: () => toggleSectionSelection(backlogIssues),
                        }]}
                      />
                      <Button
                        onClick={() => { setCreateTaskSprintId(null); setShowCreateTaskModal(true); }}
                        style="ghost"
                        size="icon-xs"
                        icon={Plus}
                        className="hover:!bg-white"
                        title="Додати завдання без спринту"
                      />
                    </div>
                  </div>
                  {renderBacklogList()}
                </Surface>
              )}

            </div>
          </DragDropContext>
        </div>
      )}

      <BulkActionBar
        count={activeSelectedIssueIds.size}
        progress={bulkProgress}
        statusOptions={categoryColumns.map(category => ({
          value: category.id,
          label: category.label,
          dotColor: category.color,
        }))}
        memberOptions={activeMembers(members).map(member => ({
          value: member.id || member.uid,
          label: member.name || member.email || 'Учасник',
          user: member,
        }))}
        priorityOptions={prioritySelectOptions(priorities)}
        labelOptions={labels.map(label => ({ value: label.id, label: label.label, dotColor: label.color }))}
        typeOptions={types.filter(type => type.id !== 'epic').map(taskTypeSelectOption)}
        sprintOptions={sprints.filter(sprint => sprint.status !== 'completed').map(sprint => ({
          value: sprint.id,
          label: sprint.name,
        }))}
        canArchive={canWhileRoleLoads(orgRole, 'delete:issue')}
        onApply={handleBulkUpdate}
        onClear={clearSelection}
      />

      {/* Edit Sprint Modal */}
      {editingSprint && (
        <SprintEditModal
          sprint={editingSprint}
          onClose={() => setEditingSprint(null)}
          onSave={async (updates) => {
            try {
              await updateSprint(editingSprint.id, updates);
              setEditingSprint(null);
              showToast('Спринт оновлено');
            } catch (err) {
              console.error(err);
              showToast('Помилка оновлення спринта');
            }
          }}
        />
      )}

      {/* Add Existing Issues Dialog */}
      {addExistingSprint && (
        <AddExistingIssuesDialog
          sprint={addExistingSprint}
          issues={issues}
          sprints={sprints}
          members={members}
          labels={labels}
          issueLinks={issueLinks}
          projects={projects}
          closedStatusIds={closedStatusIds}
          onClose={() => setAddExistingSprint(null)}
          onAdd={issueIds => handleAddExistingIssues(addExistingSprint.id, issueIds)}
        />
      )}

      {/* Create Sprint Modal */}
      {showCreateSprintModal && (
        <SprintCreateModal
          onClose={() => setShowCreateSprintModal(false)}
          onSave={handleCreateSprint}
        />
      )}

      {/* Complete Sprint Modal */}
      {showCompleteSprintModal && (
        <SprintCompleteModal
          sprint={showCompleteSprintModal}
          sprints={sprints}
          incompleteIssues={issues.filter(i => i.sprintId === showCompleteSprintModal.id && !isClosedCol(i.status) && !isClosedCol(i.columnId))}
          onClose={() => setShowCompleteSprintModal(null)}
          onConfirm={async (moveToSprintId) => {
            try {
              await completeSprint(showCompleteSprintModal.id, moveToSprintId);
              setShowCompleteSprintModal(null);
              showToast('Спринт успішно завершено');
            } catch (err) {
              console.error(err);
              showToast('Помилка завершення спринта');
            }
          }}
        />
      )}

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={showCreateTaskModal}
        initialSprintId={createTaskSprintId}
        onClose={() => { setShowCreateTaskModal(false); setCreateTaskSprintId(null); }}
        onSubmit={async (formData) => {
          if (!formData.projectId) {
            throw new Error('Будь ласка, оберіть проєкт');
          }
          const created = await createIssueViaApi({
            organizationId: activeOrgId,
            projectId: formData.projectId,
            data: {
              title: formData.title,
              description: formData.description || '',
              status: formData.status || 'backlog',
              priority: formData.priority || NO_PRIORITY_ID,
              type: formData.type || 'task',
              assigneeIds: formData.assignees || [],
              labelIds: formData.labelIds || [],
              dueDate: formData.dueDate || null,
              estimateMinutes: formData.estimateMinutes || 0,
              sprintId: formData.sprintId || null,
              reporterId: currentUser?.uid || currentUser?.id,
              addAssigneesToProjectTeam: formData.addAssigneesToProjectTeam === true,
            },
          });

          showToast('Задачу створено');
          return { ...created, projectId: formData.projectId };
        }}
        projects={projects}
        teamMembers={members}
        sprints={sprints}
      />

      {/* Issue Detail Modal */}
      {activeIssue && (
        <IssueModal
          issue={activeIssue}
          onClose={() => setActiveIssue(null)}
        />
      )}
      </div>
    </div>
  );
}
