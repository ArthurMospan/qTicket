'use client';
// src/components/CreateTaskModal.jsx — Light theme modal
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import { uploadFile } from '@/lib/utils/uploadFile';
import { hasProjectAccess, hasRecordedTeam, isOnProjectTeam, isPrivilegedRole } from '@/lib/utils/projectAccess.mjs';
import { Check, Play, Tag as TagIcon } from 'lucide-react';
import { PlanCrownIcon, TaskIcon } from '@/lib/design/icons';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import MarkdownEditor from '@/components/ui/Forms/MarkdownEditor';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { resolveCategoryStatusId } from '@/lib/utils/statusCategories.mjs';
import { Select } from '@/components/ui/Select';
import Button from '@/components/ui/Button';
import Dialog from '@/components/ui/Dialog';
import Label from '@/components/ui/Forms/Label';
import FormGroup from '@/components/ui/Forms/FormGroup';
import SelectableChip from '@/components/ui/Forms/SelectableChip';
import { Input } from '@/components/ui/Input';
import { DatePicker } from '@/components/ui/Forms/DatePicker';
import { fromDateInput } from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import Tabs from '@/components/ui/Tabs';
import AudioTaskPanel from '@/components/AudioTaskPanel';
import { usePlanLimits } from '@/lib/hooks/usePlanLimits';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import Alert from '@/components/ui/Feedback/Alert';
import Checkbox from '@/components/ui/Forms/Checkbox';
import ToggleSwitch from '@/components/ui/Forms/ToggleSwitch';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { issuePath } from '@/lib/utils/issueKeys.mjs';
import {
  MAX_ISSUE_ESTIMATE_HOURS,
  clampIssueEstimateHours,
  issueEstimateHoursError,
} from '@/lib/utils/issueEstimate.mjs';



