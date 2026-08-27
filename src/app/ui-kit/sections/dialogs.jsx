'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Forms/Textarea';
import Surface from '@/components/ui/Surface';
import { ConfirmProvider, useConfirm, ProjectSettingsForm } from '@/components/ui';
import Dialog from '@/components/ui/Dialog';
import CreateTaskModal from '@/components/CreateTaskModal';
import { DEFAULT_STATUSES } from '@/lib/hooks/useWorkflowConfig';
import { Plus, Trash2, Settings } from 'lucide-react';
import { PreviewBlock } from '../preview';

function ConfirmDialogPreview() {
  const confirm = useConfirm();
  const [lastResult, setLastResult] = useState(null);

  const openConfirm = async () => {
    const accepted = await confirm({
      title: 'Видалити проєкт?',
      message: 'Ви видаляєте «Редизайн сайту». Цю дію неможливо скасувати.',
      confirmText: 'Видалити',
      danger: true,
    });
    setLastResult(accepted ? 'Підтверджено' : 'Скасовано');
  };

  return (
    <div className="flex items-center gap-[12px]">
      <Button style="secondary" color="red" size="lg" icon={Trash2} onClick={openConfirm}>Видалити</Button>
      {lastResult && <span className="text-[12px] font-semibold text-muted">{lastResult}</span>}
    </div>
  );
}

const DIALOG_VARIANTS = [
  {
    id: 'flush',
    label: 'bodyPadding="flush"',
    props: { bodyPadding: 'flush', size: 'lg' },
    note: 'Тіло без відступу — вміст сам керує своїми полями й може йти на всю ширину.',
    where: 'Створення завдання · Профіль користувача',
    open: 'Мої завдання → «Створити завдання»',
  },
  {
    id: 'responsive',
    label: 'bodyPadding="responsive"',
    props: { bodyPadding: 'responsive', size: 'md' },
    note: 'Вужчий відступ на мобільному, звичайний на десктопі.',
    where: 'Деталі задачі · Подія календаря',
    open: 'Проєкт → задача → «Зафіксувати час»',
  },
  {
    id: 'spacious',
    label: 'bodyPadding="spacious"',
    props: { bodyPadding: 'spacious', size: 'sm' },
    note: 'Просторі форми, де поля не мають тиснутись до країв.',
    where: 'Мої завдання · Зміна статусу користувача',
    open: 'Клац на свій аватар → «Змінити статус»',
  },
  {
    id: 'invite',
    label: 'bodyPadding="invite"',
    props: { bodyPadding: 'invite', size: 'lg' },
    note: 'Форма запрошення: поле пошти й роль на всю ширину, кнопки внизу.',
    where: 'Запрошення учасника',
    open: 'Команда → «+» у шапці списку',
  },
  {
    id: 'horizontal',
    label: 'bodyPadding="horizontal"',
    props: { bodyPadding: 'horizontal', size: 'sm' },
    note: 'Підтвердження без тексту: сам заголовок уже все сказав, тож вертикального відступу під тілом немає — лишається тільки бічний.',
    where: 'Будь-яке підтвердження без пояснення — ConfirmProvider',
    open: 'Проєкт → «Видалити проєкт»',
  },
  {
    id: 'sticky-head',
    label: 'bodyPadding="sticky-head"',
    props: { bodyPadding: 'sticky-head', size: 'lg' },
    note: 'Тіло віддає свій верхній відступ першому дочірньому елементу, коли той — sticky top-0. Поле пошуку тоді прилипає до самого верху: перший рядок не обрізається, а прокручені рядки не визирають над полем.',
    where: 'Спринти → «Додати існуюче завдання»',
    open: 'Спринти → «+» у шапці спринта → «Додати існуюче»',
  },
  {
    id: 'sheet',
    label: 'presentation="sheet"',
    props: { presentation: 'sheet', size: 'sm', bodyPadding: 'spacious' },
    note: 'Висувна панель збоку замість центрованої модалки — не окремий компонент, а той самий Dialog.',
    where: 'Мої завдання → налаштування вигляду',
    open: 'Мої завдання → іконка фільтрів праворуч',
  },
  {
    id: 'status',
    label: 'size="status"',
    props: { size: 'status' },
    note: 'Найвужчий діалог у продукті — рівно під поле статусу й емодзі.',
    where: 'Зміна статусу користувача',
    open: 'Клац на свій аватар у сайдбарі',
  },
];

