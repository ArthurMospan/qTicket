'use client';
import Button from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Forms/Textarea';
import { Select, MultiSelect } from '@/components/ui/Select';
import Surface from '@/components/ui/Surface';
import Tabs from '@/components/ui/Tabs';
import {
  Checkbox, ToggleSwitch, DatePicker, TimePicker, FormGroup, Label, IconAction, Pill, Tag,
  Alert, EmptyState, Card, Segmented, SelectableChip, TextAction, AvatarButton, StatusPill,
  KpiCard, TimeTrackingControl, StatusVisibilityPicker, MarkdownViewer, ChatComposerCore,
} from '@/components/ui';
import kitStates from '../kit-states.generated.json';
import { Plus, Settings2, Folder } from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MATRIX
// ─────────────────────────────────────────────────────────────────────────────

// The catalogue photographs one thing per component: the resting state. That is
// deliberate — a baseline that encodes a pointer position is a baseline nobody
// can reproduce. It also meant the six states where UI actually breaks were
// visible nowhere: unavailable, busy, wrong, hovered, focused, and handed four
// times the text it was drawn for.
//
// Which states a component has is not decided here. `scripts/kit-states.mjs`
// reads it out of the implementation — a destructured prop, a rest spread onto
// a native control, a `hover:`/`focus…:` utility, a text-bearing prop — and
// this section renders whatever that manifest says. So a component cannot grow
// a state that the catalogue quietly fails to show; tests/kit-states.test.mjs
// fails when it does.
//
// Two of the six are pseudo-classes and have no DOM of their own, so they
// cannot be rendered — only provoked. Their cells carry `data-kit-state`, and
// tests/visual/ui-kit.spec.mjs forces `:hover` and `:focus-visible` on them
// through CDP for one extra screenshot. Everything else is a real prop and
// shows up in the ordinary resting shot.

const LONG_TEXT = 'Дуже довгий підпис, який ніхто не малював: він переносить рядок, тисне на сусідів і показує, де саме верстка ламається';
const LONG_LABEL = 'Заголовок, довший за колонку, у яку його поклали';

