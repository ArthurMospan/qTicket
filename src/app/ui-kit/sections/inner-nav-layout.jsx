'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Surface from '@/components/ui/Surface';
import { SidebarLayout, InnerNavigation, MobilePaneBack, UserAvatar, MemberRail, Pill } from '@/components/ui';
import { Plus, User, Bell, Users, Building } from 'lucide-react';
import { PreviewBlock } from '../preview';

// The two screens that "look different" — and the one shell they share.
//
// Settings and Team each render a canvas rail beside a white pane. Only
// Settings used to say so; Team hand-wrote the same shell, which is exactly how
// they drifted apart. They are still two different layouts — that part was
// never the problem — they are just two *named* ones now, so changing the shell
// changes both and nothing else. There was a third, and it was the workspace
// messenger's; it is deleted, and so is its context.
export default function NavMenuSection() {
  const [active, setActive] = useState('profile');
  const [teamPane, setTeamPane] = useState('sidebar');
  const NAV = [
    { id: 'profile',       label: 'Особистий профіль', icon: User,     group: 'Особисте' },
    { id: 'notifications', label: 'Сповіщення',        icon: Bell,     group: 'Особисте' },
    { id: 'workspace',     label: 'Загальні',          icon: Building, group: 'Організація' },
    { id: 'team',          label: 'Учасники команди',  icon: Users,    group: 'Організація' },
  ];
  const demoUser = { id: 'kit-arthur', name: 'Артур Моспан' };

  // No local row helpers here on purpose. This preview used to hand-copy the
  // rail, and the copy was wrong in five ways at once: 8px radius drawn as
  // 10px, the #ebebeb selected row drawn as white-with-a-shadow, a 32px avatar
  // drawn at 24px, a muted name drawn as bold ink, and no presence dot at all.
  // MemberRail is the component /team renders, so the catalogue shows the thing
  // itself instead of a drawing of it.
  return (
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
                  // `inactive` — місце вимкнули в QuickTeam. Людина лишається
                  // у списку, бо її імʼя лишається на зверненнях.
                  { id: 'ihor', name: 'Ігор Левченко', positionName: 'Support Manager', inactive: true },
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
                <Pill tone="success" size="sm" shape="badge">Онлайн</Pill>
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
            <MobilePaneBack label="До списку звернень" onClick={() => {}} />
          </div>
          <div className="flex items-center gap-4 rounded-[12px] bg-white p-[16px]">
            <span className="font-mono text-[10px] font-bold text-faint">level</span>
            <MobilePaneBack context="level" label="Усі інтеграції" onClick={() => {}} />
            <MobilePaneBack context="level" label="Усі джерела" onClick={() => {}} />
          </div>
        </div>
      </PreviewBlock>
    </div>
  );
}
