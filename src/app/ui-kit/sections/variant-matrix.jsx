'use client';
import { useContext } from 'react';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Forms/Textarea';
import { Select, MultiSelect } from '@/components/ui/Select';
import Surface from '@/components/ui/Surface';
import { AttributeTrigger, DetailSection, Meter, FormGroup, IconAction, Label, Pill, Tag, Counter, ToggleSwitch, Alert, LoadingSpinner, Skeleton, EmptyState, Popover, Card, Segmented, UserAvatar, ChatComposerCore, MarkdownViewer, SelectableChip, ResponseChoice, CalendarEntry, CalendarDayNumber, CalendarDayCell, ColorSwatch, ListRow, Tabs, FileThumb } from '@/components/ui';
import MentionMenu from '@/components/ui/Chat/MentionMenu';
import MobilePaneBack from '@/components/ui/Navigation/MobilePaneBack';
import AvatarButton from '@/components/ui/DataDisplay/AvatarButton';
import TextAction from '@/components/ui/TextAction';
import kitUsage from '../kit-usage.generated.json';
import kitDrift from '../kit-drift.generated.json';
import { Plus, Settings2, Folder, Users as UsersIcon } from 'lucide-react';
import { KitContext } from '../preview';
import { KIT_MENTION_MEMBERS } from '../demo-data';

// ─────────────────────────────────────────────────────────────────────────────
// VARIANT MATRIX
// ─────────────────────────────────────────────────────────────────────────────

