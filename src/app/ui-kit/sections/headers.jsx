'use client';
import { useState } from 'react';
import TopHeader from '@/components/ui/Layout/TopHeader';
import UserMenu from '@/components/ui/Layout/UserMenu';
import NotificationBell from '@/components/ui/Layout/NotificationBell';
import NotificationCard from '@/components/ui/Layout/NotificationCard';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { CalendarClock } from 'lucide-react';
import { PreviewBlock } from '../preview';

export default function HeadersSection() {
  // Open by default: a closed menu previews a 36px avatar and nothing else, and
  // the part worth showing is what it opens.
  const [menuOpen, setMenuOpen] = useState(true);

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="1) WorkspaceHeader (Живий компонент)" description="Справжній хедер qTicket, який реагує на контекст екрана, пошук і хлібні крихти." filePath="src/components/WorkspaceHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[16px] overflow-hidden bg-white">
          <WorkspaceHeader />
        </div>
      </PreviewBlock>

      <PreviewBlock title="2) Звичайний пошук (Search Mode)" description="Активний локальний фільтр завжди має вихід у широкий пошук; порожня сторінка показує число збігів поза нею." filePath="src/components/ui/Layout/TopHeader.jsx" fullWidth>
        <div className="min-h-[150px] rounded-[16px] border border-[#f0f0f0] bg-white">
          <TopHeader
            mode="search"
            searchValue="ретро"
            searchPlaceholder="Пошук по моїх зверненнях..."
            searchLocalResultCount={0}
            searchOutsideResultCount={4}
            onSearchEscalate={() => {}}
            unreadCount={0}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock title="3) Хлібні крихти з пошуком (Client Space Mode)" description="Навігація простору клієнта з розсувним пошуком звернень. Склад підтримки видно у вкладці «Учасники», а хедер лишається місцем для навігації." filePath="src/components/ui/Layout/TopHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[16px] overflow-hidden">
          <TopHeader
            mode="project"
            projectName="Acme Україна"
            unreadCount={5}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock title="4) Хлібні крихти детального перегляду (Breadcrumbs Mode)" description="Повний шлях до конкретного звернення в просторі клієнта." filePath="src/components/ui/Layout/TopHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[16px] overflow-hidden">
          <TopHeader
            mode="breadcrumbs"
            breadcrumbs={[
              { label: 'Клієнти', href: '/clients' },
              { label: 'Acme Україна', href: '/client-acme' },
              { label: 'INC-104: Не працює імпорт', href: null },
            ]}
            unreadCount={2}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock title="5) Пошук по чатах (Chat Mode)" description="Спеціальний режим для чатів та каналів." filePath="src/components/ui/Layout/TopHeader.jsx" fullWidth>
        <div className="border border-[#f0f0f0] rounded-[16px] overflow-hidden">
          <TopHeader
            mode="chat"
            showNotifications={false}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="6) Меню користувача"
        description="Аватар у хедері й меню, яке він відкриває. Жив усередині WorkspaceHeader — а той розумний (контекст, стор, роутер, Firestore), тож у кіт переїхала тільки розмітка."
        filePath="src/components/ui/Layout/UserMenu.jsx"
        component="UserMenu"
        fullWidth
      >
        <div className="flex min-h-[220px] justify-end rounded-[16px] border border-[#f0f0f0] bg-white p-[16px]">
          <UserMenu
            user={{ id: 'kit-arthur', name: 'Артур Моспан', email: 'arthur@quickteam.app' }}
            open={menuOpen}
            onToggle={() => setMenuOpen(value => !value)}
            onSettings={() => {}}
            onSignOut={() => {}}
          />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="7) Дзвінок сповіщень"
        description="Скільки непрочитаних, і чи серед них є аварійне — воно замінює сам глиф, бо аварія це не голосніша версія того самого."
        filePath="src/components/ui/Layout/NotificationBell.jsx"
        component="NotificationBell"
      >
        <div className="flex items-center gap-[16px] rounded-[12px] bg-white p-[12px]">
          <NotificationBell unreadCount={0} onToggle={() => {}} />
          <NotificationBell unreadCount={3} onToggle={() => {}} />
          <NotificationBell unreadCount={42} onToggle={() => {}} />
          <NotificationBell unreadCount={2} hasEmergency onToggle={() => {}} />
          <NotificationBell unreadCount={3} open onToggle={() => {}} />
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="8) Картка сповіщення"
        description="Те, що приїжджає над робочою областю, коли сповіщення надходить. Не Toast: тост звітує про твою ж дію і йде сам, а це приходить непроханим, називає відправника. Клікабельна вся картка — окремої кнопки «Перейти» немає; `openLabel` називає призначення для читача екрана."
        filePath="src/components/ui/Layout/NotificationCard.jsx"
        component="NotificationCard"
        fullWidth
      >
        {/* Two of them, because two of them is the real case: the corner holds
            a stack of up to three, oldest at the top and the newest nearest the
            edge. The card no longer pins its own corner, so the box below is
            the stack — the same one the workspace draws. */}
        <div className="flex h-[260px] w-full flex-col items-end justify-end gap-2 overflow-hidden rounded-[16px] bg-canvas p-3">
          <NotificationCard
            icon={<span className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-[10px] bg-white text-ink"><CalendarClock size={16} /></span>}
            title="Планерка команди, четвер 10:00"
            body="Олена Коваль запросила вас на щотижневу зустріч команди дизайну."
            time="5 хв тому"
            openLabel="Відкрити подію"
            onOpen={() => {}}
            onDismiss={() => {}}
          />
          <NotificationCard
            icon={<span className="grid h-[32px] w-[32px] shrink-0 place-items-center rounded-[10px] bg-white text-ink"><CalendarClock size={16} /></span>}
            title="Ігор Лисенко написав у зверненні"
            body="Переніс дедлайн на понеділок — встигнемо зібрати демо."
            time="щойно"
            openLabel="Відкрити чат звернення"
            onOpen={() => {}}
            onDismiss={() => {}}
          />
        </div>
      </PreviewBlock>
    </div>
  );
}
