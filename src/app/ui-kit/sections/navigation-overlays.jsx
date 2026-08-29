'use client';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import ContextMenu from '@/components/ui/ContextMenu';
import { CommandPalette, KeyboardShortcutsDialog, Popover, Tooltip, MetaTrigger } from '@/components/ui';
import { Plus, Edit2, Trash2, Settings, MessageCircle, MoreVertical, Copy, User, Users, Tag as TagIcon, Command, Keyboard } from 'lucide-react';
import { PreviewBlock } from '../preview';
import { buildCommands } from '@/lib/utils/commandPalette.mjs';

const KIT_MENU_LABELS = [
  { id: 'frontend', label: 'Фронтенд' },
  { id: 'bug', label: 'Баг' },
  { id: 'design', label: 'Дизайн' },
];

const KIT_PALETTE_PROJECTS = [
  { id: 'p1', name: 'Сайт RetroMagaz', issuePrefix: 'RM' },
  { id: 'p2', name: 'Мобільний застосунок', issuePrefix: 'MOB' },
];

const KIT_PALETTE_ISSUES = [
  { id: 'i1', issueKey: 'RM-128', title: 'Полагодити доставку сповіщень', projectId: 'p1' },
  { id: 'i2', issueKey: 'MOB-14', title: 'Нижня навігація на iOS', projectId: 'p2' },
];

export default function NavigationOverlaysSection() {
  const [menuLabelIds, setMenuLabelIds] = useState(['frontend']);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const paletteCommands = buildCommands({
    projects: KIT_PALETTE_PROJECTS,
    allowedPermissions: ['create:project'],
    hasActiveTimer: true,
    organizationCount: 2,
  });
  const menuItems = [
    { icon: Edit2, label: 'Редагувати', onClick: () => alert('Редагувати') },
    { icon: Copy, label: 'Дублювати', onClick: () => alert('Дублювати') },
    { icon: Users, label: 'Учасники', onClick: () => alert('Учасники') },
    { icon: Settings, label: 'Налаштування', onClick: () => alert('Налаштування') },
    { isDivider: true },
    { icon: Trash2, label: 'Видалити', isDanger: true, onClick: () => alert('Видалити') },
  ];
  const toggleMenuItems = KIT_MENU_LABELS.map(label => ({
    icon: TagIcon,
    label: label.label,
    selected: menuLabelIds.includes(label.id),
    onClick: () => setMenuLabelIds(current => (
      current.includes(label.id)
        ? current.filter(id => id !== label.id)
        : [...current, label.id]
    )),
  }));

  return (
    <div className="flex flex-col gap-[32px]">
      <PreviewBlock title="Popover & Tooltip" component="Popover" description="Живі Popover і Tooltip, які використовує продукт." fullWidth>
        <div className="flex items-center gap-[24px] flex-wrap">
          <Popover
            trigger={<Button style="secondary">Показати Popover</Button>}
            position="bottom"
          >
            <div className="p-2">
              <h4 className="text-[14px] font-bold mb-1">Інформаційне вікно</h4>
              <p className="text-[12px] text-[#9a9a9a]">Корисна інформація або додаткові налаштування.</p>
            </div>
          </Popover>

          <Tooltip content="Це підказка при наведенні" position="top">
            <Button style="secondary">Наведіть для підказки</Button>
          </Tooltip>
        </div>
      </PreviewBlock>

      <PreviewBlock title="Context Menu" description="Живий ContextMenu з продуктовими станами елементів. Пункт із prop selected стає перемикачем: галочка праворуч, напівжирна назва, панель не закривається (closeOnSelect={false})." fullWidth>
        <div className="flex items-start gap-[40px] flex-wrap">
          <div className="flex flex-col gap-[8px]">
            <span className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider">Інтерактивне меню</span>
            <ContextMenu
              trigger={<Button style="secondary" size="icon" icon={MoreVertical}>Меню</Button>}
              items={menuItems}
            />
          </div>
          <div className="flex flex-col gap-[8px]">
            <span className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider">Меню-перемикач (мітки задачі)</span>
            <ContextMenu
              trigger={(
                <Button style="secondary" size="sm" composition="inline-add-action" icon={Plus}>
                  Додати мітку
                </Button>
              )}
              dropdownClassName="w-[220px]"
              closeOnSelect={false}
              items={toggleMenuItems}
            />
          </div>
          <div className="flex flex-col gap-[8px]">
            <span className="text-[11px] font-bold text-[#9a9a9a] uppercase tracking-wider">Меню людини (align=&quot;start&quot;)</span>
            <ContextMenu
              align="start"
              dropdownClassName="w-[210px]"
              trigger={(
                <MetaTrigger
                  label="Автор:"
                  user={{ id: 'u1', name: 'Артур Моспан' }}
                  name="Артур Моспан"
                  className="text-[12px] font-medium text-muted"
                />
              )}
              items={[
                { icon: User, label: 'Переглянути профіль' },
                { icon: MessageCircle, label: 'Написати в чат' },
              ]}
            />
          </div>
        </div>
      </PreviewBlock>

      <PreviewBlock
        title="Командна палітра"
        component="CommandPalette"
        description="⌘K будь-де у воркспейсі: навігація, дії, проєкти та завдання в одному списку. Каталог і ранжування — чисті функції в lib/utils/commandPalette.mjs."
        fullWidth
      >
        <div className="flex items-center gap-[16px] flex-wrap">
          <Button style="secondary" icon={Command} onClick={() => setPaletteOpen(true)}>
            Відкрити палітру
          </Button>
          <Button style="secondary" icon={Keyboard} onClick={() => setShortcutsOpen(true)}>
            Гарячі клавіші
          </Button>
        </div>
        <CommandPalette
          isOpen={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={paletteCommands}
          issues={KIT_PALETTE_ISSUES}
          projects={KIT_PALETTE_PROJECTS}
          onSelect={() => {}}
          initialQuery="дизайн"
          initialScope={{ type: 'project', projectId: 'p1', label: 'у проєкті Mobile App Redesign' }}
          requestKey={1}
        />
        <KeyboardShortcutsDialog isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </PreviewBlock>

    </div>
  );
}
