import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditA11y } from '../scripts/kit-a11y.mjs';

const committed = JSON.parse(
  readFileSync(new URL('../src/app/ui-kit/a11y-audit.generated.json', import.meta.url), 'utf8'),
);

test('the committed a11y audit matches the code', () => {
  assert.deepEqual(
    auditA11y(),
    committed,
    'a11y-audit.generated.json is stale — run `npm run kit:a11y` and commit the result',
  );
});

// Five contract zeros. None of them is visible in a screenshot, which is why
// the visual suite cannot be the thing that guards them.
test('the accessibility contract holds', () => {
  assert.deepEqual(
    committed.namelessControls,
    [],
    'An icon-only control must carry an accessible name — aria-label, or the kit prop that becomes one',
  );
  assert.deepEqual(committed.imagesWithoutAlt, [], 'Every <img> declares alt, empty when decorative');
  assert.deepEqual(committed.positiveTabIndex, [], 'Tab order is document order');
  assert.deepEqual(
    committed.fakeButtons,
    [],
    'A click handler belongs on a button or a link; a div needs role, tabIndex and a key handler',
  );
  assert.deepEqual(committed.contrastFailures, [], 'Muted and faint text tokens must keep 4.5:1 contrast');
});

// The audit is only worth a zero if it is still looking. Each of these was a
// real bug in the checker that reported a plausible number instead of failing.
test('the audit still sees what it is supposed to see', () => {
  assert.ok(committed.totals.files > 150, 'the audit walks the whole workspace and the kit');
  assert.ok(committed.totals.elements > 3000, 'it reads every JSX element in them');

  // Counting any capitalised child as text made every `<button><ChevronRight/>`
  // look named: 12 findings where there were 30.
  const kit = readFileSync(new URL('../scripts/kit-a11y.mjs', import.meta.url), 'utf8');
  assert.match(kit, /function hasVisibleText/);
  assert.doesNotMatch(kit, /Icon\$\/\.test\(name\)/, 'the discarded "a capitalised child is text" rule must not return');

  // `?.click()` is an OptionalCallExpression, and a check for CallExpression
  // alone walked past every forwarding row in the product.
  assert.match(kit, /OptionalCallExpression/);
  assert.match(kit, /OptionalMemberExpression/);

  // A dynamic attribute can become an empty string at runtime. It belongs in
  // an explicit browser-verification queue, never in the proven-name bucket.
  assert.match(kit, /function nameEvidence/);
  assert.ok(
    committed.runtimeNameVerification.some(item => item.location.includes('src/components/ui/Tabs.jsx')),
    'Tabs dynamic title/aria-label values remain visible to runtime verification',
  );
});

// The three exemptions, each of which is a real pattern rather than an excuse.
// They are the reason the zeros are believable, so they are pinned by name.
test('the exemptions are the three narrow ones, and no more', () => {
  const kit = readFileSync(new URL('../scripts/kit-a11y.mjs', import.meta.url), 'utf8');
  for (const rule of ['isClickAway', 'onlyStopsPropagation', 'forwardsToInnerControl']) {
    assert.match(kit, new RegExp(`function ${rule}\\(`), `${rule} is part of the contract`);
  }

  // The kit's own click-away layers must keep the marker each exemption reads,
  // or the exemption silently starts covering something else.
  const dialog = readFileSync(new URL('../src/components/ui/Dialog.jsx', import.meta.url), 'utf8');
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
});

test('the kit fixes that made the zeros are still in place', () => {
  const checkbox = readFileSync(new URL('../src/components/ui/Forms/Checkbox.jsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/components/ui/Layout/Card.jsx', import.meta.url), 'utf8');
  const kpi = readFileSync(new URL('../src/components/ui/DataDisplay/KpiCard.jsx', import.meta.url), 'utf8');
  const formGroup = readFileSync(new URL('../src/components/ui/Forms/FormGroup.jsx', import.meta.url), 'utf8');
  const viewer = readFileSync(new URL('../src/components/ui/DataDisplay/MarkdownViewer.jsx', import.meta.url), 'utf8');

  // The visible box is a label pointed at the native input, not a div with a
  // click handler beside it.
  assert.match(checkbox, /<label\s+htmlFor=\{checkboxId\}/);
  // A surface with a handler is a real button.
  assert.match(card, /const Element = onClick \? 'button' : 'div'/);
  assert.match(kpi, /<button type="button" onClick=\{onClick\}/);
  // The caption and the control know about each other.
  assert.match(formGroup, /React\.useId\(\)/);
  assert.match(formGroup, /htmlFor=\{single \? \(single\.props\.id \?\? fieldId\) : undefined\}/);
  assert.match(formGroup, /'aria-invalid'/);
  // A checkbox inside rendered markdown is named by the line it toggles.
  assert.match(viewer, /aria-label=\{taskLine \? `Пункт: \$\{taskLine\}` : 'Пункт списку'\}/);
});

test('the a11y audit is documented where the rules live', () => {
  const contract = readFileSync(new URL('../docs/UI_KIT_CONTRACT.md', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['kit:a11y'], 'node scripts/kit-a11y.mjs');
  assert.match(contract, /kit:a11y/);
});
