import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractStates, previewSections, STATE_ORDER } from '../scripts/kit-states.mjs';
import { readShowcase } from '../scripts/ui-kit-showcase.mjs';
import { SECTIONS, FORCED_STATE_SECTION } from './visual/sections.mjs';

const committed = JSON.parse(
  readFileSync(new URL('../src/app/ui-kit/kit-states.generated.json', import.meta.url), 'utf8'),
);
const story = readShowcase().stories.find(entry => entry.id === 'states');

// The keys of the two maps the section is built from, read the same way
// check-kit-drift reads VARIANT_BASE: the file is JSX, so it cannot be
// imported by a node test, and a hand-kept second list would be the very thing
// this whole mechanism exists to prevent.
function stateBaseComponents() {
  const map = story.source.slice(
    story.source.indexOf('const STATE_BASE = {'),
    story.source.indexOf('const STATE_PROPS'),
  );
  return new Set([...map.matchAll(/^ {2}(\w+):\s*\(\{/gm)].map(match => match[1]));
}

test('the committed state manifest matches the code', () => {
  const fresh = { ...extractStates(), previewSections: previewSections() };
  assert.deepEqual(
    fresh,
    committed,
    'kit-states.generated.json is stale — run `npm run kit:states` and commit the result',
  );
  assert.deepEqual(committed.parseErrors, []);
});

// The point of deriving states instead of listing them: a component that grows
// a `disabled` prop, or loses its hover styling, changes this file — and the
// catalogue is rebuilt from this file, so it cannot fall behind.
test('a state exists because the implementation declares it', () => {
  const { components } = committed;
  assert.deepEqual(committed.stateOrder, STATE_ORDER);

  // Spot checks against components whose states are readable by eye, so a
  // silently broken derivation cannot pass by reporting nothing at all.
  assert.equal(components.Button.disabled, 'prop');
  assert.equal(components.Button.loading, 'prop');
  // Input and Textarea never name `disabled`; they forward it through the rest
  // spread onto their native control, and support it completely.
  assert.equal(components.Input.disabled, 'native');
  assert.equal(components.Textarea.disabled, 'native');
  assert.equal(components.Input.error, 'prop');
  // A component with nothing to hover, focus, disable or overflow has no
  // states, and the matrix must not invent one for it.
  assert.deepEqual(components.PriorityBadge, {});
  assert.deepEqual(components.UserAvatar, {});

  for (const [name, states] of Object.entries(components)) {
    for (const [state, source] of Object.entries(states)) {
      assert.ok(STATE_ORDER.includes(state), `${name} declares an unknown state: ${state}`);
      assert.ok(source, `${name}.${state} must record where the state comes from`);
    }
  }
});

// The contract zero. Every stateful component is either rendered live in the
// matrix or listed there with a pointer to the section that does show it; a
// component can never be stateful and absent.
test('every stateful component is visible in «Матриця станів»', () => {
  const live = stateBaseComponents();
  const sections = committed.previewSections;

  const missing = Object.entries(committed.components)
    .filter(([name, states]) => Object.keys(states).length > 0)
    .filter(([name]) => !live.has(name) && !(sections[name]?.length));

  assert.deepEqual(
    missing.map(([name]) => name),
    [],
    'A component with a state must render in STATE_BASE or be previewed in a section the matrix can point at',
  );

  // The other direction: the matrix may not render a component the manifest
  // knows nothing about, which is how a live example turns into fiction.
  for (const name of live) {
    assert.ok(name in committed.components, `STATE_BASE renders ${name}, which is not in the kit inventory`);
  }
});

test('the state matrix is a navigable section with its own screenshots', () => {
  const { visibleSectionIds } = readShowcase();
  assert.ok(visibleSectionIds.includes('states'), 'the matrix must be reachable from the navigation');
  assert.ok(SECTIONS.some(section => section.id === 'states'), 'the screenshot suite must cover it');
  assert.equal(FORCED_STATE_SECTION, 'states');

  // Hover and focus are photographed by forcing the real pseudo-class, not by
  // adding a static class that repeats the component's own styling.
  assert.match(story.source, /data-kit-state=\{forced \? state : undefined\}/);
  const spec = readFileSync(new URL('./visual/ui-kit.spec.mjs', import.meta.url), 'utf8');
  assert.match(spec, /CSS\.forcePseudoState/);
  assert.match(spec, /states-forced\.png/);
  assert.doesNotMatch(
    story.source,
    /className="[^"]*\bhover:(?:bg|border|text|ring)-/,
    'the matrix must provoke hover, never repaint it by hand',
  );
});

test('the state matrix is documented where the rules live', () => {
  const contract = readFileSync(new URL('../docs/UI_KIT_CONTRACT.md', import.meta.url), 'utf8');
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(packageJson.scripts['kit:states'], 'node scripts/kit-states.mjs');
  assert.match(contract, /Матриця станів/);
});