// One live example per component, with the state props spread over it. `long`
// is passed instead of a prop so each component decides which of its own slots
// carries the overflowing text — the answer differs (`children`, `label`,
// `placeholder`, `message`) and only the component knows it.
const STATE_BASE = {
  Button: ({ long, ...state }) => (
    <Button style="secondary" size="md" icon={Plus} {...state}>{long ? LONG_LABEL : 'Кнопка'}</Button>
  ),
  IconAction: ({ long, ...state }) => (
    <IconAction label={long ? LONG_LABEL : 'Дія'} icon={Settings2} size="md" {...state} />
  ),
  Input: ({ long, ...state }) => (
    <Input defaultValue={long ? LONG_TEXT : 'Значення'} readOnly {...state} />
  ),
  Textarea: ({ long, ...state }) => (
    <Textarea rows={2} defaultValue={long ? LONG_TEXT : 'Значення'} readOnly {...state} />
  ),
  Select: ({ long, ...state }) => (
    <Select
      value="a"
      onChange={() => {}}
      options={[{ value: 'a', label: long ? LONG_LABEL : 'Обрано' }]}
      {...state}
    />
  ),
  MultiSelect: ({ long, ...state }) => (
    <MultiSelect
      value={['a']}
      onChange={() => {}}
      options={[{ value: 'a', label: long ? LONG_LABEL : 'Обрано' }]}
      {...state}
    />
  ),
  Checkbox: ({ long, ...state }) => (
    <Checkbox checked onChange={() => {}} label={long ? LONG_TEXT : 'Згоден'} {...state} />
  ),
  ToggleSwitch: ({ long, ...state }) => (
    <ToggleSwitch checked onChange={() => {}} label={long ? LONG_TEXT : 'Увімкнено'} {...state} />
  ),
  DatePicker: ({ long, ...state }) => (
    <DatePicker value="2026-07-12" onChange={() => {}} placeholder={long ? LONG_LABEL : 'Оберіть дату'} {...state} />
  ),
  TimePicker: ({ long, ...state }) => <TimePicker value="09:30" onChange={() => {}} {...state} />,
  Tabs: ({ long, ...state }) => (
    <Tabs
      tabs={[{ id: 'a', label: long ? LONG_LABEL : 'Огляд' }, { id: 'b', label: 'Час' }]}
      activeTab="a"
      onTabChange={() => {}}
      {...state}
    />
  ),
  Segmented: ({ long, ...state }) => (
    <Segmented
      value="a"
      onChange={() => {}}
      options={[{ value: 'a', label: long ? LONG_LABEL : 'Один' }, { value: 'b', label: 'Два' }]}
      {...state}
    />
  ),
  SelectableChip: ({ long, ...state }) => (
    <SelectableChip selected {...state}>{long ? LONG_LABEL : 'Чіп'}</SelectableChip>
  ),
  TextAction: ({ long, ...state }) => <TextAction {...state}>{long ? LONG_LABEL : 'Дія'}</TextAction>,
  Pill: ({ long, ...state }) => <Pill {...state}>{long ? LONG_LABEL : 'Мітка'}</Pill>,
  Tag: ({ long, ...state }) => <Tag {...state}>{long ? LONG_LABEL : 'Тег'}</Tag>,
  StatusPill: ({ long, ...state }) => (
    <StatusPill label={long ? LONG_LABEL : 'Активний'} color="#10b981" {...state} />
  ),
  Label: ({ long, ...state }) => <Label {...state}>{long ? LONG_TEXT : 'Підпис'}</Label>,
  FormGroup: ({ long, ...state }) => (
    <FormGroup label={long ? LONG_LABEL : 'Поле'} {...state}>
      <Input defaultValue="Значення" readOnly />
    </FormGroup>
  ),
  Alert: ({ long, ...state }) => <Alert {...state}>{long ? LONG_TEXT : 'Повідомлення'}</Alert>,
  EmptyState: ({ long, ...state }) => (
    <EmptyState
      icon={Folder}
      title={long ? LONG_LABEL : 'Порожньо'}
      description={long ? LONG_TEXT : 'Немає записів.'}
      density="compact"
      {...state}
    />
  ),
  Card: ({ long, ...state }) => (
    <Card {...state}><span className="text-[11px] text-muted">{long ? LONG_TEXT : 'Картка'}</span></Card>
  ),
  Surface: ({ long, ...state }) => (
    <Surface padding="md" {...state}>
      <span className="text-[11px] text-muted">{long ? LONG_TEXT : 'Поверхня'}</span>
    </Surface>
  ),
  // `onClick` is what turns the hover ring on — a KPI card that leads nowhere
  // deliberately does not react to the pointer, so without it the hover cell
  // would be a photograph of the resting state.
  KpiCard: ({ long, ...state }) => (
    <KpiCard label={long ? LONG_LABEL : 'Витрачено'} value="128 год" sub="за місяць" onClick={() => {}} {...state} />
  ),
  AvatarButton: ({ long, ...state }) => (
    <AvatarButton user={{ id: 'kit', name: 'Артур Моспан' }} label={long ? LONG_LABEL : 'Профіль'} {...state} />
  ),
  MarkdownViewer: ({ long, ...state }) => (
    <MarkdownViewer content={long ? LONG_TEXT : 'Опис завдання'} {...state} />
  ),
  TimeTrackingControl: ({ long, ...state }) => (
    <TimeTrackingControl
      running
      spentLabel={long ? LONG_LABEL : '2 год 15 хв'}
      estimateLabel="/ 4 год"
      onToggle={() => {}}
      onOpen={() => {}}
      {...state}
    />
  ),
  StatusVisibilityPicker: ({ long, ...state }) => (
    <div className="w-full max-w-[260px]">
      <StatusVisibilityPicker
        statuses={[{ id: 'backlog', label: 'Беклог', color: '#9a9a9a' }, { id: 'doing', label: long ? LONG_LABEL : 'В роботі', color: '#3b82f6' }]}
        hiddenStatusIds={[]}
        onChange={() => {}}
        {...state}
      />
    </div>
  ),
  ChatComposerCore: ({ long, ...state }) => (
    <div className="w-full max-w-[320px]">
      <ChatComposerCore
        value={long ? LONG_TEXT : ''}
        onChange={() => {}}
        onSubmit={() => {}}
        placeholder="Повідомлення"
        {...state}
      />
    </div>
  ),
};

// What each state has to be handed to appear. `error` takes a string wherever
// the component prints one and a boolean where it only recolours a border, so
// both shapes are passed and the component uses the one it understands.
const STATE_PROPS = {
  hover: {},
  focus: {},
  disabled: { disabled: true },
  loading: { loading: true },
  error: { error: 'Заповніть поле' },
  'long-text': { long: true },
};

const STATE_LABELS = {
  hover: 'hover',
  focus: 'focus',
  disabled: 'disabled',
  loading: 'loading',
  error: 'error',
  'long-text': 'довгий текст',
};

// Why a state is where it is: the two pseudo-classes are provoked by the
// screenshot suite, the four prop states are simply rendered.
const PSEUDO_STATES = new Set(['hover', 'focus']);

// Where a state comes from, in the manifest's own words. Worth printing: `css`
// and `global` mean the component itself says nothing about the state and
// inherits it from globals.css, which is exactly the case somebody deleting a
// rule there needs to be able to find.
const SOURCE_LABELS = {
  prop: 'проп',
  native: 'нативний контрол',
  own: 'власні класи',
  css: 'globals.css',
  global: 'глобальний ring',
};

