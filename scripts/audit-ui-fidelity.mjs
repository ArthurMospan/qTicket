import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { scanKitUsage } from './scan-kit-usage.mjs';
import { collectWorkspaceUiFiles, collectWorkspaceRouteMap } from './workspace-ui-files.mjs';

const traverse = traverseModule.default || traverseModule;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'app', 'ui-kit', 'fidelity-audit.generated.json');
const NATIVE_CONTROLS = new Set(['button', 'input', 'textarea', 'select']);
const SHARED_CONTROL_COMPONENTS = new Set([
  'Button',
  'Input',
  'Textarea',
  'Select',
  'MultiSelect',
  'DatePicker',
  'Checkbox',
  'ToggleSwitch',
  'Segmented',
  'Tabs',
  'IconAction',
]);
const SHARED_SURFACE_COMPONENTS = new Set(['Card', 'Surface', 'Dialog', 'EmptyState']);
const SHARED_DISPLAY_COMPONENTS = new Set([
  'Counter',
  'Pill',
  'PriorityBadge',
  'StatusPill',
  'Tag',
  'TypeBadge',
]);

function toPosix(file) {
  return relative(ROOT, file).split(sep).join('/');
}

function jsxName(node) {
  if (!node) return '';
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    return `${jsxName(node.object)}.${jsxName(node.property)}`;
  }
  return '';
}

function staticText(node) {
  if (!node) return '';
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis.map(part => part.value.cooked || '').join(' ${…} ');
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    return `${staticText(node.left)} ${staticText(node.right)}`.trim();
  }
  if (node.type === 'ConditionalExpression') {
    return `${staticText(node.consequent)} ${staticText(node.alternate)}`.trim();
  }
  return '';
}

function attributeValue(attribute) {
  if (!attribute || attribute.type !== 'JSXAttribute') return '';
  if (!attribute.value) return 'true';
  if (attribute.value.type === 'StringLiteral') return attribute.value.value;
  if (attribute.value.type === 'JSXExpressionContainer') return staticText(attribute.value.expression);
  return '';
}

function attributesOf(openingElement) {
  const attributes = new Map();
  for (const attribute of openingElement.attributes || []) {
    if (attribute.type !== 'JSXAttribute') continue;
    attributes.set(attribute.name.name, attributeValue(attribute));
  }
  return attributes;
}

function normalizedClass(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function location(file, node) {
  return `${toPosix(file)}:${node.loc?.start?.line || 1}`;
}

function hasControlChrome(value) {
  return /(?:^|\s)!?(?:h-(?:\d+|\[[^\]]+\])|min-h-|max-h-|rounded|bg-|border|shadow|px-|py-|p-\[|text-\[|font-(?:medium|semibold|bold|black))/.test(value);
}

function hasSurfaceChrome(value) {
  return /(?:^|\s)!?(?:rounded|bg-|border|shadow|ring-|p(?:x|y|t|r|b|l)?-(?:\d+|\[[^\]]+\]))/.test(value);
}

function hasDisplayChrome(value) {
  return /(?:^|\s)!?(?:rounded|bg-|border|shadow|ring-|px-|py-|text-\[|font-)/.test(value);
}

function looksLikeManualPill(name, className) {
  return (
    (name === 'span' || name === 'div')
    && /\brounded(?:-full|-\[[^\]]+\]|-\w+)?/.test(className)
    && /\bpx-(?:\d+|\[[^\]]+\])/.test(className)
    && /\btext-\[(?:8|9|10|11)px\]/.test(className)
    && (/\bbg-/.test(className) || /\bbackdrop-blur/.test(className))
  );
}

function looksLikeManualSurface(name, className) {
  return (
    ['div', 'section', 'article', 'aside', 'form'].includes(name)
    && /\brounded(?:-|\b)/.test(className)
    && /\bbg-(?:white|canvas|surface)\b/.test(className)
    && /(?:^|\s)(?:border|ring-|shadow|p(?:x|y|t|r|b|l)?-(?:\d+|\[[^\]]+\]))/.test(className)
  );
}

