'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  CircleHelp,
  FileText,
  Headphones,
  Info,
  Keyboard,
  Newspaper,
  ShieldCheck,
} from 'lucide-react';
import { Button, ContextMenu, KeyboardShortcutsDialog } from '@/components/ui';
import WorkspaceInfoCenter from '@/components/WorkspaceInfoCenter';
import SupportDialog from '@/components/SupportDialog';

/**
 * Довідка, підтримка, новини та правові документи — один список пунктів і одні
 * діалоги за ними. Рейка на десктопі вішає їх на кебаб; мобільна шторка «Ще»
 * малює ті самі пункти рядками, а `overlays` тримає біля себе, а не всередині
 * шторки, яка закривається від першого ж дотику.
 */
export function useWorkspaceHelp() {
  const router = useRouter();
  const [supportOpen, setSupportOpen] = useState(false);
  // Help, news and versions read in place. They used to navigate to a separate
  // public shell — another header, another nav, another "Увійти" — which threw
  // away whatever the user had on screen to answer a question about it.
  // See `WorkspaceInfoCenter` for why the legal documents still do not.
  const [infoPane, setInfoPane] = useState(null);
  // Гарячі клавіші жили в командній палітрі — серед «Створити проєкт» і
  // «Змінити організацію», хоча самі нічого не роблять. Шпаргалку шукають там,
  // де шукають довідку, і це «?».
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const items = [
    { label: 'Написати у підтримку', icon: Headphones, onClick: () => setSupportOpen(true) },
    { isDivider: true },
    { label: 'Довідка', icon: BookOpen, onClick: () => setInfoPane('help') },
    { label: 'Гарячі клавіші', icon: Keyboard, onClick: () => setShortcutsOpen(true) },
    { label: 'Новини', icon: Newspaper, onClick: () => setInfoPane('news') },
    { isDivider: true },
    // A contract needs an address that can be linked, printed and cited, so
    // these three stay full pages.
    { label: 'Умови користування', icon: ShieldCheck, onClick: () => router.push('/terms') },
    { label: 'Конфіденційність', icon: ShieldCheck, onClick: () => router.push('/privacy') },
    { label: 'Публічна оферта', icon: FileText, onClick: () => router.push('/offer') },
  ];

  const overlays = (
    <>
      <WorkspaceInfoCenter
        pane={infoPane}
        onPaneChange={setInfoPane}
        onClose={() => setInfoPane(null)}
      />

      <KeyboardShortcutsDialog
        isOpen={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />

      <SupportDialog isOpen={supportOpen} onClose={() => setSupportOpen(false)} />
    </>
  );

  return { items, overlays };
}

export default function WorkspaceHelpMenu({ collapsed = false }) {
  const { items, overlays } = useWorkspaceHelp();

  return (
    <>
      {/* A quiet 32px square, not a full-width rail item: help is the least
          urgent thing in the sidebar and a slab as wide as «Налаштування» read
          as another destination. Expanded, the square is centred on the same
          axis as the navigation icons (20px + half an 18px glyph); collapsed,
          it centres in the rail like everything else. */}
      <div className={`shrink-0 flex pb-[10px] ${collapsed ? 'justify-center px-0' : 'pl-[13px] pr-[8px]'}`}>
        <ContextMenu
          dropdownClassName="w-[260px]"
          trigger={(
            <Button
              style="ghost"
              size="icon"
              icon={CircleHelp}
              composition="sidebar-help-action"
              data-sidebar-collapsed={collapsed ? 'true' : 'false'}
              aria-label="Допомога та інформація"
              title="Допомога та інформація"
            />
          )}
          items={items}
        />
      </div>

      {overlays}
    </>
  );
}
