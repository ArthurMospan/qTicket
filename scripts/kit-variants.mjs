// Derives the variant manifest from the implementation, never from a list
// somebody maintains by hand.
//
// The first attempt at this WAS a hand-written list, and it was wrong within
// minutes: it missed `Pill tone="ink-subtle"`, `size="thin-md"`, four Button
// compositions and two Dialog sizes. That is the same failure mode as the
// hand-written previews it was meant to fix, one level up.
//
// Variants live in exactly two places in this codebase, so both are read:
//   • JS lookup maps inside a component (Button SIZES, EmptyState CONTEXTS…)
//   • data-ui-* attribute selectors in globals.css (Pill tones, compositions…)

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_DIR = join(ROOT, 'src', 'components', 'ui');
const GLOBALS = join(ROOT, 'src', 'app', 'globals.css');

// Where each component's variants are actually defined. `map` reads the keys of
// a JS object in the component; `css` reads the values an attribute selector is
// given in globals.css, scoped by the class the component renders (several
// components share data-ui-composition, so the class prefix disambiguates).
const SOURCES = {
  Button: {
    size: { map: ['Button.jsx', 'SIZES'] },
    style: { map: ['Button.jsx', 'STYLES'] },
    shape: { map: ['Button.jsx', 'SHAPES'] },
    surface: { map: ['Button.jsx', 'SURFACES'] },
    color: { literal: ['dark', 'red'] },
    composition: { css: ['.ui-control', 'data-ui-composition'], map: ['Button.jsx', 'COMPOSITION_ICON_SIZES'] },
  },
  IconAction: {
    size: { map: ['IconAction.jsx', 'BUTTON_SIZES'] },
    appearance: { map: ['IconAction.jsx', 'APPEARANCES'] },
    shape: { map: ['Button.jsx', 'SHAPES'] },
    composition: { css: ['.ui-control', 'data-ui-composition'], map: ['Button.jsx', 'COMPOSITION_ICON_SIZES'] },
  },
  Input: {
    size: { literal: ['sm', 'md', 'lg'] },
    composition: { css: ['.ui-control', 'data-ui-composition'] },
    preset: { literal: ['money'] },
  },
  Textarea: {
    composition: { css: ['.ui-textarea', 'data-ui-composition'] },
    surface: { map: ['Forms/Textarea.jsx', 'SURFACES'] },
  },
  Select: {
    size: { literal: ['sm', 'md', 'lg'] },
    variant: { literal: ['default', 'ghost', 'inline'] },
    filterRole: { map: ['FilterBar.jsx', 'WIDTHS', 'default'] },
  },
  MultiSelect: {
    size: { literal: ['sm', 'md', 'lg'] },
    variant: { literal: ['default', 'ghost', 'inline'] },
    filterRole: { map: ['FilterBar.jsx', 'WIDTHS', 'default'] },
  },
  Surface: {
    preset: { map: ['Surface.jsx', 'PRESETS'] },
    padding: { css: ['.ui-surface', 'data-ui-padding'] },
    composition: { css: ['.ui-surface', 'data-ui-composition'] },
  },
  Pill: {
    tone: { css: ['', 'data-ui-pill-tone'] },
    size: { css: ['', 'data-ui-pill-size'] },
    shape: { css: ['', 'data-ui-pill-shape'] },
    appearance: { css: ['', 'data-ui-pill-appearance'] },
    preset: { css: ['', 'data-ui-pill-preset'] },
    weight: { literal: ['bold', 'medium'] },
  },
  UserAvatar: {
    size: { map: ['DataDisplay/UserAvatar.jsx', 'AVATAR_SIZES'] },
  },
  // AvatarButton is UserAvatar with a control around it, so it reads the same
  // scale rather than declaring a second one that could drift from it.
  AvatarButton: {
    size: { map: ['DataDisplay/UserAvatar.jsx', 'AVATAR_SIZES'] },
  },
  TextAction: {
    tone: { map: ['TextAction.jsx', 'TONES'] },
    size: { map: ['TextAction.jsx', 'SIZES'] },
  },
  SelectableChip: {
    shape: { map: ['Forms/SelectableChip.jsx', 'SHAPES'] },
  },
  MarkdownViewer: {
    size: { map: ['DataDisplay/MarkdownViewer.jsx', 'SIZES'] },
  },
  // Three squares, not three sizes of icon: the list square, the small one that
  // rides inside a chat tile, and the large one the viewer's fallback card puts
  // above a file it cannot render.
  FileThumb: {
    density: { map: ['Attachments/FileThumb.jsx', 'GLYPH_SIZES'] },
  },
  MentionMenu: {
    density: { map: ['Chat/MentionMenu.jsx', 'DENSITIES'] },
  },
  Counter: {
    size: { literal: ['xs', 'sm', 'md', 'lg'] },
    variant: { literal: ['count', 'dot'] },
    status: { literal: ['info', 'danger', 'muted', 'success'] },
    appearance: { literal: ['solid', 'subtle', 'inverse-outline', 'sidebar'] },
  },
  Dialog: {
    size: { map: ['Dialog.jsx', 'sizeClasses'] },
    bodyPadding: { map: ['Dialog.jsx', 'bodyPaddingClass'] },
    titleContext: { literal: ['dialog', 'eyebrow'] },
    presentation: { literal: ['dialog', 'sheet'] },
  },
  Alert: {
    variant: { map: ['Feedback/Alert.jsx', 'variantConfig'] },
  },
  EmptyState: {
    context: { map: ['Feedback/EmptyState.jsx', 'CONTEXTS'] },
    density: { map: ['Feedback/EmptyState.jsx', 'DENSITIES'] },
    surface: { map: ['Feedback/EmptyState.jsx', 'SURFACES'] },
  },
  LoadingSpinner: {
    size: { map: ['Feedback/LoadingSpinner.jsx', 'sizes'] },
  },
  Skeleton: {
    preset: { css: ['', 'data-ui-skeleton-preset'] },
    width: { css: ['', 'data-ui-skeleton-width'] },
    tone: { css: ['', 'data-ui-skeleton-tone'] },
  },
  ToggleSwitch: {
    size: { literal: ['sm', 'md', 'lg'] },
  },
  Segmented: {
    surface: { literal: ['transparent', 'canvas'] },
    // `billing-selection` is pinned by tests/issue-fixes.test.mjs (QUI-78) but
    // has no rule in globals.css, so it currently renders identically to the
    // default. Declared here so the manifest is honest about it; whether it
    // should get a rule or be dropped is an open product question.
    composition: { css: ['.ui-segmented', 'data-ui-composition'], literal: ['billing-selection'] },
  },
  Card: {
    padding: { literal: ['none', 'sm', 'md', 'lg'] },
    preset: { literal: ['bordered', 'bordered-compact', 'borderless', 'elevated'] },
  },
  AttributeTrigger: { variant: { literal: ['cell', 'details'] } },
  CalendarEntry: { tone: { literal: ['deadline', 'event'] } },
  ColorSwatch: { size: { literal: ['choice', 'theme', 'trigger'] } },
  ListRow: { density: { literal: ['compact', 'roomy'] } },
  CalendarDayNumber: { state: { literal: ['default', 'outside', 'today'] } },
  CalendarDayCell: {
    state: { map: ['Calendar/CalendarDayCell.jsx', 'STATES'] },
    density: { map: ['Calendar/CalendarDayCell.jsx', 'DENSITIES'] },
  },
  ResponseChoice: {
    size: { literal: ['md', 'sm', 'tile'] },
    surface: { literal: ['canvas', 'surface'] },
  },
  FormGroup: { gap: { literal: ['sm', 'md'] } },
  Tabs: {
    variant: { literal: ['raised', 'underline'] },
    composition: { css: ['.ui-tabs', 'data-ui-composition'] },
  },
  Label: { context: { literal: ['field', 'inline'] } },
  // PageHeader declares no variants: `alt` was removed with the unreachable
  // portal route that was its only caller, leaving one layout and no choice.
  Tag: { size: { literal: ['small', 'default'] } },
  ChatComposerCore: { variant: { literal: ['qtplus', 'timeline', 'workspace'] } },
  ChatComposerDock: { composition: { css: ['.chat-composer-dock', 'data-ui-composition'] } },
  TaskAttributesPanel: { context: { literal: ['calendar', 'task'] } },
  SidebarLayout: { context: { map: ['Layout/SidebarLayout.jsx', 'CONTEXTS'] } },
  MobilePaneBack: { context: { map: ['Navigation/MobilePaneBack.jsx', 'CONTEXTS'] } },
  DetailLayout: { context: { map: ['Layout/DetailLayout.jsx', 'CONTEXTS'] } },
  DetailSection: { density: { map: ['Layout/DetailSection.jsx', 'DENSITIES'] } },
  // Two kinds of row: a line of figures, and a person with a face and two lines
  // of text under their name.
  DataTable: { density: { map: ['DataDisplay/DataTable.jsx', 'DENSITIES'] } },
  // Progress is `neutral` by default because most progress means nothing beyond
  // itself; the three severities are the exception, and they say so in words as
  // well as in hue.
  Meter: {
    tone: { map: ['Charts/Meter.jsx', 'TONES'] },
    layout: { map: ['Charts/Meter.jsx', 'LAYOUTS'] },
  },
  FilterBar: { context: { map: ['FilterBar.jsx', 'WIDTHS'] } },
  Popover: {
    align: { literal: ['start', 'center', 'end'] },
    padding: { map: ['Navigation/Popover.jsx', 'PADDINGS'] },
  },
};

