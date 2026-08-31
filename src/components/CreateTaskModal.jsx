'use client';
// src/components/CreateTaskModal.jsx — Light theme modal
import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAppContext } from '@/lib/context/AppContext';
import { uploadFile } from '@/lib/utils/uploadFile';
import { hasProjectAccess, hasRecordedTeam, isOnProjectTeam, isPrivilegedRole } from '@/lib/utils/projectAccess.mjs';
import { Check, Tag as TagIcon } from 'lucide-react';
import UserAvatar from '@/components/ui/DataDisplay/UserAvatar';
import MarkdownEditor from '@/components/ui/Forms/MarkdownEditor';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { incidentTerms } from '@/lib/content/incidentTerms.mjs';
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
import { taskTypeSelectOption } from '@/lib/design/taskTypeIcons';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import Alert from '@/components/ui/Feedback/Alert';
import Checkbox from '@/components/ui/Forms/Checkbox';
import ToggleSwitch from '@/components/ui/Forms/ToggleSwitch';
import { userFacingErrorMessage } from '@/lib/utils/errors';
import { issuePath } from '@/lib/utils/issueKeys.mjs';



// `initialCategory` is what the «+» on a category column of «Звернення»
// asks for: the composer has no project yet, and a category has a different
// status in every project, so the status can only be resolved once a project is
// chosen — and again if it is changed.
export default function CreateTaskModal({ isOpen, onClose, onSubmit, teamMembers = [], projects = null, projectContext = null, initialStatus = null, initialCategory = null, initialAssignees = null, clientMode = false }) {
  const router = useRouter();
  const { currentUser, activeOrg, orgRole } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const { labels: availableLabels = [], statuses = [], types = [], priorities = [] } = useWorkflowConfig();
  // The same composer opens for support and for the client, and both of them
  // are creating the one thing this product has: a «звернення». `clientMode`
  // still decides what the form *offers* — status, priority and assignee are
  // not a client's to set — but never what the record is called.
  const terms = incidentTerms();
  const [form, setForm] = useState({
    title: '', description: '', status: 'backlog',
    priority: NO_PRIORITY_ID, type: 'task',
    assignees: [], clientAssignees: [], labelIds: [], dueDate: '',
    projectId: projects && projects.length > 0 ? projects[0].id : '',
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
  // organization — «Звернення», «Огляд» and the clients page all ask for
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
  // not on the project — «Команда» → учасник → «Створити звернення» is exactly
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
    // Whoever is filing it answers for it until they say otherwise. A field that
    // starts empty is a field most people leave empty, and «нікого» is the one
    // answer this question never has.
    clientAssignees: clientMode ? [currentUser?.id || currentUser?.uid].filter(Boolean) : [],
    labelIds: [],
    dueDate: '',
    projectId: projects?.[0]?.id || projectContext?.id || '',
  });

  const resetDraft = () => {
    setForm(initialForm());
    setError('');
    setFieldErrors({});
    setDraftTouched(false);
    setCreateAnother(false);
    setAddToProjectTeam(false);
  };

  const resetForAnother = () => {
    // Keep the routing/context choices that make a run of similar tasks fast,
    // but clear the content that would accidentally duplicate real work.
    setForm(current => ({
      ...initialForm(),
      projectId: current.projectId,
      status: current.status,
      priority: current.priority,
      type: current.type,
      assignees: current.assignees,
      clientAssignees: current.clientAssignees,
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
  // dependency list the reset ran on ordinary re-renders and wiped a draft
  // somebody was still typing. The ref makes the open transition the trigger;
  // the dependencies stay so the reset still reads current values on the
  // render that opens it.
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
  }, [isOpen, initialAssignees, initialStatus, categoryStatusId, visibleStatuses, projects]);

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

  const toggleClientAssignee = (uid) => {
    setDraftTouched(true);
    setForm(current => ({
      ...current,
      clientAssignees: current.clientAssignees.includes(uid)
        ? current.clientAssignees.filter(assignee => assignee !== uid)
        : [...current.clientAssignees, uid],
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
    if (!form.title.trim()) nextErrors.title = terms.composerSubjectRequired;
    if (projects && projects.length > 0 && !form.projectId) {
      nextErrors.projectId = 'Оберіть клієнта';
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
        ? 'Позначте «Додати до команди підтримки клієнта» або приберіть відповідального, який не має доступу.'
        : 'Приберіть відповідального, який не входить до команди підтримки клієнта.');
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
            type: form.type,
            priority: form.priority,
            labelIds: form.labelIds,
            clientAssignees: form.clientAssignees,
            createdBy: currentUser?.id || currentUser?.uid,
          }
        : {
            ...form,
            createdBy: currentUser?.id || currentUser?.uid,
            dueDate: form.dueDate
              ? fromDateInput(form.dueDate, { endOfDay: true, timeZone })
              : null,
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
      setError(userFacingErrorMessage(err, terms.composerFailed));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={closeAndReset}
      title={terms.composerTitle}
      size="lg"
      bodyPadding="flush"
      isDirty={draftTouched}
      closeConfirmation="Закрити форму й втратити незбережені зміни?"
      footer={(
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
            {loading ? 'Створення...' : terms.composerSubmit}
          </Button>
        </>
      )}
    >
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
                title={terms.composerFailed}
                description={error}
              />
            </div>
          )}

          {/* Title */}
          <FormGroup label={terms.composerSubjectLabel} required error={fieldErrors.title} className="lg:col-span-2">
            <Input
              ref={titleInputRef}
              autoFocus
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder="Коротко опишіть проблему або запит"
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
                placeholder="Оберіть клієнта..."
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
                  ? 'Цього працівника немає в команді підтримки клієнта'
                  : 'Цих працівників немає в команді підтримки клієнта'}
              >
                <div className="flex flex-col gap-2">
                  <span>
                    {assigneesJoiningProject.map(m => m.name || m.email).join(', ')} — не у
                    {' команді підтримки клієнта'}
                    {selectedProject?.name ? ` «${selectedProject.name}»` : ''}.
                  </span>
                  {mayGrantProjectAccess ? (
                    <Checkbox
                      size="sm"
                      checked={addToProjectTeam}
                      onChange={setAddToProjectTeam}
                      label={`Додати до команди підтримки клієнта${selectedProject?.name ? ` «${selectedProject.name}»` : ''}`}
                    />
                  ) : (
                    <span>
                      Призначити не вдасться — попросіть власника або адміністратора додати працівника до підтримки цього клієнта.
                    </span>
                  )}
                </div>
              </Alert>
            </div>
          )}

          {/* Description */}
          <div className="flex flex-col gap-[6px] lg:col-span-2">
            <Label>{terms.composerDescriptionLabel}</Label>
            <MarkdownEditor
              value={form.description}
              onChange={(val) => set('description', val)}
              onUploadFiles={handleUploadFiles}
              uploading={uploadingFiles}
              placeholder="Опишіть ситуацію, очікуваний результат і додайте файли або посилання…"
              minHeight="120px"
            />
          </div>

          {/* Who answers for this on the customer's side. It is the one routing
              question a client gets, and it is about their own people — support's
              own assignment stays support's and is never shown here. Offered only
              when they have colleagues to choose between: a one-person client
              would be asked to confirm the only possible answer. */}

          {/* Metadata controls share one grid, so every field has identical
              geometry and a deterministic reading order.

              Both composers draw it. What the customer does not get is the two
              cells that belong to the desk rather than to the request: the
              status it enters the workflow at, and the date it is promised for.
              The kind of problem and how urgent it is are theirs — they are the
              two facts the person filing knows before anybody at the desk
              does. */}
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
            {!clientMode && (
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
            )}
            {!clientMode && (
              <div className="flex flex-col gap-[6px]">
                <Label>Термін вирішення</Label>
                <DatePicker
                  value={form.dueDate}
                  onChange={value => set('dueDate', value)}
                  placeholder="Без терміну"
                />
              </div>
            )}
          </div>

          {/* Assignees */}
          {!clientMode && assignableMembers.length > 0 && (
            <div className="flex flex-col gap-[6px] lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Відповідальні</Label>
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
                        ? `Не входить до команди підтримки клієнта${selectedProject?.name ? ` «${selectedProject.name}»` : ''}`
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
            </div>
          )}

          {/* Who answers for this on the customer's side, asked last — where
              QuickTeam's composer asks the same question, and beside support's
              own picker rather than glued to the description. Every field
              between the two is hidden for a customer, so sitting where it used
              to it arrived attached to «Опис» and read as part of it instead of
              as the form's closing question. Offered only when they have
              colleagues to choose between: a one-person client would be asked
              to confirm the only possible answer. */}
          {clientMode && teamMembers.length > 1 && (
            <div className="flex flex-col gap-[6px] lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label>Від клієнта</Label>
                <span className="text-[10px] font-medium text-muted">Можна вибрати кількох</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {teamMembers.map(member => {
                  const uid = member.uid || member.id;
                  const selected = form.clientAssignees.includes(uid);
                  return (
                    <SelectableChip
                      key={uid}
                      shape="person"
                      selected={selected}
                      onClick={() => toggleClientAssignee(uid)}
                    >
                      <span aria-hidden="true"><UserAvatar user={member} size="xs" /></span>
                      <span className="max-w-[180px] truncate">{member.name || member.email}</span>
                      {selected && <Check size={12} className="shrink-0" />}
                    </SelectableChip>
                  );
                })}
              </div>
            </div>
          )}

          {/* Labels. A customer marks their own request the same way support
              does — the taxonomy is the workspace's, and «оплата», «доступи»,
              «терміново» are as much theirs to apply as anybody's. */}
          {availableLabels.length > 0 && (
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
    </Dialog>
  );
}
