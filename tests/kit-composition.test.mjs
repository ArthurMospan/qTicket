import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layeredCompositionRules } from '../scripts/kit-composition.mjs';
import { extractVariants } from '../scripts/kit-variants.mjs';

const globals = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

// Whether a declaration survives the cascade is decided in a browser, by
// tests/visual/ui-kit.spec.mjs: `@layer components` loses to Tailwind's utility
// layer regardless of specificity, and no static rule reliably tells an
// unconditional utility from a variant or an error branch. What is checkable
// here is what the stylesheet declares, and that the presets keep the one
// mechanism a utility cannot touch.
test('the composition rules are readable, and only declare what can travel', () => {
  const rules = layeredCompositionRules(globals);
  assert.ok(rules.length > 20, 'the components layer must still be parsed');

  for (const rule of rules) {
    assert.doesNotMatch(rule.selector, /\/\*/, 'a selector must not swallow its comment');
    for (const { property } of rule.declarations) {
      assert.doesNotMatch(property, /^--/, 'custom properties are exempt and must not be listed');
    }
  }
});

// Custom properties are the supported way to hand a value to a component: no
// utility can set one. This is why `--ui-control-height` works while every
// `padding` beside it did not.
test('the presets keep the one mechanism that survives the cascade', () => {
  assert.match(globals, /--ui-control-height: var\(--ui-composition-metric\)/);
  assert.match(globals, /--ui-control-height: var\(--ui-composition-guard\)/);
  assert.match(globals, /--ui-control-line: calc\(var\(--ui-control-height\) - 24px\)/);
});

// Removing the dead declarations must not remove the compositions themselves:
// the variant manifest reads these selectors, and a value that disappears here
// becomes an undeclared value at every call site that still passes it.
test('every composition the product passes is still declared', () => {
  const manifest = extractVariants();
  for (const [component, values] of Object.entries({
    // `duration-compact-*` are gone with their single call site: the «Час»
    // pair in «Зафіксувати час» now passes the same `duration-hours` /
    // `duration-minutes` the tracker inside a task passes, because it is the
    // same action and had no reason to be a second, shorter control. The two
    // compact selectors declared no geometry at all, so nothing travelled.
    Input: ['metric-editor', 'metric-text', 'inline-edit', 'duration-hours', 'duration-minutes', 'status-entry', 'project-name'],
    Segmented: ['dialog-tabs', 'billing-selection'],
    Textarea: ['transcript', 'audio-transcript', 'project-description', 'long-form', 'settings-note'],
    // `menu-item` is gone: it dressed a Button as a menu row for the two
    // popovers that hand-built a menu, and both open ContextMenu now.
    Button: ['settings-row-action', 'status-submit', 'workspace-guard', 'inline-add-action'],
  })) {
    for (const value of values) {
      assert.ok(
        manifest[component].composition.includes(value),
        `${component} lost the declared composition "${value}"`,
      );
    }
  }
});

// What each preset actually delivered, measured in the browser before the
// cleanup and unchanged by it. Kept here so a later edit that does move one has
// to say so.
test('the surviving declarations are the ones that reach the screen', () => {
  // `flex: 1` is all the dialog-tabs preset ever delivered.
  assert.match(globals, /data-ui-composition='dialog-tabs'\] > button \{\s*flex: 1;\s*\}/);
  // Line height is all the transcript presets ever delivered.
  assert.match(globals, /data-ui-composition='transcript'\] \{\s*line-height: 20px;\s*\}/);
});

// Horizontal padding travels as a custom property for the same reason the
// height does: nothing in the utility layer can set one. Written as `px-*`
// inside Button or Input it would be emitted last and beat every composition —
// which is how these two came to declare room they never got.
test('a composition can claim the control padding, and two of them do', () => {
  assert.match(globals, /\.ui-control \{[^}]*padding-left: var\(--ui-control-pl, var\(--ui-control-px, 0px\)\)/);
  assert.match(globals, /\.ui-control \{[^}]*padding-right: var\(--ui-control-pr, var\(--ui-control-px, 0px\)\)/);
  assert.match(globals, /\.ui-button \{ --ui-control-px: 18px; \}/);
  assert.match(globals, /\.ui-button\[data-ui-size='md'\] \{ --ui-control-px: 16px; \}/);
  assert.match(globals, /\.ui-button\[data-ui-size='sm'\] \{ --ui-control-px: 12px; \}/);
  assert.match(globals, /\.ui-field \{ --ui-control-px: 12px; \}/);
  assert.match(globals, /\.ui-field\[data-ui-leading='icon'\] \{ --ui-control-pl: 36px; \}/);

  assert.match(globals, /data-ui-composition='inline-edit'\] \{[^}]*--ui-control-pr: 54px;[^}]*\}/);

  // The invite row is two standard `size="lg"` controls now. It used to be a
  // composition of its own at 52px with a 14px radius — the largest field and
  // button in the product, for one row in one dialog. A named size that only
  // restates the standard one is exactly the duplication the kit forbids, so
  // neither the selector nor the variable it read may come back.
  assert.doesNotMatch(globals, /data-ui-composition='invite-field'\]/);
  assert.doesNotMatch(globals, /data-ui-composition='invite-action'\]/);
  assert.doesNotMatch(globals, /--ui-composition-invite/);
  const inviteDialog = readFileSync(new URL('../src/components/InviteMemberDialog.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(inviteDialog, /composition="invite-/);

  // The utilities that used to hold these values must not come back: one of
  // them in either component reinstates the whole problem.
  const button = readFileSync(new URL('../src/components/ui/Button.jsx', import.meta.url), 'utf8');
  const input = readFileSync(new URL('../src/components/ui/Input.jsx', import.meta.url), 'utf8');
  const sizes = button.slice(button.indexOf('export const SIZES'), button.indexOf('const ICON_SIZES'));
  assert.doesNotMatch(sizes, /px-\[/, 'Button size padding belongs to --ui-control-px');
  assert.doesNotMatch(input, /\bpl-\[|\bpr-\[/, 'Input padding belongs to --ui-control-px');
  // The icon box keeps `p-0`: a square has no padding to give away.
  assert.match(sizes, /icon: 'w-\[32px\] p-0'/);
});

test('the browser is the one that decides, and the rules say so', () => {
  const spec = readFileSync(new URL('./visual/ui-kit.spec.mjs', import.meta.url), 'utf8');
  const contract = readFileSync(new URL('../docs/UI_KIT_CONTRACT.md', import.meta.url), 'utf8');

  assert.match(spec, /every data-ui-\* declaration survives the cascade/);
  assert.match(spec, /getComputedStyle/);
  assert.match(contract, /layeredCompositionRules|getComputedStyle/);
});