// Every value the implementation declares — rendered, not listed.
//
// The list version of this screen still let a variant hide: 53 values shipped
// on the site while no preview anywhere showed them, so "the kit is the source"
// was true for the component and false for half its variants. Rendering each
// declared value from the manifest closes that structurally — a variant cannot
// exist without a preview, because the preview is generated from the same
// declaration the variant is. Adding a lookup-map entry or a `data-ui-*` rule
// makes it appear here on the next `npm run kit:drift`; nothing is hand-written.
//
// One base example per component, with the variant prop spread over it. Where a
// component cannot stand alone — Dialog needs an open state, PageHeader a whole
// page — the value is shown with the reason and a pointer to its real preview,
// rather than a fabricated example that would be a second source of truth.
const VARIANT_BASE = {
  Button: (props) => <Button style="secondary" size="md" icon={Plus} {...props}>Кнопка</Button>,
  IconAction: (props) => <IconAction label="Дія" icon={Settings2} size="md" {...props} />,
  Input: (props) => <Input placeholder="Текст" {...props} />,
  Textarea: (props) => <Textarea placeholder="Текст" rows={2} {...props} />,
  Select: (props) => (
    <Select value="a" onChange={() => {}} options={[{ value: 'a', label: 'Обрано' }]} {...props} />
  ),
  MultiSelect: (props) => (
    <MultiSelect value={['a']} onChange={() => {}} options={[{ value: 'a', label: 'Обрано' }]} {...props} />
  ),
  Surface: (props) => <Surface padding="md" {...props}><span className="text-[11px] text-muted">Поверхня</span></Surface>,
  Pill: (props) => <Pill {...props}>Мітка</Pill>,
  UserAvatar: (props) => <UserAvatar user={{ id: 'kit', name: 'Артур Моспан' }} {...props} />,
  Counter: (props) => <Counter value={3} {...props} />,
  Alert: (props) => <Alert {...props}>Повідомлення</Alert>,
  LoadingSpinner: (props) => <LoadingSpinner {...props} />,
  // Given a width in the cell so a percentage role has something to be a
  // percentage of, and a fixed height so `panel` does not swallow the grid.
  Skeleton: (props) => (
    <span className="flex h-[40px] w-[76px] items-center">
      <Skeleton {...props} />
    </span>
  ),
  ToggleSwitch: (props) => <ToggleSwitch checked onChange={() => {}} {...props} />,
  Segmented: (props) => (
    <Segmented value="a" onChange={() => {}} options={[{ value: 'a', label: 'Один' }, { value: 'b', label: 'Два' }]} {...props} />
  ),
  Card: (props) => <Card {...props}><span className="text-[11px] text-muted">Картка</span></Card>,
  ResponseChoice: (props) => <ResponseChoice value="accepted" onChange={() => {}} {...props} />,
  CalendarEntry: (props) => (
    <CalendarEntry
      accent="#6366f1"
      background="#eef2ff"
      title="10:00 Планерка"
      leading={<UsersIcon size={11} style={{ color: '#6366f1' }} className="shrink-0" />}
      {...props}
    />
  ),
  CalendarDayNumber: (props) => <CalendarDayNumber aria-label="Відкрити 14 число" {...props}>14</CalendarDayNumber>,
  CalendarDayCell: (props) => (
    <CalendarDayCell className="w-[92px]" {...props}>
      <span className="text-[12px] font-bold text-ink">14</span>
      <span className="text-[10px] text-muted">3 завд.</span>
    </CalendarDayCell>
  ),
  Tabs: (props) => (
    <Tabs
      activeTab="a"
      onTabChange={() => {}}
      tabs={[{ id: 'a', label: 'Один' }, { id: 'b', label: 'Два' }]}
      {...props}
    />
  ),
  ColorSwatch: (props) => <ColorSwatch color="#ef4444" label="Колір мітки" {...props} />,
  ListRow: (props) => (
    <ListRow className="flex items-center justify-between" {...props}>
      <span className="text-[12px] font-semibold text-ink">Рядок списку</span>
      <span className="text-[11px] text-muted">деталь</span>
    </ListRow>
  ),
  AttributeTrigger: (props) => (
    <AttributeTrigger {...props}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Атрибут</span>
      <span className="text-[13px] font-medium text-ink">Значення</span>
    </AttributeTrigger>
  ),
  FormGroup: (props) => <FormGroup label="Поле" {...props}><Input placeholder="Текст" /></FormGroup>,
  Label: (props) => <Label {...props}>Підпис</Label>,
  Tag: (props) => <Tag {...props}>Тег</Tag>,
  SelectableChip: (props) => <SelectableChip selected {...props}>Чіп</SelectableChip>,
  MarkdownViewer: (props) => <MarkdownViewer content="Опис завдання" {...props} />,
  FileThumb: (props) => <FileThumb attachment={{ name: 'кошторис.xlsx' }} {...props} />,
  Meter: (props) => (
    <span className="block w-[120px]">
      <Meter value={0.62} reading="62%" {...props} />
    </span>
  ),
  DetailSection: (props) => (
    <DetailSection icon={Folder} title="Вкладення" count={3} {...props}>
      <span className="text-[11px] text-muted">Вміст блоку</span>
    </DetailSection>
  ),
  EmptyState: (props) => <EmptyState icon={Folder} title="Порожньо" description="Немає записів." {...props} />,
  Popover: (props) => (
    <Popover trigger={<span className="text-[11px] font-semibold text-ink underline">Відкрити</span>} {...props}>
      <span className="text-[11px] text-muted">Вміст</span>
    </Popover>
  ),
  ChatComposerCore: (props) => (
    <div className="w-full max-w-[420px]">
      <ChatComposerCore value="" onChange={() => {}} onSubmit={() => {}} placeholder="Повідомлення" {...props} />
    </div>
  ),
  TextAction: (props) => <TextAction {...props}>Дія</TextAction>,
  AvatarButton: (props) => (
    <AvatarButton user={{ id: 'kit', name: 'Артур Моспан' }} label="Переглянути профіль" {...props} />
  ),
  MentionMenu: (props) => (
    <div className="w-full max-w-[240px]">
      <MentionMenu members={KIT_MENTION_MEMBERS.slice(0, 2)} onSelect={() => {}} {...props} />
    </div>
  ),
  // `pane` hides itself at md and up, which is every width this catalogue is
  // read at — so the cell would be empty, and an empty cell reads as a broken
  // preview rather than as the point being made. Forced visible here, with the
  // words under it saying which of the two is on screen.
  MobilePaneBack: (props) => (
    <span className="[&_button]:!block">
      <MobilePaneBack label="Назад" onClick={() => {}} {...props} />
    </span>
  ),
};

// Why a component has no standalone example, and where to look instead.
const VARIANT_ELSEWHERE = {
  DataTable: 'Потрібні колонки й рядки — див. «Графіки й таблиці»',
  Dialog: 'Потребує відкритого стану — див. «Dialogs & Modals»',
  FilterBar: 'Живе всередині PageHeader — див. «Filter Bar»',
  TaskAttributesPanel: 'Потребує задачі — див. «Task Attributes Panel»',
  ChatComposerDock: 'Прикріплений до низу екрана — див. «Chat Composer Dock»',
  SidebarLayout: 'Каркас цілого екрана — див. «SidebarLayout — 3 контексти»',
  DetailLayout: 'Каркас цілої сторінки — див. «Деталі задачі й події»',
};

// A dark value needs a dark backdrop to be visible at all.
const NEEDS_DARK = /inverse|overlay|auth-close|sidebar/;