function StateCell({ component, state, source, render }) {
  const forced = PSEUDO_STATES.has(state);
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <div
        // The screenshot suite finds these two attributes and forces the real
        // pseudo-class on everything inside — no duplicated `:hover` classes,
        // which would be a second copy of the component's own styling.
        data-kit-state={forced ? state : undefined}
        data-kit-state-component={forced ? component : undefined}
        className="flex min-h-[64px] items-center justify-center overflow-hidden rounded-[8px] bg-[#fafafa] p-2"
      >
        <div className="flex w-full min-w-0 items-center justify-center">{render}</div>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[10px] font-bold text-ink">{STATE_LABELS[state]}</span>
        <span className={`ml-auto shrink-0 text-[9px] font-semibold text-faint ${SOURCE_LABELS[source] ? '' : 'font-mono'}`}>
          {SOURCE_LABELS[source] || source}
        </span>
      </div>
    </div>
  );
}

function LiveRow({ component, states }) {
  const render = STATE_BASE[component];
  const shown = kitStates.stateOrder.filter(state => states[state]);

  return (
    <section className="rounded-[14px] border border-line bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="font-mono text-[12px] font-bold text-ink">{component}</span>
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] font-bold text-muted">
          {shown.length} станів
        </span>
      </div>
      <div className="grid gap-[10px] p-[14px] [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        {/* The resting state sits first in every row on purpose: a state is only
            readable next to the thing it is a departure from. */}
        <div className="flex min-w-0 flex-col gap-[6px]">
          <div className="flex min-h-[64px] items-center justify-center overflow-hidden rounded-[8px] border border-dashed border-line bg-white p-2">
            <div className="flex w-full min-w-0 items-center justify-center">{render({})}</div>
          </div>
          <span className="font-mono text-[10px] font-bold text-faint">спокій</span>
        </div>
        {shown.map(state => (
          <StateCell
            key={state}
            component={component}
            state={state}
            source={states[state]}
            render={render(STATE_PROPS[state])}
          />
        ))}
      </div>
    </section>
  );
}

export default function StatesSection() {
  const { components, totals, stateOrder, previewSections } = kitStates;
  const live = Object.keys(STATE_BASE).sort();
  const pointed = Object.entries(components)
    .filter(([name, states]) => Object.keys(states).length > 0 && !STATE_BASE[name])
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="flex flex-col gap-[24px]">
      <Surface preset="bordered-panel" padding="lg">
        <h2 className="text-[18px] font-bold text-ink">
          {totals.stateful} з {totals.components} компонентів мають щонайменше один стан
        </h2>
        <p className="mt-2 max-w-[820px] text-[12px] leading-relaxed text-muted">
          Стан оголошує реалізація, а не список: деструктурований проп, rest-spread на нативний
          контрол, <span className="font-mono">hover:</span> чи <span className="font-mono">focus…:</span> утиліта,
          текстовий проп. Тому компонент не може отримати стан, якого каталог не показує —
          <span className="font-mono"> tests/kit-states.test.mjs</span> впаде.
        </p>
        <div className="mt-3 flex flex-wrap gap-[8px] text-[11px] font-semibold">
          {stateOrder.map(state => (
            <span key={state} className="rounded-[6px] bg-canvas px-[8px] py-[3px] text-muted">
              {STATE_LABELS[state]} — {totals[state]}
            </span>
          ))}
        </div>
        <p className="mt-3 max-w-[820px] text-[11px] leading-relaxed text-faint">
          hover і focus — псевдокласи: власного DOM у них немає, їх не можна відрендерити, лише
          спровокувати. Ці клітинки несуть <span className="font-mono">data-kit-state</span>, і
          скріншот-сюїт вмикає на них справжній <span className="font-mono">:hover</span> /{' '}
          <span className="font-mono">:focus-visible</span> через CDP окремим знімком.
        </p>
      </Surface>

      {live.map(component => (
        <LiveRow key={component} component={component} states={components[component] || {}} />
      ))}

      <section className="rounded-[14px] border border-line bg-white">
        <div className="border-b border-line px-4 py-2.5">
          <span className="text-[12px] font-bold text-ink">Решта кіту — {pointed.length} компонентів</span>
          <p className="mt-1 max-w-[760px] text-[11px] leading-relaxed text-muted">
            Композиції та цілі екрани: окремий приклад для них був би вигаданим — вони живуть
            усередині власних секцій. Стани в них ті самі й перелічені тут, а посилання на секцію
            виводиться зі сторі-файлів, не написане руками.
          </p>
        </div>
        <div className="grid gap-[8px] p-[14px] [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]">
          {pointed.map(([name, states]) => (
            <div key={name} className="flex flex-col gap-[5px] rounded-[10px] border border-line bg-canvas p-[10px]">
              <span className="font-mono text-[11px] font-bold text-ink">{name}</span>
              <div className="flex flex-wrap gap-[4px]">
                {stateOrder.filter(state => states[state]).map(state => (
                  <span key={state} className="rounded-[5px] bg-white px-[6px] py-[2px] font-mono text-[9px] font-semibold text-muted">
                    {STATE_LABELS[state]}
                  </span>
                ))}
              </div>
              <span className="text-[10px] text-faint">
                {(previewSections[name] || []).join(', ') || 'показаний через компонент-хост'}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
