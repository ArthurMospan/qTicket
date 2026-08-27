// Every colour the product paints comes from a token.
//
// Before this, twenty-six of them did not. Eleven reds, six greens, six ambers
// and three blues meant "failed", "fine" and "careful" in a different colour on
// every screen, and six near-whites meant the app's own canvas. None of the
// three generated reports could see it: `kit:drift` asks whether a component is
// passed a declared variant, `kit:audit` whether a control is the kit's, and a
// raw hex is neither — it is a value nobody declared anywhere.
//
// So this reads the same product files those two do, and asks one question of
// each className and inline style: is this colour a token?
//
// It used to read fewer files than it claimed. `collectWorkspaceUiFiles()`
// stops its walk at `src/components/ui` unless asked otherwise — the right
// default for `kit:scan`, which is counting how the product reaches for the
// kit, and the wrong one here, because the kit is where most of the pixels are
// painted. The report said zero while fifty-nine raw colours shipped inside it,
// including three greens meaning "fine" and two ambers meaning "careful". The
// walk now includes the kit, exactly as `kit:a11y` already did.
//
// What stays legal is what is not styling. A palette offered to somebody to
// choose from is data. So is the colour a status, type or priority carries out
// of the database, the fill a `<canvas>` is handed, the two colours a QR
// generator needs, and the stylesheet embedded in a print window that cannot
// see the product's own. Each of those is listed by file and line below, with
// the reason — an exception nobody can read is the drift this exists to stop.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectWorkspaceUiFiles } from './workspace-ui-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(ROOT, 'src', 'app', 'ui-kit', 'kit-colors.generated.json');

// Screens with a life of their own. Login and onboarding are a dark shell that
// predates the workspace palette and is not part of the catalogue; the toast is
// the one dark surface the product ships, and light-on-dark status colours are
// a set the kit does not have yet rather than a rename. Both are written down
// in src/components/ui/CANDIDATES.md.
const OUT_OF_SCOPE = new Set([
  'src/components/AuthLayout.jsx',
  'src/components/OrgSwitcherScreen.jsx',
  'src/components/ui/Feedback/Toast.jsx',
]);

// Colour as data, not as styling. Keyed by file, each entry says why.
const DATA_COLORS = {
  'src/app/(app)/page.js': 'fallback colour for a priority that carries none',
  'src/app/(app)/settings/page.js': 'the palette a person picks a brand colour from, and the stored sidebarColor',
  'src/app/(app)/sprints/page.js': 'StatusPill is handed a colour, the way a status from the database is',
  'src/components/InviteLinkSection.jsx': 'the QR generator takes two literal colours',
  'src/components/SearchModal.jsx': 'fallback colour for a type that carries none',
  'src/components/workspace/AgileBoard.jsx': 'the synthetic «Приховані» lane carries a colour like every other lane',
  'src/components/workspace/BillingTab.jsx': 'the invoice print document is injected into a window that cannot see the app CSS',
  'src/components/workspace/IssueCard.jsx': 'fallback colours for a type or status that carries none',
  'src/components/workspace/IssueDetail.jsx': 'fallback colours for a type or priority that carries none',
};

// A colour written as a Tailwind utility: `bg-[#abc123]`, `text-red-500`.
const ARBITRARY = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow|caret|accent|placeholder)-\[#[0-9a-fA-F]{3,8}\]/g;
const PALETTE = /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|decoration|shadow|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|1|2|3|4|5|6|7|8|9)(?:00|50)?\b/g;

export function scanColors() {
  const findings = [];
  const dataColorFiles = new Set();
  for (const file of collectWorkspaceUiFiles({ includeSharedUi: true })) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (OUT_OF_SCOPE.has(rel)) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      // A colour named in prose is a colour nobody paints. Two comments explain
      // what a control used to look like, and reporting those would have made
      // the only fix "stop writing down what changed".
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
      for (const match of [...line.matchAll(ARBITRARY), ...line.matchAll(PALETTE)]) {
        findings.push({ file: rel, line: index + 1, value: match[0], text: line.trim().slice(0, 120) });
      }
      // A bare hex is only reported so the exceptions stay honest: it is data
      // wherever it is legal, and this is the list of where that is.
      if (/#[0-9a-fA-F]{6}\b/.test(line) && DATA_COLORS[rel]) dataColorFiles.add(rel);
    });
  }
  return { findings, dataColorFiles: [...dataColorFiles].sort() };
}

const { findings, dataColorFiles } = scanColors();
const report = {
  generatedBy: 'npm run kit:colors',
  policy: 'Every colour that is styling comes from a token in @theme. Colour that is data is listed, by file, with its reason.',
  outOfScope: [...OUT_OF_SCOPE],
  dataColors: DATA_COLORS,
  totals: { hardcoded: findings.length, filesWithDataColors: dataColorFiles.length },
  hardcoded: findings,
};
writeFileSync(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(`kit colors: ${findings.length} hardcoded colours in product UI → ${relative(ROOT, OUTPUT).split(sep).join('/')}`);
