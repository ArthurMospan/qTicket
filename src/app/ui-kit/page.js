'use client';
import { useState } from 'react';
import UsagePanel from './UsagePanel';
import { Bell, Loader, Settings, LayoutGrid, Type, Palette, Square, AlignLeft, ToggleLeft, Layers, MessageSquare, Hash, Filter, CheckSquare, MoreVertical, TrendingUp, BarChart3, Users, List, PanelLeftOpen, Grid3x3, MousePointerClick } from 'lucide-react';
import { CalendarIcon, ChatIcon, TaskIcon } from '@/lib/design/icons';
import { ConfirmProvider } from '@/components/ui';
import { KitContext } from './preview';
import ButtonsSection from './sections/buttons';
import InputsSection from './sections/inputs';
import SelectsSection from './sections/selects';
import TabsSection from './sections/tabs';
import SurfacesSection from './sections/surfaces';
import BadgesSection from './sections/badges';
import AvatarsSection from './sections/avatars';
import ProgressSection from './sections/progress';
import NavigationOverlaysSection from './sections/navigation-overlays';
import DialogsSection from './sections/dialogs';
import HeadersSection from './sections/headers';
import PageHeadersSection from './sections/page-headers';
import FeedbackSection from './sections/feedback';
import ChatElementsSection from './sections/chat-elements';
import ChatComposerSection from './sections/chat-composer';
import TaskElementsSection from './sections/task-elements';
import TaskCRMSection from './sections/task-crm';
import SidebarSection from './sections/sidebar-layout';
import TooltipsSection from './sections/tooltips';
import TaskAttributesSection from './sections/task-attributes';
import CalendarSection from './sections/calendar';
import FormGroupsSection from './sections/form-groups';
import NavMenuSection from './sections/inner-nav-layout';
import FiltersSection from './sections/filters';
import TypographySection from './sections/typography';
import TokensSection from './sections/tokens';
import VariantMatrixSection from './sections/variant-matrix';
import StatesSection from './sections/states';
import SkeletonsSection from './sections/skeletons';
import DetailLayoutSection from './sections/detail-layout';
import ChartsSection from './sections/charts';

// ─────────────────────────────────────────────────────────────────────────────
// NAV SECTIONS
// ─────────────────────────────────────────────────────────────────────────────

