'use client';
import { Pill, PriorityBadge, PriorityIcon, TypeBadge, Tag, Counter, UserAvatar, StatusPill } from '@/components/ui';
import { DEFAULT_PRIORITIES, DEFAULT_TYPES } from '@/lib/hooks/useWorkflowConfig';
import { NO_PRIORITY } from '@/lib/utils/priorities.mjs';
import { Lock } from 'lucide-react';
import { PreviewBlock } from '../preview';
import { taskTypeIcon } from '@/lib/design/taskTypeIcons';

const PREVIEW_PRIORITIES = [
  DEFAULT_PRIORITIES[0],
  DEFAULT_PRIORITIES[1],
  { id: 'important', label: 'Важливий', color: '#8b5cf6' },
  DEFAULT_PRIORITIES[2],
  DEFAULT_PRIORITIES[3],
];

export default function BadgesSection() {
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Pill — semantic metadata family" component="Pill"
        description="Спільна geometry для neutral metadata, status-like tones і compact badges. Counter, StatusPill та TypeBadge зберігають окрему семантику поверх тієї самої системи."
        filePath="src/components/ui/DataDisplay/Pill.jsx"
        fullWidth
      >
        <div className="flex flex-wrap items-center gap-3">
          <Pill tone="neutral" size="sm">Metadata</Pill>
          <Pill tone="dark" size="md">Dark</Pill>
          <Pill tone="success" size="md">Готово</Pill>
          <Pill tone="warning" size="md">Очікує</Pill>
          <Pill tone="danger" size="md">Прострочено</Pill>
          <Pill tone="info" size="sm" shape="badge">1г 25хв</Pill>
          <Pill tone="surface" size="wide-sm" appearance="soft-outline">Проєкт</Pill>
          {/* Обидва лічильники стоять поруч зі стеком облич і мають бути
              рівно такого ж розміру, як обличчя: avatar-counter — для 24px
              (sm), avatar-counter-xs — для 16px (xs). Це четверта аватарка, а
              не бейдж біля аватарок. */}
          <span className="flex items-center -space-x-[6px]">
            <UserAvatar user={{ id: 'p1', name: 'Артур Моспан' }} size="sm" stacked />
            <UserAvatar user={{ id: 'p2', name: 'Іван Петренко' }} size="sm" stacked />
            <Pill tone="neutral" size="md" preset="avatar-counter">+3</Pill>
          </span>
          <span className="flex items-center -space-x-[6px]">
            <UserAvatar user={{ id: 'p1', name: 'Артур Моспан' }} size="xs" stacked />
            <UserAvatar user={{ id: 'p2', name: 'Іван Петренко' }} size="xs" stacked />
            <Pill tone="neutral" size="md" preset="avatar-counter-xs">+3</Pill>
          </span>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Композитні Pill — вкладені елементи"
        description="Pill приймає не лише текст. Ці три композиції — з IssueCard та календаря: іконка стану, текст із забарвленим суфіксом, і аватар учасника з його відповіддю. Затверджено як канон: продукт лишається, каталог їх описує."
        filePath="src/components/ui/DataDisplay/Pill.jsx"
        fullWidth
      >
        <div className="flex flex-col gap-[18px] w-full">
          <div>
            <h4 className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[8px]">Іконка стану — IssueCard</h4>
            <Pill tone="danger" size="sm" shape="badge" weight="medium" title="Заблоковано іншою задачею">
              <Lock size={10} />
              Заблоковано
            </Pill>
          </div>
          <div>
            <h4 className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[8px]">Текст із забарвленим суфіксом — форма події</h4>
            <div className="flex flex-wrap gap-[6px]">
              <Pill tone="neutral" size="wide-sm" weight="medium">
                Артур Моспан
                <span className="text-emerald-600">· буде</span>
              </Pill>
              <Pill tone="neutral" size="wide-sm" weight="medium">
                Олена Коваль
                <span className="text-muted">· очікуємо</span>
              </Pill>
            </div>
          </div>
          <div>
            <h4 className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider mb-[8px]">Аватар + імʼя + стан — сторінка події</h4>
            <Pill tone="surface-ink" size="lg" weight="medium">
              <UserAvatar user={{ id: 'kit-arthur', name: 'Артур Моспан' }} size="xs" />
              <span className="font-semibold">Артур Моспан</span>
              <span className="text-emerald-600">· буде</span>
            </Pill>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="TypeBadge — task type"
        description="Єдиний бейдж типу, який напряму використовують IssueCard, TaskRow та рядки рахунку в аналітиці."
        filePath="src/components/ui/DataDisplay/TypeBadge.jsx"
      >
        <div className="flex flex-wrap items-center gap-[8px]">
          {[...DEFAULT_TYPES, {
            id: 'customer-request',
            label: 'Власний тип',
            color: '#8b5cf6',
          }].map(type => (
            <TypeBadge key={type.id} label={type.label} color={type.color} icon={taskTypeIcon(type)} />
          ))}
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="PriorityIcon — system and custom priority language"
        description="Ранжовані рівні мають одну геометрію: суцільна крапка та 40%-й ореол того самого кольору. «Без пріоритету» має той самий зовнішній діаметр, але позначається тонким малоконтрастним пунктирним контуром — це відсутність рішення, а не ще один рівень шкали."
        component="PriorityIcon"
      >
        <div className="flex flex-wrap items-center gap-5">
          {[NO_PRIORITY, ...[...PREVIEW_PRIORITIES].reverse()].map(priority => (
            <div key={priority.id} className="flex items-center gap-2 text-[12px] font-medium text-ink">
              <PriorityIcon priority={priority} priorities={PREVIEW_PRIORITIES} size="md" />
              <span>{priority.label}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="PriorityBadge — Billing task rows"
        description="Живий бейдж пріоритету з BillingTab. Значення приходить із завдання, тому показані всі можливі пріоритети."
        filePath="src/components/workspace/BillingTab.jsx"
      >
        <div className="flex items-center gap-[8px]">
          <PriorityBadge priority="none" priorities={DEFAULT_PRIORITIES} />
          <PriorityBadge priority="low" priorities={DEFAULT_PRIORITIES} />
          <PriorityBadge priority="medium" priorities={DEFAULT_PRIORITIES} />
          <PriorityBadge priority="high" priorities={DEFAULT_PRIORITIES} />
          <PriorityBadge priority="blocker" priorities={DEFAULT_PRIORITIES} />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Tag — issue labels"
        description="Два фактичні розміри мітки: компактний у IssueCard та стандартний у IssueDetail. Колір завжди приходить із конфігурації мітки бренду/проєкту."
        filePath="src/components/workspace/IssueCard.jsx"
      >
        <div className="flex items-center gap-[12px]">
          <Tag label="Фронтенд" color="#3b82f6" size="small" className="shrink-0" />
          <Tag label="Дизайн" color="#db2777" />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Counter — chat and branded navigation" component="Counter"
        description="Живі sm-лічильники: subtle для колонок дошки, світлий для чату, темний для навігації та dot-індикатор організації."
        filePath="src/components/WorkspaceSidebar.jsx"
        fullWidth
      >
        <div className="grid gap-[16px] md:grid-cols-3">
          <div>
            <h4 className="mb-[10px] text-[11px] font-bold uppercase tracking-wider text-muted">Board column · subtle</h4>
            <Counter value={337} size="sm" appearance="subtle" />
          </div>
          <div>
            <h4 className="mb-[10px] text-[11px] font-bold uppercase tracking-wider text-muted">Chat list · light surface</h4>
            <Counter value={12} size="sm" status="muted" className="shrink-0" />
          </div>
          <div className="rounded-[12px] bg-ink p-[16px]">
            <h4 className="mb-[10px] text-[11px] font-bold uppercase tracking-wider text-white/50">Sidebar · branded dark surface</h4>
            <div className="flex items-center gap-[12px]">
              <Counter value={7} size="sm" status="muted" dark />
              <Counter value={3} size="sm" status="info" dark />
              <Counter variant="dot" size="sm" status="info" dark />
            </div>
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="StatusPill — sprint states"
        description="Спільний компактний статус зі сторінки спринтів. Геометрія однакова, а label і semantic color приходять із контексту."
        filePath="src/app/(app)/sprints/page.js"
      >
        <div className="flex flex-wrap items-center gap-[8px]">
          <StatusPill label="Активний" color="#10b981" />
          <StatusPill label="Запланований" color="#9a9a9a" />
          <StatusPill label="Завершено" color="#1f1f1f" />
        </div>
      </PreviewBlock>

    </div>
  );
}