function parseSource(source) {
  return parse(source, {
    sourceType: 'unambiguous',
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'dynamicImport', 'topLevelAwait', 'importAttributes'],
  });
}

// Object keys of a top-level `const NAME = {…}`, exported or not.
function mapKeys(relativeFile, name, nestedKey) {
  let ast;
  try {
    ast = parseSource(readFileSync(join(UI_DIR, relativeFile), 'utf8'));
  } catch {
    return [];
  }
  // Walked rather than scanned at top level: Dialog and Select declare their
  // lookup maps inside the component function.
  let found = [];
  const visit = node => {
    if (!node || typeof node !== 'object' || found.length) return;
    if (node.type === 'VariableDeclarator' && node.id?.name === name) {
      // `const x = {…}` but also `const x = {…}[key] || fallback`, which is how
      // Dialog declares bodyPaddingClass — the object is nested in the init.
      let object = node.init;
      const findObject = candidate => {
        if (!candidate || typeof candidate !== 'object') return null;
        if (candidate.type === 'ObjectExpression') return candidate;
        for (const key of Object.keys(candidate)) {
          const child = candidate[key];
          const hit = Array.isArray(child)
            ? child.map(findObject).find(Boolean)
            : (child && typeof child === 'object' && child.type ? findObject(child) : null);
          if (hit) return hit;
        }
        return null;
      };
      object = findObject(object);
      if (!object) return;
      let properties = object.properties;
      if (nestedKey) {
        // WIDTHS is keyed by context first, then by role.
        const branch = properties.find(property =>
          property.type === 'ObjectProperty'
          && String(property.key.name ?? property.key.value) === nestedKey);
        if (branch?.value?.type !== 'ObjectExpression') return;
        properties = branch.value.properties;
      }
      found = properties
        .filter(property => property.type === 'ObjectProperty')
        .map(property => String(property.key.name ?? property.key.value));
      return;
    }
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object' && child.type) visit(child);
    }
  };
  visit(ast.program);
  return found;
}

