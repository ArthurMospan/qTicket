'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import { IconAction, SidebarLayout, InnerNavigation, MobilePaneBack, UserAvatar, ChannelRail, MemberRail, ConfirmProvider, ChatComposerCore, StatusPill } from '@/components/ui';
import ChatComposerDock from '@/components/ui/ChatComposerDock';
import ChatConversationHeader from '@/components/ui/Chat/ChatConversationHeader';
import ChatMessageList from '@/components/ui/Chat/ChatMessageList';
import { Plus, User, Bell, X, Users, Building, CreditCard } from 'lucide-react';
import { ChatIcon } from '@/lib/design/icons';
import { PreviewBlock } from '../preview';
import { CHAT_DEMO_MEMBERS, CHAT_DEMO_MESSAGES } from '../demo-data';

// The three screens that "look different" — and the one shell they share.
//
// Settings, Team and Chat each render a canvas rail beside a white pane. Only
// Settings used to say so; Chat and Team hand-wrote the same shell, which is
// exactly how they drifted apart. They are still three different layouts —
// that part was never the problem — they are just three *named* ones now, so
// changing the shell changes all three and nothing else.
export default function NavMenuSection() {
  const [active, setActive] = useState('profile');
  const [teamPane, setTeamPane] = useState('sidebar');
  const [chatPane, setChatPane] = useState('content');
  const NAV = [
    { id: 'profile',       label: 'Особистий профіль', icon: User,     group: 'Особисте' },
    { id: 'notifications', label: 'Сповіщення',        icon: Bell,     group: 'Особисте' },
    { id: 'workspace',     label: 'Загальні',          icon: Building, group: 'Організація' },
    { id: 'team',          label: 'Учасники команди',  icon: Users,    group: 'Організація' },
    // Рядок може нести бейдж — той один факт, який варто знати ще до кліку.
    // Тут це тариф: чорний, а на безкоштовному червоний, бо саме там є стеля,
    // в яку хтось упреться.
    { id: 'billing',       label: 'Тарифний план',     icon: CreditCard, group: 'Організація', badge: 'Free', badgeAlert: true },
  ];
  const demoUser = { id: 'kit-arthur', name: 'Артур Моспан' };

  // No local row helpers here on purpose. This preview used to hand-copy the
  // two rails, and the copy was wrong in five ways at once: 8px radius drawn as
  // 10px, the #ebebeb selected row drawn as white-with-a-shadow, a 32px avatar
  // drawn at 24px, a muted name drawn as bold ink, and no presence dot at all.
  // ChannelRail and MemberRail are the components /chat and /team render, so
  // the catalogue shows the thing itself instead of a drawing of it.

  // MessageBubble in the chat preview can open a confirm ("delete message"),
  // so the section supplies the provider the app supplies at layout level.
  return (
    <ConfirmProvider>
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock
        title="SidebarLayout context=&quot;settings&quot;"
        component="SidebarLayout"
        description="Повна висота вікна, нічого не зафіксовано зверху. InnerNavigation у рейці, біла панель контенту малюється самим лейаутом (hasBorder={false})."
        filePath="src/app/(app)/settings/page.js"
        fullWidth
      >
        <div className="h-[420px] w-full overflow-hidden rounded-[24px] border border-line bg-white">
          <SidebarLayout
            context="settings"
            sidebar={<InnerNavigation items={NAV} activeId={active} onChange={setActive} />}
            hasBorder={false}
          >
            <main className="flex-1 overflow-y-auto custom-scrollbar bg-canvas relative">
              <div className="max-w-[760px] mx-auto px-[16px] py-[24px] md:px-[32px] md:py-[48px] min-h-full flex flex-col">
                <div className="flex-1 pb-[100px]">
                  <h2 className="text-[22px] font-bold text-ink">Особистий профіль</h2>
                  <p className="mt-1 text-[13px] text-muted">Керуйте особистими даними та налаштуваннями профілю.</p>
                  <Surface preset="card" padding="lg" className="mt-6">
                    <div className="h-[180px]" />
                  </Surface>
                </div>
              </div>
            </main>
          </SidebarLayout>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="SidebarLayout context=&quot;team&quot;"
        description="Під фіксованим 56px хедером, тому каркас сам резервує цю висоту. Права панель — Surface preset=&quot;panel&quot;, а не проста біла зона, тому сторінка малює її сама (wrapsContent: false)."
        filePath="src/app/(app)/team/page.js"
        fullWidth
      >
        <div className="h-[420px] w-full overflow-hidden rounded-[24px] border border-line bg-white">
          <SidebarLayout
            context="team"
            mobilePane={teamPane}
            className="!pt-[12px]"
            sidebar={(
              <MemberRail
                members={[
                  { id: 'arthur', name: 'Артур Моспан', positionName: 'Власник організації', online: true },
                  { id: 'olena', name: 'Олена Коваль', positionName: 'Frontend Developer', online: true },
                  { id: 'petro', name: 'Петро Іванчук', positionName: 'Designer' },
                  { id: 'anna', name: 'Анна Мельник', positionName: 'QA Engineer' },
                ]}
                activeId="arthur"
                action={<Button style="ghost" size="icon-xs" icon={Plus} className="hover:!bg-white" title="Запросити" />}
              />
            )}
          >
            <Surface preset="panel" padding="sm" className="flex flex-1 flex-col overflow-hidden">
              <div className="flex flex-col items-center gap-2 py-8">
                <UserAvatar user={demoUser} size="hero" />
                <h3 className="text-[18px] font-bold text-ink">Артур Моспан</h3>
                <StatusPill label="Онлайн" tone="success" />
              </div>
              <button type="button" onClick={() => setTeamPane(teamPane === 'sidebar' ? 'content' : 'sidebar')}
                className="mx-auto rounded-[8px] bg-canvas px-3 py-1.5 text-[11px] font-bold text-muted">
                mobilePane: {teamPane} (клац, щоб перемкнути)
              </button>
            </Surface>
          </SidebarLayout>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="SidebarLayout context=&quot;chat&quot;"
        description="Той самий каркас, але чат подає дві панелі поруч — розмову й гілку — тому лейаут не загортає контент у власну білу зону. Це єдина справжня відмінність чату; жолоб, ширина рейки та відступ під хедером тепер спільні. Нижче md уся ця збірка переходить у телефонну форму: рейка з рядками під палець, нижча шапка розмови, композер в один рядок, а дії повідомлення відкриває дотик, бо hover на телефоні не існує."
        filePath="src/app/(app)/chat/page.js"
        fullWidth
      >
        <div className="h-[420px] w-full overflow-hidden rounded-[24px] border border-line bg-canvas">
          <SidebarLayout
            context="chat"
            className="!pt-[12px]"
            mobilePane={chatPane}
            sidebar={(
              <ChannelRail
                activeId="general"
                groups={[
                  {
                    id: 'channels',
                    label: 'Канали',
                    action: <Button style="ghost" size="icon-xs" icon={Plus} className="hover:!bg-white" title="Новий канал" />,
                    items: [
                      { id: 'general', kind: 'channel', name: 'general' },
                      { id: 'design', kind: 'channel', name: 'design', unreadCount: 3 },
                      { id: 'releases', kind: 'channel', name: 'releases' },
                    ],
                  },
                  {
                    id: 'dms',
                    label: 'Особисті',
                    items: [
                      { id: 'olena', kind: 'dm', name: 'Олена Коваль', user: { name: 'Олена Коваль' }, online: true, unreadCount: 1 },
                      { id: 'petro', kind: 'dm', name: 'Петро Іванчук', user: { name: 'Петро Іванчук' } },
                    ],
                  },
                ]}
              />
            )}
          >
            {/* Below md the shell shows one pane, and which one is the page's
                own state — so the catalogue carries it too, or the phone form
                of the whole conversation could not be looked at here at all. */}
            <div className={`${chatPane === 'sidebar' ? 'hidden' : 'flex'} md:flex flex-1 gap-3 min-w-0 overflow-hidden`}>
              {/* Conversation pane — the product's own chrome: canvas surface,
                  64px translucent header, composer docked at the bottom. */}
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[16px] bg-canvas">
                {/* The header and the list are the product's own components.
                    This preview used to retype both, and the copy was already
                    wrong twice over: a bare <Info> glyph where /chat has a
                    toggle, and no pinned counter at all. */}
                <ChatConversationHeader
                  type="channel"
                  title="general"
                  subtitle="Загальний канал для всієї команди"
                  pinnedCount={1}
                  infoLabel="Про канал"
                  onBack={() => setChatPane('sidebar')}
                />
                {/* `canModerate` is what an owner or admin sees in a group
                    channel: a delete action on someone else's message, and no
                    edit action — an edited message would still carry its
                    author's name. Never set in a direct room. */}
                <ChatMessageList
                  canModerate
                  messages={CHAT_DEMO_MESSAGES}
                  myUid="kit-arthur"
                  members={CHAT_DEMO_MEMBERS}
                  typingUsers={['Олена Коваль']}
                  unreadCount={2}
                  hasMore
                  onLoadMore={() => {}}
                  onReact={() => {}}
                  onEdit={() => {}}
                  onDelete={() => {}}
                  onThread={() => {}}
                  onPin={() => {}}
                  onOpenAttachment={() => {}}
                />
                <ChatComposerDock>
                  <div className="relative px-4 pb-4">
                    <ChatComposerCore variant="workspace" value="" onChange={() => {}} onSubmit={() => {}} placeholder="Написати в #general..." canSubmit={false} />
                  </div>
                </ChatComposerDock>
              </div>
              {/* Thread rail — the second pane, and the only reason chat opts
                  out of the shell drawing a single content pane. */}
              <div data-ui-overlay="responsive-pane" className="hidden shrink-0 flex-col overflow-hidden rounded-[16px] bg-canvas md:flex md:w-[280px]">
                {/* `rounded-t-*`: a bar that paints a `backdrop-filter` is not
                    clipped by its pane's rounded corners in Chromium, so it
                    filled them square — the same repair the real thread pane
                    and `ChatConversationHeader` both carry. */}
                <div className="relative z-10 flex h-[56px] shrink-0 items-center justify-between rounded-t-[var(--ui-radius-surface)] border-b border-line/70 bg-canvas/90 px-5 backdrop-blur-xl">
                  <div className="flex items-center gap-2">
                    <ChatIcon size={16} className="text-muted" />
                    <h3 className="ui-type-card-title text-ink">Гілка</h3>
                  </div>
                  <IconAction label="Закрити гілку" icon={X} size="md" appearance="quiet" composition="chat-panel-action" />
                </div>
              </div>
            </div>
          </SidebarLayout>
        </div>
        <button type="button" onClick={() => setChatPane(chatPane === 'sidebar' ? 'content' : 'sidebar')}
          className="mx-auto mt-[12px] block rounded-[8px] bg-canvas px-3 py-1.5 text-[11px] font-bold text-muted">
          mobilePane: {chatPane} (клац, щоб перемкнути)
        </button>
      </PreviewBlock>

      <PreviewBlock
        title="Шлях назад — стрілка в заголовку"
        component="MobilePaneBack"
        description="Один control замість двох. context=&quot;pane&quot; — вихід із панелі: SidebarLayout нижче md показує лише одну панель, тож видима мусить пропонувати вихід, а на md і вище стрілка ховається, бо обидві панелі й так на екрані. context=&quot;level&quot; — крок усередині екрана («Інтеграції» → одна інтеграція, «Перенесення даних» → одне джерело); такий крок є на будь-якій ширині, тож стрілка лишається і на десктопі. Раніше level малювався кнопкою з підписом над заголовком на десктопі й стрілкою на телефоні — одна дія у двох формах. Підпис нікуди не подівся: він доступна назва й підказка. Перший рядок тут показано примусово, бо pane сам себе ховає на цій ширині."
        filePath="src/components/ui/Navigation/MobilePaneBack.jsx"
      >
        <div className="flex flex-col gap-[12px]">
          <div className="flex items-center gap-4 rounded-[12px] bg-white p-[16px] [&_button]:!flex">
            <span className="font-mono text-[10px] font-bold text-faint">pane</span>
            <MobilePaneBack label="До списку команди" onClick={() => {}} />
            <MobilePaneBack label="Всі налаштування" onClick={() => {}} />
            <MobilePaneBack label="До списку чатів" onClick={() => {}} />
          </div>
          <div className="flex items-center gap-4 rounded-[12px] bg-white p-[16px]">
            <span className="font-mono text-[10px] font-bold text-faint">level</span>
            <MobilePaneBack context="level" label="Усі інтеграції" onClick={() => {}} />
            <MobilePaneBack context="level" label="Усі джерела" onClick={() => {}} />
          </div>
        </div>
      </PreviewBlock>
    </div>
    </ConfirmProvider>
  );
}