export default function DialogsSection() {
  const [open1, setOpen1] = useState(false);
  const [dialogVariant, setDialogVariant] = useState(null);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [projectSettingsName, setProjectSettingsName] = useState('QuickTeam Website');
  const [projectSettingsDescription, setProjectSettingsDescription] = useState('Основний продукт команди');
  const [projectSettingsHidden, setProjectSettingsHidden] = useState(['done']);
  const [projectSettingsTeam, setProjectSettingsTeam] = useState(['owner-demo', 'designer-demo']);
  const [projectSettingsInvites, setProjectSettingsInvites] = useState('');
  return (
    <ConfirmProvider>
      <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Standard Dialog" component="Dialog" description="Спільний chrome: sm 440px, md 560px, lg 760px, xl 960px. Приклад нижче — sm dialog.">
        <Button style="primary" size="lg" onClick={() => setOpen1(true)}>Відкрити форму</Button>
        <Dialog isOpen={open1} onClose={() => setOpen1(false)} title="Редагувати проєкт" size="sm">
          <div className="flex flex-col gap-[16px]">
            <div>
              <label className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[6px] block">Назва *</label>
              <Input placeholder="Назва проєкту..." />
            </div>
            <div>
              <label className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[6px] block">Опис</label>
              <Textarea placeholder="Короткий опис..." rows={3} />
            </div>
          </div>
          <div className="flex gap-[8px] mt-[24px]">
            <Button style="secondary" size="lg" className="flex-1" onClick={() => setOpen1(false)}>Скасувати</Button>
            <Button style="primary" size="lg" className="flex-1" onClick={() => setOpen1(false)}>Зберегти</Button>
          </div>
        </Dialog>
      </PreviewBlock>

      <PreviewBlock title="Danger / Confirm Dialog" description="Живий ConfirmProvider, який продукт використовує замість native confirm()/prompt().">
        <ConfirmDialogPreview />
      </PreviewBlock>

      {/* Dialog cannot render standalone in the variant matrix — it needs an
          open state — so its declared values are shown here, where they can be
          opened. Every one of these ships on the site, hence the «Де на сайті»
          line on each: the previous version was six bare buttons labelled with
          prop syntax, which read as options somebody invented for the kit. */}
      <PreviewBlock
        title="Dialog — решта оголошених значень"
        description="Це не окремі компоненти й не вигадані опції: усі шість стоять на реальних екранах, просто рідко (по 1–2 місця кожен). Під кожним написано, де саме він живе і як його відкрити в продукті."
        fullWidth
      >
        <div className="grid w-full gap-[10px] sm:grid-cols-2 lg:grid-cols-3">
          {DIALOG_VARIANTS.map(variant => (
            <div key={variant.id} className="flex flex-col gap-[8px] rounded-[12px] border border-line p-[12px]">
              <span className="font-mono text-[11px] font-bold text-ink">{variant.label}</span>
              <p className="text-[11px] leading-relaxed text-muted">{variant.note}</p>
              <div className="mt-auto flex flex-col gap-[6px] pt-[4px]">
                <span className="text-[10px] leading-relaxed text-faint">
                  <span className="font-semibold text-muted">Де на сайті:</span> {variant.where}
                  <br />
                  <span className="font-semibold text-muted">Як відкрити:</span> {variant.open}
                </span>
                <Button style="secondary" size="sm" onClick={() => setDialogVariant(variant.id)}>
                  Показати
                </Button>
              </div>
            </div>
          ))}
        </div>
        {DIALOG_VARIANTS.map(variant => (
          <Dialog
            key={variant.id}
            isOpen={dialogVariant === variant.id}
            onClose={() => setDialogVariant(null)}
            title={variant.label}
            {...variant.props}
          >
            <div className="flex flex-col gap-3">
              <p className="text-[12px] leading-relaxed text-muted">{variant.note}</p>
              <Surface preset="inset" padding="md">
                <p className="text-[11px] text-muted">
                  Живе тут: <span className="font-semibold text-ink">{variant.where}</span>
                </p>
                <p className="mt-1 font-mono text-[11px] text-ink">
                  {Object.entries(variant.props).map(([key, value]) => `${key}="${value}"`).join(' ')}
                </p>
              </Surface>
              <Button style="primary" size="md" onClick={() => setDialogVariant(null)}>Закрити</Button>
            </div>
          </Dialog>
        ))}
      </PreviewBlock>

      <PreviewBlock
        title="Project Settings Dialog"
        description="Точний shared organism з проєкту: правий sm sheet, як форма створення проєкту."
        filePath="src/components/ui/TaskManagement/ProjectSettingsForm.jsx"
      >
        <Button style="secondary" size="lg" icon={Settings} onClick={() => setProjectSettingsOpen(true)}>
          Налаштування проєкту
        </Button>
        <Dialog
          isOpen={projectSettingsOpen}
          onClose={() => setProjectSettingsOpen(false)}
          title="Налаштування проєкту"
          size="sm"
          footer={(
            <>
              <Button style="secondary" size="md" onClick={() => setProjectSettingsOpen(false)}>
                Скасувати
              </Button>
              <Button style="primary" size="md" onClick={() => setProjectSettingsOpen(false)}>
                Зберегти зміни
              </Button>
            </>
          )}
        >
          <ProjectSettingsForm
            name={projectSettingsName}
            onNameChange={setProjectSettingsName}
            description={projectSettingsDescription}
            onDescriptionChange={setProjectSettingsDescription}
            statuses={DEFAULT_STATUSES}
            hiddenStatusIds={projectSettingsHidden}
            onHiddenStatusIdsChange={setProjectSettingsHidden}
            backlogStatusId="backlog"
            teamMembers={[
              { id: 'owner-demo', name: 'Олена Коваль', email: 'olena@example.com' },
              { id: 'designer-demo', name: 'Іван Петренко', email: 'ivan@example.com' },
              { id: 'developer-demo', name: 'Марія Бондар', email: 'maria@example.com' },
            ]}
            teamMemberIds={projectSettingsTeam}
            onTeamMemberIdsChange={setProjectSettingsTeam}
            ownerId="owner-demo"
            layout="stacked"
            inviteEmails={projectSettingsInvites}
            onInviteEmailsChange={setProjectSettingsInvites}
          />
        </Dialog>
      </PreviewBlock>

      <PreviewBlock
        title="CreateTaskModal — large sheet"
        description="Живий великий організм створення задачі. Він використовує Dialog size=lg, тому ширина, заголовок, close та footer не дублюються локально."
        filePath="src/components/CreateTaskModal.jsx"
      >
        <Button style="primary" size="lg" icon={Plus} onClick={() => setCreateTaskOpen(true)}>
          Створити завдання
        </Button>
        <CreateTaskModal
          isOpen={createTaskOpen}
          onClose={() => setCreateTaskOpen(false)}
          onSubmit={async () => setCreateTaskOpen(false)}
          stages={[]}
          teamMembers={[]}
          projectContext={{ id: 'ui-kit', name: 'UI Kit' }}
          sprints={[]}
        />
      </PreviewBlock>
      </div>
    </ConfirmProvider>
  );
}