// Only components belong in this navigation. The ten "Поверхні" entries that
// used to sit above Atoms were the fidelity audit — 145 hand-written controls
// photographed out of the product — and they now live on /ui-audit, where a
// report can be a report instead of impersonating a layer of the kit.
const GROUPS = [
  {
    title: 'Атоми (Atoms)',
    items: [
      { id: 'tokens',       label: 'Design Tokens',      icon: Palette },
      { id: 'typography',   label: 'Typography',         icon: Type },
      { id: 'buttons',      label: 'Buttons',            icon: Square },
      { id: 'inputs',       label: 'Inputs, Selectors & Pickers',  icon: AlignLeft },
      { id: 'selects',      label: 'Selects & Dropdowns',icon: ToggleLeft },
      { id: 'tabs',         label: 'Tabs',               icon: LayoutGrid },
      { id: 'badges',       label: 'Priority, Tags & Counters', icon: Hash },
      { id: 'avatars',      label: 'Avatars & Teams',    icon: Users },
      { id: 'surfaces',     label: 'Surfaces',           icon: Layers },
      { id: 'tooltips',     label: 'Tooltips',           icon: MessageSquare },
    ]
  },
  {
    title: 'Молекули (Molecules)',
    items: [
      { id: 'task-attributes', label: 'Task Attributes Panel', icon: Settings },
      { id: 'calendar',     label: 'Календар — власні елементи', icon: CalendarIcon },
      { id: 'form-groups',  label: 'Form Groups',        icon: AlignLeft },
      { id: 'filters',      label: 'Filter Bar',         icon: Filter },
      { id: 'navigation-overlays', label: 'Navigation & Overlays', icon: MoreVertical },
      { id: 'progress',     label: 'KPI Cards',          icon: TrendingUp },
      { id: 'charts',       label: 'Графіки й таблиці',  icon: BarChart3 },
      { id: 'feedback',     label: 'Feedback & States',  icon: Bell },
      { id: 'skeletons',    label: 'Skeletons',          icon: Loader },
      { id: 'chat-composer', label: 'Chat Composer Dock', icon: ChatIcon },
      { id: 'chat-elements', label: 'Чат — власні елементи', icon: ChatIcon },
    ]
  },
  {
    title: 'Організми (Organisms)',
    items: [
      { id: 'task-crm',     label: 'Task Rows',          icon: TaskIcon },
      { id: 'task-elements', label: 'Задачі — власні елементи', icon: TaskIcon },
      { id: 'dialogs',      label: 'Dialogs & Modals',   icon: MessageSquare },
    ]
  },
  {
    title: 'Лейаути (Layouts)',
    items: [
      { id: 'headers',           label: 'Header (Хедер)',                 icon: LayoutGrid },
      { id: 'page-headers',      label: 'Page Header (Шапка)',            icon: Type },
      { id: 'sidebar-layout',    label: 'Workspace Shell',                icon: PanelLeftOpen },
      { id: 'inner-nav-layout',  label: 'SidebarLayout — 3 контексти',    icon: List },
      { id: 'detail-layout',     label: 'Деталі задачі й події',          icon: TaskIcon },
    ]
  },
  {
    // Every value the kit declares, in one grid. This is what makes "I change
    // it here, it changes on the site" checkable rather than hoped for.
    title: 'Контроль (Control)',
    items: [
      { id: 'variant-matrix', label: 'Матриця варіантів', icon: Grid3x3 },
      { id: 'states',         label: 'Матриця станів',    icon: MousePointerClick },
    ]
  }
];

