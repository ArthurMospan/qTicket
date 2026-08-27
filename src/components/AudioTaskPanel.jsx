'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileAudio, ListChecks, RotateCcw, Sparkles, Upload, X } from 'lucide-react';
import { useAppContext } from '@/lib/context/AppContext';
import { auth } from '@/lib/firebase';
import { uploadFileToCloudinary } from '@/lib/services/fileUpload';
import useWorkspaceStore from '@/store/useWorkspaceStore';
import Button from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Checkbox, FileInput, FormGroup, IconAction, Input, Textarea } from '@/components/ui';
import { fromDateInput } from '@/lib/utils/date';
import { organizationTimeZone } from '@/lib/utils/timeZone.mjs';
import { useWorkflowConfig } from '@/lib/hooks/useWorkflowConfig';
import { NO_PRIORITY_ID, prioritySelectOptions } from '@/lib/utils/priorities.mjs';
import { AUDIO_UPLOAD_ACCEPT } from '@/lib/utils/uploadPolicy.mjs';

// A finished analysis is minutes of a real call plus whatever the user has
// edited since; it must not depend on this component staying mounted. The panel
// lives inside a modal, and a modal is the least durable place in the app — one
// stray dismissal, one navigation, one remount from anything above it and the
// drafts were gone with no way back. They are written to sessionStorage on
// every change and read back on mount, so the work survives all of that and
// still disappears when the tab is closed.
const draftStorageKey = orgId => `qt:ai-call-draft:${orgId || 'unknown'}`;