function VariantCell({ component, prop, value, count, previewed }) {
  const render = VARIANT_BASE[component];
  const tone = count === 0
    ? 'border-line bg-canvas'
    : previewed
      ? 'border-[#a7f3d0] bg-white'
      : 'border-[#fde68a] bg-white';

  return (
    <div className={`flex min-w-0 flex-col gap-[4px] overflow-hidden rounded-[10px] border p-[8px] ${tone}`}>
      {/* A cell is 80px wide and already crops what does not fit sideways. The
          same has to be true downwards: one EmptyState renders 381px tall in
          here and one Surface preset 573px, and because a grid row is as tall
          as its tallest cell, three such components were carrying ~1800px of
          this section on their own. The matrix answers "what does this value
          look like", not "what is this component made of" — the anatomy is in
          the component's own section. Without the cap the section outgrew the
          16000px screenshot ceiling and the whole run failed on 7 pixels. */}
      <div
        className={`relative isolate flex max-h-[120px] min-h-[32px] items-center justify-center overflow-hidden rounded-[8px] p-2 ${
          NEEDS_DARK.test(value) ? 'bg-ink' : 'bg-[#fafafa]'
        }`}
      >
        {render
          ? render({ [prop]: value })
          : <span className="px-2 text-center text-[10px] leading-relaxed text-faint">{VARIANT_ELSEWHERE[component]}</span>}
      </div>
      <div className="flex min-w-0 items-baseline gap-1.5">
        <span title={value} className="min-w-0 truncate font-mono text-[10px] font-bold text-ink">{value}</span>
        <span className={`ml-auto shrink-0 rounded-full px-[6px] text-[9px] font-bold ${
          count === 0 ? 'bg-canvas text-faint' : 'bg-[#ecfdf5] text-[#047857]'
        }`}>
          ×{count}
        </span>
      </div>
    </div>
  );
}

export default function VariantMatrixSection() {
  const { openUsage } = useContext(KitContext);
  const manifest = kitDrift.manifest;
  const usedCounts = kitDrift.usage;
  const previewed = new Set(kitDrift.previewedValues);

  return (
    <div className="flex flex-col gap-[16px]">
      <Surface preset="bordered-panel" padding="lg">
        <h2 className="text-[18px] font-bold text-ink">
          {kitDrift.totals.declaredValues} оголошених значень у {Object.keys(manifest).length} компонентах
        </h2>
        <p className="mt-2 max-w-[820px] text-[12px] leading-relaxed text-muted">
          Варіант оголошує реалізація, а не список: lookup-мапи компонентів і
          <span className="font-mono"> data-ui-*</span> правила в globals.css. Кожне значення тут
          відрендерене живим компонентом — тому варіант не може існувати без preview.
          Щоб додати варіант, додай запис у мапу або правило в CSS, і він з&apos;явиться сам.
        </p>
        <div className="mt-3 flex flex-wrap gap-[8px] text-[11px] font-semibold">
          <span className="rounded-[6px] bg-[#ecfdf5] px-[8px] py-[3px] text-[#047857]">
            вживається на сайті — {kitDrift.totals.declaredValues - kitDrift.totals.declaredUnused}
          </span>
          <span className="rounded-[6px] bg-canvas px-[8px] py-[3px] text-muted">
            оголошене, не вживається — {kitDrift.totals.declaredUnused}
          </span>
        </div>
      </Surface>

      {Object.entries(manifest).map(([component, props]) => (
        <section key={component} className="min-w-0 rounded-[14px] border border-line bg-white">
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <button
              type="button"
              onClick={() => openUsage(component)}
              className="cursor-pointer font-mono text-[12px] font-bold text-ink hover:underline"
            >
              {component}
            </button>
            <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-bold text-muted">
              {kitUsage.components[component]?.count ?? 0} використань
            </span>
            {VARIANT_ELSEWHERE[component] && (
              <span className="text-[10px] text-faint">{VARIANT_ELSEWHERE[component]}</span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-[8px] p-[10px]">
            {Object.entries(props).map(([prop, values]) => (
              <div key={prop} className="min-w-0">
                <div className="mb-[6px] font-mono text-[11px] font-bold text-ink">{prop}</div>
                <div className="grid min-w-0 gap-[5px] [grid-template-columns:repeat(auto-fill,minmax(80px,1fr))]">
                  {values.map(value => (
                    <VariantCell
                      key={value}
                      component={component}
                      prop={prop}
                      value={value}
                      count={usedCounts[`${component}.${prop}.${value}`] || 0}
                      previewed={previewed.has(`${component}.${prop}.${value}`)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