function looksLikeManualIconButton(name, className) {
  return (
    name === 'button'
    && /(?:\bflex\b|\bgrid\b)/.test(className)
    && /(?:items-center|place-items-center)/.test(className)
    && /\brounded/.test(className)
    && (
      /\bh-(?:7|8|9|10|11|12|\[[^\]]+\])/.test(className)
      || /\bp(?:x|y)?-(?:1|1\.5|2|\[[^\]]+\])/.test(className)
    )
  );
}

function headingSize(className) {
  return className.match(/\btext-(?:\[[^\]]+\]|xs\b|sm\b|base\b|lg\b|xl\b|2xl\b|3xl\b)/)?.[0] || '';
}

function hasVisibleText(children = []) {
  for (const child of children) {
    if (child.type === 'JSXText' && child.value.trim()) return true;
    if (child.type === 'JSXExpressionContainer' && child.expression.type !== 'JSXEmptyExpression') return true;
    if (child.type === 'JSXElement' && hasVisibleText(child.children)) return true;
  }
  return false;
}

function importBindings(ast) {
  const shared = new Map();
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue;
    if (!String(statement.source.value).startsWith('@/components/ui')) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportDefaultSpecifier') {
        shared.set(specifier.local.name, specifier.local.name);
      } else if (specifier.type === 'ImportSpecifier') {
        shared.set(specifier.local.name, specifier.imported.name || specifier.imported.value);
      }
    }
  }
  return shared;
}

function sortLocations(entries) {
  return [...entries].sort((a, b) => a.location.localeCompare(b.location));
}

// Which kit component this native control is probably a hand-rolled copy of.
// A hint only — the classification is a judgement call, so the survey asks.
// Which product surface a control belongs to.
//
// These are not strays to be folded into generic components — they are the
// working parts of Calendar, Chat, Analytics and the rest. Each surface has
// its own section in /ui-kit for the same reason chat does: a control only
// makes sense next to the others it works with.
const STRUCTURES = [
  { id: 'chat', label: 'Чат', file: /(?:\/chat\/|Chat[A-Z]|ChatAttachments|MessageContent|UnifiedTimeline|HoverCard)/ },
  { id: 'calendar', label: 'Календар', file: /calendar/i },
  { id: 'analytics', label: 'Аналітика', file: /(?:analytics|BillingTab|TimesheetTab|WorkloadTab)/i },
  { id: 'qtplus', label: 'QuickTeam+', file: /qtplus/i },
  { id: 'ai-call', label: 'AI-дзвінок', file: /(?:ai-call|AudioTask)/i },
  { id: 'tasks', label: 'Задачі', file: /(?:IssueDetail|IssueCard|CreateTaskModal|TaskRow|TaskListView|AttachmentViewer|Markdown)/ },
  { id: 'board', label: 'Дошка й проєкт', file: /(?:AgileBoard|BoardConfig|QtPlusProjectTab|\(app\)\/\[projectId\]|\(app\)\/page\.js)/ },
  { id: 'sprints', label: 'Спринти', file: /sprints/i },
  { id: 'settings', label: 'Налаштування', file: /(?:settings|TeamMemberSettings|InviteLink|InviteMemberDialog|OrgSwitcher|YouTrackImport)/i },
  { id: 'shell', label: 'Оболонка', file: /(?:WorkspaceHeader|WorkspaceSidebar|MobileNav|AuthLayout|SearchModal|UserStatusSetter|TopHeader|NotificationCenter|profile\/)/ },
];

export const STRUCTURE_LABELS = Object.fromEntries(STRUCTURES.map(item => [item.id, item.label]));

function structureOf(file) {
  const match = STRUCTURES.find(item => item.file.test(file));
  return match ? match.id : 'other';
}

