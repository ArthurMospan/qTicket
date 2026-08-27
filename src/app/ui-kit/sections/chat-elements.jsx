'use client';
import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import { Pill, UserAvatar } from '@/components/ui';
import ChannelInfoPanel from '@/components/ui/Chat/ChannelInfoPanel';
import ChatSearchBanner from '@/components/ui/Chat/ChatSearchBanner';
import MentionMenu from '@/components/ui/Chat/MentionMenu';
import IssueMentionMenu from '@/components/ui/Chat/IssueMentionMenu';
import UnreadDivider from '@/components/ui/Chat/UnreadDivider';
import LoadOlderButton from '@/components/ui/Chat/LoadOlderButton';
import { ChatAttachmentList, PendingChatAttachments } from '@/components/ui/Chat/ChatAttachmentList';
import AvatarButton from '@/components/ui/DataDisplay/AvatarButton';
import FileInput from '@/components/ui/Forms/FileInput';
import TextAction from '@/components/ui/TextAction';
import { Trash2, Paperclip, UserPlus } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { PreviewBlock } from '../preview';
import { CHAT_DEMO_MESSAGES, KIT_MENTION_MEMBERS } from '../demo-data';

// An inline data: URI rather than a hosted file, so the image tile draws its
// real thumbnail without the catalogue depending on anything it has to fetch.
const KIT_IMAGE_DATA_URI = 'data:image/svg+xml;utf8,'
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">'
    + '<rect width="320" height="200" fill="#e9e9ec"/>'
    + '<rect x="24" y="120" width="272" height="10" rx="5" fill="#cfcfd4"/>'
    + '<rect x="24" y="142" width="180" height="10" rx="5" fill="#dcdce0"/>'
    + '<circle cx="72" cy="70" r="26" fill="#cfcfd4"/></svg>',
  );