function readDraft(orgId) {
  if (typeof window === 'undefined' || !orgId) return null;
  try {
    const raw = window.sessionStorage.getItem(draftStorageKey(orgId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft === 'object' ? draft : null;
  } catch {
    return null;
  }
}

function writeDraft(orgId, draft) {
  if (typeof window === 'undefined' || !orgId) return;
  try {
    if (!draft) window.sessionStorage.removeItem(draftStorageKey(orgId));
    else window.sessionStorage.setItem(draftStorageKey(orgId), JSON.stringify(draft));
  } catch {
    // A full or blocked sessionStorage must not break the panel itself.
  }
}

export default function AudioTaskPanel({
  projects = [],
  projectContext = null,
  teamMembers = [],
  onSubmit,
  onFinished,
}) {
  const { priorities } = useWorkflowConfig();
  const { activeOrgId, activeOrg } = useAppContext();
  const timeZone = organizationTimeZone(activeOrg);
  const showToast = useWorkspaceStore(state => state.showToast);
  const openPlanUpgrade = useWorkspaceStore(state => state.openPlanUpgrade);
  const availableProjects = useMemo(
    () => (projects?.length ? projects : projectContext ? [projectContext] : []).filter(Boolean),
    [projects, projectContext],
  );
  // Read once, at mount, before any state exists to overwrite.
  const [restored] = useState(() => readDraft(activeOrgId));
  const [projectId, setProjectId] = useState(restored?.projectId || availableProjects[0]?.id || '');
  const effectiveProjectId = projectId || availableProjects[0]?.id || '';
  const project = availableProjects.find(item => item.id === effectiveProjectId);
  const [transcript, setTranscript] = useState(restored?.transcript || '');
  const [audioFile, setAudioFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(restored?.result || null);

  useEffect(() => {
    if (!activeOrgId) return;
    if (!transcript.trim() && !result) writeDraft(activeOrgId, null);
    else writeDraft(activeOrgId, { projectId: effectiveProjectId, transcript, result });
  }, [activeOrgId, effectiveProjectId, transcript, result]);

  const discardDraft = () => {
    setResult(null);
    setTranscript('');
    setAudioFile(null);
    writeDraft(activeOrgId, null);
  };

  const updateTask = (index, patch) => {
    setResult(previous => ({
      ...previous,
      tasks: previous.tasks.map((task, taskIndex) => taskIndex === index ? { ...task, ...patch } : task),
    }));
  };

  const findMemberId = name => {
    if (!name) return '';
    const normalized = name.toLowerCase();
    const member = teamMembers.find(item => (item.name || '').toLowerCase() === normalized)
      || teamMembers.find(item => (item.name || '').toLowerCase().includes(normalized));
    return member ? member.id || member.uid : '';
  };

  const analyze = async () => {
    if (!transcript.trim() && !audioFile) {
      showToast('Додайте аудіозапис або текст транскрипту', 'error');
      return;
    }
    if (!activeOrgId) return;
    setAnalyzing(true);
    setResult(null);
    try {
      let audioUrl = '';
      if (!transcript.trim() && audioFile) {
        const upload = await uploadFileToCloudinary(
          audioFile,
          `quickteam/organizations/${activeOrgId}/ai-calls`,
        );
        audioUrl = upload.downloadUrl;
      }
      const token = await auth.currentUser?.getIdToken();
      const response = await fetch('/api/ai/call-to-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          organizationId: activeOrgId,
          transcript: transcript.trim() || undefined,
          audioUrl: audioUrl || undefined,
          audioMimeType: audioFile?.type || undefined,
          memberNames: teamMembers.map(member => member.name).filter(Boolean),
          projectName: project?.name || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // A ceiling comes back named, so the answer is the price list on that
        // ceiling rather than a toast the reader can do nothing with. «Розбір
        // дзвінків / міс» is a line on the price list, and this is where it
        // stops being only that.
        if (data.planLimit?.id) {
          openPlanUpgrade({ limitId: data.planLimit.id });
          return;
        }
        throw new Error(data.error || 'Не вдалося проаналізувати аудіо');
      }
      setResult({
        summary: data.summary || '',
        decisions: data.decisions || [],
        tasks: (data.tasks || []).map(task => ({
          ...task,
          include: true,
          assigneeId: findMemberId(task.assigneeName),
        })),
      });
    } catch (error) {
      showToast(error.message || 'Помилка аналізу аудіо', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const createTasks = async () => {
    const selected = result?.tasks.filter(task => task.include && task.title.trim()) || [];
    if (!selected.length || !effectiveProjectId) {
      showToast('Оберіть проєкт і хоча б одне завдання', 'error');
      return;
    }
    setCreating(true);
    let created = 0;
    try {
      for (const task of selected) {
        await onSubmit({
          projectId: effectiveProjectId,
          title: task.title.trim(),
          description: task.description || '',
          priority: task.priority || NO_PRIORITY_ID,
          type: 'task',
          status: 'todo',
          assignees: task.assigneeId ? [task.assigneeId] : [],
          dueDate: task.dueDate
            ? fromDateInput(task.dueDate, { endOfDay: true, timeZone })
            : null,
          labelIds: [],
        });
        created += 1;
      }
      showToast(`Створено завдань: ${created}`, 'success');
      writeDraft(activeOrgId, null);
      onFinished?.();
    } catch (error) {
      showToast(`Створено ${created}, далі помилка: ${error.message}`, 'error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {availableProjects.length > 1 && (
        <FormGroup label="Проєкт" gap="md">
          <Select
            value={effectiveProjectId}
            onChange={setProjectId}
            options={availableProjects.map(item => ({ value: item.id, label: item.name }))}
          />
        </FormGroup>
      )}

      <FormGroup label="Аудіозапис" gap="md">
        {audioFile ? (
          <div data-ui-surface="local" className="flex items-center gap-3 rounded-[14px] bg-canvas px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-muted"><FileAudio size={16} /></span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{audioFile.name}</span>
            {/* `soft`, not `quiet`: this row is bg-canvas, and quiet's #f0f0f0
                hover is four units off it — invisible. Soft's #ebebeb is not. */}
            <IconAction label="Прибрати файл" icon={X} size="sm" appearance="soft" onClick={() => setAudioFile(null)} />
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-faint bg-canvas px-5 py-8 text-center transition-colors hover:border-muted">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-ink"><Upload size={18} /></span>
            <span className="text-[13px] font-bold text-ink">Оберіть аудіофайл</span>
            <span className="text-[11px] text-muted">MP3, M4A, WAV, WEBM або OGG · до 14 МБ</span>
            <FileInput
              accept={AUDIO_UPLOAD_ACCEPT}
              onChange={event => {
                const file = event.target.files?.[0];
                if (file?.size > 14 * 1024 * 1024) showToast('Файл завеликий — ліміт 14 МБ', 'error');
                else if (file) setAudioFile(file);
                event.target.value = '';
              }}
            />
          </label>
        )}
      </FormGroup>

      <FormGroup label="Або транскрипт" gap="md">
        <Textarea
          value={transcript}
          onChange={event => setTranscript(event.target.value)}
          rows={5}
          placeholder="Вставте текст розмови…"
          composition="audio-transcript"
        />
      </FormGroup>

      <Button style="primary" size="lg" icon={Sparkles} onClick={analyze} loading={analyzing} disabled={analyzing}>
        {analyzing ? 'Аналізуємо…' : 'Проаналізувати'}
      </Button>

      {result && (
        <div className="flex flex-col gap-4 border-t border-line pt-5">
          {result.summary && (
            <div data-ui-surface="local" className="rounded-[14px] bg-canvas p-4">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Підсумок</p>
              <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink">{result.summary}</p>
            </div>
          )}
          {Array.isArray(result.decisions) && result.decisions.length > 0 && (
            <div data-ui-surface="local" className="rounded-[14px] bg-canvas p-4">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted">Рішення</p>
              <ul className="list-disc space-y-1 pl-5 text-[13px] leading-5 text-ink">
                {result.decisions.map((decision, index) => (
                  <li key={`${index}-${decision}`}>{decision}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <h3 className="ui-type-card-title flex items-center gap-2 text-ink"><ListChecks size={16} /> Запропоновані завдання</h3>
            <div className="flex shrink-0 items-center gap-2">
              {/* The drafts now outlive the modal, so there has to be a way to
                  say "not these" — otherwise last week's call is still sitting
                  there when the panel is opened for this week's. */}
              <IconAction label="Почати заново" icon={RotateCcw} size="md" appearance="soft" onClick={discardDraft} />
              <Button style="primary" size="md" onClick={createTasks} loading={creating} disabled={creating || !result.tasks.some(task => task.include)}>
                Створити вибрані
              </Button>
            </div>
          </div>
          {/* White card, kit fields. The card used to be grey with fields
              painted transparent on top of it, which read as text rather than
              as a form: nothing said the title could be edited, and the kit's
              own grey Select had no contrast to sit against. Both problems are
              the same problem — this is a review-and-edit step where every
              field is meant to be changed, so it should look like the form it
              is. */}
          {result.tasks.map((task, index) => (
              <div key={index} data-ui-surface="local" className={`rounded-[14px] border border-line bg-white p-4 transition-opacity ${task.include ? '' : 'opacity-45'}`}>
                <div className="flex items-start gap-3">
                  <span className="mt-[7px] shrink-0">
                    <Checkbox
                      size="sm"
                      checked={task.include}
                      onChange={value => updateTask(index, { include: value })}
                      ariaLabel="Створювати цю задачу"
                    />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <Input
                      value={task.title}
                      onChange={event => updateTask(index, { title: event.target.value })}
                      aria-label="Назва задачі"
                    />
                    <Textarea
                      value={task.description || ''}
                      onChange={event => updateTask(index, { description: event.target.value })}
                      rows={2}
                      aria-label="Опис задачі"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Select value={task.priority || NO_PRIORITY_ID} onChange={value => updateTask(index, { priority: value })} options={prioritySelectOptions(priorities)} compact />
                      <Select
                        value={task.assigneeId || ''}
                        onChange={value => updateTask(index, { assigneeId: value })}
                        options={[
                          { value: '', label: 'Без виконавця' },
                          ...teamMembers.map(member => ({
                            value: member.id || member.uid,
                            label: member.name || member.email,
                            user: member,
                          })),
                        ]}
                        compact
                      />
                    </div>
                  </div>
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  );
}