const SECTIONS = GROUPS.flatMap(g => g.items);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION MAP
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_MAP = {
  buttons:    <ButtonsSection />,
  inputs:     <InputsSection />,
  selects:    <SelectsSection />,
  tabs:       <TabsSection />,
  surfaces:   <SurfacesSection />,
  badges:     <BadgesSection />,
  avatars:    <AvatarsSection />,
  progress:   <ProgressSection />,
  charts:     <ChartsSection />,
  'navigation-overlays': <NavigationOverlaysSection />,
  dialogs:    <DialogsSection />,
  filters:    <FiltersSection />,
  typography: <TypographySection />,
  tokens:     <TokensSection />,
  headers:           <HeadersSection />,
  'page-headers':    <PageHeadersSection />,
  'sidebar-layout':  <SidebarSection />,
  'inner-nav-layout': <NavMenuSection />,
  'detail-layout':    <DetailLayoutSection />,
  'task-crm':  <TaskCRMSection />,
  'task-elements': <TaskElementsSection />,
  feedback:   <FeedbackSection />,
  skeletons:  <SkeletonsSection />,
  'chat-composer': <ChatComposerSection />,
  'chat-elements': <ChatElementsSection />,
  tooltips:        <TooltipsSection />,
  'form-groups':   <FormGroupsSection />,
  'task-attributes': <TaskAttributesSection />,
  calendar:   <CalendarSection />,
  'variant-matrix': <VariantMatrixSection />,
  states:           <StatesSection />,
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function UIKitPage() {
  const [activeSection, setActiveSection] = useState('tokens');
  const [usageFor, setUsageFor] = useState(null);
  const current = SECTIONS.find(s => s.id === activeSection);

  return (
    <ConfirmProvider>
    <KitContext.Provider value={{ openUsage: setUsageFor }}>
    <div className="w-full h-full flex overflow-hidden bg-[#f5f5f5]">

      {/* ── Left Nav ──────────────────────────────────────────────────────── */}
      <div className="hidden md:flex w-[224px] shrink-0 h-full flex-col p-[12px] pr-[6px]">
        <div className="bg-[#1f1f1f] rounded-[20px] h-full flex flex-col overflow-hidden">
          <div className="px-[20px] pt-[20px] pb-[16px] border-b border-white/10 shrink-0">
            <div className="text-[9px] font-bold text-white/30 uppercase tracking-widest mb-[2px]">Internal · Not in nav</div>
            <div className="text-[17px] font-bold text-white">UI Kit</div>
            <div className="text-[10px] text-white/30 mt-[1px]">{SECTIONS.length} sections · product UI only</div>
          </div>
          <nav className="flex-1 overflow-y-auto p-[10px] flex flex-col gap-[14px]">
            {GROUPS.map(g => (
              <div key={g.title} className="flex flex-col gap-[3px]">
                <div className="px-[12px] py-[4px] text-[8px] font-bold text-white/30 uppercase tracking-widest">
                  {g.title}
                </div>
                {g.items.map(s => {
                  const Icon = s.icon;
                  const active = s.id === activeSection;
                  return (
                    <button
                      key={s.id}
                      data-kit-nav={s.id}
                      onClick={() => setActiveSection(s.id)}
                      // min-h rather than a fixed height: a two-line label
                      // (there are several now) overflowed its row and printed
                      // on top of the next item.
                      className={`w-full flex items-center gap-[9px] px-[12px] min-h-[30px] py-[6px] rounded-[8px] text-[12px] font-semibold transition-all text-left ${active ? 'bg-white text-[#1f1f1f] shadow-sm' : 'text-white/50 hover:text-white hover:bg-white/8'}`}
                    >
                      <Icon size={13} className="shrink-0" />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="px-[20px] py-[14px] border-t border-white/10 shrink-0">
            <div className="text-[10px] text-white/25 leading-relaxed">
              Зміни в src/components/ui/<br />
              розходяться по всьому сайту.
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Content ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 h-full flex flex-col overflow-hidden p-0 md:p-[12px] md:pl-[6px]">
        <div className="flex-1 flex flex-col bg-white rounded-none md:rounded-[24px] overflow-hidden border border-[#f0f0f0]">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 px-4 md:px-[32px] py-[14px] md:py-[18px] border-b border-[#f0f0f0] shrink-0">
            <div className="min-w-0">
              <h1 className="text-[24px] font-bold text-[#1f1f1f]">{current?.label}</h1>
              <p className="text-[12px] text-[#9a9a9a] mt-[2px]">Всі компоненти — живі. Зміни в src/components/ui/ відображаються тут і всюди.</p>
            </div>
            <select
              aria-label="Секція UI Kit"
              value={activeSection}
              onChange={event => setActiveSection(event.target.value)}
              className="md:hidden w-full h-10 px-3 bg-[#f4f4f5] border border-[#e2e2e4] rounded-[8px] text-[13px] font-semibold text-[#1f1f1f]"
            >
              {SECTIONS.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
            </select>
            <div className="hidden md:flex items-center gap-[6px] px-[12px] h-[28px] bg-[#f4f4f5] rounded-[8px]">
              <div className="w-[6px] h-[6px] rounded-full bg-[#10b981]" />
              <span className="text-[10px] font-bold text-[#9a9a9a] uppercase tracking-wide">INTERNAL ONLY · /ui-kit</span>
            </div>
          </div>
          {/* The two data attributes are the handles the screenshot suite
              steers by (tests/visual/ui-kit.spec.mjs): which section is on
              screen, and which element to photograph. Names, not classes —
              a test must never be the reason a class exists. */}
          <div
            data-kit-scroll
            data-kit-section={activeSection}
            className="flex-1 overflow-y-auto px-4 py-5 md:px-[32px] md:py-[32px]"
          >
            {SECTION_MAP[activeSection]}
          </div>
        </div>
      </div>
      <UsagePanel component={usageFor} onClose={() => setUsageFor(null)} />
    </div>
    </KitContext.Provider>
    </ConfirmProvider>
  );
}