let cssCache = null;
function cssValues(classPrefix, attribute) {
  if (cssCache === null) cssCache = readFileSync(GLOBALS, 'utf8');
  const escaped = classPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escaped}\\[${attribute}='([^']+)'\\]`, 'g');
  return [...new Set([...cssCache.matchAll(pattern)].map(match => match[1]))].sort();
}

export function extractVariants() {
  const manifest = {};
  for (const [component, props] of Object.entries(SOURCES)) {
    manifest[component] = {};
    for (const [prop, source] of Object.entries(props)) {
      // A prop may legitimately draw from more than one source, so these are
      // unioned rather than treated as alternatives.
      let values = [];
      if (source.map) values.push(...mapKeys(source.map[0], source.map[1], source.map[2]));
      if (source.css) values.push(...cssValues(source.css[0], source.css[1]));
      if (source.literal) values.push(...source.literal);
      manifest[component][prop] = [...new Set(values)].sort();
    }
  }
  return manifest;
}

// Which component/prop pairs read the *same* CSS attribute namespace.
//
// `.ui-control[data-ui-composition]` is one selector shared by Button,
// IconAction and Input, and CSS cannot tell them apart — so the manifest
// honestly declares every value on all three. Without this map the drift report
// then claimed `Button.composition="duration-hours"` was an unused Button
// variant, when it is an Input composition that Button is merely also allowed
// to take. Ownership is a namespace question, so it is answered per namespace.
export function variantNamespaces() {
  const namespaces = {};
  for (const [component, props] of Object.entries(SOURCES)) {
    for (const [prop, source] of Object.entries(props)) {
      if (!source.css) continue;
      const [classPrefix, attribute] = source.css;
      namespaces[`${component}.${prop}`] = `${classPrefix || '*'}[${attribute}]`;
    }
  }
  return namespaces;
}

export function variantTotals(manifest) {
  let props = 0;
  let values = 0;
  for (const componentProps of Object.values(manifest)) {
    for (const list of Object.values(componentProps)) {
      props += 1;
      values += list.length;
    }
  }
  return { components: Object.keys(manifest).length, props, values };
}