function resemblesKitComponent(tag, className, text, childElements) {
  if (tag === 'input') return 'Input';
  if (tag === 'textarea') return 'Textarea';
  if (tag === 'select') return 'Select';
  if (tag !== 'button') return '';

  const iconOnly = !text && childElements.length > 0;
  if (/rounded-full/.test(className)) return iconOnly ? 'IconAction shape="circle"' : 'Pill / Button shape="circle"';
  if (iconOnly) return 'IconAction';
  if (/(?:bg-ink|bg-\[#1f1f1f\]|bg-black)/.test(className)) return 'Button style="primary"';
  if (/(?:bg-canvas|bg-\[#f4f4f5\]|bg-\[#f5f5f5\])/.test(className)) return 'Button style="secondary"';
  if (/border/.test(className)) return 'Button style="ghost"';
  if (/rounded/.test(className)) return 'Button';
  return '';
}

function auditFile(file, inventoryNames) {
  const source = readFileSync(file, 'utf8');
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: [
        'jsx',
        'typescript',
        'decorators-legacy',
        'classProperties',
        'dynamicImport',
        'topLevelAwait',
      ],
    });
  } catch (error) {
    return {
      parseError: {
        location: `${toPosix(file)}:1`,
        message: error.message,
      },
    };
  }

  const sharedBindings = importBindings(ast);
  const nativeControls = [];
  const manualLabels = [];
  const manualModalShells = [];
  const manualPills = [];
  const manualSurfaces = [];
  const localSurfaceExceptions = [];
  const manualIconButtons = [];
  const headingStyles = [];
  const sharedChromeOverrides = [];
  const localSharedNameCollisions = [];

  traverse(ast, {
    FunctionDeclaration(path) {
      const name = path.node.id?.name;
      if (name && inventoryNames.has(name)) {
        localSharedNameCollisions.push({
          name,
          location: location(file, path.node),
          declaration: 'function',
        });
      }
    },
    VariableDeclarator(path) {
      const name = path.node.id?.type === 'Identifier' ? path.node.id.name : '';
      if (name && inventoryNames.has(name)) {
        localSharedNameCollisions.push({
          name,
          location: location(file, path.node),
          declaration: 'variable',
        });
      }
    },
    JSXOpeningElement(path) {
      const name = jsxName(path.node.name);
      const attributes = attributesOf(path.node);
      const className = normalizedClass(attributes.get('className'));
      const entryLocation = location(file, path.node);

      if (NATIVE_CONTROLS.has(name)) {
        // The label and child icons are what make a control recognisable on a
        // screen. A file:line alone cannot answer "which button is this?".
        const children = path.parentPath?.node?.children || [];
        const text = children
          .filter(child => child.type === 'JSXText')
          .map(child => child.value.replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' ')
          .slice(0, 60);
        const childElements = [...new Set(children
          .filter(child => child.type === 'JSXElement')
          .map(child => jsxName(child.openingElement.name))
          .filter(Boolean))];
        nativeControls.push({
          tag: name,
          location: entryLocation,
          className,
          text,
          childElements,
          ariaLabel: (attributes.get('aria-label') || attributes.get('title') || '')
            .replace(/\$\{[^}]*\}/g, '…')
            .replace(/\s+/g, ' ')
            .trim(),
          styled: hasControlChrome(className),
          reviewed: attributes.get('data-ui-control') || '',
          resembles: resemblesKitComponent(name, className, text, childElements),
        });
      }

      if (
        name === 'label'
        && !/\bcursor-pointer\b/.test(className)
        && /(?:uppercase|ui-label|text-\[(?:10|11|13)px\])/.test(className)
      ) {
        manualLabels.push({
          location: entryLocation,
          className,
        });
      }

      if (
        ['div', 'section', 'form', 'aside'].includes(name)
        && /\bfixed\b/.test(className)
        && /\binset-0\b/.test(className)
        && !attributes.has('data-ui-overlay')
      ) {
        manualModalShells.push({
          location: entryLocation,
          tag: name,
          className,
        });
      }

      if (
        looksLikeManualPill(name, className)
        && !attributes.has('data-ui-pill')
        && !attributes.has('data-ui-surface')
      ) {
        manualPills.push({
          location: entryLocation,
          tag: name,
          className,
        });
      }

      if (looksLikeManualSurface(name, className)) {
        if (!attributes.has('data-ui-surface') && !attributes.has('data-ui-overlay')) {
          manualSurfaces.push({
            location: entryLocation,
            tag: name,
            className,
          });
        } else if (attributes.get('data-ui-surface') === 'local') {
          localSurfaceExceptions.push({
            location: entryLocation,
            tag: name,
            className,
          });
        }
      }

      if (
        looksLikeManualIconButton(name, className)
        && !attributes.has('data-ui-action')
        && path.parentPath.node?.type === 'JSXElement'
        && !hasVisibleText(path.parentPath.node.children)
      ) {
        manualIconButtons.push({
          location: entryLocation,
          className,
          ariaLabel: attributes.get('aria-label') || '',
        });
      }

      if (
        ['h1', 'h2', 'h3', 'h4'].includes(name)
        && !/\bui-type-/.test(className)
        && !attributes.has('data-ui-type')
      ) {
        headingStyles.push({
          location: entryLocation,
          tag: name,
          size: headingSize(className),
          className,
        });
      }

      const sharedName = sharedBindings.get(name);
      if (!sharedName) return;
      const overrideAttributes = [
        'className',
        'buttonClassName',
        'inputClassName',
        'bodyClassName',
        'contentClassName',
      ];
      for (const attributeName of overrideAttributes) {
        const value = normalizedClass(attributes.get(attributeName));
        if (!value) continue;
        let overridesChrome = false;
        if (SHARED_CONTROL_COMPONENTS.has(sharedName) || sharedName === 'Label') {
          overridesChrome = hasControlChrome(value);
        } else if (SHARED_SURFACE_COMPONENTS.has(sharedName)) {
          overridesChrome = hasSurfaceChrome(value);
        } else if (SHARED_DISPLAY_COMPONENTS.has(sharedName)) {
          overridesChrome = hasDisplayChrome(value);
        }
        if (!overridesChrome) continue;
        sharedChromeOverrides.push({
          component: sharedName,
          attribute: attributeName,
          value,
          location: entryLocation,
        });
      }
    },
  });

  return {
    nativeControls,
    manualLabels,
    manualModalShells,
    manualPills,
    manualSurfaces,
    localSurfaceExceptions,
    manualIconButtons,
    headingStyles,
    sharedChromeOverrides,
    localSharedNameCollisions,
  };
}

function repeatedNativeFingerprints(nativeControls) {
  const groups = new Map();
  for (const control of nativeControls) {
    if (!control.className || control.className === 'hidden' || control.reviewed) continue;
    const key = `${control.tag}\n${control.className}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(control.location);
  }
  return [...groups.entries()]
    .filter(([, locations]) => locations.length > 1)
    .map(([key, locations]) => {
      const [tag, className] = key.split('\n');
      return { tag, className, count: locations.length, locations: locations.sort() };
    })
    .sort((a, b) => b.count - a.count || a.className.localeCompare(b.className));
}

export function auditUiFidelity() {
  const kitUsage = scanKitUsage();
  const routeMap = collectWorkspaceRouteMap();
  const withContext = control => ({
    ...control,
    structure: structureOf(control.location),
    routes: routeMap.fileRoutes[control.location.split(':')[0]] || [],
  });
  const inventoryNames = new Set(Object.keys(kitUsage.components));
  const workspaceFiles = collectWorkspaceUiFiles();
  const results = workspaceFiles.map(file => ({
    file,
    result: auditFile(file, inventoryNames),
  }));

  const parseErrors = [];
  const nativeControls = [];
  const manualLabels = [];
  const manualModalShells = [];
  const manualPills = [];
  const manualSurfaces = [];
  const localSurfaceExceptions = [];
  const manualIconButtons = [];
  const headingStyles = [];
  const sharedChromeOverrides = [];
  const localSharedNameCollisions = [];

  for (const { result } of results) {
    if (result.parseError) {
      parseErrors.push(result.parseError);
      continue;
    }
    nativeControls.push(...result.nativeControls);
    manualLabels.push(...result.manualLabels);
    manualModalShells.push(...result.manualModalShells);
    manualPills.push(...result.manualPills);
    manualSurfaces.push(...result.manualSurfaces);
    localSurfaceExceptions.push(...result.localSurfaceExceptions);
    manualIconButtons.push(...result.manualIconButtons);
    headingStyles.push(...result.headingStyles);
    sharedChromeOverrides.push(...result.sharedChromeOverrides);
    localSharedNameCollisions.push(...result.localSharedNameCollisions);
  }

  const nativeByTag = Object.fromEntries(
    ['button', 'input', 'textarea', 'select'].map(tag => [
      tag,
      nativeControls.filter(control => control.tag === tag).length,
    ]),
  );
  const nativeHotspots = new Map();
  for (const control of nativeControls) {
    const file = control.location.replace(/:\d+$/, '');
    nativeHotspots.set(file, (nativeHotspots.get(file) || 0) + 1);
  }

  return {
    generatedBy: 'scripts/audit-ui-fidelity.mjs',
    scope: 'authenticated-workspace',
    policy: {
      sharedComponentContract: 'A new reusable UI component must be used by the product, exported from src/components/ui, and rendered in /ui-kit in the same change.',
      driftContract: 'New native-control fingerprints or shared chrome overrides must be reviewed before the generated audit baseline changes.',
      brandingContract: 'Custom branding remains limited to the sidebar and its contrast-dependent children.',
      catalogContract: 'Only source files reachable from src/app/(app) belong to the UI Kit product catalog.',
    },
    totals: {
      productFiles: results.length,
      parsedFiles: results.length - parseErrors.length,
      parseErrors: parseErrors.length,
      nativeControls: nativeControls.length,
      structures: Object.fromEntries(
        [...STRUCTURES, { id: 'other' }].map(item => [
          item.id,
          nativeControls.filter(control => structureOf(control.location) === item.id).length,
        ]).filter(([, count]) => count > 0),
      ),
      styledNativeControls: nativeControls.filter(control => control.styled).length,
      reviewedNativeControls: nativeControls.filter(control => control.reviewed).length,
      manualLabels: manualLabels.length,
      manualModalShells: manualModalShells.length,
      manualPills: manualPills.length,
      manualSurfaces: manualSurfaces.length,
      localSurfaceExceptions: localSurfaceExceptions.length,
      manualIconButtons: manualIconButtons.length,
      headingStyles: headingStyles.length,
      sharedChromeOverrides: sharedChromeOverrides.length,
      localSharedNameCollisions: localSharedNameCollisions.length,
    },
    nativeByTag,
    kit: {
      totals: kitUsage.totals,
      // Reached by nothing at all. A component the product only touches through
      // another kit component (TopHeader renders Breadcrumb on every screen) is
      // used; counting it here once deleted two live components.
      unusedComponents: Object.entries(kitUsage.components)
        .filter(([, entry]) => entry.count === 0 && entry.usedByKit.length === 0)
        .map(([name]) => name)
        .sort(),
    },
    parseErrors: sortLocations(parseErrors),
    // Chat is a separate structure with its own section in /ui-kit, so its
    // controls are reported separately too. Mixing them into the bypass list
    // framed the chat's own elements as strays to be folded into generic
    // components, which is the opposite of the intent.
    nativeControls: sortLocations(nativeControls).map(withContext),
    structureLabels: STRUCTURE_LABELS,
    nativeHotspots: [...nativeHotspots.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
    repeatedNativeFingerprints: repeatedNativeFingerprints(nativeControls),
    reviewedNativeControls: sortLocations(
      nativeControls
        .filter(control => control.reviewed)
        .map(({ location: entryLocation, tag, reviewed }) => ({
          location: entryLocation,
          tag,
          context: reviewed,
        })),
    ),
    manualLabels: sortLocations(manualLabels),
    manualModalShells: sortLocations(manualModalShells),
    manualPills: sortLocations(manualPills),
    manualSurfaces: sortLocations(manualSurfaces),
    localSurfaceExceptions: sortLocations(localSurfaceExceptions),
    manualIconButtons: sortLocations(manualIconButtons),
    headingStyles: sortLocations(headingStyles),
    sharedChromeOverrides: sortLocations(sharedChromeOverrides),
    localSharedNameCollisions: sortLocations(localSharedNameCollisions),
  };
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).join('/'));
if (isDirectRun) {
  const result = auditUiFidelity();
  writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `UI fidelity audit: ${result.totals.productFiles} files, `
    + `${result.totals.nativeControls} native controls, `
    + `${result.totals.sharedChromeOverrides} shared chrome overrides `
    + `→ ${toPosix(OUTPUT)}`,
  );
}