const KIT_CHAT_ATTACHMENTS = [
  { chatAttachmentKey: 'a1', name: 'onboarding-v2.png', size: 218_000, type: 'image/png', url: KIT_IMAGE_DATA_URI },
  { chatAttachmentKey: 'a2', name: 'brief.docx', size: 61_400, type: 'application/msword' },
  { chatAttachmentKey: 'a3', name: 'кошторис.xlsx', size: 41_200, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  // No bytes behind it in the catalogue, so the transport is silent — but the
  // shape is the real one: a voice note in a channel is a player, never a tile
  // that opens a full-screen viewer to be heard.
  { chatAttachmentKey: 'a4', name: 'дзвінок-12-05.m4a', size: 4_404_019, type: 'audio/mp4', url: 'data:audio/mp4;base64,' },
];

// Plain objects, not File instances: the pending tile calls createObjectURL for
// an image, and there is no Blob to hand it here (nor one on the server, where
// the API does not exist at all). Non-image drafts show the same row with the
// same remove control; the thumbnail look is covered by the list above.
const KIT_PENDING_FILES = [
  { name: 'onboarding-v2.pdf', size: 482_000, type: 'application/pdf', lastModified: 1 },
  { name: 'нотатки.txt', size: 3_100, type: 'text/plain', lastModified: 2 },
];

const KIT_ISSUE_MENTIONS = [
  { id: 'issue-1', issueKey: 'ENG-12', title: 'Підготувати новий онбординг', projectId: 'engineering' },
  { id: 'issue-2', issueKey: 'DES-45', title: 'Перевірити стани мобільного меню', projectId: 'design' },
];

export default function ChatElementsSection() {
  const demoUser = { id: 'kit-arthur', name: 'Артур Моспан' };
  // The state sits in the section, not in helper components: coverage is
  // measured by finding `<Component` inside the section's own body, so a
  // wrapper function would move the render out of what the scan reads.
  const [panelTab, setPanelTab] = useState('info');
  const [pickedFiles, setPickedFiles] = useState([]);
  const fileInputRef = useRef(null);
  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="Чат — власна шкала аватарів"
        description="Чат побудований навколо 36px аватара в рядку повідомлення. Ці розміри існують тільки для чат-поверхонь і навмисно не зведені до загальної шкали: злиття в найближчі xs/sm/md зсувало кожен рядок на 4px."
        filePath="src/components/ui/DataDisplay/UserAvatar.jsx"
        component="UserAvatar"
        fullWidth
      >
        <div className="flex flex-wrap items-end gap-[20px]">
          {[['chat-message', 36, 'рядок повідомлення'], ['chat-member', 28, 'список учасників'],
            ['chat-inline', 20, 'у рядку'], ['chat-mention', 18, 'згадка в тексті']].map(([token, px, role]) => (
            <div key={token} className="flex flex-col items-center gap-[6px]">
              <UserAvatar user={demoUser} size={token} />
              <span className="font-mono text-[9px] font-bold text-[#1f1f1f]">{token}</span>
              <span className="text-[9px] text-[#cfcfcf]">{px}px · {role}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Чат — розміри іконок у діях"
        description="Загальна шкала дає 20px коробці 16px іконку — правильно для щільних тулбарів і завелико для дії над повідомленням, де завжди було 12px. Задається іменованою composition, а не числом на місці виклику."
        filePath="src/components/ui/Button.jsx"
        fullWidth
      >
        <div className="flex flex-col gap-[16px]">
          {[['chat-micro-action', 12, 'дії над повідомленням: відповісти, редагувати, видалити'],
            ['chat-composer-cancel', 13, 'скасування в композері'],
            ['chat-message-action', 15, 'дії в рядку: гілка, закріпити'],
            ['chat-panel-action', 16, 'закрити гілку, інфо про канал'],
            ['chat-composer-action', 17, 'емодзі та вкладення в композері']].map(([token, px, role]) => (
            <div key={token} className="flex items-center gap-[12px]">
              <Button style="ghost" size="icon-sm" composition={token} icon={ChatIcon}>{token}</Button>
              <span className="font-mono text-[10px] font-bold text-[#1f1f1f]">{token}</span>
              <span className="text-[10px] text-[#cfcfcf]">{px}px · {role}</span>
            </div>
          ))}
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Чат — роздільники дат"
        description="Пілюля дати між групами повідомлень. Має власну геометрію: під час зведення варіантів її склали в sm/wide-sm, від чого вона стала вужчою, а текст — на піксель більшим. Видно на кожному переході дня."
        filePath="src/app/globals.css"
        component="Pill"
      >
        <Pill tone="surface" size="chat-day" weight="medium" uppercase>Сьогодні</Pill>
        <Pill tone="surface" size="chat-day-wide" uppercase>12 березня</Pill>
      </PreviewBlock>

      <PreviewBlock
        title="TextAction — кнопка без коробки"
        description="Написана 15 разів вручну на пʼяти поверхнях. Вага йде за розміром, а не окремим пропом: обидва живі 10px-екземпляри були звичайної ваги, всі 11/12px — semibold. Розмір іконки й проміжок теж виводяться з size."
        filePath="src/components/ui/TextAction.jsx"
        component="TextAction"
        fullWidth
      >
        <div className="flex flex-col gap-[14px]">
          {[['ink', 'Зберегти', 'ствердна дія в парі'], ['muted', 'Скасувати', 'тиха половина пари'],
            ['danger', 'Видалити', 'деструктивна й видима'], ['danger-quiet', 'Прибрати', 'червоніє лише під курсором']].map(([tone, label, role]) => (
            <div key={tone} className="flex items-center gap-[12px]">
              <span className="w-[130px] shrink-0 font-mono text-[10px] font-bold text-ink">{tone}</span>
              {['xs', 'sm', 'md'].map(size => (
                <TextAction key={size} tone={tone} size={size}>{label}</TextAction>
              ))}
              <span className="text-[10px] text-[#cfcfcf]">{role}</span>
            </div>
          ))}
          <div className="flex items-center gap-[12px]">
            <span className="w-[130px] shrink-0 font-mono text-[10px] font-bold text-ink">з іконкою</span>
            <TextAction size="sm" icon={UserPlus}>Додати</TextAction>
            <TextAction size="md" icon={ChatIcon}>3 відповіді</TextAction>
            <TextAction size="xs" tone="danger-quiet" icon={Trash2} label="Видалити повідомлення" />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="AvatarButton — аватар як контрол"
        description="UserAvatar навмисно лишається картинкою: він рендериться в списках і хедерах, де клікати нічого. Три екрани, яким таки треба клікабельний, обгортали його самі — і розійшлись у ховері."
        filePath="src/components/ui/DataDisplay/AvatarButton.jsx"
        component="AvatarButton"
      >
        <AvatarButton user={demoUser} size="chat-message" label="Переглянути профіль" />
        <AvatarButton user={{ name: 'Олена Коваль' }} size="chat-member" label="Переглянути профіль" />
        <AvatarButton user={{ name: 'Петро Іванчук' }} size="chat-inline" label="Переглянути профіль" />
      </PreviewBlock>

      <PreviewBlock
        title="MentionMenu — дві щільності"
        description="@-меню було написане двічі, по разу на композер, і копії вже розійшлись: у чаті — 16px радіус із тінню й 28px аватари, у таймлайні задачі — 10px рамка й 20px, і лише в другому був курсор із клавіатури."
        filePath="src/components/ui/Chat/MentionMenu.jsx"
        component="MentionMenu"
        fullWidth
      >
        <div className="grid w-full grid-cols-1 gap-[16px] md:grid-cols-2">
          <div className="flex flex-col gap-[8px]">
            <span className="font-mono text-[10px] font-bold text-ink">density=&quot;composer&quot;</span>
            <MentionMenu density="composer" members={KIT_MENTION_MEMBERS} onSelect={() => {}} />
          </div>
          <div className="flex flex-col gap-[8px]">
            <span className="font-mono text-[10px] font-bold text-ink">density=&quot;timeline&quot;</span>
            <MentionMenu density="timeline" members={KIT_MENTION_MEMBERS} selectedIndex={1} onSelect={() => {}} />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Межа непрочитаних повідомлень"
        description="Стабільно позначає місце, з якого починаються нові повідомлення у чаті завдання. Лічильник збігається з індикатором вкладки чату."
        filePath="src/components/ui/Chat/UnreadDivider.jsx"
        component="UnreadDivider"
        fullWidth
      >
        <div className="w-full max-w-[560px]">
          <UnreadDivider />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Межа завантаженої історії"
        description="Ні канал, ні чат завдання не підписані на всю історію — відкривається найновіша сторінка, а ця кнопка розширює вікно. Один елемент для обох, щоб «давніші повідомлення» і «давніша історія» не розʼїхались."
        filePath="src/components/ui/Chat/LoadOlderButton.jsx"
        component="LoadOlderButton"
        fullWidth
      >
        <div className="w-full max-w-[560px]">
          <LoadOlderButton onClick={() => {}} />
          <LoadOlderButton onClick={() => {}}>Показати давнішу історію</LoadOlderButton>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="IssueMentionMenu — згадки задач через #"
        description="Після # і двох символів композер шукає доступні задачі за ID, назвою та описом. Вибір вставляє стабільний ключ, а не довге посилання; у повідомленні цей ключ стає клікабельною карткою задачі."
        filePath="src/components/ui/Chat/IssueMentionMenu.jsx"
        component="IssueMentionMenu"
        fullWidth
      >
        <div className="w-full max-w-[560px]">
          <IssueMentionMenu
            issues={KIT_ISSUE_MENTIONS}
            projects={[
              { id: 'engineering', name: 'Engineering' },
              { id: 'design', name: 'Design' },
            ]}
            onSelect={() => {}}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Вкладення в чаті"
        description="Однакові плитки у трьох місцях: під повідомленням, у вкладці «Матеріали» і як ще ненадісланий чернетковий список у композері. Останній — єдиний, у якого є «прибрати»."
        filePath="src/components/ui/Chat/ChatAttachmentList.jsx"
        component="ChatAttachmentList"
        fullWidth
      >
        <div className="grid w-full grid-cols-1 gap-[16px] md:grid-cols-2">
          <div className="flex flex-col gap-[8px]">
            <span className="font-mono text-[10px] font-bold text-ink">ChatAttachmentList</span>
            <ChatAttachmentList attachments={KIT_CHAT_ATTACHMENTS} onOpen={() => {}} />
          </div>
          <div className="flex flex-col gap-[8px]">
            <span className="font-mono text-[10px] font-bold text-ink">PendingChatAttachments</span>
            <PendingChatAttachments files={KIT_PENDING_FILES} onRemove={() => {}} />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="FileInput — невидима половина «прикріпити»"
        description="Прихований нативний input, який відкриває справжня кнопка кіту через ref. Вигляду не має — і саме тому його чотири рази переписували поруч із власним тригером."
        filePath="src/components/ui/Forms/FileInput.jsx"
        component="FileInput"
      >
        <div className="flex items-center gap-[12px]">
          <FileInput
            ref={fileInputRef}
            multiple
            onChange={event => setPickedFiles(Array.from(event.target.files || []).map(file => file.name))}
          />
          <Button style="secondary" size="md" icon={Paperclip} onClick={() => fileInputRef.current?.click()}>
            Прикріпити файл
          </Button>
          <span className="text-[11px] text-muted">
            {pickedFiles.length > 0 ? pickedFiles.join(', ') : 'Нічого не вибрано'}
          </span>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="ChatSearchBanner"
        description="Бурштинова смуга над розмовою під час пошуку. Її «Очистити» — єдина бурштинова текст-кнопка в продукті, тому колір лишається тут, а не стає тоном TextAction, якого більше ніхто не попросить."
        filePath="src/components/ui/Chat/ChatSearchBanner.jsx"
        component="ChatSearchBanner"
        fullWidth
      >
        <div className="w-full overflow-hidden rounded-[12px] border border-line">
          <ChatSearchBanner query="онбординг" count={3} onClear={() => {}} />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="ChannelInfoPanel"
        description="Третя панель чату: опис, учасники, закріплені й усі файли каналу. Тринадцять рукописних контролів — третина всієї поверхні чату — жили тут і не показувались ніде, крім справжнього каналу зі справжніми учасниками."
        filePath="src/components/ui/Chat/ChannelInfoPanel.jsx"
        component="ChannelInfoPanel"
        fullWidth
      >
        {/* md+ only: нижче панель — `fixed inset-0`, бо на телефоні вона
            повноекранна, а не рейка збоку. */}
        <div className="hidden h-[520px] w-full justify-center md:flex">
          <ChannelInfoPanel
            channel={{
              id: 'general',
              name: 'general',
              description: 'Загальний канал для всієї команди',
              members: ['kit-arthur', 'kit-olena'],
            }}
            members={KIT_MENTION_MEMBERS}
            messages={CHAT_DEMO_MESSAGES}
            activeTab={panelTab}
            onTabChange={setPanelTab}
            isAdminOrOwner
            onOpenAttachment={() => {}}
            onJumpToMessage={() => {}}
            onClose={() => {}}
            onSaveDescription={async () => true}
            onAddMember={async () => true}
            onAddAllMembers={async () => true}
            onRemoveMember={async () => true}
          />
        </div>
        <p className="text-[11px] text-muted md:hidden">
          На вузькому екрані панель займає весь екран — превʼю показане від 768px.
        </p>
      </PreviewBlock>
    </div>
  );
}