// `initialCategory` is what the «+» on a category column of «Мої завдання»
// asks for: the composer has no project yet, and a category has a different
// status in every project, so the status can only be resolved once a project is
// chosen — and again if it is changed.
export default function CreateTaskModal({ isOpen, onClose, onSubmit, stages, teamMembers = [], projects = null, projectContext = null, sprints = [], initialStatus = null, initialCategory = null, initialAssignees = null, initialSprintId = null, entity = 'incident', clientMode = false }) {
  const router = useRouter();
  const { currentUser, activeOrg, orgRole } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const { labels: availableLabels = [], statuses = [], types = [], priorities = [] } = useWorkflowConfig();
  const incidentComposer = entity === 'incident';
  const [mode, setMode] = useState('task');
  // «AI Аудіо-завдання / міс» is a ceiling the price list has always carried, and
  // until now nothing counted it. The tab reads it before anything is uploaded.
  const planLimits = usePlanLimits();
  const aiCallsBlocked = planLimits.blocked('aiCalls');
  const openPlanUpgrade = useWorkspaceStore(state => state.openPlanUpgrade);

  const [form, setForm] = useState({
    title: '', description: '', status: 'backlog',
    priority: NO_PRIORITY_ID, type: 'task',
    assignees: [], labelIds: [], dueDate: '',
    estimateHours: '',
    projectId: projects && projects.length > 0 ? projects[0].id : '',
    sprintId: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [draftTouched, setDraftTouched] = useState(false);
  // Missing required fields are reported under the field that is missing, the
  // same way the project dialog does it. The submit button used to be disabled
  // instead, which says "you cannot do this" without ever saying why.
  const [fieldErrors, setFieldErrors] = useState({});
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [createAnother, setCreateAnother] = useState(false);
  // Putting somebody on a project is its own decision, taken here, once, and
  // never carried over: a different project is a different question, so
  // changing the project puts this back to «ні».
  const [addToProjectTeam, setAddToProjectTeam] = useState(false);
  const titleInputRef = useRef(null);

  const selectedProject = projects?.find(p => p.id === form.projectId) || projectContext;
  const activeHiddenCols = selectedProject?.hiddenColumns;

  // Who this task may be given to, decided from the project that is selected
  // right now rather than from whatever list the caller happened to pass.
  //
  // Three of the four places that open this composer handed it the whole
  // organization — «Мої завдання», «Спринти» and the projects page all ask for
  // a project *inside* the dialog, so there was no project to scope by when
  // they built their list. The result was a task assigned to somebody who is
  // not on its project: they cannot open it, and the board silently drops their
  // face, because a card resolves faces from the project's team. The dialog
  // knows which project is selected, so the dialog is where this belongs.
  //
  // Adding somebody to a project is `manage:team`. An owner or an admin may
  // hand work to a person outside it, but only by saying so: the tick box below
  // is the whole of that decision, and it starts off. Anybody else is only
  // offered the people who are already there, because an assignment they are
  // not allowed to complete is a dead end, not a permission prompt.
  const mayGrantProjectAccess = isPrivilegedRole(orgRole);
  // Access: the organization directory carries each colleague's role, so an
  // owner or an admin — who reaches every project without being listed on one —
  // never counts as locked out.
  const memberReachesProject = useMemo(() => member => {
    if (!selectedProject || !hasRecordedTeam(selectedProject)) return true;
    return hasProjectAccess(selectedProject, member.role || null, member.uid || member.id);
  }, [selectedProject]);
  // Roster: whether the project actually names them. An admin reaches the
  // project and is still absent from it, which is exactly the case that used to
  // slip through — assigned the work, missing from the card.
  const memberOnProjectRoster = useMemo(() => member => {
    if (!selectedProject || !hasRecordedTeam(selectedProject)) return true;
    return isOnProjectTeam(selectedProject, member.uid || member.id);
  }, [selectedProject]);

  // Anyone the composer was opened with stays on the list even when they are
  // not on the project — «Команда» → учасник → «Створити завдання» is exactly
  // that case, and dropping the person the dialog was opened for would be a
  // stranger answer than saying what will happen to them.
  const preselected = useMemo(() => new Set(initialAssignees || []), [initialAssignees]);
  const assignableMembers = useMemo(() => (teamMembers || []).filter(member => {
    const uid = member.uid || member.id;
    return memberReachesProject(member) || preselected.has(uid) || mayGrantProjectAccess;
  }), [teamMembers, memberReachesProject, preselected, mayGrantProjectAccess]);

  // Selected people the project does not name. The tick box adds these.
  const assigneesJoiningProject = useMemo(() => (assignableMembers || []).filter(member => {
    const uid = member.uid || member.id;
    return form.assignees.includes(uid) && !memberOnProjectRoster(member);
  }), [assignableMembers, form.assignees, memberOnProjectRoster]);
  // The subset of those who cannot open the project either. For them the tick
  // box is not an option — without it the task would be a note about somebody
  // rather than work assigned to them — so it holds up the submit.
  const assigneesLockedOut = useMemo(() => assigneesJoiningProject.filter(
    member => !memberReachesProject(member),
  ), [assigneesJoiningProject, memberReachesProject]);
  const availableSprints = useMemo(
    () => (sprints || []).filter(sprint => sprint.status !== 'completed'),
    [sprints],
  );
  const visibleStatuses = useMemo(
    () => statuses.filter(s => !(activeHiddenCols || []).includes(s.id)),
    [statuses, activeHiddenCols],
  );
  const creatableTypes = useMemo(
    () => types.filter(type => type.id !== 'epic'),
    [types],
  );
  // Resolved against the whole workflow, never against the already-filtered
  // list: a status's category is read from its place in the full workflow.
  const categoryStatusId = useMemo(
    () => (initialCategory
      ? resolveCategoryStatusId(initialCategory, statuses, {
        hiddenStatusIds: activeHiddenCols || [],
      })
      : null),
    [activeHiddenCols, initialCategory, statuses],
  );
  const defaultStatusId = () => (
    initialStatus
    || categoryStatusId
    || resolveCategoryStatusId('backlog', statuses, {
      hiddenStatusIds: activeHiddenCols || [],
    })
    || visibleStatuses[0]?.id
    || 'backlog'
  );

  const initialForm = () => ({
    title: '',
    description: '',
    status: defaultStatusId(),
    priority: NO_PRIORITY_ID,
    type: 'task',
    assignees: clientMode
      ? []
      : initialAssignees?.length
      ? initialAssignees
      : [currentUser?.id || currentUser?.uid].filter(Boolean),
    labelIds: [],
    dueDate: '',
    estimateHours: '',
    projectId: projects?.[0]?.id || projectContext?.id || '',
    // Планування спринтів на телефоні — це не перетягування картки, а «додати
    // завдання сюди». Спринт, з якого відкрили діалог, уже обраний.
    sprintId: initialSprintId || '',
  });

  const resetDraft = () => {
    setMode('task');
    setForm(initialForm());
    setError('');
    setFieldErrors({});
    setDraftTouched(false);
    setCreateAnother(false);
    setAddToProjectTeam(false);
  };

  const resetForAnother = () => {
    setMode('task');
    // Keep the routing/context choices that make a run of similar tasks fast,
    // but clear the content that would accidentally duplicate real work.
    setForm(current => ({
      ...initialForm(),
      projectId: current.projectId,
      status: current.status,
      priority: current.priority,
      type: current.type,
      assignees: current.assignees,
      sprintId: current.sprintId,
    }));
    setError('');
    setFieldErrors({});
    setDraftTouched(false);
    // «Створити ще одне» keeps the routing choices, and this is not one of them:
    // the people it named have just been added, so the next task starts with
    // nothing to consent to. If it names somebody new, it asks again.
    setAddToProjectTeam(false);
    requestAnimationFrame(() => titleInputRef.current?.focus());
  };

  const closeAndReset = () => {
    if (loading) return;
    resetDraft();
    onClose();
  };

  // Reset when the dialog *opens*, not whenever the values the reset reads
  // happen to change identity. `visibleStatuses` is a useMemo over
  // `activeHiddenCols`, which comes off `projectContext` — and the project page
  // builds that as a fresh object literal every render. With those in the
  // dependency list the reset ran on ordinary re-renders, and `setMode('task')`
  // pulled the tab back to «Завдання» mid-work: that unmounts AudioTaskPanel,
  // so a set of AI-generated drafts disappeared with it. The ref makes the
  // open transition the trigger; the dependencies stay so the reset still reads
  // current values on the render that opens it.
  const hasOpened = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      hasOpened.current = false;
      return;
    }
    if (hasOpened.current) return;
    hasOpened.current = true;
    queueMicrotask(() => {
      resetDraft();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialAssignees, initialStatus, initialSprintId, categoryStatusId, visibleStatuses, projects]);

  useEffect(() => {
    if (isOpen && form.status) {
      const isValid = visibleStatuses.some(s => s.id === form.status);
      if (!isValid && visibleStatuses.length > 0) {
        // Switching the project keeps the *category* the column asked for and
        // takes that project's status for it; falling straight to the first
        // visible status would quietly move the task to another column.
        const next = categoryStatusId || visibleStatuses[0].id;
        queueMicrotask(() => setForm(f => ({ ...f, status: next })));
      }
    }
  }, [categoryStatusId, form.projectId, form.status, isOpen, visibleStatuses]);

  useEffect(() => {
    if (isOpen && form.sprintId && !availableSprints.some(sprint => sprint.id === form.sprintId)) {
      queueMicrotask(() => setForm(current => ({ ...current, sprintId: '' })));
    }
  }, [availableSprints, form.sprintId, isOpen]);

  useEffect(() => {
    if (isOpen && !creatableTypes.some(type => type.id === form.type)) {
      queueMicrotask(() => setForm(current => ({
        ...current,
        type: creatableTypes.find(type => type.id === 'task')?.id || creatableTypes[0]?.id || 'task',
      })));
    }
  }, [creatableTypes, form.type, isOpen]);

  if (!isOpen) return null;

  const set = (key, val) => {
    setForm(f => ({ ...f, [key]: val }));
    setDraftTouched(true);
    // The message goes as soon as the reason for it does.
    setFieldErrors(current => (current[key] ? { ...current, [key]: '' } : current));
    // Consent was given about one project, and this is now a different one.
    if (key === 'projectId') setAddToProjectTeam(false);
  };

  const toggleAssignee = (uid) => {
    setDraftTouched(true);
    setForm(current => ({
      ...current,
      assignees: current.assignees.includes(uid)
        ? current.assignees.filter(assignee => assignee !== uid)
        : [...current.assignees, uid],
    }));
  };

  const toggleLabel = (labelId) => {
    set('labelIds', form.labelIds.includes(labelId)
      ? form.labelIds.filter(id => id !== labelId)
      : [...form.labelIds, labelId]);
  };

  // «Прикріпити файл» in the composer's editor.
  //
  // The button was missing here and present on the task's own screen, which
  // reads as a gap rather than a decision — MarkdownEditor draws it only when
  // it is handed an `onUploadFiles`, and this call site never handed it one.
  //
  // What it does is the editor's half of that contract and not the task
  // screen's: the file is uploaded and its link is written into the
  // description. It does not join the «Вкладення» section, because there is no
  // task yet to attach it to and the create route accepts a named list of
  // fields that does not include one — putting client-supplied URLs into that
  // list is a server change with its own review, not a side effect of adding a
  // button. In the description the file is a link like any other, which is what
  // the paperclip in a markdown editor means everywhere else.
  const handleUploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    const organizationId = activeOrg?.id || '';
    if (files.length === 0 || !organizationId) return [];
    setUploadingFiles(true);
    try {
      return await Promise.all(files.map(file =>
        uploadFile(file, `organizations/${organizationId}/attachments`)));
    } catch (uploadError) {
      setError(uploadError.message || 'Не вдалося завантажити файл');
      return [];
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const nextErrors = {};
    if (!form.title.trim()) nextErrors.title = incidentComposer ? 'Вкажіть тему інциденту' : 'Вкажіть назву завдання';
    const estimateError = clientMode ? '' : issueEstimateHoursError(form.estimateHours);
    if (estimateError) nextErrors.estimateHours = estimateError;
    if (projects && projects.length > 0 && !form.projectId) {
      nextErrors.projectId = 'Оберіть проєкт';
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      return;
    }
    // A task whose assignee cannot open its project is not work handed to
    // somebody, it is a note about them. The server refuses it too; saying so
    // here means the answer arrives before the round trip.
    if (!clientMode && assigneesLockedOut.length > 0 && !addToProjectTeam) {
      setFieldErrors({});
      setError(mayGrantProjectAccess
        ? 'Позначте «Додати до складу проєкту» або приберіть виконавця, який не має доступу.'
        : 'Приберіть виконавця, який не входить до складу проєкту.');
      return;
    }
    setFieldErrors({});
    setLoading(true);
    setError('');
    try {
      const submitted = clientMode
        ? {
            title: form.title,
            description: form.description,
            projectId: form.projectId,
            createdBy: currentUser?.id || currentUser?.uid,
          }
        : {
            ...form,
            createdBy: currentUser?.id || currentUser?.uid,
            dueDate: form.dueDate
              ? fromDateInput(form.dueDate, { endOfDay: true, timeZone })
              : null,
            estimateMinutes: form.estimateHours ? Math.round(parseFloat(form.estimateHours) * 60) : 0,
            sprintId: form.sprintId || null,
            // Only ever true because somebody ticked the box above. The server
            // writes `project.team` on this flag and on nothing else.
            addAssigneesToProjectTeam: addToProjectTeam && assigneesJoiningProject.length > 0,
          };
      const created = await onSubmit(submitted);
      if (createAnother) {
        resetForAnother();
        return;
      }

      const createdProjectId = created?.projectId || submitted.projectId || projectContext?.id;
      const createdProject = projects?.find(project => project.id === createdProjectId)
        || (projectContext?.id === createdProjectId ? projectContext : createdProjectId);
      resetDraft();
      onClose();
      if (created?.id && createdProjectId) {
        router.push(issuePath(created, createdProject));
      }
    } catch (err) {
      console.error('[CreateTask]', err);
      setError(userFacingErrorMessage(
        err,
        incidentComposer ? 'Не вдалося створити інцидент' : 'Не вдалося створити завдання',
      ));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeAndReset}
      title={incidentComposer ? 'Новий інцидент' : 'Нове завдання'}
      size="lg"
      bodyPadding="flush"
      isDirty={mode === 'task' && draftTouched}
      closeConfirmation="Закрити форму й втратити незбережені зміни?"
      footer={mode === 'task' ? (
        <>
          {!clientMode && (
            <ToggleSwitch
              checked={createAnother}
              onChange={setCreateAnother}
              size="sm"
              label="Створити ще одне"
              className="mr-auto self-center"
            />
          )}
          <Button style="secondary" size="md" onClick={closeAndReset} type="button">
            Скасувати
          </Button>
          <Button
            type="submit"
            form="create-task-form"
            style="primary"
            size="md"
            disabled={!clientMode && creatableTypes.length === 0}
            loading={loading}
          >
            {loading ? 'Створення...' : incidentComposer ? 'Створити інцидент' : 'Створити завдання'}
          </Button>
        </>
      ) : undefined}
    >
        {!clientMode && (
        <div className="border-b border-line px-5 py-3 sm:px-7">
          <Tabs
            tabs={[
              { id: 'task', label: 'Інцидент', icon: TaskIcon },
              // The crown replaces the play glyph when the month's calls are
              // spent, or when the plan never had them: the tab still opens
              // something, and what it opens is the price list on that ceiling
              // rather than a panel that would be refused after an upload.
              {
                id: 'audio',
                label: 'Аудіо-інцидент (AI)',
                icon: aiCallsBlocked ? PlanCrownIcon : Play,
                title: aiCallsBlocked ? planLimits.notice('aiCalls').title : undefined,
              },
            ]}
            activeTab={mode}
            onTabChange={next => (next === 'audio' && aiCallsBlocked
              ? openPlanUpgrade({ limitId: 'aiCalls' })
              : setMode(next))}
            composition="pane-switch"
          />
        </div>
        )}

        {mode === 'task' ? (
        <form
          id="create-task-form"
          onSubmit={handleSubmit}
          noValidate
          className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 sm:p-7 lg:grid-cols-2"
        >
          {error && (
            <div role="alert" className="lg:col-span-2">
              <Alert
                variant="error"
                title={incidentComposer ? 'Не вдалося створити інцидент' : 'Не вдалося створити завдання'}
                description={error}
              />
            </div>
          )}

          {/* Title */}
          <FormGroup label="Назва" required error={fieldErrors.title} className="lg:col-span-2">
            <Input
              ref={titleInputRef}
              autoFocus
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder={incidentComposer ? 'Коротко опишіть проблему або запит' : 'Що потрібно зробити?'}
              error={Boolean(fieldErrors.title)}
            />
          </FormGroup>

          {/* Project Selector (if projects passed) */}
          {projects && projects.length > 0 && (
            <FormGroup label="Проєкт" required error={fieldErrors.projectId}>
              <Select
                value={form.projectId}
                onChange={val => set('projectId', val)}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="Оберіть проєкт..."
              />
            </FormGroup>
          )}

          {/* Somebody being added to the project is a decision about the
              project, so it is asked here, beside the project — not at the
              bottom of the form under the assignee chips, where the form is
              already scrolled past by the time it appears.

              One colour and one sentence, whatever the person's role. The two
              branches this used to have explained our access model to somebody
              who had asked to give a colleague a task: one of them said the
              assignee «has access by role but will not be visible on the
              project card», which is a sentence about our data model, not about
              their work. */}
          {!clientMode && assigneesJoiningProject.length > 0 && (
            <div className="lg:col-span-2">
              <Alert
                variant="warning"
                title={assigneesJoiningProject.length === 1
                  ? 'Цього учасника немає в проєкті'
                  : 'Цих учасників немає в проєкті'}
              >
                <div className="flex flex-col gap-2">
                  <span>
                    {assigneesJoiningProject.map(m => m.name || m.email).join(', ')} — не у складі проєкту
                    {selectedProject?.name ? ` «${selectedProject.name}»` : ''}.
                  </span>
                  {mayGrantProjectAccess ? (
                    <Checkbox
                      size="sm"
                      checked={addToProjectTeam}
                      onChange={setAddToProjectTeam}
                      label={`Додати до проєкту${selectedProject?.name ? ` «${selectedProject.name}»` : ''}`}
                    />
                  ) : (
                    <span>Призначити не вдасться — попросіть власника або адміністратора додати до проєкту.</span>
                  )}
                </div>
              </Alert>
            </div>
          )}

          {/* Description */}
          <div className="flex flex-col gap-[6px] lg:col-span-2">
            <Label>{incidentComposer ? 'Опис звернення' : 'Опис'}</Label>
            <MarkdownEditor
              value={form.description}
              onChange={(val) => set('description', val)}
              onUploadFiles={handleUploadFiles}
              uploading={uploadingFiles}
              placeholder={incidentComposer ? 'Опишіть ситуацію, очікуваний результат і додайте файли або посилання…' : 'Додайте деталі, чеклісти, посилання...'}
              minHeight="120px"
            />
          </div>

          {/* Metadata controls share one grid, so every field has identical
              geometry and a deterministic reading order. */}
          {!clientMode && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 lg:col-span-2">
            <div className="flex flex-col gap-[6px]">
              <Label>Тип</Label>
              <Select
                value={form.type}
                onChange={val => set('type', val)}
                options={creatableTypes.map(taskTypeSelectOption)}
                placeholder={creatableTypes.length > 0 ? 'Оберіть тип' : 'Додайте тип у налаштуваннях'}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <Label>Пріоритет</Label>
              <Select
                value={form.priority}
                onChange={val => set('priority', val)}
                options={prioritySelectOptions(priorities)}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <Label>Статус</Label>
              <Select
                value={form.status}
                onChange={val => set('status', val)}
                options={visibleStatuses.map(s => ({
                  value: s.id,
                  label: s.label,
                  dotColor: s.color,
                }))}
              />
            </div>
            {availableSprints.length > 0 && (
              <div className="flex flex-col gap-[6px]">
                <Label>Спринт</Label>
                <Select
                  value={form.sprintId}
                  onChange={val => set('sprintId', val)}
                  options={[
                    { value: '', label: 'Без спринта' },
                    ...availableSprints.map(s => ({ value: s.id, label: s.name }))
                  ]}
                  placeholder="Оберіть спринт..."
                />
              </div>
            )}
            <div className="flex flex-col gap-[6px]">
              <Label>Дедлайн</Label>
              <DatePicker
                value={form.dueDate}
                onChange={value => set('dueDate', value)}
                placeholder="Без дедлайну"
              />
            </div>
            <FormGroup label="Оцінка (год)" error={fieldErrors.estimateHours}>
              <Input
                type="number"
                min="0"
                max={MAX_ISSUE_ESTIMATE_HOURS}
                step="0.5"
                value={form.estimateHours}
                onChange={event => {
                  const next = clampIssueEstimateHours(event.target.value);
                  setForm(current => ({ ...current, estimateHours: next.value }));
                  setDraftTouched(true);
                  setFieldErrors(current => ({ ...current, estimateHours: next.error }));
                }}
                placeholder="0"
                error={Boolean(fieldErrors.estimateHours)}
              />
            </FormGroup>
          </div>
          )}

          {/* Assignees */}
          {!clientMode && assignableMembers.length > 0 && (
            <div className="flex flex-col gap-[6px] lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Виконавці</Label>
                <span className="text-[10px] font-medium text-muted">Можна вибрати кількох</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {assignableMembers.map(m => {
                  const uid = m.uid || m.id;
                  const selected = form.assignees.includes(uid);
                  // Two different reasons a chip is marked. Off the roster is
                  // what the note below is about; locked out is what a member
                  // may not do anything about, and only that disables a chip —
                  // an admin who reaches the project without being on it is
                  // still somebody a member can hand work to.
                  const joining = !memberOnProjectRoster(m);
                  const lockedOut = !memberReachesProject(m);
                  return (
                    <SelectableChip
                      key={uid}
                      shape="person"
                      selected={selected}
                      disabled={lockedOut && !mayGrantProjectAccess}
                      title={joining
                        ? `Не входить до складу проєкту${selectedProject?.name ? ` «${selectedProject.name}»` : ''}`
                        : undefined}
                      onClick={() => toggleAssignee(uid)}
                    >
                      <span aria-hidden="true"><UserAvatar user={m} size="xs" /></span>
                      <span className="max-w-[180px] truncate">{m.name || m.email}</span>
                      {selected && <Check size={12} className="shrink-0" />}
                    </SelectableChip>
                  );
                })}
              </div>
              <p className="text-[10px] leading-[1.4] text-muted">
                У персональній аналітиці завдання врахується кожному вибраному виконавцю.
              </p>
            </div>
          )}

          {/* Labels */}
          {!clientMode && availableLabels.length > 0 && (
            <div className="flex flex-col gap-[6px] lg:col-span-2">
              <Label>Мітки (Теги)</Label>
              <div className="flex flex-wrap gap-2">
                {availableLabels.map(l => {
                  const selected = form.labelIds.includes(l.id);
                  return (
                    <SelectableChip
                      key={l.id}
                      shape="label"
                      selected={selected}
                      tone={l.color}
                      onClick={() => toggleLabel(l.id)}
                    >
                      <TagIcon size={10} className="shrink-0 opacity-70" />
                      {l.label}
                    </SelectableChip>
                  );
                })}
              </div>
            </div>
          )}

        </form>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 sm:p-7">
            <AudioTaskPanel
              projects={projects || []}
              projectContext={projectContext}
              teamMembers={teamMembers}
              onSubmit={onSubmit}
              onFinished={onClose}
            />
          </div>
        )}
    </Dialog>
  );
}
